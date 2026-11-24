import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBody, normalizePromptConfig } from '../lib/config.mjs';
import { callOpenRouterText } from '../lib/llm-gateway.mjs';
import { callGatewayImageGeneration, downloadRemoteMedia } from '../lib/media-gateway.mjs';

const DEFAULT_PROMPT = '你是一位中文 YouTube 视频编辑。请根据文案生成准确、有吸引力的标题、简介和搜索标签。标题清晰自然，简介概括视频内容，标签覆盖主题、相关人物和常见搜索词。不要编造事实，不要编造章节时间。';
const COVER_CANDIDATES = [
  { fileName: 'publish-cover.jpg', mimeType: 'image/jpeg' },
  { fileName: 'publish-cover.png', mimeType: 'image/png' },
];
const YOUTUBE_MAX_COVER_BYTES = 2 * 1024 * 1024;

function findExistingCover(publicDir) {
  if (!publicDir || !fs.existsSync(publicDir)) return null;
  let latest = null;
  for (const candidate of COVER_CANDIDATES) {
    const fullPath = path.join(publicDir, candidate.fileName);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size === 0) continue;
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = { ...candidate, fullPath, mtimeMs: stat.mtimeMs };
      }
    } catch {}
  }
  return latest;
}

export async function handlePublishRoutes(req, res, { pathname, paths, queryProject }) {
  if (!['/api/publish/generate', '/api/publish/prompt', '/api/publish/cover', '/api/publish/generate-cover'].includes(pathname)) return false;
  const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); return true; };
  const projectId = queryProject || path.basename(paths.projectDir);
  const promptPath = path.join(paths.dataDir, 'publish-prompt.json');
  const getPrompt = () => { try { const saved = JSON.parse(fs.readFileSync(promptPath, 'utf8')); return typeof saved.prompt === 'string' && saved.prompt.trim() ? saved.prompt : DEFAULT_PROMPT; } catch { return DEFAULT_PROMPT; } };
  try {
    if (pathname === '/api/publish/cover' && req.method === 'GET') {
      const existing = findExistingCover(paths.publicDir);
      if (!existing) return respond(200, { coverUrl: null });
      return respond(200, {
        coverUrl: '/public/' + encodeURIComponent(projectId) + '/' + existing.fileName + '?t=' + Math.round(existing.mtimeMs),
        fileName: existing.fileName,
        mimeType: existing.mimeType,
      });
    }
    if (pathname === '/api/publish/generate-cover' && req.method === 'POST') {
      const body = await readBody(req);
      const keywords = typeof body.keywords === 'string' ? body.keywords.trim() : '';
      if (!keywords || keywords.length > 1000) {
        return respond(400, { error: '请输入封面关键词（1~1000 字符）。' });
      }
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
      const normalizedCfg = normalizePromptConfig(cfg);
      const apiKey = (normalizedCfg.apiKey || process.env.OPENROUTER_API_KEY || '').trim();
      if (!apiKey) {
        return respond(400, { error: '未配置 API Key，请先在视觉分镜台右上角「AI 全流程模型调度中心」配置 API Key 与生图模型。' });
      }
      const titleHint = typeof body.title === 'string' && body.title.trim()
        ? `，视频主题参考：${body.title.trim().slice(0, 80)}`
        : '';
      const coverPrompt = `YouTube 16:9 高点击率视频封面缩略图，核心关键词与画面元素：${keywords}${titleHint}，视觉主体突出、电影级戏剧光影、构图饱满清晰、高对比度、超清画质`;
      const remoteImgUrl = await callGatewayImageGeneration(
        { apiKey, baseUrl: normalizedCfg.baseUrl, imageModel: normalizedCfg.imageModel },
        coverPrompt
      );
      fs.mkdirSync(paths.publicDir, { recursive: true });
      const tmpPath = path.join(paths.publicDir, `.publish-cover-${Date.now()}.tmp`);
      let finalName = 'publish-cover.jpg';
      let mimeType = 'image/jpeg';
      try {
        await downloadRemoteMedia(remoteImgUrl, tmpPath, apiKey);
        const buf = fs.readFileSync(tmpPath);
        const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        if ((isPng || isJpg) && buf.length <= YOUTUBE_MAX_COVER_BYTES) {
          finalName = isPng ? 'publish-cover.png' : 'publish-cover.jpg';
          mimeType = isPng ? 'image/png' : 'image/jpeg';
          fs.renameSync(tmpPath, path.join(paths.publicDir, finalName));
        } else {
          const finalPath = path.join(paths.publicDir, finalName);
          const ff = spawnSync(
            'ffmpeg',
            ['-y', '-i', tmpPath, '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', finalPath],
            { encoding: 'utf8' }
          );
          if (ff.status !== 0 || !fs.existsSync(finalPath)) {
            throw new Error(`封面格式转换失败: ${(ff.stderr || ff.error?.message || '未知错误').slice(-200)}`);
          }
        }
        const altName = finalName === 'publish-cover.png' ? 'publish-cover.jpg' : 'publish-cover.png';
        const altPath = path.join(paths.publicDir, altName);
        if (fs.existsSync(altPath)) fs.unlinkSync(altPath);
      } finally {
        if (fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
      }
      return respond(200, {
        ok: true,
        coverUrl: '/public/' + encodeURIComponent(projectId) + '/' + finalName + '?t=' + Date.now(),
        fileName: finalName,
        mimeType,
        model: normalizedCfg.imageModel,
      });
    }
    if (pathname === '/api/publish/prompt' && req.method === 'GET') return respond(200, {prompt: getPrompt(), defaultPrompt: DEFAULT_PROMPT});
    if (pathname === '/api/publish/prompt' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.reset === true) { if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath); return respond(200, {prompt: DEFAULT_PROMPT}); }
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) return respond(400, {error:'提示词不能为空，且不能超过 12000 个字符。'});
      fs.mkdirSync(paths.dataDir, {recursive:true}); fs.writeFileSync(promptPath, JSON.stringify({prompt:body.prompt.trim()}, null, 2));
      return respond(200, {prompt:body.prompt.trim()});
    }
    if (pathname !== '/api/publish/generate' || req.method !== 'POST') return false;
    if (!fs.existsSync(paths.finalScriptPath)) return respond(400, { error: '当前工程没有文案终稿，请先在文案创作台完成定稿。' });
    const script = fs.readFileSync(paths.finalScriptPath, 'utf8');
    if (!script.trim() || script.trim() === '{}' || script.trim() === '[]') return respond(400, { error: '当前工程的文案终稿为空。' });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
    const instruction = getPrompt() + '\n\n输出格式要求：只返回 JSON 对象，包含 title（标题字符串，不超过100字符）、description（简介字符串）和 tags（搜索标签字符串数组），标签总长度不超过400字符。';
    const result = await callOpenRouterText(instruction, script.slice(0, 100000), { model: cfg.writerModel || cfg.textModel, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxTokens: 2000 });
    if (!result) return respond(502, { error: globalThis.__lastWriterLlmError || 'AI 生成失败，请检查模型配置。' });
    const cleaned = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned);
    if (typeof data.title !== 'string' || typeof data.description !== 'string' || !data.title.trim() || !data.description.trim() || !Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === 'string')) throw new Error('AI 返回的标题、简介或标签格式不正确，请重试。');
    return respond(200, { title: data.title.trim().slice(0, 100), description: data.description.trim(), tags: data.tags.map(t => t.trim()).filter(Boolean) });
  } catch (err) { return respond(500, { error: '操作失败：' + err.message }); }
}
