import { readBody, defaultProjectId } from './config.mjs';
import { listProjects } from './project-store.mjs';
import { accountStore } from './auth.mjs';
import { projectRevision } from './edit-service.mjs';
import { proxyStudio } from './remotion-studio-service.mjs';

export const GLOBAL_ROUTES = new Set([
  '/api/projects',
  '/api/voicebox/profiles',
  '/api/voice-input/status',
  '/api/transcribe-voice',
  '/api/elevenlabs/voices',
  '/api/openrouter-models',
  '/api/openrouter-video-models',
  '/api/openrouter-image-models',
  '/api/test-provider',
  '/api/test-openrouter',
  '/api/test-tavily',
  '/api/test-meowload',
  '/api/preview-script-segmentation',
  '/api/writer/create-blank-project',
  '/api/import-script-project',
]);

const CREATING_ROUTES = new Set([
  '/api/writer/create-blank-project',
  '/api/import-script-project',
  '/api/preview-script-segmentation',
]);

const SHARED_CONFIG_SAVE_ROUTES = new Set([
  '/api/shared-config',
  '/api/save-visual-config',
  '/api/save-openrouter-config',
]);

const ADMIN_KEY_TEST_ROUTES = new Set([
  '/api/test-tavily',
  '/api/test-provider',
  '/api/test-openrouter',
  '/api/elevenlabs/voices',
]);

const ELEVENLABS_KEY_ROUTES = new Set([
  '/api/elevenlabs/voices',
  '/api/synthesize-voice',
  '/api/publish/english-dub/generate',
]);

export function isYoutubeRoute(pathname) {
  return pathname.startsWith('/api/publish/youtube/') || pathname.startsWith('/api/youtube/oauth/');
}

/** Proxy `/preview/<project>/...` or `?preview=<project>` requests to Remotion Studio. */
export async function handlePreviewProxy(req, res, url, pathname) {
  const previewMatch = pathname.match(/^\/preview\/([a-zA-Z0-9_-]+)(\/.*)?$/);
  const previewProject = previewMatch?.[1] || url.searchParams.get('preview');
  if (!previewProject) return false;

  if (!req.user || !accountStore.canReadProject(req.user, previewProject)) {
    res.writeHead(403);
    res.end('无权访问此工程');
    return true;
  }

  try {
    const targetPath = previewMatch ? (previewMatch[2] || '/') + url.search : pathname + url.search;
    await proxyStudio(req, res, previewProject, targetPath);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('预览启动失败，请检查工程渲染参数');
    } else {
      res.destroy();
    }
    console.error(error);
  }
  return true;
}

/** Enforce role checks for admin-only OAuth and local-script endpoints. */
export function authorizeSpecialRoutes(req, res, pathname) {
  const youtube = isYoutubeRoute(pathname);
  const oauthAdmin = youtube && !pathname.endsWith('/token') && !pathname.endsWith('/status');
  if (req.user && oauthAdmin && req.user.role !== 'superuser') {
    res.writeHead(403);
    res.end('需要超级用户权限');
    return { blocked: true, oauthAdmin };
  }
  if (req.user && ['/api/scan-local-scripts', '/api/get-export-script'].includes(pathname) && req.user.role !== 'superuser') {
    res.writeHead(pathname === '/api/scan-local-scripts' ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(
      pathname === '/api/scan-local-scripts'
        ? { ok: true, scripts: [] }
        : { error: '无权访问本机公共文案目录，请上传自己的文案' }
    ));
    return { blocked: true, oauthAdmin };
  }
  return { blocked: false, oauthAdmin };
}

/** Parse and validate JSON request body for mutating HTTP methods. */
export async function parseRequestBody(req, res) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return { ok: true, body: {} };
  let body;
  try {
    body = await readBody(req);
    req.bodyJson = body;
  } catch {
    res.writeHead(400);
    res.end('请求内容无效');
    return { ok: false, body: {} };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.writeHead(400);
    res.end('请求内容无效');
    return { ok: false, body: {} };
  }
  return { ok: true, body };
}

/** Resolve target project ID and enforce per-project read/write permissions. */
export function resolveAndAuthorizeProject(req, res, url, pathname, body) {
  const creating = CREATING_ROUTES.has(pathname);
  const youtube = isYoutubeRoute(pathname);
  const visibleProjects = req.user
    ? listProjects().filter((project) => accountStore.canReadProject(req.user, project.id))
    : null;
  const queryProject = (!creating && body.projectId)
    || url.searchParams.get('project')
    || (req.user ? visibleProjects[0]?.id || 'why_new_project' : defaultProjectId);

  if (
    req.user &&
    pathname.startsWith('/api/') &&
    !GLOBAL_ROUTES.has(pathname) &&
    !youtube &&
    !['/api/scan-local-scripts', '/api/get-export-script'].includes(pathname)
  ) {
    const readable = req.method === 'GET' || req.method === 'HEAD' || pathname === '/api/remotion-studio/open';
    const allowed = readable
      ? accountStore.canReadProject(req.user, queryProject)
      : accountStore.canWriteProject(req.user, queryProject);
    if (!allowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无权访问或修改此工程' }));
      return { allowed: false, queryProject, creating };
    }
  }
  return { allowed: true, queryProject, creating };
}

/** Inject shared service API keys and baseUrl for authenticated requests. */
export function injectSharedServiceCredentials(req, url, pathname, body, shared, { creating, oauthAdmin }) {
  if (!req.user || creating || oauthAdmin) return;

  const isSharedConfigSave = SHARED_CONFIG_SAVE_ROUTES.has(pathname);
  const isAdminKeyTest = req.user.role === 'superuser' && ADMIN_KEY_TEST_ROUTES.has(pathname);
  const rawBodyKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const hasExplicitTestKey = isAdminKeyTest && rawBodyKey && !/^•+$/.test(rawBodyKey);
  const hasExplicitElevenlabsKey = req.user.role === 'superuser' && rawBodyKey && !/^•+$/.test(rawBodyKey);

  if (!['GET', 'HEAD'].includes(req.method) && !isSharedConfigSave) {
    if (pathname === '/api/test-tavily') {
      body.apiKey = hasExplicitTestKey ? rawBodyKey : (shared.tavilyApiKey || '');
    } else if (ELEVENLABS_KEY_ROUTES.has(pathname)) {
      body.apiKey = hasExplicitElevenlabsKey ? rawBodyKey : (shared.elevenlabsApiKey || '');
    } else {
      body.apiKey = hasExplicitTestKey ? rawBodyKey : (shared.apiKey || '');
      if (!(isAdminKeyTest && typeof body.baseUrl === 'string' && body.baseUrl.trim())) {
        body.baseUrl = shared.baseUrl || 'https://openrouter.ai/api/v1';
      }
    }
  }

  if (GLOBAL_ROUTES.has(pathname)) {
    url.searchParams.set('apiKey', shared.apiKey || '');
    url.searchParams.set('baseUrl', shared.baseUrl || 'https://openrouter.ai/api/v1');
  }
}

/** Attach `X-Project-Revision` header to authenticated API responses. */
export function attachRevisionHeader(req, res, pathname, queryProject) {
  if (!req.user || !pathname.startsWith('/api/')) return;
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (...args) => {
    res.setHeader('X-Project-Revision', projectRevision(req.bodyJson?.projectId || queryProject));
    return writeHead(...args);
  };
}
