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

    const SCENE_FIELD_LABELS = ['', '旁白', '画面方式', '画面内容（素材上传 / AI 生成）', '节拍调整'];

    function buildSceneRow(scene, idx) {
        const isAi = Boolean(scene.source_mode && scene.source_mode !== 'manual_upload');
        const ppt = scene.ppt_slide_spec || {};
        const kws = Array.isArray(scene.content_keywords) ? scene.content_keywords : [];
        const durSec = (scene.duration_ms / 1000).toFixed(1);

        let badgeClass = 'badge-gold';
        let badgeLabel = `🟢 ${durSec}s · 黄金节奏`;
        if (scene.duration_ms > 10000) {
          badgeClass = 'badge-danger';
          badgeLabel = `🔴 ${durSec}s · 建议加切点 ✂️`;
        } else if (scene.duration_ms > 8500) {
          badgeClass = 'badge-warn';
          badgeLabel = `🟡 ${durSec}s · 偏长`;
        } else if (scene.duration_ms < 1500) {
          badgeClass = 'badge-warn';
          badgeLabel = `🟡 ${durSec}s · 偏短`;
        }

        const isSharedWithPrev = Boolean(scene.shared_asset_with_prev);
        const tr = document.createElement('tr');
        tr.setAttribute('role', 'row');
        tr.dataset.sceneIdx = String(idx);
        tr.className = 'transition ' + (isSharedWithPrev ? 'bg-sky-950/20' : '');

        // 1. 镜头序号与时长
        const hasProjectAudio = Boolean((window.timingSummaryData && window.timingSummaryData.has_audio_file) || (manifestData && manifestData.audio_file));
        const isPlayingThisShot = window._playingShotIdx === idx;
        const td1 = document.createElement('td');
        td1.className = 'p-3 text-center';
        td1.innerHTML = `
          <span class="px-2 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-amber-400 font-extrabold text-xs block mb-1">
            ${scene.scene_id}
          </span>
          <span class="inline-block px-1.5 py-px rounded text-[9px] leading-tight font-semibold mb-1 ${badgeClass}">
            ${badgeLabel}
          </span>
          <span class="text-sm font-extrabold text-white bg-gray-900/90 border border-gray-700/80 rounded-md px-2 py-1 block font-mono tracking-tight my-1 whitespace-nowrap">
            ${(scene.start_ms / 1000).toFixed(1)}s - ${(scene.end_ms / 1000).toFixed(1)}s
          </span>
          <div class="mt-1 flex flex-wrap items-center justify-center gap-1">
            ${scene.timing_source && scene.timing_source.startsWith('aligned')
              ? '<span class="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px] font-semibold">🎙️ 已对齐</span>'
              : ''}
            ${hasProjectAudio
              ? `<button type="button" id="btnPlayShotAudio_${idx}" onclick="togglePlayShotNarration(${idx})" class="px-1.5 py-0.5 rounded ${isPlayingThisShot ? 'bg-rose-600 text-white border-rose-400' : 'bg-emerald-600/25 hover:bg-emerald-600/45 text-emerald-200 border-emerald-500/40'} border text-[9px] font-bold transition cursor-pointer shadow-sm" title="试听本镜头对应的旁白配音片段 (${(scene.start_ms / 1000).toFixed(1)}s ~ ${(scene.end_ms / 1000).toFixed(1)}s)">${isPlayingThisShot ? '⏹️ 停止' : '🔊 试听'}</button>`
              : ''}
          </div>
          <span class="text-[10px] text-gray-400 block mt-0.5">${scene.chapter_ref || ''}</span>
        `;

        // 2. 旁白片段（支持点字切画面 / 挪切点）
        const td2 = document.createElement('td');
        td2.className = 'p-3';
        const isPickerOpen = Boolean(window._openCutPickers && window._openCutPickers[idx]);
        const vKws = Array.isArray(scene.visual_keywords) ? scene.visual_keywords : [];
        td2.innerHTML = `
          <textarea rows="4" aria-label="旁白" class="w-full p-2.5 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-xs leading-relaxed focus:border-blue-500 focus:outline-none"
            onchange="onNarrationEdit(${idx}, this.value)">${escapeHtml(scene.narration_text || '')}</textarea>
          <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
            <button type="button" onclick="toggleCharCutPicker(${idx})"
              class="px-2 py-0.5 rounded bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 font-semibold transition cursor-pointer">
              ${isPickerOpen ? '▲ 收起切点面板' : '👆 点字切画面 / 挪切点'}
            </button>
            ${vKws.length ? ('<span class="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 border border-purple-500/30 font-mono truncate max-w-[180px]" title="画面触发关键词">🎯 ' + escapeHtml(vKws.join(' / ')) + '</span>') : ''}
          </div>
          <div id="charCutPicker_${idx}" class="${isPickerOpen ? '' : 'hidden '}mt-2 p-2.5 rounded-xl bg-gray-900/95 border border-indigo-500/40 space-y-2"></div>
        `;
        if (isPickerOpen) {
          const pickerEl = td2.querySelector('#charCutPicker_' + idx);
          if (pickerEl) pickerEl.innerHTML = buildCharCutPickerInner(idx);
        }

        // 3. 画面生成方式
        const td4 = document.createElement('td');
        td4.className = 'p-3';
        td4.innerHTML = `
          <div class="space-y-1.5">
            <label class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
              !isAi
                ? 'bg-sky-500/20 border-sky-500 text-sky-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_${idx}" onchange="setMode(${idx}, 'manual_upload')" ${!isAi ? 'checked' : ''} />
              <span class="text-xs">📤 人工上传素材</span>
            </label>
            <label class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
              isAi
                ? 'bg-purple-500/20 border-purple-500 text-purple-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_${idx}" onchange="setMode(${idx}, 'ai_ppt_slide')" ${isAi ? 'checked' : ''} />
              <span class="text-xs">🤖 AI 生成画面</span>
            </label>
          </div>
        `;

        // 5. 【核心升级】：视觉呈现方式三选一 (🎬实体视频 / 🖼️超写实图 / 📊动效卡片) + 即时生成与真实预览
        const td5 = document.createElement('td');
        td5.className = 'p-3';

        const curVisualType = scene.visual_type || 'data_card';
        const curTargetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
        const mainTitle = ppt.theme_title || kws[0] || '核心要点';
        const subtitle = ppt.subtitle || scene.narration_text.slice(0, 24);
        const hasPreviewImage = Boolean(scene.preview_image_url);

        const assetRecord = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const hasGeneratedVideo = Boolean(scene.final_asset_id && scene.visual_type === 'broll_video' && assetRecord);
        const generatedVideoSrc = hasGeneratedVideo ? ('/public/' + activeProjectId + '/' + assetRecord.path) : null;

        const pName = (visualConfig.videoModel || 'tencent/hunyuan-video').split('/').pop();
        const iName = (visualConfig.imageModel || 'flux-1-schnell').split('/').pop();

        let innerContent = '';

        if (curTargetMode === 'video') {
          const aiShortInfo = hasGeneratedVideo
            ? getVideoShortfallInfo(scene, assetRecord, Number(durSec) || 0)
            : { isTooShort: false, playableSec: 0, shortfallSec: 0 };
          // 🎬 实体真实动态视频形态
          innerContent = `
            <!-- Prompt 指导输入窗口 -->
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">🎬 视频描述 & 运镜指示词 (Text-to-Video):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'video')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼电影级运镜与画面描述词">
                  ✨ 自动提炼运镜词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入本镜头视频画面与运镜提示词（留空将根据旁白生成）..."
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <!-- 一键生成实体视频按钮 -->
            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎬 一键生成真实动态视频 (${pName})</span>
              </button>
            </div>

            <!-- 实体视频行内真实播放器或预览占位 -->
            ${hasGeneratedVideo ? `
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <video src="${generatedVideoSrc}" controls playsinline preload="metadata" onloadedmetadata="checkVideoElementDuration(this, ${idx})" class="w-full h-full object-cover"></video>
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40 flex items-center gap-1 pointer-events-none">
                  <span>✅ 实体 MP4 视频就绪 (时长: ${durSec}s)</span>
                </div>
              </div>
              <div id="aiVideoShortWarn_${idx}" class="${aiShortInfo.isTooShort ? '' : 'hidden '}px-2.5 py-1.5 rounded-lg bg-rose-600/25 border border-rose-500 text-rose-200 text-[11px] font-bold flex items-center gap-1.5 shadow-sm">
                ${aiShortInfo.isTooShort ? buildVideoShortWarnText(aiShortInfo, durSec) : ''}
              </div>
            ` : `
              <div class="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-gray-950 via-teal-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between relative overflow-hidden group">
                <div class="flex items-center justify-between">
                  <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">
                    待生成 · 🎬 实体动态视频 (MP4)
                  </span>
                  <span class="text-[9px] text-gray-500 font-mono">1920x1080 · ${durSec}s</span>
                </div>

                <div class="my-auto text-center px-1">
                  <h4 class="text-xs font-bold text-gray-200 line-clamp-2">
                    ${scene.narration_text}
                  </h4>
                  <p class="text-[10px] text-emerald-400/90 mt-1 line-clamp-1 font-mono">
                    ${ppt.custom_prompt ? ('🎯 ' + ppt.custom_prompt) : (kws.length ? ('标志: ' + kws.join(' · ')) : '等待指令')}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-1 border-t border-emerald-500/20 text-[9px] text-emerald-300/70">
                  <span>⚡ 点击上方按钮调用 ${pName} 生成实体视频</span>
                  <span>⏱️ 需 ${durSec}s</span>
                </div>
              </div>
            `}
          `;
        } else if (curTargetMode === 'image') {
          // 🖼️ 超写实实景图形态
          innerContent = `
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">🖼️ 实景图视觉指示词 (FLUX HD):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'image')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/60 hover:bg-blue-800 text-blue-200 border border-blue-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼超清摄影构图与视觉特征词">
                  ✨ 自动提炼实景词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入本镜头实景图画面描述词（留空将根据旁白生成）..."
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🖼️ 一键生成超清实景图 (${iName})</span>
              </button>
            </div>

            ${hasPreviewImage ? `
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="Image Still 1080p" onclick="window.open('${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ 超清实景图已挂载</span>
                </div>
                <a href="${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-blue-950/90 hover:bg-blue-600 text-blue-200 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold border border-blue-500/50 flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            ` : `
              <div class="rounded-xl border border-blue-500/30 bg-gray-950 p-2.5 aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-blue-500/20 text-blue-300 w-fit">待生成 · 超清实景图</span>
                <p class="text-xs text-center text-gray-300 line-clamp-2">${scene.narration_text}</p>
                <div class="text-[9px] text-blue-300/70 text-center">点击上方按钮由 ${iName} 生成超清实景图</div>
              </div>
            `}
          `;
        } else {
          // 📊 动效排版卡片形态
          innerContent = `
            <div class="flex items-center justify-between p-1 rounded-lg bg-gray-950 border border-purple-500/30 text-[10px]">
              <div class="flex items-center gap-1.5 font-bold text-purple-300">
                <span>🪐 大模型 API 视觉排版调优</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-purple-900/50 text-purple-200 border border-purple-400/40">AI 自由设计</span>
              </div>
              <span class="text-[9px] text-gray-400">结合顶部模型自适应优化</span>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">📊 卡片排版指导词 (Prompt):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'card')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼卡片视觉排版提示">
                  ✨ 自动提炼排版词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入卡片 Prompt 指导词..."
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-gray-400 font-bold whitespace-nowrap">大字:</span>
              <input id="title_input_${idx}" type="text" value="${escapeHtml(ppt.theme_title || '')}" placeholder="修改核心大字标题..."
                class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-200 font-bold text-[11px] focus:border-purple-400 focus:outline-none"
                onchange="onPptThemeEdit(${idx}, 'theme_title', this.value)" />
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎨 一键由 AI 绘制 PPT 动态卡片 (${iName})</span>
              </button>
            </div>

            ${hasPreviewImage ? `
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="AI Presentation Card" onclick="window.open('${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ AI 绘制 PPT 动态卡片 (${iName})</span>
                </div>
                <a href="${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-purple-950/90 hover:bg-purple-600 text-purple-200 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold border border-purple-500/50 flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            ` : `
              <div class="rounded-xl border border-purple-500/40 bg-gradient-to-br from-gray-950 via-purple-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-purple-500/25 text-purple-300 w-fit">待生成 · AI PPT 动态卡片</span>
                <div class="my-auto text-center px-1">
                  <h4 class="text-sm font-black text-purple-200">${mainTitle}</h4>
                  <p class="text-[10px] text-gray-300 mt-1 line-clamp-1">${subtitle}</p>
                </div>
                <div class="text-[9px] text-purple-300/70 text-center">点击上方按钮由 ${iName} 绘制 16:9 专业 PPT 信息图卡片</div>
              </div>
            `}
          `;
        }

        td5.innerHTML = `
          <div class="space-y-2 ${isAi ? '' : 'inactive-visual-editor opacity-40 pointer-events-none'}">
            <!-- 视觉呈现形态三态切换 -->
            <div class="flex items-center p-0.5 rounded-lg bg-gray-950 border border-gray-800 text-[10px] font-bold">
              <button type="button" onclick="setVisualTarget(${idx}, 'video')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'video' ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🎬 实体视频
              </button>
              <button type="button" onclick="setVisualTarget(${idx}, 'image')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'image' ? 'bg-blue-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🖼️ 超写实图
              </button>
              <button type="button" onclick="setVisualTarget(${idx}, 'card')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'card' ? 'bg-purple-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                📊 动效卡片
              </button>
            </div>

            ${innerContent}
          </div>
        `;

        // 6. 桌面拖拽放置框 + 在线检验播放器 + 一句话 AI 剪辑
        const td6 = document.createElement('td');
        td6.className = 'p-3';

        const asset = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const prevScene = idx > 0 ? manifestData.scenes[idx - 1] : null;

        let linkHtml = '';
        if (idx > 0 && prevScene) {
          if (isSharedWithPrev) {
            linkHtml = `
              <div class="p-1 rounded-lg bg-sky-950/70 border border-sky-500/50 text-[10px] text-sky-300 font-bold flex items-center justify-between gap-1 mb-1.5">
                <span>🔗 连用上一镜头素材</span>
                <button onclick="unlinkScene(${idx})" class="text-rose-400 hover:text-rose-300 text-xs">✕ 取消</button>
              </div>
            `;
          } else {
            linkHtml = `
              <button onclick="linkWithPrevious(${idx})" class="w-full px-2 py-1 rounded-lg bg-gray-800 hover:bg-sky-600 border border-gray-700 hover:border-sky-400 text-gray-300 hover:text-white text-[10px] font-semibold transition mb-1.5 block">
                🔗 与上一镜头连用 (共用视频)
              </button>
            `;
          }
        }

        // 动效/裁剪状态指示徽章
        let modifiersBadgesHtml = '';
        const m = scene.media_modifiers;
        const hasTrim = scene.trim_start_sec !== undefined || m?.trim_start_sec !== undefined;
        if (m || hasTrim || scene.downloaded_clip_info) {
          const parts = [];
          if (scene.downloaded_clip_info && scene.downloaded_clip_info.label) {
            parts.push('✂️ 原片片段: ' + scene.downloaded_clip_info.label + ' (本地 ' + (scene.downloaded_clip_info.local_duration_sec || durSec) + 's)');
          } else if (hasTrim) {
            const s = scene.trim_start_sec !== undefined ? scene.trim_start_sec : m?.trim_start_sec;
            const e = scene.trim_end_sec !== undefined ? scene.trim_end_sec : (m?.trim_end_sec || '末尾');
            parts.push('⏱️ 本地播放: ' + s + 's~' + e + 's');
          }
          if (m && m.filters && m.filters.brightness) parts.push('☀️ 亮度: ' + m.filters.brightness + 'x');
          if (m && m.filters && m.filters.sepia) parts.push('🎞️ 复古胶片');
          if (m && m.filters && m.filters.grayscale) parts.push('⬛ 黑白');
          if (m && m.motion) parts.push('🎥 运镜: ' + m.motion.motion_type + ' (' + (m.motion.duration_sec || 3) + 's)');
          if (m && m.text_overlays && m.text_overlays.length > 0) {
            parts.push('💥 艺术字: "' + m.text_overlays[0].text + '" (' + (m.text_overlays[0].animation || '弹出') + ')');
          }
          if (parts.length > 0) {
            modifiersBadgesHtml = `
              <div class="p-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-[10px] text-emerald-300 font-mono flex items-center justify-between gap-1">
                <span class="truncate" title="${parts.join(' · ')}">✨ ${parts.join(' · ')}</span>
                <button onclick="resetModifiers(${idx})" class="text-rose-400 hover:text-rose-300 text-[10px] shrink-0 font-bold hover:underline cursor-pointer">重置</button>
              </div>
            `;
          }
        }

        const isImage = asset && (asset.type === 'image' || /.(png|jpg|jpeg|webp)$/i.test(asset.path || ''));
        const isVideo = asset && (asset.type === 'video' || /.(mp4|mov|webm)$/i.test(asset.path || ''));
        const hasBoundManual = Boolean(asset && scene.source_mode === 'manual_upload');
        const inputPlaceholder = hasBoundManual
          ? (isImage
              ? '💬 针对本张图片输入口令 (运镜推拉平移、调色滤镜、加字幕/艺术字)...'
              : '💬 基于本段已下载短视频加字幕/艺术字、调色、运镜，或输入新下载秒数...')
          : '💬 第一步：输入下载秒数口令 (如: 第1分5秒到1分15秒) 点「✨编译」...';
        const rawPromptVal = scene.ai_intent_prompt || '';
        const currentPromptVal = String(rawPromptVal).replace(/"/g, '&quot;');

        let speechBubbleHtml = '';
        if (scene.ai_speech_reply) {
          const safeSpeech = String(scene.ai_speech_reply).replace(/</g, '&lt;').replace(/>/g, '&gt;');
          speechBubbleHtml = `
            <div class="p-2 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-[10px] text-indigo-200 leading-relaxed shadow-sm">
              <div class="flex items-center gap-1 font-bold text-indigo-400 mb-0.5">
                <span>🤖 AI 剪辑总监反馈：</span>
              </div>
              <div>${safeSpeech}</div>
            </div>
          `;
        }

        // Step 0: AI 唯一最佳纯中文搜索词（位于 Step 1 顶部，极简单行：最佳词 + GitHub 复制按钮 + 换一个）
        const kwCandidates = Array.isArray(scene.search_keyword_candidates) ? scene.search_keyword_candidates : [];
        const bestKw = scene.selected_search_keyword || kwCandidates[0] || '';
        const step0RowHtml = buildStep0BestKeywordHtml(idx, bestKw);
        const step0KeywordsHtml = `
          <div id="step0KwWrap_${idx}" class="pb-1.5 border-b border-gray-800/70">
            ${step0RowHtml}
          </div>
        `;

        // 口令框（置于最上方：既能把秒数口令编译为下载片段跳转指令，也能对已下载本地短视频做加字幕/动效二次剪辑）
        const aiInputHtml = `
          <div class="space-y-1.5 min-w-0">
            <div class="flex items-center justify-between gap-2 text-[9px] text-sky-300 font-bold min-w-0">
              <span class="truncate">🎙️ Step 1 · 口语指令 (下载秒数 / 字幕动效)</span>
              <span class="text-gray-500 font-mono shrink-0">语音或输入后点编译 ↵</span>
            </div>
            <div class="flex items-center gap-1 min-w-0">
              <input type="text" id="aiIntentInput_${idx}"
                     placeholder="${inputPlaceholder}"
                     value="${currentPromptVal}"
                     onkeydown="if(event.key==='Enter') applyAiIntentForRow(${idx})"
                     class="min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-gray-950 border border-sky-500/60 text-white text-[10px] placeholder:text-gray-500 focus:border-sky-400 focus:ring-1 focus:ring-sky-400 focus:outline-none" />
              <button type="button" id="aiVoiceBtn_${idx}" onclick="toggleVoiceInputForRow(${idx})"
                      aria-label="语音输入口语指令" aria-pressed="false"
                      title="点击开始语音输入口语指令（再次点击结束并转文字）"
                      class="px-2 py-1.5 rounded-lg bg-gray-900 hover:bg-rose-600/25 border border-sky-500/50 hover:border-rose-400/70 text-sky-200 hover:text-rose-100 font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1">
                🎤 语音
              </button>
              <button type="button" onclick="applyAiIntentForRow(${idx})" class="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition" title="解析口语中的起止秒数生成下载跳转命令，或编译字幕与Remotion动效">
                ✨ 编译
              </button>
            </div>
            <div id="aiVoiceStatus_${idx}" class="hidden flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[10px] text-rose-200">
              <span id="aiVoiceStatusText_${idx}" class="truncate"></span>
              <button type="button" onclick="cancelActiveVoiceInput(true)" class="text-gray-300 hover:text-white underline shrink-0 cursor-pointer">取消</button>
            </div>
            ${speechBubbleHtml}
            ${modifiersBadgesHtml}
          </div>
        `;

        // 检查是否已由口令编译出待下载的片段起止秒数
        const dlStart = scene.download_clip_start_sec;
        const dlEnd = scene.download_clip_end_sec;
        const hasCompiledDlRange = dlStart !== undefined && dlStart !== null && dlEnd !== undefined && dlEnd !== null && Number(dlEnd) > Number(dlStart);
        const dlRangeLabel = hasCompiledDlRange ? (`${formatUiMMSS(dlStart)}~${formatUiMMSS(dlEnd)}`) : '';
        const dlBtnText = hasCompiledDlRange ? (`⬇️ 下载片段 (${dlRangeLabel})`) : '⬇️ 下载';
        const pendingUrlVal = ((window._pendingDownloadUrls && window._pendingDownloadUrls[idx]) || '').replace(/"/g, '&quot;');
        const seqDisplay = `${activeProjectId}·序列${String(idx + 1).padStart(2, '0')}`;

        const downloadRangeBadgeHtml = hasCompiledDlRange
          ? `
            <div class="p-1.5 rounded-lg bg-teal-950/80 border border-teal-400/60 text-[10px] text-teal-200 font-mono flex items-center justify-between gap-1 shadow-sm">
              <span class="truncate" title="点下载时将只抓取原视频 ${dlRangeLabel} (${dlStart}s~${dlEnd}s)">
                🎯 已就绪: 仅下载 <b>${dlRangeLabel}</b> (${(Number(dlEnd) - Number(dlStart)).toFixed(1)}s)
              </span>
              <button type="button" onclick="clearDownloadRangeForRow(${idx})" class="text-rose-400 hover:text-rose-300 text-[10px] shrink-0 font-bold hover:underline cursor-pointer">✕ 整片</button>
            </div>
          `
          : '';

        const urlDownloadBarHtml = `
          <div class="space-y-1 pt-1 border-t border-gray-800/70 min-w-0">
            <div class="flex items-center justify-between gap-2 text-[9px] text-teal-300/90 font-bold min-w-0">
              <span class="truncate">🔗 Step 2 · 填入视频 URL 下载 (${seqDisplay})</span>
              <span class="text-gray-500 font-mono truncate max-w-[120px] shrink-0" title="projects/${activeProjectId}/public/assets/video/">📂 assets/</span>
            </div>
            ${downloadRangeBadgeHtml}
            <div class="flex items-center gap-1 min-w-0">
              <input type="url" id="urlDownloadInput_${idx}"
                     value="${pendingUrlVal}"
                     oninput="window._pendingDownloadUrls = window._pendingDownloadUrls || {}; window._pendingDownloadUrls[${idx}] = this.value"
                     placeholder="🔗 粘贴视频链接 (YouTube/B站/抖音等)..."
                     onkeydown="if(event.key==='Enter') downloadUrlForRow(${idx})"
                     class="min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-gray-950 border border-teal-500/50 text-white text-[10px] placeholder:text-gray-500 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 focus:outline-none" />
              <button type="button" id="urlDownloadBtn_${idx}" onclick="downloadUrlForRow(${idx})"
                      class="px-2 py-1.5 rounded-lg ${hasCompiledDlRange ? 'bg-gradient-to-r from-teal-500 to-emerald-500 ring-1 ring-teal-300' : 'bg-teal-600 hover:bg-teal-500'} text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition">
                ${dlBtnText}
              </button>
            </div>
            <div id="urlDownloadProgressWrap_${idx}" class="hidden space-y-0.5 pt-0.5">
              <div class="w-full h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div id="urlDownloadProgressBar_${idx}" class="h-full bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full transition-all duration-200" style="width: 0%;"></div>
              </div>
              <div class="flex items-center justify-between text-[9px] text-teal-300/90 font-mono">
                <span id="urlDownloadProgressText_${idx}" class="truncate">准备下载...</span>
                <span id="urlDownloadProgressPct_${idx}" class="shrink-0 font-bold">0%</span>
              </div>
            </div>
          </div>
        `;

        if (asset && scene.source_mode === 'manual_upload') {
          const videoSrc = `/public/${activeProjectId}/${asset.path}`;
          const durSecNum = Number(durSec) || 0;
          const shortInfo = isVideo
            ? getVideoShortfallInfo(scene, asset, durSecNum)
            : { isTooShort: false, rawDur: 0, playableSec: 0, shortfallSec: 0 };
          const durBadgeClass = isVideo && shortInfo.isTooShort
            ? 'text-[10px] text-rose-400 font-mono font-bold shrink-0'
            : 'text-[10px] text-emerald-400 font-mono font-bold shrink-0';
          const durBadgeText = isVideo
            ? (shortInfo.isTooShort
                ? `🚨 视频 ${shortInfo.playableSec.toFixed(1)}s / 需 ${durSec}s`
                : `⏱️ 本地 ${shortInfo.rawDur > 0 ? shortInfo.rawDur.toFixed(1) : durSec}s / 需 ${durSec}s`)
            : `⏱️ 本地 ${asset.duration_seconds || durSec}s / 需 ${durSec}s`;

          td6.innerHTML = `
            <div class="space-y-2">
              ${linkHtml}
              ${step0KeywordsHtml}
              ${aiInputHtml}
              ${urlDownloadBarHtml}
              <div id="dropzone_${idx}"
                   class="border ${shortInfo.isTooShort ? 'border-rose-500/80 bg-rose-950/35' : 'border-sky-500/40 bg-sky-950/30'} rounded-xl p-2.5 text-left space-y-1.5 transition"
                   ondragover="onFileDragOver(event, ${idx})"
                   ondragleave="onFileDragLeave(event, ${idx})"
                   ondrop="onFileDrop(event, ${idx})">
                <div class="flex items-center justify-between gap-1">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-sky-500/20 text-sky-300 truncate max-w-[165px]" title="${asset.file_name || asset.asset_id} (${asset.file_path || asset.path})">
                    ${asset.file_name || asset.asset_id}
                  </span>
                  <span id="videoDurBadge_${idx}" class="${durBadgeClass}">
                    ${durBadgeText}
                  </span>
                </div>

                ${
                  isVideo
                    ? `
                    <div id="videoShortWarn_${idx}" class="${shortInfo.isTooShort ? '' : 'hidden '}px-2.5 py-1.5 rounded-lg bg-rose-600/25 border border-rose-500 text-rose-200 text-[11px] font-bold flex items-center gap-1.5 shadow-sm">
                      ${shortInfo.isTooShort ? buildVideoShortWarnText(shortInfo, durSec) : ''}
                    </div>
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <video src="${videoSrc}" controls playsinline preload="metadata" onloadedmetadata="checkVideoElementDuration(this, ${idx})" class="w-full h-full object-contain"></video>
                    </div>
                  `
                    : `
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <img src="${videoSrc}" class="w-full h-full object-cover" />
                    </div>
                  `
                }

                <div class="text-[9px] text-gray-400 font-mono truncate" title="projects/${activeProjectId}/public/${asset.path}">
                  📍 工程路径: projects/${activeProjectId}/public/${asset.path}
                </div>

                ${isVideo ? (() => {
                  const hasAudioTrack = asset.has_audio !== false;
                  const keepAudio = Boolean(scene.media_modifiers && scene.media_modifiers.keep_original_audio);
                  const audioVolPct = Math.round(((scene.media_modifiers && scene.media_modifiers.original_audio_volume !== undefined) ? scene.media_modifiers.original_audio_volume : 0.3) * 100);
                  if (!hasAudioTrack) {
                    return `
                      <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-gray-900/70 border border-gray-800 text-[10px] text-gray-500">
                        <span>🔇 该素材无音轨</span>
                      </div>
                    `;
                  }
                  return `
                    <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-gray-900/90 border border-sky-500/30 text-[10px]">
                      <label class="flex items-center gap-1.5 text-sky-200 font-semibold cursor-pointer select-none shrink-0">
                        <input type="checkbox" id="keepAudioCheck_${idx}" ${keepAudio ? 'checked' : ''}
                               onchange="updateSceneAudioOption(${idx})"
                               class="rounded border-gray-600 bg-gray-950 text-sky-500 focus:ring-0 cursor-pointer" />
                        <span>🔊 保留原声</span>
                      </label>
                      <div class="flex items-center gap-1.5 min-w-0 ${keepAudio ? '' : 'opacity-40 pointer-events-none'}">
                        <input type="range" id="keepAudioVol_${idx}" min="0" max="100" step="5" value="${audioVolPct}"
                               oninput="document.getElementById('keepAudioVolText_${idx}').textContent = this.value + '%'"
                               onchange="updateSceneAudioOption(${idx})"
                               class="w-16 accent-sky-400 cursor-pointer" />
                        <span id="keepAudioVolText_${idx}" class="font-mono text-sky-300 w-8 text-right shrink-0">${audioVolPct}%</span>
                      </div>
                    </div>
                  `;
                })() : ''}

                <div class="scene-asset-actions flex items-center justify-between pt-1 border-t border-gray-800/80 text-[10px]">
                  <button onclick="document.getElementById('fileInput_${idx}').click()" class="text-sky-400 hover:underline cursor-pointer">
                    选择替换本地文件
                  </button>
                  <button onclick="clearAsset(${idx})" class="text-rose-400 hover:underline cursor-pointer">
                    清除绑定
                  </button>
                </div>
              </div>
            </div>
          `;
        } else {
          td6.innerHTML = `
            <div class="space-y-2">
              ${linkHtml}
              ${step0KeywordsHtml}
              ${aiInputHtml}
              ${urlDownloadBarHtml}
              <button type="button" id="dropzone_${idx}"
                   class="w-full border-2 border-dashed border-sky-500/40 hover:border-sky-300 bg-sky-950/25 hover:bg-sky-900/35 rounded-xl p-2.5 text-center transition cursor-pointer group"
                   ondragover="onFileDragOver(event, ${idx})"
                   ondragleave="onFileDragLeave(event, ${idx})"
                   ondrop="onFileDrop(event, ${idx})"
                   onclick="document.getElementById('fileInput_${idx}').click()">
                <span class="block text-sky-300 text-lg mb-0.5 group-hover:scale-110 transition">📥</span>
                <span class="block text-[11px] font-bold text-sky-200">选择或拖入视频 / 图片</span>
                <span class="block text-[9px] text-gray-400 mt-0.5">或先在上方口令框指定秒数 ➔ 编译 ➔ 填 URL 下载</span>
              </button>
            </div>
          `;
        }

        const hiddenFile = document.createElement('input');
        hiddenFile.type = 'file';
        hiddenFile.id = 'fileInput_' + idx;
        hiddenFile.className = 'hidden';
        hiddenFile.accept = 'video/*,image/*';
        hiddenFile.onchange = (e) => uploadFileForRow(idx, e.target.files[0]);
        td6.appendChild(hiddenFile);

        // 7. 镜头节拍操作列 (加切点 / 挪切点 / 删切点)
        const td7 = document.createElement('td');
        td7.className = 'p-3 text-center';
        td7.innerHTML = `
          <div class="flex flex-col gap-1.5">
            <button type="button" onclick="openCutPickerForSplit(${idx})" class="w-full px-2 py-1.5 rounded-lg bg-purple-600/25 hover:bg-purple-600 border border-purple-500/40 text-purple-200 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm cursor-pointer" title="展开点字切画面面板，点任意字前新增换画面点">
              <span>✂️ 加切点</span>
            </button>
            ${
              idx > 0
                ? `<div class="grid grid-cols-2 gap-1">
                    <button type="button" onclick="nudgeCutPoint(${idx}, 'earlier')" class="px-1 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white text-[10px] font-bold transition cursor-pointer" title="把本画面切入点往前挪（上一句话没说完就切入本画面）">
                      ⏪提前换
                    </button>
                    <button type="button" onclick="nudgeCutPoint(${idx}, 'later')" class="px-1 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white text-[10px] font-bold transition cursor-pointer" title="把本画面切入点往后挪">
                      ⏩推迟换
                    </button>
                  </div>`
                : ''
            }
            ${
              idx < (manifestData.scenes.length - 1)
                ? `<button type="button" onclick="mergeShotWithNext(${idx})" class="w-full px-2 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm cursor-pointer" title="删掉与下一镜头之间的切点，合并成一个画面">
                    <span>🔗 删切点</span>
                  </button>`
                : ''
            }
          </div>
        `;

        const tdVisual = isAi ? td5 : td6;
        [td1, td2, td4, tdVisual, td7].forEach((cell, column) => {
          cell.setAttribute('role', 'cell');
          if (SCENE_FIELD_LABELS[column]) {
            const label = document.createElement('span');
            label.className = 'scene-field-label';
            label.setAttribute('aria-hidden', 'true');
            label.textContent = SCENE_FIELD_LABELS[column];
            cell.prepend(label);
          }
          tr.appendChild(cell);
        });
        return tr;
    }

    function rerenderSceneRow(idx) {
      if (window._voiceInputState && window._voiceInputState.activeIdx === idx && typeof cancelActiveVoiceInput === 'function') {
        cancelActiveVoiceInput(false);
      }
      const scene = manifestData?.scenes?.[idx];
      const tbody = document.getElementById('tableBody');
      if (!scene || !tbody) return renderTable();
      window._pendingDownloadUrls = window._pendingDownloadUrls || {};
      const existingInp = document.getElementById('urlDownloadInput_' + idx);
      if (existingInp && existingInp.value.trim()) {
        window._pendingDownloadUrls[idx] = existingInp.value.trim();
      }
      const existingRow = tbody.querySelector('tr[data-scene-idx="' + idx + '"]') || tbody.children[idx];
      if (!existingRow) return renderTable();
      const listEl = document.getElementById('producerSceneList');
      const savedScrollTop = listEl ? listEl.scrollTop : 0;
      const savedScrollLeft = listEl ? listEl.scrollLeft : 0;
      const savedWinX = window.scrollX;
      const savedWinY = window.scrollY;
      const newRow = buildSceneRow(scene, idx);
      existingRow.replaceWith(newRow);
      updateCounters();
      const restoreScroll = () => {
        if (listEl) {
          listEl.scrollTop = savedScrollTop;
          listEl.scrollLeft = savedScrollLeft;
        }
        if (window.scrollX !== savedWinX || window.scrollY !== savedWinY) {
          window.scrollTo(savedWinX, savedWinY);
        }
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    }

    function renderEmptyProducerState(msg) {
      const tbody = document.getElementById('tableBody');
      if (!tbody) return;
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'p-10 text-center space-y-3';
      td.innerHTML = `
        <div class="text-sm font-bold text-amber-300">📭 暂无视觉分镜镜头</div>
        <p class="text-xs text-gray-400 max-w-lg mx-auto leading-relaxed">${escapeHtml(msg || '当前工程尚未生成镜头清单，请先前往文案创作台完成文案并同步至制作台。')}</p>
        <div class="pt-1">
          <button type="button" onclick="switchWorkspaceTab('writer')" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow transition cursor-pointer">
            ✍️ 前往文案创作台准备并流转分镜
          </button>
        </div>
      `;
      tr.appendChild(td);
      tbody.replaceChildren(tr);
    }

    function renderTable() {
      if (typeof cancelActiveVoiceInput === 'function') {
        cancelActiveVoiceInput(false);
      }
      updateCounters();
      window._pendingDownloadUrls = window._pendingDownloadUrls || {};
      if (manifestData && Array.isArray(manifestData.scenes)) {
        manifestData.scenes.forEach((_, i) => {
          const existingInp = document.getElementById('urlDownloadInput_' + i);
          if (existingInp && existingInp.value.trim()) {
            window._pendingDownloadUrls[i] = existingInp.value.trim();
          }
        });
      }
      if (!Array.isArray(manifestData?.scenes) || manifestData.scenes.length === 0) {
        renderEmptyProducerState();
        return;
      }
      const listEl = document.getElementById('producerSceneList');
      const savedScrollTop = listEl ? listEl.scrollTop : 0;
      const savedScrollLeft = listEl ? listEl.scrollLeft : 0;
      const savedWinX = window.scrollX;
      const savedWinY = window.scrollY;
      const tbody = document.getElementById('tableBody');
      const frag = document.createDocumentFragment();
      (manifestData?.scenes || []).forEach((scene, idx) => {
        frag.appendChild(buildSceneRow(scene, idx));
      });
      tbody.replaceChildren(frag);
      const restoreScroll = () => {
        if (listEl) {
          listEl.scrollTop = savedScrollTop;
          listEl.scrollLeft = savedScrollLeft;
        }
        if (window.scrollX !== savedWinX || window.scrollY !== savedWinY) {
          window.scrollTo(savedWinX, savedWinY);
        }
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    }

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
      }
    }

    const GITHUB_COPY_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
    const GITHUB_CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

    function buildStep0BestKeywordHtml(idx, bestKw) {
      const kw = String(bestKw || '').trim();
      if (!kw) {
        return `
          <div class="flex items-center justify-between gap-1 text-[9px] text-cyan-300 font-bold">
            <span>🔎 Step 0 · 最佳搜索词</span>
            <button type="button" id="kwGenBtn_${idx}" onclick="extractSearchKeywordsForRow(${idx})"
              class="px-2 py-0.5 rounded bg-cyan-900/70 hover:bg-cyan-700 text-cyan-100 border border-cyan-500/40 font-bold text-[9px] cursor-pointer transition shrink-0">
              ✨ AI 提炼
            </button>
          </div>
        `;
      }
      const safeKw = escapeHtml(kw);
      const encodedKw = encodeURIComponent(kw);
      return `
        <div class="flex items-center gap-1 text-[10px]">
          <span class="text-[9px] text-cyan-300 font-bold shrink-0" title="Step 0 · AI 唯一最佳搜索词">🔎</span>
          <div class="flex-1 min-w-0 flex items-center justify-between rounded-md border border-cyan-500/50 bg-cyan-950/40 overflow-hidden">
            <span class="px-2 py-0.5 text-cyan-100 font-bold truncate" title="${safeKw}">${safeKw}</span>
            <button type="button" onclick="copySearchKeyword(event, decodeURIComponent('${encodedKw}'), this)" title="复制最佳搜索词「${safeKw}」"
              class="px-1.5 py-1 border-l border-cyan-500/40 text-cyan-200 hover:text-white hover:bg-cyan-500/30 cursor-pointer flex items-center justify-center shrink-0 transition">
              ${GITHUB_COPY_SVG}
            </button>
          </div>
          <button type="button" id="kwGenBtn_${idx}" onclick="extractSearchKeywordsForRow(${idx}, { forceChange: true })" title="换一个不同的画面搜索词"
            class="px-1.5 py-0.5 rounded bg-gray-900 hover:bg-cyan-900/60 text-gray-300 hover:text-cyan-200 border border-gray-700 hover:border-cyan-500/40 font-bold text-[9px] cursor-pointer transition shrink-0">
            🔄 换一个
          </button>
        </div>
      `;
    }

    async function copySearchKeyword(e, kw, btnEl) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const text = String(kw || '').trim();
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if (btnEl) {
          btnEl.innerHTML = GITHUB_CHECK_SVG;
          btnEl.classList.add('text-emerald-400');
          setTimeout(() => {
            btnEl.innerHTML = GITHUB_COPY_SVG;
            btnEl.classList.remove('text-emerald-400');
          }, 1500);
        }
        showToast('📋 已复制搜索词：' + text);
      } catch (err) {
        showToast('⚠️ 复制失败，请手动选中复制');
      }
    }

    async function extractSearchKeywordsForRow(idx, { silent = false, forceChange = false } = {}) {
      const scene = manifestData?.scenes?.[idx];
      if (!scene) return false;
      const btn = document.getElementById('kwGenBtn_' + idx);
      const prevKw = scene.selected_search_keyword || (scene.search_keyword_candidates && scene.search_keyword_candidates[0]) || '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳...';
      }
      try {
        const keywordModel = (document.getElementById('currentKeywordModelInput')?.value || visualConfig.keywordModel || visualConfig.textModel || '').trim();
        const res = await fetch('/api/extract-search-keywords?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            narrationText: scene.narration_text || '',
            chapterRef: scene.chapter_ref || '',
            keywordModel,
            excludeKeyword: forceChange ? prevKw : '',
            persist: true,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          if (!silent) showToast('❌ 搜索词提炼失败：' + (data.error || '未知错误'));
          if (btn) {
            btn.disabled = false;
            btn.textContent = prevKw ? '🔄 换一个' : '✨ AI 提炼';
          }
          return false;
        }
        const bestKw = data.keyword || (data.keywords && data.keywords[0]) || '';
        scene.selected_search_keyword = bestKw;
        scene.search_keyword_candidates = bestKw ? [bestKw] : [];
        const wrap = document.getElementById('step0KwWrap_' + idx);
        if (wrap) {
          wrap.innerHTML = buildStep0BestKeywordHtml(idx, bestKw);
        }
        if (!silent) showToast('✅ 最佳搜索词：' + bestKw);
        return true;
      } catch (err) {
        if (!silent) showToast('❌ 搜索词提炼请求出错：' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevKw ? '🔄 换一个' : '✨ AI 提炼';
        }
        return false;
      }
    }

    let _batchKeywordRunning = false;
    let _batchKeywordAbort = false;

    async function batchExtractAllSearchKeywords() {
      const btn = document.getElementById('btnBatchExtractKeywords');
      if (_batchKeywordRunning) {
        _batchKeywordAbort = true;
        if (btn) btn.textContent = '⏳ 正在停止...';
        return;
      }
      const scenes = manifestData?.scenes || [];
      if (scenes.length === 0) {
        showToast('当前工程没有镜头');
        return;
      }
      let targetIndices = scenes
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !Array.isArray(s.search_keyword_candidates) || s.search_keyword_candidates.length === 0)
        .map(({ i }) => i);

      if (targetIndices.length === 0) {
        if (!confirm('全部 ' + scenes.length + ' 个镜头已有关键词，是否全部重新提炼？')) return;
        targetIndices = scenes.map((_, i) => i);
      }

      _batchKeywordRunning = true;
      _batchKeywordAbort = false;
      let done = 0;
      let okCount = 0;
      const total = targetIndices.length;
      const updateBtn = () => {
        if (btn) btn.textContent = '⏹️ 停止提炼 (' + done + '/' + total + ')';
      };
      updateBtn();

      const concurrency = 3;
      let cursor = 0;
      const worker = async () => {
        while (cursor < targetIndices.length && !_batchKeywordAbort) {
          const idx = targetIndices[cursor++];
          const ok = await extractSearchKeywordsForRow(idx, { silent: true });
          done++;
          if (ok) okCount++;
          updateBtn();
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, targetIndices.length) }, () => worker()));

      const wasAborted = _batchKeywordAbort;
      _batchKeywordRunning = false;
      _batchKeywordAbort = false;
      if (btn) btn.textContent = '✨ 批量提炼全部镜头关键词';
      showToast(wasAborted ? ('⏹️ 已停止，完成 ' + okCount + '/' + done + ' 个镜头') : ('🎉 批量提炼完成：成功 ' + okCount + '/' + total + ' 个镜头'));
      if (!wasAborted) {
        showCompletionModal({
          icon: '🔎',
          title: '批量提炼镜头关键词已完成',
          message: '成功提炼 ' + okCount + '/' + total + ' 个镜头的最佳搜索词。',
          detail: okCount < total
            ? ('有 ' + (total - okCount) + ' 个镜头失败，可在对应镜头行点击「✨ AI 提炼」重试。')
            : '全部镜头均已就绪，可直接复制搜索词检索素材。',
        });
      }
    }

    window._voiceInputState = window._voiceInputState || {
      phase: 'idle',
      activeIdx: null,
      engine: null,
      starting: false,
      mediaRecorder: null,
      mediaStream: null,
      chunks: [],
      startedAt: 0,
      timerId: null,
      maxStopTimerId: null,
      recognition: null,
      baseValue: '',
      latestTranscript: '',
      cancelled: false,
      finishPromise: null,
      resolveFinish: null,
    };

    if (!window._voiceGlobalListenersBound) {
      window._voiceGlobalListenersBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window._voiceInputState?.phase === 'recording') {
          cancelActiveVoiceInput(true);
        }
      });
      window.addEventListener('beforeunload', () => {
        if (typeof cancelActiveVoiceInput === 'function') {
          cancelActiveVoiceInput(false);
        }
      });
    }

    async function fetchVoiceSttCapabilities() {
      if (window._voiceSttCaps) return window._voiceSttCaps;
      try {
        const res = await fetch('/api/voice-input/status');
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.localWhisperAvailable === 'boolean') {
            window._voiceSttCaps = data;
            return data;
          }
        }
      } catch (e) {}
      return { localWhisperAvailable: false };
    }

    function formatVoiceElapsed(ms) {
      const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return m + ':' + String(s).padStart(2, '0');
    }

    function joinVoiceText(baseText, spokenText) {
      const base = String(baseText || '');
      const spoken = String(spokenText || '').trim();
      if (!spoken) return base;
      const trimmedBase = base.trimEnd();
      if (!trimmedBase) return spoken;
      if (/[\s，,。；;、：:！!？?]$/.test(trimmedBase)) {
        return trimmedBase + spoken;
      }
      return trimmedBase + '，' + spoken;
    }

    function setVoiceRowUi(idx, mode, btnLabel = '', statusText = '') {
      if (idx === null || idx === undefined) return;
      const btn = document.getElementById('aiVoiceBtn_' + idx);
      const statusWrap = document.getElementById('aiVoiceStatus_' + idx);
      const statusEl = document.getElementById('aiVoiceStatusText_' + idx);

      if (btn) {
        if (mode === 'recording') {
          btn.disabled = false;
          btn.setAttribute('aria-pressed', 'true');
          btn.textContent = btnLabel || '⏹️ 0:00';
          btn.title = '点击结束录音并转为文字（按 Esc 取消）';
          btn.className = 'px-2 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1 voice-recording-pulse';
        } else if (mode === 'transcribing') {
          btn.disabled = true;
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = btnLabel || '⏳ 识别中';
          btn.title = '正在将录音转换为文字...';
          btn.className = 'px-2 py-1.5 rounded-lg bg-amber-600/80 border border-amber-400/70 text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-wait transition flex items-center gap-1 opacity-90';
        } else {
          btn.disabled = false;
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = '🎤 语音';
          btn.title = '点击开始语音输入口语指令（再次点击结束并转文字）';
          btn.className = 'px-2 py-1.5 rounded-lg bg-gray-900 hover:bg-rose-600/25 border border-sky-500/50 hover:border-rose-400/70 text-sky-200 hover:text-rose-100 font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1';
        }
      }

      if (statusWrap && statusEl) {
        if (mode === 'recording') {
          statusWrap.className = 'flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[10px] text-rose-200';
          statusEl.textContent = statusText || '🔴 正在录音... 说完后点红色按钮结束（Esc 取消）';
        } else if (mode === 'transcribing') {
          statusWrap.className = 'flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-amber-950/60 border border-amber-500/40 text-[10px] text-amber-200';
          statusEl.textContent = statusText || '⏳ 正在将语音转为文字...';
        } else {
          statusWrap.classList.add('hidden');
          statusEl.textContent = '';
        }
      }
    }

    function resetVoiceStateToIdle(idxToReset = null) {
      const st = window._voiceInputState;
      const targetIdx = idxToReset !== null ? idxToReset : st.activeIdx;
      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);
      if (st.mediaStream) {
        st.mediaStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }
      const resolver = st.resolveFinish;
      st.phase = 'idle';
      st.activeIdx = null;
      st.engine = null;
      st.mediaRecorder = null;
      st.mediaStream = null;
      st.chunks = [];
      st.startedAt = 0;
      st.timerId = null;
      st.maxStopTimerId = null;
      st.recognition = null;
      st.baseValue = '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = null;
      st.resolveFinish = null;
      if (targetIdx !== null && targetIdx !== undefined) {
        setVoiceRowUi(targetIdx, 'idle');
      }
      if (typeof resolver === 'function') {
        resolver();
      }
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取录音数据失败'));
        reader.readAsDataURL(blob);
      });
    }

    function insertVoiceTranscriptIntoInput(idx, transcript) {
      const cleanText = String(transcript || '').trim();
      if (!cleanText) return;
      const input = document.getElementById('aiIntentInput_' + idx);
      if (!input) return;
      const nextVal = joinVoiceText(input.value, cleanText);
      input.value = nextVal;
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(nextVal.length, nextVal.length);
      }
      input.classList.add('ring-2', 'ring-emerald-400');
      setTimeout(() => input.classList.remove('ring-2', 'ring-emerald-400'), 900);
      const preview = cleanText.length > 24 ? cleanText.slice(0, 24) + '...' : cleanText;
      showToast('🎙️ 已填入语音指令：「' + preview + '」（按回车或点「✨ 编译」）');
    }

    function cancelActiveVoiceInput(showNotice = false) {
      const st = window._voiceInputState;
      if (!st) return;
      const prevIdx = st.activeIdx;
      const prevEngine = st.engine;
      const prevBaseVal = st.baseValue;
      const prevRecorder = st.mediaRecorder;
      const prevStream = st.mediaStream;
      const prevRecognition = st.recognition;

      if (st.phase === 'idle' && !prevStream && !prevRecorder && !prevRecognition) {
        if (st.starting) {
          st.cancelled = true;
        }
        return;
      }

      st.cancelled = true;
      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);

      if (prevStream) {
        prevStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }
      if (prevRecorder && prevRecorder.state !== 'inactive') {
        try { prevRecorder.stop(); } catch (e) {}
      }
      if (prevRecognition) {
        try { prevRecognition.abort(); } catch (e) {}
      }
      if (prevEngine === 'web_speech' && prevIdx !== null && prevIdx !== undefined) {
        const input = document.getElementById('aiIntentInput_' + prevIdx);
        if (input) input.value = prevBaseVal;
      }

      resetVoiceStateToIdle(prevIdx);
      if (showNotice) {
        showToast('已取消语音输入');
      }
    }

    function stopAndFinishVoiceInput() {
      const st = window._voiceInputState;
      if (!st) return Promise.resolve();
      if (st.phase === 'transcribing') {
        return st.finishPromise || Promise.resolve();
      }
      if (st.phase !== 'recording') {
        return Promise.resolve();
      }

      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);
      st.timerId = null;
      st.maxStopTimerId = null;

      const waitPromise = st.finishPromise || Promise.resolve();
      if (st.engine === 'local_whisper' && st.mediaRecorder && st.mediaRecorder.state !== 'inactive') {
        try {
          st.mediaRecorder.stop();
        } catch (e) {
          cancelActiveVoiceInput(false);
          return Promise.resolve();
        }
      } else if (st.engine === 'web_speech' && st.recognition) {
        try {
          st.recognition.stop();
        } catch (e) {
          cancelActiveVoiceInput(false);
          return Promise.resolve();
        }
      } else {
        cancelActiveVoiceInput(false);
        return Promise.resolve();
      }
      return waitPromise;
    }

    function pickSupportedAudioMimeType() {
      if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
      }
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      for (const mime of candidates) {
        try {
          if (MediaRecorder.isTypeSupported(mime)) return mime;
        } catch (e) {}
      }
      return '';
    }

    async function startLocalWhisperVoiceInput(idx) {
      const st = window._voiceInputState;
      st.cancelled = false;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const errName = err?.name || '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          showToast('❌ 未获得麦克风权限，请在浏览器地址栏允许访问麦克风');
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          showToast('❌ 未检测到麦克风设备');
        } else {
          showToast('❌ 无法开启麦克风：' + (err?.message || '未知错误'));
        }
        return;
      }

      if (st.cancelled || !document.getElementById('aiVoiceBtn_' + idx)) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
        return;
      }

      const chosenMime = pickSupportedAudioMimeType();
      let recorder;
      try {
        recorder = chosenMime
          ? new MediaRecorder(stream, { mimeType: chosenMime })
          : new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
        showToast('❌ 浏览器不支持录音编码：' + (err?.message || '初始化失败'));
        return;
      }

      const input = document.getElementById('aiIntentInput_' + idx);
      let resolveFinishFn;
      const finishPromise = new Promise((resolve) => {
        resolveFinishFn = resolve;
      });

      st.phase = 'recording';
      st.activeIdx = idx;
      st.engine = 'local_whisper';
      st.mediaRecorder = recorder;
      st.mediaStream = stream;
      st.chunks = [];
      st.startedAt = Date.now();
      st.baseValue = input ? input.value : '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = finishPromise;
      st.resolveFinish = resolveFinishFn;

      setVoiceRowUi(
        idx,
        'recording',
        '⏹️ 0:00',
        '🔴 正在录音 (0:00)... 说完后点红色按钮结束（Esc 取消）'
      );

      st.timerId = setInterval(() => {
        if (st.phase !== 'recording' || st.activeIdx !== idx) return;
        const elapsed = formatVoiceElapsed(Date.now() - st.startedAt);
        setVoiceRowUi(
          idx,
          'recording',
          '⏹️ ' + elapsed,
          '🔴 正在录音 (' + elapsed + ')... 说完后点红色按钮结束（Esc 取消）'
        );
      }, 1000);

      st.maxStopTimerId = setTimeout(() => {
        if (st.phase === 'recording' && st.activeIdx === idx) {
          showToast('⏱️ 单次录音已达 60 秒上限，正在自动识别...');
          stopAndFinishVoiceInput();
        }
      }, 60000);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          st.chunks.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        clearInterval(st.timerId);
        clearTimeout(st.maxStopTimerId);
        st.timerId = null;
        st.maxStopTimerId = null;

        if (st.mediaStream) {
          st.mediaStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
          st.mediaStream = null;
        }

        const wasCancelled = st.cancelled;
        const elapsedMs = Date.now() - st.startedAt;
        const chunksCopy = st.chunks.slice();
        const mimeType = recorder.mimeType || chosenMime || 'audio/webm';
        st.mediaRecorder = null;
        st.chunks = [];

        if (wasCancelled) {
          resetVoiceStateToIdle(idx);
          return;
        }

        if (elapsedMs < 350 || chunksCopy.length === 0) {
          resetVoiceStateToIdle(idx);
          showToast('录音时间过短，请再试一次');
          return;
        }

        const blob = new Blob(chunksCopy, { type: mimeType });
        if (!blob || blob.size === 0) {
          resetVoiceStateToIdle(idx);
          showToast('未录到有效声音，请重试');
          return;
        }

        st.phase = 'transcribing';
        setVoiceRowUi(idx, 'transcribing', '⏳ 识别中', '⏳ 正在将语音转为文字...');

        try {
          const dataUrl = await blobToDataUrl(blob);
          if (st.cancelled) {
            resetVoiceStateToIdle(idx);
            return;
          }

          const res = await fetch('/api/transcribe-voice?project=' + encodeURIComponent(activeProjectId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              mimeType: blob.type || mimeType,
              language: 'zh',
            }),
          });
          const data = await res.json();
          if (st.cancelled) {
            resetVoiceStateToIdle(idx);
            return;
          }
          if (!res.ok || !data.ok) {
            throw new Error(data.error || '语音识别失败');
          }

          const transcript = String(data.text || '').trim();
          resetVoiceStateToIdle(idx);
          if (data.silent || !transcript) {
            showToast('未检测到清晰语音，请靠近麦克风重试');
          } else {
            insertVoiceTranscriptIntoInput(idx, transcript);
          }
        } catch (err) {
          const wasCanceledDuringFetch = st.cancelled;
          resetVoiceStateToIdle(idx);
          if (!wasCanceledDuringFetch) {
            showToast('❌ 语音识别失败：' + (err?.message || '请稍后重试'));
          }
        }
      };

      try {
        recorder.start(250);
      } catch (err) {
        resetVoiceStateToIdle(idx);
        showToast('❌ 启动录音失败：' + (err?.message || '未知错误'));
      }
    }

    function startWebSpeechVoiceInput(idx) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) return false;

      const st = window._voiceInputState;
      const input = document.getElementById('aiIntentInput_' + idx);
      const recognition = new SpeechRec();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;

      let resolveFinishFn;
      const finishPromise = new Promise((resolve) => {
        resolveFinishFn = resolve;
      });

      st.phase = 'recording';
      st.activeIdx = idx;
      st.engine = 'web_speech';
      st.recognition = recognition;
      st.startedAt = Date.now();
      st.baseValue = input ? input.value : '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = finishPromise;
      st.resolveFinish = resolveFinishFn;

      setVoiceRowUi(
        idx,
        'recording',
        '⏹️ 0:00',
        '🔴 正在实时听写 (0:00)... 说完后点红色按钮结束（Esc 取消）'
      );

      st.timerId = setInterval(() => {
        if (st.phase !== 'recording' || st.activeIdx !== idx) return;
        const elapsed = formatVoiceElapsed(Date.now() - st.startedAt);
        setVoiceRowUi(
          idx,
          'recording',
          '⏹️ ' + elapsed,
          '🔴 正在实时听写 (' + elapsed + ')... 说完后点红色按钮结束（Esc 取消）'
        );
      }, 1000);

      st.maxStopTimerId = setTimeout(() => {
        if (st.phase === 'recording' && st.activeIdx === idx) {
          stopAndFinishVoiceInput();
        }
      }, 60000);

      let hadFatalError = false;
      recognition.onresult = (event) => {
        if (st.cancelled) return;
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const resItem = event.results[i];
          const textPart = resItem[0]?.transcript || '';
          if (resItem.isFinal) {
            finalText += textPart;
          } else {
            interimText += textPart;
          }
        }
        st.latestTranscript = (finalText + interimText).trim();
        const curInput = document.getElementById('aiIntentInput_' + idx);
        if (curInput) {
          curInput.value = joinVoiceText(st.baseValue, st.latestTranscript);
        }
      };

      recognition.onerror = (event) => {
        const code = event?.error || '';
        if (code === 'aborted' && st.cancelled) return;
        hadFatalError = true;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          showToast('❌ 未获得麦克风权限，请在浏览器地址栏允许访问麦克风');
        } else if (code === 'audio-capture') {
          showToast('❌ 未检测到可用麦克风设备');
        } else if (code === 'no-speech') {
          showToast('未检测到语音，请靠近麦克风重试');
        } else if (code === 'network') {
          showToast('❌ 浏览器语音识别网络异常，请检查网络或确认本机 Whisper 可用');
        } else {
          showToast('❌ 语音识别出错：' + (code || '未知错误'));
        }
      };

      recognition.onend = () => {
        const wasCancelled = st.cancelled;
        const spoken = String(st.latestTranscript || '').trim();
        const curInput = document.getElementById('aiIntentInput_' + idx);
        if (wasCancelled) {
          if (curInput) curInput.value = st.baseValue;
          resetVoiceStateToIdle(idx);
          return;
        }
        if (curInput && spoken) {
          const finalVal = joinVoiceText(st.baseValue, spoken);
          curInput.value = finalVal;
          curInput.focus();
          if (typeof curInput.setSelectionRange === 'function') {
            curInput.setSelectionRange(finalVal.length, finalVal.length);
          }
          curInput.classList.add('ring-2', 'ring-emerald-400');
          setTimeout(() => curInput.classList.remove('ring-2', 'ring-emerald-400'), 900);
          const preview = spoken.length > 24 ? spoken.slice(0, 24) + '...' : spoken;
          showToast('🎙️ 已填入语音指令：「' + preview + '」（按回车或点「✨ 编译」）');
        } else if (!hadFatalError) {
          showToast('未检测到清晰语音，请靠近麦克风重试');
        }
        resetVoiceStateToIdle(idx);
      };

      try {
        recognition.start();
        return true;
      } catch (err) {
        resetVoiceStateToIdle(idx);
        showToast('❌ 启动浏览器语音识别失败：' + (err?.message || '未知错误'));
        return false;
      }
    }

    async function toggleVoiceInputForRow(idx) {
      const st = window._voiceInputState;
      if (st.starting) return;
      if (st.phase === 'transcribing') {
        showToast('⏳ 语音识别进行中，请稍候...');
        return;
      }
      if (st.phase === 'recording') {
        if (st.activeIdx === idx) {
          await stopAndFinishVoiceInput();
          return;
        }
        cancelActiveVoiceInput(false);
      }

      st.starting = true;
      try {
        const caps = await fetchVoiceSttCapabilities();
        const canLocalWhisper = Boolean(
          caps?.localWhisperAvailable &&
          navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
        );

        if (canLocalWhisper) {
          await startLocalWhisperVoiceInput(idx);
          return;
        }

        if (window.SpeechRecognition || window.webkitSpeechRecognition) {
          startWebSpeechVoiceInput(idx);
          return;
        }

        showToast(
          !window.isSecureContext
            ? '⚠️ 当前页面非安全上下文，请通过 http://localhost:4000 打开工作台后再使用语音输入'
            : '⚠️ 当前浏览器不支持麦克风录音或语音识别，请使用最新版 Chrome / Edge / Safari'
        );
      } finally {
        st.starting = false;
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

    function getProjectNarrationAudioUrl() {
      if (window.timingSummaryData && window.timingSummaryData.audio_url) {
        return window.timingSummaryData.audio_url;
      }
      if (manifestData && manifestData.audio_file) {
        return '/public/' + activeProjectId + '/' + manifestData.audio_file;
      }
      return null;
    }

    function updateShotPlayButtonsUI() {
      const scenes = manifestData?.scenes || [];
      for (let i = 0; i < scenes.length; i++) {
        const btn = document.getElementById('btnPlayShotAudio_' + i);
        if (!btn) continue;
        const active = window._playingShotIdx === i;
        btn.textContent = active ? '⏹️ 停止' : '🔊 试听';
        btn.className = 'px-1.5 py-0.5 rounded ' +
          (active ? 'bg-rose-600 text-white border-rose-400' : 'bg-emerald-600/25 hover:bg-emerald-600/45 text-emerald-200 border-emerald-500/40') +
          ' border text-[9px] font-bold transition cursor-pointer shadow-sm';
      }
    }

    function togglePlayShotNarration(idx) {
      const scenes = manifestData?.scenes || [];
      const scene = scenes[idx];
      if (!scene) return;
      const audioUrl = getProjectNarrationAudioUrl();
      if (!audioUrl) {
        alert('当前工程尚未生成或检测到旁白配音文件');
        return;
      }
      const wrap = document.getElementById('mainNarrationAudioWrap');
      const player = document.getElementById('mainNarrationAudioPlayer');
      if (!player) return;
      if (wrap) wrap.classList.remove('hidden');

      const absTarget = new URL(audioUrl, location.href).href;
      if (player.src !== absTarget) {
        player.src = audioUrl;
      }

      if (window._shotStopHandler) {
        player.removeEventListener('timeupdate', window._shotStopHandler);
        window._shotStopHandler = null;
      }

      // 如果正在播放当前镜头，点击则停止
      if (window._playingShotIdx === idx && !player.paused) {
        player.pause();
        window._playingShotIdx = null;
        updateShotPlayButtonsUI();
        return;
      }

      const startSec = Math.max(0, (Number(scene.start_ms) || 0) / 1000);
      const endSec = Math.max(startSec + 0.3, (Number(scene.end_ms) || 0) / 1000);
      window._playingShotIdx = idx;
      updateShotPlayButtonsUI();

      window._shotStopHandler = () => {
        if (player.currentTime >= endSec) {
          player.pause();
          if (window._shotStopHandler) {
            player.removeEventListener('timeupdate', window._shotStopHandler);
            window._shotStopHandler = null;
          }
          window._playingShotIdx = null;
          updateShotPlayButtonsUI();
        }
      };
      player.addEventListener('timeupdate', window._shotStopHandler);
      player.onpause = () => {
        if (player.currentTime >= endSec - 0.05 || player.ended) {
          window._playingShotIdx = null;
          updateShotPlayButtonsUI();
        }
      };

      const startPlay = () => {
        try {
          player.currentTime = startSec;
        } catch (e) {}
        player.play().catch((err) => {
          console.warn('播放失败:', err);
          window._playingShotIdx = null;
          updateShotPlayButtonsUI();
        });
      };

      if (player.readyState >= 1) {
        startPlay();
      } else {
        player.addEventListener('loadedmetadata', startPlay, { once: true });
        player.load();
      }
    }

    function renderTimingSummaryBadge(summary) {
      const badge = document.getElementById('timingStatusBadge');
      const rhythmEl = document.getElementById('timingRhythmBadge');
      const audioWrap = document.getElementById('mainNarrationAudioWrap');
      const audioPlayer = document.getElementById('mainNarrationAudioPlayer');
      if (!badge) return;
      if (audioWrap && audioPlayer) {
        const url = (summary && summary.audio_url) || (manifestData && manifestData.audio_file ? ('/public/' + activeProjectId + '/' + manifestData.audio_file) : null);
        if (url && ((summary && summary.has_audio_file) || (manifestData && manifestData.audio_file))) {
          audioWrap.classList.remove('hidden');
          const absUrl = new URL(url, location.href).href;
          if (audioPlayer.src !== absUrl) {
            audioPlayer.src = url;
          }
        } else {
          audioWrap.classList.add('hidden');
        }
      }
      if (!summary) {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 font-semibold';
        badge.textContent = '📐 时间轴：按字数估算';
        if (rhythmEl) rhythmEl.classList.add('hidden');
        return;
      }
      if (summary.available && !summary.stale) {
        const mLabel = summary.method === 'whisper' ? 'Whisper 逐字对齐' : '音频停顿对齐';
        const sec = ((summary.audio_duration_ms || 0) / 1000).toFixed(1);
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold';
        badge.textContent = '🎙️ 已对齐真实配音（' + mLabel + ' · ' + sec + 's）';
      } else if (summary.available && summary.stale) {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold';
        badge.textContent = '⚠️ 文案变动，旧时间轴已过期（请重新生成全片旁白）';
      } else if (summary.has_audio_file) {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 font-semibold';
        badge.textContent = '🎧 已检测到配音 (' + (summary.audio_file_name || '音频') + ')，点击右侧智能排切自动对齐';
      } else {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 font-semibold';
        badge.textContent = '📐 时间轴：按字数估算（先生成 Voicebox 配音即可按真实时间切画面）';
      }

      if (rhythmEl) {
        const r = summary.rhythm;
        if (r && r.shots > 1) {
          const sentPct = Math.round((r.sentence_end_cut_ratio || 0) * 100);
          const midPct = Math.round((r.mid_sentence_cut_ratio || 0) * 100);
          const warns = Array.isArray(r.warnings) ? r.warnings : [];
          rhythmEl.classList.remove('hidden');
          if (warns.length) {
            rhythmEl.className = 'px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300';
            rhythmEl.textContent = '⚠️ ' + warns[0] + '（句末切 ' + sentPct + '% · 句中切 ' + midPct + '%）';
          } else {
            rhythmEl.className = 'px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200';
            rhythmEl.textContent = '🎞️ 节奏自然（句末切 ' + sentPct + '% · 句中切 ' + midPct + '%）';
          }
        } else {
          rhythmEl.classList.add('hidden');
        }
      }
    }

    async function autoPlanProjectCuts() {
      const btn = document.getElementById('btnAutoPlanCuts');
      const progWrap = document.getElementById('autoPlanCutsProgressWrap');
      const progBar = document.getElementById('autoPlanCutsProgressBar');
      const progText = document.getElementById('autoPlanCutsProgressText');
      const progPct = document.getElementById('autoPlanCutsProgressPct');
      const setCutProgUi = (pct, msg) => {
        const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
        if (progWrap) progWrap.classList.remove('hidden');
        if (progBar) progBar.style.width = safePct + '%';
        if (progPct) progPct.textContent = safePct + '%';
        if (progText && msg) progText.textContent = msg;
      };

      const jobId = 'cut_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在按关键词/停顿排切点...';
      }
      setCutProgUi(3, '正在启动智能排切...');

      const pollTimer = setInterval(async () => {
        try {
          const pr = await fetch('/api/auto-plan-cuts-progress?jobId=' + encodeURIComponent(jobId));
          const pj = await pr.json();
          if (pj && pj.ok && typeof pj.percent === 'number') {
            setCutProgUi(pj.percent, pj.text || '正在排切点...');
          }
        } catch (e) {}
      }, 300);

      try {
        const res = await fetch('/api/auto-plan-cuts?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            jobId,
            autoSplitLongShots: true,
            useAiKeywords: true,
          }),
        });
        clearInterval(pollTimer);
        const data = await res.json();
        if (data.ok) {
          setCutProgUi(100, data.message || '智能排切完成！');
          manifestData = data.manifest;
          if (data.timingSummary) {
            window.timingSummaryData = data.timingSummary;
            renderTimingSummaryBadge(data.timingSummary);
          }
          renderTable();
          showToast('⚡ ' + data.message);
          const scenesCount = manifestData?.scenes?.length || 0;
          const rhythm = data.timingSummary?.rhythm;
          const rhythmTip = (rhythm && rhythm.shots > 1)
            ? ('（句末切 ' + Math.round((rhythm.sentence_end_cut_ratio || 0) * 100) + '% · 句中切 ' + Math.round((rhythm.mid_sentence_cut_ratio || 0) * 100) + '%）')
            : '';
          showCompletionModal({
            icon: '⚡',
            title: '按关键词/停顿智能排切点已完成',
            message: data.message || '已按关键词与停顿完成智能排切！',
            detail: '当前共 ' + scenesCount + ' 个分镜镜头' + rhythmTip + '。',
          });
          setTimeout(() => {
            if (progWrap) progWrap.classList.add('hidden');
          }, 1800);
        } else {
          if (progWrap) progWrap.classList.add('hidden');
          alert(data.error || '智能排切失败');
        }
      } catch (err) {
        clearInterval(pollTimer);
        if (progWrap) progWrap.classList.add('hidden');
        alert('智能排切出错: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '⚡ 按关键词/停顿智能排切点';
        }
      }
    }

    function toggleCharCutPicker(idx, forceOpen = null) {
      window._openCutPickers = window._openCutPickers || {};
      const next = forceOpen === null ? !window._openCutPickers[idx] : Boolean(forceOpen);
      window._openCutPickers[idx] = next;
      const box = document.getElementById('charCutPicker_' + idx);
      if (box) {
        box.classList.toggle('hidden', !next);
        if (next) box.innerHTML = buildCharCutPickerInner(idx);
      }
      // 更新按钮文案
      const row = box ? box.closest('td') : null;
      const toggleBtn = row ? row.querySelector('button[onclick*="toggleCharCutPicker"]') : null;
      if (toggleBtn) toggleBtn.textContent = next ? '▲ 收起切点面板' : '👆 点字切画面 / 挪切点';
    }

    function openCutPickerForSplit(idx) {
      toggleCharCutPicker(idx, true);
      const box = document.getElementById('charCutPicker_' + idx);
      if (box && box.scrollIntoView) {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function buildCharCutPickerInner(idx) {
      const scenes = manifestData?.scenes || [];
      const cur = scenes[idx];
      if (!cur) return '';
      const currText = String(cur.narration_text || '');
      let html = '';

      if (idx > 0 && scenes[idx - 1]) {
        const prevText = String(scenes[idx - 1].narration_text || '');
        const tailStart = Math.max(0, prevText.length - 28);
        let prevCharsHtml = '';
        if (tailStart > 0) prevCharsHtml += '<span class="text-gray-500 px-0.5">…</span>';
        for (let i = tailStart; i < prevText.length; i++) {
          const ch = prevText[i];
          if (!ch.trim()) continue;
          if (i === 0) {
            prevCharsHtml += '<span class="px-0.5 text-gray-500">' + escapeHtml(ch) + '</span>';
          } else {
            prevCharsHtml += '<button type="button" onclick="moveCutToPrevChar(' + idx + ', ' + i + ')" title="点击后，从「' + escapeHtml(ch) + '」开始提前切到本画面" class="px-1 py-0.5 rounded hover:bg-indigo-600 hover:text-white text-indigo-200 bg-indigo-950/60 border border-indigo-500/20 text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
          }
        }

        const headEnd = Math.min(currText.length, 28);
        let currHeadHtml = '';
        for (let i = 0; i < headEnd; i++) {
          const ch = currText[i];
          if (!ch.trim()) continue;
          if (i === 0) {
            currHeadHtml += '<span class="px-0.5 text-gray-500">' + escapeHtml(ch) + '</span>';
          } else {
            currHeadHtml += '<button type="button" onclick="moveCutToCurrChar(' + idx + ', ' + i + ')" title="点击后，把「' + escapeHtml(ch) + '」之前的字退回上一画面" class="px-1 py-0.5 rounded hover:bg-sky-600 hover:text-white text-sky-200 bg-sky-950/60 border border-sky-500/20 text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
          }
        }
        if (headEnd < currText.length) currHeadHtml += '<span class="text-gray-500 px-0.5">…</span>';

        html += '<div class="space-y-1 pb-2 border-b border-gray-800">' +
          '<div class="text-[10px] font-bold text-indigo-300">⬅️ 挪动换画面点（点哪个字，本画面就从这个字开始，不增减镜头）：</div>' +
          '<div class="flex flex-wrap items-center gap-0.5 leading-relaxed">' +
            prevCharsHtml +
            '<span class="px-1.5 py-0.5 mx-1 rounded bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[10px] font-black">｜当前切点</span>' +
            currHeadHtml +
          '</div>' +
        '</div>';
      }

      let splitCharsHtml = '';
      for (let i = 0; i < currText.length; i++) {
        const ch = currText[i];
        if (!ch.trim()) continue;
        if (i === 0) {
          splitCharsHtml += '<span class="px-0.5 text-gray-500 text-[11px]">' + escapeHtml(ch) + '</span>';
        } else {
          splitCharsHtml += '<button type="button" onclick="splitShotAtChar(' + idx + ', ' + i + ')" title="点击后，在「' + escapeHtml(ch) + '」前面新增一个换画面点" class="px-1 py-0.5 rounded hover:bg-purple-600 hover:text-white text-gray-200 bg-gray-950 border border-gray-700/80 text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
        }
      }

      html += '<div class="space-y-1">' +
        '<div class="flex flex-wrap items-center justify-between gap-1">' +
          '<span class="text-[10px] font-bold text-purple-300">✂️ 新增换画面点（点哪个字，就在那个字前切出新镜头）：</span>' +
          '<button type="button" onclick="quickAutoSplitShot(' + idx + ')" class="px-1.5 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white border border-purple-500/40 text-[10px] font-bold cursor-pointer transition">⚡ 在逗号处自动一分为二</button>' +
        '</div>' +
        '<div class="flex flex-wrap items-center gap-0.5 leading-relaxed">' + splitCharsHtml + '</div>' +
      '</div>';

      return html;
    }

    async function splitShotAtChar(idx, splitCharIndex) {
      const res = await fetch('/api/split-shot?project=' + encodeURIComponent(activeProjectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          splitCharIndex,
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
        showToast('✂️ ' + data.message);
      } else {
        alert(data.error || '切分失败');
      }
    }

    async function quickAutoSplitShot(idx) {
      return splitShotAtChar(idx, undefined);
    }

    async function moveCutToPrevChar(idx, splitInPrevAtChar) {
      const res = await fetch('/api/move-cut?project=' + encodeURIComponent(activeProjectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          mode: 'move_between',
          splitInPrevAtChar,
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
        showToast('⬅️ ' + data.message);
      } else {
        alert(data.error || '挪动切点失败');
      }
    }

    async function moveCutToCurrChar(idx, splitInCurrAtChar) {
      const res = await fetch('/api/move-cut?project=' + encodeURIComponent(activeProjectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          mode: 'move_between',
          splitInCurrAtChar,
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
        showToast('➡️ ' + data.message);
      } else {
        alert(data.error || '挪动切点失败');
      }
    }

    async function nudgeCutPoint(idx, step) {
      const res = await fetch('/api/move-cut?project=' + encodeURIComponent(activeProjectId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          mode: 'move_between',
          step,
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
        showToast((step === 'earlier' ? '⏪ ' : '⏩ ') + data.message);
      } else {
        alert(data.error || '挪动切点失败');
      }
    }

    async function splitShotPrompt(idx) {
      openCutPickerForSplit(idx);
    }

    async function mergeShotWithNext(idx) {
      const s1 = manifestData.scenes[idx];
      const s2 = manifestData.scenes[idx + 1];
      if (!confirm(`确认删掉 ${s1.scene_id} 与 ${s2.scene_id} 之间的换画面点，合并为一个镜头吗？\n合并后总时长约为 ${((s1.duration_ms + s2.duration_ms)/1000).toFixed(1)} 秒。`)) {
        return;
      }

      const res = await fetch('/api/merge-shot?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
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
        showToast('🔗 ' + data.message);
      } else {
        alert(data.error || '合并失败');
      }
    }

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

    function extractLocalSmartPrompt(narrationText, targetMode, keywords, templateStyle) {
      if (!narrationText) return '';
      const raw = narrationText.trim();
      const kwList = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

      let cleaned = raw
        .replace(/^(在|顺着|沿着|当|经过|据|由于|因为|为了|根据)[^，,。；;]{1,15}[，,]/g, '')
        .replace(/^(有一条|坐落着|迎面出现的却是|映入眼帘的是|矗立着|车辆必须|这就是|可以说|事实上|实际上)/g, '')
        .replace(/[，,。；;！!？?]+$/g, '')
        .trim();

      if (cleaned.length < 4) cleaned = raw.replace(/[，,。；;！!？?]+$/g, '');

      const mainSubject = kwList.length > 0 ? kwList[0] : (cleaned.length > 25 ? cleaned.slice(0, 25) : cleaned);
      const contextDesc = cleaned;

      let cameraMove = '平稳推镜头向前聚焦';
      if (/转弯|急弯|弯道|穿行|盘山|环绕/.test(raw)) {
        cameraMove = '大范围航拍连续弧形环绕跟随';
      } else if (/落差|悬崖|山峰|俯瞰|冲上|高度|海拔/.test(raw)) {
        cameraMove = '高空俯冲推拉运镜转开阔全景';
      } else if (/细节|金箔|雕刻|纹理|双眼|双手|微观|精细|古老|建筑/.test(raw)) {
        cameraMove = '慢速微距浅景深焦点平移特写';
      } else if (/穿过|延伸|漫步|走入|深入/.test(raw)) {
        cameraMove = '第一人称低角度正前向稳定推进运镜';
      }

      if (targetMode === 'video') {
        return '【镜头主体】' + mainSubject + '，画面展现「' + contextDesc + '」；【运镜设计】' + cameraMove + '；【光影与质感】自然光影真实漫反射，丰富环境层次，电影级光学动态细节';
      } else if (targetMode === 'image') {
        return '【摄影构图】大师级构图定格「' + mainSubject + '」，核心视觉细节：' + contextDesc + '；【材质与光线】微米级物理材质纹理特写，真实环境自然光漫射，8K顶级摄影画质，无杂乱文字';
      } else {
        const title = mainSubject.length > 10 ? mainSubject.slice(0, 8) : mainSubject;
        if (templateStyle === 'document_highlight') {
          return '【文献考据】「' + title + '」\n【核心引录】“' + contextDesc + '”\n【考据重点】金石文献与建筑工艺考据\n【版式视觉】16:9 古典金石史料信息图卡片，和风古典深色肌理，金箔反光点缀，典雅宣纸书卷排版风格，博物馆展签级';
        } else if (templateStyle === 'versus_dual') {
          return '【核心辩题】「' + title + '」\n【传统认知】既往常态定式阐述\n【颠覆突破】全新机制与核心突破\n【版式视觉】16:9 对比双栏Keynote信息图卡片，左右对称深色信息容器，冷蓝与渐变紫双色对比辉光，极简数据对撞排版';
        } else if (templateStyle === 'timeline') {
          return '【演进主线】「' + title + '」\n【阶段推进】阶段01关键转折 ➔ 阶段02演进里程碑\n【版式视觉】16:9 历史时空演进路线图卡片，发光连接轴线，阶段卡片发光边框，现代信息图表极简科技排版';
        } else if (templateStyle === 'kinetic_text') {
          return '【聚光焦点】「' + title + '」\n【视觉递进】层层展开的递进阐述短句\n【版式视觉】16:9 视觉冲击排版海报卡片，特大号粗体文字层级，径向聚光灯深色氛围，极简高张力视觉平面设计';
        } else {
          return '【核心大字】「' + title + '」\n【副级阐述】' + contextDesc + '\n【排版重点】突出核心论据与工艺细节\n【版式视觉】16:9 现代暗色高阶演说PPT信息图卡片，微光磨砂玻璃容器，金珀与深蓝氛围光晕，顶级平面设计排版';
        }
      }
    }

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
          input.classList.add('ring-2', 'ring-purple-400');
          setTimeout(() => input.classList.remove('ring-2', 'ring-purple-400'), 1000);
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

    async function downloadUrlForRow(idx) {
      const scene = manifestData.scenes[idx];
      const inputEl = document.getElementById('urlDownloadInput_' + idx);
      const btnEl = document.getElementById('urlDownloadBtn_' + idx);
      const promptEl = document.getElementById('aiIntentInput_' + idx);
      const rawUrl = inputEl ? inputEl.value.trim() : '';
      const rawPrompt = promptEl ? promptEl.value.trim() : '';

      if (!rawUrl) {
        alert('请先粘贴要下载的网络视频或帖子链接（支持 YouTube、B站、抖音、TikTok、小红书等）');
        if (inputEl) inputEl.focus();
        return;
      }

      const clipStartSec = scene.download_clip_start_sec;
      const clipEndSec = scene.download_clip_end_sec;
      const hasRange = clipStartSec !== undefined && clipStartSec !== null && clipEndSec !== undefined && clipEndSec !== null && Number(clipEndSec) > Number(clipStartSec);
      const origBtnText = btnEl ? btnEl.textContent : '⬇️ 下载';

      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = hasRange ? `⏳ 截取 ${formatUiMMSS(clipStartSec)}~${formatUiMMSS(clipEndSec)}...` : '⏳ 下载中...';
      }

      const jobId = 'dl_' + Date.now() + '_' + idx;
      const progWrap = document.getElementById('urlDownloadProgressWrap_' + idx);
      const progBar = document.getElementById('urlDownloadProgressBar_' + idx);
      const progText = document.getElementById('urlDownloadProgressText_' + idx);
      const progPct = document.getElementById('urlDownloadProgressPct_' + idx);
      const setProgUi = (pct, msg) => {
        const safePct = Math.max(0, Math.min(100, Math.round(pct || 0)));
        if (progWrap) progWrap.classList.remove('hidden');
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
          ? `⏳ 正在按口令仅下载原视频 ${formatUiMMSS(clipStartSec)} ~ ${formatUiMMSS(clipEndSec)} 片段至本工程 assets/video/ ...`
          : '⏳ 正在解析并下载网络视频到本工程专属 assets 目录...'
      );

      try {
        const res = await fetch('/api/download-url-asset?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
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
        if (data.ok) {
          setProgUi(100, '下载并绑定完成！');
          if (window._pendingDownloadUrls) delete window._pendingDownloadUrls[idx];
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          setTimeout(() => rerenderSceneRow(idx), 350);
          showToast(data.message || '✅ 网络视频片段已下载到本工程 assets 目录并绑定至当前分镜！');
          setTimeout(() => {
            const inp = document.getElementById('aiIntentInput_' + idx);
            if (inp) {
              inp.value = '';
              inp.focus();
              inp.placeholder = '✅ 短视频已就绪！现在可输入口令对此片段加字幕/艺术字、调色或运镜...';
            }
          }, 500);
        } else {
          if (progWrap) progWrap.classList.add('hidden');
          alert(data.error || '链接解析下载失败');
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = origBtnText;
          }
        }
      } catch (err) {
        clearInterval(pollTimer);
        if (progWrap) progWrap.classList.add('hidden');
        alert('请求失败: ' + err.message);
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = origBtnText;
        }
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
        showToast('✅ 已保存镜头表格，并同步至 Remotion 视频引擎！');
        showCompletionModal({
          icon: '💾',
          title: '保存并同步已完成',
          message: '镜头表格修改已保存，并已同步至 Remotion 视频引擎！',
          detail: '当前共 ' + (manifestData?.scenes?.length || 0) + ' 个镜头。',
        });
      }
    }

