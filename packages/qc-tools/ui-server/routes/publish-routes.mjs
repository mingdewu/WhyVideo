import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBody, normalizePromptConfig } from '../lib/config.mjs';
import { callOpenRouterText } from '../lib/llm-gateway.mjs';
import { parseSrt, renderSrt } from '../lib/publish-localization.mjs';
import { callGatewayImageGeneration, downloadRemoteMedia } from '../lib/media-gateway.mjs';
import {
  createAuthorizationUrl,
  disconnectOAuth,
  getValidAccessToken,
  handleOAuthCallback,
  saveOAuthCredentials,
} from '../lib/youtube-oauth.mjs';

const DEFAULT_PROMPT = '你是一位中文 YouTube 视频编辑。请根据文案生成准确、有吸引力的标题、简介和搜索标签。标题清晰自然，简介概括视频内容，标签覆盖主题、相关人物和常见搜索词。不要编造事实，不要编造章节时间。';
const COVER_CANDIDATES = [
  { fileName: 'publish-cover.jpg', mimeType: 'image/jpeg' },
  { fileName: 'publish-cover.png', mimeType: 'image/png' },
];
const YOUTUBE_MAX_COVER_BYTES = 2 * 1024 * 1024;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function buildOAuthCallbackHtml({ ok, channelTitle = '', error = '' }) {
  const payload = JSON.stringify({
    type: 'whyvideo-youtube-oauth',
    ok: Boolean(ok),
    channelTitle: String(channelTitle || ''),
    error: String(error || ''),
  }).replace(/</g, '\\u003c');
  const titleText = ok ? 'YouTube 授权成功' : 'YouTube 授权失败';
  const heading = ok
    ? `已成功连接频道：${escapeHtml(channelTitle || 'YouTube 频道')}`
    : `授权未完成：${escapeHtml(error || '未知错误')}`;
  const subText = ok
    ? '已保存长期自动续期令牌，此窗口将自动关闭；如未自动关闭，请手动关闭后返回发布台。'
    : '请关闭此窗口并返回发布台检查配置后重试。';
  const accentColor = ok ? '#10b981' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titleText)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1419; color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
    .card { max-width: 460px; width: 100%; background: #111827; border: 1px solid #374151; border-radius: 16px; padding: 24px; box-sizing: border-box; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; color: ${accentColor}; border: 1px solid ${accentColor}; margin-bottom: 12px; }
    h1 { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
    p { margin: 0 0 18px; font-size: 14px; color: #9ca3af; line-height: 1.6; }
    button { background: #374151; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${escapeHtml(titleText)}</div>
    <h1>${heading}</h1>
    <p>${escapeHtml(subText)}</p>
    <button type="button" onclick="window.close()">关闭窗口</button>
  </div>
  <script>
    (function () {
      var payload = ${payload};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      if (payload.ok) {
        setTimeout(function () { window.close(); }, 600);
      }
    })();
  </script>
</body>
</html>`;
}

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

export async function handlePublishRoutes(req, res, { url, pathname, paths, queryProject }) {
  const isYoutubeRoute = pathname.startsWith('/api/publish/youtube/');
  if (!isYoutubeRoute && !['/api/publish/generate', '/api/publish/prompt', '/api/publish/cover', '/api/publish/generate-cover', '/api/publish/localizations', '/api/publish/localize', '/api/publish/check-srt'].includes(pathname)) return false;
  const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); return true; };
  if (pathname === '/api/publish/youtube/token' && req.method === 'GET') {
    const forceRefresh = url?.searchParams?.get('force') === '1';
    const tokenResult = await getValidAccessToken({ forceRefresh });
    return respond(200, tokenResult);
  }
  if (pathname === '/api/publish/youtube/oauth/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const saved = saveOAuthCredentials({ clientId: body?.clientId, clientSecret: body?.clientSecret });
      return respond(200, saved);
    } catch (err) {
      return respond(400, { error: err.message });
    }
  }
  if (pathname === '/api/publish/youtube/oauth/start' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (body && typeof body.clientId === 'string' && body.clientId.trim()) {
        saveOAuthCredentials({ clientId: body.clientId, clientSecret: body.clientSecret });
      }
      const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = protoHeader === 'https' ? 'https' : 'http';
      const host = req.headers.host || 'localhost:4000';
      const redirectUri = `${proto}://${host}/api/publish/youtube/oauth/callback`;
      const result = createAuthorizationUrl({ redirectUri });
      return respond(200, { ok: true, authUrl: result.authUrl, redirectUri: result.redirectUri });
    } catch (err) {
      return respond(400, { error: err.message });
    }
  }
  if (pathname === '/api/publish/youtube/oauth/callback' && req.method === 'GET') {
    const code = url?.searchParams?.get('code') || '';
    const state = url?.searchParams?.get('state') || '';
    const error = url?.searchParams?.get('error') || '';
    try {
      const result = await handleOAuthCallback({ code, state, error });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildOAuthCallbackHtml({ ok: true, channelTitle: result.channelTitle }));
      return true;
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildOAuthCallbackHtml({ ok: false, error: err.message }));
      return true;
    }
  }
  if (pathname === '/api/publish/youtube/oauth/disconnect' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = disconnectOAuth({ clearCredentials: Boolean(body?.clearCredentials) });
      return respond(200, result);
    } catch (err) {
      return respond(400, { error: err.message });
    }
  }
  if (isYoutubeRoute) return false;
  const projectId = queryProject || path.basename(paths.projectDir);
  const promptPath = path.join(paths.dataDir, 'publish-prompt.json');
  const getPrompt = () => { try { const saved = JSON.parse(fs.readFileSync(promptPath, 'utf8')); return typeof saved.prompt === 'string' && saved.prompt.trim() ? saved.prompt : DEFAULT_PROMPT; } catch { return DEFAULT_PROMPT; } };
  try {
    const localizationPath = path.join(paths.dataDir, 'publish-localizations.json');
    if (pathname === '/api/publish/localizations' && req.method === 'GET') {
      try { return respond(200, JSON.parse(fs.readFileSync(localizationPath, 'utf8'))); }
      catch (err) { if (err.code === 'ENOENT') return respond(200, {}); throw err; }
    }
    if (pathname === '/api/publish/localizations' && req.method === 'POST') {
      const data = await readBody(req);
      if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 3000000) return respond(400, {error:'多语言资料格式错误或超过大小限制。'});
      fs.mkdirSync(paths.dataDir, {recursive:true});
      const temp = localizationPath + '.' + process.pid + '.' + Date.now() + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, localizationPath);
      return respond(200, {ok:true});
    }
    if (pathname === '/api/publish/check-srt' && req.method === 'POST') {
      const body = await readBody(req);
      const result = parseSrt(body.captions);
      const duration = Number(body.duration);
      if (duration > 0 && result.cues.some(c => c.end > duration * 1000 + 100)) result.warnings.push('有字幕超过成片时长');
      return respond(200, {count:result.cues.length, warnings:result.warnings});
    }
    if (pathname === '/api/publish/localize' && req.method === 'POST') {
      const body = await readBody(req);
      const languages = {en:'英语', ja:'日语'};
      if (!languages[body.language] || !['metadata','captions'].includes(body.kind)) return respond(400, {error:'不支持的语言或翻译类型。'});
      let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
      const options = { model: cfg.writerModel || cfg.textModel, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxTokens: 4500 };
      const call = async (system, input) => {
        const result = await callOpenRouterText(system, input, options);
        if (!result) throw new Error(globalThis.__lastWriterLlmError || 'AI 生成失败，请检查模型配置。');
        return JSON.parse(result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      };
      if (body.kind === 'metadata') {
        if (!String(body.title || '').trim() || !String(body.description || '').trim()) return respond(400, {error:'请先填写原版标题和简介。'});
        const data = await call(`将视频标题和简介本地化为${languages[body.language]}。标题自然准确，不编造事实；保留链接、已有时间戳及章节。只返回 JSON 对象，包含 title 和 description 字符串。`, JSON.stringify({title:body.title, description:body.description}));
        if (typeof data.title !== 'string' || !data.title.trim() || typeof data.description !== 'string' || !data.description.trim()) throw new Error('AI 返回的标题或简介格式错误。');
        return respond(200, {title:data.title.trim(), description:data.description.trim()});
      }
      const parsed = parseSrt(body.captions);
      const translated = [];
      for (let i = 0; i < parsed.cues.length; i += 20) {
        const batch = parsed.cues.slice(i, i + 20);
        const data = await call(`将字幕正文翻译成${languages[body.language]}，结合上下文，保留专名、数字和语义。只返回 JSON 字符串数组，每个元素对应一条字幕，数量和顺序必须完全一致；不得添加说明或空字幕。`, JSON.stringify(batch.map(c => c.text)));
        if (!Array.isArray(data) || data.length !== batch.length || data.some(x => typeof x !== 'string' || !x.trim() || /\n\s*\n/.test(x))) throw new Error(`第 ${i + 1} 段起的翻译结果格式不正确，请重试。`);
        translated.push(...batch.map((c, j) => ({...c, text:data[j].trim()})));
      }
      return respond(200, {captions:renderSrt(translated)});
    }
    if (pathname === '/api/publish/cover'  && req.method === 'GET') {
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
