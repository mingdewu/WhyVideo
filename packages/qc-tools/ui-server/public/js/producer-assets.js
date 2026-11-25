// producer-assets.js — shared classic-script scope; loaded before studio initialization.
function onFileDragOver(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.add('dropzone-hover');
    }

    function onFileDragLeave(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');
    }

    function onFileDrop(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        manifestData.scenes[idx].source_mode = 'manual_upload';
        uploadFileForRow(idx, file);
        return;
      }
      const transfer = e.dataTransfer;
      const raw = transfer?.getData('text/uri-list') || transfer?.getData('text/plain') || '';
      const candidate = raw.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) || '';
      try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
        const input = document.getElementById('urlDownloadInput_' + idx);
        if (!input) throw new Error('Missing URL input');
        input.value = candidate;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        showToast('链接已填入当前镜头，请选择下载方式');
      } catch {
        showToast('请拖入视频链接或本地视频、图片文件');
      }
    }

    async function applyAiIntentForRow(idx) {
      if (window._voiceInputState && window._voiceInputState.activeIdx === idx) {
        if (window._voiceInputState.phase === 'recording' || window._voiceInputState.phase === 'transcribing') {
          await stopAndFinishVoiceInput();
        }
      }
      const scene = manifestData.scenes[idx];
      if (!scene) return;
      if (window._pendingModeSaves && window._pendingModeSaves[scene.scene_id]) {
        try { await window._pendingModeSaves[scene.scene_id]; } catch (e) {}
      }
      const input = document.getElementById('aiIntentInput_' + idx);
      const promptText = input ? input.value.trim() : '';

      if (!promptText) {
        alert('请输入口语化指令（如时间截取、运镜缩放平移、调色滤镜、艺术字动效等）');
        return;
      }

      const asset = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
      const hasAsset = Boolean(scene.final_asset_id);
      let assetType = 'video';
      if (asset && (asset.type === 'image' || /.(png|jpg|jpeg|webp)$/i.test(asset.path || ''))) {
        assetType = 'image';
      }

      showToast('🤖 大模型正在解析并编译指令: "' + promptText.slice(0, 16) + '..."');

      try {
        const res = await fetch('/api/ai-intent?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            prompt: promptText,
            hasAsset,
            assetType,
            sourceMode: 'manual_upload',
          }),
        });

        const data = await res.json();
        if (data.ok) {
          if (data.scene) {
            manifestData.scenes[idx] = data.scene;
          } else if (data.manifest?.scenes?.[idx]) {
            manifestData.scenes[idx] = data.manifest.scenes[idx];
          }
          if (manifestData.scenes[idx]) {
            manifestData.scenes[idx].source_mode = 'manual_upload';
          }
          rerenderSceneRow(idx);
          const toastMsg = data.summary ? ('✨ [' + (data.modelUsed || '大模型') + ']: ' + data.summary) : '✨ 已由大模型动态编译为 Remotion 代码并同步完成！';
          showToast(toastMsg);
        } else {
          alert(data.error || '编译失败');
        }
      } catch (err) {
        alert('编译请求失败: ' + err.message);
      }
    }

    function fillAiIntentText(idx, text) {
      const input = document.getElementById('aiIntentInput_' + idx);
      if (input) {
        input.value = text;
        input.focus();
      }
    }

    async function resetModifiers(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/reset-modifiers?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('↺ 已重置所有动效与剪辑参数');
      }
    }

    async function applyAiTrim(idx) {
      const scene = manifestData.scenes[idx];
      const input = document.getElementById('trimInput_' + idx);
      const promptText = input ? input.value.trim() : '';

      if (!promptText) {
        alert('请输入剪辑指令，例如：“从第3秒到第8秒” 或 “取前5秒”');
        return;
      }

      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: promptText,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✨ ' + data.message);
      } else {
        alert(data.error || '剪辑失败');
      }
    }

    async function resetTrim(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: '从0秒开始',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('↺ 已重置截取范围');
      }
    }

    async function clearAsset(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/clear-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已清除当前镜头素材绑定');
      }
    }

    window._openCutPickers = window._openCutPickers || {};
    window._playingShotIdx = null;
    window._shotStopHandler = null;

    function onNarrationEdit(idx, val) {
      manifestData.scenes[idx].narration_text = val;
    }

    function onKeywordsEdit(idx, val) {
      const arr = val.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean);
      manifestData.scenes[idx].content_keywords = arr;
      if (arr.length > 0 && manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec.theme_title = arr[0].length >= 4 ? arr[0] : '「' + arr[0] + '」';
      }
      renderTable();
    }

    function setMode(idx, mode) {
      const scene = manifestData?.scenes?.[idx];
      if (!scene) return;
      scene.source_mode = mode;
      rerenderSceneRow(idx);
      if (activeProjectId && scene.scene_id) {
        window._pendingModeSaves = window._pendingModeSaves || {};
        const savePromise = fetch('/api/set-scene-mode?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            sourceMode: mode,
          }),
        })
          .catch((err) => console.warn('set-scene-mode failed:', err))
          .finally(() => {
            if (window._pendingModeSaves && window._pendingModeSaves[scene.scene_id] === savePromise) {
              delete window._pendingModeSaves[scene.scene_id];
            }
          });
        window._pendingModeSaves[scene.scene_id] = savePromise;
      }
    }

    function onPptThemeEdit(idx, key, val) {
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec[key] = val;
      renderTable();
    }

    async function linkWithPrevious(idx) {
      if (idx <= 0) return;
      const prevScene = manifestData.scenes[idx - 1];
      const targetAssetId = prevScene.final_asset_id;

      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: targetAssetId,
          isSharedWithPrev: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('🔗 已与上一镜头 ' + prevScene.scene_id + ' 建立素材连用！');
      }
    }

    async function unlinkScene(idx) {
      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: null,
          isSharedWithPrev: false,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已取消与上一镜头的连用。');
      }
    }

    async function onSceneVisualTypeChange(idx, val) {
      if (!manifestData.scenes[idx]) return;
      manifestData.scenes[idx].visual_type = val;
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec.template_style = val;
      // 随着模板选项选择不同，对应的卡片排列、排版指导词自动同步变化并提炼
      await autoGenerateShotPrompt(idx, 'card', val);
      showToast('🎨 镜头 ' + manifestData.scenes[idx].scene_id + ' 模板已切换为: ' + val + '，排版指导词已自动适配！');
    }

    const { extractLocalSmartPrompt } = window.WhyVideoPromptRules;

    async function autoGenerateShotPrompt(idx, targetMode, templateStyle) {
      const scene = manifestData.scenes[idx];
      if (!scene) return;
      const mode = targetMode || scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
      const curTemplate = templateStyle || scene.ppt_slide_spec?.template_style || scene.visual_type || 'data_card';
      const btn = document.getElementById('prompt_btn_' + idx);
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 提炼中...</span>';
      }

      try {
        const res = await fetch('/api/extract-prompt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            narrationText: scene.narration_text,
            targetMode: mode,
            keywords: scene.keywords || scene.content_keywords || [],
            templateStyle: curTemplate
          })
        });
        const data = await res.json();
        const generated = data.prompt || extractLocalSmartPrompt(scene.narration_text, mode, scene.keywords || scene.content_keywords, curTemplate);
        if (!scene.ppt_slide_spec) scene.ppt_slide_spec = {};
        scene.ppt_slide_spec.custom_prompt = generated;

        const input = document.getElementById('prompt_input_' + idx);
        if (input) {
          input.value = generated;
          input.classList.add('ring-2', 'ring-line-strong');
          setTimeout(() => input.classList.remove('ring-2', 'ring-line-strong'), 1000);
        }
        showToast('✨ [' + (data.usedModel || 'AI智能提炼') + '] 提示词已更新！');
      } catch (err) {
        const fallback = extractLocalSmartPrompt(scene.narration_text, mode, scene.keywords || scene.content_keywords, curTemplate);
        if (!scene.ppt_slide_spec) scene.ppt_slide_spec = {};
        scene.ppt_slide_spec.custom_prompt = fallback;
        const input = document.getElementById('prompt_input_' + idx);
        if (input) input.value = fallback;
        showToast('✨ [本地规则] 提示词已更新！');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    function setVisualTarget(idx, mode) {
      if (!manifestData.scenes[idx]) return;
      const sc = manifestData.scenes[idx];
      sc.target_visual_mode = mode;
      if (mode === 'card') {
        const validCards = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
        if (!validCards.includes(sc.visual_type)) {
          sc.visual_type = 'data_card';
          sc.scene_type = 'data_card';
        }
      }
      if (!sc.ppt_slide_spec) {
        sc.ppt_slide_spec = {};
      }
      if (!sc.ppt_slide_spec.custom_prompt) {
        sc.ppt_slide_spec.custom_prompt = extractLocalSmartPrompt(sc.narration_text, mode, sc.keywords || sc.content_keywords, sc.visual_type || 'data_card');
      }
      rerenderSceneRow(idx);
      showToast('🎯 镜头 ' + sc.scene_id + ' 视觉形式已切换为: ' + (mode === 'video' ? '🎬 实体视频 (MP4)' : mode === 'image' ? '🖼️ 超写实图' : '📊 AI 动态卡片'));
    }

    async function generateRowPpt(idx) {
      const scene = manifestData.scenes[idx];
      const targetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
      const btn = document.getElementById('gen_btn_' + idx);
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 正在请求 AI 引擎生成' + (targetMode === 'video' ? '真实实体视频 (约 20~40 秒)' : targetMode === 'image' ? '超清实景图' : 'AI 动态卡片大片') + '...</span>';
      }

      const promptInput = document.getElementById('prompt_input_' + idx);
      const titleInput = document.getElementById('title_input_' + idx);
      const customPrompt = promptInput ? promptInput.value : (scene.ppt_slide_spec?.custom_prompt || '');
      const themeTitle = titleInput ? titleInput.value : (scene.ppt_slide_spec?.theme_title || '');
      const globalPrompt = document.getElementById('globalPromptInput').value;

      const validCards = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
      const templateEl = document.getElementById('template_select_' + idx);
      const chosenTemplate = templateEl ? templateEl.value : scene.visual_type;
      const effectiveTemplate = (targetMode === 'card')
        ? (validCards.includes(chosenTemplate) ? chosenTemplate : 'data_card')
        : (scene.visual_type || 'broll_video');

      try {
        const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            visualTarget: targetMode,
            globalPrompt,
            customPrompt,
            themeTitle,
            templateStyle: effectiveTemplate,
            manifest: manifestData,
            selectedModel: visualConfig.videoModel,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          await loadWorkflow();
          showToast('✨ ' + (data.message || ('镜头 ' + scene.scene_id + ' 画面生成成功！')));
        } else {
          showToast('❌ 生成失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    const activeUrlDownloads = new Set();

    async function downloadUrlForRow(idx, mode = 'default') {
      const scene = manifestData?.scenes?.[idx];
      if (!scene) return;
      const projectId = activeProjectId;
      const downloadKey = JSON.stringify([projectId, scene.scene_id]);
      if (activeUrlDownloads.has(downloadKey)) return;

      const inputEl = document.getElementById('urlDownloadInput_' + idx);
      const downloadBtn = document.getElementById('urlDownloadBtn_' + idx);
      const headBtn = document.getElementById('urlDownloadHeadBtn_' + idx);
      const offsetBtn = document.getElementById('urlDownloadOffsetBtn_' + idx);
      const btnEl = { default: downloadBtn, head: headBtn, offset: offsetBtn }[mode];
      const buttons = [downloadBtn, headBtn, offsetBtn].filter(Boolean);
      const promptEl = document.getElementById('aiIntentInput_' + idx);
      const rawUrl = inputEl ? inputEl.value.trim() : '';
      const rawPrompt = mode === 'default' ? promptEl?.value.trim() || '' : '';

      if (!rawUrl) {
        alert('请先粘贴要下载的网络视频或帖子链接（支持 YouTube、B站、抖音、TikTok、小红书等）');
        if (inputEl) inputEl.focus();
        return;
      }

      let clipStartSec = scene.download_clip_start_sec;
      let clipEndSec = scene.download_clip_end_sec;
      if (mode !== 'default') {
        const duration = Number((getSharedVisualTiming(idx).durationMs / 1000).toFixed(1));
        if (!Number.isFinite(duration) || duration <= 0) {
          showToast('❌ 当前镜头没有有效时长');
          return;
        }
        clipStartSec = 0;
        if (mode === 'offset') {
          const startInput = document.getElementById('urlDownloadStart_' + idx);
          if (!startInput?.reportValidity()) return;
          clipStartSec = startInput.valueAsNumber;
        }
        clipEndSec = Number((clipStartSec + duration).toFixed(1));
        if (!Number.isFinite(clipEndSec) || clipEndSec <= clipStartSec) {
          showToast('❌ 请输入有效的起始秒数');
          return;
        }
      }
      const hasRange = clipStartSec !== undefined && clipStartSec !== null && clipEndSec !== undefined && clipEndSec !== null && Number(clipEndSec) > Number(clipStartSec);
      const origBtnText = btnEl ? btnEl.textContent : '⬇️ 下载';

      activeUrlDownloads.add(downloadKey);
      buttons.forEach((button) => { button.disabled = true; });
      if (btnEl) btnEl.textContent = '⏳ 下载中...';

      const jobId = 'dl_' + Date.now() + '_' + idx;
      const progWrap = document.getElementById('urlDownloadProgressWrap_' + idx);
      const progBar = document.getElementById('urlDownloadProgressBar_' + idx);
      const progText = document.getElementById('urlDownloadProgressText_' + idx);
      const progPct = document.getElementById('urlDownloadProgressPct_' + idx);
      const setProgUi = (pct, msg) => {
        const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
        if (progWrap) progWrap.classList.remove('invisible');
        if (progBar) progBar.style.width = safePct + '%';
        if (progPct) progPct.textContent = safePct + '%';
        if (progText && msg) progText.textContent = msg;
      };
      setProgUi(0, '准备连接本机哼哼猫客户端...');

      const pollTimer = setInterval(async () => {
        try {
          const pr = await fetch('/api/download-progress?jobId=' + encodeURIComponent(jobId));
          const pj = await pr.json();
          if (pj && pj.ok && typeof pj.percent === 'number') {
            setProgUi(pj.percent, pj.text || '下载处理中...');
          }
        } catch (e) {}
      }, 300);

      showToast(
        hasRange
          ? `⏳ 正在下载原视频 ${formatUiMMSS(clipStartSec)} ~ ${formatUiMMSS(clipEndSec)} 片段至本工程 assets/video/ ...`
          : '⏳ 正在解析并下载网络视频到本工程专属 assets 目录...'
      );

      try {
        const res = await fetch('/api/download-url-asset?project=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            sceneId: scene.scene_id,
            url: rawUrl,
            clipStartSec: hasRange ? Number(clipStartSec) : undefined,
            clipEndSec: hasRange ? Number(clipEndSec) : undefined,
            rawPrompt,
            jobId,
          }),
        });
        clearInterval(pollTimer);
        const data = await res.json();
        if (activeProjectId !== projectId) return;
        if (data.ok) {
          setProgUi(100, '下载并绑定完成！');
          if (window._pendingDownloadUrls) delete window._pendingDownloadUrls[idx];
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          const isCurrentRow = () => activeProjectId === projectId && manifestData?.scenes?.[idx]?.scene_id === scene.scene_id;
          if (isCurrentRow()) {
            const freshRow = buildSceneRow(manifestData.scenes[idx], idx);
            const newDropzone = freshRow.querySelector('#dropzone_' + idx);
            const oldDropzone = document.getElementById('dropzone_' + idx);
            if (newDropzone && oldDropzone) {
              oldDropzone.replaceWith(newDropzone);
              if (typeof observeLazySceneVideos === 'function') observeLazySceneVideos(newDropzone);
              updateCounters();
            } else {
              rerenderSceneRow(idx);
            }
            const urlInp = document.getElementById('urlDownloadInput_' + idx);
            if (urlInp) urlInp.value = '';
            const inp = document.getElementById('aiIntentInput_' + idx);
            if (inp) {
              inp.value = '';
              inp.placeholder = '✅ 短视频已就绪！现在可输入口令对此片段加字幕/艺术字、调色或运镜...';
            }
          }
          setTimeout(() => {
            if (progWrap) progWrap.classList.add('invisible');
          }, 800);
          showToast(data.message || '✅ 网络视频片段已下载到本工程 assets 目录并绑定至当前分镜！');
        } else {
          if (progWrap) progWrap.classList.add('invisible');
          alert(data.error || '链接解析下载失败');
        }
      } catch (err) {
        if (progWrap) progWrap.classList.add('invisible');
        alert('请求失败: ' + err.message);
      } finally {
        clearInterval(pollTimer);
        activeUrlDownloads.delete(downloadKey);
        buttons.forEach((button) => { button.disabled = false; });
        if (btnEl) btnEl.textContent = origBtnText;
      }
    }

    async function updateSceneAudioOption(idx) {
      const scene = manifestData.scenes[idx];
      if (!scene) return;
      const checkEl = document.getElementById('keepAudioCheck_' + idx);
      const volEl = document.getElementById('keepAudioVol_' + idx);
      const keepOriginalAudio = Boolean(checkEl && checkEl.checked);
      const originalAudioVolume = volEl ? Number(volEl.value) / 100 : 0.3;

      try {
        const res = await fetch('/api/update-scene-audio?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            keepOriginalAudio,
            originalAudioVolume,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          renderTable();
          showToast(keepOriginalAudio ? '🔊 已开启该镜头原声（音量 ' + Math.round(originalAudioVolume * 100) + '%）' : '🔇 已关闭该镜头原声');
        } else {
          showToast('❌ 更新原声设置失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      }
    }

    async function bindProjectAssetForRow(idx, assetId) {
      const scene = manifestData.scenes[idx];
      if (!scene || !assetId) return;
      showToast('⏳ 正在绑定本工程已下载素材...');
      try {
        const res = await fetch('/api/bind-project-asset?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            assetId,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          renderTable();
          showToast(data.message || '✅ 已切换绑定本工程素材！');
        } else {
          alert(data.error || '素材绑定失败');
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      }
    }

    async function clearDownloadRangeForRow(idx) {
      const scene = manifestData.scenes[idx];
      if (!scene) return;
      try {
        const res = await fetch('/api/clear-download-range?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          renderTable();
          showToast('↺ 已取消片段区间限制，点下载时将下载完整视频');
        }
      } catch (err) {
        console.warn(err);
      }
    }

    async function uploadFileForRow(idx, file) {
      if (!file) return;
      const scene = manifestData.scenes[idx];
      showToast('⏳ 正在上传并检验 ' + file.name + ' ...');
      const reader = new FileReader();
      reader.onload = async () => {
        const res = await fetch('/api/upload-asset?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            fileName: file.name,
            fileType: file.type,
            dataUrl: reader.result,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          renderTable();
          showToast('✅ 成功绑定素材并进入检验模式！');
          setTimeout(() => {
            const inp = document.getElementById('aiIntentInput_' + idx);
            if (inp) {
              inp.focus();
              inp.placeholder = '已就绪素材: ' + file.name + '，可输入变亮、弹艺术字、剪辑秒数...';
            }
          }, 200);
        } else {
          alert(data.error || '上传失败');
        }
      };
      reader.readAsDataURL(file);
    }

    async function saveAll() {
      const studioWin = window.open('about:blank', 'whyvideo_remotion_studio');
      if (studioWin && !studioWin.closed) {
        try {
          studioWin.document.title = '正在同步并打开 Remotion Studio (:3100)...';
          studioWin.document.body.innerHTML =
            '<div style="font-family:sans-serif;background:#F5F6F8;color:#111827;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:18px;">💾 正在保存并同步工程「' +
            escapeHtml(activeProjectId) +
            '」到 Remotion (:3100)，请稍候...</div>';
        } catch (e) {}
      }
      showToast('💾 正在保存并同步至 Remotion (:3100)...');

      try {
        const globalPrompt = document.getElementById('globalPromptInput').value;
        const res = await fetch('/api/workflow-save?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            manifest: manifestData,
            promptConfig: {
              selected_visual_model: visualConfig.videoModel,
              global_ai_visual_prompt: globalPrompt,
              updated_at: new Date().toISOString(),
            },
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          if (data.timingSummary) {
            window.timingSummaryData = data.timingSummary;
            renderTimingSummaryBadge(data.timingSummary);
          }
          renderTable();
          const studioUrl = (data.remotionStudio && data.remotionStudio.url) || 'http://localhost:3100';
          if (data.remotionStudio && data.remotionStudio.ok) {
            if (studioWin && !studioWin.closed) {
              studioWin.location.href = studioUrl;
            } else {
              window.open(studioUrl, 'whyvideo_remotion_studio');
            }
          } else if (studioWin && !studioWin.closed) {
            studioWin.close();
          }

          showToast('✅ 已保存镜头表格，并同步至 Remotion 视频引擎！');
          showCompletionModal({
            icon: '💾',
            title: '保存并同步已完成',
            message: '镜头表格修改已保存，并已同步至 Remotion 视频引擎！',
            detail:
              '已同步工程：' +
              activeProjectId +
              '（共 ' +
              (manifestData?.scenes?.length || 0) +
              ' 个镜头）。' +
              (data.remotionStudio?.ok
                ? '\nRemotion (:3100) 已自动切换到当前工程。'
                : data.remotionStudio?.error
                ? '\nRemotion 自动切换提示：' + data.remotionStudio.error
                : ''),
            actionText: '🎬 打开 Remotion (:3100) ↗',
            actionUrl: studioUrl,
          });
        } else {
          if (studioWin && !studioWin.closed) studioWin.close();
          showToast('❌ 保存失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        if (studioWin && !studioWin.closed) studioWin.close();
        showToast('❌ 保存并同步失败: ' + err.message);
      }
    }

    async function openRemotionStudioForCurrentProject() {
      const win = window.open('about:blank', 'whyvideo_remotion_studio');
      if (win && !win.closed) {
        try {
          win.document.title = '正在切换 Remotion Studio (:3100)...';
          win.document.body.innerHTML =
            '<div style="font-family:sans-serif;background:#F5F6F8;color:#111827;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:18px;">🎬 正在将 Remotion (:3100) 切换到工程「' +
            escapeHtml(activeProjectId) +
            '」，请稍候...</div>';
        } catch (e) {}
      }
      showToast('🎬 正在切换 Remotion (:3100) 到当前工程...');
      try {
        const res = await fetch('/api/remotion-studio/open?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId }),
        });
        const data = await res.json();
        const studioUrl = data.url || 'http://localhost:3100';
        if (data.ok) {
          if (win && !win.closed) {
            win.location.href = studioUrl;
          } else {
            window.open(studioUrl, 'whyvideo_remotion_studio');
          }
          showToast('✅ Remotion (:3100) 已切换到 ' + activeProjectId);
        } else {
          if (win && !win.closed) win.close();
          showToast('❌ 打开 Remotion 失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        if (win && !win.closed) win.close();
        showToast('❌ 打开 Remotion 失败: ' + err.message);
      }
    }
