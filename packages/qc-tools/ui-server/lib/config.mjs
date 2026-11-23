import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '../../../..');

export const PORT = process.env.PORT || 4000;
export const defaultProjectId = 'why_nikko_heritage_road_001';
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

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

export function getPaths(projectId = defaultProjectId) {
  const projectDir = path.join(rootDir, 'projects', projectId);
  return {
    projectId,
    projectDir,
    dataDir: path.join(projectDir, 'data'),
    publicDir: path.join(projectDir, 'public'),
    outputDir: path.join(projectDir, 'output'),
    briefPath: path.join(projectDir, 'data', 'brief.json'),
    evidencePath: path.join(projectDir, 'data', 'evidence-cards.json'),
    outlinePath: path.join(projectDir, 'data', 'outline.json'),
    manifestPath: path.join(projectDir, 'data', 'scene-manifest.json'),
    assetIndexPath: path.join(projectDir, 'data', 'asset-index.json'),
    statusPath: path.join(projectDir, 'data', 'project-status.json'),
    promptConfigPath: path.join(projectDir, 'data', 'prompt-config.json'),
    bgmConfigPath: path.join(projectDir, 'data', 'bgm-config.json'),
    writerPromptsPath: path.join(projectDir, 'data', 'writer-prompts.json'),
    finalScriptPath: path.join(projectDir, 'data', 'final-script.json'),
    materialsPath: path.join(projectDir, 'data', 'materials.txt'),
    videoPath: path.join(projectDir, 'output', 'final_video_1080p.mp4'),
    audioDir: path.join(projectDir, 'public', 'audio'),
    bgmDir: path.join(projectDir, 'public', 'audio', 'bgm'),
    captionsPath: path.join(projectDir, 'public', 'captions', 'captions.srt'),
    propsPath: path.join(projectDir, 'public', 'render-props.json'),
  };
}

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
    bgmModel: cfg.bgmModel || 'deepseek/deepseek-chat',
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
