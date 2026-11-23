    function restoreElevenlabsParams() {
      const modelEl = document.getElementById('elevenlabsModelSelect');
      const langEl = document.getElementById('elevenlabsLanguageSelect');
      const stabEl = document.getElementById('elevenlabsStabilitySlider');
      const simEl = document.getElementById('elevenlabsSimilaritySlider');

      if (modelEl) {
        const savedModel = localStorage.getItem('whyvideo_elevenlabs_model_id');
        if (savedModel && Array.from(modelEl.options).some((o) => o.value === savedModel)) {
          modelEl.value = savedModel;
        }
      }
      if (langEl) {
        const savedLang = localStorage.getItem('whyvideo_elevenlabs_language');
        if (savedLang !== null && Array.from(langEl.options).some((o) => o.value === savedLang)) {
          langEl.value = savedLang;
        }
      }
      if (stabEl) {
        const savedStab = localStorage.getItem('whyvideo_elevenlabs_stability');
        if (savedStab !== null && !Number.isNaN(Number(savedStab))) {
          stabEl.value = String(Math.max(0, Math.min(1, Number(savedStab))));
        }
      }
      if (simEl) {
        const savedSim = localStorage.getItem('whyvideo_elevenlabs_similarity');
        if (savedSim !== null && !Number.isNaN(Number(savedSim))) {
          simEl.value = String(Math.max(0, Math.min(1, Number(savedSim))));
        }
      }
      syncElevenlabsStabilityStep(false);
    }

    function syncElevenlabsStabilityStep(persist = true) {
      const modelEl = document.getElementById('elevenlabsModelSelect');
      const stabEl = document.getElementById('elevenlabsStabilitySlider');
      if (modelEl && stabEl) {
        if (modelEl.value === 'eleven_v3') {
          stabEl.step = '0.5';
          const v = Number(stabEl.value);
          stabEl.value = v < 0.25 ? '0' : (v < 0.75 ? '0.5' : '1');
        } else {
          stabEl.step = '0.05';
        }
      }
      if (persist) {
        onElevenlabsParamChange();
      } else {
        updateElevenlabsParamLabels();
      }
    }

    function updateElevenlabsParamLabels() {
      const modelEl = document.getElementById('elevenlabsModelSelect');
      const stabEl = document.getElementById('elevenlabsStabilitySlider');
      const simEl = document.getElementById('elevenlabsSimilaritySlider');
      const stabLabel = document.getElementById('elevenlabsStabilityLabel');
      const simLabel = document.getElementById('elevenlabsSimilarityLabel');
      if (stabEl && stabLabel) {
        const v = Number(stabEl.value);
        const pct = Math.round(v * 100) + '%';
        if (modelEl && modelEl.value === 'eleven_v3') {
          const tier = v < 0.25 ? '创意' : (v < 0.75 ? '自然' : '稳健');
          stabLabel.textContent = tier + ' (' + pct + ')';
        } else {
          stabLabel.textContent = pct;
        }
      }
      if (simEl && simLabel) {
        simLabel.textContent = Math.round(Number(simEl.value) * 100) + '%';
      }
    }

    function onElevenlabsParamChange() {
      const modelEl = document.getElementById('elevenlabsModelSelect');
      const langEl = document.getElementById('elevenlabsLanguageSelect');
      const stabEl = document.getElementById('elevenlabsStabilitySlider');
      const simEl = document.getElementById('elevenlabsSimilaritySlider');

      if (modelEl) localStorage.setItem('whyvideo_elevenlabs_model_id', modelEl.value);
      if (langEl) localStorage.setItem('whyvideo_elevenlabs_language', langEl.value);
      if (stabEl) localStorage.setItem('whyvideo_elevenlabs_stability', stabEl.value);
      if (simEl) localStorage.setItem('whyvideo_elevenlabs_similarity', simEl.value);
      updateElevenlabsParamLabels();
    }

    function restoreElevenlabsInputs() {
      const keyInput = document.getElementById('elevenlabsKeyInput');
      if (keyInput) {
        if (!keyInput.value) {
          const savedKey = localStorage.getItem('whyvideo_elevenlabs_api_key') || '';
          if (savedKey) keyInput.value = savedKey;
        }
        if (window._elevenlabsKeyConfigured) {
          keyInput.placeholder = '环境变量 .env 已配置 ELEVENLABS_API_KEY（可留空直接拉取，或在此输入新 Key）';
        }
      }
      restoreElevenlabsParams();
    }

    function onElevenlabsKeyInputChange() {
      const keyInput = document.getElementById('elevenlabsKeyInput');
      if (!keyInput) return;
      const val = keyInput.value.trim();
      if (val) {
        localStorage.setItem('whyvideo_elevenlabs_api_key', val);
      } else {
        localStorage.removeItem('whyvideo_elevenlabs_api_key');
      }
    }

    function onElevenlabsVoiceSelectChange() {
      const select = document.getElementById('voiceIdSelect');
      if (!select) return;
      if (select.value) {
        localStorage.setItem('whyvideo_elevenlabs_voice_id', select.value);
      }
      updateElevenlabsPreviewButton();
    }

    function updateElevenlabsPreviewButton() {
      const previewBtn = document.getElementById('btnPreviewElevenlabsVoice');
      const select = document.getElementById('voiceIdSelect');
      if (!previewBtn || !select) return;
      const list = Array.isArray(window._elevenlabsVoices) ? window._elevenlabsVoices : [];
      const cur = list.find((v) => v.voice_id === select.value);
      previewBtn.disabled = !(cur && cur.preview_url);
    }

    function previewSelectedElevenlabsVoice() {
      const select = document.getElementById('voiceIdSelect');
      const list = Array.isArray(window._elevenlabsVoices) ? window._elevenlabsVoices : [];
      const cur = list.find((v) => v.voice_id === (select ? select.value : ''));
      if (!cur || !cur.preview_url) {
        showToast('⚠️ 当前音色暂未提供试听预览音频');
        return;
      }
      const playerCont = document.getElementById('audioPlayerContainer');
      const player = document.getElementById('audioPreviewPlayer');
      if (player && playerCont) {
        player.src = cur.preview_url;
        playerCont.classList.remove('hidden');
        player.play().catch(() => {});
        showToast('▶ 正在试听音色：' + cur.name);
      }
    }

    async function loadElevenlabsVoices(showNotice = false) {
      const keyInput = document.getElementById('elevenlabsKeyInput');
      const select = document.getElementById('voiceIdSelect');
      const btn = document.getElementById('btnFetchElevenlabsVoices');
      const statusEl = document.getElementById('elevenlabsVoiceStatus');
      if (!select) return;

      const apiKey = (keyInput ? keyInput.value : '').trim();
      if (apiKey) {
        localStorage.setItem('whyvideo_elevenlabs_api_key', apiKey);
      }

      if (!apiKey && !window._elevenlabsKeyConfigured) {
        if (statusEl) {
          statusEl.textContent = '请先输入 API Key';
          statusEl.className = 'text-[11px] text-amber-400';
        }
        if (showNotice) showToast('⚠️ 请先输入 ElevenLabs API Key');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 拉取中...';
      }
      if (statusEl) {
        statusEl.textContent = '正在拉取音色列表...';
        statusEl.className = 'text-[11px] text-gray-400';
      }

      try {
        const res = await fetch('/api/elevenlabs/voices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || '拉取音色失败');
        }

        const voices = Array.isArray(data.voices) ? data.voices : [];
        window._elevenlabsVoices = voices;
        window._elevenlabsVoicesLoadedKey = apiKey || '__env__';

        select.replaceChildren();
        if (!voices.length) {
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = '该账号下暂无可用音色';
          select.appendChild(emptyOpt);
          if (statusEl) {
            statusEl.textContent = '0 个音色';
            statusEl.className = 'text-[11px] text-amber-400';
          }
          updateElevenlabsPreviewButton();
          return;
        }

        const categoryLabels = {
          cloned: '自制克隆',
          professional: '专业克隆',
          generated: 'AI生成',
          premade: '官方预设',
        };
        const formatVoiceOptionText = (v) => {
          const catTag = categoryLabels[v.category] || '我的收藏';
          const parts = [];
          if (v.labels && v.labels.language) parts.push(v.labels.language);
          if (v.labels && v.labels.accent) parts.push(v.labels.accent);
          if (v.labels && v.labels.gender) parts.push(v.labels.gender);
          const extra = parts.length ? ' · ' + parts.join('/') : '';
          return '[' + catTag + '] ' + v.name + extra;
        };

        const customVoices = voices.filter((v) => v.category !== 'premade');
        const premadeVoices = voices.filter((v) => v.category === 'premade');

        if (customVoices.length) {
          const grpCustom = document.createElement('optgroup');
          grpCustom.label = '⭐ 我的自定义 / 已添加音色 (' + customVoices.length + ')';
          for (const v of customVoices) {
            const opt = document.createElement('option');
            opt.value = v.voice_id;
            opt.textContent = formatVoiceOptionText(v);
            grpCustom.appendChild(opt);
          }
          select.appendChild(grpCustom);
        }

        if (premadeVoices.length) {
          const grpPremade = document.createElement('optgroup');
          grpPremade.label = '🎙️ ElevenLabs 官方音色 (' + premadeVoices.length + ')';
          for (const v of premadeVoices) {
            const opt = document.createElement('option');
            opt.value = v.voice_id;
            opt.textContent = formatVoiceOptionText(v);
            grpPremade.appendChild(opt);
          }
          select.appendChild(grpPremade);
        }

        const savedVoiceId = localStorage.getItem('whyvideo_elevenlabs_voice_id') || '';
        const hasSaved = savedVoiceId && voices.some((v) => v.voice_id === savedVoiceId);
        if (hasSaved) {
          select.value = savedVoiceId;
        } else if (customVoices.length) {
          select.value = customVoices[0].voice_id;
        } else {
          select.value = voices[0].voice_id;
        }
        onElevenlabsVoiceSelectChange();

        if (statusEl) {
          statusEl.textContent = '共 ' + voices.length + ' 个（我的 ' + customVoices.length + ' 个）';
          statusEl.className = 'text-[11px] text-emerald-300';
        }
        if (showNotice) {
          showToast('✅ 已拉取 ' + voices.length + ' 个 ElevenLabs 音色（含你的 ' + customVoices.length + ' 个自定义音色）');
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err.message;
          statusEl.className = 'text-[11px] text-rose-400';
        }
        if (showNotice) {
          alert('拉取 ElevenLabs 音色失败: ' + err.message);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔄 拉取我的音色';
        }
      }
    }

    function updateAudioFullScriptSummary() {
      const box = document.getElementById('fullScriptSummaryBox');
      if (!box) return;
      const scenes = manifestData?.scenes || [];
      const fullText = scenes.map((s) => String(s.narration_text || '')).join('').trim();
      if (!scenes.length || !fullText) {
        box.textContent = '⚠️ 当前工程暂无分镜旁白，请先导入文案或创建分镜后再生成全片旁白';
        box.className = 'px-3 py-2 rounded-xl bg-amber-950/35 border border-amber-500/30 text-xs text-amber-200';
      } else {
        box.textContent = '📄 当前工程全片旁白：共 ' + scenes.length + ' 镜 · 约 ' + fullText.length + ' 字（点右下角「✅ 确认保存设置」后，在主界面点击「🎙️ 一键生成全片旁白」即可生成整条成片音频并对齐时间轴）';
        box.className = 'px-3 py-2 rounded-xl bg-emerald-950/35 border border-emerald-500/30 text-xs text-emerald-200';
      }
    }

    function updateAudioProviderHeaderBadge() {
      const badge = document.getElementById('audioProviderHeaderBadge');
      if (!badge) return;
      const savedProvider = localStorage.getItem('whyvideo_audio_provider') || 'voicebox';
      badge.textContent = savedProvider === 'elevenlabs' ? 'ElevenLabs云端' : 'Voicebox本地';
    }

    function restoreSavedAudioConfig() {
      const savedProvider = localStorage.getItem('whyvideo_audio_provider') || 'voicebox';
      const radio = document.querySelector('input[name="audioProvider"][value="' + savedProvider + '"]');
      if (radio) radio.checked = true;
      restoreElevenlabsInputs();
      updateAudioProviderHeaderBadge();
    }

    function onVoiceboxProfileSelectChange() {
      const select = document.getElementById('voiceboxProfileSelect');
      if (select && select.value) {
        localStorage.setItem('whyvideo_voicebox_profile_id', select.value);
      }
    }

    function toggleAudioModal() {
      const modal = document.getElementById('audioModal');
      modal.classList.toggle('hidden');
      if (!modal.classList.contains('hidden')) {
        restoreSavedAudioConfig();
        updateAudioFullScriptSummary();
        updateAudioProviderUI();
        loadVoiceboxProfiles();
        updateVoiceboxStatus();
      }
    }

    function updateAudioProviderUI() {
      const provider = document.querySelector('input[name="audioProvider"]:checked')?.value || 'voicebox';
      const lblEl = document.getElementById('labelAudioProviderElevenlabs');
      const lblVb = document.getElementById('labelAudioProviderVoicebox');
      if (lblEl && lblVb) {
        const activeClasses = ['border-rose-500', 'bg-rose-500/10', 'text-rose-200'];
        const inactiveClasses = ['border-gray-700', 'bg-gray-900', 'text-gray-400'];
        if (provider === 'elevenlabs') {
          lblEl.classList.add(...activeClasses);
          lblEl.classList.remove(...inactiveClasses);
          lblVb.classList.add(...inactiveClasses);
          lblVb.classList.remove(...activeClasses);
        } else {
          lblVb.classList.add(...activeClasses);
          lblVb.classList.remove(...inactiveClasses);
          lblEl.classList.add(...inactiveClasses);
          lblEl.classList.remove(...activeClasses);
        }
      }
      document.getElementById('elevenlabsFields').classList.toggle('hidden', provider !== 'elevenlabs');
      document.getElementById('voiceboxFields').classList.toggle('hidden', provider !== 'voicebox');
      document.getElementById('voiceboxJobStatus').classList.remove('hidden');
      document.getElementById('useAsNarrationLabel').classList.toggle('hidden', provider !== 'voicebox');
      if (provider === 'elevenlabs') {
        restoreElevenlabsInputs();
        const curKey = (document.getElementById('elevenlabsKeyInput')?.value || '').trim() || (window._elevenlabsKeyConfigured ? '__env__' : '');
        if (curKey && window._elevenlabsVoicesLoadedKey !== curKey) {
          loadElevenlabsVoices(false);
        }
      }
    }

    async function loadVoiceboxProfiles() {
      const select = document.getElementById('voiceboxProfileSelect');
      try {
        const response = await fetch('/api/voicebox/profiles');
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '无法读取音色');
        select.replaceChildren();
        for (const profile of data.profiles) {
          const option = document.createElement('option');
          option.value = profile.id;
          option.textContent = profile.name + ' (' + (profile.language || '未知语言') + ')';
          select.appendChild(option);
        }
        const savedProfileId = localStorage.getItem('whyvideo_voicebox_profile_id') || '';
        if (savedProfileId && data.profiles.some((p) => p.id === savedProfileId)) {
          select.value = savedProfileId;
        } else if (select.value) {
          localStorage.setItem('whyvideo_voicebox_profile_id', select.value);
        }
      } catch (error) {
        select.replaceChildren();
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Voicebox 未连接：' + error.message;
        select.appendChild(option);
      }
    }

    async function updateVoiceboxStatus() {
      const projectId = activeProjectId;
      const statusEl = document.getElementById('voiceboxJobStatus');
      const button = document.getElementById('btnSynth');
      const fullBtn = document.getElementById('btnSynthFull');
      const cancelBtn = document.getElementById('btnCancelVoicebox');
      const cancelMainBtn = document.getElementById('btnCancelVoiceboxMain');
      if (!statusEl) return;
      try {
        const response = await fetch('/api/voicebox/status?project=' + encodeURIComponent(projectId));
        const data = await response.json();
        if (projectId !== activeProjectId) return;
        const job = data.job || {};
        window._voiceboxPrevStatus = window._voiceboxPrevStatus || {};
        window._voiceboxNotifiedJobKey = window._voiceboxNotifiedJobKey || {};
        const prevStatus = window._voiceboxPrevStatus[projectId];
        const labels = {
          idle: '当前工程暂无运行中的配音任务',
          queued: job.progressText || '配音任务已加入队列…',
          generating: job.progressText || (job.voiceboxStatus === 'loading_model'
            ? 'Voicebox 正在加载模型 (loading_model)…'
            : job.voiceboxStatus === 'aligning_timing'
              ? '正在对齐配音逐字时间轴 (Whisper)…'
              : (job.voiceboxStatus ? 'Voicebox 正在生成音频 (' + job.voiceboxStatus + ')…' : '正在生成配音音频…')),
          completed: job.progressText || (job.useAsNarration ? '全片旁白与逐字时间轴已完成' : '配音已完成'),
          failed: '配音失败',
          cancelled: '已取消配音任务',
        };
        const isRunning = ['queued', 'generating'].includes(job.status);
        let msg = (labels[job.status] || '') + (job.error && job.status !== 'cancelled' ? '：' + job.error : '');
        if (job.timingWarning && job.status === 'completed') {
          msg += '（时间轴提示：' + job.timingWarning + '）';
        }
        statusEl.textContent = msg;
        if (button) {
          button.disabled = isRunning;
          button.classList.toggle('opacity-50', isRunning);
        }
        if (fullBtn) {
          fullBtn.disabled = isRunning;
          fullBtn.classList.toggle('opacity-50', isRunning);
          if (isRunning) {
            const pLabel = job.provider === 'elevenlabs' ? 'ElevenLabs' : 'Voicebox';
            fullBtn.textContent = job.voiceboxStatus === 'aligning_timing'
              ? '⏳ 正在对齐旁白时间轴...'
              : ('⏳ 正在生成全片旁白 (' + pLabel + ')...');
          } else {
            fullBtn.textContent = '🎙️ 一键生成全片旁白';
          }
        }
        if (cancelBtn) cancelBtn.classList.toggle('hidden', !isRunning);
        if (cancelMainBtn) cancelMainBtn.classList.toggle('hidden', !isRunning);
        if (job.status === 'completed' && job.audioUrl) {
          const player = document.getElementById('audioPreviewPlayer');
          if (player.src !== new URL(job.audioUrl, location.href).href) player.src = job.audioUrl;
          document.getElementById('audioPlayerContainer').classList.remove('hidden');
        }
        window._voiceboxPrevStatus[projectId] = job.status;
        const jobKey = job.completedAt || job.startedAt || job.audioUrl || 'completed';
        if (['queued', 'generating'].includes(prevStatus) && job.status === 'completed' && job.useAsNarration && window._voiceboxNotifiedJobKey[projectId] !== jobKey) {
          window._voiceboxNotifiedJobKey[projectId] = jobKey;
          showToast('🎙️ 全片旁白已生成，逐字时间轴已自动对齐！');
          loadWorkflow();
          showCompletionModal({
            icon: '🎙️',
            title: '一键生成全片旁白已完成',
            message: job.progressText || '全片旁白配音已生成，逐字时间轴已自动对齐！',
            detail: job.timingWarning
              ? ('时间轴提示：' + job.timingWarning)
              : '现可在页面顶部试听全片旁白，或继续点击「⚡ 按关键词/停顿智能排切点」。',
          });
        }
      } catch (error) {
        statusEl.textContent = '无法读取配音任务状态：' + error.message;
      }
    }

    async function cancelVoiceboxJob() {
      try {
        await fetch('/api/voicebox/cancel?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId }),
        });
        await updateVoiceboxStatus();
        showToast('🛑 已取消当前配音任务');
      } catch (error) {
        alert('取消失败: ' + error.message);
      }
    }


    let bgmWorkbenchState = {
      config: null,
      modelInfo: null,
      totalDurationMs: 0,
      scenesCount: 0,
    };

    function formatBgmTime(ms) {
      const totalSec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function formatFileSize(bytes) {
      const b = Number(bytes) || 0;
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function updateBgmHeaderBadge(summary) {
      const badge = document.getElementById('bgmHeaderBadge');
      const btn = document.getElementById('btnOpenBgmModal');
      if (!badge) return;
      if (summary && summary.enabled && summary.trackTitle) {
        badge.textContent = '已挂载';
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40';
        if (btn) btn.title = '已挂载 BGM：' + summary.trackTitle;
      } else if (summary && summary.tracksCount > 0) {
        badge.textContent = '待启用';
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-black/25 text-gray-950';
        if (btn) btn.title = '本地已有 ' + summary.tracksCount + ' 首 BGM，点击配置启用';
      } else {
        badge.textContent = '未启用';
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-black/20 text-gray-950';
        if (btn) btn.title = '配置 AI 自适应 BGM 与自动人声避让 (Ducking)';
      }
    }

    function stopBgmPreviewAudio() {
      const audio = document.getElementById('bgmPreviewAudio');
      if (audio) {
        try { audio.pause(); } catch (e) {}
      }
    }

    function toggleBgmModal() {
      const modal = document.getElementById('bgmModal');
      if (!modal) return;
      const willOpen = modal.classList.contains('hidden');
      if (willOpen) {
        modal.classList.remove('hidden');
        updateBgmModelDisplay();
        loadBgmState();
      } else {
        modal.classList.add('hidden');
        stopBgmPreviewAudio();
      }
    }

    function updateBgmModelDisplay() {
      const d = document.getElementById('bgmModelActiveDisplay');
      if (!d) return;
      const baseUrl = (visualConfig.baseUrl || bgmWorkbenchState.modelInfo?.baseUrl || '').toLowerCase();
      let gw = bgmWorkbenchState.modelInfo?.providerLabel || 'OpenRouter';
      if (baseUrl.includes('googleapis.com')) gw = 'Gemini Official';
      else if (baseUrl.includes('openrouter.ai')) gw = 'OpenRouter';
      else if (baseUrl) {
        try { gw = new URL(baseUrl).hostname; } catch (e) {}
      }
      const modelSlug = visualConfig.bgmModel || bgmWorkbenchState.modelInfo?.bgmModel || 'deepseek/deepseek-chat';
      d.textContent = gw + ' / ' + modelSlug;
    }

    async function loadBgmState() {
      try {
        const res = await fetch('/api/bgm/state?project=' + encodeURIComponent(activeProjectId));
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 读取 BGM 配置失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
      } catch (err) {
        showToast('❌ 读取 BGM 配置异常: ' + err.message);
      }
    }

    function renderBgmModal() {
      const cfg = bgmWorkbenchState.config;
      if (!cfg) return;
      updateBgmModelDisplay();

      const enabledEl = document.getElementById('bgmEnabledToggle');
      if (enabledEl) enabledEl.checked = Boolean(cfg.enabled);

      const statusEl = document.getElementById('bgmAnalyzeStatus');
      if (statusEl) {
        const durSec = (bgmWorkbenchState.totalDurationMs / 1000).toFixed(1);
        const segCount = (cfg.segments || []).length;
        statusEl.textContent = bgmWorkbenchState.scenesCount > 0
          ? ('当前工程共 ' + bgmWorkbenchState.scenesCount + ' 个镜头（总时长 ' + durSec + 's），' + (segCount > 0 ? ('已规划 ' + segCount + ' 个情绪分段') : '尚未运行 AI 情绪分段'))
          : '当前工程尚无镜头清单，请先完成切分镜头后再分析情绪弧度。';
      }

      renderBgmSegments();
      renderBgmTracks();
      renderBgmRecommendations();
      syncBgmSettingsInputs();
      renderBgmAuditPanel();

      const selected = (cfg.tracks || []).find((t) => t.track_id === cfg.selected_track_id);
      updateBgmHeaderBadge({
        enabled: cfg.enabled,
        trackTitle: selected ? selected.title : null,
        tracksCount: (cfg.tracks || []).length,
      });

      const hintEl = document.getElementById('bgmFooterHint');
      if (hintEl) {
        if (cfg.enabled && selected) {
          hintEl.innerHTML = '💡 已选 <strong class="text-amber-300">' + escapeHtml(selected.title) + '</strong>，保存后将写入 <code class="text-amber-300">audio_track.bgm</code>';
        } else if (selected) {
          hintEl.innerHTML = '💡 当前已选音轨但未开启总开关；勾选上方「启用 BGM 音轨」并保存即可挂载';
        } else {
          hintEl.innerHTML = '💡 请先上传或选择一首本地 BGM，再点击「保存并同步至 Remotion」';
        }
      }
    }

    function renderBgmSegments() {
      const box = document.getElementById('bgmSegmentsList');
      if (!box) return;
      const segs = bgmWorkbenchState.config?.segments || [];
      if (segs.length === 0) {
        box.innerHTML = '<div class="col-span-full p-3.5 rounded-xl bg-gray-900/70 border border-dashed border-gray-700 text-gray-400 text-center">暂无情绪曲线。点击右上角「🤖 AI 分析全片情绪弧度」将读取当前工程真实台词生成分段电平方案。</div>';
        return;
      }

      box.innerHTML = segs.map((seg, idx) => {
        const energyColor = seg.energy === 'high'
          ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
          : (seg.energy === 'low'
            ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
            : 'text-blue-300 border-blue-500/30 bg-blue-500/10');
        const energyBadge = seg.energy === 'high' ? '高潮/张力' : (seg.energy === 'low' ? '沉静/铺垫' : '稳健推进');
        return '<div class="p-3 rounded-xl bg-gray-900/90 border border-gray-800 space-y-1.5">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<span class="font-bold text-white truncate">' + escapeHtml(seg.label || ('段落 ' + (idx + 1))) + '</span>' +
            '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ' + energyColor + ' shrink-0">' + escapeHtml(energyBadge) + '</span>' +
          '</div>' +
          '<div class="text-[11px] text-gray-400 font-mono">' + formatBgmTime(seg.start_ms) + ' ~ ' + formatBgmTime(seg.end_ms) + ' · <span class="text-amber-300 font-sans font-semibold">' + escapeHtml(seg.mood || '') + '</span></div>' +
          (seg.music_style_hint ? '<div class="text-[10px] text-purple-300/90">🎼 ' + escapeHtml(seg.music_style_hint) + '</div>' : '') +
          (seg.reason ? '<div class="text-[10px] text-gray-400 line-clamp-2">' + escapeHtml(seg.reason) + '</div>' : '') +
          '<div class="flex items-center justify-between gap-2 pt-1 border-t border-gray-800/80">' +
            '<span class="text-[10px] text-gray-400">目标电平</span>' +
            '<div class="flex items-center gap-2 flex-1 max-w-[180px]">' +
              '<input type="range" min="-28" max="-6" step="1" value="' + Number(seg.target_db ?? -16) + '" oninput="onBgmSegmentDbChange(' + idx + ', this.value)" class="flex-1 accent-amber-400 cursor-pointer" />' +
              '<span id="bgmSegDbVal_' + idx + '" class="font-mono text-[11px] font-bold text-amber-300 w-12 text-right">' + Number(seg.target_db ?? -16) + ' dB</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderBgmTracks() {
      const box = document.getElementById('bgmTracksList');
      if (!box) return;
      const tracks = bgmWorkbenchState.config?.tracks || [];
      const selectedId = bgmWorkbenchState.config?.selected_track_id;
      if (tracks.length === 0) {
        box.innerHTML = '<div class="p-4 rounded-xl bg-gray-900/50 border border-dashed border-gray-700 text-xs text-gray-400 text-center">当前工程暂无 BGM 音轨。请点击右上角「📤 上传本地 BGM」导入授权音乐。</div>';
        return;
      }

      box.innerHTML = tracks.map((tr) => {
        const isSelected = tr.track_id === selectedId;
        const cardCls = isSelected
          ? 'bg-amber-500/10 border-amber-400 shadow'
          : 'bg-gray-900/60 border-gray-800 hover:border-gray-700';
        const durLabel = tr.duration_ms ? formatBgmTime(tr.duration_ms) : '未知时长';
        const safeId = escapeHtml(tr.track_id);
        return '<div data-track-id="' + safeId + '" onclick="selectBgmTrack(this.dataset.trackId)" class="flex items-center justify-between gap-3 p-3 rounded-xl border transition cursor-pointer ' + cardCls + '">' +
          '<div class="flex items-center gap-2.5 min-w-0">' +
            '<input type="radio" name="bgmTrackRadio" data-track-id="' + safeId + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); selectBgmTrack(this.dataset.trackId)" class="accent-amber-400 w-4 h-4 shrink-0 cursor-pointer" />' +
            '<div class="min-w-0">' +
              '<div class="text-xs font-bold text-white truncate flex items-center gap-2">' +
                '<span>' + escapeHtml(tr.title || tr.file_name) + '</span>' +
                (isSelected ? '<span class="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">当前选中</span>' : '') +
              '</div>' +
              '<div class="text-[10px] text-gray-400 font-mono mt-0.5 truncate">' + escapeHtml(tr.file_name) + ' · ' + durLabel + ' · ' + formatFileSize(tr.size_bytes) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 shrink-0">' +
            '<button type="button" data-track-id="' + safeId + '" onclick="event.stopPropagation(); previewBgmTrack(this.dataset.trackId)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-amber-300 border border-gray-700 transition cursor-pointer">▶ 试听</button>' +
            '<button type="button" data-track-id="' + safeId + '" onclick="event.stopPropagation(); deleteBgmTrack(this.dataset.trackId)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-rose-900/60 text-rose-300 border border-gray-700 hover:border-rose-500/50 transition cursor-pointer" title="从当前工程删除该 BGM">🗑</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderBgmRecommendations() {
      const wrap = document.getElementById('bgmRecommendationsBox');
      const list = document.getElementById('bgmRecommendationsList');
      if (!wrap || !list) return;
      const recs = bgmWorkbenchState.config?.style_recommendations || [];
      if (recs.length === 0) {
        wrap.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      wrap.classList.remove('hidden');
      list.innerHTML = recs.map((r) =>
        '<div class="p-2.5 rounded-xl bg-gray-900/70 border border-purple-500/25 space-y-0.5">' +
          '<div class="text-[11px] font-bold text-purple-200">' + escapeHtml(r.title) + ' <span class="text-[10px] font-mono text-amber-300">(' + escapeHtml(r.bpm_range || '') + ')</span></div>' +
          (r.instrumentation ? '<div class="text-[10px] text-gray-300">乐器：' + escapeHtml(r.instrumentation) + '</div>' : '') +
          (r.fit_reason ? '<div class="text-[10px] text-gray-400">' + escapeHtml(r.fit_reason) + '</div>' : '') +
        '</div>'
      ).join('');
    }

    function syncBgmSettingsInputs() {
      const s = bgmWorkbenchState.config?.settings;
      if (!s) return;
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(v); };
      const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };
      setVal('bgmBaseVolSlider', s.base_volume_db ?? -16);
      setChk('bgmDuckingToggle', s.ducking_enabled !== false);
      setVal('bgmDuckingDbSlider', s.ducking_db ?? -8);
      setVal('bgmFadeInSlider', s.fade_in_ms ?? 1200);
      setVal('bgmFadeOutSlider', s.fade_out_ms ?? 2000);
      setChk('bgmLoopToggle', s.loop !== false);
      setVal('bgmAttackMsInput', s.attack_ms ?? 180);
      setVal('bgmReleaseMsInput', s.release_ms ?? 420);
      updateBgmSettingLabels();
    }

    function updateBgmSettingLabels() {
      const s = bgmWorkbenchState.config?.settings;
      if (!s) return;
      const bEl = document.getElementById('bgmBaseVolVal');
      const dEl = document.getElementById('bgmDuckingDbVal');
      const fiEl = document.getElementById('bgmFadeInVal');
      const foEl = document.getElementById('bgmFadeOutVal');
      if (bEl) bEl.textContent = s.base_volume_db + ' dB';
      if (dEl) dEl.textContent = s.ducking_enabled ? (s.ducking_db + ' dB') : '已关闭';
      if (fiEl) fiEl.textContent = (s.fade_in_ms / 1000).toFixed(1) + 's';
      if (foEl) foEl.textContent = (s.fade_out_ms / 1000).toFixed(1) + 's';
    }

    function computeLocalBgmAuditPreview() {
      const cfg = bgmWorkbenchState.config;
      if (!cfg) return null;
      const s = cfg.settings || {};
      const tracks = cfg.tracks || [];
      const selected = tracks.find((t) => t.track_id === cfg.selected_track_id) || null;
      const segs = cfg.segments || [];
      const totalMs = bgmWorkbenchState.totalDurationMs || 0;
      const warnings = [];
      let score = 100;

      if (!cfg.enabled) { warnings.push('当前尚未启用 BGM 音轨（Remotion 仅输出纯旁白）。'); score -= 25; }
      if (!selected) { warnings.push('尚未选择或上传本地授权 BGM 音频文件。'); score -= 35; }
      else if (totalMs > 0 && selected.duration_ms && selected.duration_ms < totalMs && !s.loop) {
        warnings.push('所选 BGM 短于成片时长且未开启循环播放，后半段将静音。'); score -= 20;
      }
      if (s.base_volume_db > -12) { warnings.push('基准电平 ' + s.base_volume_db + ' dB 偏高，建议控制在 -24 ~ -12 dB。'); score -= 15; }
      else if (s.base_volume_db < -26) { warnings.push('基准电平 ' + s.base_volume_db + ' dB 偏低，背景音乐存在感较弱。'); score -= 8; }
      if (!s.ducking_enabled) { warnings.push('已关闭自动人声避让 (Ducking)，旁白密集段落可能与配乐冲突。'); score -= 20; }
      else if (s.ducking_db > -4) { warnings.push('人声避让衰减幅度（' + s.ducking_db + ' dB）较浅，建议设为 -6 ~ -12 dB。'); score -= 10; }
      if (s.fade_in_ms === 0 || s.fade_out_ms === 0) { warnings.push('建议保留片头淡入与片尾淡出（>0 ms）。'); score -= 5; }
      if (segs.length === 0) { warnings.push('尚未生成情绪起伏分段，全片将使用固定基准电平。'); score -= 10; }

      score = Math.max(0, Math.min(100, score));
      const grade = (!selected || !cfg.enabled) ? '待配置' : (score >= 92 ? 'A+' : score >= 82 ? 'A' : score >= 70 ? 'B' : 'C');
      return {
        grade,
        summary: !selected
          ? '请先上传或选择本地合法 BGM 音频。'
          : (!cfg.enabled
            ? ('已选中《' + selected.title + '》，勾选「启用 BGM 音轨」并保存后挂载。')
            : (warnings.length === 0 ? ('《' + selected.title + '》配置通过混音审查，可同步至 Remotion。') : ('《' + selected.title + '》已就绪，共有 ' + warnings.length + ' 条建议优化项。'))),
        ducking_note: s.ducking_enabled ? ('开启（旁白时自动下潜 ' + s.ducking_db + ' dB，起音 ' + s.attack_ms + 'ms / 释放 ' + s.release_ms + 'ms）') : '已关闭（建议开启以保护人声）',
        pacing_note: segs.length > 0 ? ('已规划 ' + segs.length + ' 段情绪曲线并平滑过渡') : '全局固定基准电平（可点击 AI 分析）',
        fatigue_note: (s.base_volume_db <= -14 && s.fade_in_ms >= 500 && s.fade_out_ms >= 800)
          ? ('优良（基准 ' + s.base_volume_db + ' dB，淡入 ' + (s.fade_in_ms / 1000).toFixed(1) + 's / 淡出 ' + (s.fade_out_ms / 1000).toFixed(1) + 's）')
          : ('需微调（基准 ' + s.base_volume_db + ' dB，淡入 ' + s.fade_in_ms + 'ms / 淡出 ' + s.fade_out_ms + 'ms）'),
        warnings,
      };
    }

    function renderBgmAuditPanel() {
      const audit = computeLocalBgmAuditPreview() || bgmWorkbenchState.config?.audit;
      if (!audit) return;
      const badge = document.getElementById('bgmAuditGradeBadge');
      if (badge) {
        badge.textContent = '混音审查评级: ' + audit.grade;
        badge.className = audit.grade === 'A+' || audit.grade === 'A'
          ? 'px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
          : (audit.grade === '待配置'
            ? 'px-2 py-0.5 rounded text-[10px] font-black bg-gray-800 text-gray-300 border border-gray-700'
            : 'px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40');
      }
      const sumEl = document.getElementById('bgmAuditSummary');
      const dEl = document.getElementById('bgmAuditDucking');
      const pEl = document.getElementById('bgmAuditPacing');
      const fEl = document.getElementById('bgmAuditFatigue');
      const wEl = document.getElementById('bgmAuditWarnings');
      if (sumEl) sumEl.textContent = audit.summary || '';
      if (dEl) dEl.textContent = audit.ducking_note || '-';
      if (pEl) pEl.textContent = audit.pacing_note || '-';
      if (fEl) fEl.textContent = audit.fatigue_note || '-';
      if (wEl) {
        if (audit.warnings && audit.warnings.length > 0) {
          wEl.classList.remove('hidden');
          wEl.innerHTML = audit.warnings.map((w) => '<li>' + escapeHtml(w) + '</li>').join('');
        } else {
          wEl.classList.add('hidden');
          wEl.innerHTML = '';
        }
      }
    }

    function selectBgmTrack(trackId) {
      if (!bgmWorkbenchState.config) return;
      bgmWorkbenchState.config.selected_track_id = trackId;
      if (!bgmWorkbenchState.config.enabled) {
        bgmWorkbenchState.config.enabled = true;
      }
      renderBgmModal();
    }

    function previewBgmTrack(trackId) {
      const tracks = bgmWorkbenchState.config?.tracks || [];
      const tr = tracks.find((t) => t.track_id === trackId);
      if (!tr || !tr.url) {
        showToast('⚠️ 找不到该音轨的可试听路径');
        return;
      }
      const wrap = document.getElementById('bgmAudioPlayerWrap');
      const label = document.getElementById('bgmNowPlayingLabel');
      const audio = document.getElementById('bgmPreviewAudio');
      if (!audio || !wrap) return;
      wrap.classList.remove('hidden');
      if (label) label.textContent = '🎵 正在试听：' + (tr.title || tr.file_name);
      const targetUrl = new URL(tr.url, window.location.href).href;
      if (audio.src !== targetUrl) {
        audio.src = tr.url;
      }
      audio.currentTime = 0;
      audio.play().catch((e) => showToast('⚠️ 浏览器阻止自动播放，请点击播放器播放键: ' + e.message));
    }

    function onBgmSegmentDbChange(idx, val) {
      const segs = bgmWorkbenchState.config?.segments;
      if (!segs || !segs[idx]) return;
      const num = Number(val);
      segs[idx].target_db = num;
      const lbl = document.getElementById('bgmSegDbVal_' + idx);
      if (lbl) lbl.textContent = num + ' dB';
      renderBgmAuditPanel();
    }

    function onBgmSettingsInput() {
      const cfg = bgmWorkbenchState.config;
      if (!cfg) return;
      cfg.enabled = Boolean(document.getElementById('bgmEnabledToggle')?.checked);
      cfg.settings = {
        base_volume_db: Number(document.getElementById('bgmBaseVolSlider')?.value ?? -16),
        ducking_enabled: Boolean(document.getElementById('bgmDuckingToggle')?.checked),
        ducking_db: Number(document.getElementById('bgmDuckingDbSlider')?.value ?? -8),
        fade_in_ms: Number(document.getElementById('bgmFadeInSlider')?.value ?? 1200),
        fade_out_ms: Number(document.getElementById('bgmFadeOutSlider')?.value ?? 2000),
        loop: Boolean(document.getElementById('bgmLoopToggle')?.checked),
        attack_ms: Number(document.getElementById('bgmAttackMsInput')?.value ?? 180),
        release_ms: Number(document.getElementById('bgmReleaseMsInput')?.value ?? 420),
      };
      updateBgmSettingLabels();
      renderBgmAuditPanel();
    }

    async function handleBgmFileUpload(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const btn = document.getElementById('btnUploadBgm');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 上传解析中...';
      }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('读取本地文件失败'));
          reader.readAsDataURL(file);
        });
        const res = await fetch('/api/bgm/upload?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            fileName: file.name,
            dataUrl,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 上传失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
        showToast('✅ 已上传并选中 BGM：' + file.name);
      } catch (err) {
        showToast('❌ 上传异常: ' + err.message);
      } finally {
        input.value = '';
        if (btn) {
          btn.disabled = false;
          btn.textContent = '📤 上传本地 BGM';
        }
      }
    }

    async function deleteBgmTrack(trackId) {
      if (!window.confirm('确定从当前工程删除这首 BGM 音频文件吗？')) return;
      try {
        stopBgmPreviewAudio();
        const res = await fetch('/api/bgm/delete-track?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId, trackId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 删除失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
        showToast('🗑 已删除 BGM 音轨');
      } catch (err) {
        showToast('❌ 删除异常: ' + err.message);
      }
    }

    async function analyzeBgmWithAi() {
      const btn = document.getElementById('btnAnalyzeBgm');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在分析台词情绪...';
      }
      try {
        const res = await fetch('/api/bgm/analyze?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            bgmModel: visualConfig.bgmModel,
            baseUrl: visualConfig.baseUrl,
            apiKey: visualConfig.apiKey,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 情绪分析失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
        if (data.usedFallback) {
          showToast('⚠️ 未连上外部 LLM，已使用本地章节节奏生成情绪分段');
        } else {
          showToast('✅ 已调用 ' + (data.modelInfo?.bgmModel || 'AI') + ' 生成全片情绪曲线！');
        }
      } catch (err) {
        showToast('❌ 情绪分析异常: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🤖 AI 分析全片情绪弧度';
        }
      }
    }

    async function applyBgmToProject() {
      const cfg = bgmWorkbenchState.config;
      if (!cfg) return;
      if (cfg.enabled && !cfg.selected_track_id) {
        showToast('⚠️ 请先上传或选择一首本地 BGM 音轨');
        return;
      }
      const btn = document.getElementById('btnSaveBgm');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在同步 Remotion...';
      }
      try {
        const res = await fetch('/api/bgm/save?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            enabled: cfg.enabled,
            selected_track_id: cfg.selected_track_id,
            settings: cfg.settings,
            segments: cfg.segments,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 保存失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
        toggleBgmModal();
        if (data.config.enabled) {
          showToast(data.compiledToRenderProps
            ? '✅ 自适应 BGM 已保存并同步写入 render-props.json！'
            : '✅ BGM 配置已保存（当前工程尚缺完整渲染物料，暂未生成 render-props.json）');
        } else {
          showToast('✅ 已关闭并保存 BGM 配置');
        }
      } catch (err) {
        showToast('❌ 保存异常: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '💾 保存并同步至 Remotion';
        }
      }
    }


    window._producerHasVideo = false;
    window._producerRenderJobStatus = 'idle';
    window._producerRenderOutputUrl = '';

    function toggleGlobalPromptDrawer() {
      const drawer = document.getElementById('globalPromptDrawer');
      const chevron = document.getElementById('globalPromptChevron');
      if (!drawer) return;
      const isHidden = drawer.classList.toggle('hidden');
      if (chevron) chevron.textContent = isHidden ? '▸' : '▾';
    }

    function toggleVideoPreviewDrawer() {
      const c = document.getElementById('videoContainer');
      const btn = document.getElementById('toggleVideoPreviewBtn');
      if (!c) return;
      const isHidden = c.classList.toggle('hidden');
      if (btn) btn.textContent = isHidden ? '▶ 预览成片' : '▾ 收起预览';
    }

    function syncRenderBannerVisibility() {
      const banner = document.getElementById('renderStatusBanner');
      const statusEl = document.getElementById('renderJobStatus');
      const previewBtn = document.getElementById('toggleVideoPreviewBtn');
      const videoEl = document.getElementById('videoContainer');
      if (!banner) return;

      const activeJob = ['preparing', 'rendering', 'completed', 'failed'].includes(window._producerRenderJobStatus);
      const shouldShow = activeJob || Boolean(window._producerRenderOutputUrl) || Boolean(window._producerHasVideo);
      banner.classList.toggle('hidden', !shouldShow);

      if (previewBtn) {
        previewBtn.classList.toggle('hidden', !window._producerHasVideo);
        if (!window._producerHasVideo && videoEl) {
          videoEl.classList.add('hidden');
          previewBtn.textContent = '▶ 预览成片';
        }
      }
      if (statusEl && !activeJob && window._producerHasVideo) {
        statusEl.textContent = '✅ 1080p 成片已就绪';
      }
    }

    async function updateRenderStatus() {
      const projectId = activeProjectId;
      const statusEl = document.getElementById('renderJobStatus');
      const outputEl = document.getElementById('renderJobOutput');
      const errorEl = document.getElementById('renderJobError');
      const buttonEl = document.getElementById('startFinalRenderBtn');
      if (!statusEl) return;
      try {
        const response = await fetch('/api/render-status?project=' + encodeURIComponent(projectId));
        const data = await response.json();
        if (activeProjectId !== projectId) return;
        const job = data.job || {};
        const status = job.status || 'idle';
        window._renderPrevStatus = window._renderPrevStatus || {};
        window._renderNotifiedJobKey = window._renderNotifiedJobKey || {};
        const prevStatus = window._renderPrevStatus[projectId];
        window._producerRenderJobStatus = status;
        window._producerRenderOutputUrl = job.outputUrl || '';

        const labels = {
          idle: window._producerHasVideo ? '✅ 1080p 成片已就绪' : '',
          preparing: '⏳ 正在准备工程素材…',
          rendering: '🎬 正在后台渲染（切换工程或刷新不会中断）',
          completed: '✅ 最终渲染完成',
          failed: '❌ 渲染失败',
        };
        statusEl.textContent = labels[status] ?? '渲染状态未知';
        const isBusy = ['preparing', 'rendering'].includes(status);
        if (buttonEl) {
          buttonEl.disabled = isBusy;
          buttonEl.classList.toggle('opacity-60', isBusy);
          buttonEl.textContent = status === 'preparing' ? '⏳ 准备中…' : (status === 'rendering' ? '⏳ 渲染中…' : '🎬 最终渲染');
        }
        outputEl.classList.toggle('hidden', !job.outputUrl);
        if (job.outputUrl) outputEl.href = job.outputUrl;
        errorEl.classList.toggle('hidden', status !== 'failed');
        errorEl.textContent = status === 'failed' ? ((job.error || '') + '\n' + (job.log || '')).slice(-2000) : '';
        syncRenderBannerVisibility();
        window._renderPrevStatus[projectId] = status;
        const jobKey = job.completedAt || job.startedAt || job.outputUrl || 'completed';
        if (['preparing', 'rendering'].includes(prevStatus) && status === 'completed' && window._renderNotifiedJobKey[projectId] !== jobKey) {
          window._renderNotifiedJobKey[projectId] = jobKey;
          showCompletionModal({
            icon: '🎬',
            title: '最终视频渲染已完成',
            message: '1080p 成片已渲染完成！',
            detail: '可点击顶部「▶ 预览成片」或「↗ 新窗口打开成片」查看。',
          });
        }
      } catch (error) {
        window._producerRenderJobStatus = 'failed';
        statusEl.textContent = '无法读取渲染状态：' + error.message;
        syncRenderBannerVisibility();
      }
    }

    function openFinalRenderConfirmModal() {
      const modal = document.getElementById('finalRenderConfirmModal');
      if (!modal) return startFinalRender();
      const projEl = document.getElementById('finalRenderProjectName');
      const sumEl = document.getElementById('finalRenderSceneSummary');
      const scenes = manifestData?.scenes || [];
      const totalSec = manifestData?.total_duration_sec || 0;
      const totalMin = totalSec > 0 ? (totalSec / 60).toFixed(1) : '0.0';
      if (projEl) projEl.textContent = activeProjectId || '-';
      if (sumEl) sumEl.textContent = `${scenes.length} 镜 · 全片约 ${totalMin} 分钟`;
      modal.classList.remove('hidden');
    }

    function closeFinalRenderConfirmModal() {
      const modal = document.getElementById('finalRenderConfirmModal');
      if (modal) modal.classList.add('hidden');
    }

    async function confirmStartFinalRender() {
      closeFinalRenderConfirmModal();
      await startFinalRender();
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFinalRenderConfirmModal();
    });

    async function startFinalRender() {
      const projectId = activeProjectId;
      const buttonEl = document.getElementById('startFinalRenderBtn');
      buttonEl.disabled = true;
      try {
        const response = await fetch('/api/render-project?project=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '无法启动渲染');
        window._renderPrevStatus = window._renderPrevStatus || {};
        window._renderPrevStatus[projectId] = 'preparing';
        showToast('已启动工程 ' + projectId + ' 的后台渲染');
      } catch (error) {
        alert(error.message);
      } finally {
        await updateRenderStatus();
      }
    }


    function collectVoiceParamsFromModal() {
      const provider = document.querySelector('input[name="audioProvider"]:checked')?.value || localStorage.getItem('whyvideo_audio_provider') || 'voicebox';
      const apiKey = (document.getElementById('elevenlabsKeyInput')?.value || '').trim() || localStorage.getItem('whyvideo_elevenlabs_api_key') || '';
      const voiceId = (document.getElementById('voiceIdSelect')?.value || '').trim() || localStorage.getItem('whyvideo_elevenlabs_voice_id') || '';
      const modelId = document.getElementById('elevenlabsModelSelect')?.value || localStorage.getItem('whyvideo_elevenlabs_model_id') || 'eleven_v4';
      const languageCode = document.getElementById('elevenlabsLanguageSelect')?.value ?? localStorage.getItem('whyvideo_elevenlabs_language') ?? 'zh';
      const stability = Number(document.getElementById('elevenlabsStabilitySlider')?.value ?? localStorage.getItem('whyvideo_elevenlabs_stability') ?? 0.35);
      const similarityBoost = Number(document.getElementById('elevenlabsSimilaritySlider')?.value ?? localStorage.getItem('whyvideo_elevenlabs_similarity') ?? 0.8);
      const profileId = (document.getElementById('voiceboxProfileSelect')?.value || '').trim() || localStorage.getItem('whyvideo_voicebox_profile_id') || '';
      const text = document.getElementById('sampleAudioText')?.value || '';
      const useAsNarration = Boolean(document.getElementById('useAsNarrationCheckbox')?.checked);

      if (provider === 'elevenlabs') {
        if (apiKey) localStorage.setItem('whyvideo_elevenlabs_api_key', apiKey);
        if (!voiceId) {
          alert('当前配音引擎为 ElevenLabs 云端，请先在「🎙️ 配音引擎配置」中点击「🔄 拉取我的音色」并选择音色后保存设置');
          const modal = document.getElementById('audioModal');
          if (modal && modal.classList.contains('hidden')) toggleAudioModal();
          return null;
        }
        localStorage.setItem('whyvideo_elevenlabs_voice_id', voiceId);
        onElevenlabsParamChange();
      } else {
        if (profileId) localStorage.setItem('whyvideo_voicebox_profile_id', profileId);
      }
      return {
        projectId: activeProjectId,
        provider,
        voiceId,
        modelId,
        stability,
        similarityBoost,
        languageCode,
        profileId,
        apiKey,
        text,
        useAsNarration,
      };
    }

    function confirmSaveAudioConfig() {
      const provider = document.querySelector('input[name="audioProvider"]:checked')?.value || 'voicebox';
      const payload = collectVoiceParamsFromModal();
      if (!payload) return;
      localStorage.setItem('whyvideo_audio_provider', provider);
      updateAudioProviderHeaderBadge();
      const modal = document.getElementById('audioModal');
      if (modal) modal.classList.add('hidden');
      const label = provider === 'elevenlabs' ? 'ElevenLabs 云端配音' : 'Voicebox 本地配音';
      showToast('✅ 已确认保存配音设置（当前引擎：' + label + '），点击主界面「🎙️ 一键生成全片旁白」即可生成');
    }

    async function synthesizeTestVoice() {
      const payload = collectVoiceParamsFromModal();
      if (!payload) return;
      const btn = document.getElementById('btnSynth');
      const fullBtn = document.getElementById('btnSynthFull');

      btn.disabled = true;
      if (fullBtn) fullBtn.disabled = true;
      btn.textContent = '⏳ 正在合成中...';

      try {
        const res = await fetch('/api/synthesize-voice?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (payload.provider === 'voicebox' && data.ok && data.job) {
          await updateVoiceboxStatus();
          showToast('已提交至本地 Voicebox，当前工程可在后台继续生成');
        } else if (data.ok && data.audioUrl) {
          const playerCont = document.getElementById('audioPlayerContainer');
          const player = document.getElementById('audioPreviewPlayer');
          player.src = data.audioUrl;
          playerCont.classList.remove('hidden');
          player.play();
          showToast('🎉 测试配音合成成功！已自动播放');
        } else {
          alert(data.error || '合成配音失败');
        }
      } catch (err) {
        alert('配音请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        if (fullBtn) fullBtn.disabled = false;
        btn.textContent = '🔊 试听测试配音';
        updateVoiceboxStatus();
      }
    }

    async function synthesizeFullNarration() {
      const scenes = manifestData?.scenes || [];
      const fullText = scenes.map((s) => String(s.narration_text || '')).join('').trim();
      if (!scenes.length || !fullText) {
        alert('当前工程没有分镜旁白文案，请先导入文案或创建分镜');
        return;
      }
      restoreSavedAudioConfig();
      const payload = collectVoiceParamsFromModal();
      if (!payload) return;

      const btn = document.getElementById('btnSynth');
      const fullBtn = document.getElementById('btnSynthFull');
      if (fullBtn) fullBtn.disabled = true;
      if (btn) btn.disabled = true;
      if (fullBtn) fullBtn.textContent = '⏳ 正在提交全片配音...';

      try {
        const res = await fetch('/api/synthesize-voice?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            text: fullText,
            fullScript: true,
            useAsNarration: true,
          }),
        });
        const data = await res.json();
        if (data.ok && data.job) {
          window._voiceboxPrevStatus = window._voiceboxPrevStatus || {};
          window._voiceboxPrevStatus[activeProjectId] = 'queued';
          await updateVoiceboxStatus();
          const pName = payload.provider === 'elevenlabs' ? 'ElevenLabs 云端' : 'Voicebox 本地';
          showToast('🎙️ 已开始使用【' + pName + '】在后台生成全片旁白（共 ' + scenes.length + ' 镜），完成后会自动对齐时间轴');
        } else {
          alert(data.error || '提交全片配音失败');
        }
      } catch (err) {
        alert('提交全片配音失败: ' + err.message);
      } finally {
        if (fullBtn) fullBtn.disabled = false;
        if (btn) btn.disabled = false;
        if (fullBtn) fullBtn.textContent = '🎙️ 一键生成全片旁白';
        updateVoiceboxStatus();
      }
    }

