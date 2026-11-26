import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { rootDir, getPaths, voiceJobControllers } from './config.mjs';
import { syncCaptions, recalculateTimelines, syncTableToManifest, recompileProject } from './project-store.mjs';
import { renderProject } from '../../render-project.mjs';
import { synthesizeWithBailian } from '../../synthesize-bailian.mjs';
import { synthesizeWithVoicebox } from '../../synthesize-voicebox.mjs';
import { buildElevenlabsTtsPayload } from '../../synthesize-elevenlabs.mjs';
import { alignNarration, probeDurationMs, scenesText, timingPath } from '../../narration-timing.mjs';
import {
  regroupScenesByKeywords,
  planCuts,
  resliceSceneTexts,
  splitAtSpokenIndex,
  mergeEligibleScenesPass,
  bridgeThreeSentencesToTwoShotsPass,
  refreshSceneKeywordMetadata,
} from '../../cut-planner.mjs';

export async function runProjectRenderJob(job) {
  const curPaths = getPaths(job.projectId);
  const appendLog = (chunk) => { job.log = (job.log + chunk).slice(-4000); };
  try {
    if (!fs.existsSync(curPaths.manifestPath)) throw new Error('工程缺少镜头清单，无法渲染');
    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const before = JSON.stringify((manifest.scenes || []).map((s) => [s.start_ms, s.end_ms]));
    recalculateTimelines(manifest, job.projectId);
    if (JSON.stringify((manifest.scenes || []).map((s) => [s.start_ms, s.end_ms])) !== before) {
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }
    syncCaptions(manifest, curPaths.captionsPath, job.projectId);
    job.progress = {
      phase: 'preparing',
      phaseLabel: '⏳ 正在校验镜头时间轴与编译渲染参数…',
      percent: 1,
      startedAt: job.startedAt,
      etaSeconds: null,
      chunks: [],
    };
    const genPropsArgs = [
      'packages/qc-tools/generate-render-props.mjs', '--project', job.projectId,
      job.burnCaptions ? '--burn-captions' : '--no-burn-captions',
    ];
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, genPropsArgs, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk) => appendLog(chunk.toString()));
      child.stderr.on('data', (chunk) => appendLog(chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`生成渲染参数失败，退出码 ${code}`)));
    });
    job.status = 'rendering';
    const output = await renderProject(job.projectId, {
      preview: job.preview,
      concurrency: job.concurrency,
      onOutput: appendLog,
      onProgress: (prog) => {
        job.progress = prog;
      },
    });
    job.status = 'completed';
    job.outputUrl = `/output/${job.projectId}/${path.basename(output)}`;
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

/** 把长篇文案按句末/逗号标点安全拆分为适合 TTS 单次请求的片段 */
export function splitScriptForTts(fullText, maxChars = 75) {
  const cleaned = String(fullText || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const pushHardChunks = (piece, out) => {
    for (let i = 0; i < piece.length; i += maxChars) {
      const sub = piece.slice(i, i + maxChars).trim();
      if (sub) out.push(sub);
    }
  };

  // 先按句末标点切分，遇到过长单句再按逗号二次切分
  const rawSentences = cleaned.split(/(?<=[。！？!?；;\n])/);
  const units = [];
  for (const s of rawSentences) {
    const t = s.trim();
    if (!t) continue;
    if (t.length <= maxChars) {
      units.push(t);
    } else {
      for (const c of t.split(/(?<=[，,、：:])/)) {
        const ct = c.trim();
        if (!ct) continue;
        if (ct.length <= maxChars) units.push(ct);
        else pushHardChunks(ct, units);
      }
    }
  }

  const targetMinChars = Math.min(50, Math.floor(maxChars * 0.68));
  const chunks = [];
  let buf = '';
  for (const u of units) {
    if (!buf) {
      buf = u;
      continue;
    }
    const endsWithSentencePunct = /[。！？!?；;”"’'）)】\]]$/.test(buf);
    if (buf.length + u.length > maxChars) {
      chunks.push(buf);
      buf = u;
    } else if (buf.length >= targetMinChars && endsWithSentencePunct) {
      // 已经达到 50+ 字且刚结束一个完整句子，优先在此处切段，避免单段塞太多句子导致末尾音质劣化
      chunks.push(buf);
      buf = u;
    } else {
      buf += u;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** 成片旁白落盘后：自动对齐逐字时间轴、重算镜头时长与字幕并同步 render-props.json */
export async function finalizeProjectNarration(job, curPaths, wavPath, fullText, signal) {
  const narrationPath = path.join(curPaths.audioDir, 'narration.wav');
  if (path.resolve(wavPath) !== path.resolve(narrationPath)) {
    fs.copyFileSync(wavPath, narrationPath);
  }
  const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
  manifest.audio_file = 'audio/narration.wav';

  job.voiceboxStatus = 'aligning_timing';
  job.progressText = '正在对齐配音逐字时间轴 (Whisper)…';
  try {
    const scriptForAlign = scenesText(manifest.scenes || []) || fullText;
    const timing = await alignNarration({
      audioPath: narrationPath,
      scriptText: scriptForAlign,
      signal,
    });
    fs.writeFileSync(timingPath(curPaths.dataDir), JSON.stringify(timing, null, 2), 'utf8');
    if ((manifest.scenes || []).length >= 2) {
      const scenes = manifest.scenes;
      regroupScenesByKeywords(manifest, timing);
      const plan = planCuts(manifest, timing);
      resliceSceneTexts(scenes, plan.newRanges);
      for (const sp of [...plan.splitSuggestions].sort((a, b) => b.split_char - a.split_char)) {
        splitAtSpokenIndex(scenes, sp.split_char);
      }
      mergeEligibleScenesPass(scenes, timing);
      bridgeThreeSentencesToTwoShotsPass(scenes, timing);
      scenes.forEach((s) => refreshSceneKeywordMetadata(s, s.visual_keywords || []));
    }
    recalculateTimelines(manifest, job.projectId);
    syncTableToManifest(manifest);
    if (timing.warning) job.timingWarning = timing.warning;
  } catch (alignErr) {
    if (signal?.aborted) throw alignErr;
    job.timingWarning = alignErr.message;
    console.warn('[配音时间轴对齐跳过]:', alignErr.message);
  }

  fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  recompileProject(job.projectId);
  const compiledProps = JSON.parse(fs.readFileSync(curPaths.propsPath, 'utf8'));
  if (compiledProps.audio_track?.src !== 'audio/narration.wav') {
    throw new Error('旁白已保存，但渲染参数未同步，请重新保存工程');
  }
  return narrationPath;
}

function formatDurationText(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
}

export async function runVoiceboxJob(job, text) {
  const curPaths = getPaths(job.projectId);
  const fileName = 'voicebox_' + randomUUID() + '.wav';
  const outputPath = path.join(curPaths.audioDir, fileName);
  const controller = new AbortController();
  voiceJobControllers.set(job.projectId, controller);
  let tmpDir = null;
  try {
    fs.mkdirSync(curPaths.audioDir, { recursive: true });
    const chunks = splitScriptForTts(text, 75);
    if (!chunks.length) throw new Error('合成文本不能为空');

    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
    let completedChars = 0;
    const startedAtMs = Date.now();
    const synthCapPct = job.useAsNarration ? 92 : 98;

    job.startedAtMs = startedAtMs;
    job.totalChunks = chunks.length;
    job.completedChunks = 0;
    job.currentChunk = 1;
    job.percent = 0;
    job.elapsedSec = 0;
    job.etaSec = null;

    if (chunks.length > 1) {
      tmpDir = fs.mkdtempSync(path.join(curPaths.audioDir, '.vb-tmp-'));
    }

    const segNames = [];
    let totalDuration = 0;
    let profileName = null;

    const updateProgressFields = (chunkIdx, subStatus) => {
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      job.elapsedSec = Math.round(elapsedMs / 1000);
      job.currentChunk = chunkIdx + 1;
      const inFlightRatio = subStatus === 'loading_model' ? 0.1 : 0.35;
      const effectiveChars = completedChars + (chunks[chunkIdx]?.length || 0) * inFlightRatio;
      job.percent = Math.min(synthCapPct, Math.max(1, Math.round((effectiveChars / totalChars) * synthCapPct)));

      if (completedChars > 0 && elapsedMs > 1000) {
        const msPerChar = elapsedMs / completedChars;
        const remainingChars = Math.max(0, totalChars - completedChars);
        const alignBufferSec = job.useAsNarration ? 6 : 1;
        job.etaSec = Math.max(1, Math.round((remainingChars * msPerChar) / 1000) + alignBufferSec);
      } else {
        job.etaSec = null;
      }

      const segLabel = chunks.length > 1 ? `第 ${chunkIdx + 1}/${chunks.length} 段` : '1/1 段';
      const timeLabel = `已用时 ${formatDurationText(job.elapsedSec)}` + (job.etaSec != null ? ` · 预计剩余 ${formatDurationText(job.etaSec)}` : ' · 正在估算剩余时间…');
      if (subStatus === 'loading_model') {
        job.progressText = `Voicebox 正在加载模型（${segLabel} · ${timeLabel}）`;
      } else {
        job.progressText = `Voicebox 正在生成配音（${segLabel} · ${job.percent}% · ${timeLabel}）`;
      }
    };

    for (let i = 0; i < chunks.length; i++) {
      if (controller.signal.aborted) throw new Error('Voicebox 配音任务已取消');
      job.status = 'generating';
      updateProgressFields(i, 'generating');

      const segName = `seg_${String(i + 1).padStart(3, '0')}.wav`;
      const segOutputPath = chunks.length === 1 ? outputPath : path.join(tmpDir, segName);

      const result = await synthesizeWithVoicebox({
        text: chunks[i],
        profileId: job.profileId || undefined,
        outputPath: segOutputPath,
        maxWaitMs: 60 * 60 * 1000,
        loadingTimeoutMs: 180000,
        signal: controller.signal,
        onProgress: (status, generationId) => {
          job.status = 'generating';
          job.voiceboxStatus = status;
          job.generationId = generationId;
          updateProgressFields(i, status);
        },
      });

      segNames.push(segName);
      totalDuration += Number(result.duration) || 0;
      if (result.profileName) profileName = result.profileName;
      completedChars += chunks[i].length;
      job.completedChunks = i + 1;
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      job.elapsedSec = Math.round(elapsedMs / 1000);
      job.percent = Math.min(synthCapPct, Math.round((completedChars / totalChars) * synthCapPct));
      if (completedChars < totalChars && elapsedMs > 500) {
        const msPerChar = elapsedMs / completedChars;
        const alignBufferSec = job.useAsNarration ? 6 : 1;
        job.etaSec = Math.max(1, Math.round(((totalChars - completedChars) * msPerChar) / 1000) + alignBufferSec);
      } else {
        job.etaSec = job.useAsNarration ? 6 : 1;
      }
    }

    if (chunks.length > 1) {
      job.voiceboxStatus = 'concatenating';
      job.percent = job.useAsNarration ? 93 : 99;
      job.progressText = `正在无缝拼接 ${chunks.length} 段音频…`;
      const listTxt = segNames.map((n) => `file '${n}'`).join('\n');
      fs.writeFileSync(path.join(tmpDir, 'list.txt'), listTxt, 'utf8');
      const ff = spawnSync(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outputPath],
        { cwd: tmpDir, encoding: 'utf8' },
      );
      if (ff.status !== 0) {
        throw new Error(`ffmpeg 拼接 Voicebox 分段音频失败: ${(ff.stderr || '').slice(-400)}`);
      }
      const probedMs = probeDurationMs(outputPath);
      if (probedMs) totalDuration = Number((probedMs / 1000).toFixed(1));
    }

    if (job.useAsNarration) {
      job.percent = 95;
      job.etaSec = 5;
      await finalizeProjectNarration(job, curPaths, outputPath, text, controller.signal);
    }
    job.elapsedSec = Math.round(Math.max(0, Date.now() - startedAtMs) / 1000);
    job.percent = 100;
    job.etaSec = 0;
    job.status = 'completed';
    job.progressText = job.useAsNarration
      ? `全片旁白生成与逐字时间轴已同步（共 ${chunks.length} 段 · 用时 ${formatDurationText(job.elapsedSec)}）`
      : `配音已完成（共 ${chunks.length} 段 · 用时 ${formatDurationText(job.elapsedSec)}）`;
    job.audioUrl = '/public/' + job.projectId + '/audio/' + fileName + '?t=' + Date.now();
    job.duration = Number(totalDuration.toFixed(1)) || null;
    job.profileName = profileName;
  } catch (error) {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = '已手动取消配音任务';
    } else {
      job.status = 'failed';
      job.error = error.message;
    }
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    voiceJobControllers.delete(job.projectId);
    job.finishedAt = new Date().toISOString();
  }
}

/** ElevenLabs 全片旁白分段合成任务：分段拉取 MP3 -> ffmpeg 拼接转成 narration.wav -> 对齐时间轴 */
export async function runElevenlabsFullJob(job, options) {
  return runCloudVoiceJob(job, options);
}
export async function runBailianJob(job, options) {
  return runCloudVoiceJob(job, options);
}
async function runCloudVoiceJob(job, { fullText, voiceId, modelId, stability, similarityBoost, languageCode, apiKey, workspaceId }) {
  const bailian = job.provider === 'bailian';
  const label = bailian ? '阿里云百炼' : 'ElevenLabs';
  const curPaths = getPaths(job.projectId);
  const controller = new AbortController();
  voiceJobControllers.set(job.projectId, controller);
  let tmpDir = null;
  try {
    fs.mkdirSync(curPaths.audioDir, { recursive: true });
    const chunks = splitScriptForTts(fullText, bailian ? 500 : 1200);
    if (!chunks.length) throw new Error('当前工程分镜文案为空，无法生成全片旁白');

    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
    let completedChars = 0;
    const startedAtMs = Date.now();
    job.startedAtMs = startedAtMs;
    job.totalChunks = chunks.length;
    job.completedChunks = 0;
    job.currentChunk = 1;
    job.percent = 0;
    job.elapsedSec = 0;
    job.etaSec = null;

    tmpDir = fs.mkdtempSync(path.join(curPaths.audioDir, '.el-tmp-'));
    const segNames = [];
    for (let i = 0; i < chunks.length; i++) {
      if (controller.signal.aborted) throw new Error('已手动取消配音任务');
      job.status = 'generating';
      job.currentChunk = i + 1;
      const elapsedMs = Math.max(0, Date.now() - startedAtMs);
      job.elapsedSec = Math.round(elapsedMs / 1000);
      job.percent = Math.min(92, Math.max(1, Math.round(((completedChars + chunks[i].length * 0.3) / totalChars) * 92)));
      if (completedChars > 0 && elapsedMs > 500) {
        const msPerChar = elapsedMs / completedChars;
        job.etaSec = Math.max(1, Math.round(((totalChars - completedChars) * msPerChar) / 1000) + 5);
      }
      const timeLabel = `已用时 ${formatDurationText(job.elapsedSec)}` + (job.etaSec != null ? ` · 预计剩余 ${formatDurationText(job.etaSec)}` : '');
      job.progressText = `${label} 正在生成配音（第 ${i + 1}/${chunks.length} 段 · ${job.percent}% · ${timeLabel}）…`;

      const segName = `seg_${String(i + 1).padStart(3, '0')}.${bailian ? 'wav' : 'mp3'}`;
      if (bailian) {
        await synthesizeWithBailian({text:chunks[i], voiceId, modelId, apiKey, workspaceId,
          outputPath:path.join(tmpDir, segName), signal:controller.signal});
      } else {
        const ttsPayload = buildElevenlabsTtsPayload({
          text: chunks[i],
          modelId,
          stability,
          similarityBoost,
          languageCode,
        });

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify(ttsPayload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`ElevenLabs 第 ${i + 1}/${chunks.length} 段合成失败 (${response.status}): ${errText}`);
        }

        const buf = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(path.join(tmpDir, segName), buf);
      }
      segNames.push(segName);
      completedChars += chunks[i].length;
      job.completedChunks = i + 1;
      job.percent = Math.min(92, Math.round((completedChars / totalChars) * 92));
    }

    job.percent = 94;
    job.progressText = '正在拼接音频并转为成片标准 WAV…';
    const narrationPath = path.join(curPaths.audioDir, 'cloud_' + randomUUID() + '.wav');
    let ffmpegArgs;
    if (segNames.length === 1) {
      ffmpegArgs = ['-y', '-i', segNames[0], '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', narrationPath];
    } else {
      const listTxt = segNames.map((n) => `file '${n}'`).join('\n');
      fs.writeFileSync(path.join(tmpDir, 'list.txt'), listTxt, 'utf8');
      ffmpegArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', narrationPath];
    }

    const ff = spawnSync('ffmpeg', ffmpegArgs, { cwd: tmpDir, encoding: 'utf8' });
    if (ff.status !== 0) {
      throw new Error(`ffmpeg 拼接转换旁白失败: ${(ff.stderr || '').slice(-400)}`);
    }

    controller.signal.throwIfAborted();
    if (job.useAsNarration) await finalizeProjectNarration(job, curPaths, narrationPath, fullText, controller.signal);

    job.elapsedSec = Math.round(Math.max(0, Date.now() - startedAtMs) / 1000);
    job.percent = 100;
    job.etaSec = 0;
    job.status = 'completed';
    job.progressText = `${label} 配音已完成${job.useAsNarration ? '并对齐时间轴' : ''}（共 ${chunks.length} 段 · 用时 ${formatDurationText(job.elapsedSec)}）`;
    job.audioUrl = `/public/${job.projectId}/audio/${path.basename(narrationPath)}?t=${Date.now()}`;
    const durMs = probeDurationMs(narrationPath);
    job.duration = durMs ? Number((durMs / 1000).toFixed(1)) : null;
  } catch (error) {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = '已手动取消配音任务';
    } else {
      job.status = 'failed';
      job.error = error.message;
    }
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    voiceJobControllers.delete(job.projectId);
    job.finishedAt = new Date().toISOString();
  }
}
