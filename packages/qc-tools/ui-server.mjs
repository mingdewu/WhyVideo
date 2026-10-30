import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const PORT = process.env.PORT || 4000;
const defaultProjectId = 'why_ai_renamed_to_si_001';

// 优先读取 .env
function loadEnv() {
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

const MIME_TYPES = {
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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function getPaths(projectId = defaultProjectId) {
  const projectDir = path.join(rootDir, 'projects', projectId);
  return {
    projectId,
    projectDir,
    dataDir: path.join(projectDir, 'data'),
    publicDir: path.join(projectDir, 'public'),
    outputDir: path.join(projectDir, 'output'),
    manifestPath: path.join(projectDir, 'data', 'scene-manifest.json'),
    assetIndexPath: path.join(projectDir, 'data', 'asset-index.json'),
    statusPath: path.join(projectDir, 'data', 'project-status.json'),
    promptConfigPath: path.join(projectDir, 'data', 'prompt-config.json'),
    finalScriptPath: path.join(projectDir, 'data', 'final-script.json'),
    videoPath: path.join(projectDir, 'output', 'final_video_1080p.mp4'),
    audioDir: path.join(projectDir, 'public', 'audio'),
    captionsPath: path.join(projectDir, 'public', 'captions', 'captions.srt'),
    propsPath: path.join(projectDir, 'public', 'render-props.json'),
  };
}

function listProjects() {
  const projectsDir = path.join(rootDir, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const list = [];

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const pId = ent.name;
    const paths = getPaths(pId);

    let title = pId;
    let stage = '新建工程';
    let scenesCount = 0;
    let hasVideo = fs.existsSync(paths.videoPath);
    let hasScript = fs.existsSync(paths.finalScriptPath);
    let hasManifest = fs.existsSync(paths.manifestPath);

    if (hasScript) {
      try {
        const sc = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8'));
        if (sc.title) title = `《${sc.title}》`;
      } catch (e) {}
    }

    if (hasManifest) {
      try {
        const mf = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
        scenesCount = (mf.scenes || []).length;
        if (mf.project_title && title === pId) title = `《${mf.project_title}》`;
      } catch (e) {}
    }

    if (hasVideo) {
      stage = `已渲染 1080p 成片 · ${scenesCount} 镜头`;
    } else if (hasManifest && scenesCount > 0) {
      stage = `视觉镜头就绪 (${scenesCount} 镜 · 4~8s 节奏) · 待配音/渲染`;
    } else if (hasScript) {
      stage = '文案已定稿 · 待编排分镜';
    }

    list.push({
      id: pId,
      title,
      stage,
      scenesCount,
      hasVideo,
      hasScript,
      hasManifest,
    });
  }

  return list.sort((a, b) => (a.id === defaultProjectId ? -1 : 1));
}

function msToSrt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

function syncCaptions(manifest, captionsPath) {
  if (!manifest?.scenes || !captionsPath) return;
  const srtLines = [];
  manifest.scenes.forEach((sc, i) => {
    srtLines.push(String(i + 1));
    srtLines.push(`${msToSrt(sc.start_ms)} --> ${msToSrt(sc.end_ms)}`);
    srtLines.push(sc.narration_text || '');
    srtLines.push('');
  });
  fs.mkdirSync(path.dirname(captionsPath), { recursive: true });
  fs.writeFileSync(captionsPath, srtLines.join('\n'), 'utf8');
}

function recalculateTimelines(manifest) {
  let cur = 0;
  (manifest.scenes || []).forEach((s, idx) => {
    s.scene_index = idx + 1;
    s.scene_id = `Shot-${String(idx + 1).padStart(3, '0')}`;
    const dur = s.duration_ms || Math.max(4200, Math.min(9500, Math.round((s.narration_text || '').length * 230)));
    s.duration_ms = dur;
    s.start_ms = cur;
    s.end_ms = cur + dur;
    cur += dur;
  });
  manifest.total_scenes = manifest.scenes.length;
  manifest.total_duration_ms = cur;
  manifest.total_duration_sec = Number((cur / 1000).toFixed(1));
}

function ensureTableFields(manifest) {
  let changed = false;
  for (const s of manifest.scenes || []) {
    if (!s.source_mode) {
      s.source_mode = ['broll_video', 'photo_motion'].includes(s.visual_type)
        ? 'manual_upload'
        : 'ai_ppt_slide';
      changed = true;
    }
    if (!Array.isArray(s.content_keywords) || s.content_keywords.length === 0) {
      s.content_keywords = ['核心观点'];
      changed = true;
    }
    if (!s.ppt_slide_spec) {
      const kw = s.content_keywords[0] || '核心观点';
      s.ppt_slide_spec = {
        theme_title: kw.length >= 4 ? kw : `「${kw}」`,
        subtitle: s.narration_text.slice(0, 24),
        bullet_points: [`核心要义：${s.narration_text.slice(0, 20)}`, `标志关键词：${s.content_keywords.join(' · ')}`],
        custom_prompt: '',
      };
      changed = true;
    }
  }
  return changed;
}

function syncTableToManifest(manifest) {
  for (const s of manifest.scenes || []) {
    const kws = Array.isArray(s.content_keywords) ? s.content_keywords : [];
    const ppt = s.ppt_slide_spec || {};

    if (s.source_mode === 'ai_ppt_slide') {
      if (['broll_video', 'photo_motion'].includes(s.visual_type)) {
        s.visual_type = 'data_card';
        s.scene_type = 'data_card';
      }
      s.status = 'READY_PROCEDURAL';
      s.procedural_props = {
        badge_label: `AI 画面 · ${kws.slice(0, 2).join(' / ') || s.scene_id}`,
        headline: ppt.theme_title || s.narration_text.slice(0, 16),
        subheadline: ppt.subtitle || `核心表达：${kws.join(' · ')}`,
        items:
          Array.isArray(ppt.bullet_points) && ppt.bullet_points.length > 0
            ? ppt.bullet_points
            : kws.map((k) => `核心表达：${k}`),
        accent_color: s.procedural_props?.accent_color || '#6366f1',
      };
    } else {
      if (!['broll_video', 'photo_motion'].includes(s.visual_type)) {
        s.visual_type = 'photo_motion';
        s.scene_type = 'photo_motion';
      }
      if (s.final_asset_id) {
        s.status = 'READY_APPROVED';
      } else {
        s.status = 'NEEDS_HUMAN_ASSET';
      }
    }
  }
}

function recompileProject(projectId) {
  const curPaths = getPaths(projectId);
  if (fs.existsSync(curPaths.manifestPath)) {
    const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    syncCaptions(mf, curPaths.captionsPath);
  }
  spawnSync(
    'node',
    ['packages/qc-tools/generate-render-props.mjs', '--project', projectId],
    { cwd: rootDir, stdio: 'inherit' }
  );
}

function renderRemotionStill(projectId, sceneId) {
  const curPaths = getPaths(projectId);
  if (!fs.existsSync(curPaths.manifestPath)) return null;
  const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
  const scene = (mf.scenes || []).find((s) => s.scene_id === sceneId);
  if (!scene) return null;

  const frame = Math.round((scene.start_ms / 1000) * 30) + 15;
  const outDir = path.join(curPaths.publicDir, 'assets', 'generated');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFileName = `${sceneId.toLowerCase()}_still.jpg`;
  const outPath = path.join(outDir, outFileName);
  const relPath = `assets/generated/${outFileName}`;

  try {
    const res = spawnSync(
      'npx',
      [
        'remotion',
        'still',
        'packages/video-template/src/index.ts',
        'WhyExplainerFinal',
        outPath,
        `--frame=${frame}`,
        `--props=${curPaths.propsPath}`,
        `--public-dir=${curPaths.publicDir}`,
        '--image-format=jpeg',
        '--jpeg-quality=85',
        '--log=warn',
      ],
      { cwd: rootDir, encoding: 'utf8', timeout: 35000 }
    );
    if (fs.existsSync(outPath)) {
      return relPath;
    }
    console.error(`Remotion still failed for ${sceneId}:`, res.stderr || res.stdout);
  } catch (err) {
    console.error(`Remotion still spawn exception for ${sceneId}:`, err);
  }
  return null;
}

async function callOpenRouterDirector(cfg, scene, customPrompt, templateStyle) {
  const apiKey = (cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('未配置 OpenRouter API Key');

  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (cfg.model || 'anthropic/claude-3.5-sonnet').trim();

  const url = `${baseUrl}/chat/completions`;
  const systemPrompt = `你是一位顶尖的 YouTube 科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】与【用户视觉 Prompt】，为 16:9 画幅视频提炼具有极强认知冲击力与视听节奏感的核心画面信息。

必须且仅返回纯净 JSON 格式，严禁返回任何额外文字、markdown标记或问候：
{
  "theme_title": "核心大字醒目标题（4~14字，具颠覆性或总结性）",
  "subtitle": "副级精炼阐释说明（12~30字）",
  "bullet_points": [
    "提炼论点一（12~24字）",
    "提炼论点二（12~24字）"
  ],
  "recommended_template": "data_card 或 versus_dual 或 document_highlight 或 timeline"
}`;

  const userMessage = `【镜头序号】：${scene.scene_id}
【章节分类】：${scene.chapter_ref || '核心解析'}
【本镜台词】：${scene.narration_text}
【用户指示词/Prompt】：${customPrompt || '冷峻科技风、概念颠覆、强化视觉记忆'}
【指定模板样式】：${templateStyle || '自动分析决定'}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 状态码 ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('无法从模型返回中提取 JSON 数据');
  return JSON.parse(match[0]);
}

function registerGeneratedAsset(curPaths, projectId, sceneId, relPath, type = 'video', durationSec = 6.0) {
  let assetIdx = { assets: [] };
  if (fs.existsSync(curPaths.assetIndexPath)) {
    try { assetIdx = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8')); } catch (e) {}
  }
  const assetId = `AST-${type.toUpperCase()}-${sceneId.toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const assetRecord = {
    asset_id: assetId,
    path: relPath,
    file_path: `projects/${projectId}/public/${relPath}`,
    type: type,
    media_type: type,
    resolution: '1920x1080',
    duration_seconds: durationSec,
    duration_sec: durationSec,
    license_status: 'approved',
    source: 'ai_visual_video_generator',
    tags: ['ai_generated', type, sceneId]
  };
  assetIdx.assets.push(assetRecord);
  fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIdx, null, 2), 'utf8');
  return assetId;
}

function normalizePromptConfig(cfg = {}) {
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
    videoModel: vModel,
    imageModel: iModel,
    model: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    global_ai_visual_prompt: cfg.global_ai_visual_prompt || cfg.global_ppt_prompt || '作为 16:9 纪录片视觉总监，结合旁白片段与关键词提炼震撼的真实画面。',
    updated_at: cfg.updated_at || new Date().toISOString()
  };
}

async function downloadRemoteMedia(remoteUrl, localDestPath) {
  const dir = path.dirname(localDestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (remoteUrl.startsWith('data:')) {
    const base64Data = remoteUrl.split(',')[1];
    fs.writeFileSync(localDestPath, Buffer.from(base64Data, 'base64'));
    return;
  }
  const resp = await fetch(remoteUrl);
  if (!resp.ok) throw new Error(`下载媒体文件失败 (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(localDestPath, buf);
}

// 统一 AI 实体视频生成器 (支持 OpenRouter 原生视频端点、各类多模态代理网关、SiliconFlow、Runway 等任意模型 Slug)
async function callGatewayVideoGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', videoModel = 'minimax/hailuo-3' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key，请先在右上角【🎬 AI 画面/视频模型指定】中填入您的 API Key 并保存');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = videoModel.trim();

  // 0. 原生 OpenRouter 官方视频生成端点 (POST https://openrouter.ai/api/v1/videos)
  if (base.includes('openrouter.ai')) {
    // 智能映射：MiniMax 视频在 OpenRouter 上的标准模型 ID
    if (model === 'minimax/video-01' || model === 'minimax/hailuo' || model === 'minimax-01' || model === 'video-01') {
      console.log(`[OpenRouter Video] 自动将 ${model} 映射为 OpenRouter 标准模型: minimax/hailuo-3-max`);
      model = 'minimax/hailuo-3-max';
    }

    // 针对各模型官方支持的 resolution / duration 动态适配
    let resolution = '720p';
    let duration = 5;
    if (model === 'minimax/hailuo-3') {
      resolution = '2K';
      duration = 5;
    } else if (model === 'minimax/hailuo-3-max') {
      resolution = '768p';
      duration = 5;
    } else if (model === 'minimax/hailuo-2.3') {
      resolution = '1080p';
      duration = 6;
    } else if (model.includes('veo')) {
      resolution = '720p';
      duration = 4;
    }

    console.log(`[OpenRouter Video] 正在提交任务至 ${base}/videos，模型: ${model} (分辨率: ${resolution}, 时长: ${duration}s)...`);
    const submitResp = await fetch(`${base}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9',
        duration: duration,
        resolution: resolution
      })
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 视频生成请求未通过 (HTTP ${submitResp.status}): ${errMsg}`);
    }

    const jobData = await submitResp.json();
    console.log('[OpenRouter Video Job Created]', jobData);

    if (Array.isArray(jobData.unsigned_urls) && jobData.unsigned_urls.length > 0) {
      return jobData.unsigned_urls[0];
    }

    const jobId = jobData.id;
    if (!jobId) throw new Error('OpenRouter 已受理但未返回任务 ID');

    const pollUrl = jobData.polling_url || `${base}/videos/${jobId}`;

    // 轮询生成结果 (最长约 4 分钟，每 4 秒轮询一次)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const pollResp = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        }
      });
      if (!pollResp.ok) continue;
      const pollData = await pollResp.json();
      const status = (pollData.status || '').toLowerCase();
      console.log(`[OpenRouter Video Polling] Job ${jobId} 状态: ${status} (${(i + 1) * 4}s)`);

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        const videoUrl = pollData.unsigned_urls?.[0] || pollData.url || pollData.video_url;
        if (videoUrl) return videoUrl;
      }

      if (status === 'failed' || status === 'error') {
        const failMsg = pollData.error?.message || pollData.error || '视频生成任务失败';
        throw new Error(`OpenRouter 视频生成失败: ${failMsg}`);
      }
    }

    throw new Error(`OpenRouter 视频生成超时 (任务 ID: ${jobId})，请稍后检查网关或重试`);
  }

  // 1. 如果是原生 SiliconFlow 网关
  if (base.includes('siliconflow')) {
    const submitResp = await fetch(`${base}/video/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model, prompt: prompt, image_size: '1280x720' })
    });
    if (!submitResp.ok) throw new Error(`SiliconFlow 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { requestId } = await submitResp.json();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const sResp = await fetch(`${base}/video/status?requestId=${requestId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      const st = (sData.status || '').toLowerCase();
      if (st === 'succeed' || st === 'succeeded') {
        const vUrl = sData.results?.videos?.[0]?.url || sData.results?.url;
        if (vUrl) return vUrl;
      }
      if (st === 'failed') throw new Error(`SiliconFlow 视频生成失败: ${sData.reason || '未知错误'}`);
    }
    throw new Error('SiliconFlow 视频生成超时');
  }

  // 2. 如果是 MiniMax 官方网关
  if (base.includes('minimax')) {
    const submitResp = await fetch(`${base}/video_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model === 'minimax/video-01' ? 'video-01' : model, prompt: prompt })
    });
    if (!submitResp.ok) throw new Error(`MiniMax 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { task_id } = await submitResp.json();
    if (!task_id) throw new Error('MiniMax 未返回 task_id');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const qResp = await fetch(`${base}/query/video_generation?task_id=${task_id}`, {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
      });
      if (!qResp.ok) continue;
      const qData = await qResp.json();
      const st = (qData.status || '').toLowerCase();
      if (st === 'success' || st === 'succeeded' || qData.file_id) {
        if (qData.file_id) {
          const dlResp = await fetch(`${base}/files/retrieve?file_id=${qData.file_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          if (dlResp.ok) {
            const dlData = await dlResp.json();
            if (dlData.file?.download_url) return dlData.file.download_url;
          }
        }
        if (qData.download_url) return qData.download_url;
      }
      if (st === 'failed' || st === 'error') throw new Error(`MiniMax 视频生成失败: ${qData.error_message || '未知错误'}`);
    }
    throw new Error('MiniMax 视频生成超时');
  }

  // 3. 如果是原生 Runway 网关
  if (base.includes('runwayml')) {
    const submitResp = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' },
      body: JSON.stringify({ taskType: model, promptText: prompt, duration: 5, ratio: '16:9' })
    });
    if (!submitResp.ok) throw new Error(`Runway 提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { id: taskId } = await submitResp.json();
    for (let i = 0; i < 35; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const sResp = await fetch(`${base}/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      if (sData.status === 'SUCCEEDED') return sData.output?.[0] || sData.output?.url;
      if (sData.status === 'FAILED') throw new Error(`Runway 视频生成失败: ${sData.failure || '未知原因'}`);
    }
    throw new Error('Runway 视频生成超时');
  }

  // 4. 通用 OpenAI 兼容 / 第三方中转聚合网关：依次尝试端点
  const candidateEndpoints = [
    `${base}/videos`,
    `${base}/video/generations`,
    `${base}/videos/generations`,
    `${base}/video_generation`,
    `${base}/video/submit`,
    `${base}/tasks`
  ];

  let submitResp = null;
  let lastErrorDetail = '';
  for (const ep of candidateEndpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          promptText: prompt,
          ratio: '16:9',
          aspect_ratio: '16:9',
          image_size: '1280x720',
          duration: 5
        })
      });
      if (resp.status !== 404) {
        submitResp = resp;
        break;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  // 若标准端点未命中，尝试 /chat/completions (针对通过 Chat 路由视频模型的第三方代理)
  if (!submitResp || submitResp.status === 404) {
    try {
      const chatResp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: `请生成 16:9 动态 MP4 实体视频：${prompt}` }]
        })
      });
      if (chatResp.ok) {
        const cData = await chatResp.json();
        const text = cData.choices?.[0]?.message?.content || '';
        const m = text.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i);
        if (m) return m[0];
        if (cData.url) return cData.url;
        if (cData.data?.[0]?.url) return cData.data[0].url;
      } else {
        lastErrorDetail = `HTTP ${chatResp.status}: ${(await chatResp.text()).slice(0, 160)}`;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  if (!submitResp || !submitResp.ok) {
    const errText = submitResp ? await submitResp.text() : (lastErrorDetail || '未能连接到任何有效的视频生成端点 (/videos, /video/generations, /video_generation, /video/submit)');
    throw new Error(`视频模型 ${model} 生成请求未通过 (HTTP ${submitResp ? submitResp.status : 500}): ${errText.slice(0, 260)}`);
  }

  const sData = await submitResp.json();
  if (sData.url) return sData.url;
  if (sData.data?.[0]?.url) return sData.data[0].url;
  if (sData.results?.videos?.[0]?.url) return sData.results.videos[0].url;
  if (sData.output?.[0]) return sData.output[0];
  if (Array.isArray(sData.unsigned_urls) && sData.unsigned_urls.length > 0) return sData.unsigned_urls[0];

  const taskId = sData.id || sData.taskId || sData.requestId || sData.task_id;
  if (!taskId) throw new Error('网关已响应但未返回视频 URL 或任务 ID');

  // 轮询任务
  const pollPaths = [
    `${base}/videos/${taskId}`,
    `${base}/video/generations/${taskId}`,
    `${base}/video/status?requestId=${taskId}`,
    `${base}/tasks/${taskId}`
  ];

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    for (const pUrl of pollPaths) {
      try {
        const pollResp = await fetch(pUrl, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
        if (!pollResp.ok) continue;
        const pData = await pollResp.json();
        const st = (pData.status || '').toLowerCase();
        if (st === 'succeed' || st === 'succeeded' || st === 'success' || st === 'completed') {
          return pData.unsigned_urls?.[0] || pData.results?.videos?.[0]?.url || pData.data?.[0]?.url || pData.output?.[0] || pData.url;
        }
        if (st === 'failed' || st === 'failure' || st === 'error') {
          throw new Error(`视频生成任务失败: ${pData.reason || pData.error?.message || pData.error || '未知原因'}`);
        }
      } catch (err) {
        if (err.message.includes('视频生成任务失败')) throw err;
      }
    }
  }

  throw new Error(`视频生成超时 (任务 ID: ${taskId})，请稍后刷新或检查网关`);
}

// 统一 AI 超清实景生图器 (支持 OpenRouter 原生 /api/v1/images、FLUX 3、FLUX.2、Recraft、Gemini Image 等)
async function callGatewayImageGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', imageModel = 'black-forest-labs/flux-3-image' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = imageModel.trim();

  // 智能映射：将用户输入的 FLUX.1 (如 black-forest-labs/flux-1-schnell) 自动映射为 OpenRouter 官方的 FLUX 3
  if (
    model === 'black-forest-labs/flux-1-schnell' ||
    model === 'black-forest-labs/flux-1-dev' ||
    model.includes('flux-1') ||
    model === 'flux-schnell' ||
    model === 'flux'
  ) {
    console.log(`[OpenRouter Image] 自动将旧版 ${model} 映射为 OpenRouter 官方标准模型: black-forest-labs/flux-3-image`);
    model = 'black-forest-labs/flux-3-image';
  } else if (model === 'recraft-v3') {
    model = 'recraft/recraft-v3';
  }

  // 1. 如果是 OpenRouter 官方网关，直接调用官方统一生图 API: POST https://openrouter.ai/api/v1/images
  if (base.includes('openrouter.ai')) {
    console.log(`[OpenRouter Image] 正在向 ${base}/images 提交生图请求，模型: ${model}...`);
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 生图请求未通过 (HTTP ${resp.status}): ${errMsg}`);
    }

    const data = await resp.json();
    const firstItem = data.data?.[0];
    if (firstItem?.b64_json) {
      const mediaType = firstItem.media_type || 'image/png';
      return `data:${mediaType};base64,${firstItem.b64_json}`;
    }
    if (firstItem?.url) return firstItem.url;
    if (data.url) return data.url;
    throw new Error('OpenRouter 已受理但未返回图片数据');
  }

  // 2. 其他 OpenAI 兼容代理网关：依次尝试 /images、/images/generations
  try {
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const firstItem = data.data?.[0];
      if (firstItem?.b64_json) return `data:${firstItem.media_type || 'image/png'};base64,${firstItem.b64_json}`;
      if (firstItem?.url) return firstItem.url;
    }
  } catch (e) {}

  try {
    const resp = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        size: '1024x576',
        num_inference_steps: 4
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const imgUrl = data.data?.[0]?.url || data.images?.[0]?.url || data.url;
      if (imgUrl) return imgUrl;
    }
  } catch (e) {}

  // 3. 尝试 Chat 接口兼容生图
  const chatResp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: `Generate a high quality 16:9 realistic photo: ${prompt}` }]
    })
  });

  if (!chatResp.ok) {
    throw new Error(`生图请求未通过 (HTTP ${chatResp.status}): ${(await chatResp.text()).slice(0, 200)}`);
  }
  const chatData = await chatResp.json();
  const content = chatData.choices?.[0]?.message?.content || '';
  const m = content.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  if (m) return m[0];
  if (chatData.data?.[0]?.url) return chatData.data[0].url;

  throw new Error('未能从模型返回中提取图片 URL');
}

function readBody(req) {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const queryProject = url.searchParams.get('project') || defaultProjectId;
  const paths = getPaths(queryProject);

  try {
    // 0. 工程列表 API
    if (req.method === 'GET' && pathname === '/api/projects') {
      const projects = listProjects();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          currentProjectId: queryProject,
          projects,
        })
      );
    }

    // 1. 获取工作流完整数据
    if (req.method === 'GET' && pathname === '/api/workflow-data') {
      if (!fs.existsSync(paths.manifestPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({ error: `工程 ${queryProject} 尚未生成 scene-manifest.json` })
        );
      }
      const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
      if (ensureTableFields(manifest)) {
        fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      }
      const assetIndex = fs.existsSync(paths.assetIndexPath)
        ? JSON.parse(fs.readFileSync(paths.assetIndexPath, 'utf8'))
        : { assets: [] };
      const promptConfig = fs.existsSync(paths.promptConfigPath)
        ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'))
        : {
            selected_visual_model: 'remotion_procedural',
            global_ai_visual_prompt:
              '作为 16:9 纪录片视觉总监，结合旁白片段与关键词，在 16:9 画幅中央提炼一个醒目标志大字（不超过 14 字），搭配 1 条副级阐述，用于动效视觉传达。',
          };

      let audioFile = null;
      if (fs.existsSync(paths.audioDir)) {
        const audios = fs.readdirSync(paths.audioDir).filter((f) => /\.(mp3|wav)$/i.test(f));
        if (audios.length > 0) audioFile = `/public/${queryProject}/audio/${audios[0]}`;
      }

      const hasVideo = fs.existsSync(paths.videoPath);
      const videoUrl = hasVideo ? `/output/${queryProject}/final_video_1080p.mp4` : null;

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          projectId: queryProject,
          manifest,
          assetIndex,
          promptConfig,
          hasVideo,
          videoUrl,
          audioUrl: audioFile,
          elevenlabsKeyConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
        })
      );
    }

    // 2. 保存数据库表格修改并同步至 Remotion
    if (req.method === 'POST' && pathname === '/api/workflow-save') {
      const body = await readBody(req);
      const targetProject = body.projectId || queryProject;
      const curPaths = getPaths(targetProject);

      if (body.promptConfig) {
        fs.writeFileSync(
          curPaths.promptConfigPath,
          JSON.stringify(body.promptConfig, null, 2),
          'utf8'
        );
      }
      if (body.manifest) {
        recalculateTimelines(body.manifest);
        syncTableToManifest(body.manifest);
        fs.writeFileSync(
          curPaths.manifestPath,
          JSON.stringify(body.manifest, null, 2),
          'utf8'
        );
      }
      recompileProject(targetProject);
      const updatedManifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, manifest: updatedManifest }));
    }

    // 3. ✂️ 画面切分 (Split Shot)
    if (req.method === 'POST' && pathname === '/api/split-shot') {
      const body = await readBody(req);
      const { sceneIndex, splitCharIndex, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scenes = manifest.scenes || [];
      const idx = typeof sceneIndex === 'number' ? sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

      if (idx >= 0 && idx < scenes.length) {
        const original = scenes[idx];
        const fullText = original.narration_text || '';

        let splitPos = splitCharIndex;
        if (typeof splitPos !== 'number' || splitPos <= 0 || splitPos >= fullText.length) {
          const matchComma = fullText.slice(10).search(/[，,；;。]/);
          splitPos = matchComma !== -1 ? 10 + matchComma + 1 : Math.floor(fullText.length / 2);
        }

        const text1 = fullText.slice(0, splitPos).trim();
        const text2 = fullText.slice(splitPos).trim();

        if (text1 && text2) {
          const ratio = text1.length / (text1.length + text2.length);
          const dur1 = Math.max(3500, Math.round(original.duration_ms * ratio));
          const dur2 = Math.max(3500, original.duration_ms - dur1);

          original.narration_text = text1;
          original.duration_ms = dur1;
          if (original.ppt_slide_spec) {
            original.ppt_slide_spec.subtitle = text1.slice(0, 24);
          }

          const newShot = JSON.parse(JSON.stringify(original));
          newShot.narration_text = text2;
          newShot.duration_ms = dur2;
          newShot.ppt_slide_spec = {
            theme_title: text2.slice(0, 10),
            subtitle: text2.slice(0, 24),
            bullet_points: [`要义阐述：${text2.slice(0, 20)}`],
            custom_prompt: '',
          };
          newShot.shared_asset_with_prev = false;

          scenes.splice(idx + 1, 0, newShot);
          recalculateTimelines(manifest);
          syncTableToManifest(manifest);

          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          recompileProject(targetProject);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, manifest, message: `成功切分为两个镜头：${(dur1/1000).toFixed(1)}s 和 ${(dur2/1000).toFixed(1)}s` }));
        }
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '切分失败：未找到有效切分点' }));
    }

    // 4. 🔗 画面合并 (Merge Shot with Next)
    if (req.method === 'POST' && pathname === '/api/merge-shot') {
      const body = await readBody(req);
      const { sceneIndex, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scenes = manifest.scenes || [];
      const idx = typeof sceneIndex === 'number' ? sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

      if (idx >= 0 && idx < scenes.length - 1) {
        const s1 = scenes[idx];
        const s2 = scenes[idx + 1];

        s1.narration_text = `${s1.narration_text} ${s2.narration_text}`.trim();
        s1.duration_ms = (s1.duration_ms || 5000) + (s2.duration_ms || 5000);
        s1.content_keywords = Array.from(new Set([...(s1.content_keywords || []), ...(s2.content_keywords || [])]));

        if (s1.ppt_slide_spec) {
          s1.ppt_slide_spec.subtitle = s1.narration_text.slice(0, 28);
          s1.ppt_slide_spec.bullet_points = [
            `核心要义：${s1.narration_text.slice(0, 24)}...`,
            `标志关键词：${s1.content_keywords.join(' · ')}`,
          ];
        }

        scenes.splice(idx + 1, 1);
        recalculateTimelines(manifest);
        syncTableToManifest(manifest);

        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        recompileProject(targetProject);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, manifest, message: `成功合并两个镜头，总时长为 ${(s1.duration_ms/1000).toFixed(1)}s` }));
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '合并失败：下一镜头不存在' }));
    }

    // 4.1 测试各平台 API 连接 (OpenRouter / SiliconFlow / Runway / Remotion)
    if (req.method === 'POST' && (pathname === '/api/test-provider' || pathname === '/api/test-openrouter')) {
      const body = await readBody(req);
      const { provider = 'openrouter', apiKey, baseUrl, model } = body;

      if (!apiKey && provider !== 'remotion') {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '请先填入对应平台的 API Key' }));
      }

      const startTime = Date.now();
      try {
        if (provider === 'siliconflow') {
          const cleanBase = (baseUrl || 'https://api.siliconflow.cn/v1').trim().replace(/\/+$/, '');
          const testRes = await fetch(`${cleanBase}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          const latencyMs = Date.now() - startTime;
          if (!testRes.ok) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `SiliconFlow 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            message: `SiliconFlow (硅基流动) 连接成功！模型网关正常（耗时 ${latencyMs}ms）`
          }));
        } else if (provider === 'runway') {
          const cleanBase = (baseUrl || 'https://api.dev.runwayml.com/v1').trim().replace(/\/+$/, '');
          const testRes = await fetch(`${cleanBase}/tasks`, {
            headers: {
              'Authorization': `Bearer ${apiKey.trim()}`,
              'X-Runway-Version': '2024-09-13'
            }
          });
          const latencyMs = Date.now() - startTime;
          if (testRes.status === 401 || testRes.status === 403) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `Runway 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            message: `Runway API 连接正常！耗时 ${latencyMs}ms`
          }));
        } else if (provider === 'remotion') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs: 1,
            message: 'Remotion 内置规则引擎零成本就绪，无需 API Key！'
          }));
        } else {
          // OpenRouter
          const cleanBase = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
          const targetUrl = `${cleanBase}/chat/completions`;
          const testRes = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey.trim()}`,
              'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
              'X-Title': 'WhyVideo Studio'
            },
            body: JSON.stringify({
              model: (model || 'deepseek/deepseek-chat').trim(),
              messages: [{ role: 'user', content: 'Say "OK" in 1 word' }],
              max_tokens: 5,
            }),
          });

          const latencyMs = Date.now() - startTime;
          if (!testRes.ok) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `OpenRouter 响应异常 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }

          const data = await testRes.json();
          const reply = data.choices?.[0]?.message?.content?.trim() || 'OK';
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            model: (model || 'deepseek/deepseek-chat').trim(),
            reply,
            message: `OpenRouter 连接成功！模型 ${model || 'deepseek/deepseek-chat'} 响应正常（耗时 ${latencyMs}ms）`
          }));
        }
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `无法连接到服务: ${err.message}`
        }));
      }
    }

    // 4.15 获取 OpenRouter 真实支持的最新模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 80) : '',
            context_length: m.context_length
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
          { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic Claude Sonnet 4.5' },
          { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
          { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' }
        ]
      }));
    }

    // 4.16 获取 OpenRouter 原生支持的全部 31+ 款 AI 视频生成模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-video-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/videos/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : '',
            durations: m.supported_durations,
            aspect_ratios: m.supported_aspect_ratios
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter video models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'minimax/hailuo-3-max', name: 'MiniMax: H3 Max' },
          { id: 'minimax/hailuo-3', name: 'MiniMax: H3 (海螺视频 3)' },
          { id: 'bytedance/seedance-2.0', name: 'ByteDance: Seedance 2.0' },
          { id: 'alibaba/wan-2.6', name: 'Alibaba: Wan 2.6' },
          { id: 'kwaivgi/kling-v3.0-std', name: 'Kling: Video v3.0 Standard' },
          { id: 'google/veo-3.1-fast', name: 'Google: Veo 3.1 Fast' },
          { id: 'runway/gen-4.5', name: 'Runway: Gen-4.5' }
        ]
      }));
    }

    // 4.17 获取 OpenRouter 原生支持的全部 62+ 款 AI 生图模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-image-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/images/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : ''
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter image models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'black-forest-labs/flux-3-image', name: 'FLUX 3 Image' },
          { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max' },
          { id: 'recraft/recraft-v4.1', name: 'Recraft V4.1' },
          { id: 'google/gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
          { id: 'openai/gpt-image-2', name: 'GPT Image 2' }
        ]
      }));
    }

    // 4.2 保存模型网关配置 (统一 OpenRouter / 网关多模型映射)
    if (req.method === 'POST' && (pathname === '/api/save-visual-config' || pathname === '/api/save-openrouter-config')) {
      const body = await readBody(req);
      const targetProject = body.projectId || queryProject;
      const curPaths = getPaths(targetProject);
      let existing = {};
      if (fs.existsSync(curPaths.promptConfigPath)) {
        try { existing = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
      }
      const updated = {
        ...existing,
        provider: 'openrouter',
        baseUrl: body.baseUrl || existing.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey: body.apiKey !== undefined ? body.apiKey : (existing.apiKey || ''),
        textModel: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
        videoModel: body.videoModel || existing.videoModel || 'minimax/hailuo-3-max',
        imageModel: body.imageModel || existing.imageModel || 'black-forest-labs/flux-3-image',
        model: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
        selected_visual_model: 'openrouter',
        updated_at: new Date().toISOString()
      };

      fs.writeFileSync(curPaths.promptConfigPath, JSON.stringify(updated, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, config: updated, message: 'OpenRouter 统一模型配置已保存！' }));
    }

    // 5. 单行或批量生成 AI 画面与真实实体视频
    if (req.method === 'POST' && (pathname === '/api/generate-ppt' || pathname === '/api/generate-visual')) {
      const body = await readBody(req);
      const {
        sceneId,
        globalPrompt,
        manifest,
        projectId,
        visualTarget = 'video', // 'video' | 'image' | 'card'
        customPrompt,
        templateStyle,
        themeTitle,
      } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      let promptCfg = {};
      if (fs.existsSync(curPaths.promptConfigPath)) {
        try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
      }
      const normalizedCfg = normalizePromptConfig(promptCfg);

      if (globalPrompt !== undefined) {
        normalizedCfg.global_ai_visual_prompt = globalPrompt;
        normalizedCfg.updated_at = new Date().toISOString();
        fs.writeFileSync(curPaths.promptConfigPath, JSON.stringify(normalizedCfg, null, 2), 'utf8');
      }

      const targetManifest = manifest || JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));

      // 5.1 🎬 生成实体真实动态视频 (调用用户指定的视频生成模型)
      if (visualTarget === 'video') {
        const s = (targetManifest.scenes || []).find((sc) => sc.scene_id === sceneId);
        if (!s) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: '未找到指定镜头 ' + sceneId }));
        }

        const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : [];
        let videoPrompt = (customPrompt || '').trim();
        if (!videoPrompt) {
          videoPrompt = `${s.narration_text}，${kws.join('，')}，电影质感，超清4K，慢动作运镜，真实自然光影，细腻纹理`;
        } else if (!videoPrompt.includes('超清') && !videoPrompt.includes('4k') && !videoPrompt.includes('cinematic')) {
          videoPrompt += '，电影质感，超清4K，细腻写实，真实环境光影';
        }

        try {
          const videoUrl = await callGatewayVideoGeneration(
            {
              apiKey: normalizedCfg.apiKey,
              baseUrl: normalizedCfg.baseUrl,
              videoModel: normalizedCfg.videoModel
            },
            videoPrompt
          );

          const safeScene = s.scene_id.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const fileName = `${safeScene}_ai_${Date.now()}.mp4`;
          const relPath = `assets/video/${fileName}`;
          const localDiskPath = path.join(curPaths.publicDir, relPath);

          await downloadRemoteMedia(videoUrl, localDiskPath);

          const reqSec = Number(((s.duration_ms || 5000) / 1000).toFixed(1));
          const assetId = registerGeneratedAsset(curPaths, targetProject, s.scene_id, relPath, 'video', reqSec);

          s.source_mode = 'ai_generated_video';
          s.final_asset_id = assetId;
          s.visual_type = 'broll_video';
          s.scene_type = 'broll_video';
          s.status = 'READY_APPROVED';
          s.review_status = 'APPROVED';
          s.human_review_required = false;
          s.trim_start_sec = 0.0;
          s.trim_end_sec = reqSec;
          s.trim_prompt = `默认前 ${reqSec} 秒`;
          s.preview_image_url = null;
          s.target_visual_mode = 'video';
          if (!s.ppt_slide_spec) s.ppt_slide_spec = {};
          s.ppt_slide_spec.custom_prompt = customPrompt || s.ppt_slide_spec.custom_prompt || '';

          syncTableToManifest(targetManifest);
          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
          recompileProject(targetProject);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            manifest: targetManifest,
            videoUrl: `/public/${targetProject}/${relPath}`,
            assetId,
            message: `🎬 镜头 ${s.scene_id} 实体动态视频已由 ${normalizedCfg.videoModel} 成功生成并下载挂载！`
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }

      // 5.2 🖼️ 生成超写实实景图 (调用指定的生图模型)
      if (visualTarget === 'image') {
        const s = (targetManifest.scenes || []).find((sc) => sc.scene_id === sceneId);
        if (!s) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: '未找到指定镜头 ' + sceneId }));
        }

        const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : [];
        const imgPrompt = (customPrompt || `${s.narration_text}，${kws.join('，')}`) + '，超清写实摄影，8k电影画质，真实光影';

        try {
          const remoteImgUrl = await callGatewayImageGeneration(
            {
              apiKey: normalizedCfg.apiKey,
              baseUrl: normalizedCfg.baseUrl,
              imageModel: normalizedCfg.imageModel
            },
            imgPrompt
          );

          const safeScene = s.scene_id.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const fileName = `${safeScene}_ai_${Date.now()}.jpg`;
          const relPath = `assets/images/${fileName}`;
          const localDiskPath = path.join(curPaths.publicDir, relPath);

          await downloadRemoteMedia(remoteImgUrl, localDiskPath);

          const assetId = registerGeneratedAsset(curPaths, targetProject, s.scene_id, relPath, 'image', null);

          s.source_mode = 'ai_generated_image';
          s.final_asset_id = assetId;
          s.visual_type = 'photo_motion';
          s.scene_type = 'photo_motion';
          s.status = 'READY_APPROVED';
          s.review_status = 'APPROVED';
          s.human_review_required = false;
          s.preview_image_url = `/public/${targetProject}/${relPath}?t=${Date.now()}`;
          s.target_visual_mode = 'image';

          syncTableToManifest(targetManifest);
          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
          recompileProject(targetProject);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            manifest: targetManifest,
            previewUrl: s.preview_image_url,
            assetId,
            message: `🖼️ 镜头 ${s.scene_id} 超清实景图已由 ${normalizedCfg.imageModel} 成功生成并挂载！`
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }

      // 5.3 📊 动态排版卡片 (Remotion 动效卡片 · OpenRouter 文本模型提炼导演)
      const hasOpenRouter = Boolean(normalizedCfg.apiKey);
      let targetScene = null;
      for (const s of targetManifest.scenes || []) {
        if (sceneId && s.scene_id !== sceneId) continue;
        if (!sceneId && s.source_mode !== 'ai_ppt_slide') continue;

        s.source_mode = 'ai_ppt_slide';
        s.target_visual_mode = 'card';
        if (templateStyle) {
          s.visual_type = templateStyle;
        } else if (!s.visual_type || s.visual_type === 'broll_video' || s.visual_type === 'photo_motion') {
          s.visual_type = 'data_card';
        }

        const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : ['核心要点'];
        const activePrompt = customPrompt !== undefined ? customPrompt : (s.ppt_slide_spec?.custom_prompt || '');
        let activeTitle = themeTitle || s.ppt_slide_spec?.theme_title || (kws[0].length >= 4 ? kws[0] : `「${kws[0]}」`);

        let subtitle = s.narration_text.length > 30 ? s.narration_text.slice(0, 30) + '...' : s.narration_text;
        if (activePrompt) {
          subtitle = `${activePrompt.slice(0, 18)} · ${s.narration_text.slice(0, 24)}`;
        }

        let items = [];
        if (s.visual_type === 'versus_dual') {
          items = [
            `传统认知：${s.narration_text.slice(0, 20)}`,
            `全新定义：${activePrompt ? activePrompt.slice(0, 24) : '技术突破与范式演进'}`
          ];
        } else if (s.visual_type === 'document_highlight') {
          items = [
            `法定条款：${s.narration_text.slice(0, 22)}`,
            `管制要求：${activePrompt ? activePrompt.slice(0, 24) : '依据行政令 / 国家安全规范'}`
          ];
        } else {
          items = [
            `核心要义：${s.narration_text.slice(0, 24)}`,
            `标志导引：${activePrompt ? activePrompt.slice(0, 20) : kws.join(' · ')}`
          ];
        }

        // 若配置了 OpenRouter，调用智能视觉总监提炼文案
        if (hasOpenRouter && sceneId && s.scene_id === sceneId) {
          try {
            const aiDirect = await callOpenRouterDirector({ ...normalizedCfg, model: normalizedCfg.textModel }, s, activePrompt, templateStyle);
            if (aiDirect.theme_title) activeTitle = aiDirect.theme_title;
            if (aiDirect.subtitle) subtitle = aiDirect.subtitle;
            if (Array.isArray(aiDirect.bullet_points) && aiDirect.bullet_points.length > 0) {
              items = aiDirect.bullet_points;
            }
            if (aiDirect.recommended_template && !templateStyle) {
              s.visual_type = aiDirect.recommended_template;
            }
          } catch (err) {
            console.warn(`[OpenRouter Warning] ${err.message}, 使用本地规则兜底。`);
          }
        }

        s.ppt_slide_spec = {
          theme_title: activeTitle,
          subtitle: subtitle,
          bullet_points: items,
          custom_prompt: activePrompt,
          template_style: s.visual_type,
          generated_model: hasOpenRouter ? normalizedCfg.textModel : 'remotion_procedural',
          generated_at: new Date().toISOString()
        };

        s.procedural_props = {
          badge_label: `${s.visual_type.toUpperCase()} · ${s.chapter_ref || s.scene_id}`,
          headline: activeTitle,
          subheadline: subtitle,
          items: items,
          custom_prompt: activePrompt,
        };

        if (sceneId && s.scene_id === sceneId) {
          targetScene = s;
        }
      }

      syncTableToManifest(targetManifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
      recompileProject(targetProject);

      let generatedRelPath = null;
      if (targetScene) {
        generatedRelPath = renderRemotionStill(targetProject, targetScene.scene_id);
        if (generatedRelPath) {
          targetScene.preview_image_url = `/public/${targetProject}/${generatedRelPath}?t=${Date.now()}`;
          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
        }
      }

      const modelDisplayName = hasOpenRouter ? `OpenRouter (${normalizedCfg.textModel?.split('/').pop() || 'Claude'})` : 'Remotion';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        manifest: targetManifest,
        previewUrl: generatedRelPath ? `/public/${targetProject}/${generatedRelPath}` : null,
        message: targetScene
          ? `✨ 镜头 ${targetScene.scene_id} 已由 ${modelDisplayName} 提炼并由 Remotion 渲染出 1080p 超清画面！`
          : '⚡ 已为指定镜头完成 AI 画面更新！'
      }));
    }

    // 6. 人工上传本地素材
    if (req.method === 'POST' && pathname === '/api/upload-asset') {
      const body = await readBody(req);
      const { sceneId, fileName, fileType, dataUrl, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid file dataUrl' }));
      }

      const buffer = Buffer.from(matches[2], 'base64');
      const isVideo = (fileType && fileType.startsWith('video/')) || /\.(mp4|mov|webm)$/i.test(fileName);
      const folder = isVideo ? 'assets/video' : 'assets/images';
      const safeFile = `${sceneId.toLowerCase()}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const relPath = `${folder}/${safeFile}`;
      const diskPath = path.join(curPaths.publicDir, relPath);

      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, buffer);

      const assetIndex = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'));
      const newAssetId = `${isVideo ? 'AST-VID-' : 'AST-IMG-'}${String(assetIndex.assets.length + 1).padStart(3, '0')}`;

      const newAsset = {
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${targetProject}/public/${relPath}`,
        file_name: fileName,
        type: isVideo ? 'video' : 'image',
        media_type: isVideo ? 'video' : 'image',
        duration_seconds: isVideo ? 15.0 : null,
        duration_sec: isVideo ? 15.0 : null,
        resolution: '1920x1080',
        license_status: 'approved',
        source_url: `manual_upload://${safeFile}`,
        tags: ['人工上传', sceneId, fileName],
      };
      assetIndex.assets.push(newAsset);
      fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.source_mode = 'manual_upload';
        scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
        scene.scene_type = scene.visual_type;
        scene.final_asset_id = newAssetId;
        scene.status = 'READY_APPROVED';
        if (isVideo) {
          const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
          scene.trim_start_sec = 0.0;
          scene.trim_end_sec = reqSec;
          scene.trim_prompt = `默认前 ${reqSec} 秒`;
        }
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, uploadedAsset: newAsset, manifest, assetIndex }));
    }

    // 7. 一句话 AI 剪辑指令
    if (req.method === 'POST' && pathname === '/api/trim-asset') {
      const body = await readBody(req);
      const { sceneId, prompt, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);

      if (!scene || !scene.final_asset_id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '当前镜头未绑定有效视频素材' }));
      }

      const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
      let startSec = 0.0;
      let endSec = reqSec;
      const pStr = (prompt || '').trim();

      const rangeMatch = pStr.match(/(?:从)?(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:秒)?\s*(?:到|至|-|~)\s*(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:秒)?/i);
      const startMatch = pStr.match(/(?:从|第)\s*(\d+(?:\.\d+)?)\s*(?:秒)?(?:开始|起)?/i);
      const headMatch = pStr.match(/取前\s*(\d+(?:\.\d+)?)\s*秒/i);

      if (rangeMatch) {
        startSec = parseFloat(rangeMatch[1]);
        endSec = parseFloat(rangeMatch[2]);
      } else if (headMatch) {
        startSec = 0.0;
        endSec = parseFloat(headMatch[1]);
      } else if (startMatch) {
        startSec = parseFloat(startMatch[1]);
        endSec = startSec + reqSec;
      } else if (pStr.includes('后半段') || pStr.includes('结尾') || pStr.includes('后')) {
        startSec = Math.max(0, 15.0 - reqSec);
        endSec = 15.0;
      } else if (pStr.includes('中间') || pStr.includes('高潮')) {
        startSec = Math.max(0, (15.0 - reqSec) / 2);
        endSec = startSec + reqSec;
      } else {
        startSec = 0.0;
        endSec = reqSec;
      }

      startSec = Math.max(0, Number(startSec.toFixed(1)));
      endSec = Math.max(startSec + 1.0, Number(endSec.toFixed(1)));

      scene.trim_prompt = pStr;
      scene.trim_start_sec = startSec;
      scene.trim_end_sec = endSec;

      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ok: true,
          manifest,
          trimInfo: { startSec, endSec, duration: (endSec - startSec).toFixed(1) },
          message: `已解析指令「${pStr}」➔ 截取范围：${startSec}s 到 ${endSec}s (持续 ${(endSec - startSec).toFixed(1)}s)`,
        })
      );
    }

    // 8. 清除素材绑定
    if (req.method === 'POST' && pathname === '/api/clear-asset') {
      const body = await readBody(req);
      const { sceneId, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.final_asset_id = null;
        scene.shared_asset_with_prev = false;
        scene.trim_start_sec = undefined;
        scene.trim_end_sec = undefined;
        scene.trim_prompt = undefined;
        scene.source_mode = 'ai_ppt_slide';
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, manifest }));
    }

    // 9. 镜头连用共用素材绑定
    if (req.method === 'POST' && pathname === '/api/link-asset') {
      const body = await readBody(req);
      const { sceneId, assetId, isSharedWithPrev, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.source_mode = 'manual_upload';
        scene.visual_type = 'broll_video';
        scene.scene_type = 'broll_video';
        scene.final_asset_id = assetId || null;
        scene.shared_asset_with_prev = Boolean(isSharedWithPrev);
        scene.status = assetId ? 'READY_APPROVED' : 'NEEDS_HUMAN_ASSET';
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, manifest }));
    }

    // 10. 配音合成接口 (ElevenLabs / Voicebox)
    if (req.method === 'POST' && pathname === '/api/synthesize-voice') {
      const body = await readBody(req);
      const { projectId = queryProject, provider = 'elevenlabs', voiceId = '21m00Tcm4TlvDq8ikWAM', apiKey, text, sceneId } = body;
      const curPaths = getPaths(projectId);
      fs.mkdirSync(curPaths.audioDir, { recursive: true });

      if (provider === 'elevenlabs') {
        const effectiveKey = apiKey || process.env.ELEVENLABS_API_KEY;
        if (!effectiveKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '未配置 ElevenLabs API Key。请在操作界面中输入或在根目录 .env 中写入 ELEVENLABS_API_KEY=xxx' }));
        }

        const outFileName = sceneId ? `voice_${sceneId.toLowerCase()}.mp3` : `narration_${Date.now()}.mp3`;
        const outFilePath = path.join(curPaths.audioDir, outFileName);

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': effectiveKey,
          },
          body: JSON.stringify({
            text: text || '这是来自 WhyVideo 操作界面的测试旁白音频。',
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `ElevenLabs 接口调用失败: ${errText}` }));
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outFilePath, Buffer.from(arrayBuffer));

        const publicAudioUrl = `/public/${projectId}/audio/${outFileName}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, audioUrl: publicAudioUrl, message: `ElevenLabs 配音已成功保存至 ${outFileName}` }));
      } else if (provider === 'voicebox') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, message: 'Voicebox 本地模型已预留端口连接配置。请确保您的本地 Voicebox 服务已启动于 http://localhost:8080。' }));
      }
    }

    // 11. 静态媒体文件路由
    if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
      const parts = pathname.split('/').filter(Boolean);
      let proj = queryProject;
      let relSubPath = '';

      if (parts.length >= 3 && listProjects().some((p) => p.id === parts[1])) {
        proj = parts[1];
        relSubPath = parts.slice(2).join('/');
      } else {
        relSubPath = parts.slice(1).join('/');
      }

      const filePath = path.join(rootDir, 'projects', proj, parts[0], relSubPath);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);

        const range = req.headers.range;
        if (range) {
          const rParts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(rParts[0], 10);
          const end = rParts[1] ? parseInt(rParts[1], 10) : stat.size - 1;
          const chunksize = end - start + 1;
          const file = fs.createReadStream(filePath, { start, end });
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
          });
          return file.pipe(res);
        } else {
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
          return fs.createReadStream(filePath).pipe(res);
        }
      }
    }

    // 主页面渲染
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMainHtml());
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

function startServer(portToTry) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && portToTry === 4000) {
      startServer(4200);
    } else {
      throw err;
    }
  });
  server.listen(portToTry, '0.0.0.0', () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 WhyVideo 视觉模型配置与即时生成工作台已启动！`);
    console.log(`👉 请在浏览器中打开：http://localhost:${portToTry}`);
    console.log(`=============================================================\n`);
  });
}
startServer(Number(PORT));

function renderMainHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhyVideo Studio - 视觉模型配置与生成工作台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0B0F17; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .card { background-color: #151D2A; border: 1px solid #233044; }
    .db-table th { background-color: #1A2436; border-bottom: 2px solid #2E3D52; border-right: 1px solid #233044; position: sticky; top: 0; z-index: 10; }
    .db-table td { border-bottom: 1px solid #233044; border-right: 1px solid #233044; vertical-align: top; }
    .db-table tr:hover td { background-color: #192334; }
    .badge-gold { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); }
    .dropzone-hover { border-color: #38bdf8 !important; background-color: rgba(56, 189, 248, 0.25) !important; transform: scale(1.02); }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-6">
  <div class="max-w-[1720px] mx-auto space-y-5">

    <!-- 顶部导航栏与工程选择 -->
    <header class="flex flex-col lg:flex-row lg:items-center justify-between pb-4 border-b border-gray-800 gap-4">
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            WhyVideo Studio · AI 视频模型调度版
          </span>
          
          <div class="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-inner">
            <span class="text-xs font-bold text-amber-300">📁 制作工程：</span>
            <select id="projectSelect" onchange="onProjectChange(this.value)" class="bg-gray-950 text-white font-extrabold text-xs px-2 py-1 rounded-lg border border-gray-700 focus:outline-none focus:border-amber-400 cursor-pointer">
            </select>
          </div>

          <span id="projectStageBadge" class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            加载中...
          </span>
        </div>

        <h1 id="projectHeaderTitle" class="text-2xl font-black text-white mt-2">
          视觉镜头工作台（AI 视频模型指定 · 行内即时生成与 16:9 预览 · 桌面拖拽）
        </h1>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <!-- 核心新增：AI 视频与画面模型配置中心 -->
        <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition shadow-lg flex items-center gap-1.5">
          🎬 AI 画面/视频模型指定
        </button>
        <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white transition shadow-lg flex items-center gap-1.5">
          🎙️ 配音引擎配置
        </button>
        <button onclick="generateAllPpt()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition shadow-lg flex items-center gap-1.5">
          ⚡ 批量生成全部 AI 画面
        </button>
        <button onclick="saveAll()" class="px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 transition shadow-lg">
          💾 保存镜头表并同步 Remotion
        </button>
        <a href="http://localhost:3100" target="_blank" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-blue-500 text-blue-300 transition">
          🎬 Remotion 预览 (:3100) ↗
        </a>
      </div>
    </header>

    <!-- 视频预览 / 工程状态概览 -->
    <div id="videoContainer" class="card p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
    </div>

    <!-- 统计卡片与节拍看板 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div class="lg:col-span-8 card p-4 rounded-2xl space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-purple-300">🤖 当前指定模型：</span>
            <span id="currentVideoModelBadge" class="px-2 py-0.5 rounded text-[11px] font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">
              🎬 视频: minimax/hailuo-3
            </span>
            <span id="currentTextModelBadge" class="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/25 text-purple-200 border border-purple-500/40">
              ✍️ 分镜: deepseek-chat
            </span>
            <span id="currentImageModelBadge" class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/25 text-blue-200 border border-blue-500/40">
              🖼️ 生图: flux-3-image
            </span>
          </div>
          <button onclick="toggleVisualModelModal()" class="text-xs text-purple-400 hover:underline">
            切换 AI 视频 / 文本 / 生图模型 ⚙️
          </button>
        </div>
        <textarea id="globalPromptInput" rows="2" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-gray-100 focus:outline-none focus:border-purple-500" placeholder="在此输入你的 AI 画面生成规则..."></textarea>
      </div>

      <div class="lg:col-span-4 grid grid-cols-3 gap-3">
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-gray-400">镜头总数</span>
          <span class="text-xl font-black text-white mt-0.5" id="statTotal">-</span>
          <span class="text-[10px] text-gray-500" id="statAvgDur">平均 -s/镜</span>
        </div>
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-emerald-400">🟢 黄金节奏 (≤8.5s)</span>
          <span class="text-xl font-black text-emerald-400 mt-0.5" id="statGold">-</span>
          <span class="text-[10px] text-emerald-500/80">最适眼球留存</span>
        </div>
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-rose-400">🔴 超时镜头 (>10s)</span>
          <span class="text-xl font-black text-rose-400 mt-0.5" id="statOver">-</span>
          <span class="text-[10px] text-rose-500/80">点击 ✂️ 一键切分</span>
        </div>
      </div>
    </div>

    <!-- 视觉镜头主表格 -->
    <div class="card rounded-2xl overflow-hidden border border-gray-800">
      <div class="max-h-[720px] overflow-y-auto overflow-x-auto">
        <table class="w-full text-left text-xs db-table border-collapse">
          <thead>
            <tr class="text-gray-300 font-bold uppercase tracking-wider text-[11px]">
              <th class="p-3 w-32 text-center">镜头序号 / 时长</th>
              <th class="p-3 min-w-[240px]">当前镜头覆盖的旁白文本</th>
              <th class="p-3 min-w-[160px]">16:9 核心标志关键词</th>
              <th class="p-3 w-36">画面方式</th>
              <th class="p-3 min-w-[340px]">🎨 AI 生成画面（点击按钮即时生成 16:9 预览视觉卡）</th>
              <th class="p-3 min-w-[260px] text-center">📥 桌面拖拽素材 / 即时检验与 AI 剪辑</th>
              <th class="p-3 w-28 text-center">节拍调整</th>
            </tr>
          </thead>
          <tbody id="tableBody" class="divide-y divide-gray-800">
          </tbody>
        </table>
      </div>

      <div class="p-3 bg-gray-900/60 border-t border-gray-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-gray-400">💡 <b>提示</b>：点击第 5 列的 <b>【🎨 一键生成本镜头画面】</b>，系统会立即根据指定的 AI 模型在行内渲染出 16:9 科技视觉卡供您肉眼检验！</span>
        </div>
        <button onclick="saveAll()" class="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-bold transition">
          💾 保存修改并同步渲染
        </button>
      </div>
    </div>

  </div>

  <!-- 【核心升级】：全功能 AI 视频与分镜视觉模型控制中心 (OpenRouter 统一网关) -->
  <div id="visualModelModal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
    <div class="card w-full max-w-2xl p-6 rounded-2xl border border-purple-500/50 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <div>
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            🎬 AI 实体视频与分镜模型控制中心 (OpenRouter 统一网关)
          </h3>
          <p class="text-xs text-purple-300/80 mt-0.5">只需填入一个 OpenRouter Key，自由指定实体视频模型、文本分镜模型与超清生图模型</p>
        </div>
        <button onclick="toggleVisualModelModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <div class="space-y-4">
        <!-- 统一网关与 API Key -->
        <div class="p-4 rounded-xl bg-gray-950 border border-purple-500/30 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-purple-300">🔑 统一 API Key 与 网关地址 (适用全部模型)</span>
            <span class="text-[10px] text-gray-400">（仅保存在本地工程，不上传 Git）</span>
          </div>

          <div>
            <label class="block text-[11px] font-bold text-gray-300 mb-1">
              OpenRouter / 网关 API Key：
              <a href="https://openrouter.ai/keys" target="_blank" class="text-purple-400 hover:underline text-[10px] ml-1">获取 Key ↗</a>
            </label>
            <input type="password" id="currentApiKeyInput" placeholder="在此填入您的 OpenRouter API Key (sk-or-v1-...)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono focus:outline-none focus:border-purple-400" />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-[11px] font-bold text-gray-300">
                🌐 API 基础网关地址 (Base URL)：
              </label>
              <div class="flex items-center gap-2">
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://openrouter.ai/api/v1'" class="text-[10px] text-purple-400 hover:underline">
                  OpenRouter 官方
                </button>
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://api.siliconflow.cn/v1'; document.getElementById('currentVideoModelInput').value = 'tencent/HunyuanVideo';" class="text-[10px] text-emerald-400 hover:underline">
                  硅基流动 (实体视频)
                </button>
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://api.minimax.chat/v1'; document.getElementById('currentVideoModelInput').value = 'video-01';" class="text-[10px] text-amber-400 hover:underline">
                  MiniMax 官方
                </button>
              </div>
            </div>
            <input type="text" id="currentBaseUrlInput" value="https://openrouter.ai/api/v1" placeholder="API 基础网关地址 (例如: https://openrouter.ai/api/v1 或第三方中转站)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono focus:outline-none focus:border-purple-400" />
            <p class="text-[10px] text-gray-400 mt-1">
              💡 <b>注意</b>：已全面接入 OpenRouter 原生文生视频 API（POST /api/v1/videos），直接支持 MiniMax 海螺、阿里万象、字节 Seedance、快手可灵 Kling、Google Veo 等全部 31+ 款官方视频模型。
            </p>
          </div>

          <!-- 测试连接按钮 -->
          <div class="flex items-center justify-between pt-1">
            <button type="button" onclick="testCurrentProviderConnection()" id="btnTestProvider"
              class="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-800 hover:bg-purple-900/60 border border-purple-500/40 text-purple-200 transition flex items-center gap-1.5">
              <span>⚡ 测试网关 API 连接</span>
            </button>
            <div id="testConnStatus" class="text-xs text-gray-400 hidden"></div>
          </div>
        </div>

        <!-- 3 大模型分别指定区域 -->
        <div class="space-y-3.5">
          <!-- 1. 🎬 AI 视频生成模型 (Video Generation Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-emerald-500/40 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                <span>🎬 指定 AI 视频生成模型 (Video Generation Model Slug)：</span>
              </label>
              <span class="text-[10px] text-emerald-400/90 font-mono">负责渲染 16:9 真实 MP4 实体视频</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectVideoModelSlug('minimax/hailuo-3')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">MiniMax 海螺 H3</button>
              <button type="button" onclick="selectVideoModelSlug('minimax/hailuo-3-max')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">MiniMax H3 Max</button>
              <button type="button" onclick="selectVideoModelSlug('bytedance/seedance-2.0')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">字节 Seedance 2.0</button>
              <button type="button" onclick="selectVideoModelSlug('alibaba/wan-2.6')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">阿里万象 Wan 2.6</button>
              <button type="button" onclick="selectVideoModelSlug('kwaivgi/kling-v3.0-std')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">快手可灵 Kling v3</button>
              <button type="button" onclick="selectVideoModelSlug('google/veo-3.1-fast')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">Google Veo 3.1</button>
              <button type="button" onclick="selectVideoModelSlug('runway/gen-4.5')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">Runway Gen-4.5</button>
              <button type="button" onclick="selectVideoModelSlug('x-ai/grok-imagine-video-1.5')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">SpaceX Grok Video</button>
            </div>
            <input type="text" id="currentVideoModelInput" list="openrouterVideoModelsList" value="minimax/hailuo-3" placeholder="选择或输入 OpenRouter 支持的视频模型 slug (如: minimax/hailuo-3, alibaba/wan-2.6)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-emerald-500/50 text-emerald-200 font-mono font-bold focus:outline-none focus:border-emerald-400" />
            <datalist id="openrouterVideoModelsList"></datalist>
          </div>

          <!-- 2. ✍️ 文本 / 分镜导演模型 (Text / Director Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-purple-500/30 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                <span>✍️ 指定文本 / 分镜导演模型 (Text / Director Model Slug)：</span>
              </label>
              <span class="text-[10px] text-purple-300/80 font-mono">负责剧本理解、Prompt扩写与卡片提炼</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectTextModelSlug('deepseek/deepseek-chat')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">DeepSeek Chat</button>
              <button type="button" onclick="selectTextModelSlug('anthropic/claude-sonnet-4.5')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">Claude Sonnet 4.5</button>
              <button type="button" onclick="selectTextModelSlug('google/gemini-2.5-flash')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">Gemini 2.5 Flash</button>
              <button type="button" onclick="selectTextModelSlug('openai/gpt-4o-mini')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">GPT-4o Mini</button>
            </div>
            <input type="text" id="currentTextModelInput" value="deepseek/deepseek-chat" placeholder="选择或输入文本大模型 slug (如: deepseek/deepseek-chat, anthropic/claude-3.5-sonnet)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono font-bold focus:outline-none focus:border-purple-400" />
          </div>

          <!-- 3. 🖼️ AI 超清实景生图模型 (Image Generation Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-blue-500/30 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-blue-200 flex items-center gap-1.5">
                <span>🖼️ 指定 AI 超清生图模型 (Image Model Slug)：</span>
              </label>
              <span class="text-[10px] text-blue-300/80 font-mono">负责超清摄影实景图输出</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectImageModelSlug('black-forest-labs/flux-3-image')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">FLUX 3 Image (推荐)</button>
              <button type="button" onclick="selectImageModelSlug('black-forest-labs/flux.2-max')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">FLUX.2 Max (极速)</button>
              <button type="button" onclick="selectImageModelSlug('recraft/recraft-v4.1')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">Recraft V4.1</button>
              <button type="button" onclick="selectImageModelSlug('google/gemini-3.1-flash-image')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">Gemini 3.1 Image</button>
              <button type="button" onclick="selectImageModelSlug('openai/gpt-image-2')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">GPT Image 2</button>
            </div>
            <input type="text" id="currentImageModelInput" list="openrouterImageModelsList" value="black-forest-labs/flux-3-image" placeholder="输入或从下拉列表选择 OpenRouter 生图模型 (如: black-forest-labs/flux-3-image, recraft/recraft-v4.1)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono font-bold focus:outline-none focus:border-blue-400" />
            <datalist id="openrouterImageModelsList"></datalist>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-gray-800">
        <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
          取消
        </button>
        <button onclick="saveVisualModelConfig()" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-600 hover:brightness-110 text-white transition shadow-lg">
          💾 保存并应用全部模型配置
        </button>
      </div>
    </div>
  </div>

  <!-- 配音配置抽屉/弹窗 -->
  <div id="audioModal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="card w-full max-w-xl p-6 rounded-2xl border border-rose-500/40 shadow-2xl space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <h3 class="text-lg font-bold text-white flex items-center gap-2">
          🎙️ AI 配音引擎控制中心
        </h3>
        <button onclick="toggleAudioModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">选择配音提供商：</label>
          <div class="grid grid-cols-2 gap-3">
            <label class="flex items-center gap-2 p-2.5 rounded-xl border border-rose-500 bg-rose-500/10 cursor-pointer text-xs font-bold text-rose-200">
              <input type="radio" name="audioProvider" value="elevenlabs" checked />
              <span>ElevenLabs (Multilingual v2)</span>
            </label>
            <label class="flex items-center gap-2 p-2.5 rounded-xl border border-gray-700 bg-gray-900 cursor-pointer text-xs font-bold text-gray-400">
              <input type="radio" name="audioProvider" value="voicebox" />
              <span>Voicebox 本地模型 (预留)</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">
            ElevenLabs API Key：
            <a href="https://elevenlabs.io" target="_blank" class="text-rose-400 hover:underline text-[11px] font-normal ml-2">获取 API Key ↗</a>
          </label>
          <input type="password" id="elevenlabsKeyInput" placeholder="在此输入 xi-api-key（或在根目录 .env 中写入）..." class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">精选纪录片音色 (Voice ID)：</label>
          <select id="voiceIdSelect" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500">
            <option value="21m00Tcm4TlvDq8ikWAM">Rachel - 知性沉稳纪录片女主播 (推荐中文)</option>
            <option value="ErXwobaYiN019PkySvjV">Antoni - 沉静克制学术旁白 (男声)</option>
            <option value="pNInz6obpgDQGcFmaJgB">Adam - 权威宏大历史讲述 (深沉男声)</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">试听或测试文本：</label>
          <textarea id="sampleAudioText" rows="2" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500">这是来自 WhyVideo 工作台的高保真纪录片旁白语音测试。</textarea>
        </div>

        <div id="audioPlayerContainer" class="hidden p-3 rounded-xl bg-gray-950 border border-gray-800">
          <audio id="audioPreviewPlayer" controls class="w-full h-8"></audio>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-gray-800">
        <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
          关闭
        </button>
        <button onclick="synthesizeTestVoice()" id="btnSynth" class="px-5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition shadow-lg">
          🔊 立即生成测试配音
        </button>
      </div>
    </div>
  </div>

  <!-- Toast 提示 -->
  <div id="toast" class="fixed bottom-6 right-6 px-4 py-2.5 rounded-xl bg-amber-500 text-gray-950 font-extrabold text-xs shadow-2xl transition duration-300 hidden z-50">
  </div>

  <script>
    let activeProjectId = new URLSearchParams(window.location.search).get('project') || localStorage.getItem('whyvideo_active_project') || 'why_ai_renamed_to_si_001';
    let manifestData = null;
    let assetIndexData = null;
    let projectsList = [];
    let currentSelectedModel = 'minimax/hailuo-3';

    let visualConfig = {
      apiKey: '',
      baseUrl: 'https://openrouter.ai/api/v1',
      videoModel: 'minimax/hailuo-3',
      textModel: 'deepseek/deepseek-chat',
      imageModel: 'black-forest-labs/flux-1-schnell'
    };

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 3000);
    }

    function toggleAudioModal() {
      document.getElementById('audioModal').classList.toggle('hidden');
    }

    function toggleVisualModelModal() {
      document.getElementById('visualModelModal').classList.toggle('hidden');
    }

    function selectVideoModelSlug(slug) {
      document.getElementById('currentVideoModelInput').value = slug;
    }

    function selectTextModelSlug(slug) {
      document.getElementById('currentTextModelInput').value = slug;
    }

    function selectImageModelSlug(slug) {
      document.getElementById('currentImageModelInput').value = slug;
    }

    async function testCurrentProviderConnection() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const model = (document.getElementById('currentTextModelInput')?.value || '').trim() || 'deepseek/deepseek-chat';
      const statusEl = document.getElementById('testConnStatus');
      const btn = document.getElementById('btnTestProvider');

      if (!apiKey) {
        alert('请先输入 OpenRouter API Key');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在连接测试...</span>';
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = '<span class="text-amber-400">正在与服务网关通信...</span>';

      try {
        const res = await fetch('/api/test-provider?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openrouter', apiKey, baseUrl, model })
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.innerHTML = '<span class="text-emerald-400 font-bold">✅ ' + data.message + '</span>';
          showToast('✅ ' + data.message);
        } else {
          statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ ' + (data.error || '连接失败') + '</span>';
        }
      } catch (e) {
        statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ 请求失败: ' + e.message + '</span>';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ 测试网关 API 连接</span>';
      }
    }

    async function saveVisualModelConfig() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const videoModel = document.getElementById('currentVideoModelInput').value.trim();
      const textModel = document.getElementById('currentTextModelInput').value.trim();
      const imageModel = document.getElementById('currentImageModelInput').value.trim();

      visualConfig.apiKey = apiKey;
      visualConfig.baseUrl = baseUrl;
      visualConfig.videoModel = videoModel;
      visualConfig.textModel = textModel;
      visualConfig.imageModel = imageModel;

      try {
        const res = await fetch('/api/save-visual-config?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            apiKey,
            baseUrl,
            videoModel,
            textModel,
            imageModel
          })
        });
        const data = await res.json();
        toggleVisualModelModal();
        updateModelBadge();
        renderTable();
        showToast('🎯 已指定视频模型：' + videoModel);
      } catch (e) {
        showToast('❌ 保存失败: ' + e.message);
      }
    }

    function updateModelBadge() {
      const vBadge = document.getElementById('currentVideoModelBadge');
      const tBadge = document.getElementById('currentTextModelBadge');
      const iBadge = document.getElementById('currentImageModelBadge');

      const vModel = (visualConfig.videoModel || 'minimax/hailuo-3-max').split('/').pop();
      const tModel = (visualConfig.textModel || 'deepseek-chat').split('/').pop();
      const iModel = (visualConfig.imageModel || 'flux-3-image').split('/').pop();

      if (vBadge) {
        vBadge.textContent = '🎬 视频: ' + vModel + (visualConfig.apiKey ? ' (Key就绪)' : ' (待填Key)');
      }
      if (tBadge) {
        tBadge.textContent = '✍️ 分镜: ' + tModel;
      }
      if (iBadge) {
        iBadge.textContent = '🖼️ 生图: ' + iModel;
      }
    }

    async function loadProjects() {
      try {
        const res = await fetch('/api/projects?project=' + activeProjectId);
        const data = await res.json();
        projectsList = data.projects || [];
        
        if (!projectsList.some(p => p.id === activeProjectId) && projectsList.length > 0) {
          activeProjectId = projectsList[0].id;
        }

        const sel = document.getElementById('projectSelect');
        sel.innerHTML = projectsList.map(p => \`
          <option value="\${p.id}" \${p.id === activeProjectId ? 'selected' : ''}>
            \${p.title} (\${p.id})
          </option>
        \`).join('');

        const cur = projectsList.find(p => p.id === activeProjectId);
        if (cur) {
          document.getElementById('projectStageBadge').textContent = cur.stage;
          document.getElementById('projectHeaderTitle').textContent = cur.title + ' · 视觉镜头工作台';
        }
      } catch (e) {
        console.error('加载工程列表失败:', e);
      }
    }

    function onProjectChange(newId) {
      activeProjectId = newId;
      localStorage.setItem('whyvideo_active_project', newId);
      const url = new URL(window.location);
      url.searchParams.set('project', newId);
      window.history.pushState({}, '', url);
      loadProjects();
      loadWorkflow();
      showToast('🔀 已切换至工程：' + newId);
    }

    async function loadOpenRouterModels() {
      try {
        const res = await fetch('/api/openrouter-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 列表跳过:', e);
      }
    }

    async function loadOpenRouterVideoModels() {
      try {
        const res = await fetch('/api/openrouter-video-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterVideoModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 视频模型列表跳过:', e);
      }
    }

    async function loadOpenRouterImageModels() {
      try {
        const res = await fetch('/api/openrouter-image-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterImageModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 生图模型列表跳过:', e);
      }
    }

    async function loadWorkflow() {
      try {
        loadOpenRouterModels();
        loadOpenRouterVideoModels();
        loadOpenRouterImageModels();
        const res = await fetch('/api/workflow-data?project=' + activeProjectId);
        if (!res.ok) {
          showToast('⚠️ 当前工程数据正在初始化...');
          return;
        }
        const data = await res.json();
        manifestData = data.manifest;
        assetIndexData = data.assetIndex;
        document.getElementById('globalPromptInput').value =
          data.promptConfig?.global_ai_visual_prompt || '';

        if (data.promptConfig) {
          const cfg = data.promptConfig;
          let rawVideoModel = cfg.videoModel || 'minimax/hailuo-3-max';
          if (rawVideoModel === 'minimax/video-01' || rawVideoModel === 'minimax/hailuo' || rawVideoModel === 'video-01') {
            rawVideoModel = 'minimax/hailuo-3-max';
          }
          let rawImageModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
          if (rawImageModel === 'black-forest-labs/flux-1-schnell' || rawImageModel.includes('flux-1')) {
            rawImageModel = 'black-forest-labs/flux-3-image';
          }

          visualConfig = {
            apiKey: cfg.apiKey || '',
            baseUrl: cfg.baseUrl || 'https://openrouter.ai/api/v1',
            videoModel: rawVideoModel,
            textModel: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
            imageModel: rawImageModel
          };

          const kEl = document.getElementById('currentApiKeyInput');
          const bEl = document.getElementById('currentBaseUrlInput');
          const vEl = document.getElementById('currentVideoModelInput');
          const tEl = document.getElementById('currentTextModelInput');
          const iEl = document.getElementById('currentImageModelInput');

          if (kEl && visualConfig.apiKey) kEl.value = visualConfig.apiKey;
          if (bEl && visualConfig.baseUrl) bEl.value = visualConfig.baseUrl;
          if (vEl && visualConfig.videoModel) vEl.value = visualConfig.videoModel;
          if (tEl && visualConfig.textModel) tEl.value = visualConfig.textModel;
          if (iEl && visualConfig.imageModel) iEl.value = visualConfig.imageModel;

          updateModelBadge();
        }

        renderVideoContainer(data);
        renderTable();
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    }

    function renderVideoContainer(data) {
      const c = document.getElementById('videoContainer');
      const count = manifestData?.scenes?.length || 0;
      const totalSec = manifestData?.total_duration_sec || 0;
      if (data.hasVideo && data.videoUrl) {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">1080p 纯净正片已就绪</span>
              <span class="text-xs text-gray-400">已对齐 \${count} 个视觉镜头 (平均 \${(totalSec/count).toFixed(1)}s/镜)</span>
            </div>
            <p class="text-xs text-gray-300 font-medium">当前工程已完成 Remotion 渲染，支持边查阅表格边拖拽播放进度检验音画节拍。</p>
          </div>
          <div class="w-full md:w-96 rounded-xl overflow-hidden border border-gray-700 bg-black aspect-video flex items-center justify-center">
            <video src="\${data.videoUrl}" controls class="w-full h-full object-contain"></video>
          </div>
        \`;
      } else {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">视觉镜头轨已就绪 · \${count} 个镜头</span>
              <span class="text-xs text-gray-400">全片约 \${(totalSec/60).toFixed(1)} 分钟 · 平均 \${(totalSec/count).toFixed(1)} 秒/镜头</span>
            </div>
            <p class="text-xs text-gray-300 font-normal">点击每行的 <b>【🎨 一键生成本镜头画面】</b>，可调用所选的 AI 模型在行内即时渲染出 16:9 视觉预览！桌面素材直接拖入右侧框中即可检验。</p>
          </div>
          <div class="flex items-center gap-3">
            <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition">
              🎬 指定 AI 视频模型
            </button>
            <a href="http://localhost:3100" target="_blank" class="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition">
              🎬 打开 Remotion 预览
            </a>
          </div>
        \`;
      }
    }

    function updateCounters() {
      const scenes = manifestData?.scenes || [];
      const totalCount = scenes.length;
      const totalSec = manifestData?.total_duration_sec || 0;
      const avgSec = totalCount > 0 ? (totalSec / totalCount).toFixed(1) : 0;

      const goldCount = scenes.filter((s) => s.duration_ms <= 8500).length;
      const overCount = scenes.filter((s) => s.duration_ms > 10000).length;

      document.getElementById('statTotal').textContent = totalCount + ' 镜';
      document.getElementById('statAvgDur').textContent = \`平均 \${avgSec}s / 镜\`;
      document.getElementById('statGold').textContent = goldCount + ' 镜';
      document.getElementById('statOver').textContent = overCount + ' 镜';
    }

    function renderTable() {
      updateCounters();
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      (manifestData?.scenes || []).forEach((scene, idx) => {
        const isAi = scene.source_mode === 'ai_ppt_slide';
        const ppt = scene.ppt_slide_spec || {};
        const kws = Array.isArray(scene.content_keywords) ? scene.content_keywords : [];
        const durSec = (scene.duration_ms / 1000).toFixed(1);

        let badgeClass = 'badge-gold';
        let badgeLabel = \`🟢 \${durSec}s · 黄金节奏\`;
        if (scene.duration_ms > 10000) {
          badgeClass = 'badge-danger';
          badgeLabel = \`🔴 \${durSec}s · 建议切分 ✂️\`;
        } else if (scene.duration_ms > 8500) {
          badgeClass = 'badge-warn';
          badgeLabel = \`🟡 \${durSec}s · 偏长\`;
        }

        const isSharedWithPrev = Boolean(scene.shared_asset_with_prev);
        const tr = document.createElement('tr');
        tr.className = 'transition ' + (isSharedWithPrev ? 'bg-sky-950/20' : '');

        // 1. 镜头序号与时长
        const td1 = document.createElement('td');
        td1.className = 'p-3 text-center';
        td1.innerHTML = \`
          <span class="px-2 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-amber-400 font-extrabold text-xs block mb-1">
            \${scene.scene_id}
          </span>
          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold block mb-1 \${badgeClass}">
            \${badgeLabel}
          </span>
          <span class="text-[10px] text-gray-500 block font-mono">
            \${(scene.start_ms / 1000).toFixed(1)}s - \${(scene.end_ms / 1000).toFixed(1)}s
          </span>
          <span class="text-[10px] text-gray-400 block mt-0.5">\${scene.chapter_ref || ''}</span>
        \`;

        // 2. 旁白片段
        const td2 = document.createElement('td');
        td2.className = 'p-3';
        td2.innerHTML = \`
          <textarea rows="3" class="w-full p-2.5 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-xs leading-relaxed focus:border-blue-500 focus:outline-none"
            onchange="onNarrationEdit(\${idx}, this.value)">\${scene.narration_text}</textarea>
        \`;

        // 3. 核心标志关键词
        const td3 = document.createElement('td');
        td3.className = 'p-3';
        const chips = kws
          .map(
            (k) =>
              \`<span class="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-semibold"># \${k}</span>\`
          )
          .join('');
        td3.innerHTML = \`
          <div class="flex flex-wrap gap-1 mb-1.5">\${chips}</div>
          <input type="text" value="\${kws.join(', ')}"
            placeholder="核心标志词，用逗号分隔..."
            class="w-full px-2.5 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-xs focus:border-purple-400 focus:outline-none font-semibold"
            onchange="onKeywordsEdit(\${idx}, this.value)" />
          <p class="text-[10px] text-gray-500 mt-1">在 16:9 画幅中央醒目展示</p>
        \`;

        // 4. 画面生成方式
        const td4 = document.createElement('td');
        td4.className = 'p-3';
        td4.innerHTML = \`
          <div class="space-y-1.5">
            <label onclick="setMode(\${idx}, 'ai_ppt_slide')" class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition \${
              isAi
                ? 'bg-purple-500/20 border-purple-500 text-purple-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_\${idx}" \${isAi ? 'checked' : ''} />
              <span class="text-xs">🤖 AI 生成画面</span>
            </label>
            <label onclick="setMode(\${idx}, 'manual_upload')" class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition \${
              !isAi
                ? 'bg-sky-500/20 border-sky-500 text-sky-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_\${idx}" \${!isAi ? 'checked' : ''} />
              <span class="text-xs">📤 人工素材/拖拽</span>
            </label>
          </div>
        \`;

        // 5. 【核心升级】：视觉呈现方式三选一 (🎬实体视频 / 🖼️超写实图 / 📊动效卡片) + 即时生成与真实预览
        const td5 = document.createElement('td');
        td5.className = 'p-3';

        const curVisualType = scene.visual_type || 'data_card';
        const curTargetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
        const mainTitle = ppt.theme_title || kws[0] || '核心要点';
        const subtitle = ppt.subtitle || scene.narration_text.slice(0, 24);
        const hasPreviewImage = Boolean(scene.preview_image_url);

        const assetRecord = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const hasGeneratedVideo = Boolean(scene.final_asset_id && scene.visual_type === 'broll_video' && assetRecord);
        const generatedVideoSrc = hasGeneratedVideo ? ('/public/' + activeProjectId + '/' + assetRecord.path) : null;

        const pName = (visualConfig.videoModel || 'tencent/hunyuan-video').split('/').pop();
        const iName = (visualConfig.imageModel || 'flux-1-schnell').split('/').pop();

        let innerContent = '';

        if (curTargetMode === 'video') {
          // 🎬 实体真实动态视频形态
          innerContent = \`
            <!-- Prompt 指导输入窗口 -->
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">🎬 视频描述 & 运镜指示词 (Text-to-Video):</span>
              </div>
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入本镜头实体视频提示词（例如: 温泉酒店体验，热气升腾，日式露天风吕，4k电影质感，慢动作运镜...）"
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <!-- 一键生成实体视频按钮 -->
            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎬 一键生成真实动态视频 (\${pName})</span>
              </button>
            </div>

            <!-- 实体视频行内真实播放器或预览占位 -->
            \${hasGeneratedVideo ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <video src="\${generatedVideoSrc}" controls class="w-full h-full object-cover"></video>
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40 flex items-center gap-1 pointer-events-none">
                  <span>✅ 实体 MP4 视频就绪 (时长: \${durSec}s)</span>
                </div>
              </div>
            \` : \`
              <div class="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-gray-950 via-teal-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between relative overflow-hidden group">
                <div class="flex items-center justify-between">
                  <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">
                    待生成 · 🎬 实体动态视频 (MP4)
                  </span>
                  <span class="text-[9px] text-gray-500 font-mono">1920x1080 · \${durSec}s</span>
                </div>

                <div class="my-auto text-center px-1">
                  <h4 class="text-xs font-bold text-gray-200 line-clamp-2">
                    \${scene.narration_text}
                  </h4>
                  <p class="text-[10px] text-emerald-400/90 mt-1 line-clamp-1 font-mono">
                    \${ppt.custom_prompt ? ('🎯 ' + ppt.custom_prompt) : (kws.length ? ('标志: ' + kws.join(' · ')) : '等待指令')}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-1 border-t border-emerald-500/20 text-[9px] text-emerald-300/70">
                  <span>⚡ 点击上方按钮调用 \${pName} 生成实体视频</span>
                  <span>⏱️ 需 \${durSec}s</span>
                </div>
              </div>
            \`}
          \`;
        } else if (curTargetMode === 'image') {
          // 🖼️ 超写实实景图形态
          innerContent = \`
            <div class="space-y-1">
              <span class="text-[10px] text-purple-300 font-bold">🖼️ 实景图视觉指示词 (FLUX HD):</span>
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入实景图描述词（如：极简日式露天风吕，水汽氤氲，雪山远景，8k超清写实...）"
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🖼️ 一键生成超清实景图 (\${iName})</span>
              </button>
            </div>

            \${hasPreviewImage ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="\${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="Image Still 1080p" onclick="window.open(this.src)" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ 超清实景图已挂载</span>
                </div>
              </div>
            \` : \`
              <div class="rounded-xl border border-blue-500/30 bg-gray-950 p-2.5 aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-blue-500/20 text-blue-300 w-fit">待生成 · 超清实景图</span>
                <p class="text-xs text-center text-gray-300 line-clamp-2">\${scene.narration_text}</p>
                <div class="text-[9px] text-blue-300/70 text-center">点击上方按钮由 \${iName} 生成超清实景图</div>
              </div>
            \`}
          \`;
        } else {
          // 📊 动效排版卡片形态
          innerContent = \`
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-gray-400 font-bold whitespace-nowrap">模板:</span>
              <select class="w-full text-[11px] px-2 py-1 rounded-lg bg-gray-900 border border-purple-500/30 text-purple-200 font-semibold focus:outline-none focus:border-purple-400"
                onchange="onSceneVisualTypeChange(\${idx}, this.value)">
                <option value="data_card" \${curVisualType === 'data_card' ? 'selected' : ''}>📊 科技大字冲击卡 (DataCard)</option>
                <option value="document_highlight" \${curVisualType === 'document_highlight' ? 'selected' : ''}>📜 历史公文/法案卡 (DocHighlight)</option>
                <option value="versus_dual" \${curVisualType === 'versus_dual' ? 'selected' : ''}>⚖️ 对比双栏卡 (VersusDual)</option>
                <option value="timeline" \${curVisualType === 'timeline' ? 'selected' : ''}>⏱️ 时间线推进卡 (Timeline)</option>
                <option value="kinetic_text" \${curVisualType === 'kinetic_text' ? 'selected' : ''}>⚡ 动感文字聚光卡 (KineticText)</option>
              </select>
            </div>

            <div class="space-y-1">
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入卡片 Prompt 指导词..."
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-gray-400 font-bold whitespace-nowrap">大字:</span>
              <input id="title_input_\${idx}" type="text" value="\${ppt.theme_title || ''}" placeholder="修改核心大字标题..."
                class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-200 font-bold text-[11px] focus:border-purple-400 focus:outline-none"
                onchange="onPptThemeEdit(\${idx}, 'theme_title', this.value)" />
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎨 一键生成排版卡片 (1080p Remotion Still)</span>
              </button>
            </div>

            \${hasPreviewImage ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="\${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="Remotion Still 1080p" onclick="window.open(this.src)" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ Remotion 引擎渲染 (1080p)</span>
                </div>
              </div>
            \` : \`
              <div class="rounded-xl border border-purple-500/40 bg-gradient-to-br from-gray-950 via-purple-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-purple-500/25 text-purple-300 w-fit">草稿待生成 · 动效卡片</span>
                <div class="my-auto text-center px-1">
                  <h4 class="text-sm font-black text-purple-200">\${mainTitle}</h4>
                  <p class="text-[10px] text-gray-300 mt-1 line-clamp-1">\${subtitle}</p>
                </div>
                <div class="text-[9px] text-purple-300/70 text-center">点击上方按钮由 Remotion 渲染出图</div>
              </div>
            \`}
          \`;
        }

        td5.innerHTML = \`
          <div class="space-y-2 \${isAi ? '' : 'opacity-40 pointer-events-none'}">
            <!-- 视觉呈现形态三态切换 -->
            <div class="flex items-center p-0.5 rounded-lg bg-gray-950 border border-gray-800 text-[10px] font-bold">
              <button type="button" onclick="setVisualTarget(\${idx}, 'video')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'video' ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🎬 实体视频
              </button>
              <button type="button" onclick="setVisualTarget(\${idx}, 'image')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'image' ? 'bg-blue-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🖼️ 超写实图
              </button>
              <button type="button" onclick="setVisualTarget(\${idx}, 'card')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'card' ? 'bg-purple-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                📊 动效卡片
              </button>
            </div>

            \${innerContent}
          </div>
        \`;

        // 6. 桌面拖拽放置框 + 在线检验播放器 + 一句话 AI 剪辑
        const td6 = document.createElement('td');
        td6.className = 'p-3';

        const asset = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const prevScene = idx > 0 ? manifestData.scenes[idx - 1] : null;

        let linkHtml = '';
        if (idx > 0 && prevScene) {
          if (isSharedWithPrev) {
            linkHtml = \`
              <div class="p-1 rounded-lg bg-sky-950/70 border border-sky-500/50 text-[10px] text-sky-300 font-bold flex items-center justify-between gap-1 mb-1.5">
                <span>🔗 连用上一镜头素材</span>
                <button onclick="unlinkScene(\${idx})" class="text-rose-400 hover:text-rose-300 text-xs">✕ 取消</button>
              </div>
            \`;
          } else {
            linkHtml = \`
              <button onclick="linkWithPrevious(\${idx})" class="w-full px-2 py-1 rounded-lg bg-gray-800 hover:bg-sky-600 border border-gray-700 hover:border-sky-400 text-gray-300 hover:text-white text-[10px] font-semibold transition mb-1.5 block">
                🔗 与上一镜头连用 (共用视频)
              </button>
            \`;
          }
        }

        if (asset && scene.source_mode === 'manual_upload') {
          const isVideo = asset.type === 'video' || /\.(mp4|mov|webm)$/i.test(asset.path || '');
          const videoSrc = \`/public/\${activeProjectId}/\${asset.path}\`;

          td6.innerHTML = \`
            <div class="space-y-1.5">
              \${linkHtml}
              <div class="border border-sky-500/40 bg-sky-950/30 rounded-xl p-2.5 text-left space-y-1.5"
                   ondragover="onFileDragOver(event, \${idx})"
                   ondragleave="onFileDragLeave(event, \${idx})"
                   ondrop="onFileDrop(event, \${idx})">
                <div class="flex items-center justify-between">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-sky-500/20 text-sky-300 truncate max-w-[130px]" title="\${asset.file_name || asset.asset_id}">
                    \${asset.file_name || asset.asset_id}
                  </span>
                  <span class="text-[10px] text-emerald-400 font-mono font-bold">
                    ⏱️ 需 \${durSec}s
                  </span>
                </div>

                \${
                  isVideo
                    ? \`
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <video src="\${videoSrc}" controls class="w-full h-full object-contain"></video>
                    </div>
                    <div class="pt-1 space-y-1">
                      <div class="flex items-center gap-1">
                        <input type="text" id="trimInput_\${idx}"
                               placeholder="💬 剪辑指令 (如:从第3秒到第8秒 / 截取前段)"
                               value="\${scene.trim_prompt || ''}"
                               class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-gray-700 text-white text-[10px] focus:border-sky-400 focus:outline-none" />
                        <button onclick="applyAiTrim(\${idx})" class="px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] whitespace-nowrap shadow">
                          ✂️ 截取
                        </button>
                      </div>
                      \${
                        scene.trim_start_sec !== undefined
                          ? \`
                          <div class="text-[10px] text-emerald-400 font-mono flex items-center justify-between">
                            <span>🎯 截取: \${scene.trim_start_sec}s ➔ \${scene.trim_end_sec}s</span>
                            <button onclick="resetTrim(\${idx})" class="text-rose-400 hover:underline">重置</button>
                          </div>
                        \`
                          : ''
                      }
                    </div>
                  \`
                    : \`
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <img src="\${videoSrc}" class="w-full h-full object-cover" />
                    </div>
                  \`
                }

                <div class="flex items-center justify-between pt-1 border-t border-gray-800/80 text-[10px]">
                  <button onclick="document.getElementById('fileInput_\${idx}').click()" class="text-sky-400 hover:underline">
                    从桌面拖入替换
                  </button>
                  <button onclick="clearAsset(\${idx})" class="text-rose-400 hover:underline">
                    清除
                  </button>
                </div>
              </div>
            </div>
          \`;
        } else {
          td6.innerHTML = \`
            <div class="space-y-1.5">
              \${linkHtml}
              <div id="dropzone_\${idx}"
                   class="border-2 border-dashed border-sky-500/40 hover:border-sky-300 bg-sky-950/25 hover:bg-sky-900/35 rounded-xl p-3 text-center transition cursor-pointer group"
                   ondragover="onFileDragOver(event, \${idx})"
                   ondragleave="onFileDragLeave(event, \${idx})"
                   ondrop="onFileDrop(event, \${idx})"
                   onclick="document.getElementById('fileInput_\${idx}').click()">
                <div class="text-sky-300 text-xl mb-1 group-hover:scale-110 transition">📥</div>
                <div class="text-[11px] font-bold text-sky-200">从桌面拖入视频 / 图片</div>
                <div class="text-[10px] text-gray-400 mt-0.5">松开即自动绑定并在线检验</div>
              </div>
            </div>
          \`;
        }

        const hiddenFile = document.createElement('input');
        hiddenFile.type = 'file';
        hiddenFile.id = 'fileInput_' + idx;
        hiddenFile.className = 'hidden';
        hiddenFile.accept = 'video/*,image/*';
        hiddenFile.onchange = (e) => uploadFileForRow(idx, e.target.files[0]);
        td6.appendChild(hiddenFile);

        // 7. 镜头节拍操作列 (切分 & 合并)
        const td7 = document.createElement('td');
        td7.className = 'p-3 text-center';
        td7.innerHTML = \`
          <div class="flex flex-col gap-1.5">
            <button onclick="splitShotPrompt(\${idx})" class="w-full px-2 py-1.5 rounded-lg bg-purple-600/25 hover:bg-purple-600 border border-purple-500/40 text-purple-200 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm">
              <span>✂️ 切分</span>
            </button>
            \${
              idx < (manifestData.scenes.length - 1)
                ? \`<button onclick="mergeShotWithNext(\${idx})" class="w-full px-2 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm">
                    <span>🔗 合并</span>
                  </button>\`
                : ''
            }
          </div>
        \`;

        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);
        tr.appendChild(td6);
        tr.appendChild(td7);
        tbody.appendChild(tr);
      });
    }

    function onFileDragOver(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.add('dropzone-hover');
    }

    function onFileDragLeave(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');
    }

    function onFileDrop(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        manifestData.scenes[idx].source_mode = 'manual_upload';
        uploadFileForRow(idx, file);
      }
    }

    async function applyAiTrim(idx) {
      const scene = manifestData.scenes[idx];
      const input = document.getElementById('trimInput_' + idx);
      const promptText = input ? input.value.trim() : '';

      if (!promptText) {
        alert('请输入剪辑指令，例如：“从第3秒到第8秒” 或 “取前5秒”');
        return;
      }

      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: promptText,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✨ ' + data.message);
      } else {
        alert(data.error || '剪辑失败');
      }
    }

    async function resetTrim(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: '从0秒开始',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('↺ 已重置截取范围');
      }
    }

    async function clearAsset(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/clear-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已清除当前镜头素材绑定');
      }
    }

    async function splitShotPrompt(idx) {
      const scene = manifestData.scenes[idx];
      const text = scene.narration_text || '';
      
      const defaultSplit = prompt(
        \`【方案 A 镜头切分】当前镜头时长 \${(scene.duration_ms/1000).toFixed(1)}s：\\n\"\${text}\"\\n\\n请输入第一段要保留的文字（留空将自动在中间逗号处一分为二）：\`,
        ''
      );

      if (defaultSplit === null) return;

      let splitCharIndex = undefined;
      if (defaultSplit.trim()) {
        const found = text.indexOf(defaultSplit.trim());
        if (found !== -1) {
          splitCharIndex = found + defaultSplit.trim().length;
        }
      }

      const res = await fetch('/api/split-shot?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          splitCharIndex,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✂️ ' + data.message);
      } else {
        alert(data.error || '切分失败');
      }
    }

    async function mergeShotWithNext(idx) {
      const s1 = manifestData.scenes[idx];
      const s2 = manifestData.scenes[idx + 1];
      if (!confirm(\`确认将 \${s1.scene_id} 与 \${s2.scene_id} 合并为一个视觉镜头吗？\\n合并后总时长约为 \${((s1.duration_ms + s2.duration_ms)/1000).toFixed(1)} 秒。\`)) {
        return;
      }

      const res = await fetch('/api/merge-shot?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('🔗 ' + data.message);
      } else {
        alert(data.error || '合并失败');
      }
    }

    function onNarrationEdit(idx, val) {
      manifestData.scenes[idx].narration_text = val;
    }

    function onKeywordsEdit(idx, val) {
      const arr = val.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean);
      manifestData.scenes[idx].content_keywords = arr;
      if (arr.length > 0 && manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec.theme_title = arr[0].length >= 4 ? arr[0] : '「' + arr[0] + '」';
      }
      renderTable();
    }

    function setMode(idx, mode) {
      manifestData.scenes[idx].source_mode = mode;
      renderTable();
    }

    function onPptThemeEdit(idx, key, val) {
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec[key] = val;
      renderTable();
    }

    async function linkWithPrevious(idx) {
      if (idx <= 0) return;
      const prevScene = manifestData.scenes[idx - 1];
      const targetAssetId = prevScene.final_asset_id;

      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: targetAssetId,
          isSharedWithPrev: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('🔗 已与上一镜头 ' + prevScene.scene_id + ' 建立素材连用！');
      }
    }

    async function unlinkScene(idx) {
      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: null,
          isSharedWithPrev: false,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已取消与上一镜头的连用。');
      }
    }

    function onSceneVisualTypeChange(idx, val) {
      if (!manifestData.scenes[idx]) return;
      manifestData.scenes[idx].visual_type = val;
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec.template_style = val;
      renderTable();
      showToast('🎨 镜头 ' + manifestData.scenes[idx].scene_id + ' 样式已切换为: ' + val);
    }

    function setVisualTarget(idx, mode) {
      if (!manifestData.scenes[idx]) return;
      manifestData.scenes[idx].target_visual_mode = mode;
      renderTable();
      showToast('🎯 镜头 ' + manifestData.scenes[idx].scene_id + ' 视觉形式已切换为: ' + (mode === 'video' ? '🎬 实体视频 (MP4)' : mode === 'image' ? '🖼️ 超写实图' : '📊 动效卡片'));
    }

    async function generateRowPpt(idx) {
      const scene = manifestData.scenes[idx];
      const targetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
      const btn = document.getElementById('gen_btn_' + idx);
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 正在请求 AI 引擎生成' + (targetMode === 'video' ? '真实实体视频 (约 20~40 秒)' : targetMode === 'image' ? '超清实景图' : '1080p动效卡片') + '...</span>';
      }

      const promptInput = document.getElementById('prompt_input_' + idx);
      const titleInput = document.getElementById('title_input_' + idx);
      const customPrompt = promptInput ? promptInput.value : (scene.ppt_slide_spec?.custom_prompt || '');
      const themeTitle = titleInput ? titleInput.value : (scene.ppt_slide_spec?.theme_title || '');
      const globalPrompt = document.getElementById('globalPromptInput').value;

      try {
        const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            visualTarget: targetMode,
            globalPrompt,
            customPrompt,
            themeTitle,
            templateStyle: scene.visual_type || 'data_card',
            manifest: manifestData,
            selectedModel: visualConfig.videoModel,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          await loadWorkflow();
          showToast('✨ ' + (data.message || ('已生成 ' + scene.scene_id + ' 的画面！')));
        } else {
          showToast('❌ 生成失败: ' + (data.error || '未知错误'));
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
          }
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    async function generateAllPpt() {
      const globalPrompt = document.getElementById('globalPromptInput').value;
      const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: null,
          globalPrompt,
          manifest: manifestData,
          selectedModel: visualConfig.videoModel,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('⚡ 已批量为全部 180 镜生成 16:9 AI 画面！');
      }
    }

    async function uploadFileForRow(idx, file) {
      if (!file) return;
      const scene = manifestData.scenes[idx];
      showToast('⏳ 正在上传并检验 ' + file.name + ' ...');
      const reader = new FileReader();
      reader.onload = async () => {
        const res = await fetch('/api/upload-asset?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            fileName: file.name,
            fileType: file.type,
            dataUrl: reader.result,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          renderTable();
          showToast('✅ 成功绑定素材并进入检验模式！');
        } else {
          alert(data.error || '上传失败');
        }
      };
      reader.readAsDataURL(file);
    }

    async function saveAll() {
      const globalPrompt = document.getElementById('globalPromptInput').value;
      const res = await fetch('/api/workflow-save?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          manifest: manifestData,
          promptConfig: {
            selected_visual_model: visualConfig.videoModel,
            global_ai_visual_prompt: globalPrompt,
            updated_at: new Date().toISOString(),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✅ 已保存镜头表格，并同步至 Remotion 视频引擎！');
      }
    }

    async function synthesizeTestVoice() {
      const btn = document.getElementById('btnSynth');
      const apiKey = document.getElementById('elevenlabsKeyInput').value;
      const voiceId = document.getElementById('voiceIdSelect').value;
      const text = document.getElementById('sampleAudioText').value;

      btn.disabled = true;
      btn.textContent = '⏳ 正在合成中...';

      try {
        const res = await fetch('/api/synthesize-voice?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            provider: 'elevenlabs',
            voiceId,
            apiKey,
            text,
          }),
        });
        const data = await res.json();
        if (data.ok && data.audioUrl) {
          const playerCont = document.getElementById('audioPlayerContainer');
          const player = document.getElementById('audioPreviewPlayer');
          player.src = data.audioUrl;
          playerCont.classList.remove('hidden');
          player.play();
          showToast('🎉 配音合成成功！已自动播放');
        } else {
          alert(data.error || '合成配音失败');
        }
      } catch (err) {
        alert('配音请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔊 立即生成测试配音';
      }
    }

    loadProjects().then(() => {
      loadWorkflow();
    });
  </script>
</body>
</html>`;
}
