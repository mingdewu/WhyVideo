import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'child_process';
import { rootDir } from './config.mjs';

const VENV_PY = path.join(rootDir, '.venv-align', 'bin', 'python');
const WORKER_PY = path.join(rootDir, 'packages', 'qc-tools', 'transcribe_voice_worker.py');
const WHISPER_MODEL = process.env.ALIGN_WHISPER_MODEL || 'mlx-community/whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 15 * 1000;
const WORKER_TIMEOUT_MS = 60 * 1000;

let cachedFfmpegBin = null;
let ffmpegChecked = false;
let cachedCapabilities = null;

let workerProc = null;
let workerStdoutBuf = '';
let workerStderrTail = '';
let idleTimer = null;
let queueTail = Promise.resolve();
const pendingRequests = new Map();

function resolveFfmpegBin() {
  if (ffmpegChecked) return cachedFfmpegBin;
  ffmpegChecked = true;
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedFfmpegBin = candidate;
      return cachedFfmpegBin;
    }
  }
  try {
    const res = spawnSync('which', ['ffmpeg'], { encoding: 'utf8', timeout: 3000 });
    if (res.status === 0 && res.stdout.trim()) {
      cachedFfmpegBin = res.stdout.trim().split('\n')[0].trim();
    }
  } catch (e) {}
  return cachedFfmpegBin;
}

/**
 * Inspect local Whisper + FFmpeg availability (cached for process lifetime).
 */
export function getVoiceSttCapabilities() {
  if (cachedCapabilities) return cachedCapabilities;

  const ffmpegBin = resolveFfmpegBin();
  const ffmpegAvailable = Boolean(ffmpegBin);
  let pythonReady = false;

  if (fs.existsSync(VENV_PY) && fs.existsSync(WORKER_PY)) {
    try {
      const res = spawnSync(VENV_PY, ['-c', 'import mlx_whisper, numpy'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      pythonReady = res.status === 0;
    } catch (e) {
      pythonReady = false;
    }
  }

  cachedCapabilities = {
    localWhisperAvailable: Boolean(pythonReady && ffmpegAvailable),
    ffmpegAvailable,
    model: WHISPER_MODEL,
  };
  return cachedCapabilities;
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleShutdown() {
  clearIdleTimer();
  if (pendingRequests.size > 0 || !workerProc) return;
  idleTimer = setTimeout(() => {
    if (pendingRequests.size === 0) {
      shutdownVoiceWorker();
    }
  }, IDLE_TIMEOUT_MS);
  if (typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

/**
 * Terminate the persistent Python Whisper worker if running.
 */
export function shutdownVoiceWorker() {
  clearIdleTimer();
  const proc = workerProc;
  workerProc = null;
  workerStdoutBuf = '';
  if (!proc) return;

  try {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(JSON.stringify({ cmd: 'shutdown' }) + '\n');
      proc.stdin.end();
    }
  } catch (e) {}

  try {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  } catch (e) {}
}

process.once('exit', shutdownVoiceWorker);

function rejectAllPending(err) {
  for (const [reqId, entry] of pendingRequests.entries()) {
    clearTimeout(entry.timer);
    pendingRequests.delete(reqId);
    entry.reject(err);
  }
}

function ensureWorker() {
  if (workerProc && !workerProc.killed && workerProc.exitCode === null) {
    return workerProc;
  }

  clearIdleTimer();
  workerStdoutBuf = '';
  workerStderrTail = '';

  const child = spawn(VENV_PY, [WORKER_PY], {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ALIGN_WHISPER_MODEL: WHISPER_MODEL,
      HF_HUB_DISABLE_PROGRESS_BARS: '1',
      TQDM_DISABLE: '1',
    },
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    workerStdoutBuf += chunk;
    let nlIdx = workerStdoutBuf.indexOf('\n');
    while (nlIdx !== -1) {
      const line = workerStdoutBuf.slice(0, nlIdx).trim();
      workerStdoutBuf = workerStdoutBuf.slice(nlIdx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          const pending = msg?.id ? pendingRequests.get(msg.id) : null;
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(msg.id);
            if (msg.ok) {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || '本地 Whisper 识别失败'));
            }
            if (pendingRequests.size === 0) {
              scheduleIdleShutdown();
            }
          }
        } catch (parseErr) {
          console.warn('[voice-stt] 无法解析 worker 输出行:', line.slice(0, 200));
        }
      }
      nlIdx = workerStdoutBuf.indexOf('\n');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    workerStderrTail = (workerStderrTail + chunk).slice(-1200);
  });

  child.on('error', (err) => {
    if (workerProc === child) {
      workerProc = null;
    }
    clearIdleTimer();
    rejectAllPending(new Error(`Whisper worker 启动失败: ${err.message}`));
  });

  child.on('close', (code, signal) => {
    if (workerProc === child) {
      workerProc = null;
    }
    clearIdleTimer();
    if (pendingRequests.size > 0) {
      const tail = workerStderrTail.trim().split('\n').slice(-3).join(' | ');
      rejectAllPending(
        new Error(`Whisper worker 意外退出 (code=${code}, signal=${signal})${tail ? `: ${tail}` : ''}`)
      );
    }
  });

  workerProc = child;
  return child;
}

function sendToWorker(payload) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = ensureWorker();
    } catch (err) {
      return reject(err);
    }

    clearIdleTimer();
    const id = payload.id || randomUUID();
    const fullPayload = { ...payload, id };

    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        shutdownVoiceWorker();
        reject(new Error('本地语音识别超时，请重试或缩短单次录音时长'));
      }
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    try {
      proc.stdin.write(JSON.stringify(fullPayload) + '\n');
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      shutdownVoiceWorker();
      reject(new Error(`向 Whisper worker 发送请求失败: ${err.message}`));
    }
  });
}

function inferAudioExtension(mimeType) {
  const lower = String(mimeType || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return '.m4a';
  if (lower.includes('ogg')) return '.ogg';
  if (lower.includes('wav')) return '.wav';
  return '.webm';
}

function convertToMono16kWav(ffmpegBin, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegBin,
      ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', '-f', 'wav', outputPath],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderrTail = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d).slice(-600);
    });

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new Error('音频转码超时'));
    }, FFMPEG_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`启动 FFmpeg 失败: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 44) {
        resolve();
      } else {
        const msg = stderrTail.trim().split('\n').slice(-2).join(' ') || `退出码 ${code}`;
        reject(new Error(`音频解码失败，请重新录制: ${msg}`));
      }
    });
  });
}

/**
 * Decode an uploaded browser audio buffer to 16kHz mono WAV and transcribe it via local MLX Whisper.
 */
export function transcribeAudioBuffer(audioBuffer, { mimeType = 'audio/webm', promptHint = '', language = 'zh' } = {}) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    return Promise.reject(new Error('录音音频为空'));
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    return Promise.reject(new Error('单次录音音频超过 15MB 限制，请缩短录音时长'));
  }

  const caps = getVoiceSttCapabilities();
  if (!caps.localWhisperAvailable) {
    return Promise.reject(new Error('本机 Whisper 语音识别环境或 FFmpeg 未就绪'));
  }
  const ffmpegBin = resolveFfmpegBin();

  const run = async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-stt-'));
    try {
      const ext = inferAudioExtension(mimeType);
      const inPath = path.join(tmpDir, `input${ext}`);
      const wavPath = path.join(tmpDir, 'audio_16k.wav');
      fs.writeFileSync(inPath, audioBuffer);

      await convertToMono16kWav(ffmpegBin, inPath, wavPath);

      const res = await sendToWorker({
        id: randomUUID(),
        wav_path: wavPath,
        language: language || 'zh',
        prompt: promptHint || '',
      });

      return {
        text: String(res.text || ''),
        silent: Boolean(res.silent),
        duration_sec: Number(res.duration_sec || 0),
        model: res.model || WHISPER_MODEL,
        engine: 'mlx_whisper',
      };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {}
    }
  };

  // Serialize transcription jobs cleanly through the persistent worker.
  const next = queueTail.then(run, run);
  queueTail = next.catch(() => {});
  return next;
}
