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
          statusEl.className = 'text-[11px] text-warn';
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
        statusEl.className = 'text-[11px] text-ink-muted';
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
            statusEl.className = 'text-[11px] text-warn';
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
          statusEl.className = 'text-[11px] text-ok';
        }
        if (showNotice) {
          showToast('✅ 已拉取 ' + voices.length + ' 个 ElevenLabs 音色（含你的 ' + customVoices.length + ' 个自定义音色）');
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err.message;
          statusEl.className = 'text-[11px] text-danger';
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
        box.className = 'px-3 py-2 rounded-xl bg-warn-soft border border-warn-line text-xs text-warn';
      } else {
        box.textContent = '📄 当前工程全片旁白：共 ' + scenes.length + ' 镜 · 约 ' + fullText.length + ' 字（点右下角「✅ 确认保存设置」后，在主界面点击「🎙️ 生成音频」即可生成整条成片音频并对齐时间轴）';
        box.className = 'px-3 py-2 rounded-xl bg-ok-soft border border-ok-line text-xs text-ok';
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
        const activeClasses = ['border-danger-line', 'bg-danger-soft', 'text-danger'];
        const inactiveClasses = ['border-line', 'bg-surface', 'text-ink-muted'];
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
            fullBtn.textContent = '🎙️ 生成音频';
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
            title: '生成音频已完成',
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
      showToast('✅ 已确认保存配音设置（当前引擎：' + label + '），点击主界面「🎙️ 生成音频」即可生成');
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
        if (fullBtn) fullBtn.textContent = '🎙️ 生成音频';
        updateVoiceboxStatus();
      }
    }

