import http from 'http';
import { PORT, getPaths } from './ui-server/lib/config.mjs';
import { PROJECTS_ROOT, SHARED_BGM_DIR, getSharedBgmDirectory } from './project-paths.mjs';
import { syncExistingProjectsToSharedBgm } from './bgm-manager.mjs';
import { handleAudioRenderRoutes } from './ui-server/routes/audio-render-routes.mjs';
import { handleWriterRoutes } from './ui-server/routes/writer-routes.mjs';
import { handleProducerRoutes } from './ui-server/routes/producer-routes.mjs';
import { handleProviderRoutes } from './ui-server/routes/provider-routes.mjs';
import { handlePublishRoutes } from './ui-server/routes/publish-routes.mjs';
import { handleYoutubeOAuthRoutes } from './ui-server/routes/youtube-oauth-routes.mjs';
import { handleMediaRoutes } from './ui-server/routes/media-routes.mjs';
import { handleAuth, accountStore } from './ui-server/lib/auth.mjs';
import { handleEditRoutes, protectProjectWrite } from './ui-server/lib/edit-service.mjs';
import { readSharedServices, withSharedServices, setSharedRuntimeUser, setSharedProjectOwner } from './ui-server/lib/shared-services.mjs';
import { handleSharedServiceRoutes } from './ui-server/routes/shared-service-routes.mjs';
import { renderMainHtml, serveStudioAsset, serveProjectMedia } from './ui-server/lib/static-assets.mjs';
import {
  GLOBAL_ROUTES,
  isYoutubeRoute,
  handlePreviewProxy,
  authorizeSpecialRoutes,
  parseRequestBody,
  resolveAndAuthorizeProject,
  injectSharedServiceCredentials,
  attachRevisionHeader,
} from './ui-server/lib/request-guard.mjs';

const routeHandlers = [
  handleYoutubeOAuthRoutes,
  handlePublishRoutes,
  handleAudioRenderRoutes,
  handleWriterRoutes,
  handleProducerRoutes,
  handleProviderRoutes,
  handleMediaRoutes,
];

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

  if (await handlePreviewProxy(req, res, url, pathname)) return;

  const { blocked, oauthAdmin } = authorizeSpecialRoutes(req, res, pathname);
  if (blocked) return;

  const parsed = await parseRequestBody(req, res);
  if (!parsed.ok) return;
  const body = parsed.body;

  const { allowed, queryProject, creating } = resolveAndAuthorizeProject(req, res, url, pathname, body);
  if (!allowed) return;

  const shared = readSharedServices();
  if (req.user) setSharedProjectOwner(accountStore.getProjectOwner(queryProject));
  injectSharedServiceCredentials(req, url, pathname, body, shared, { creating, oauthAdmin });

  const ctx = { url, pathname, queryProject, paths: getPaths(queryProject) };
  const skipWriteLock = GLOBAL_ROUTES.has(pathname) || isYoutubeRoute(pathname);

  try {
    if (!skipWriteLock && await protectProjectWrite(req, res, url, queryProject)) return;
    attachRevisionHeader(req, res, pathname, queryProject);

    for (const handle of routeHandlers) {
      if ((await handle(req, res, ctx)) || res.writableEnded) return;
    }

    if (req.method === 'GET' && pathname.startsWith('/studio/')) {
      return serveStudioAsset(pathname, res);
    }
    if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
      return serveProjectMedia(req, res, pathname, queryProject);
    }
    if (pathname.startsWith('/api/')) {
      res.writeHead(404);
      return res.end('接口不存在');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMainHtml(queryProject, req.user));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  } finally {
    req.finishProjectWrite?.();
  }
}

const server = http.createServer((req, res) =>
  withSharedServices(null, () =>
    handleRequest(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end('服务器错误');
    })
  )
);

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
