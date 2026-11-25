import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readBody, PORT, defaultProjectId, MIME_TYPES, rootDir, getPaths } from './ui-server/lib/config.mjs';
import { PROJECTS_ROOT, SHARED_BGM_DIR, getSharedBgmDirectory } from './project-paths.mjs';
import { syncExistingProjectsToSharedBgm } from './bgm-manager.mjs';
import { listProjects } from './ui-server/lib/project-store.mjs';
import { handleAudioRenderRoutes } from './ui-server/routes/audio-render-routes.mjs';
import { handleWriterRoutes } from './ui-server/routes/writer-routes.mjs';
import { handleProducerRoutes } from './ui-server/routes/producer-routes.mjs';
import { handleProviderRoutes } from './ui-server/routes/provider-routes.mjs';
import { handlePublishRoutes } from './ui-server/routes/publish-routes.mjs';
import { handleYoutubeOAuthRoutes } from './ui-server/routes/youtube-oauth-routes.mjs';
import { handleMediaRoutes } from './ui-server/routes/media-routes.mjs';
import { handleAuth, accountStore } from './ui-server/lib/auth.mjs';
import { handleEditRoutes, protectProjectWrite, projectRevision } from './ui-server/lib/edit-service.mjs';
import { proxyStudio } from './ui-server/lib/remotion-studio-service.mjs';
import { readSharedServices, withSharedServices, setSharedRuntimeUser, setSharedProjectOwner } from './ui-server/lib/shared-services.mjs';
import { handleSharedServiceRoutes } from './ui-server/routes/shared-service-routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioPublicDir = path.join(__dirname, 'ui-server', 'public');

const routeHandlers = [
  handleYoutubeOAuthRoutes,
  handlePublishRoutes,
  handleAudioRenderRoutes,
  handleWriterRoutes,
  handleProducerRoutes,
  handleProviderRoutes,
  handleMediaRoutes,
];

function renderMainHtml(curProjectId = defaultProjectId, user = null) {
  const serverProjects = listProjects().filter(project => !user || accountStore.canReadProject(user, project.id));
  const serverOptions = serverProjects
    .map((project) => {
      const selected = project.id === curProjectId ? ' selected' : '';
      const safeId = String(project.id).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const safeTitle = String(project.title || project.id).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      return `<option value="${safeId}"${selected}>${safeTitle} (${safeId})</option>`;
    })
    .join('\n');
  const templateHtml = fs.readFileSync(path.join(studioPublicDir, 'index.html'), 'utf8')
    .replace(/  <!--PARTIAL:([a-z-]+)-->\n\n/gm, (_, name) =>
      fs.readFileSync(path.join(studioPublicDir, 'partials', name + '.html'), 'utf8'));
  return templateHtml
    .replace('<!--SERVER_PROJECT_OPTIONS-->', () => serverOptions)
    .replace('<!--SERVER_DEFAULT_PROJECT-->', () => `<script>window.STUDIO_DEFAULT_PROJECT_ID = ${JSON.stringify(curProjectId).replace(/</g, '\\u003c')};window.STUDIO_CURRENT_USER_ID = ${JSON.stringify(user?.id || null).replace(/</g, '\\u003c')};</script><script src="/studio/js/edit-session.js"></script>`);
}

function serveStudioAsset(pathname, res) {
  let relPath = '';
  try {
    relPath = decodeURIComponent(pathname.slice('/studio/'.length));
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const filePath = path.resolve(studioPublicDir, relPath);
  if (filePath.startsWith(studioPublicDir + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function serveProjectMedia(req, res, pathname, queryProject) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch (e) {}

  const parts = decodedPathname.split('/').filter(Boolean);
  let proj = queryProject;
  let relSubPath = '';

  if (parts.length >= 3 && listProjects().some((p) => p.id === parts[1])) {
    proj = parts[1];
    relSubPath = parts.slice(2).join('/');
  } else {
    relSubPath = parts.slice(1).join('/');
  }

  if (req.user && !accountStore.canReadProject(req.user, proj)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: '无权访问此工程' }));
  }

  const baseDir = path.resolve(rootDir, 'projects', proj, parts[0]);
  const filePath = path.resolve(baseDir, relSubPath);
  let targetFile = null;
  if (filePath.startsWith(baseDir + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    targetFile = filePath;
  } else if (parts[0] === 'public' && relSubPath.startsWith('audio/bgm/')) {
    const sharedRoot = path.resolve(getSharedBgmDirectory(req.user ? accountStore.getProjectOwner(proj) || req.user.id : undefined));
    const sharedCandidate = path.resolve(sharedRoot, relSubPath.slice('audio/bgm/'.length));
    if (
      sharedCandidate.startsWith(sharedRoot + path.sep) &&
      !path.basename(sharedCandidate).startsWith('.') &&
      fs.existsSync(sharedCandidate) &&
      fs.statSync(sharedCandidate).isFile()
    ) {
      targetFile = sharedCandidate;
    }
  }

  if (targetFile) {
    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(targetFile);

    const range = req.headers.range;
    if (range) {
      const rParts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(rParts[0], 10);
      const end = rParts[1] ? parseInt(rParts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(targetFile, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      return file.pipe(res);
    }
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
    return fs.createReadStream(targetFile).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end('Not Found');
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (await handleAuth(req, res, pathname)) return;
    setSharedRuntimeUser(req.user);
    if (await handleEditRoutes(req, res, url)) return;
    if (await handleSharedServiceRoutes(req, res, pathname)) return;
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    return res.end('服务器错误');
  }
  const previewMatch = pathname.match(/^\/preview\/([a-zA-Z0-9_-]+)(\/.*)?$/);
  const previewProject = previewMatch?.[1] || url.searchParams.get('preview');
  if (previewProject) {
    if (!req.user || !accountStore.canReadProject(req.user, previewProject)) {
      res.writeHead(403); return res.end('无权访问此工程');
    }
    try {
      await proxyStudio(req, res, previewProject, previewMatch ? (previewMatch[2] || '/') + url.search : pathname + url.search);
    } catch (error) {
      if (!res.headersSent) { res.writeHead(502); res.end('预览启动失败，请检查工程渲染参数'); }
      else res.destroy();
      console.error(error);
    }
    return;
  }
  const globalRoutes = new Set(['/api/projects', '/api/voicebox/profiles', '/api/voice-input/status', '/api/transcribe-voice', '/api/elevenlabs/voices', '/api/openrouter-models', '/api/openrouter-video-models', '/api/openrouter-image-models', '/api/test-provider', '/api/test-openrouter', '/api/test-tavily', '/api/test-meowload', '/api/preview-script-segmentation', '/api/writer/create-blank-project', '/api/import-script-project']);
  const creating = ['/api/writer/create-blank-project', '/api/import-script-project', '/api/preview-script-segmentation'].includes(pathname);
  const youtube = pathname.startsWith('/api/publish/youtube/') || pathname.startsWith('/api/youtube/oauth/');
  const oauthAdmin = youtube && !pathname.endsWith('/token') && !pathname.endsWith('/status');
  if (req.user && oauthAdmin && req.user.role !== 'superuser') { res.writeHead(403); return res.end('需要超级用户权限'); }
  if (req.user && ['/api/scan-local-scripts', '/api/get-export-script'].includes(pathname) && req.user.role !== 'superuser') {
    res.writeHead(pathname === '/api/scan-local-scripts' ? 200 : 403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(pathname === '/api/scan-local-scripts' ? { ok: true, scripts: [] } : { error: '无权访问本机公共文案目录，请上传自己的文案' }));
  }
  let body = {};
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    try { body = await readBody(req); req.bodyJson = body; }
    catch { res.writeHead(400); return res.end('请求内容无效'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) { res.writeHead(400); return res.end('请求内容无效'); }
  }
  const visibleProjects = req.user ? listProjects().filter(project => accountStore.canReadProject(req.user, project.id)) : null;
  const queryProject = (!creating && body.projectId) || url.searchParams.get('project') || (req.user ? visibleProjects[0]?.id || 'why_new_project' : defaultProjectId);
  if (req.user && pathname.startsWith('/api/') && !globalRoutes.has(pathname) && !youtube && !['/api/scan-local-scripts', '/api/get-export-script'].includes(pathname)) {
    const readable = req.method === 'GET' || req.method === 'HEAD' || pathname === '/api/remotion-studio/open';
    const allowed = readable ? accountStore.canReadProject(req.user, queryProject) : accountStore.canWriteProject(req.user, queryProject);
    if (!allowed) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: '无权访问或修改此工程' })); }
  }
  const shared = readSharedServices();
  if (req.user) setSharedProjectOwner(accountStore.getProjectOwner(queryProject));
  if (req.user && !creating && !oauthAdmin) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      body.apiKey = ['/api/elevenlabs/voices', '/api/synthesize-voice'].includes(pathname) ? shared.elevenlabsApiKey || '' : shared.apiKey || '';
      body.baseUrl = shared.baseUrl || 'https://openrouter.ai/api/v1';
    }
    if (globalRoutes.has(pathname)) {
      url.searchParams.set('apiKey', shared.apiKey || '');
      url.searchParams.set('baseUrl', shared.baseUrl || 'https://openrouter.ai/api/v1');
    }
  }
  const paths = getPaths(queryProject);
  const ctx = { url, pathname, queryProject, paths };


  try {
    if (!globalRoutes.has(pathname) && !youtube && await protectProjectWrite(req, res, url, queryProject)) return;
    if (req.user && pathname.startsWith('/api/')) {
      const writeHead = res.writeHead.bind(res);
      res.writeHead = (...args) => {
        res.setHeader('X-Project-Revision', projectRevision(req.bodyJson?.projectId || queryProject));
        return writeHead(...args);
      };
    }
    for (const handle of routeHandlers) {
      if ((await handle(req, res, ctx)) || res.writableEnded) return;
    }

    if (req.method === 'GET' && pathname.startsWith('/studio/')) {
      return serveStudioAsset(pathname, res);
    }

    if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
      return serveProjectMedia(req, res, pathname, queryProject);
    }

    if (pathname.startsWith('/api/')) { res.writeHead(404); return res.end('接口不存在'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    let html = renderMainHtml(queryProject, req.user);
    if (req.user) {
      const script = `<script>window.addEventListener('DOMContentLoaded',()=>{const box=document.createElement('div');box.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9999;display:flex;gap:8px';${req.user.role === 'superuser' ? "const link=document.createElement('a');link.href='/account-management';link.textContent='账号管理';link.style.cssText='padding:8px 12px;background:#374151;color:white;border-radius:8px';box.appendChild(link);const settings=document.createElement('a');settings.href='/service-settings';settings.textContent='共享服务设置';settings.style.cssText=link.style.cssText;box.appendChild(settings);" : ''}const button=document.createElement('button');button.textContent='退出登录';button.style.cssText='padding:8px 12px;background:#374151;color:white;border-radius:8px';button.onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location.href='/'};box.appendChild(button);document.body.appendChild(box)});</script>`;
      html = html.replace('</body>', script + '</body>');
    }
    res.end(html);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  } finally {
    req.finishProjectWrite?.();
  }
}

const server = http.createServer((req, res) => withSharedServices(null, () => handleRequest(req, res).catch(error => { console.error(error); if (!res.headersSent) res.writeHead(500); res.end('服务器错误'); })));

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
syncExistingProjectsToSharedBgm(PROJECTS_ROOT, SHARED_BGM_DIR, getSharedBgmDirectory);
startServer(Number(PORT));
