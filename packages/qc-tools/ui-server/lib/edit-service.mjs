import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getPaths, readBody, renderJobs, voiceJobs, alignJobs, bgmAiJobs } from './config.mjs';

const leases = new Map();
const requests = new Map();
const lifetime = 90000;
function isBusy(lease, project) {
  return Boolean(lease?.busy || ['preparing', 'rendering'].includes(renderJobs.get(project)?.status) || ['queued', 'generating'].includes(voiceJobs.get(project)?.status) || alignJobs.get(project) || ['running', 'generating'].includes(bgmAiJobs.get(project)?.status));
}

export function projectRevision(projectId) {
  const hash = createHash('sha256');
  const root = getPaths(projectId).dataDir;
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        hash.update(path.relative(root, file));
        hash.update(fs.readFileSync(file));
      }
    }
  }
  visit(root);
  return hash.digest('hex');
}

function currentLease(project, store) {
  const lease = leases.get(project);
  if (lease && !isBusy(lease, project) && lease.expiresAt <= Date.now()) {
    leases.delete(project);
    store.setProjectDelegate(project, null);
    return null;
  }
  if (lease && isBusy(lease, project)) lease.expiresAt = Date.now() + lifetime;
  const ownerId = store.getProjectOwner(project);
  if (lease && ownerId !== null && ownerId !== lease.userId) store.setProjectDelegate(project, lease.userId, lease.expiresAt);
  return lease;
}

export function canDeleteProjectNow(req, project) {
  const lease = currentLease(project, req.accountStore);
  if (lease && req.user && lease.userId !== req.user.id) {
    return { ok: false, status: 409, error: '该工程正在由 ' + lease.username + ' 编辑，暂时无法删除' };
  }
  if (isBusy(lease, project)) {
    return { ok: false, status: 409, error: '该工程仍有任务执行中，请等待完成后再删除' };
  }
  return { ok: true };
}

export function clearProjectEditState(project, store) {
  leases.delete(project);
  requests.delete(project);
  store?.setProjectDelegate(project, null);
}

export function hasProjectEditLease(req, project) {
  if (!req.user) return true;
  const lease = currentLease(project, req.accountStore);
  return Boolean(lease && !isBusy(lease, project) && lease.userId === req.user.id && lease.token === req.headers['x-edit-token']);
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function handleEditRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/edit/')) return false;
  const store = req.accountStore;
  const project = url.searchParams.get('project');
  if (!req.user || !store.canReadProject(req.user, project)) { reply(res, 403, { error: '无权访问此工程' }); return true; }
  const lease = currentLease(project, store);
  const token = req.headers['x-edit-token'];
  const ownerId = store.getProjectOwner(project);
  const owned = ownerId === req.user.id || (req.user.role === 'superuser' && ownerId === null);
  const mine = lease?.userId === req.user.id && lease?.token === token;
  const operation = url.pathname.slice('/api/edit/'.length);
  if (req.method === 'GET' && operation === 'state') {
    reply(res, 200, { revision: projectRevision(project), editing: Boolean(lease), mine, owner: owned, holder: lease?.username || null, request: owned ? requests.get(project) || null : null });
    return true;
  }
  if (req.method !== 'POST') { reply(res, 405, {}); return true; }
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(token)) { reply(res, 400, { error: '编辑会话无效，请刷新页面' }); return true; }
  if (operation === 'request' && req.user.role === 'superuser' && !owned) {
    requests.set(project, { userId: req.user.id, username: req.user.username });
    reply(res, 200, { ok: true }); return true;
  }
  if (operation === 'grant' && owned) {
    if (lease && (!mine || isBusy(lease, project))) { reply(res, 409, { error: '请等待当前编辑操作完成后再交接' }); return true; }
    const pending = requests.get(project);
    if (!pending) { reply(res, 400, { error: '没有待处理的编辑申请' }); return true; }
    leases.set(project, { userId: pending.userId, username: pending.username, token: null, expiresAt: Date.now() + lifetime, busy: false });
    store.setProjectDelegate(project, pending.userId, Date.now() + lifetime);
    requests.delete(project);
    reply(res, 200, { ok: true }); return true;
  }
  if (operation === 'release' && mine) {
    if (isBusy(lease, project)) { reply(res, 409, { error: '操作执行中，请完成后再退出编辑' }); return true; }
    leases.delete(project); store.setProjectDelegate(project, null);
    reply(res, 200, { ok: true }); return true;
  }
  if (operation === 'acquire' && store.canWriteProject(req.user, project)) {
    if (lease && !mine && !(lease.userId === req.user.id && lease.token === null)) { reply(res, 409, { error: '该工程正在由其他编辑会话使用' }); return true; }
    if (mine) lease.expiresAt = Date.now() + lifetime;
    else leases.set(project, { userId: req.user.id, username: req.user.username, token, expiresAt: Date.now() + lifetime, busy: false });
    if (!owned) store.setProjectDelegate(project, req.user.id, Date.now() + lifetime);
    reply(res, 200, { ok: true, revision: projectRevision(project) }); return true;
  }
  reply(res, 403, { error: '当前为只读状态，请先取得编辑权' }); return true;
}

export async function protectProjectWrite(req, res, url, fallbackProject) {
  if (!req.user) return false;
  const store = req.accountStore;
  // Account administration and edit controls are handled before this middleware.
  const excluded = new Set(['/api/writer/create-blank-project', '/api/import-script-project', '/api/preview-script-segmentation', '/api/remotion-studio/open', '/api/delete-project', '/api/test-provider', '/api/test-openrouter', '/api/test-tavily', '/api/test-meowload']);
  if (req.method === 'GET' || req.method === 'HEAD' || !url.pathname.startsWith('/api/') || excluded.has(url.pathname) || url.pathname.startsWith('/api/youtube/') || url.pathname.startsWith('/api/publish/youtube/')) return false;
  try { req.bodyJson = await readBody(req); } catch { reply(res, 400, { error: '请求内容无效' }); return true; }
  const project = req.bodyJson?.projectId || fallbackProject;
  const lease = currentLease(project, store);
  if (!store.canWriteProject(req.user, project) || lease?.userId !== req.user.id || lease?.token !== req.headers['x-edit-token']) {
    reply(res, 409, { error: '当前页面没有编辑权，请先点击进入编辑' }); return true;
  }
  const cancelling = url.pathname === '/api/voicebox/cancel';
  if (!cancelling && (isBusy(lease, project) || req.headers['x-project-revision'] !== projectRevision(project))) {
    reply(res, 409, { error: '工程内容已经更新或操作仍在执行。当前输入已保留，请刷新后核对再保存' }); return true;
  }
  lease.busy = true;
  lease.expiresAt = Date.now() + lifetime;
  let completed = false;
  const finish = () => { if (completed) return; completed = true; lease.busy = false; lease.expiresAt = Date.now() + lifetime; };
  res.once('finish', finish);
  req.finishProjectWrite = finish;
  // A disconnected client cannot hand off while its server operation is still running.
  return false;
}
