/**
 * 旁白逐字时间轴 (Narration Timing)
 *
 * 作用：先有配音音频，再算出"文案里每个字在音频第几毫秒说出"。
 * 之后画面切换、字幕全部以这份时间轴为准，不再按字数估算。
 *
 * 两种对齐方式（自动选择）：
 *   1. whisper  —— 本地 mlx-whisper 听写出逐词时间，再和文案逐字对齐（精确，推荐）
 *   2. pauses   —— 没装 whisper 时，用 ffmpeg 检测停顿，把停顿对应到标点，再在两个停顿之间按字均分（够用的兜底）
 *
 * 产物：projects/<id>/data/narration-timing.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ALIGN_PY = path.join(__dirname, 'align_whisper.py');
const VENV_PY = path.join(ROOT_DIR, '.venv-align', 'bin', 'python');

export const TIMING_VERSION = 1;
export const TIMING_FILE = 'narration-timing.json';

/* ------------------------------------------------------------------ */
/* 文本工具                                                            */
/* ------------------------------------------------------------------ */

// 不发音的字符：空白和标点
const NON_SPOKEN_RE = /[\s\u3000，,。．.！!？?；;：:、“”"‘’'`（）()《》<>〈〉【】\[\]{}…—–\-·~～|/\\*#_=+@^]/;
const SENTENCE_END_RE = /[。！？!?；;…]/;
const CLAUSE_END_RE = /[，,、：:]/;

export function isSpoken(ch) {
  return !!ch && !NON_SPOKEN_RE.test(ch);
}

function normChar(ch) {
  let c = ch;
  const code = c.charCodeAt(0);
  // 全角 ASCII -> 半角
  if (code >= 0xff01 && code <= 0xff5e) c = String.fromCharCode(code - 0xfee0);
  return c.toLowerCase();
}

// 常见繁简差异（Whisper 偶尔输出繁体，提升匹配率；没匹配上的字也会被插值，不影响正确性）
const T2S = {
  '們': '们', '這': '这', '個': '个', '來': '来', '時': '时', '為': '为', '麼': '么', '說': '说', '會': '会',
  '國': '国', '於': '于', '後': '后', '過': '过', '還': '还', '對': '对', '樣': '样', '電': '电', '車': '车',
  '準': '准', '線': '线', '開': '开', '發': '发', '經': '经', '濟': '济', '學': '学', '實': '实', '現': '现',
  '問': '问', '題': '题', '讓': '让', '從': '从', '東': '东', '長': '长', '門': '门', '間': '间', '見': '见',
  '點': '点', '幾': '几', '歲': '岁', '萬': '万', '億': '亿', '與': '与', '裡': '里', '裏': '里', '邊': '边',
  '頭': '头', '機': '机', '關': '关', '係': '系', '團': '团', '黨': '党', '選': '选', '舉': '举', '戰': '战',
  '爭': '争', '軍': '军', '術': '术', '產': '产', '業': '业', '價': '价', '錢': '钱', '貨': '货', '員': '员',
  '書': '书', '寫': '写', '討': '讨', '檢': '检', '嚴': '严', '格': '格', '制': '制', '度': '度', '習': '习',
  '慣': '惯', '鐘': '钟', '鍾': '钟', '從': '从', '並': '并', '條': '条', '區': '区', '將': '将', '帶': '带',
  '號': '号', '島': '岛', '術': '术', '歷': '历', '史': '史', '傳': '传', '統': '统', '環': '环', '境': '境',
};

function matchKey(ch) {
  const c = normChar(ch);
  return T2S[c] || c;
}

/** 文案 -> 只保留发音字符的序列，并记住每个发音字在原文中的位置 */
export function spokenIndex(text) {
  const chars = [];
  const pos = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isSpoken(ch)) {
      chars.push(ch);
      pos.push(i);
    }
  }
  return { chars, pos };
}

/* ------------------------------------------------------------------ */
/* 带状编辑距离对齐：把序列 B 的每个元素映射到序列 A 的下标（或 -1）    */
/* ------------------------------------------------------------------ */

export function alignSequences(a, b, { band = 0 } = {}) {
  const n = a.length;
  const m = b.length;
  const map = new Int32Array(m).fill(-1);
  if (!n || !m) return map;

  const ak = a.map(matchKey);
  const bk = b.map(matchKey);
  const W = band || Math.max(200, Math.abs(n - m) + 200);
  const width = 2 * W + 1;
  const INF = 1e9;
  // dp 按行滚动，回溯矩阵按带存储
  const back = new Uint8Array((m + 1) * width); // 0=diag,1=up(跳过b),2=left(跳过a)
  let prev = new Float64Array(width).fill(INF);
  let cur = new Float64Array(width).fill(INF);
  const center = (j) => Math.round((j * n) / m);

  // 行 j=0
  {
    const c0 = center(0);
    for (let k = 0; k < width; k++) {
      const i = c0 - W + k;
      if (i >= 0 && i <= n) {
        prev[k] = i; // 跳过 a 的前 i 个
        back[k] = 2;
      }
    }
  }
  for (let j = 1; j <= m; j++) {
    cur.fill(INF);
    const cj = center(j);
    const cp = center(j - 1);
    for (let k = 0; k < width; k++) {
      const i = cj - W + k;
      if (i < 0 || i > n) continue;
      let best = INF;
      let dir = 1;
      // up: (i, j-1) -> 跳过 b[j-1]
      const kUp = i - (cp - W);
      if (kUp >= 0 && kUp < width && prev[kUp] + 1 < best) { best = prev[kUp] + 1; dir = 1; }
      if (i > 0) {
        // diag: (i-1, j-1)
        const kd = i - 1 - (cp - W);
        if (kd >= 0 && kd < width) {
          const cost = prev[kd] + (ak[i - 1] === bk[j - 1] ? 0 : 1);
          if (cost < best || (cost === best && dir !== 0)) { best = cost; dir = 0; }
        }
        // left: (i-1, j) -> 跳过 a[i-1]
        const kl = k - 1;
        if (kl >= 0 && cur[kl] + 1 < best) { best = cur[kl] + 1; dir = 2; }
      }
      cur[k] = best;
      back[j * width + k] = dir;
    }
    const t = prev; prev = cur; cur = t;
  }

  // 回溯
  let j = m;
  let i = n;
  while (j > 0 && i >= 0) {
    const k = i - (center(j) - W);
    if (k < 0 || k >= width) break;
    const dir = back[j * width + k];
    if (dir === 0) {
      if (ak[i - 1] === bk[j - 1]) map[j - 1] = i - 1;
      else map[j - 1] = -2 - (i - 1); // 替换：位置对得上但字不同，记为"弱匹配"
      i--; j--;
    } else if (dir === 1) {
      j--;
    } else {
      i--;
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 音频工具                                                            */
/* ------------------------------------------------------------------ */

export function probeDurationMs(audioPath) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath], { encoding: 'utf8' });
  const sec = parseFloat((r.stdout || '').trim());
  return Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
}

/** ffmpeg 检测停顿（静音段），返回 [[startMs, endMs], ...] */
export function detectPauses(audioPath, { noiseDb = -38, minSec = 0.12 } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', audioPath, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = r.stderr || '';
  const pauses = [];
  let start = null;
  for (const line of log.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { start = Math.max(0, parseFloat(s[1])); continue; }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== null) {
      pauses.push([Math.round(start * 1000), Math.round(parseFloat(e[1]) * 1000)]);
      start = null;
    }
  }
  if (start !== null) pauses.push([Math.round(start * 1000), probeDurationMs(audioPath)]);
  return pauses;
}

export function whisperAvailable() {
  if (!fs.existsSync(VENV_PY)) return false;
  const r = spawnSync(VENV_PY, ['-c', 'import mlx_whisper'], { encoding: 'utf8' });
  return r.status === 0;
}

function runWhisper(audioPath, scriptText, { signal, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const promptFile = path.join(os.tmpdir(), `whyvideo-align-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, scriptText, 'utf8');
    const child = spawn(VENV_PY, [ALIGN_PY, audioPath, '--prompt-file', promptFile], { cwd: ROOT_DIR });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); onLog?.(d.toString()); });
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener?.('abort', abort);
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener?.('abort', abort);
      try { fs.unlinkSync(promptFile); } catch (e) {}
      if (signal?.aborted) return reject(new Error('对齐任务已取消'));
      try {
        const lastLine = out.trim().split('\n').pop();
        const data = JSON.parse(lastLine);
        if (!data.ok) return reject(new Error(data.error || 'whisper 失败'));
        resolve(data);
      } catch (e) {
        reject(new Error(`whisper 输出解析失败 (code ${code}): ${err.slice(-500)}`));
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* 对齐主流程                                                          */
/* ------------------------------------------------------------------ */

/** 把落在停顿里的字边界推到停顿外面（Whisper 常把词头放进前面的静音里） */
function snapToPauses(times, pauses) {
  if (!pauses.length) return;
  let p = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    while (p < pauses.length && pauses[p][1] <= t[0]) p++;
    // 起点落在某个停顿内部 -> 推到停顿结束
    if (p < pauses.length && t[0] >= pauses[p][0] && t[0] < pauses[p][1]) {
      const pe = pauses[p][1];
      if (pe < t[1]) t[0] = pe;
    }
    // 终点落在停顿内部 -> 拉回停顿开始
    for (let q = Math.max(0, p - 1); q < Math.min(pauses.length, p + 2); q++) {
      const [ps, pe] = pauses[q];
      if (t[1] > ps && t[1] <= pe && ps > t[0]) t[1] = ps;
    }
  }
}

/** 根据少量"锚点"（已知时间的字）线性插值出所有字的时间 */
function interpolate(n, anchors, totalMs) {
  // anchors: [{i, s, e}] 按 i 升序
  const times = new Array(n);
  const pts = [{ i: -1, s: 0, e: 0 }, ...anchors, { i: n, s: totalMs, e: totalMs }];
  for (let a = 0; a < pts.length - 1; a++) {
    const L = pts[a];
    const R = pts[a + 1];
    if (L.i >= 0 && L.i < n) times[L.i] = [L.s, L.e];
    const gap = R.i - L.i - 1;
    if (gap <= 0) continue;
    const t0 = L.i >= 0 ? L.e : L.s;
    const t1 = R.s;
    const step = Math.max(0, t1 - t0) / gap;
    for (let k = 1; k <= gap; k++) {
      const s = t0 + step * (k - 1);
      times[L.i + k] = [Math.round(s), Math.round(s + step)];
    }
  }
  return times;
}

function alignWithWhisperWords(spoken, words, pauses, totalMs) {
  // ASR 词 -> 逐字（词内均分时间）
  const asrChars = [];
  const asrTimes = [];
  for (const w of words) {
    const cs = Array.from(w.w).filter(isSpoken);
    if (!cs.length) continue;
    const s = w.s * 1000;
    const e = Math.max(w.e * 1000, s + 1);
    const step = (e - s) / cs.length;
    cs.forEach((c, k) => {
      asrChars.push(c);
      asrTimes.push([Math.round(s + step * k), Math.round(s + step * (k + 1))]);
    });
  }
  // map[j] = 文案第 j 个发音字 对应的 ASR 字下标
  const map = alignSequences(asrChars, spoken);
  const anchors = [];
  let matched = 0;
  for (let j = 0; j < spoken.length; j++) {
    const v = map[j];
    if (v >= 0) {
      matched++;
      anchors.push({ i: j, s: asrTimes[v][0], e: asrTimes[v][1] });
    } else if (v <= -2) {
      const idx = -2 - v;
      anchors.push({ i: j, s: asrTimes[idx][0], e: asrTimes[idx][1], weak: true });
    }
  }
  // 保证单调
  let last = 0;
  const mono = [];
  for (const a of anchors) {
    if (a.s >= last) { mono.push(a); last = a.e; }
  }
  const times = interpolate(spoken.length, mono, totalMs);
  snapToPauses(times, pauses);
  return { times, matchRate: spoken.length ? matched / spoken.length : 0 };
}

/**
 * 兜底：停顿 <-> 标点 对齐。
 * 把"停顿发生时已说了多少秒" 和 "标点前已有多少字(折算成秒)" 两个序列做单调 DP 匹配，
 * 匹配上的停顿就是锚点，两个锚点之间按字均分。
 */
function alignWithPauses(text, spoken, spokenPos, pauses, totalMs) {
  const n = spoken.length;
  // 去掉首尾静音
  const inner = pauses.filter(([s, e]) => s > 50 && e < totalMs - 50);
  const leadIn = pauses.find(([s]) => s <= 50)?.[1] || 0;
  const tailStart = pauses.find(([, e]) => e >= totalMs - 50)?.[0] || totalMs;
  const pauseTotal = inner.reduce((acc, [s, e]) => acc + (e - s), 0);
  const speechMs = Math.max(1, tailStart - leadIn - pauseTotal);
  const msPerChar = speechMs / Math.max(1, n);

  // 每个停顿发生前的累计"说话时长"
  const sp = [];
  let acc = 0;
  let cursor = leadIn;
  for (const [s, e] of inner) {
    acc += s - cursor;
    sp.push({ speechBefore: acc, s, e });
    cursor = e;
  }
  // 标点边界：在第 j 个发音字之后
  const bounds = [];
  for (let j = 0; j < n - 1; j++) {
    const between = text.slice(spokenPos[j] + 1, spokenPos[j + 1]);
    if (SENTENCE_END_RE.test(between)) bounds.push({ after: j, strong: true });
    else if (CLAUSE_END_RE.test(between)) bounds.push({ after: j, strong: false });
  }
  const P = sp.length;
  const B = bounds.length;
  const SKIP_PAUSE = 450;
  const skipBound = (b) => (b.strong ? 900 : 260);
  const dp = Array.from({ length: P + 1 }, () => new Float64Array(B + 1).fill(Infinity));
  const bk = Array.from({ length: P + 1 }, () => new Uint8Array(B + 1));
  dp[0][0] = 0;
  for (let p = 0; p <= P; p++) {
    for (let b = 0; b <= B; b++) {
      const v = dp[p][b];
      if (!Number.isFinite(v)) continue;
      if (p < P && v + SKIP_PAUSE < dp[p + 1][b]) { dp[p + 1][b] = v + SKIP_PAUSE; bk[p + 1][b] = 1; }
      if (b < B && v + skipBound(bounds[b]) < dp[p][b + 1]) { dp[p][b + 1] = v + skipBound(bounds[b]); bk[p][b + 1] = 2; }
      if (p < P && b < B) {
        const expected = (bounds[b].after + 1) * msPerChar;
        const c = v + Math.abs(sp[p].speechBefore - expected) * 0.6;
        if (c < dp[p + 1][b + 1]) { dp[p + 1][b + 1] = c; bk[p + 1][b + 1] = 0; }
      }
    }
  }
  const pairs = [];
  let p = P;
  let b = B;
  while (p > 0 || b > 0) {
    const d = bk[p][b];
    if (d === 0) { pairs.push([p - 1, b - 1]); p--; b--; }
    else if (d === 1) p--;
    else b--;
  }
  pairs.reverse();

  // 锚点：句段边界 -> 停顿起止
  const segs = []; // [{c0, c1, t0, t1}]  字区间 [c0, c1] 映射到 [t0, t1]
  let c0 = 0;
  let t0 = leadIn;
  for (const [pi, bi] of pairs) {
    const c1 = bounds[bi].after;
    segs.push({ c0, c1, t0, t1: sp[pi].s });
    c0 = c1 + 1;
    t0 = sp[pi].e;
  }
  segs.push({ c0, c1: n - 1, t0, t1: tailStart });

  const times = new Array(n);
  for (const sg of segs) {
    const cnt = sg.c1 - sg.c0 + 1;
    if (cnt <= 0) continue;
    const step = Math.max(0, sg.t1 - sg.t0) / cnt;
    for (let k = 0; k < cnt; k++) {
      const s = sg.t0 + step * k;
      times[sg.c0 + k] = [Math.round(s), Math.round(s + step)];
    }
  }
  return { times, anchoredPauses: pairs.length, totalPauses: P };
}

/**
 * 对齐入口
 * @param {object} opts
 * @param {string} opts.audioPath  配音文件
 * @param {string} opts.scriptText 文案（通常是所有镜头 narration_text 拼接）
 * @param {'auto'|'whisper'|'pauses'} [opts.method]
 */
export async function alignNarration({ audioPath, scriptText, method = 'auto', signal, onLog } = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`配音文件不存在: ${audioPath}`);
  const text = String(scriptText || '');
  const { chars: spoken, pos } = spokenIndex(text);
  if (!spoken.length) throw new Error('文案为空，无法对齐');

  const totalMs = probeDurationMs(audioPath);
  if (!totalMs) throw new Error('无法读取音频时长（文件可能损坏或为空）');
  const pauses = detectPauses(audioPath);

  let useWhisper = method === 'whisper' || (method === 'auto' && whisperAvailable());
  let times;
  let stats = {};
  let usedMethod = 'pauses';
  let warning = null;

  if (useWhisper) {
    try {
      onLog?.('正在用本地 Whisper 听写逐词时间...\n');
      const res = await runWhisper(audioPath, text, { signal, onLog });
      const r = alignWithWhisperWords(spoken, res.words, pauses, totalMs);
      if (r.matchRate < 0.5) {
        warning = `Whisper 听写与文案匹配率仅 ${(r.matchRate * 100).toFixed(0)}%，可能配音和文案不一致，已改用停顿对齐`;
      } else {
        times = r.times;
        usedMethod = 'whisper';
        stats = { match_rate: Number(r.matchRate.toFixed(3)), model: res.model, asr_words: res.words.length };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      warning = `Whisper 对齐失败，已改用停顿对齐：${e.message}`;
    }
  }
  if (!times) {
    const r = alignWithPauses(text, spoken, pos, pauses, totalMs);
    times = r.times;
    usedMethod = 'pauses';
    stats = { anchored_pauses: r.anchoredPauses, total_pauses: r.totalPauses };
  }

  return {
    version: TIMING_VERSION,
    method: usedMethod,
    created_at: new Date().toISOString(),
    audio_duration_ms: totalMs,
    text,
    spoken_count: spoken.length,
    // 第 j 个发音字的 [开始ms, 结束ms]（与 spokenIndex(text) 的顺序一致）
    times,
    pauses,
    stats,
    warning,
  };
}

/* ------------------------------------------------------------------ */
/* 使用时间轴：镜头时间 & 字幕                                         */
/* ------------------------------------------------------------------ */

export const DEFAULT_CUT_LEAD_MS = 200; // 画面比声音提前出现的默认毫秒数
export const MIN_SHOT_MS = 600;

export function timingPath(dataDir) {
  return path.join(dataDir, TIMING_FILE);
}

export function loadTiming(dataDir) {
  const p = timingPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (t?.version !== TIMING_VERSION || !Array.isArray(t.times)) return null;
    return t;
  } catch (e) {
    return null;
  }
}

/** 镜头文案拼接成的全文，以及每个镜头在全文"发音字序列"中的起止 */
export function sceneSpokenRanges(scenes) {
  const ranges = [];
  let offset = 0;
  for (const s of scenes) {
    const cnt = Array.from(String(s.narration_text || '')).filter(isSpoken).length;
    ranges.push([offset, offset + cnt]); // [start, end)
    offset += cnt;
  }
  return { ranges, total: offset };
}

export function scenesText(scenes) {
  return scenes.map((s) => String(s.narration_text || '')).join('');
}

/**
 * 把当前镜头文案的发音字 映射到 时间轴(timing.text) 的发音字。
 * 文案没改过时是一一对应；改过的话用对齐找回位置，找不到的字插值。
 * 返回 getTime(j) => [s,e]
 */
export function buildTimeLookup(timing, currentText) {
  const cur = spokenIndex(currentText).chars;
  const ref = spokenIndex(timing.text).chars;
  let idxMap;
  const same = cur.length === ref.length && cur.every((c, i) => c === ref[i]);
  if (same) {
    return { getTime: (j) => timing.times[Math.min(Math.max(j, 0), timing.times.length - 1)], exact: true, count: cur.length };
  }
  idxMap = alignSequences(ref, cur);
  const anchors = [];
  let hits = 0;
  for (let j = 0; j < cur.length; j++) {
    const v = idxMap[j];
    if (v >= 0) hits++;
    const r = v >= 0 ? v : v <= -2 ? -2 - v : -1;
    if (r >= 0 && timing.times[r]) anchors.push({ i: j, s: timing.times[r][0], e: timing.times[r][1] });
  }
  // 文案改动太大（配音已经对不上文案）：不再使用这份时间轴
  if (!cur.length || hits / cur.length < 0.7) {
    return { getTime: null, exact: false, count: 0, stale: true, matchRate: cur.length ? hits / cur.length : 0 };
  }
  let last = 0;
  const mono = anchors.filter((a) => (a.s >= last ? ((last = a.e), true) : false));
  const times = interpolate(cur.length, mono, timing.audio_duration_ms);
  return { getTime: (j) => times[Math.min(Math.max(j, 0), times.length - 1)], exact: false, count: cur.length };
}

/**
 * 用真实时间轴给镜头排时间。
 * 镜头开始 = 该镜头第一个发音字的开始时间 - 提前量(cut_offset_ms，默认 200ms)
 * 镜头结束 = 下一个镜头开始；最后一个镜头延续到音频结束。
 */
export function applyTimingToScenes(manifest, timing) {
  const scenes = manifest.scenes || [];
  if (!scenes.length || !timing) return false;
  const text = scenesText(scenes);
  const { getTime, exact, count } = buildTimeLookup(timing, text);
  if (!count) return false;
  const { ranges } = sceneSpokenRanges(scenes);
  const total = timing.audio_duration_ms;

  const starts = scenes.map((s, i) => {
    if (i === 0) return 0;
    const [a, b] = ranges[i];
    if (b <= a) return null; // 纯标点镜头，稍后处理
    const lead = Number.isFinite(s.cut_offset_ms) ? s.cut_offset_ms : DEFAULT_CUT_LEAD_MS;
    return Math.max(0, Math.round(getTime(a)[0] - lead));
  });
  // 保证单调 & 最短时长
  for (let i = 1; i < starts.length; i++) {
    const prev = starts[i - 1];
    if (starts[i] === null) starts[i] = prev + MIN_SHOT_MS;
    if (starts[i] < prev + MIN_SHOT_MS) starts[i] = prev + MIN_SHOT_MS;
  }
  const end = Math.max(total, starts[starts.length - 1] + MIN_SHOT_MS);
  scenes.forEach((s, i) => {
    s.scene_index = i + 1;
    s.scene_id = `Shot-${String(i + 1).padStart(3, '0')}`;
    s.start_ms = starts[i];
    s.end_ms = i < scenes.length - 1 ? starts[i + 1] : end;
    s.duration_ms = s.end_ms - s.start_ms;
    s.timing_source = exact ? 'aligned' : 'aligned_fuzzy';
    // 记录说话的起止（便于界面显示"画面比声音早/晚多少"）
    const [a, b] = ranges[i];
    if (b > a) {
      s.speech_start_ms = getTime(a)[0];
      s.speech_end_ms = getTime(b - 1)[1];
    }
  });
  manifest.total_scenes = scenes.length;
  manifest.total_duration_ms = end;
  manifest.total_duration_sec = Number((end / 1000).toFixed(1));
  manifest.timing_source = exact ? 'aligned' : 'aligned_fuzzy';
  return true;
}

/**
 * 字幕：独立于画面，按标点 + 长度切成短句，时间来自逐字时间轴。
 * 返回 [{start_ms, end_ms, text}]
 */
export function buildCaptionsFromTiming(manifest, timing, { maxChars = 18 } = {}) {
  const scenes = manifest.scenes || [];
  const text = scenesText(scenes);
  const { getTime, count } = buildTimeLookup(timing, text);
  if (!count) return [];

  const items = [];
  let buf = '';
  let firstJ = -1;
  let lastJ = -1;
  let j = -1; // 当前发音字序号
  const flush = () => {
    const t = buf.replace(/^[\s，,。．.！!？?；;：:、]+/, '').replace(/[\s，,。．.；;：:、]+$/, '').trim();
    if (t && firstJ >= 0) items.push({ start_ms: getTime(firstJ)[0], end_ms: getTime(lastJ)[1], text: t });
    buf = '';
    firstJ = -1;
    lastJ = -1;
  };
  const spokenLen = (s) => Array.from(s).filter(isSpoken).length;
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') { flush(); continue; }
    const sp = isSpoken(ch);
    if (sp) {
      j++;
      // 当前句已满：尽量在最近的逗号处断，否则硬断
      if (spokenLen(buf) >= maxChars) flush();
      if (firstJ < 0) firstJ = j;
      lastJ = j;
    }
    buf += ch;
    if (SENTENCE_END_RE.test(ch) || (CLAUSE_END_RE.test(ch) && spokenLen(buf) >= 6)) flush();
  }
  flush();
  // 合并过短的间隙，避免字幕闪烁
  for (let i = 0; i < items.length - 1; i++) {
    const gap = items[i + 1].start_ms - items[i].end_ms;
    if (gap > 0 && gap < 350) items[i].end_ms = items[i + 1].start_ms;
  }
  return items;
}

/** 关键词在当前镜头文案全文中的发音字位置（用于"关键词出现时切画面"） */
export function findKeywordPositions(text, keyword) {
  const { chars } = spokenIndex(text);
  const kw = Array.from(String(keyword || '')).filter(isSpoken).map(matchKey);
  const hay = chars.map(matchKey);
  const res = [];
  if (kw.length < 2) return res;
  outer: for (let i = 0; i + kw.length <= hay.length; i++) {
    for (let k = 0; k < kw.length; k++) if (hay[i + k] !== kw[k]) continue outer;
    res.push(i);
  }
  return res;
}
