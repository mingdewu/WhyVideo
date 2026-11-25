import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultProjectId, MIME_TYPES, rootDir } from './config.mjs';
import { getSharedBgmDirectory } from '../../project-paths.mjs';
import { listProjects } from './project-store.mjs';
import { accountStore } from './auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioPublicDir = path.resolve(__dirname, '..', 'public');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** Render the main studio HTML shell with server-injected project options and auth context. */
export function renderMainHtml(curProjectId = defaultProjectId, user = null) {
  const serverProjects = listProjects().filter((project) => !user || accountStore.canReadProject(user, project.id));
  const serverOptions = serverProjects
    .map((project) => {
      const selected = project.id === curProjectId ? ' selected' : '';
      const safeId = escapeHtml(project.id);
      const safeTitle = escapeHtml(project.title || project.id);
      return `<option value="${safeId}"${selected}>${safeTitle} (${safeId})</option>`;
    })
    .join('\n');

  const templateHtml = fs.readFileSync(path.join(studioPublicDir, 'index.html'), 'utf8')
    .replace(/  <!--PARTIAL:([a-z-]+)-->\n\n/gm, (_, name) =>
      fs.readFileSync(path.join(studioPublicDir, 'partials', `${name}.html`), 'utf8'));

  const userPayload = user ? { id: user.id, username: user.username, role: user.role } : null;
  const html = templateHtml
    .replace('<!--SERVER_PROJECT_OPTIONS-->', () => serverOptions)
    .replace('<!--SERVER_DEFAULT_PROJECT-->', () =>
      `<script>window.STUDIO_DEFAULT_PROJECT_ID = ${JSON.stringify(curProjectId).replace(/</g, '\\u003c')};window.STUDIO_CURRENT_USER_ID = ${JSON.stringify(user?.id || null).replace(/</g, '\\u003c')};window.STUDIO_CURRENT_USER = ${JSON.stringify(userPayload).replace(/</g, '\\u003c')};</script><script src="/studio/js/edit-session.js"></script>`);

  return html;
}

/** Serve static frontend assets under `/studio/`. */
export function serveStudioAsset(pathname, res) {
  let relPath = '';
  try {
    relPath = decodeURIComponent(pathname.slice('/studio/'.length));
  } catch {
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

/** Serve project `/output/` and `/public/` media files with HTTP Range support. */
export function serveProjectMedia(req, res, pathname, queryProject) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {}

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

  if (!targetFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }

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
