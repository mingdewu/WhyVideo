import { openAccountStore } from './account-store.mjs';
import { listProjects } from './project-store.mjs';

const store = openAccountStore();
export const accountStore = store;
const attempts = new Map();

function cookieToken(req) {
  return String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('whyvideo_session='))?.slice('whyvideo_session='.length);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 WhyVideo</title><style>body{font:16px system-ui;background:#111827;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#1f2937;padding:32px;border-radius:16px;width:min(340px,80vw)}label{display:block;margin:18px 0 6px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #64748b;font:inherit}button{margin-top:22px;background:#6366f1;color:white;border:0;cursor:pointer}#error{color:#fca5a5}</style><form id="login"><h1>登录 WhyVideo</h1><label for="username">用户名</label><input id="username" autocomplete="username" required><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required><button>登录</button><p id="error" role="alert"></p></form><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})});if(r.ok)location.href='/';else document.querySelector('#error').textContent='登录失败，请检查用户名和密码或稍后重试。'}</script></html>`;

const accountsPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账号管理</title><style>body{font:16px system-ui;background:#111827;color:#f8fafc;max-width:720px;margin:40px auto;padding:0 20px}a{color:#a5b4fc}form,section{background:#1f2937;padding:24px;border-radius:12px;margin-top:20px}input,button{padding:10px;border-radius:6px;border:1px solid #64748b;font:inherit}input{margin:5px}button{cursor:pointer}li{padding:10px}li button{margin-left:12px}#message{color:#fbbf24}</style><a href="/">返回工作台</a><h1>账号管理</h1><form id="create"><h2>创建普通账号</h2><label>用户名 <input name="username" required maxlength="128" autocomplete="off"></label><label>初始密码 <input name="password" type="password" minlength="12" required autocomplete="new-password"></label><button>创建账号</button><p id="message" role="status"></p></form><section><h2>账号列表</h2><ul id="users"></ul></section><script>const message=document.querySelector('#message');async function load(){const r=await fetch('/api/auth/users');if(!r.ok){message.textContent='无法读取账号';return}const users=await r.json();const list=document.querySelector('#users');list.replaceChildren();for(const user of users){const li=document.createElement('li');li.textContent=user.username+' · '+(user.role==='superuser'?'超级用户':'普通用户')+' · '+(user.active?'启用':'停用');if(user.role==='user'){const b=document.createElement('button');b.textContent=user.active?'停用':'启用';b.onclick=async()=>{const result=await fetch('/api/auth/users/'+encodeURIComponent(user.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!user.active})});message.textContent=result.ok?'已更新账号状态':'更新失败';await load()};li.appendChild(b)}list.appendChild(li)}}document.querySelector('#create').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const r=await fetch('/api/auth/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.username.value,password:form.password.value})});const data=await r.json();message.textContent=r.ok?'账号已创建':data.error;if(r.ok){form.reset();await load()}};load()</script></html>`;

export async function handleAuth(req, res, pathname) {
  if (!store.hasUsers()) {
    const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
    const localSetup = localHost && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'];
    if (pathname === '/api/auth/setup' && req.method === 'POST' && localSetup && sameOrigin(req)) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return true; } }
      try {
        const body = JSON.parse(raw);
        // Serialize initial creation after password hashing through the database constraint.
        await store.createFirstSuperuser(body.username, body.password);
        res.writeHead(200); res.end();
      } catch {
        res.writeHead(400); res.end();
      }
      return true;
    }
    const page = localSetup
      ? loginPage.replaceAll('登录 WhyVideo', '创建超级用户').replace("fetch('/api/auth/login'", "fetch('/api/auth/setup'").replace('<button>登录</button>', '<button>创建超级用户</button>').replace('autocomplete="current-password"', 'autocomplete="new-password" minlength="12"').replace('登录失败，请检查用户名和密码或稍后重试。', '创建失败。密码至少需要 12 个字符，请检查后重试。')
      : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>WhyVideo</title><p>请先在服务器本机打开 http://localhost:4000 创建超级用户。</p></html>';
    res.writeHead(localSetup && req.method === 'GET' ? 200 : 503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page); return true;
  }
  const token = cookieToken(req);
  const user = store.getSession(token);
  const secure = req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const cookie = value => `whyvideo_session=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (!sameOrigin(req)) { res.writeHead(403); res.end(); return true; }
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter(time => now - time < 60000);
    if (recent.length >= 10) { res.writeHead(429); res.end(); return true; }
    recent.push(now); attempts.set(key, recent);
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return true; } }
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return true; }
    const account = await store.verifyPassword(body.username, body.password);
    if (!account) { res.writeHead(401); res.end(); return true; }
    attempts.delete(key);
    res.writeHead(200, { 'Set-Cookie': cookie(store.createSession(account.id)) + '; Max-Age=604800', 'Cache-Control': 'no-store' });
    res.end(); return true;
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) { res.writeHead(403); res.end(); return true; }
    store.deleteSession(token);
    res.writeHead(200, { 'Set-Cookie': cookie('') + '; Max-Age=0', 'Cache-Control': 'no-store' });
    res.end(); return true;
  }
  if (!user) {
    const isPage = req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/public/') && !pathname.startsWith('/output/') && !pathname.startsWith('/studio/');
    res.writeHead(isPage ? 200 : 401, { 'Content-Type': isPage ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store' });
    res.end(isPage ? loginPage : JSON.stringify({ error: '请先登录' }));
    return true;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) {
    res.writeHead(403); res.end(); return true;
  }
  if (pathname === '/api/auth/projects' || pathname === '/api/auth/projects/assign') {
    if (user.role !== 'superuser') { res.writeHead(403); res.end(); return true; }
    if (pathname === '/api/auth/projects' && req.method === 'GET') {
      const projects = listProjects().map(project => ({ id: project.id, title: project.title, ownerId: store.getProjectOwner(project.id) }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(projects)); return true;
    }
    if (pathname === '/api/auth/projects/assign' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return true; } }
      try {
        const body = JSON.parse(raw);
        if (!listProjects().some(project => project.id === body.projectId)) throw new Error('工程不存在');
        if (!store.assignUnownedProject(body.projectId, body.userId)) throw new Error('工程已分配，不能重复分配');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        const message = ['工程不存在', '工程已分配，不能重复分配', '账号不存在或已停用'].includes(err.message) ? err.message : '请求无效';
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: message }));
      }
      return true;
    }
    res.writeHead(404); res.end(); return true;
  }
  if (pathname === '/account-management' || pathname.startsWith('/api/auth/users') || pathname === '/api/auth/password') {
    if (user.role !== 'superuser') { res.writeHead(403); res.end(); return true; }
    if (pathname === '/api/auth/password' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return true; } }
      try {
        const body = JSON.parse(raw);
        await store.resetPassword(body.userId, body.password);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, reauthenticate: body.userId === user.id }));
      } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '重设失败，请检查账号和密码长度' })); }
      return true;
    }
    if (pathname === '/account-management' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      const projectUI = `<section><h2>分配现有工程</h2><p>选择尚未分配的工程和账号。</p><label>工程 <select id="project-select"></select></label> <label>账号 <select id="owner-select"></select></label> <button id="assign-project">分配</button><p id="project-message" role="status"></p></section><script>async function loadProjects(){const [pr,ur]=await Promise.all([fetch('/api/auth/projects'),fetch('/api/auth/users')]);if(!pr.ok||!ur.ok)return;const projects=await pr.json(),users=await ur.json(),ps=document.querySelector('#project-select'),us=document.querySelector('#owner-select');ps.replaceChildren();us.replaceChildren();for(const project of projects.filter(p=>!p.ownerId)){const option=document.createElement('option');option.value=project.id;option.textContent=project.title+' ('+project.id+')';ps.appendChild(option)}for(const user of users.filter(u=>u.active)){const option=document.createElement('option');option.value=user.id;option.textContent=user.username;us.appendChild(option)}}document.querySelector('#assign-project').onclick=async()=>{const projectId=document.querySelector('#project-select').value,userId=document.querySelector('#owner-select').value,message=document.querySelector('#project-message');if(!projectId||!userId){message.textContent='请选择工程和账号';return}const r=await fetch('/api/auth/projects/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,userId})});const data=await r.json();message.textContent=r.ok?'工程已分配':data.error;await loadProjects()};loadProjects()</script>`;
      const resetUI = `<section><h2>重设密码</h2><form id="reset-password"><label>账号 <select name="userId"></select></label><label>新密码 <input name="password" type="password" minlength="12" required autocomplete="new-password"></label><button>重设密码</button><p role="status"></p></form></section><script>const resetForm=document.querySelector('#reset-password');fetch('/api/auth/users').then(r=>r.json()).then(users=>{for(const user of users){const option=document.createElement('option');option.value=user.id;option.textContent=user.username;resetForm.userId.appendChild(option)}});resetForm.onsubmit=async e=>{e.preventDefault();const response=await fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(resetForm)))});const data=await response.json();resetForm.querySelector('p').textContent=response.ok?'已重设，对方需要重新登录':data.error;if(response.ok)resetForm.password.value='';if(data.reauthenticate)location.href='/'}</script>`;
      res.end(accountsPage.replace('<script>const message=', projectUI + resetUI + '<script>const message=')); return true;
    }
    if (pathname === '/api/auth/users' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(store.listUsers())); return true;
    }
    if ((pathname === '/api/auth/users' && req.method === 'POST') || (pathname.startsWith('/api/auth/users/') && req.method === 'PATCH')) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return true; } }
      try {
        const body = JSON.parse(raw);
        if (req.method === 'POST') await store.createUser(body.username, body.password);
        else if (typeof body.active !== 'boolean' || !store.setUserActive(pathname.slice('/api/auth/users/'.length), body.active)) throw new Error('账号不存在或无法修改');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        const message = err.message.includes('UNIQUE constraint') ? '用户名已存在' : (err.message.startsWith('用户名') || err.message.startsWith('密码') || err.message.startsWith('账号') ? err.message : '请求无效');
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: message }));
      }
      return true;
    }
    res.writeHead(404); res.end(); return true;
  }
  req.user = user;
  req.accountStore = store;
  return false;
}
