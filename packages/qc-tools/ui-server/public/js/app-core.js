    if (window.STUDIO_CURRENT_USER_ID && localStorage.getItem('whyvideo_current_user') !== window.STUDIO_CURRENT_USER_ID) {
      localStorage.removeItem('whyvideo_active_project');
      localStorage.setItem('whyvideo_current_user', window.STUDIO_CURRENT_USER_ID);
    }
    let activeProjectId = new URLSearchParams(window.location.search).get('project') || localStorage.getItem('whyvideo_active_project') || window.STUDIO_DEFAULT_PROJECT_ID;
    let manifestData = null;
    let assetIndexData = null;
    let projectsList = [];
    let currentSelectedModel = 'minimax/hailuo-3';

    let visualConfig = {
      apiKey: '',
      baseUrl: 'https://openrouter.ai/api/v1',
      writerModel: 'deepseek/deepseek-chat',
      videoModel: 'minimax/hailuo-3',
      textModel: 'deepseek/deepseek-chat',
      imageModel: 'black-forest-labs/flux-1-schnell',
      bgmModel: 'google/gemini-2.5-flash'
    };
    let sharedServicesPromise;
    function loadSharedServices() {
      if (!sharedServicesPromise) sharedServicesPromise = fetch('/api/shared-config').then(response => response.json()).then(config => {
        visualConfig = { ...visualConfig, ...config, apiKey: config.apiKeyConfigured ? '••••••••' : '' };
        window._elevenlabsKeyConfigured = Boolean(config.elevenlabsApiKeyConfigured);
        if (!config.canManage) {
          for (const id of ['currentApiKeyInput', 'currentTavilyKeyInput', 'currentMeowloadKeyInput', 'currentBaseUrlInput']) {
            const input = document.getElementById(id);
            if (input) { input.disabled = true; input.placeholder = '由超级用户配置，登录后即可使用'; }
          }
          const save = document.querySelector('#visualModelModal button[onclick="saveVisualModelConfig()"]');
          if (save) { save.disabled = true; save.textContent = '共享配置由超级用户管理'; }
        }
        return config;
      }).catch(() => ({}));
      return sharedServicesPromise;
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.remove('hidden');
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
    }

    function showCompletionModal({
      title = '已完成',
      message = '',
      detail = '',
      icon = '✅',
      confirmText = '知道了',
      actionText = '',
      actionUrl = '',
    } = {}) {
      const modal = document.getElementById('studioCompletionModal');
      if (!modal) {
        if (message) showToast(icon + ' ' + message);
        return;
      }
      const iconEl = document.getElementById('completionModalIcon');
      const titleEl = document.getElementById('completionModalTitle');
      const msgEl = document.getElementById('completionModalMessage');
      const detailEl = document.getElementById('completionModalDetail');
      const timeEl = document.getElementById('completionModalTime');
      const btnEl = document.getElementById('completionModalConfirmBtn');
      const actionLinkEl = document.getElementById('completionModalActionLink');

      if (iconEl) iconEl.textContent = icon || '✅';
      if (titleEl) titleEl.textContent = title || '已完成';
      if (msgEl) msgEl.textContent = message || title || '操作已完成';
      if (detailEl) {
        const cleanDetail = String(detail || '').trim();
        detailEl.textContent = cleanDetail;
        detailEl.classList.toggle('hidden', !cleanDetail);
      }
      if (timeEl) {
        timeEl.textContent = '完成时间：' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      }
      if (btnEl) btnEl.textContent = confirmText || '知道了';
      if (actionLinkEl) {
        const cleanActionText = String(actionText || '').trim();
        const cleanActionUrl = String(actionUrl || '').trim();
        if (cleanActionText && cleanActionUrl) {
          actionLinkEl.textContent = cleanActionText;
          actionLinkEl.href = cleanActionUrl;
          actionLinkEl.classList.remove('hidden');
        } else {
          actionLinkEl.classList.add('hidden');
        }
      }

      modal.classList.remove('hidden');
      setTimeout(() => {
        if (btnEl && !modal.classList.contains('hidden')) {
          btnEl.focus();
        }
      }, 20);
    }

    function closeCompletionModal() {
      const modal = document.getElementById('studioCompletionModal');
      if (modal) modal.classList.add('hidden');
    }

    // ==========================================
    // ✍️ 文案创作工坊 (Writer Workspace) SPA 状态与逻辑
    // ==========================================
    let currentWorkspaceTab = new URLSearchParams(window.location.search).get('tab') || 'producer';


    function switchWorkspaceTab(tab) {
      if (typeof cancelActiveVoiceInput === 'function') {
        cancelActiveVoiceInput(false);
      }
      currentWorkspaceTab = tab;
      const url = new URL(window.location);
      url.searchParams.set('tab', tab);
      window.history.pushState({}, '', url);

      const isProducer = tab === 'producer';
      const isWriter = tab === 'writer';
      const isPublish = tab === 'publish';
      document.getElementById('viewPublishContainer').classList.toggle('hidden', !isPublish);
      document.body.classList.toggle('writer-compact-mode', isWriter);
      document.getElementById('viewProducerContainer').classList.toggle('hidden', !isProducer);
      document.getElementById('viewWriterContainer').classList.toggle('hidden', !isWriter);

      document.getElementById('producerHeaderActions').classList.toggle('hidden', !isProducer);
      document.getElementById('writerHeaderActions').classList.toggle('hidden', !isWriter);

      const navP = document.getElementById('navTabProducer');
      const navW = document.getElementById('navTabWriter');
      const navPub = document.getElementById('navTabPublish');
      const activeTabCls = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 text-ink-inverse shadow cursor-pointer bg-action hover:bg-action-hover';
      const inactiveTabCls = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 text-ink-muted hover:text-ink cursor-pointer';
      if (navP) navP.className = isProducer ? activeTabCls : inactiveTabCls;
      if (navW) navW.className = isWriter ? activeTabCls : inactiveTabCls;
      if (navPub) navPub.className = isPublish ? activeTabCls : inactiveTabCls;

      const curProj = projectsList.find((p) => p.id === activeProjectId);
      const titleStr = curProj ? curProj.title : activeProjectId;
      if (isProducer) {
        document.getElementById('projectHeaderTitle').textContent = titleStr + ' · 视觉镜头工作台';
        if (!manifestData || manifestData.project_id !== activeProjectId) {
          loadWorkflow();
        }
      } else if (isPublish) {
        document.getElementById('projectHeaderTitle').textContent = titleStr + ' · 发布台';
        loadPublishProject();
      } else {
        document.getElementById('projectHeaderTitle').textContent = titleStr + ' · 知识长视频文案策划工坊';
        loadWriterProjectData(activeProjectId);
      }
    }

    function updateActiveProjectTitleUI(newTitle) {
      const cleanTitle = String(newTitle || '').trim().replace(/^《(.*)》$/, '$1');
      const displayTitle = cleanTitle ? `《${cleanTitle}》` : activeProjectId;
      const cur = projectsList.find((p) => p.id === activeProjectId);
      if (cur) {
        cur.title = displayTitle;
      }
      const sel = document.getElementById('projectSelect');
      if (sel) {
        const opt = Array.from(sel.options).find((o) => o.value === activeProjectId);
        if (opt) opt.textContent = `${displayTitle} (${activeProjectId})`;
      }
      const headerEl = document.getElementById('projectHeaderTitle');
      if (headerEl) {
        headerEl.textContent =
          displayTitle + (currentWorkspaceTab === 'writer' ? ' · 知识长视频文案策划工坊' : ' · 视觉镜头工作台');
      }
      const inspectorTitleEl = document.getElementById('wInspectorTitle');
      if (inspectorTitleEl && cleanTitle) {
        inspectorTitleEl.textContent = cleanTitle;
      }
    }


    // 🪗 模型配置 1~7 核心模型手风琴折叠控制 (单项展开，其余折叠)
    function toggleModelAccordion(idx, forceOpen = false) {
      for (let i = 1; i <= 7; i++) {
        const bodyEl = document.getElementById('accordionBodyModel' + i);
        const arrowEl = document.getElementById('accordionArrowModel' + i);
        const headerEl = document.getElementById('accordionHeaderModel' + i);
        if (!bodyEl) continue;
        if (i === idx) {
          const isCurrentlyOpen = !bodyEl.classList.contains('hidden');
          if (isCurrentlyOpen && !forceOpen) {
            bodyEl.classList.add('hidden');
            if (arrowEl) arrowEl.textContent = '▶';
            if (headerEl) headerEl.classList.remove('bg-subtle', 'border-accent-line');
          } else {
            bodyEl.classList.remove('hidden');
            if (arrowEl) arrowEl.textContent = '▼';
            if (headerEl) headerEl.classList.add('bg-subtle', 'border-accent-line');
          }
        } else {
          bodyEl.classList.add('hidden');
          if (arrowEl) arrowEl.textContent = '▶';
          if (headerEl) headerEl.classList.remove('bg-subtle', 'border-accent-line');
        }
      }
      updateModelHeaderBadges();
    }

    function updateModelHeaderBadges() {
      const wEl = document.getElementById('currentWriterModelInput');
      const vEl = document.getElementById('currentVideoModelInput');
      const tEl = document.getElementById('currentTextModelInput');
      const iEl = document.getElementById('currentImageModelInput');
      const bgmEl = document.getElementById('currentBgmModelInput');
      const kwEl = document.getElementById('currentKeywordModelInput');
      const trEl = document.getElementById('currentTranslateModelInput');

      const bW = document.getElementById('modelHeaderBadgeWriter');
      const bV = document.getElementById('modelHeaderBadgeVideo');
      const bT = document.getElementById('modelHeaderBadgeText');
      const bI = document.getElementById('modelHeaderBadgeImage');
      const bB = document.getElementById('modelHeaderBadgeBgm');
      const bK = document.getElementById('modelHeaderBadgeKeyword');
      const bTr = document.getElementById('modelHeaderBadgeTranslate');

      if (bW && wEl) bW.textContent = (wEl.value || '').split('/').pop() || '未指定';
      if (bV && vEl) bV.textContent = (vEl.value || '').split('/').pop() || '未指定';
      if (bT && tEl) bT.textContent = (tEl.value || '').split('/').pop() || '未指定';
      if (bI && iEl) bI.textContent = (iEl.value || '').split('/').pop() || '未指定';
      if (bB && bgmEl) bB.textContent = (bgmEl.value || '').split('/').pop() || '未指定';
      if (bK && kwEl) bK.textContent = (kwEl.value || '').split('/').pop() || '未指定';
      if (bTr && trEl) bTr.textContent = (trEl.value || '').split('/').pop() || '未指定';
    }

    function toggleVisualModelModal(focusSection) {
      const modal = document.getElementById('visualModelModal');
      const isHidden = modal.classList.contains('hidden');
      if (isHidden) {
        modal.classList.remove('hidden');
        updateModelHeaderBadges();
        let targetIdx = 1;
        if (focusSection === 'video') targetIdx = 2;
        else if (focusSection === 'text' || focusSection === 'prompt') targetIdx = 3;
        else if (focusSection === 'image') targetIdx = 4;
        else if (focusSection === 'bgm') targetIdx = 5;
        else if (focusSection === 'keyword') targetIdx = 6;
        else if (focusSection === 'translate') targetIdx = 7;
        else targetIdx = 1;

        toggleModelAccordion(targetIdx, true);
        setTimeout(() => {
          let inputId = '';
          if (targetIdx === 1) inputId = 'currentWriterModelInput';
          else if (targetIdx === 2) inputId = 'currentVideoModelInput';
          else if (targetIdx === 3) inputId = 'currentTextModelInput';
          else if (targetIdx === 4) inputId = 'currentImageModelInput';
          else if (targetIdx === 5) inputId = 'currentBgmModelInput';
          else if (targetIdx === 6) inputId = 'currentKeywordModelInput';
          else if (targetIdx === 7) inputId = 'currentTranslateModelInput';
          if (inputId) {
            const inputEl = document.getElementById(inputId);
            if (inputEl) inputEl.focus();
          }
        }, 50);
      } else {
        modal.classList.add('hidden');
      }
    }

    // 全局支持按 Escape 键关闭完成提示弹窗、模型调度中心、配音中心或 BGM 弹窗
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const cModal = document.getElementById('studioCompletionModal');
        if (cModal && !cModal.classList.contains('hidden')) {
          closeCompletionModal();
          return;
        }
        const vModal = document.getElementById('visualModelModal');
        if (vModal && !vModal.classList.contains('hidden')) {
          vModal.classList.add('hidden');
        }
        const aModal = document.getElementById('audioModal');
        if (aModal && !aModal.classList.contains('hidden')) {
          aModal.classList.add('hidden');
        }
        const bModal = document.getElementById('bgmModal');
        if (bModal && !bModal.classList.contains('hidden')) {
          bModal.classList.add('hidden');
          stopBgmPreviewAudio();
        }
      }
    });

    // 修复文案台“AI 写作模型与网关配置”点不开问题：直接调用全流程模型控制中心并自动定位至文案大模型与统一网关
    function openWriterModelModal() {
      toggleVisualModelModal('writer');
    }

    function syncWriterModelToConfig(slug) {
      if (!slug) return;
      visualConfig.writerModel = slug;
      const wInput = document.getElementById('currentWriterModelInput');
      if (wInput) wInput.value = slug;
      updateModelBadge();
      showToast('✍️ 已切换文案大模型: ' + slug.split('/').pop());
    }

    function selectWriterModelSlug(slug) {
      const wInput = document.getElementById('currentWriterModelInput');
      if (wInput) wInput.value = slug;
      const wSelect = document.getElementById('wInputModel');
      if (wSelect) {
        let found = false;
        for (let i = 0; i < wSelect.options.length; i++) {
          if (wSelect.options[i].value === slug) {
            wSelect.selectedIndex = i;
            found = true;
            break;
          }
        }
        if (!found) {
          const opt = document.createElement('option');
          opt.value = slug;
          opt.textContent = slug + ' (自定义指定)';
          opt.selected = true;
          wSelect.appendChild(opt);
        }
      }
      updateModelHeaderBadges();
    }


    function selectVideoModelSlug(slug) {
      document.getElementById('currentVideoModelInput').value = slug;
      updateModelHeaderBadges();
    }

    function selectTextModelSlug(slug) {
      document.getElementById('currentTextModelInput').value = slug;
      updateModelHeaderBadges();
    }

    function selectImageModelSlug(slug) {
      document.getElementById('currentImageModelInput').value = slug;
      updateModelHeaderBadges();
    }

    function selectBgmModelSlug(slug) {
      document.getElementById('currentBgmModelInput').value = slug;
      updateModelHeaderBadges();
    }

    function selectKeywordModelSlug(slug) {
      document.getElementById('currentKeywordModelInput').value = slug;
      updateModelHeaderBadges();
    }

    function selectTranslateModelSlug(slug) {
      document.getElementById('currentTranslateModelInput').value = slug;
      updateModelHeaderBadges();
    }

    async function testCurrentProviderConnection() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const model = (document.getElementById('currentTextModelInput')?.value || '').trim() || 'deepseek/deepseek-chat';
      const statusEl = document.getElementById('testConnStatus');
      const btn = document.getElementById('btnTestProvider');

      if (!apiKey) {
        alert('请先输入 API Key');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在连接测试...</span>';
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '<span class="text-warn">正在与服务网关通信...</span>';
      }

      try {
        const res = await fetch('/api/test-provider?project=' + (activeProjectId || ''), {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openrouter', apiKey, baseUrl, model })
        });
        const data = await res.json();
        if (data.ok) {
          if (statusEl) statusEl.innerHTML = '<span class="text-ok font-bold">✅ ' + data.message + '</span>';
          showToast('✅ ' + data.message);
        } else {
          const errMsg = data.error || '连接失败';
          if (statusEl) statusEl.innerHTML = '<span class="text-danger font-bold">❌ ' + errMsg + '</span>';
          showToast('❌ ' + errMsg);
        }
      } catch (e) {
        const msg = (e?.name === 'TimeoutError' || e?.name === 'AbortError') ? '请求超时（20秒），请检查网络或代理设置' : e.message;
        if (statusEl) statusEl.innerHTML = '<span class="text-danger font-bold">❌ 请求失败: ' + msg + '</span>';
        showToast('❌ 请求失败: ' + msg);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '⚡测试';
      }
    }

    async function testAuxiliaryApiConnection({ endpoint, inputId, btnId, statusId, label }) {
      const apiKey = (document.getElementById(inputId)?.value || '').trim();
      const statusEl = document.getElementById(statusId);
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳';
      }
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '<span class="text-warn">正在测试 ' + label + ' 连接...</span>';
      }
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(20000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, projectId: activeProjectId || '' }),
        });
        const data = await res.json();
        if (data.ok) {
          if (statusEl) statusEl.innerHTML = '<span class="text-ok font-bold">✅ ' + data.message + '</span>';
          showToast('✅ ' + data.message);
        } else {
          const errMsg = data.error || (label + ' 连接失败');
          if (statusEl) statusEl.innerHTML = '<span class="text-danger font-bold">❌ ' + errMsg + '</span>';
          showToast('❌ ' + errMsg);
        }
      } catch (e) {
        const msg = (e?.name === 'TimeoutError' || e?.name === 'AbortError') ? '请求超时（20秒）' : e.message;
        if (statusEl) statusEl.innerHTML = '<span class="text-danger font-bold">❌ 请求失败: ' + msg + '</span>';
        showToast('❌ ' + label + ' 请求失败: ' + msg);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '⚡测试';
        }
      }
    }

    function testTavilyConnection() {
      return testAuxiliaryApiConnection({
        endpoint: '/api/test-tavily',
        inputId: 'currentTavilyKeyInput',
        btnId: 'btnTestTavily',
        statusId: 'testTavilyStatus',
        label: 'Tavily'
      });
    }

    function testMeowloadConnection() {
      return testAuxiliaryApiConnection({
        endpoint: '/api/test-meowload',
        inputId: 'currentMeowloadKeyInput',
        btnId: 'btnTestMeowload',
        statusId: 'testMeowloadStatus',
        label: '哼哼猫'
      });
    }

    const MODEL_PREFS_STORAGE_KEY = 'whyvideo_studio_model_prefs_v1';
    const MODEL_PREF_FIELD_MAP = [
      ['apiKey', 'currentApiKeyInput'],
      ['baseUrl', 'currentBaseUrlInput'],
      ['tavilyApiKey', 'currentTavilyKeyInput'],
      ['writerModel', 'currentWriterModelInput'],
      ['videoModel', 'currentVideoModelInput'],
      ['textModel', 'currentTextModelInput'],
      ['imageModel', 'currentImageModelInput'],
      ['bgmModel', 'currentBgmModelInput'],
      ['keywordModel', 'currentKeywordModelInput'],
      ['translateModel', 'currentTranslateModelInput'],
    ];

    function saveModelPrefsToLocal() {
      try {
        const prev = JSON.parse(localStorage.getItem(MODEL_PREFS_STORAGE_KEY) || '{}');
        const next = { ...prev };
        for (const [key, id] of MODEL_PREF_FIELD_MAP) {
          const el = document.getElementById(id);
          if (!el) continue;
          const val = String(el.value || '').trim();
          if (val && !/^•+$/.test(val)) next[key] = val;
        }
        localStorage.setItem(MODEL_PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {}
    }

    function restoreModelPrefsFromLocal() {
      try {
        const prefs = JSON.parse(localStorage.getItem(MODEL_PREFS_STORAGE_KEY) || '{}');
        if (!prefs || typeof prefs !== 'object') return;
        for (const [key, id] of MODEL_PREF_FIELD_MAP) {
          const el = document.getElementById(id);
          const val = String(prefs[key] || '').trim();
          if (el && val && !/^•+$/.test(val)) {
            el.value = val;
          }
        }
        if (prefs.apiKey) visualConfig.apiKey = prefs.apiKey;
        if (prefs.baseUrl) visualConfig.baseUrl = prefs.baseUrl;
        if (prefs.writerModel) visualConfig.writerModel = prefs.writerModel;
        if (prefs.videoModel) visualConfig.videoModel = prefs.videoModel;
        if (prefs.textModel) visualConfig.textModel = prefs.textModel;
        if (prefs.imageModel) visualConfig.imageModel = prefs.imageModel;
        if (prefs.bgmModel) visualConfig.bgmModel = prefs.bgmModel;
        if (prefs.keywordModel) visualConfig.keywordModel = prefs.keywordModel;
        if (prefs.translateModel) visualConfig.translateModel = prefs.translateModel;

        const syncSelect = (selId, val) => {
          const sel = document.getElementById(selId);
          if (sel && val) sel.value = val;
        };
        syncSelect('writerModelSelect', visualConfig.writerModel);
        syncSelect('videoModelSelect', visualConfig.videoModel);
        syncSelect('textModelSelect', visualConfig.textModel);
        syncSelect('imageModelSelect', visualConfig.imageModel);
        syncSelect('bgmModelSelect', visualConfig.bgmModel);
        syncSelect('keywordModelSelect', visualConfig.keywordModel);
        syncSelect('translateModelSelect', visualConfig.translateModel);
        updateModelBadge();
        updateModelHeaderBadges();
      } catch (e) {}
    }

    function bindModelPrefAutoSave() {
      for (const [, id] of MODEL_PREF_FIELD_MAP) {
        const el = document.getElementById(id);
        if (el && !el.dataset.prefBound) {
          el.dataset.prefBound = '1';
          el.addEventListener('input', saveModelPrefsToLocal);
          el.addEventListener('change', saveModelPrefsToLocal);
        }
      }
      for (const selId of ['writerModelSelect', 'videoModelSelect', 'textModelSelect', 'imageModelSelect', 'bgmModelSelect', 'keywordModelSelect', 'translateModelSelect']) {
        const sel = document.getElementById(selId);
        if (sel && !sel.dataset.prefBound) {
          sel.dataset.prefBound = '1';
          sel.addEventListener('change', saveModelPrefsToLocal);
        }
      }
    }

    async function saveVisualModelConfig() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const tavilyApiKey = document.getElementById('currentTavilyKeyInput').value.trim();
      const meowloadApiKey = (document.getElementById('currentMeowloadKeyInput')?.value || '').trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const writerModel = (document.getElementById('currentWriterModelInput')?.value || '').trim() || 'deepseek/deepseek-chat';
      const videoModel = document.getElementById('currentVideoModelInput').value.trim();
      const textModel = document.getElementById('currentTextModelInput').value.trim();
      const imageModel = document.getElementById('currentImageModelInput').value.trim();
      const bgmModel = (document.getElementById('currentBgmModelInput')?.value || '').trim() || 'google/gemini-2.5-flash';
      const keywordModel = (document.getElementById('currentKeywordModelInput')?.value || '').trim() || textModel || 'deepseek/deepseek-chat';
      const translateModel = (document.getElementById('currentTranslateModelInput')?.value || '').trim() || textModel || 'deepseek/deepseek-chat';

      visualConfig.apiKey = apiKey;
      visualConfig.baseUrl = baseUrl;
      visualConfig.writerModel = writerModel;
      visualConfig.videoModel = videoModel;
      visualConfig.textModel = textModel;
      visualConfig.imageModel = imageModel;
      visualConfig.bgmModel = bgmModel;
      visualConfig.keywordModel = keywordModel;
      visualConfig.translateModel = translateModel;

      try {
        const res = await fetch('/api/save-visual-config?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            apiKey,
            tavilyApiKey,
            meowloadApiKey,
            baseUrl,
            writerModel,
            videoModel,
            textModel,
            imageModel,
            bgmModel,
            keywordModel,
            translateModel
          })
        });
        const data = await res.json();
        if (data.config) {
          const tavilyEl = document.getElementById('currentTavilyKeyInput');
          if (tavilyEl) {
            tavilyEl.value = data.config.tavilyKeyConfigured ? '••••••••••••••••••••' : '';
            tavilyEl.placeholder = data.config.tavilyKeyConfigured ? 'Tavily Key 已配置；留空或保留掩码即不修改' : '填写 Tavily Key；留空则使用环境变量';
          }
          const meowEl = document.getElementById('currentMeowloadKeyInput');
          if (meowEl) {
            meowEl.value = '';
            meowEl.placeholder = data.config.meowloadKeyConfigured ? '哼哼猫 Key 已配置；留空则保留' : '填写哼哼猫 API Key；留空则保留已存 Key';
          }
        }
        toggleVisualModelModal();
        saveModelPrefsToLocal();
        updateModelBadge();
        renderTable();
        selectWriterModelSlug(writerModel);
        showToast('🎯 全流程模型、网关与哼哼猫下载 Key 配置已保存！');
      } catch (e) {
        showToast('❌ 保存失败: ' + e.message);
      }
    }

    function updateModelBadge() {
      const wBadge = document.getElementById('currentWriterModelBadge');
      const vBadge = document.getElementById('currentVideoModelBadge');
      const tBadge = document.getElementById('currentTextModelBadge');
      const iBadge = document.getElementById('currentImageModelBadge');
      const kwBadge = document.getElementById('currentKeywordModelBadge');

      const wModel = (visualConfig.writerModel || 'deepseek-chat').split('/').pop();
      const vModel = (visualConfig.videoModel || 'minimax/hailuo-3-max').split('/').pop();
      const tModel = (visualConfig.textModel || 'deepseek-chat').split('/').pop();
      const iModel = (visualConfig.imageModel || 'flux-3-image').split('/').pop();
      const kwModel = (visualConfig.keywordModel || visualConfig.textModel || 'deepseek-chat').split('/').pop();

      if (wBadge) {
        wBadge.textContent = '📝 文案: ' + wModel;
      }
      if (vBadge) {
        vBadge.textContent = '🎬 视频: ' + vModel + (visualConfig.apiKey ? ' (Key就绪)' : ' (待填Key)');
      }
      if (tBadge) {
        tBadge.textContent = '✍️ 分镜: ' + tModel;
      }
      if (iBadge) {
        iBadge.textContent = '🖼️ 生图: ' + iModel;
      }
      if (kwBadge) {
        kwBadge.textContent = '🔎 关键词: ' + kwModel;
      }
    }

    async function loadProjects() {
      try {
        const res = await fetch('/api/projects?project=' + activeProjectId);
        const data = await res.json();
        projectsList = data.projects || [];
        
        if (!projectsList.some(p => p.id === activeProjectId) && projectsList.length > 0) {
          activeProjectId = projectsList[0].id;
        }

        const sel = document.getElementById('projectSelect');
        sel.replaceChildren();
        for (const project of projectsList) {
          const option = document.createElement('option');
          option.value = project.id;
          option.selected = project.id === activeProjectId;
          option.textContent = `${project.title} (${project.id})`;
          sel.appendChild(option);
        }

        const cur = projectsList.find(p => p.id === activeProjectId);
        if (cur) {
          document.getElementById('projectHeaderTitle').textContent =
            cur.title + (currentWorkspaceTab === 'writer' ? ' · 知识长视频文案策划工坊' : ' · 视觉镜头工作台');
        }
      } catch (e) {
        console.error('加载工程列表失败:', e);
      }
    }

    let pendingSelectedProjectId = activeProjectId;

    function onProjectSelectChange(newId) {
      pendingSelectedProjectId = newId;
    }

    function confirmSwitchProject() {
      if (!pendingSelectedProjectId || pendingSelectedProjectId === activeProjectId) return;
      onProjectChange(pendingSelectedProjectId);
    }

    async function deleteCurrentProject() {
      if (!activeProjectId || activeProjectId === 'why_nikko_heritage_road_001') {
        showToast('基准工程不可删除');
        return;
      }
      if (!window.confirm('确定删除当前工程及其本地文件吗？此操作无法撤销。')) return;
      try {
        const res = await fetch('/api/delete-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '删除失败');
        activeProjectId = data.nextActiveProjectId;
        pendingSelectedProjectId = activeProjectId;
        const url = new URL(window.location);
        if (!activeProjectId) {
          localStorage.removeItem('whyvideo_active_project');
          url.searchParams.delete('project');
          window.location.assign(url.toString());
          return;
        }
        url.searchParams.set('project', activeProjectId);
        window.history.pushState({}, '', url);
        await loadProjects();
        await loadWorkflow();
        if (currentWorkspaceTab === 'writer') await loadWriterProjectData(activeProjectId);
        showToast('已删除工程：' + data.deletedProjectId);
      } catch (e) {
        showToast('删除失败：' + e.message);
      }
    }

    function onProjectChange(newId) {
      pendingFinalizedScript = null;
      document.getElementById('wFinalizeReview')?.classList.add('hidden');
      activeProjectId = newId;
      pendingSelectedProjectId = newId;
      localStorage.setItem('whyvideo_active_project', newId);
      const url = new URL(window.location);
      url.searchParams.set('project', newId);
      window.history.pushState({}, '', url);
      loadProjects();
      loadWorkflow();
      refreshProducerPromptsStatus();
      updateRenderStatus();
      updateVoiceboxStatus();
      if (currentWorkspaceTab === 'writer') {
        loadWriterProjectData(newId);
      } else if (currentWorkspaceTab === 'publish') {
        loadPublishProject();
      }
      showToast('🔀 已切换至工程：' + newId);
    }


    const modelCatalogCache = { text: [], video: [], image: [], audio: [] };
    const modelCatalogMeta = { text: null, video: null, image: null };
    const MODEL_SELECT_CONFIGS = {
      writer:  { catalog: 'text',  selectId: 'writerModelSelect',  inputId: 'currentWriterModelInput',  searchId: 'writerModelSearch',  placeholder: '🔽 选择文案大模型' },
      video:   { catalog: 'video', selectId: 'videoModelSelect',   inputId: 'currentVideoModelInput',   searchId: 'videoModelSearch',   placeholder: '🔽 选择视频生成模型' },
      text:    { catalog: 'text',  selectId: 'textModelSelect',    inputId: 'currentTextModelInput',    searchId: 'textModelSearch',    placeholder: '🔽 选择分镜提炼模型' },
      image:   { catalog: 'image', selectId: 'imageModelSelect',   inputId: 'currentImageModelInput',   searchId: 'imageModelSearch',   placeholder: '🔽 选择超清生图模型' },
      bgm:       { catalog: 'audio', selectId: 'bgmModelSelect',       inputId: 'currentBgmModelInput',       searchId: 'bgmModelSearch',       placeholder: '🔽 选择支持音频输入的 BGM 模型' },
      keyword:   { catalog: 'text',  selectId: 'keywordModelSelect',   inputId: 'currentKeywordModelInput',   searchId: 'keywordModelSearch',   placeholder: '🔽 选择关键词提炼模型' },
      translate: { catalog: 'text',  selectId: 'translateModelSelect', inputId: 'currentTranslateModelInput', searchId: 'translateModelSearch', placeholder: '🔽 选择发布资料与翻译模型' },
    };

    function populateModelSelect(selectId, inputId, models, placeholderLabel, totalCount) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const curVal = (document.getElementById(inputId)?.value || '').trim();
      const total = typeof totalCount === 'number' ? totalCount : models.length;
      const countText = (total > models.length)
        ? ('命中 ' + models.length + ' / 共 ' + total + ' 个')
        : ('共 ' + models.length + ' 个');
      const opts = ['<option value="">' + placeholderLabel + '（' + countText + '）</option>'];
      let hasCur = false;
      for (const m of models) {
        const id = String(m.id || '').trim();
        if (!id) continue;
        const selected = id === curVal ? ' selected' : '';
        if (selected) hasCur = true;
        const label = (m.name && m.name !== id) ? (m.name + ' (' + id + ')') : id;
        opts.push('<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(label) + '</option>');
      }
      if (curVal && !hasCur) {
        opts.splice(1, 0, '<option value="' + escapeHtml(curVal) + '" selected>' + escapeHtml(curVal) + ' (当前配置)</option>');
      }
      sel.innerHTML = opts.join('');
    }

    function populateWriterQuickSelect(models) {
      const wSelect = document.getElementById('wInputModel');
      if (!wSelect || !Array.isArray(models) || models.length === 0) return;
      const curVal = (document.getElementById('currentWriterModelInput')?.value || visualConfig.writerModel || wSelect.value || 'deepseek/deepseek-chat').trim();
      const opts = [];
      let hasCur = false;
      for (const m of models) {
        const id = String(m.id || '').trim();
        if (!id) continue;
        const selected = id === curVal ? ' selected' : '';
        if (selected) hasCur = true;
        const label = (m.name && m.name !== id) ? (m.name + ' (' + id + ')') : id;
        opts.push('<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(label) + '</option>');
      }
      if (curVal && !hasCur) {
        opts.unshift('<option value="' + escapeHtml(curVal) + '" selected>' + escapeHtml(curVal) + ' (当前配置)</option>');
      }
      wSelect.innerHTML = opts.join('');
    }

    function filterModelSelect(key) {
      const cfg = MODEL_SELECT_CONFIGS[key];
      if (!cfg) return;
      const allModels = modelCatalogCache[cfg.catalog] || [];
      const q = (document.getElementById(cfg.searchId)?.value || '').trim().toLowerCase();
      const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
      const filtered = tokens.length === 0
        ? allModels
        : allModels.filter((m) => {
            const hay = (String(m.id || '') + ' ' + String(m.name || '') + ' ' + String(m.description || '')).toLowerCase();
            return tokens.every((t) => hay.includes(t));
          });
      populateModelSelect(cfg.selectId, cfg.inputId, filtered, cfg.placeholder, allModels.length);
    }

    function syncAllModelSelectsFromCache() {
      for (const key of Object.keys(MODEL_SELECT_CONFIGS)) {
        filterModelSelect(key);
      }
      if (modelCatalogCache.text.length > 0) {
        populateWriterQuickSelect(modelCatalogCache.text);
      }
    }

    function updateModelCatalogStatusBadge() {
      const el = document.getElementById('modelCatalogStatusBadge');
      if (!el) return;
      const t = modelCatalogMeta.text;
      const v = modelCatalogMeta.video;
      const i = modelCatalogMeta.image;
      if (!t && !v && !i) {
        el.textContent = '⏳ 正在拉取实时模型列表...';
        el.className = 'text-[10px] font-mono font-normal text-ink-muted';
        return;
      }
      const anyFallback = (t && t.source !== 'live') || (v && v.source !== 'live') || (i && i.source !== 'live');
      const summary = '文本 ' + (t ? t.count : '?') + ' · 视频 ' + (v ? v.count : '?') + ' · 生图 ' + (i ? i.count : '?');
      if (anyFallback) {
        el.textContent = '⚠️ 部分使用本地兜底（' + summary + '）';
        el.className = 'text-[10px] font-mono font-bold text-warn';
      } else {
        const gwLabel = t?.gateway === 'gemini' ? 'Gemini网关' : (t?.gateway === 'custom' ? '自定义网关' : 'OpenRouter');
        el.textContent = '✅ 已在线拉取 (' + gwLabel + '): ' + summary;
        el.className = 'text-[10px] font-mono font-bold text-ok';
      }
    }

    async function loadOpenRouterModels() {
      try {
        const apiKey = (document.getElementById('currentApiKeyInput')?.value || '').trim();
        const baseUrl = (document.getElementById('currentBaseUrlInput')?.value || '').trim();
        const qs = new URLSearchParams();
        if (activeProjectId) qs.set('project', activeProjectId);
        if (apiKey) qs.set('apiKey', apiKey);
        if (baseUrl) qs.set('baseUrl', baseUrl);
        const res = await fetch('/api/openrouter-models?' + qs.toString());
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          modelCatalogCache.text = data.models;
          const preferredAudio = ['google/gemini-2.5-flash', 'google/gemini-2.5-pro', 'openai/gpt-4o-audio-preview'];
          const audioRank = (id) => {
            const idx = preferredAudio.indexOf(id);
            return idx === -1 ? 99 : idx;
          };
          const audioModels = data.models
            .filter((m) => m.supports_audio)
            .slice()
            .sort((a, b) => audioRank(a.id) - audioRank(b.id));
          modelCatalogCache.audio = audioModels.length > 0 ? audioModels : data.models;
          modelCatalogMeta.text = { source: data.source || 'live', gateway: data.gateway || 'openrouter', count: data.models.length, error: data.error || '' };
          const dl = document.getElementById('openrouterModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name || m.id) + '</option>').join('');
          }
          const audioDl = document.getElementById('openrouterAudioModelsList');
          if (audioDl) {
            audioDl.innerHTML = modelCatalogCache.audio.map(m => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name || m.id) + '</option>').join('');
          }
          filterModelSelect('writer');
          filterModelSelect('text');
          filterModelSelect('bgm');
          filterModelSelect('keyword');
          filterModelSelect('translate');
          populateWriterQuickSelect(data.models);
          updateModelCatalogStatusBadge();
        }
      } catch (e) {
        modelCatalogMeta.text = { source: 'fallback', count: modelCatalogCache.text.length, error: e.message };
        updateModelCatalogStatusBadge();
        console.warn('加载在线模型列表跳过:', e);
      }
    }

    async function loadOpenRouterVideoModels() {
      try {
        const apiKey = (document.getElementById('currentApiKeyInput')?.value || '').trim();
        const qs = new URLSearchParams();
        if (activeProjectId) qs.set('project', activeProjectId);
        if (apiKey) qs.set('apiKey', apiKey);
        const res = await fetch('/api/openrouter-video-models?' + qs.toString());
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          modelCatalogCache.video = data.models;
          modelCatalogMeta.video = { source: data.source || 'live', count: data.models.length, error: data.error || '' };
          const dl = document.getElementById('openrouterVideoModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name || m.id) + '</option>').join('');
          }
          filterModelSelect('video');
          updateModelCatalogStatusBadge();
        }
      } catch (e) {
        modelCatalogMeta.video = { source: 'fallback', count: modelCatalogCache.video.length, error: e.message };
        updateModelCatalogStatusBadge();
        console.warn('加载视频模型列表跳过:', e);
      }
    }

    async function loadOpenRouterImageModels() {
      try {
        const apiKey = (document.getElementById('currentApiKeyInput')?.value || '').trim();
        const qs = new URLSearchParams();
        if (activeProjectId) qs.set('project', activeProjectId);
        if (apiKey) qs.set('apiKey', apiKey);
        const res = await fetch('/api/openrouter-image-models?' + qs.toString());
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          modelCatalogCache.image = data.models;
          modelCatalogMeta.image = { source: data.source || 'live', count: data.models.length, error: data.error || '' };
          const dl = document.getElementById('openrouterImageModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name || m.id) + '</option>').join('');
          }
          filterModelSelect('image');
          updateModelCatalogStatusBadge();
        }
      } catch (e) {
        modelCatalogMeta.image = { source: 'fallback', count: modelCatalogCache.image.length, error: e.message };
        updateModelCatalogStatusBadge();
        console.warn('加载生图模型列表跳过:', e);
      }
    }

    async function refreshAllOpenRouterModels(showNotice = false) {
      const btn = document.getElementById('btnRefreshOrModels');
      if (btn) btn.disabled = true;
      try {
        await Promise.all([
          loadOpenRouterModels(),
          loadOpenRouterVideoModels(),
          loadOpenRouterImageModels()
        ]);
        if (showNotice) {
          const t = modelCatalogMeta.text;
          const v = modelCatalogMeta.video;
          const i = modelCatalogMeta.image;
          const anyFallback = (t && t.source !== 'live') || (v && v.source !== 'live') || (i && i.source !== 'live');
          const counts = '文本 ' + (t ? t.count : 0) + ' / 视频 ' + (v ? v.count : 0) + ' / 生图 ' + (i ? i.count : 0);
          showToast(anyFallback
            ? ('⚠️ 部分列表使用了本地兜底（' + counts + '）')
            : ('✅ 已同步实时模型列表：' + counts));
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }


    // 🪐 5 大核心模型预设快捷切换 (文案创作、实体视频、分镜总监、超清生图、自适应BGM)
    function applyModelPreset(type) {
      const bEl = document.getElementById('currentBaseUrlInput');
      const wEl = document.getElementById('currentWriterModelInput');
      const vEl = document.getElementById('currentVideoModelInput');
      const tEl = document.getElementById('currentTextModelInput');
      const iEl = document.getElementById('currentImageModelInput');
      const bgmEl = document.getElementById('currentBgmModelInput');
      const kEl = document.getElementById('currentApiKeyInput');

      if (type === 'gemini') {
        if (bEl) bEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai';
        if (wEl) selectWriterModelSlug('google/gemini-2.5-flash');
        if (vEl) vEl.value = 'veo-2.0-generate-001';
        if (tEl) tEl.value = 'gemini-flash-lite-latest';
        if (iEl) iEl.value = 'imagen-3.0-generate-002';
        if (bgmEl) bgmEl.value = 'gemini-flash-lite-latest';
        showToast('🪐 已载入【Google AI Studio 官方 Gemini 全家桶】预设！');
      } else if (type === 'gemini-pro') {
        if (bEl) bEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai';
        if (wEl) selectWriterModelSlug('google/gemini-2.5-pro');
        if (vEl) vEl.value = 'veo-2.0-generate-001';
        if (tEl) tEl.value = 'gemini-flash-lite-latest';
        if (iEl) iEl.value = 'imagen-3.0-generate-002';
        if (bgmEl) bgmEl.value = 'gemini-flash-lite-latest';
        showToast('💎 已载入【Google Gemini 官方深度通道】预设！');
      } else if (type === 'openrouter-fast') {
        if (bEl) bEl.value = 'https://openrouter.ai/api/v1';
        if (wEl) selectWriterModelSlug('deepseek/deepseek-chat');
        if (vEl) vEl.value = 'minimax/hailuo-3-max';
        if (tEl) tEl.value = 'deepseek/deepseek-chat';
        if (iEl) iEl.value = 'black-forest-labs/flux-3-image';
        if (bgmEl) bgmEl.value = 'google/gemini-2.5-flash';
        showToast('🚀 已载入【OpenRouter 混合高性价比】预设！');
      }
      updateModelHeaderBadges();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

