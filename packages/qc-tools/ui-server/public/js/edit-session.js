(() => {
  if (!window.STUDIO_CURRENT_USER_ID) return;
  const originalFetch = window.fetch.bind(window);
  const token = crypto.randomUUID().replaceAll('-', '');
  const states = new Map();
  let shownProject;
  let panel;
  async function control(project, action, method = 'POST') {
    return originalFetch('/api/edit/' + action + '?project=' + encodeURIComponent(project), {
      method, headers: { 'X-Edit-Token': token },
    });
  }
  async function state(project) {
    if (!states.has(project)) {
      states.set(project, control(project, 'state', 'GET').then(async response => {
        if (!response.ok) return null;
        const data = await response.json();
        if (data.owner && !data.editing) await control(project, 'acquire');
        return { revision: data.revision };
      }));
    }
    return states.get(project);
  }
  const exempt = new Set(['/api/writer/create-blank-project', '/api/import-script-project', '/api/preview-script-segmentation', '/api/remotion-studio/open']);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = (options.method || input.method || 'GET').toUpperCase();
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/edit/')) return originalFetch(input, options);
    let body = {};
    try { body = JSON.parse(options.body || '{}'); } catch {}
    const project = body.projectId || url.searchParams.get('project');
    if (!project || exempt.has(url.pathname)) return originalFetch(input, options);
    shownProject = project;
    const entry = await state(project);
    if (!entry) return originalFetch(input, options);
    if (method === 'GET' || method === 'HEAD') {
      const readHeaders = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
      readHeaders.set('X-Edit-Token', token);
      const response = await originalFetch(input, { ...options, headers: readHeaders });
      if (response.ok && ['/api/writer/data', '/api/workflow-data'].includes(url.pathname)) {
        entry.revision = response.headers.get('X-Project-Revision') || entry.revision;
      }
      return response;
    }
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Edit-Token', token);
    headers.set('X-Project-Revision', entry.revision);
    const response = await originalFetch(input, { ...options, headers });
    if (response.ok) entry.revision = response.headers.get('X-Project-Revision') || entry.revision;
    return response;
  };
  window.addEventListener('DOMContentLoaded', () => {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#1f2937;color:white;padding:10px;border-radius:8px;display:flex;gap:8px;align-items:center';
    document.body.appendChild(panel);
    refresh();
  });
  async function refresh() {
    const project = shownProject || new URL(location.href).searchParams.get('project') || window.STUDIO_DEFAULT_PROJECT_ID;
    if (!project || !panel) return;
    await state(project);
    const response = await control(project, 'state', 'GET');
    if (!response.ok) { panel.textContent = '请创建或选择工程'; return; }
    const info = await response.json();
    if (info.mine) await control(project, 'acquire');
    panel.replaceChildren();
    const label = document.createElement('span');
    label.textContent = info.mine ? '编辑中' : (info.holder ? '只读 · ' + info.holder + '正在编辑' : '只读');
    panel.appendChild(label);
    const button = (text, action) => {
      const element = document.createElement('button'); element.textContent = text;
      element.onclick = async () => {
        const result = await control(project, action);
        if (!result.ok) { const data = await result.json(); alert(data.error || '操作失败'); }
        else if (action === 'acquire') { alert('已进入编辑。请刷新页面载入最新内容后保存。'); location.reload(); }
        await refresh();
      };
      panel.appendChild(element);
    };
    if (info.mine) button('退出编辑', 'release');
    else if (info.owner) button('进入编辑', 'acquire');
    else { button('申请编辑', 'request'); button('接手编辑', 'acquire'); }
    if (info.owner && info.request) button('交给 ' + info.request.username + ' 编辑', 'grant');
  }
  setInterval(() => { refresh().catch(console.error); }, 20000);
})();
