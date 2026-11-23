    async function loadWorkflow() {
      try {
        bindModelPrefAutoSave();
        restoreModelPrefsFromLocal();
        loadOpenRouterModels();
        loadOpenRouterVideoModels();
        loadOpenRouterImageModels();
        const res = await fetch('/api/workflow-data?project=' + activeProjectId);
        if (!res.ok) {
          manifestData = null;
          assetIndexData = null;
          updateCounters();
          renderTimingSummaryBadge(null);
          renderEmptyProducerState('当前工程尚未生成视觉分镜清单（请先在「✍️ 文案创作台」完成或导入文案后点击「🚀 文案定稿 · 一键流转至制作台」）');
          showToast('⚠️ 当前工程尚未生成分镜清单，请先在文案创作台流转');
          return;
        }
        const data = await res.json();
        manifestData = data.manifest;
        assetIndexData = data.assetIndex;
        document.getElementById('globalPromptInput').value =
          data.promptConfig?.global_ai_visual_prompt || '';

        if (data.promptConfig) {
          const cfg = data.promptConfig;
          let rawVideoModel = cfg.videoModel || 'minimax/hailuo-3-max';
          if (rawVideoModel === 'minimax/video-01' || rawVideoModel === 'minimax/hailuo' || rawVideoModel === 'video-01') {
            rawVideoModel = 'minimax/hailuo-3-max';
          }
          let rawImageModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
          if (rawImageModel === 'black-forest-labs/flux-1-schnell' || rawImageModel.includes('flux-1')) {
            rawImageModel = 'black-forest-labs/flux-3-image';
          }

          visualConfig = {
            apiKey: cfg.apiKey || '',
            baseUrl: cfg.baseUrl || 'https://openrouter.ai/api/v1',
            writerModel: cfg.writerModel || 'deepseek/deepseek-chat',
            videoModel: rawVideoModel,
            textModel: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
            imageModel: rawImageModel,
            bgmModel: cfg.bgmModel || 'deepseek/deepseek-chat',
            keywordModel: cfg.keywordModel || cfg.textModel || cfg.model || 'deepseek/deepseek-chat'
          };

          const kEl = document.getElementById('currentApiKeyInput');
          const tavilyEl = document.getElementById('currentTavilyKeyInput');
          const meowloadEl = document.getElementById('currentMeowloadKeyInput');
          const bEl = document.getElementById('currentBaseUrlInput');
          const wEl = document.getElementById('currentWriterModelInput');
          const vEl = document.getElementById('currentVideoModelInput');
          const tEl = document.getElementById('currentTextModelInput');
          const iEl = document.getElementById('currentImageModelInput');
          const bgmEl = document.getElementById('currentBgmModelInput');
          const kwEl = document.getElementById('currentKeywordModelInput');

          if (kEl && visualConfig.apiKey) kEl.value = visualConfig.apiKey;
          if (tavilyEl) {
            tavilyEl.value = cfg.tavilyKeyConfigured ? '••••••••••••••••••••' : '';
            tavilyEl.placeholder = cfg.tavilyKeyConfigured ? 'Tavily Key 已配置；留空或保留掩码即不修改' : '填写 Tavily Key；留空则使用环境变量';
          }
          if (meowloadEl) meowloadEl.placeholder = cfg.meowloadKeyConfigured ? '哼哼猫 Key 已配置；留空则保留' : '填写哼哼猫 API Key；留空则保留已存 Key';
          if (bEl && visualConfig.baseUrl) bEl.value = visualConfig.baseUrl;
          if (wEl && visualConfig.writerModel) wEl.value = visualConfig.writerModel;
          if (vEl && visualConfig.videoModel) vEl.value = visualConfig.videoModel;
          if (tEl && visualConfig.textModel) tEl.value = visualConfig.textModel;
          if (iEl && visualConfig.imageModel) iEl.value = visualConfig.imageModel;
          if (bgmEl && visualConfig.bgmModel) bgmEl.value = visualConfig.bgmModel;
          if (kwEl && visualConfig.keywordModel) kwEl.value = visualConfig.keywordModel;

          if (visualConfig.writerModel) {
            selectWriterModelSlug(visualConfig.writerModel);
          }

          restoreModelPrefsFromLocal();
          updateModelBadge();
          syncAllModelSelectsFromCache();
        }

        window._elevenlabsKeyConfigured = Boolean(data.elevenlabsKeyConfigured);
        window.timingSummaryData = data.timingSummary || null;
        renderTimingSummaryBadge(window.timingSummaryData);
        updateBgmHeaderBadge(data.bgmSummary || null);
        renderVideoContainer(data);
        renderTable();
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    }

    function renderVideoContainer(data) {
      const c = document.getElementById('videoContainer');
      const outputEl = document.getElementById('renderJobOutput');
      if (data.hasVideo && data.videoUrl) {
        window._producerHasVideo = true;
        if (c) {
          c.innerHTML = `
            <div class="w-full max-w-xl rounded-xl overflow-hidden border border-gray-700 bg-black aspect-video flex items-center justify-center">
              <video src="${data.videoUrl}" controls playsinline class="w-full h-full object-contain"></video>
            </div>
          `;
        }
        if (outputEl && !window._producerRenderOutputUrl) {
          outputEl.href = data.videoUrl;
          outputEl.classList.remove('hidden');
        }
      } else {
        window._producerHasVideo = false;
        if (c) {
          c.innerHTML = '';
          c.classList.add('hidden');
        }
      }
      syncRenderBannerVisibility();
    }

    function updateCounters() {
      const scenes = manifestData?.scenes || [];
      const totalCount = scenes.length;
      const totalSec = manifestData?.total_duration_sec || 0;
      const avgSec = totalCount > 0 ? (totalSec / totalCount).toFixed(1) : '0.0';
      const totalMin = totalSec > 0 ? (totalSec / 60).toFixed(1) : '0.0';

      const goldCount = scenes.filter((s) => s.duration_ms <= 8500).length;
      const overCount = scenes.filter((s) => s.duration_ms > 10000).length;

      document.getElementById('statTotal').textContent = totalCount + ' 镜';
      document.getElementById('statAvgDur').textContent = `约 ${totalMin}m · 均 ${avgSec}s/镜`;
      document.getElementById('statGold').textContent = goldCount + ' 镜';
      document.getElementById('statOver').textContent = overCount + ' 镜';
    }

    function formatUiMMSS(sec) {
      const num = Math.max(0, Number(sec || 0));
      const totalInt = Math.floor(num);
      const frac = Number((num - totalInt).toFixed(1));
      const m = Math.floor(totalInt / 60);
      const s = totalInt % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + (frac > 0 ? '.' + Math.round(frac * 10) : '');
    }

    function getVideoShortfallInfo(scene, asset, durSecNum, overrideRawDur = null) {
      const needSec = Math.max(0, Number(durSecNum || 0));
      const rawDur = (overrideRawDur && Number.isFinite(overrideRawDur) && overrideRawDur > 0)
        ? overrideRawDur
        : Number(asset?.duration_seconds || asset?.duration_sec || 0);
      if (!Number.isFinite(rawDur) || rawDur <= 0 || needSec <= 0) {
        return { rawDur: 0, playableSec: 0, needSec, shortfallSec: 0, isTooShort: false };
      }
      const m = scene?.media_modifiers;
      const rawTrimStart = scene?.trim_start_sec !== undefined ? scene.trim_start_sec : m?.trim_start_sec;
      const rawTrimEnd = scene?.trim_end_sec !== undefined ? scene.trim_end_sec : m?.trim_end_sec;
      const clipStart = Math.max(0, Number(rawTrimStart) || 0);
      const trimEndNum = Number(rawTrimEnd);
      const clipEnd = (Number.isFinite(trimEndNum) && trimEndNum > 0) ? trimEndNum : rawDur;
      const rawRate = Number(m?.playback_rate || 1);
      const playbackRate = (Number.isFinite(rawRate) && rawRate > 0) ? rawRate : 1;
      const playableSec = Math.max(0, Math.min(rawDur, clipEnd) - clipStart) / playbackRate;
      const shortfallSec = Math.max(0, needSec - playableSec);
      const isTooShort = shortfallSec > 0.3;
      return { rawDur, playableSec, needSec, shortfallSec, isTooShort };
    }

    function buildVideoShortWarnText(info, needSecStr) {
      return `🚨 视频不够长：当前仅 ${info.playableSec.toFixed(1)}s，本镜旁白需 ${needSecStr}s（还差 ${info.shortfallSec.toFixed(1)}s）`;
    }

    window.checkVideoElementDuration = function (videoEl, idx) {
      const realDur = Number(videoEl?.duration || 0);
      if (!Number.isFinite(realDur) || realDur <= 0) return;
      const scene = manifestData?.scenes?.[idx];
      if (!scene) return;
      const durSecNum = (scene.duration_ms || 0) / 1000;
      const durSecStr = durSecNum.toFixed(1);
      const info = getVideoShortfallInfo(scene, null, durSecNum, realDur);

      const badgeEl = document.getElementById(`videoDurBadge_${idx}`);
      if (badgeEl) {
        badgeEl.className = info.isTooShort
          ? 'text-[10px] text-rose-400 font-mono font-bold shrink-0'
          : 'text-[10px] text-emerald-400 font-mono font-bold shrink-0';
        badgeEl.textContent = info.isTooShort
          ? `🚨 视频 ${info.playableSec.toFixed(1)}s / 需 ${durSecStr}s`
          : `⏱️ 本地 ${info.rawDur.toFixed(1)}s / 需 ${durSecStr}s`;
      }

      const dropzoneEl = document.getElementById(`dropzone_${idx}`);
      if (dropzoneEl && dropzoneEl.tagName === 'DIV') {
        if (info.isTooShort) {
          dropzoneEl.classList.remove('border-sky-500/40', 'bg-sky-950/30');
          dropzoneEl.classList.add('border-rose-500/80', 'bg-rose-950/35');
        } else {
          dropzoneEl.classList.remove('border-rose-500/80', 'bg-rose-950/35');
          dropzoneEl.classList.add('border-sky-500/40', 'bg-sky-950/30');
        }
      }

      for (const warnId of [`videoShortWarn_${idx}`, `aiVideoShortWarn_${idx}`]) {
        const warnEl = document.getElementById(warnId);
        if (!warnEl) continue;
        if (info.isTooShort) {
          warnEl.textContent = buildVideoShortWarnText(info, durSecStr);
          warnEl.classList.remove('hidden');
        } else {
          warnEl.classList.add('hidden');
        }
      }
    };

