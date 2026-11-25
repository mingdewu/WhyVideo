(() => {
  if (!window.STUDIO_CURRENT_USER_ID) return;
  const originalFetch = window.fetch.bind(window);
  const tokenKey = 'whyvideo_edit_token';
  let token = null;
  try { token = sessionStorage.getItem(tokenKey); } catch {}
  if (!token || !/^[a-zA-Z0-9_-]{20,100}$/.test(token)) {
    token = crypto.randomUUID().replaceAll('-', '');
    try { sessionStorage.setItem(tokenKey, token); } catch {}
  }
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
        if ((data.canWrite || data.owner) && !data.editing) {
          const acq = await control(project, 'acquire');
          if (acq.ok) {
            const acqData = await acq.json().catch(() => ({}));
            return { revision: acqData.revision || data.revision };
          }
        }
        return { revision: data.revision };
      }));
    }
    return states.get(project);
  }
  const exempt = new Set(['/api/writer/create-blank-project', '/api/import-script-project', '/api/preview-script-segmentation', '/api/remotion-studio/open', '/api/delete-project']);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = (options.method || input.method || 'GET').toUpperCase();
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/edit/')) return originalFetch(input, options);
    let body = {};
    try { body = JSON.parse(options.body || '{}'); } catch {}
    const project = body.projectId || url.searchParams.get('project') || shownProject || new URL(location.href).searchParams.get('project') || window.STUDIO_DEFAULT_PROJECT_ID;
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
  const currentUser = window.STUDIO_CURRENT_USER || {
    id: window.STUDIO_CURRENT_USER_ID,
    username: '当前账号',
    role: 'user',
  };
  let triggerBtn;
  let statusDot;
  let statusBadge;
  let menuPanel;
  let sessionSection;
  let menuOpen = false;

  function setMenuOpen(next) {
    menuOpen = Boolean(next);
    if (!menuPanel || !triggerBtn) return;
    menuPanel.classList.toggle('hidden', !menuOpen);
    triggerBtn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  }

  window.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('studioAccountMenuMount') || document.getElementById('appHeader') || document.body;
    panel = document.createElement('div');
    panel.className = 'relative inline-block text-left';

    triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.id = 'studioAccountMenuBtn';
    triggerBtn.setAttribute('aria-haspopup', 'true');
    triggerBtn.setAttribute('aria-expanded', 'false');
    triggerBtn.className = 'px-3 py-1.5 text-xs font-bold rounded-xl bg-surface hover:bg-subtle text-ink border border-line-strong transition shadow-sm inline-flex items-center gap-2 cursor-pointer whitespace-nowrap';

    statusDot = document.createElement('span');
    statusDot.className = 'w-2 h-2 rounded-full bg-ok-solid shrink-0';

    const userSpan = document.createElement('span');
    userSpan.className = 'font-extrabold text-ink truncate max-w-[120px]';
    userSpan.textContent = '👤 ' + (currentUser.username || '当前账号');

    statusBadge = document.createElement('span');
    statusBadge.className = 'px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-ok-soft text-ok border border-ok-line whitespace-nowrap shrink-0';
    statusBadge.textContent = '加载中';

    const caret = document.createElement('span');
    caret.className = 'text-ink-muted text-[10px] shrink-0';
    caret.textContent = '▾';

    triggerBtn.append(statusDot, userSpan, statusBadge, caret);
    triggerBtn.onclick = (e) => {
      e.stopPropagation();
      setMenuOpen(!menuOpen);
    };

    menuPanel = document.createElement('div');
    menuPanel.id = 'studioAccountDropdown';
    menuPanel.className = 'hidden absolute right-0 mt-2 w-60 rounded-2xl bg-surface border border-line-strong shadow-xl p-2 z-50 space-y-1.5 text-xs text-ink';
    menuPanel.onclick = (e) => e.stopPropagation();

    const headerBox = document.createElement('div');
    headerBox.className = 'px-2.5 py-2 rounded-xl bg-subtle border border-line space-y-0.5';
    const headerTitle = document.createElement('div');
    headerTitle.className = 'font-extrabold text-ink flex items-center justify-between gap-2';
    const nameEl = document.createElement('span');
    nameEl.className = 'truncate';
    nameEl.textContent = currentUser.username || '当前账号';
    const roleEl = document.createElement('span');
    roleEl.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface text-ink-secondary border border-line shrink-0';
    roleEl.textContent = currentUser.role === 'superuser' ? '管理员' : '普通用户';
    headerTitle.append(nameEl, roleEl);
    headerBox.appendChild(headerTitle);

    sessionSection = document.createElement('div');
    sessionSection.className = 'space-y-1 pt-1';

    menuPanel.append(headerBox, sessionSection);

    if (currentUser.role === 'superuser') {
      const divider1 = document.createElement('div');
      divider1.className = 'border-t border-line my-1';
      const adminGroup = document.createElement('div');
      adminGroup.className = 'space-y-1';

      const accountLink = document.createElement('a');
      accountLink.href = '/account-management';
      accountLink.className = 'block w-full text-left px-2.5 py-2 rounded-xl hover:bg-subtle text-ink font-bold transition';
      accountLink.textContent = '👥 账号管理';

      const serviceLink = document.createElement('a');
      serviceLink.href = '/service-settings';
      serviceLink.className = 'block w-full text-left px-2.5 py-2 rounded-xl hover:bg-subtle text-ink font-bold transition';
      serviceLink.textContent = '🔑 共享服务设置';

      adminGroup.append(accountLink, serviceLink);
      menuPanel.append(divider1, adminGroup);
    }

    const divider2 = document.createElement('div');
    divider2.className = 'border-t border-line my-1';
    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'block w-full text-left px-2.5 py-2 rounded-xl hover:bg-danger-soft text-danger font-bold transition cursor-pointer';
    logoutBtn.textContent = '🚪 退出登录';
    logoutBtn.onclick = async () => {
      await originalFetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    };
    menuPanel.append(divider2, logoutBtn);

    panel.append(triggerBtn, menuPanel);
    mount.appendChild(panel);

    document.addEventListener('click', () => {
      if (menuOpen) setMenuOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
    });

    refresh();
  });

  async function refresh() {
    const project = shownProject || new URL(location.href).searchParams.get('project') || window.STUDIO_DEFAULT_PROJECT_ID;
    if (!project || !panel || !sessionSection || !statusBadge) return;
    await state(project);
    const response = await control(project, 'state', 'GET');
    if (!response.ok) {
      statusBadge.textContent = '未选择工程';
      statusBadge.className = 'px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-subtle text-ink-muted border border-line';
      statusDot.className = 'w-2 h-2 rounded-full bg-warn-solid shrink-0';
      sessionSection.replaceChildren();
      const tip = document.createElement('div');
      tip.className = 'px-2.5 py-1.5 text-ink-muted';
      tip.textContent = '请创建或选择工程';
      sessionSection.appendChild(tip);
      return;
    }
    let info = await response.json();
    if (info.mine || ((info.canWrite || info.owner) && !info.editing)) {
      const acq = await control(project, 'acquire');
      if (acq.ok && !info.mine) {
        const refreshed = await control(project, 'state', 'GET');
        if (refreshed.ok) info = await refreshed.json();
      }
    }

    const statusText = info.mine ? '编辑中' : (info.holder ? '只读 · ' + info.holder + '正在编辑' : '只读');
    statusBadge.textContent = statusText;
    if (info.mine) {
      statusBadge.className = 'px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-ok-soft text-ok border border-ok-line whitespace-nowrap shrink-0';
      statusDot.className = 'w-2 h-2 rounded-full bg-ok-solid shrink-0';
    } else {
      statusBadge.className = 'px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-warn-soft text-warn border border-warn-line whitespace-nowrap shrink-0';
      statusDot.className = 'w-2 h-2 rounded-full bg-warn-solid shrink-0';
    }

    sessionSection.replaceChildren();
    const stateRow = document.createElement('div');
    stateRow.className = 'px-2.5 py-1 text-[11px] text-ink-secondary flex items-center justify-between';
    stateRow.textContent = '当前工程状态：' + statusText;
    sessionSection.appendChild(stateRow);

    const button = (text, action, primary = false) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = text;
      element.className = primary
        ? 'block w-full text-left px-2.5 py-2 rounded-xl bg-action hover:bg-action-hover text-ink-inverse font-bold transition cursor-pointer'
        : 'block w-full text-left px-2.5 py-2 rounded-xl hover:bg-subtle text-ink font-bold transition cursor-pointer';
      element.onclick = async () => {
        const result = await control(project, action);
        if (!result.ok) { const data = await result.json(); alert(data.error || '操作失败'); }
        else if (action === 'acquire') { alert('已进入编辑。请刷新页面载入最新内容后保存。'); location.reload(); }
        await refresh();
      };
      sessionSection.appendChild(element);
    };
    if (info.mine) button('✋ 退出编辑', 'release');
    else if (info.canWrite || info.owner) button('✏️ 进入编辑', 'acquire', true);
    else { button('🙋 申请编辑', 'request'); button('⚡ 接手编辑', 'acquire', true); }
    if (info.owner && info.request) button('🤝 交给 ' + info.request.username + ' 编辑', 'grant', true);
  }
  setInterval(() => { refresh().catch(console.error); }, 20000);
})();
