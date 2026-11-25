import { readBody } from '../lib/config.mjs';
import { publicSharedServices, saveSharedServices } from '../lib/shared-services.mjs';

const labels = { apiKey: '模型 API Key', tavilyApiKey: 'Tavily Key', meowloadApiKey: '素材服务 Key', elevenlabsApiKey: 'ElevenLabs Key', baseUrl: '模型服务地址', writerModel: '文案模型', textModel: '分镜模型', keywordModel: '关键词模型', videoModel: '视频模型', imageModel: '图片模型', bgmModel: '配乐模型' };
export async function handleSharedServiceRoutes(req, res, pathname) {
  const respond = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (pathname === '/service-settings') {
    if (req.user?.role !== 'superuser') { respond(403, { error: '需要超级用户权限' }); return true; }
    const inputs = Object.entries(labels).map(([key, label]) => `<label>${label}<input name="${key}" type="${key.endsWith('Key') ? 'password' : 'text'}" autocomplete="off"></label>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共享服务设置</title><style>body{font:16px system-ui;max-width:720px;margin:30px auto;padding:20px;background:#111827;color:white}a{color:#a5b4fc}label{display:block;margin:16px 0}input{display:block;width:95%;padding:10px}button{padding:12px}</style><a href="/">返回工作台</a><h1>共享服务设置</h1><p>登录用户共同使用这些服务。已配置的密钥留空即可保留。</p><form>${inputs}<button>保存</button><p id="status" role="status"></p></form><script>const form=document.querySelector('form');fetch('/api/shared-config').then(r=>r.json()).then(data=>{for(const input of form.querySelectorAll('input')){if(input.type==='password')input.placeholder=data[input.name+'Configured']?'已配置，留空保留':'尚未配置';else input.value=data[input.name]||''}});form.onsubmit=async event=>{event.preventDefault();const response=await fetch('/api/shared-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});document.querySelector('#status').textContent=response.ok?'已保存':'保存失败，请检查服务地址';if(response.ok)for(const input of form.querySelectorAll('input[type=password]')){input.value='';input.placeholder='留空保留现有配置'}}</script></html>`);
    return true;
  }
  if (!['/api/shared-config', '/api/save-visual-config', '/api/save-openrouter-config'].includes(pathname)) return false;
  if (req.method === 'GET' && pathname === '/api/shared-config') { respond(200, { ...publicSharedServices(), canManage: req.user?.role === 'superuser' }); return true; }
  if (req.user?.role !== 'superuser') { respond(403, { error: '共享服务配置由超级用户管理' }); return true; }
  if (req.method !== 'POST') { respond(405, {}); return true; }
  try { const config = saveSharedServices(await readBody(req)); respond(200, { ok: true, config }); }
  catch { respond(400, { error: '配置无效，请检查服务地址' }); }
  return true;
}
