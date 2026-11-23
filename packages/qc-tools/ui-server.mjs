import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT, defaultProjectId, MIME_TYPES, rootDir, getPaths } from './ui-server/lib/config.mjs';
import { listProjects } from './ui-server/lib/project-store.mjs';
import { handleAudioRenderRoutes } from './ui-server/routes/audio-render-routes.mjs';
import { handleWriterRoutes } from './ui-server/routes/writer-routes.mjs';
import { handleProducerRoutes } from './ui-server/routes/producer-routes.mjs';
import { handleProviderRoutes } from './ui-server/routes/provider-routes.mjs';
import { handleMediaRoutes } from './ui-server/routes/media-routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioPublicDir = path.join(__dirname, 'ui-server', 'public');

const routeHandlers = [
  handleAudioRenderRoutes,
  handleWriterRoutes,
  handleProducerRoutes,
  handleProviderRoutes,
  handleMediaRoutes,
];

function renderMainHtml(curProjectId = defaultProjectId) {
  const serverProjects = listProjects();
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
    .replace('<!--SERVER_DEFAULT_PROJECT-->', () => `<script>window.STUDIO_DEFAULT_PROJECT_ID = ${JSON.stringify(defaultProjectId).replace(/</g, '\\u003c')};</script>`);
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

  const baseDir = path.resolve(rootDir, 'projects', proj, parts[0]);
  const filePath = path.resolve(baseDir, relSubPath);
  if (filePath.startsWith(baseDir + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
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
    }
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end('Not Found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const queryProject = url.searchParams.get('project') || defaultProjectId;
  const paths = getPaths(queryProject);
  const ctx = { url, pathname, queryProject, paths };

  try {
    for (const handle of routeHandlers) {
      if ((await handle(req, res, ctx)) || res.writableEnded) return;
    }

    if (req.method === 'GET' && pathname.startsWith('/studio/')) {
      return serveStudioAsset(pathname, res);
    }

    if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
      return serveProjectMedia(req, res, pathname, queryProject);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMainHtml(queryProject));
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
