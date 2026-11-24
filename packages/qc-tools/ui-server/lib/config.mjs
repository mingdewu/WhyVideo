import fs from 'fs';
import path from 'path';
import { ROOT_DIR, defaultProjectId as selectDefaultProject, getProjectPaths } from '../../project-paths.mjs';

export const rootDir = ROOT_DIR;

export const renderJobs = new Map();
export const voiceJobs = new Map();
export const voiceJobControllers = new Map();
export const alignJobs = new Map();

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
  let vModel = cfg.videoModel || 'minimax/hailuo-3-max';
  if (vModel === 'minimax/video-01' || vModel === 'minimax/hailuo' || vModel === 'video-01') {
    vModel = 'minimax/hailuo-3-max';
  }
  let iModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
  if (iModel === 'black-forest-labs/flux-1-schnell' || iModel.includes('flux-1')) {
    iModel = 'black-forest-labs/flux-3-image';
  }
  return {
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
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
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
