import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBody, normalizePromptConfig } from '../lib/config.mjs';
import { resolveProjectVideoPath } from '../../project-paths.mjs';
import { callOpenRouterText } from '../lib/llm-gateway.mjs';
import {
  englishDubJobs,
  dubJobKey,
  normalizeDubLang,
  extractChineseSourceNarration,
  translateChineseNarration,
  getEnglishDubArtifacts,
  runEnglishDubJob,
  cancelEnglishDubJob,
} from '../lib/english-dub-service.mjs';
import { callGatewayImageGeneration, downloadRemoteMedia } from '../lib/media-gateway.mjs';
import {
  createAuthorizationUrl,
  disconnectOAuth,
  getValidAccessToken,
  handleOAuthCallback,
  saveOAuthCredentials,
} from '../lib/youtube-oauth.mjs';

const DEFAULT_PROMPT = '你是一位中文 YouTube 视频编辑。请根据文案生成准确、有吸引力的标题、简介和搜索标签。标题清晰自然，简介概括视频内容，标签覆盖主题、相关人物和常见搜索词。不要编造事实，不要编造章节时间。';
const DEFAULT_COVER_PROMPT = 'YouTube 16:9 高点击率视频封面缩略图，核心关键词与画面元素：{keywords}{titleHint}，视觉主体突出、电影级戏剧光影、构图饱满清晰、高对比度、超清画质';

function loadPublishPromptStore(promptPath) {
  try {
    const saved = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
    return {
      prompt: typeof saved?.prompt === 'string' && saved.prompt.trim() ? saved.prompt.trim() : DEFAULT_PROMPT,
      coverPrompt: typeof saved?.coverPrompt === 'string' && saved.coverPrompt.trim() ? saved.coverPrompt.trim() : DEFAULT_COVER_PROMPT,
    };
  } catch {
    return { prompt: DEFAULT_PROMPT, coverPrompt: DEFAULT_COVER_PROMPT };
  }
}

function savePublishPromptStore(promptPath, store) {
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  const tempPath = `${promptPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tempPath, promptPath);
}
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

function findCoverFromCandidates(publicDir, candidates) {
  let latest = null;
  for (const candidate of candidates) {
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

function findExistingCover(publicDir, lang = 'zh') {
  if (!publicDir || !fs.existsSync(publicDir)) return null;
  if (lang === 'en' || lang === 'ja') {
    const langCandidates = [
      { fileName: `publish-cover.${lang}.jpg`, mimeType: 'image/jpeg' },
      { fileName: `publish-cover.${lang}.png`, mimeType: 'image/png' },
    ];
    const langHit = findCoverFromCandidates(publicDir, langCandidates);
    if (langHit) return { ...langHit, isFallback: false };
  }
  const baseHit = findCoverFromCandidates(publicDir, COVER_CANDIDATES);
  return baseHit ? { ...baseHit, isFallback: lang !== 'zh' } : null;
}

function normalizePublishLang(lang) {
  return lang === 'en' || lang === 'ja' ? lang : 'zh';
}

function loadPublishCopy(dataDir) {
  const defaultCopy = { zh: {}, en: {}, ja: {} };
  if (!dataDir) return defaultCopy;
  const copyPath = path.join(dataDir, 'publish-copy.json');
  if (!fs.existsSync(copyPath)) return defaultCopy;
  try {
    const parsed = JSON.parse(fs.readFileSync(copyPath, 'utf8'));
    return {
      zh: parsed?.zh && typeof parsed.zh === 'object' ? parsed.zh : {},
      en: parsed?.en && typeof parsed.en === 'object' ? parsed.en : {},
      ja: parsed?.ja && typeof parsed.ja === 'object' ? parsed.ja : {},
    };
  } catch {
    return defaultCopy;
  }
}

function savePublishCopy(dataDir, copy) {
  fs.mkdirSync(dataDir, { recursive: true });
  const copyPath = path.join(dataDir, 'publish-copy.json');
  const tempPath = `${copyPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(copy, null, 2), 'utf8');
  fs.renameSync(tempPath, copyPath);
}

export async function handlePublishRoutes(req, res, { url, pathname, paths, queryProject }) {
  const isYoutubeRoute = pathname.startsWith('/api/publish/youtube/');
  if (!isYoutubeRoute && ![
    '/api/publish/generate',
    '/api/publish/prompt',
    '/api/publish/ai-settings',
    '/api/publish/copy',
    '/api/publish/translate-copy',
    '/api/publish/translate-script',
    '/api/publish/video',
    '/api/publish/cover',
    '/api/publish/generate-cover',
    '/api/publish/english-dub',
    '/api/publish/english-dub/generate',
    '/api/publish/english-dub/status',
    '/api/publish/english-dub/cancel',
    '/api/publish/english-dub/save-srt',
  ].includes(pathname)) return false;
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
  const getPrompt = () => loadPublishPromptStore(promptPath).prompt;
  try {
    if (pathname === '/api/publish/copy' && req.method === 'GET') {
      return respond(200, { ok: true, copy: loadPublishCopy(paths.dataDir) });
    }
    if (pathname === '/api/publish/copy' && req.method === 'POST') {
      const body = await readBody(req);
      const lang = normalizePublishLang(body?.lang);
      const copy = loadPublishCopy(paths.dataDir);
      copy[lang] = {
        title: typeof body?.title === 'string' ? body.title.slice(0, 100) : (copy[lang]?.title || ''),
        description: typeof body?.description === 'string' ? body.description.slice(0, 20000) : (copy[lang]?.description || ''),
        tags: typeof body?.tags === 'string' ? body.tags.slice(0, 2000) : (copy[lang]?.tags || ''),
        coverKeywords: typeof body?.coverKeywords === 'string' ? body.coverKeywords.slice(0, 1000) : (copy[lang]?.coverKeywords || ''),
        updatedAt: new Date().toISOString(),
      };
      savePublishCopy(paths.dataDir, copy);
      return respond(200, { ok: true, lang, copy });
    }
    if (pathname === '/api/publish/translate-copy' && req.method === 'POST') {
      const body = await readBody(req);
      const targetLang = body?.targetLang === 'ja' ? 'ja' : (body?.targetLang === 'en' ? 'en' : '');
      if (!targetLang) return respond(400, { error: '请选择目标语言（en 或 ja）。' });
      const langName = targetLang === 'ja' ? '日语 (日本語)' : '英语 (English)';
      const copy = loadPublishCopy(paths.dataDir);
      const srcTitle = String(body?.title ?? copy.zh?.title ?? '').trim();
      const srcDesc = String(body?.description ?? copy.zh?.description ?? '').trim();
      const srcTags = String(body?.tags ?? copy.zh?.tags ?? '').trim();
      const srcKeywords = String(body?.coverKeywords ?? copy.zh?.coverKeywords ?? '').trim();

      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
      const llmOptions = { model: cfg.translateModel || cfg.textModel || cfg.writerModel, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxTokens: 2200 };

      let systemPrompt = '';
      let userInput = '';
      if (srcTitle || srcDesc) {
        systemPrompt = `你是一位资深多语言 YouTube 视频主编。请将以下中文 YouTube 视频发布资料（标题、简介、标签、封面关键词）地道地本土化翻译为${langName}。要求：1. 标题自然吸睛且准确，不超过 100 字符；2. 简介保留原有的结构、时间戳与链接；3. 标签符合${langName}观众搜索习惯（返回字符串数组或逗号分隔字符串）；4. 只返回 JSON 对象，包含 title、description、tags、coverKeywords 字段。`;
        userInput = JSON.stringify({ title: srcTitle, description: srcDesc, tags: srcTags, coverKeywords: srcKeywords });
      } else {
        const scriptText = extractChineseSourceNarration(paths);
        if (!scriptText) {
          return respond(400, { error: '请先在中文界面填写标题和简介，或在文案创作台完成文案终稿。' });
        }
        systemPrompt = `你是一位资深多语言 YouTube 视频主编。请根据以下视频文案，直接使用${langName}撰写准确、吸引人的 YouTube 视频标题、简介、搜索标签和封面画面关键词。只返回 JSON 对象，包含 title（不超过 100 字符）、description、tags（字符串数组）和 coverKeywords（字符串）。`;
        userInput = scriptText.slice(0, 60000);
      }

      const result = await callOpenRouterText(systemPrompt, userInput, llmOptions);
      if (!result) return respond(502, { error: globalThis.__lastWriterLlmError || 'AI 翻译失败，请检查模型配置。' });
      const cleaned = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.title !== 'string' || !parsed.title.trim() || typeof parsed?.description !== 'string' || !parsed.description.trim()) {
        throw new Error('AI 返回的翻译格式不正确，请重试。');
      }
      const tagsStr = Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t || '').trim()).filter(Boolean).join(', ')
        : String(parsed.tags || '').trim();
      const translatedData = {
        title: parsed.title.trim().slice(0, 100),
        description: parsed.description.trim(),
        tags: tagsStr,
        coverKeywords: typeof parsed.coverKeywords === 'string' ? parsed.coverKeywords.trim() : srcKeywords,
        updatedAt: new Date().toISOString(),
      };
      if (srcTitle || srcDesc || srcTags || srcKeywords) {
        copy.zh = {
          title: srcTitle || copy.zh?.title || '',
          description: srcDesc || copy.zh?.description || '',
          tags: srcTags || copy.zh?.tags || '',
          coverKeywords: srcKeywords || copy.zh?.coverKeywords || '',
          updatedAt: new Date().toISOString(),
        };
      }
      copy[targetLang] = translatedData;
      savePublishCopy(paths.dataDir, copy);
      return respond(200, { ok: true, targetLang, data: translatedData, copy });
    }
    if (pathname === '/api/publish/translate-script' && req.method === 'POST') {
      const body = await readBody(req);
      const targetLang = body?.targetLang === 'ja' ? 'ja' : (body?.targetLang === 'en' ? 'en' : '');
      if (!targetLang) return respond(400, { error: '请选择目标语言（en 或 ja）。' });
      const scriptText = await translateChineseNarration(paths, targetLang);
      return respond(200, { ok: true, targetLang, scriptText });
    }
    if (pathname === '/api/publish/english-dub' && req.method === 'GET') {
      const lang = normalizeDubLang(url?.searchParams?.get('lang'));
      const key = dubJobKey(projectId, lang);
      return respond(200, {
        ok: true,
        ...getEnglishDubArtifacts(projectId, paths, lang),
        job: englishDubJobs.get(key) || null,
        copy: loadPublishCopy(paths.dataDir),
      });
    }
    if (pathname === '/api/publish/english-dub/status' && req.method === 'GET') {
      const lang = normalizeDubLang(url?.searchParams?.get('lang'));
      const key = dubJobKey(projectId, lang);
      return respond(200, {
        ok: true,
        job: englishDubJobs.get(key) || null,
        artifacts: getEnglishDubArtifacts(projectId, paths, lang),
      });
    }
    if (pathname === '/api/publish/english-dub/generate' && req.method === 'POST') {
      const body = await readBody(req);
      const lang = normalizeDubLang(body?.lang || url?.searchParams?.get('lang'));
      const langLabel = lang === 'ja' ? '日语' : '英语';
      const key = dubJobKey(projectId, lang);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const autoTranslate = !text || Boolean(body.autoTranslate);
      const engine = body.engine === 'elevenlabs' ? 'elevenlabs' : (body.engine === 'voicebox' || !body.engine ? 'voicebox' : '');
      if (!engine) return respond(400, { error: '不支持的配音引擎，请选择 voicebox 或 elevenlabs。' });
      const existing = englishDubJobs.get(key);
      if (existing && ['preparing', 'translating', 'generating', 'transcribing'].includes(existing.status)) {
        return respond(409, { error: `当前工程已有正在执行的${langLabel}配音任务，请等待完成或先取消。` });
      }
      const job = {
        projectId,
        lang,
        engine,
        status: autoTranslate ? 'translating' : 'preparing',
        progressText: autoTranslate
          ? `正在用大模型将中文终稿翻译为${langLabel}旁白稿…`
          : `正在准备生成${langLabel}音频与同步字幕…`,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        audioUrl: null,
        audioFileName: null,
        srtUrl: null,
        srtFileName: null,
        srtText: '',
        durationSec: null,
      };
      englishDubJobs.set(key, job);
      void runEnglishDubJob(job, {
        lang,
        text,
        autoTranslate,
        engine,
        profileId: typeof body.profileId === 'string' ? body.profileId.trim() : '',
        voiceId: typeof body.voiceId === 'string' ? body.voiceId.trim() : '',
        modelId: typeof body.modelId === 'string' ? body.modelId.trim() : 'eleven_v4',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : '',
        paths,
      });
      return respond(200, { ok: true, job });
    }
    if (pathname === '/api/publish/english-dub/cancel' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const lang = normalizeDubLang(body?.lang || url?.searchParams?.get('lang'));
      const cancelled = cancelEnglishDubJob(projectId, lang);
      return respond(200, { ok: true, cancelled });
    }
    if (pathname === '/api/publish/english-dub/save-srt' && req.method === 'POST') {
      const body = await readBody(req);
      const lang = normalizeDubLang(body?.lang || url?.searchParams?.get('lang'));
      const srt = typeof body.srt === 'string' ? body.srt : '';
      if (!srt.trim() || srt.length > 3000000) {
        return respond(400, { error: '字幕内容为空或超过 3MB 限制。' });
      }
      fs.mkdirSync(paths.outputDir, { recursive: true });
      const fileName = `${projectId}_${lang}.srt`;
      const targetPath = path.join(paths.outputDir, fileName);
      const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, srt, 'utf8');
      fs.renameSync(tempPath, targetPath);
      return respond(200, {
        ok: true,
        lang,
        fileName,
        srtUrl: `/output/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}?t=${Date.now()}`,
      });
    }
    if (pathname === '/api/publish/video' && req.method === 'GET') {
      const resolvedVideoPath = resolveProjectVideoPath(paths);
      if (!resolvedVideoPath) return respond(200, { hasVideo: false, videoUrl: null, fileName: null });
      const fileName = path.basename(resolvedVideoPath);
      const stat = fs.statSync(resolvedVideoPath);
      return respond(200, {
        hasVideo: true,
        videoUrl: '/output/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(fileName) + '?t=' + Math.round(stat.mtimeMs),
        fileName,
      });
    }
    if (pathname === '/api/publish/cover'  && req.method === 'GET') {
      const lang = normalizePublishLang(url?.searchParams?.get('lang'));
      const existing = findExistingCover(paths.publicDir, lang);
      if (!existing) return respond(200, { coverUrl: null });
      return respond(200, {
        coverUrl: '/public/' + encodeURIComponent(projectId) + '/' + existing.fileName + '?t=' + Math.round(existing.mtimeMs),
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        isFallback: Boolean(existing.isFallback),
      });
    }
    if (pathname === '/api/publish/generate-cover' && req.method === 'POST') {
      const body = await readBody(req);
      const lang = normalizePublishLang(body?.lang || url?.searchParams?.get('lang'));
      const baseName = lang === 'zh' ? 'publish-cover' : `publish-cover.${lang}`;
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
      const coverTpl = loadPublishPromptStore(promptPath).coverPrompt;
      let coverPrompt = coverTpl
        .replace(/\{keywords\}/g, keywords)
        .replace(/\{titleHint\}/g, titleHint);
      if (!coverTpl.includes('{keywords}')) {
        coverPrompt = `${coverPrompt}，核心关键词与画面元素：${keywords}${titleHint}`;
      }
      const effectiveCoverModel = (normalizedCfg.publishCoverModel || normalizedCfg.imageModel || '').trim();
      const remoteImgUrl = await callGatewayImageGeneration(
        { apiKey, baseUrl: normalizedCfg.baseUrl, imageModel: effectiveCoverModel },
        coverPrompt
      );
      fs.mkdirSync(paths.publicDir, { recursive: true });
      const tmpPath = path.join(paths.publicDir, `.${baseName}-${Date.now()}.tmp`);
      let finalName = `${baseName}.jpg`;
      let mimeType = 'image/jpeg';
      try {
        await downloadRemoteMedia(remoteImgUrl, tmpPath, apiKey);
        const buf = fs.readFileSync(tmpPath);
        const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        if ((isPng || isJpg) && buf.length <= YOUTUBE_MAX_COVER_BYTES) {
          finalName = isPng ? `${baseName}.png` : `${baseName}.jpg`;
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
        const altName = finalName === `${baseName}.png` ? `${baseName}.jpg` : `${baseName}.png`;
        const altPath = path.join(paths.publicDir, altName);
        if (fs.existsSync(altPath)) fs.unlinkSync(altPath);
      } finally {
        if (fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
      }
      return respond(200, {
        ok: true,
        lang,
        coverUrl: '/public/' + encodeURIComponent(projectId) + '/' + finalName + '?t=' + Date.now(),
        fileName: finalName,
        mimeType,
        model: effectiveCoverModel,
      });
    }
    if (pathname === '/api/publish/ai-settings' && req.method === 'GET') {
      let rawCfg = {};
      try { rawCfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
      const normalizedCfg = normalizePromptConfig(rawCfg);
      const store = loadPublishPromptStore(promptPath);
      return respond(200, {
        ok: true,
        translateModel: rawCfg.translateModel || '',
        coverModel: rawCfg.publishCoverModel || '',
        fallbackTranslateModel: normalizedCfg.translateModel,
        fallbackCoverModel: normalizedCfg.imageModel,
        prompt: store.prompt,
        defaultPrompt: DEFAULT_PROMPT,
        coverPrompt: store.coverPrompt,
        defaultCoverPrompt: DEFAULT_COVER_PROMPT,
      });
    }
    if (pathname === '/api/publish/ai-settings' && req.method === 'POST') {
      const body = await readBody(req);
      let rawCfg = {};
      try { rawCfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
      if (body.reset === true) {
        if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath);
        const normalizedCfg = normalizePromptConfig(rawCfg);
        return respond(200, {
          ok: true,
          translateModel: rawCfg.translateModel || '',
          coverModel: rawCfg.publishCoverModel || '',
          fallbackTranslateModel: normalizedCfg.translateModel,
          fallbackCoverModel: normalizedCfg.imageModel,
          prompt: DEFAULT_PROMPT,
          coverPrompt: DEFAULT_COVER_PROMPT,
        });
      }
      const nextPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      const nextCoverPrompt = typeof body.coverPrompt === 'string' ? body.coverPrompt.trim() : '';
      if (!nextPrompt || nextPrompt.length > 12000) {
        return respond(400, { error: '发布资料提示词不能为空，且不能超过 12000 个字符。' });
      }
      if (!nextCoverPrompt || nextCoverPrompt.length > 4000) {
        return respond(400, { error: '封面生图提示词模板不能为空，且不能超过 4000 个字符。' });
      }
      savePublishPromptStore(promptPath, { prompt: nextPrompt, coverPrompt: nextCoverPrompt });
      if (typeof body.translateModel === 'string' || typeof body.coverModel === 'string') {
        const updatedCfg = {
          ...rawCfg,
          translateModel: typeof body.translateModel === 'string' ? body.translateModel.trim() : (rawCfg.translateModel || ''),
          publishCoverModel: typeof body.coverModel === 'string' ? body.coverModel.trim() : (rawCfg.publishCoverModel || ''),
          updated_at: new Date().toISOString(),
        };
        if (!updatedCfg.translateModel) delete updatedCfg.translateModel;
        fs.mkdirSync(paths.dataDir, { recursive: true });
        fs.writeFileSync(paths.promptConfigPath, JSON.stringify(updatedCfg, null, 2), 'utf8');
        rawCfg = updatedCfg;
      }
      const normalizedCfg = normalizePromptConfig(rawCfg);
      return respond(200, {
        ok: true,
        translateModel: rawCfg.translateModel || '',
        coverModel: rawCfg.publishCoverModel || '',
        fallbackTranslateModel: normalizedCfg.translateModel,
        fallbackCoverModel: normalizedCfg.imageModel,
        prompt: nextPrompt,
        coverPrompt: nextCoverPrompt,
      });
    }
    if (pathname === '/api/publish/prompt' && req.method === 'GET') return respond(200, {prompt: getPrompt(), defaultPrompt: DEFAULT_PROMPT});
    if (pathname === '/api/publish/prompt' && req.method === 'POST') {
      const body = await readBody(req);
      const prev = loadPublishPromptStore(promptPath);
      if (body.reset === true) { if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath); return respond(200, {prompt: DEFAULT_PROMPT}); }
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) return respond(400, {error:'提示词不能为空，且不能超过 12000 个字符。'});
      savePublishPromptStore(promptPath, { ...prev, prompt: body.prompt.trim() });
      return respond(200, {prompt:body.prompt.trim()});
    }
    if (pathname !== '/api/publish/generate' || req.method !== 'POST') return false;
    const genBody = await readBody(req).catch(() => ({}));
    const genLang = normalizePublishLang(genBody?.lang || url?.searchParams?.get('lang'));
    if (!fs.existsSync(paths.finalScriptPath)) return respond(400, { error: '当前工程没有文案终稿，请先在文案创作台完成定稿。' });
    const script = fs.readFileSync(paths.finalScriptPath, 'utf8');
    if (!script.trim() || script.trim() === '{}' || script.trim() === '[]') return respond(400, { error: '当前工程的文案终稿为空。' });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
    const langConstraint = genLang === 'en'
      ? '\n\n目标语言要求：所有输出内容（title、description、tags）必须使用地道的英语 (English) 撰写。'
      : (genLang === 'ja' ? '\n\n目标语言要求：所有输出内容（title、description、tags）必须使用地道的日语 (日本語) 撰写。' : '');
    const instruction = getPrompt() + langConstraint + '\n\n输出格式要求：只返回 JSON 对象，包含 title（标题字符串，不超过100字符）、description（简介字符串）和 tags（搜索标签字符串数组），标签总长度不超过400字符。';
    const result = await callOpenRouterText(instruction, script.slice(0, 100000), { model: cfg.translateModel || cfg.textModel || cfg.writerModel, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxTokens: 2000 });
    if (!result) return respond(502, { error: globalThis.__lastWriterLlmError || 'AI 生成失败，请检查模型配置。' });
    const cleaned = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned);
    if (typeof data.title !== 'string' || typeof data.description !== 'string' || !data.title.trim() || !data.description.trim() || !Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === 'string')) throw new Error('AI 返回的标题、简介或标签格式不正确，请重试。');
    const cleanTitle = data.title.trim().slice(0, 100);
    const cleanDesc = data.description.trim();
    const cleanTags = data.tags.map(t => t.trim()).filter(Boolean);
    const copy = loadPublishCopy(paths.dataDir);
    copy[genLang] = {
      ...(copy[genLang] || {}),
      title: cleanTitle,
      description: cleanDesc,
      tags: cleanTags.join(', '),
      updatedAt: new Date().toISOString(),
    };
    savePublishCopy(paths.dataDir, copy);
    return respond(200, { title: cleanTitle, description: cleanDesc, tags: cleanTags, lang: genLang });
  } catch (err) { return respond(500, { error: '操作失败：' + err.message }); }
}
