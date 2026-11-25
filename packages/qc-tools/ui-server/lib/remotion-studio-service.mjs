import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rootDir, getPaths } from './config.mjs';

export const STUDIO_PORT = 3100;
const instances = new Map();
const pending = new Map();
const childEntry = fileURLToPath(new URL('./studio-child.cjs', import.meta.url));
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function probe(port) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, response => { response.resume(); resolve(response.statusCode === 200); });
    request.on('error', () => resolve(false)); request.on('timeout', () => request.destroy());
  });
}
export async function ensureRemotionStudio(projectId) {
  const paths = getPaths(projectId);
  if (!fs.existsSync(paths.projectDir)) throw new Error('工程不存在');
  if (instances.has(projectId)) {
    const instance = instances.get(projectId); instance.lastUsed = Date.now();
    return { ok: true, projectId, url: '/?preview=' + encodeURIComponent(projectId), port: instance.port, restarted: false };
  }
  if (pending.has(projectId)) return pending.get(projectId);
  const task = (async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, [childEntry, 'studio', 'packages/video-template/src/index.ts', '--port', String(port), '--no-open'], {
      cwd: rootDir, env: { ...process.env, PROJECT_ID: projectId }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const instance = { child, port, lastUsed: Date.now() };
    let log = ''; let failure;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-4000); });
    child.on('error', error => { failure = error; });
    child.on('exit', () => { failure = new Error('预览进程已退出'); if (instances.get(projectId) === instance) instances.delete(projectId); });
    try {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        if (await probe(port)) { instances.set(projectId, instance); return { ok: true, projectId, url: '/?preview=' + encodeURIComponent(projectId), port, restarted: true }; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error('预览启动超时');
    } catch (error) { child.kill(); console.error('Studio startup:', log); throw error; }
  })();
  pending.set(projectId, task);
  try { return await task; } finally { pending.delete(projectId); }
}
const cleanup = setInterval(() => {
  for (const [id, instance] of instances) if (Date.now() - instance.lastUsed > 15 * 60 * 1000) { instance.child.kill(); instances.delete(id); }
}, 60000);
cleanup.unref();
process.once('exit', () => { for (const instance of instances.values()) instance.child.kill(); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  for (const instance of instances.values()) instance.child.kill();
  process.exit(0);
});

function browserProxyScript(projectId) {
  const prefix = '/preview/' + encodeURIComponent(projectId);
  return `<script>(()=>{const prefix=${JSON.stringify(prefix)},project=${JSON.stringify(projectId)};const rewrite=value=>{const u=new URL(value,location.href);return u.origin===location.origin&&!u.pathname.startsWith(prefix+'/')?prefix+u.pathname+u.search:u.href};const fetchOriginal=window.fetch.bind(window);setInterval(()=>fetchOriginal(prefix+'/_keepalive').catch(()=>{}),30000);window.fetch=(input,options)=>fetchOriginal(typeof input==='string'?rewrite(input):new Request(rewrite(input.url),input),options);const Source=window.EventSource;window.EventSource=class extends Source{constructor(url,options){super(rewrite(url),options)}};const descriptor=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');Object.defineProperty(HTMLScriptElement.prototype,'src',{...descriptor,set(value){descriptor.set.call(this,rewrite(value))}});for(const name of ['pushState','replaceState']){const original=history[name].bind(history);history[name]=(s,t,url)=>{const u=new URL(url||location.href,location.href);u.searchParams.set('preview',project);return original(s,t,u.pathname+u.search+u.hash)}}document.addEventListener('click',event=>{const a=event.target.closest('a');if(a&&a.origin===location.origin){const u=new URL(a.href);u.searchParams.set('preview',project);a.href=u.href}},true)})();</script>`;
}

export async function proxyStudio(req, res, projectId, upstreamPath = '/') {
  const studio = await ensureRemotionStudio(projectId);
  const pathname = new URL(upstreamPath, 'http://localhost').pathname;
  if (req.method === 'GET' && pathname === '/_keepalive') { res.writeHead(204); res.end(); return; }
  // The website owns uploads, editing and the global render limit.
  if (req.method !== 'GET' || pathname.startsWith('/api/')) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请在 WhyVideo 工作台编辑素材或启动渲染' })); return;
  }
  await new Promise((resolve, reject) => {
    const upstream = http.request({ host: '127.0.0.1', port: studio.port, path: upstreamPath, method: 'GET', headers: { ...(req.headers.range ? { range: req.headers.range } : {}) } }, response => {
      const headers = { ...response.headers, 'cache-control': 'no-store' };
      delete headers['content-length']; delete headers['content-encoding']; delete headers['transfer-encoding'];
      if (String(response.headers['content-type']).includes('text/html')) {
        let html = '';
        response.setEncoding('utf8'); response.on('data', data => { html += data; });
        response.on('end', () => {
          const prefix = '/preview/' + encodeURIComponent(projectId);
          html = html.replace('<head>', '<head>' + browserProxyScript(projectId))
            .replace(/(src|href)="\/(?!\/)([^" ]*)"/g, (_, key, value) => `${key}="${prefix}/${value}"`)
            .replace(/window\.remotion_staticBase = "([^"]*)"/, (_, value) => `window.remotion_staticBase = ${JSON.stringify(prefix + value)}`)
            .replace(/window\.remotion_publicPath = "([^"]*)"/, (_, value) => `window.remotion_publicPath = ${JSON.stringify(prefix + value)}`);
          res.writeHead(response.statusCode || 200, headers); res.end(html); resolve();
        });
      } else {
        res.writeHead(response.statusCode || 200, headers); response.pipe(res); response.on('end', resolve);
        res.on('close', () => { upstream.destroy(); resolve(); });
      }
      response.on('error', reject);
    });
    upstream.on('error', reject); upstream.end();
  });
}
