import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rootDir, getPaths } from './config.mjs';
import { callOpenRouterText } from './llm-gateway.mjs';
import { synthesizeWithVoicebox } from '../../synthesize-voicebox.mjs';
import { buildElevenlabsTtsPayload } from '../../synthesize-elevenlabs.mjs';
import { probeDurationMs } from '../../narration-timing.mjs';
import { renderSrt } from './publish-localization.mjs';

export const englishDubJobs = new Map();
const englishDubControllers = new Map();

const CLOSING_PUNCT_RE = /^[,.;:!?。！？，、；：)\]"'”’]|^n't\b|^'(?:s|re|ve|ll|d|m)\b/i;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]/u;

export function normalizeDubLang(lang) {
  return lang === 'ja' ? 'ja' : 'en';
}

export function dubJobKey(projectId, lang = 'en') {
  const safeLang = normalizeDubLang(lang);
  return safeLang === 'en' ? projectId : `${projectId}:${safeLang}`;
}

function formatSrtTime(ms) {
  const safe = Math.max(0, Math.round(Number(ms) || 0));
  const totalSec = Math.floor(safe / 1000);
  const remMs = safe % 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

function splitUnitsByLimit(unit, limit) {
  const trimmed = unit.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];
  if (!/\s/.test(trimmed)) {
    const out = [];
    for (let i = 0; i < trimmed.length; i += limit) {
      out.push(trimmed.slice(i, i + limit));
    }
    return out;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  const out = [];
  let buf = '';
  for (const w of words) {
    if (w.length > limit) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      for (let i = 0; i < w.length; i += limit) {
        out.push(w.slice(i, i + limit));
      }
      continue;
    }
    const candidate = buf ? `${buf} ${w}` : w;
    if (candidate.length > limit && buf) {
      out.push(buf);
      buf = w;
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 将长外语旁白（英/日）按段落、句末、从句安全拆分为适合 TTS 分段合成的文本块 */
export function splitEnglishTextForTts(fullText, maxChars = 900) {
  const limit = Math.max(80, Number(maxChars) || 900);
  const cleaned = String(fullText || '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= limit) return [cleaned.replace(/\s+/g, ' ')];

  const isMostlyCjk = (cleaned.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length > cleaned.length * 0.25;
  const joiner = isMostlyCjk ? '' : ' ';

  const units = [];
  const paragraphs = cleaned.split(/\n{2,}/);
  for (const para of paragraphs) {
    const p = para.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    if (p.length <= limit) {
      units.push(p);
      continue;
    }
    const sentences = p.split(/(?<=[.!?。！？]["'”’)\]]*)\s*/);
    for (const sent of sentences) {
      const s = sent.trim();
      if (!s) continue;
      if (s.length <= limit) {
        units.push(s);
      } else {
        const clauses = s.split(/(?<=[,;:，、；：])\s*/);
        for (const cl of clauses) {
          const c = cl.trim();
          if (!c) continue;
          if (c.length <= limit) units.push(c);
          else units.push(...splitUnitsByLimit(c, limit));
        }
      }
    }
  }

  const chunks = [];
  let buf = '';
  for (const u of units) {
    const candidate = buf ? `${buf}${joiner}${u}` : u;
    if (buf && candidate.length > limit) {
      chunks.push(buf);
      buf = u;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function joinWhisperWords(wordList) {
  let out = '';
  for (const item of wordList) {
    const token = String(item?.w || '').trim();
    if (!token) continue;
    if (!out) {
      out = token;
      continue;
    }
    const prevLast = out.slice(-1);
    const curFirst = token[0];
    const noSpace =
      CLOSING_PUNCT_RE.test(token) ||
      /^[(\[“"‘'「『（【]$/.test(prevLast) ||
      (CJK_CHAR_RE.test(prevLast) && CJK_CHAR_RE.test(curFirst));
    out += noSpace ? token : ` ${token}`;
  }
  return out;
}

function wrapSubtitleLines(text, maxCharsPerLine = 42, maxLines = 2) {
  const clean = String(text || '').trim();
  if (!clean || maxLines <= 1 || clean.length <= maxCharsPerLine) return clean;

  const spaces = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === ' ') spaces.push(i);
  }

  const mid = clean.length / 2;
  if (spaces.length > 0) {
    let bestFitIdx = -1;
    let bestFitDist = Infinity;
    let bestAnyIdx = spaces[0];
    let bestAnyDist = Math.abs(spaces[0] - mid);

    for (const idx of spaces) {
      const leftLen = idx;
      const rightLen = clean.length - idx - 1;
      const dist = Math.abs(idx - mid);
      if (leftLen <= maxCharsPerLine && rightLen <= maxCharsPerLine && dist < bestFitDist) {
        bestFitDist = dist;
        bestFitIdx = idx;
      }
      if (dist < bestAnyDist) {
        bestAnyDist = dist;
        bestAnyIdx = idx;
      }
    }
    const splitAt = bestFitIdx >= 0 ? bestFitIdx : bestAnyIdx;
    return `${clean.slice(0, splitAt)}\n${clean.slice(splitAt + 1)}`;
  }

  // 无空格文本（如日语）：优先在中间附近的标点断行，否则在中间字符断行
  let bestIdx = Math.min(maxCharsPerLine, Math.floor(mid));
  let bestDist = Infinity;
  for (let i = 1; i < clean.length - 1; i++) {
    if (/[、，。！？,.;:!?]/.test(clean[i])) {
      const leftLen = i + 1;
      const rightLen = clean.length - leftLen;
      const dist = Math.abs(leftLen - mid);
      if (leftLen <= maxCharsPerLine && rightLen <= maxCharsPerLine && dist < bestDist) {
        bestDist = dist;
        bestIdx = leftLen;
      }
    }
  }
  return `${clean.slice(0, bestIdx)}\n${clean.slice(bestIdx)}`;
}

/** 将 Whisper 输出的逐词时间戳组装为标准无重叠 SRT 字符串（支持 en / ja） */
export function buildEnglishSrtFromWords(words, options = {}) {
  const isJa = options.lang === 'ja';
  const defaultMaxChars = isJa ? 26 : 42;
  const maxCharsPerLine = Math.max(14, Number(options.maxCharsPerLine) || defaultMaxChars);
  const maxLines = Math.max(1, Number(options.maxLines) || 2);
  const maxCueChars = maxCharsPerLine * maxLines;
  const maxCueSec = Number(options.maxCueSec) || 5.5;
  const pauseBreakSec = Number(options.pauseBreakSec) || 0.45;
  const minSentenceChars = isJa ? 10 : 18;

  const valid = (Array.isArray(words) ? words : [])
    .map((item) => ({
      w: String(item?.w || '').trim(),
      s: Number(item?.s),
      e: Number(item?.e),
    }))
    .filter((item) => item.w && Number.isFinite(item.s) && Number.isFinite(item.e) && item.e >= item.s);

  if (!valid.length) return '';

  const groups = [];
  let cueWords = [];

  for (const word of valid) {
    if (cueWords.length > 0) {
      const prev = cueWords[cueWords.length - 1];
      const currentText = joinWhisperWords(cueWords);
      const candidateText = joinWhisperWords([...cueWords, word]);
      const gap = word.s - prev.e;
      const endsSentence = /[.?!。！？]["'”’)\]]*$/.test(prev.w) && (cueWords.length >= 3 || currentText.length >= minSentenceChars);
      const exceedsChars = candidateText.length > maxCueChars;
      const exceedsDuration = word.e - cueWords[0].s >= maxCueSec;

      if (gap >= pauseBreakSec || endsSentence || exceedsChars || exceedsDuration) {
        groups.push(cueWords);
        cueWords = [];
      }
    }
    cueWords.push(word);
  }
  if (cueWords.length > 0) groups.push(cueWords);

  const cues = groups.map((group) => {
    const start = Math.max(0, Math.round(group[0].s * 1000));
    const end = Math.max(start + 200, Math.round(group[group.length - 1].e * 1000));
    const text = wrapSubtitleLines(joinWhisperWords(group), maxCharsPerLine, maxLines);
    return { start, end, text };
  }).filter((cue) => cue.text);

  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1];
    const cur = cues[i];
    if (cur.start < prev.end) {
      prev.end = Math.max(prev.start + 100, cur.start);
      if (cur.start < prev.end) {
        cur.start = prev.end;
        cur.end = Math.max(cur.start + 150, cur.end);
      }
    }
  }

  return renderSrt(cues.map((c, idx) => ({
    index: String(idx + 1),
    time: `${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}`,
    text: c.text,
  })));
}

/** 调用本地 MLX Whisper 对外语音频提取逐词时间戳 */
export async function runWhisperEnglishWords(audioPath, { lang = 'en', promptFile, signal } = {}) {
  const safeLang = normalizeDubLang(lang);
  const venvPy = path.join(rootDir, '.venv-align', 'bin', 'python');
  const alignPy = path.join(rootDir, 'packages/qc-tools/align_whisper.py');
  if (!fs.existsSync(venvPy)) {
    throw new Error('未找到本地 Whisper 环境 (.venv-align)，请先安装对齐依赖。');
  }
  const args = [alignPy, audioPath, '--language', safeLang];
  if (promptFile && fs.existsSync(promptFile)) {
    args.push('--prompt-file', promptFile);
  }

  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('已手动取消外语配音任务'));
    }
    const child = spawn(venvPy, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`启动本地 Whisper 失败: ${err.message}`));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        return reject(new Error('已手动取消外语配音任务'));
      }
      if (code !== 0) {
        return reject(new Error(`本地 Whisper 提取字幕失败 (exit ${code}): ${(stderr || stdout).slice(-300)}`));
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const parsed = JSON.parse(lines[lines.length - 1] || '{}');
        if (!parsed.ok || !Array.isArray(parsed.words)) {
          return reject(new Error(parsed.error || '本地 Whisper 未返回有效词时间戳'));
        }
        resolve(parsed.words);
      } catch (err) {
        reject(new Error(`解析 Whisper 输出失败: ${err.message}`));
      }
    });
  });
}

function statNonEmptyFile(filePath) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  return stat?.isFile() && stat.size > 0 ? stat : null;
}

/** 读取工程已生成的外语配音稿、音频及同步 SRT 资产（默认 en，支持 ja） */
export function getEnglishDubArtifacts(projectId, customPaths = null, lang = 'en') {
  const safeLang = normalizeDubLang(lang);
  const paths = customPaths || getPaths(projectId);
  const scriptFileName = safeLang === 'en' ? 'english-dub-script.txt' : `dub-script.${safeLang}.txt`;
  const scriptPath = path.join(paths.dataDir, scriptFileName);
  const mp3Path = path.join(paths.outputDir, `${projectId}_${safeLang}.mp3`);
  const wavPath = path.join(paths.outputDir, `${projectId}_${safeLang}.wav`);
  const srtPath = path.join(paths.outputDir, `${projectId}_${safeLang}.srt`);

  let scriptText = '';
  if (fs.existsSync(scriptPath)) {
    try { scriptText = fs.readFileSync(scriptPath, 'utf8'); } catch {}
  }

  let audioUrl = null;
  let audioFileName = null;
  let durationSec = null;
  const mp3Stat = statNonEmptyFile(mp3Path);
  const wavStat = statNonEmptyFile(wavPath);
  const chosenAudio = mp3Stat
    ? { path: mp3Path, stat: mp3Stat, name: `${projectId}_${safeLang}.mp3` }
    : (wavStat ? { path: wavPath, stat: wavStat, name: `${projectId}_${safeLang}.wav` } : null);

  if (chosenAudio) {
    audioFileName = chosenAudio.name;
    audioUrl = `/output/${encodeURIComponent(projectId)}/${encodeURIComponent(chosenAudio.name)}?t=${Math.round(chosenAudio.stat.mtimeMs)}`;
    const durMs = probeDurationMs(chosenAudio.path);
    if (durMs) durationSec = Number((durMs / 1000).toFixed(1));
  }

  let srtText = '';
  let srtFileName = null;
  let srtUrl = null;
  const srtStat = statNonEmptyFile(srtPath);
  if (srtStat) {
    try {
      srtText = fs.readFileSync(srtPath, 'utf8');
      srtFileName = `${projectId}_${safeLang}.srt`;
      srtUrl = `/output/${encodeURIComponent(projectId)}/${encodeURIComponent(srtFileName)}?t=${Math.round(srtStat.mtimeMs)}`;
    } catch {}
  }

  return {
    lang: safeLang,
    scriptText,
    audioUrl,
    audioFileName,
    srtText,
    srtFileName,
    srtUrl,
    durationSec,
  };
}

export function cancelEnglishDubJob(projectId, lang = 'en') {
  const key = dubJobKey(projectId, lang);
  const controller = englishDubControllers.get(key);
  const job = englishDubJobs.get(key);
  if (controller) {
    controller.abort();
    return true;
  }
  if (job && ['preparing', 'translating', 'generating', 'transcribing'].includes(job.status)) {
    job.status = 'cancelled';
    job.error = '已手动取消配音任务';
    job.finishedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/** 从工程文案终稿或分镜清单中提取中文旁白文本 */
export function extractChineseSourceNarration(paths) {
  if (paths?.finalScriptPath && fs.existsSync(paths.finalScriptPath)) {
    try {
      const raw = fs.readFileSync(paths.finalScriptPath, 'utf8').trim();
      if (raw.startsWith('{') || raw.startsWith('[')) {
        const obj = JSON.parse(raw);
        const parts = [];
        if (typeof obj.opening === 'string' && obj.opening.trim()) parts.push(obj.opening.trim());
        if (Array.isArray(obj.chapters)) {
          for (const ch of obj.chapters) {
            const text = ch?.narration || ch?.content || ch?.text || '';
            if (typeof text === 'string' && text.trim()) parts.push(text.trim());
          }
        }
        if (typeof obj.ending === 'string' && obj.ending.trim()) parts.push(obj.ending.trim());
        if (parts.length > 0) return parts.join('\n\n');
        if (typeof obj.full_text === 'string' && obj.full_text.trim()) return obj.full_text.trim();
      }
      if (raw && raw !== '{}' && raw !== '[]') return raw;
    } catch {}
  }
  const manifestPath = paths?.manifestPath || (paths?.dataDir ? path.join(paths.dataDir, 'scene-manifest.json') : '');
  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const texts = (mf.scenes || []).map((s) => String(s?.narration_text || '').trim()).filter(Boolean);
      if (texts.length > 0) return texts.join('\n');
    } catch {}
  }
  return '';
}

/** 使用配置的文本大模型将中文旁白稿翻译为自然流畅的外语口播稿（en / ja） */
export async function translateChineseNarration(paths, targetLang, { signal, onProgress } = {}) {
  const safeLang = normalizeDubLang(targetLang);
  const langName = safeLang === 'ja' ? '日语 (日本語)' : '英语 (English)';
  const sourceText = extractChineseSourceNarration(paths);
  if (!sourceText) {
    throw new Error('当前工程尚无中文文案终稿或分镜旁白，无法自动翻译；请先完成文案或在下方折叠区手动粘贴外语稿。');
  }

  let cfg = {};
  if (paths?.promptConfigPath && fs.existsSync(paths.promptConfigPath)) {
    try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
  }
  const llmOptions = {
    model: cfg.translateModel || cfg.textModel || cfg.writerModel,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    maxTokens: 4096,
  };

  const chunks = [];
  let buf = '';
  for (const para of sourceText.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (buf && (buf.length + p.length) > 3200) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);

  const translatedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error('已手动取消翻译任务');
    onProgress?.(i + 1, chunks.length);
    const sys = `你是一位资深科普纪录片旁白译者。请将以下中文视频旁白地道地翻译为自然流畅、适合口播朗读的${langName}旁白稿。要求：1. 保留所有事实、数字与专有名词准确性；2. 只输出纯口播正文段落，严禁添加任何章节标题、Markdown 符号、括号备注或解释说明。`;
    const out = await callOpenRouterText(sys, chunks[i], llmOptions);
    if (!out) throw new Error(globalThis.__lastWriterLlmError || `第 ${i + 1} 段旁白翻译失败`);
    translatedChunks.push(out.trim());
  }

  const scriptText = translatedChunks.join('\n\n').trim();
  if (!scriptText) throw new Error('大模型返回的外语旁白稿为空');
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const scriptFileName = safeLang === 'en' ? 'english-dub-script.txt' : `dub-script.${safeLang}.txt`;
  fs.writeFileSync(path.join(paths.dataDir, scriptFileName), scriptText, 'utf8');
  return scriptText;
}

/** 后台执行：自动翻译中文旁白（可选） -> 外语配音合成（en / ja） -> 本地 Whisper 同步生成 SRT */
export async function runEnglishDubJob(job, {
  lang = 'en',
  text = '',
  autoTranslate = false,
  engine = 'voicebox',
  profileId = '',
  voiceId = '',
  modelId = 'eleven_v4',
  apiKey = '',
  paths: customPaths = null,
} = {}) {
  const safeLang = normalizeDubLang(lang || job.lang);
  const langLabel = safeLang === 'ja' ? '日语' : '英语';
  const key = dubJobKey(job.projectId, safeLang);
  const paths = customPaths || getPaths(job.projectId);
  const controller = new AbortController();
  englishDubControllers.set(key, controller);
  let tmpDir = null;

  try {
    let cleanText = String(text || '').trim();
    if (!cleanText || autoTranslate) {
      job.status = 'translating';
      job.progressText = `正在用大模型将中文终稿翻译为${langLabel}旁白稿…`;
      cleanText = await translateChineseNarration(paths, safeLang, {
        signal: controller.signal,
        onProgress: (idx, total) => {
          job.status = 'translating';
          job.progressText = `正在用大模型翻译${langLabel}旁白稿（第 ${idx}/${total} 段）…`;
        },
      });
      job.scriptText = cleanText;
    }
    if (!cleanText) throw new Error(`${langLabel}旁白稿不能为空`);

    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.outputDir, { recursive: true });
    const scriptFileName = safeLang === 'en' ? 'english-dub-script.txt' : `dub-script.${safeLang}.txt`;
    fs.writeFileSync(path.join(paths.dataDir, scriptFileName), cleanText, 'utf8');

    tmpDir = fs.mkdtempSync(path.join(paths.outputDir, `.${safeLang}-dub-`));
    const segNames = [];

    if (engine === 'voicebox') {
      const chunks = splitEnglishTextForTts(cleanText, safeLang === 'ja' ? 500 : 900);
      if (!chunks.length) throw new Error(`${langLabel}旁白稿拆分结果为空`);
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) throw new Error(`已手动取消${langLabel}配音任务`);
        job.status = 'generating';
        job.progressText = `本地 Voicebox 正在生成${langLabel}音频（第 ${i + 1}/${chunks.length} 段）…`;
        const segName = `seg_${String(i + 1).padStart(3, '0')}.wav`;
        await synthesizeWithVoicebox({
          text: chunks[i],
          profileId: profileId || undefined,
          language: safeLang,
          outputPath: path.join(tmpDir, segName),
          maxWaitMs: 60 * 60 * 1000,
          loadingTimeoutMs: 180000,
          signal: controller.signal,
          onProgress: (status) => {
            job.status = 'generating';
            job.progressText = status === 'loading_model'
              ? `Voicebox 正在加载模型（第 ${i + 1}/${chunks.length} 段）…`
              : `Voicebox 正在生成${langLabel}音频（第 ${i + 1}/${chunks.length} 段 · ${status}）…`;
          },
        });
        segNames.push(segName);
      }
    } else if (engine === 'elevenlabs') {
      const effectiveKey = String(apiKey || '').trim() || process.env.ELEVENLABS_API_KEY;
      if (!effectiveKey) {
        throw new Error('未配置 ELEVENLABS_API_KEY，无法使用 ElevenLabs 合成。');
      }
      const chunks = splitEnglishTextForTts(cleanText, 1000);
      if (!chunks.length) throw new Error(`${langLabel}旁白稿拆分结果为空`);
      const effectiveVoiceId = String(voiceId || '').trim() || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) throw new Error(`已手动取消${langLabel}配音任务`);
        job.status = 'generating';
        job.progressText = `ElevenLabs 正在生成${langLabel}音频（第 ${i + 1}/${chunks.length} 段）…`;
        const payload = buildElevenlabsTtsPayload({
          text: chunks[i],
          modelId: modelId || 'eleven_v4',
          languageCode: safeLang,
        });
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(effectiveVoiceId)}`, {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': effectiveKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`ElevenLabs 第 ${i + 1}/${chunks.length} 段合成失败 (${response.status}): ${errText}`);
        }
        const segName = `seg_${String(i + 1).padStart(3, '0')}.mp3`;
        fs.writeFileSync(path.join(tmpDir, segName), Buffer.from(await response.arrayBuffer()));
        segNames.push(segName);
      }
    } else {
      throw new Error(`不支持的配音引擎：${engine}`);
    }

    if (controller.signal.aborted) throw new Error(`已手动取消${langLabel}配音任务`);
    job.progressText = `正在拼接并导出${langLabel}音频 (.mp3)…`;
    const finalAudioName = `${job.projectId}_${safeLang}.mp3`;
    const finalAudioPath = path.join(paths.outputDir, finalAudioName);
    const tempAudioPath = path.join(paths.outputDir, `.${job.projectId}_${safeLang}.${randomUUID()}.mp3`);

    let ffmpegArgs;
    if (segNames.length === 1) {
      ffmpegArgs = ['-y', '-i', segNames[0], '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '192k', tempAudioPath];
    } else {
      const listTxt = segNames.map((name) => `file '${name}'`).join('\n');
      fs.writeFileSync(path.join(tmpDir, 'list.txt'), listTxt, 'utf8');
      ffmpegArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '192k', tempAudioPath];
    }
    const ff = spawnSync('ffmpeg', ffmpegArgs, { cwd: tmpDir, encoding: 'utf8' });
    if (ff.status !== 0 || !fs.existsSync(tempAudioPath)) {
      if (fs.existsSync(tempAudioPath)) {
        try { fs.unlinkSync(tempAudioPath); } catch {}
      }
      throw new Error(`ffmpeg 拼接导出${langLabel}音频失败: ${(ff.stderr || '').slice(-400)}`);
    }
    fs.renameSync(tempAudioPath, finalAudioPath);

    job.status = 'transcribing';
    job.progressText = `正在用本地 Whisper 生成同步${langLabel}字幕 (SRT)…`;
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, cleanText.slice(0, 500), 'utf8');

    const words = await runWhisperEnglishWords(finalAudioPath, {
      lang: safeLang,
      promptFile,
      signal: controller.signal,
    });
    const srtText = buildEnglishSrtFromWords(words, { lang: safeLang });
    if (!srtText.trim()) {
      throw new Error(`本地 Whisper 未识别到有效${langLabel}语音内容。`);
    }

    const finalSrtName = `${job.projectId}_${safeLang}.srt`;
    const finalSrtPath = path.join(paths.outputDir, finalSrtName);
    const tempSrtPath = path.join(paths.outputDir, `.${job.projectId}_${safeLang}.${randomUUID()}.srt`);
    fs.writeFileSync(tempSrtPath, srtText, 'utf8');
    fs.renameSync(tempSrtPath, finalSrtPath);

    const durMs = probeDurationMs(finalAudioPath);
    job.status = 'completed';
    job.progressText = `${langLabel}音频与同步${langLabel}字幕已全部生成`;
    job.audioFileName = finalAudioName;
    job.audioUrl = `/output/${encodeURIComponent(job.projectId)}/${encodeURIComponent(finalAudioName)}?t=${Date.now()}`;
    job.srtFileName = finalSrtName;
    job.srtUrl = `/output/${encodeURIComponent(job.projectId)}/${encodeURIComponent(finalSrtName)}?t=${Date.now()}`;
    job.srtText = srtText;
    job.durationSec = durMs ? Number((durMs / 1000).toFixed(1)) : null;
  } catch (error) {
    if (controller.signal.aborted) {
      job.status = 'cancelled';
      job.error = `已手动取消${langLabel}配音任务`;
    } else {
      job.status = 'failed';
      job.error = error.message;
    }
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
    englishDubControllers.delete(key);
    job.finishedAt = new Date().toISOString();
  }
}
