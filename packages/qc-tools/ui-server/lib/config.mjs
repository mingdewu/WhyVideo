import fs from 'fs';
import path from 'path';
import { ROOT_DIR, defaultProjectId as selectDefaultProject, getProjectPaths } from '../../project-paths.mjs';
import { sharedRuntimeConfig } from './shared-services.mjs';

export const rootDir = ROOT_DIR;

export const renderJobs = new Map();
export const voiceJobs = new Map();
export const voiceJobControllers = new Map();
export const alignJobs = new Map();
export const bgmAiJobs = new Map();

// 优先读取 .env

export function loadEnv() {
  const envPath = path.resolve(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
}
loadEnv();

export const PORT = process.env.PORT || 4000;
export const defaultProjectId = selectDefaultProject();

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export const getPaths = getProjectPaths;

export function normalizePromptConfig(cfg = {}) {
  const shared = sharedRuntimeConfig();
  if (shared) cfg = { ...cfg, ...Object.fromEntries(Object.entries(shared).filter(([, value]) => value !== '' && value != null)) };
  let vModel = cfg.videoModel || 'minimax/hailuo-3-max';
  if (vModel === 'minimax/video-01' || vModel === 'minimax/hailuo' || vModel === 'video-01') {
    vModel = 'minimax/hailuo-3-max';
  }
  let iModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
  if (iModel === 'black-forest-labs/flux-1-schnell' || iModel.includes('flux-1')) {
    iModel = 'black-forest-labs/flux-3-image';
  }
  return {
    ...cfg,
    provider: 'openrouter',
    baseUrl: cfg.baseUrl || 'https://openrouter.ai/api/v1',
    apiKey: cfg.apiKey || '',
    textModel: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    keywordModel: cfg.keywordModel || cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    videoModel: vModel,
    imageModel: iModel,
    bgmModel: cfg.bgmModel || 'google/gemini-2.5-flash',
    model: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    global_ai_visual_prompt: cfg.global_ai_visual_prompt || cfg.global_ppt_prompt || '作为 16:9 纪录片视觉总监，结合旁白片段与关键词提炼震撼的真实画面。',
    updated_at: cfg.updated_at || new Date().toISOString()
  };
}


export function readBody(req) {
  if (req.bodyJson !== undefined) return Promise.resolve(req.bodyJson);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let exceeded = false;
    req.on('data', (c) => {
      length += c.length;
      if (length > 256 * 1024 * 1024) { exceeded = true; chunks.length = 0; }
      if (!exceeded) chunks.push(c);
    });
    req.on('end', () => {
      try {
        if (exceeded) throw new Error('请求内容过大');
        const str = Buffer.concat(chunks).toString('utf8');
        const body = str ? JSON.parse(str) : {};
        if (req.trustedWriterConfig && body && typeof body === 'object' && !Array.isArray(body)) {
          body.apiKey = req.trustedWriterConfig.apiKey;
          body.baseUrl = req.trustedWriterConfig.baseUrl;
        }
        resolve(body);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}


export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
