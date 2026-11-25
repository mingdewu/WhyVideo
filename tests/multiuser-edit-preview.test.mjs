import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('editing leases, voluntary handoff, stale saves and isolated authenticated previews', { timeout: 180000 }, async () => {
  const root = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-edit-preview-'));
  for (const item of ['packages', 'package.json', 'remotion.config.ts', 'tsconfig.json']) fs.cpSync(path.join(root, item), path.join(directory, item), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chromePath)) fs.appendFileSync(path.join(directory, 'remotion.config.ts'), '\nConfig.setBrowserExecutable(' + JSON.stringify(chromePath) + ');\n');
  for (const id of ['project_a', 'project_b']) {
    fs.mkdirSync(path.join(directory, 'projects', id, 'data'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'projects', id, 'public'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'projects', id, 'public', 'identity.txt'), id);
    fs.writeFileSync(path.join(directory, 'projects', id, 'data', 'scene-manifest.json'), JSON.stringify({ project_id: id, scenes: [] }));
    fs.writeFileSync(path.join(directory, 'projects', id, 'public', 'render-props.json'), JSON.stringify({ project_id: id, title: id, video_config: { fps: 30, width: 1920, height: 1080, duration_in_frames: 90, theme_palette: { background: '#111827' } }, timeline_tracks: [] }));
  }
  const authDirectory = path.join(directory, 'auth');
  const { openAccountStore } = await import(pathToFileURL(path.join(directory, 'packages/qc-tools/ui-server/lib/account-store.mjs')));
  const store = openAccountStore(authDirectory);
  const owner = await store.createUser('owner', 'example-password-123');
  const other = await store.createUser('other', 'example-password-456');
  const admin = await store.createUser('admin', 'example-password-789', 'superuser');
  store.assignProject('project_a', owner.id); store.assignProject('project_b', other.id);
  const cookies = new Map([owner, other, admin].map(user => [user.id, 'whyvideo_session=' + store.createSession(user.id)]));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const child = spawn(process.execPath, ['packages/qc-tools/ui-server.mjs'], { cwd: directory, env: { ...process.env, WHYVIDEO_AUTH_DIR: authDirectory, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  let chrome;
  const adminToken = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  async function request(user, url, { method = 'GET', body, revision, tab = token } = {}) {
    return fetch(base + url, { method, headers: { cookie: cookies.get(user.id), origin: base, 'Content-Type': 'application/json', 'X-Edit-Token': tab, ...(revision ? { 'X-Project-Revision': revision } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  const edit = (user, action, tab = token) => request(user, '/api/edit/' + action + '?project=project_a', { method: action === 'state' ? 'GET' : 'POST', tab });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await fetch(base); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    assert(ready, log);
    const protectedReads = ['/api/voicebox/status', '/api/bgm/state', '/api/bgm/auto-status', '/api/auto-plan-cuts-progress', '/api/publish/prompt', '/api/publish/localizations', '/api/publish/cover'];
    for (const endpoint of protectedReads) assert.equal((await request(other, endpoint + '?project=project_a')).status, 403, endpoint);
    const protectedWrites = ['/api/split-shot', '/api/merge-shot', '/api/move-cut', '/api/auto-plan-cuts', '/api/generate-visual', '/api/extract-prompt', '/api/extract-search-keywords', '/api/synthesize-voice', '/api/voicebox/cancel', '/api/bgm/upload', '/api/bgm/save', '/api/bgm/delete-track', '/api/bgm/analyze', '/api/bgm/auto', '/api/publish/generate', '/api/publish/generate-cover', '/api/publish/localize', '/api/publish/localizations'];
    for (const endpoint of protectedWrites) assert.equal((await request(owner, endpoint + '?project=project_a', { method: 'POST', body: { projectId: 'project_b' } })).status, 403, endpoint);
    assert.equal((await request(owner, '/api/shared-config', { method: 'POST', body: { apiKey: 'not-allowed' } })).status, 403);
    assert.equal((await request(admin, '/api/shared-config', { method: 'POST', body: { apiKey: 'fixture-shared-secret' } })).status, 200);
    const sharedResponse = await request(owner, '/api/shared-config');
    const sharedText = await sharedResponse.text();
    assert(!sharedText.includes('fixture-shared-secret'));
    assert.equal(JSON.parse(sharedText).apiKeyConfigured, true);
    const bgmDirectory = id => path.join(directory, 'public/audio/bgm/users', id);
    fs.mkdirSync(bgmDirectory(owner.id), { recursive: true }); fs.mkdirSync(bgmDirectory(other.id), { recursive: true });
    fs.writeFileSync(path.join(bgmDirectory(owner.id), 'owner.wav'), Buffer.alloc(44));
    fs.writeFileSync(path.join(bgmDirectory(other.id), 'other.wav'), Buffer.alloc(44));
    const bgm = await (await request(owner, '/api/bgm/state?project=project_a')).json();
    assert(bgm.config.tracks.some(track => track.file_name === 'owner.wav'));
    assert(!bgm.config.tracks.some(track => track.file_name === 'other.wav'));
    assert.equal((await request(owner, '/public/project_a/audio/bgm/other.wav')).status, 404);
    const initial = await (await edit(owner, 'state')).json();
    assert.equal((await edit(owner, 'acquire')).status, 200);
    assert.equal((await edit(owner, 'acquire', 'cccccccccccccccccccccccccccccccc')).status, 409);
    const saved = await request(owner, '/api/writer/save?project=project_a', { method: 'POST', body: { part: 'materials', data: 'first version' }, revision: initial.revision });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await request(owner, '/api/writer/save?project=project_a', { method: 'POST', body: { part: 'materials', data: 'stale' }, revision: initial.revision })).status, 409);
    assert.equal((await edit(admin, 'request', adminToken)).status, 200);
    assert.equal((await edit(owner, 'grant')).status, 200);
    assert.equal((await edit(admin, 'acquire', adminToken)).status, 200);
    const current = await (await edit(admin, 'state', adminToken)).json();
    assert.equal((await request(owner, '/api/writer/save?project=project_a', { method: 'POST', body: { part: 'materials', data: 'owner blocked' }, revision: current.revision })).status, 409);
    assert.equal((await request(admin, '/api/writer/save?project=project_a', { method: 'POST', body: { part: 'materials', data: 'admin version' }, revision: current.revision, tab: adminToken })).status, 200);
    assert.equal((await edit(admin, 'release', adminToken)).status, 200);
    assert.equal((await edit(owner, 'acquire')).status, 200);
    assert.equal((await request(other, '/?preview=project_a')).status, 403);
    const first = await request(owner, '/?preview=project_a');
    assert.equal(first.status, 200, log + await first.clone().text());
    const htmlA = await first.text();
    assert.match(htmlA, /\/preview\/project_a\//);
    const second = await request(other, '/?preview=project_b');
    assert.equal(second.status, 200, log + await second.clone().text());
    assert.match(await second.text(), /\/preview\/project_b\//);
    assert.equal((await request(owner, '/preview/project_a/api/render', { method: 'POST', body: {} })).status, 403);
    const staticBase = htmlA.match(/window.remotion_staticBase = "([^"]+)"/)[1];
    assert.equal(await (await request(owner, staticBase + '/identity.txt')).text(), 'project_a');
    assert.equal((await request(other, staticBase + '/identity.txt')).status, 403);
    assert.equal((await request(owner, '/?preview=project_a')).status, 200);
    assert.equal((await request(owner, '/preview/project_a/_keepalive')).status, 204);
    assert.equal(fs.readFileSync(path.join(directory, 'projects/project_a/data/materials.txt'), 'utf8'), 'admin version');
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(executable)) {
      const debugPort = await freePort();
      chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(directory, 'chrome'), 'about:blank'], { stdio: 'ignore' });
      let target;
      for (let i = 0; i < 100; i++) { try { target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json(); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
      assert(target, 'Chrome did not start');
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      let counter = 0;
      const waiting = new Map();
      socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && waiting.has(data.id)) { const { resolve, reject } = waiting.get(data.id); waiting.delete(data.id); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result); } });
      const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++counter; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
      await cdp('Network.enable');
      await cdp('Network.setCookie', { name: 'whyvideo_session', value: cookies.get(owner.id).split('=')[1], url: base, path: '/' });
      await cdp('Page.navigate', { url: base + '/?preview=project_a' });
      let text = '';
      for (let i = 0; i < 100; i++) {
        const result = await cdp('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
        text = result.result.value || '';
        if (text.includes('Render') && text.includes('00:00.00')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.match(text, /Render/, text);
      const resources = await cdp('Runtime.evaluate', { expression: "performance.getEntriesByType('resource').filter(entry => entry.name.includes('render-props.json')).map(entry => ({name:entry.name,responseStatus:entry.responseStatus}))", returnByValue: true });
      assert(resources.result.value.some(entry => entry.name.includes('/preview/project_a/') && entry.responseStatus === 200), JSON.stringify(resources.result.value));
      const result = await cdp('Runtime.evaluate', { expression: 'window.remotion_staticBase', returnByValue: true });
      assert.match(result.result.value, /^\/preview\/project_a\//);
      const image = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(os.tmpdir(), 'whyvideo-preview-check.png'), Buffer.from(image.data, 'base64'));
      assert.equal((await edit(owner, 'release')).status, 200);
      await cdp('Page.navigate', { url: base + '/?project=project_a' });
      for (let i = 0; i < 100; i++) {
        const page = await cdp('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
        if ((page.result.value || '').includes('编辑中')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const browserSave = await cdp('Runtime.evaluate', { expression: "(async()=>{await fetch('/api/writer/data?project=project_a');const r=await fetch('/api/writer/save?project=project_a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({part:'materials',data:'browser version'})});return {status:r.status,body:await r.text()}})()", awaitPromise: true, returnByValue: true });
      assert.equal(browserSave.result.value?.status, 200, JSON.stringify(browserSave));
      socket.close();
    }
    if (fs.existsSync(chromePath)) {
      const { createProjectFromScript } = await import(pathToFileURL(path.join(directory, 'packages/qc-tools/ui-server/lib/script-parser.mjs')));
      for (const [id, user] of [['render_a', owner], ['render_b', other]]) {
        createProjectFromScript({ projectId: id, title: '渲染检查', content: '这是一段用于验证视频渲染的文案。' });
        store.assignProject(id, user.id);
      }
      const start = async (user, project) => {
        const lease = await (await request(user, '/api/edit/acquire?project=' + project, { method: 'POST' })).json();
        return request(user, '/api/render-project?project=' + project, { method: 'POST', revision: lease.revision, body: { projectId: project, preview: true } });
      };
      const started = await start(owner, 'render_a');
      assert.equal(started.status, 202, await started.clone().text());
      const busy = await start(other, 'render_b');
      assert.equal(busy.status, 409, await busy.clone().text());
      assert.match((await busy.json()).error, /服务器正在渲染/);
      let job;
      for (let i = 0; i < 400; i++) {
        job = (await (await request(owner, '/api/render-status?project=render_a')).json()).job;
        if (['completed', 'failed'].includes(job.status)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      assert.equal(job.status, 'completed', JSON.stringify(job));
      assert(fs.statSync(path.join(directory, 'projects/render_a/output/preview.mp4')).size > 0);
    }
    assert.equal((await request(admin, '/api/auth/password', { method: 'POST', body: { userId: other.id, password: 'replacement-password-123' } })).status, 200);
    assert.equal((await request(other, '/api/projects')).status, 401);
    assert.equal((await store.verifyPassword('other', 'replacement-password-123')).id, other.id);
  } finally {
    if (chrome) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)); }
    child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); store.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
