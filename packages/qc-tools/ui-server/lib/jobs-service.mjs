import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import { rootDir, getPaths, voiceJobControllers } from './config.mjs';
import { syncCaptions, recalculateTimelines, syncTableToManifest, recompileProject } from './project-store.mjs';
import { renderProject } from '../../render-project.mjs';
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
export function splitScriptForTts(fullText, maxChars = 1200) {
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

  const chunks = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + u.length > maxChars) {
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

export async function runVoiceboxJob(job, text) {
  const curPaths = getPaths(job.projectId);
  const fileName = 'voicebox_' + randomUUID() + '.wav';
  const outputPath = path.join(curPaths.audioDir, fileName);
  const controller = new AbortController();
  voiceJobControllers.set(job.projectId, controller);
  try {
    fs.mkdirSync(curPaths.audioDir, { recursive: true });
    const result = await synthesizeWithVoicebox({
      text,
      profileId: job.profileId || undefined,
      outputPath,
      maxWaitMs: 2 * 60 * 60 * 1000,
      loadingTimeoutMs: 180000,
      signal: controller.signal,
      onProgress: (status, generationId) => {
        job.status = 'generating';
        job.voiceboxStatus = status;
        job.generationId = generationId;
        job.progressText = status === 'loading_model'
          ? 'Voicebox 正在加载模型 (loading_model)…'
          : `Voicebox 正在生成音频 (${status})…`;
      },
    });
    if (job.useAsNarration) {
      await finalizeProjectNarration(job, curPaths, outputPath, text, controller.signal);
    }
    job.status = 'completed';
    job.progressText = job.useAsNarration ? '全片旁白生成与逐字时间轴已同步' : '配音已完成';
    job.audioUrl = '/public/' + job.projectId + '/audio/' + fileName + '?t=' + Date.now();
    job.duration = result.duration;
    job.profileName = result.profileName;
  } catch (error) {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = '已手动取消配音任务';
    } else {
      job.status = 'failed';
      job.error = error.message;
    }
  } finally {
    voiceJobControllers.delete(job.projectId);
    job.finishedAt = new Date().toISOString();
  }
}

/** ElevenLabs 全片旁白分段合成任务：分段拉取 MP3 -> ffmpeg 拼接转成 narration.wav -> 对齐时间轴 */
export async function runElevenlabsFullJob(job, { fullText, voiceId, modelId, stability, similarityBoost, languageCode, apiKey }) {
  const curPaths = getPaths(job.projectId);
  const controller = new AbortController();
  voiceJobControllers.set(job.projectId, controller);
  let tmpDir = null;
  try {
    fs.mkdirSync(curPaths.audioDir, { recursive: true });
    const chunks = splitScriptForTts(fullText, 1200);
    if (!chunks.length) throw new Error('当前工程分镜文案为空，无法生成全片旁白');

    tmpDir = fs.mkdtempSync(path.join(curPaths.audioDir, '.el-tmp-'));
    const segNames = [];
    for (let i = 0; i < chunks.length; i++) {
      if (controller.signal.aborted) throw new Error('已手动取消配音任务');
      job.status = 'generating';
      job.progressText = `ElevenLabs 正在生成全片旁白（第 ${i + 1}/${chunks.length} 段）…`;

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
      const segName = `seg_${String(i + 1).padStart(3, '0')}.mp3`;
      fs.writeFileSync(path.join(tmpDir, segName), buf);
      segNames.push(segName);
    }

    job.progressText = '正在拼接音频并转为成片标准 WAV…';
    const narrationPath = path.join(curPaths.audioDir, 'narration.wav');
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

    await finalizeProjectNarration(job, curPaths, narrationPath, fullText, controller.signal);

    job.status = 'completed';
    job.progressText = `ElevenLabs 全片旁白已生成并对齐时间轴（共 ${chunks.length} 段）`;
    job.audioUrl = `/public/${job.projectId}/audio/narration.wav?t=${Date.now()}`;
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
