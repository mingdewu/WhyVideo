// producer-table.js — shared classic-script scope; loaded before studio initialization.
const SCENE_FIELD_LABELS = ['', '旁白与素材预览', '画面方式', '素材下载 / AI 生成与剪辑', '节拍调整'];

let sceneVideoObserver = null;
let sceneVideoObserverRoot = null;

function observeLazySceneVideos(containerEl) {
  if (!containerEl) return;
  const listEl = document.getElementById('producerSceneList') || null;
  if (!sceneVideoObserver || sceneVideoObserverRoot !== listEl) {
    if (sceneVideoObserver) sceneVideoObserver.disconnect();
    sceneVideoObserverRoot = listEl;
    sceneVideoObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target;
        const lazySrc = video.dataset.lazySrc;
        if (!lazySrc) continue;
        if (entry.isIntersecting) {
          if (video.getAttribute('src') !== lazySrc) {
            video.preload = 'metadata';
            video.src = lazySrc;
          }
        } else if (video.paused && video.hasAttribute('src')) {
          video.removeAttribute('src');
          video.load();
        }
      }
    }, { root: listEl, rootMargin: '350px 0px' });
  }
  containerEl.querySelectorAll('video[data-lazy-src]').forEach((v) => {
    sceneVideoObserver.observe(v);
  });
}
window.observeLazySceneVideos = observeLazySceneVideos;

    // 连用镜头仍保留独立旁白片段，但共享一个连续画面的时间范围。
    function getSharedVisualTiming(idx) {
      const scenes = manifestData.scenes;
      let first = idx;
      let last = idx;
      while (first > 0 && scenes[first].shared_asset_with_prev) first--;
      while (last + 1 < scenes.length && scenes[last + 1].shared_asset_with_prev) last++;
      const startMs = Number(scenes[first].start_ms);
      const endMs = Number(scenes[last].end_ms);
      return { first, last, startMs, endMs, durationMs: endMs - startMs };
    }

    function buildSceneRow(scene, idx) {
        const isAi = Boolean(scene.source_mode && scene.source_mode !== 'manual_upload');
        const ppt = scene.ppt_slide_spec || {};
        const kws = Array.isArray(scene.content_keywords) ? scene.content_keywords : [];
        const durSec = (scene.duration_ms / 1000).toFixed(1);

        const visualTiming = getSharedVisualTiming(idx);
        const isSharedGroup = visualTiming.first !== visualTiming.last;
        const visualDurSec = (visualTiming.durationMs / 1000).toFixed(1);
        let badgeClass = 'badge-gold';
        let badgeLabel = `🟢 ${visualDurSec}s · 黄金节奏`;
        if (visualTiming.durationMs > 10000) {
          badgeClass = 'badge-danger';
          badgeLabel = `🔴 ${visualDurSec}s · 建议加切点 ✂️`;
        } else if (visualTiming.durationMs > 8500) {
          badgeClass = 'badge-warn';
          badgeLabel = `🟡 ${visualDurSec}s · 偏长`;
        } else if (visualTiming.durationMs < 1500) {
          badgeClass = 'badge-warn';
          badgeLabel = `🟡 ${visualDurSec}s · 偏短`;
        }

        const isSharedWithPrev = Boolean(scene.shared_asset_with_prev);
        const tr = document.createElement('tr');
        tr.setAttribute('role', 'row');
        tr.dataset.sceneIdx = String(idx);
        tr.className = 'transition ' + (isSharedWithPrev ? 'bg-info-soft' : '');

        // 1. 镜头序号与时长
        const hasProjectAudio = Boolean((window.timingSummaryData && window.timingSummaryData.has_audio_file) || (manifestData && manifestData.audio_file));
        const isPlayingThisShot = window._playingShotIdx === idx;
        const td1 = document.createElement('td');
        td1.className = 'p-3 text-center';
        td1.innerHTML = `
          <span class="px-2 py-0.5 rounded-lg bg-surface border border-line text-warn font-extrabold text-xs block mb-1">
            ${scene.scene_id}
          </span>
          <span class="inline-block px-1.5 py-px rounded text-[9px] leading-tight font-semibold mb-1 ${badgeClass}">
            ${badgeLabel}
          </span>
          <span class="text-sm font-extrabold text-ink bg-subtle border border-line rounded-md px-2 py-1 block font-mono tracking-tight my-1 whitespace-nowrap">
            ${(visualTiming.startMs / 1000).toFixed(1)}s - ${(visualTiming.endMs / 1000).toFixed(1)}s
          </span>
          ${isSharedGroup ? `
            <span class="text-[10px] text-info block">🔗 连用总时长 ${visualDurSec}s · ${visualTiming.last - visualTiming.first + 1} 段共用画面</span>
            <span class="text-[9px] text-ink-muted block mt-1">本段旁白 ${durSec}s · ${(scene.start_ms / 1000).toFixed(1)}–${(scene.end_ms / 1000).toFixed(1)}s</span>
          ` : ''}
          <div class="mt-1 flex flex-wrap items-center justify-center gap-1">
            ${scene.timing_source && scene.timing_source.startsWith('aligned')
              ? '<span class="inline-block px-1.5 py-0.5 rounded bg-ok-soft text-ok border border-ok-line text-[9px] font-semibold">🎙️ 已对齐</span>'
              : ''}
            ${hasProjectAudio
              ? `<button type="button" id="btnPlayShotAudio_${idx}" onclick="togglePlayShotNarration(${idx})" class="px-1.5 py-0.5 rounded ${isPlayingThisShot ? 'bg-danger-solid text-ink-inverse border-danger-line' : 'bg-ok-soft hover:bg-ok-soft text-ok border-ok-line'} border text-[9px] font-bold transition cursor-pointer shadow-sm" title="试听本镜头对应的旁白配音片段 (${(scene.start_ms / 1000).toFixed(1)}s ~ ${(scene.end_ms / 1000).toFixed(1)}s)">${isPlayingThisShot ? '⏹️ 停止' : '🔊 试听'}</button>`
              : ''}
          </div>
          <span class="text-[10px] text-ink-muted block mt-0.5">${scene.chapter_ref || ''}</span>
        `;

        // 2. 旁白片段（支持点字切画面 / 挪切点）
        const td2 = document.createElement('td');
        td2.className = 'p-3';
        const isPickerOpen = Boolean(window._openCutPickers && window._openCutPickers[idx]);
        const vKws = Array.isArray(scene.visual_keywords) ? scene.visual_keywords : [];
        td2.innerHTML = `
          <textarea rows="4" aria-label="旁白" class="w-full p-2.5 rounded-lg bg-input border border-line text-ink text-xs leading-relaxed focus:border-ink focus:outline-none"
            onchange="onNarrationEdit(${idx}, this.value)">${escapeHtml(scene.narration_text || '')}</textarea>
          <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
            <button type="button" onclick="toggleCharCutPicker(${idx})"
              class="px-2 py-0.5 rounded bg-accent-soft hover:bg-accent-soft text-accent border border-accent-line font-semibold transition cursor-pointer">
              ${isPickerOpen ? '▲ 收起切点面板' : '👆 点字切画面 / 挪切点'}
            </button>
            ${vKws.length ? ('<span class="px-1.5 py-0.5 rounded bg-accent-soft text-accent border border-accent-line font-mono truncate max-w-[180px]" title="画面触发关键词">🎯 ' + escapeHtml(vKws.join(' / ')) + '</span>') : ''}
          </div>
          <div id="charCutPicker_${idx}" class="${isPickerOpen ? '' : 'hidden '}mt-2 p-2.5 rounded-xl bg-surface border border-accent-line space-y-2"></div>
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
                ? 'bg-info-soft border-info-line text-info font-bold'
                : 'bg-subtle border-line text-ink-muted'
            }">
              <input type="radio" name="mode_${idx}" onchange="setMode(${idx}, 'manual_upload')" ${!isAi ? 'checked' : ''} />
              <span class="text-xs">📤 人工上传素材</span>
            </label>
            <label class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
              isAi
                ? 'bg-accent-soft border-accent-line text-accent font-bold'
                : 'bg-subtle border-line text-ink-muted'
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
                <span class="text-[10px] text-accent font-bold">🎬 视频描述 & 运镜指示词 (Text-to-Video):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'video')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-soft hover:bg-action-hover text-accent border border-accent-line transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼电影级运镜与画面描述词">
                  ✨ 自动提炼运镜词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入本镜头视频画面与运镜提示词（留空将根据旁白生成）..."
                class="w-full px-2 py-1.5 rounded-lg bg-input border border-accent-line text-accent text-[11px] font-mono focus:border-ink focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <!-- 一键生成实体视频按钮 -->
            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl text-ink-inverse font-black text-xs transition shadow-md flex items-center justify-center gap-1.5 bg-ok-solid hover:bg-ok-hover">
                <span>🎬 一键生成真实动态视频 (${pName})</span>
              </button>
            </div>

            <!-- 实体视频行内真实播放器或预览占位 -->
            ${hasGeneratedVideo ? `
              <div class="rounded-xl border border-ok-line bg-media aspect-[16/9] relative overflow-hidden group shadow-lg">
                <video data-lazy-src="${generatedVideoSrc}#t=1" controls playsinline preload="none" onloadedmetadata="checkVideoElementDuration(this, ${idx})" class="w-full h-full object-cover"></video>
                <div class="absolute top-2 left-2 bg-media/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-ink-inverse border border-ok-line flex items-center gap-1 pointer-events-none">
                  <span>✅ 实体 MP4 视频就绪 (时长: ${durSec}s)</span>
                </div>
              </div>
              <div id="aiVideoShortWarn_${idx}" class="${aiShortInfo.isTooShort ? '' : 'hidden '}px-2.5 py-1.5 rounded-lg bg-danger-soft border border-danger-line text-danger text-[11px] font-bold flex items-center gap-1.5 shadow-sm">
                ${aiShortInfo.isTooShort ? buildVideoShortWarnText(aiShortInfo, durSec) : ''}
              </div>
            ` : `
              <div class="rounded-xl border border-ok-line p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between relative overflow-hidden group bg-subtle">
                <div class="flex items-center justify-between">
                  <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-ok-soft text-ok border border-ok-line">
                    待生成 · 🎬 实体动态视频 (MP4)
                  </span>
                  <span class="text-[9px] text-ink-muted font-mono">1920x1080 · ${durSec}s</span>
                </div>

                <div class="my-auto text-center px-1">
                  <h4 class="text-xs font-bold text-ink line-clamp-2">
                    ${scene.narration_text}
                  </h4>
                  <p class="text-[10px] text-ok mt-1 line-clamp-1 font-mono">
                    ${ppt.custom_prompt ? ('🎯 ' + ppt.custom_prompt) : (kws.length ? ('标志: ' + kws.join(' · ')) : '等待指令')}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-1 border-t border-ok-line text-[9px] text-ok">
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
                <span class="text-[10px] text-accent font-bold">🖼️ 实景图视觉指示词 (FLUX HD):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'image')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-info-soft hover:bg-info-solid text-info border border-info-line transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼超清摄影构图与视觉特征词">
                  ✨ 自动提炼实景词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入本镜头实景图画面描述词（留空将根据旁白生成）..."
                class="w-full px-2 py-1.5 rounded-lg bg-input border border-accent-line text-accent text-[11px] font-mono focus:border-ink focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl text-ink-inverse font-black text-xs transition shadow-md flex items-center justify-center gap-1.5 bg-action hover:bg-action-hover">
                <span>🖼️ 一键生成超清实景图 (${iName})</span>
              </button>
            </div>

            ${hasPreviewImage ? `
              <div class="rounded-xl border border-ok-line bg-media aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="Image Still 1080p" onclick="window.open('${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-media/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-ink-inverse border border-ok-line">
                  <span>✅ 超清实景图已挂载</span>
                </div>
                <a href="${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-info-soft hover:bg-info-solid text-info hover:text-ink-inverse px-2 py-0.5 rounded text-[10px] font-bold border border-info-line flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            ` : `
              <div class="rounded-xl border border-info-line bg-subtle p-2.5 aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-info-soft text-info w-fit">待生成 · 超清实景图</span>
                <p class="text-xs text-center text-ink-secondary line-clamp-2">${scene.narration_text}</p>
                <div class="text-[9px] text-info text-center">点击上方按钮由 ${iName} 生成超清实景图</div>
              </div>
            `}
          `;
        } else {
          // 📊 动效排版卡片形态
          innerContent = `
            <div class="flex items-center justify-between p-1 rounded-lg bg-subtle border border-accent-line text-[10px]">
              <div class="flex items-center gap-1.5 font-bold text-accent">
                <span>🪐 大模型 API 视觉排版调优</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-accent-soft text-accent border border-accent-line">AI 自由设计</span>
              </div>
              <span class="text-[9px] text-ink-muted">结合顶部模型自适应优化</span>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-accent font-bold">📊 卡片排版指导词 (Prompt):</span>
                <button type="button" id="prompt_btn_${idx}" onclick="autoGenerateShotPrompt(${idx}, 'card')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-soft hover:bg-action-hover text-accent border border-accent-line transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼卡片视觉排版提示">
                  ✨ 自动提炼排版词
                </button>
              </div>
              <textarea id="prompt_input_${idx}" rows="2" placeholder="输入卡片 Prompt 指导词..."
                class="w-full px-2 py-1.5 rounded-lg bg-input border border-accent-line text-accent text-[11px] font-mono focus:border-ink focus:outline-none resize-none"
                onchange="onPptThemeEdit(${idx}, 'custom_prompt', this.value)">${escapeHtml(ppt.custom_prompt || '')}</textarea>
            </div>

            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-ink-muted font-bold whitespace-nowrap">大字:</span>
              <input id="title_input_${idx}" type="text" value="${escapeHtml(ppt.theme_title || '')}" placeholder="修改核心大字标题..."
                class="w-full px-2 py-1 rounded-lg bg-input border border-accent-line text-accent font-bold text-[11px] focus:border-ink focus:outline-none"
                onchange="onPptThemeEdit(${idx}, 'theme_title', this.value)" />
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_${idx}" onclick="generateRowPpt(${idx})" class="w-full py-1.5 px-3 rounded-xl text-ink-inverse font-black text-xs transition shadow-md flex items-center justify-center gap-1.5 bg-action hover:bg-action-hover">
                <span>🎨 一键由 AI 绘制 PPT 动态卡片 (${iName})</span>
              </button>
            </div>

            ${hasPreviewImage ? `
              <div class="rounded-xl border border-ok-line bg-media aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="AI Presentation Card" onclick="window.open('${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-media/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-ink-inverse border border-ok-line">
                  <span>✅ AI 绘制 PPT 动态卡片 (${iName})</span>
                </div>
                <a href="${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-accent-soft hover:bg-action-hover text-accent hover:text-ink-inverse px-2 py-0.5 rounded text-[10px] font-bold border border-accent-line flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            ` : `
              <div class="rounded-xl border border-accent-line p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between bg-subtle">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-accent-soft text-accent w-fit">待生成 · AI PPT 动态卡片</span>
                <div class="my-auto text-center px-1">
                  <h4 class="text-sm font-black text-accent">${mainTitle}</h4>
                  <p class="text-[10px] text-ink-secondary mt-1 line-clamp-1">${subtitle}</p>
                </div>
                <div class="text-[9px] text-accent text-center">点击上方按钮由 ${iName} 绘制 16:9 专业 PPT 信息图卡片</div>
              </div>
            `}
          `;
        }

        td5.innerHTML = `
          <div class="space-y-2 ${isAi ? '' : 'inactive-visual-editor opacity-40 pointer-events-none'}">
            <!-- 视觉呈现形态三态切换 -->
            <div class="flex items-center p-0.5 rounded-lg bg-subtle border border-line text-[10px] font-bold">
              <button type="button" onclick="setVisualTarget(${idx}, 'video')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'video' ? 'text-ink-inverse shadow font-black bg-ok-solid hover:bg-ok-hover' : 'text-ink-muted hover:text-ink'}">
                🎬 实体视频
              </button>
              <button type="button" onclick="setVisualTarget(${idx}, 'image')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'image' ? 'bg-info-solid text-ink-inverse shadow font-black' : 'text-ink-muted hover:text-ink'}">
                🖼️ 超写实图
              </button>
              <button type="button" onclick="setVisualTarget(${idx}, 'card')"
                class="flex-1 py-1 rounded text-center transition ${curTargetMode === 'card' ? 'bg-action text-ink-inverse shadow font-black' : 'text-ink-muted hover:text-ink'}">
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
              <div class="p-1 rounded-lg bg-info-soft border border-info-line text-[10px] text-info font-bold flex items-center justify-between gap-1 mb-1.5">
                <span>🔗 连用上一镜头素材</span>
                <button onclick="unlinkScene(${idx})" class="text-danger hover:text-danger text-xs">✕ 取消</button>
              </div>
            `;
          } else {
            linkHtml = `
              <button onclick="linkWithPrevious(${idx})" class="w-full px-2 py-1 rounded-lg bg-subtle hover:bg-info-solid border border-line hover:border-info-line text-ink-secondary hover:text-ink-inverse text-[10px] font-semibold transition mb-1.5 block">
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
              <div class="p-1.5 rounded-lg bg-ok-soft border border-ok-line text-[10px] text-ok font-mono flex items-center justify-between gap-1">
                <span class="truncate" title="${parts.join(' · ')}">✨ ${parts.join(' · ')}</span>
                <button onclick="resetModifiers(${idx})" class="text-danger hover:text-danger text-[10px] shrink-0 font-bold hover:underline cursor-pointer">重置</button>
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
            <div class="p-2 rounded-lg bg-accent-soft border border-accent-line text-[10px] text-accent leading-relaxed shadow-sm">
              <div class="flex items-center gap-1 font-bold text-accent mb-0.5">
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
          <div id="step0KwWrap_${idx}" class="pb-1.5 border-b border-line">
            ${step0RowHtml}
          </div>
        `;

        // 口令框（置于最上方：既能把秒数口令编译为下载片段跳转指令，也能对已下载本地短视频做加字幕/动效二次剪辑）
        const aiInputHtml = `
          <div class="space-y-1.5 min-w-0">
            <div class="flex items-center justify-between gap-2 text-[9px] text-info font-bold min-w-0">
              <span class="truncate">🎙️ Step 1 · 口语指令 (下载秒数 / 字幕动效)</span>
              <span class="text-ink-muted font-mono shrink-0">语音或输入后点编译 ↵</span>
            </div>
            <div class="flex items-center gap-1 min-w-0">
              <input type="text" id="aiIntentInput_${idx}"
                     placeholder="${inputPlaceholder}"
                     value="${currentPromptVal}"
                     onkeydown="if(event.key==='Enter') applyAiIntentForRow(${idx})"
                     class="min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-input border border-info-line text-ink text-[10px] placeholder:text-ink-muted focus:border-ink focus:ring-ink focus:outline-none" />
              <button type="button" id="aiVoiceBtn_${idx}" onclick="toggleVoiceInputForRow(${idx})"
                      aria-label="语音输入口语指令" aria-pressed="false"
                      title="点击开始语音输入口语指令（再次点击结束并转文字）"
                      class="px-2 py-1.5 rounded-lg bg-surface hover:bg-danger-soft border border-info-line hover:border-danger-line text-info hover:text-danger font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1">
                🎤 语音
              </button>
              <button type="button" onclick="applyAiIntentForRow(${idx})" class="px-2.5 py-1.5 rounded-lg bg-info-solid hover:bg-info-solid text-ink-inverse font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition" title="解析口语中的起止秒数生成下载跳转命令，或编译字幕与Remotion动效">
                ✨ 编译
              </button>
            </div>
            <div id="aiVoiceStatus_${idx}" class="hidden flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-danger-soft border border-danger-line text-[10px] text-danger">
              <span id="aiVoiceStatusText_${idx}" class="truncate"></span>
              <button type="button" onclick="cancelActiveVoiceInput(true)" class="text-ink-secondary hover:text-ink underline shrink-0 cursor-pointer">取消</button>
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
            <div class="p-1.5 rounded-lg bg-info-soft border border-info-line text-[10px] text-info font-mono flex items-center justify-between gap-1 shadow-sm">
              <span class="truncate" title="点下载时将只抓取原视频 ${dlRangeLabel} (${dlStart}s~${dlEnd}s)">
                🎯 已就绪: 仅下载 <b>${dlRangeLabel}</b> (${(Number(dlEnd) - Number(dlStart)).toFixed(1)}s)
              </span>
              <button type="button" onclick="clearDownloadRangeForRow(${idx})" class="text-danger hover:text-danger text-[10px] shrink-0 font-bold hover:underline cursor-pointer">✕ 整片</button>
            </div>
          `
          : '';

        const urlDownloadBarHtml = `
          <div class="space-y-1 pt-1 border-t border-line min-w-0">
            <div class="flex items-center justify-between gap-2 text-[9px] text-info font-bold min-w-0">
              <span class="truncate">🔗 Step 2 · 填入视频 URL 下载 (${seqDisplay})</span>
              <span class="text-ink-muted font-mono truncate max-w-[120px] shrink-0" title="projects/${activeProjectId}/public/assets/video/">📂 assets/</span>
            </div>
            ${downloadRangeBadgeHtml}
            <div class="flex items-center gap-1 min-w-0">
              <input type="url" id="urlDownloadInput_${idx}"
                     value="${pendingUrlVal}"
                     oninput="window._pendingDownloadUrls = window._pendingDownloadUrls || {}; window._pendingDownloadUrls[${idx}] = this.value"
                     placeholder="🔗 粘贴视频链接 (YouTube/B站/抖音等)..."
                     onkeydown="if(event.key==='Enter') downloadUrlForRow(${idx})"
                     class="w-0 min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-input border border-info-line text-ink text-[10px] placeholder:text-ink-muted focus:border-ink focus:ring-ink focus:outline-none" />
              <button type="button" id="urlDownloadHeadBtn_${idx}" onclick="downloadUrlForRow(${idx}, 'head')"
                      title="从原视频开头截取，时长与第一列一致"
                      class="px-2 py-1.5 rounded-lg bg-info-soft border border-info-line hover:bg-ok-solid hover:text-ink-inverse text-info font-bold text-[10px] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition">
                前 ${visualDurSec} 秒
              </button>
              <button type="button" id="urlDownloadBtn_${idx}" onclick="downloadUrlForRow(${idx})"
                      class="px-2 py-1.5 rounded-lg ${hasCompiledDlRange ? 'ring-1 ring-line-strong bg-ok-solid hover:bg-ok-hover' : 'bg-ok-solid hover:bg-ok-hover'} text-ink-inverse font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition">
                ${dlBtnText}
              </button>
            </div>
            <div class="flex items-center justify-end gap-1 text-[10px] text-ink-secondary">
              <label for="urlDownloadStart_${idx}">起始秒数</label>
              <input type="number" id="urlDownloadStart_${idx}" min="0" step="0.1" required inputmode="decimal" placeholder="0"
                     onkeydown="if(event.key==='Enter'){event.preventDefault();downloadUrlForRow(${idx}, 'offset')}"
                     class="w-16 min-w-0 px-2 py-1.5 rounded-lg bg-input border border-info-line text-ink focus:border-ink focus:outline-none" />
              <button type="button" id="urlDownloadOffsetBtn_${idx}" onclick="downloadUrlForRow(${idx}, 'offset')"
                      title="从输入的秒数开始截取 ${visualDurSec} 秒"
                      class="px-2 py-1.5 rounded-lg bg-info-soft border border-info-line hover:bg-ok-solid hover:text-ink-inverse text-info font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition">
                从该秒下载
              </button>
            </div>
            <div id="urlDownloadProgressWrap_${idx}" class="invisible space-y-0.5 pt-0.5">
              <div class="w-full h-1.5 rounded-full bg-subtle overflow-hidden">
                <div id="urlDownloadProgressBar_${idx}" class="h-full rounded-full transition-all duration-200 bg-ok-solid hover:bg-ok-hover" style="width: 0%;"></div>
              </div>
              <div class="flex items-center justify-between text-[9px] text-info font-mono">
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
            ? 'text-[10px] text-danger font-mono font-bold shrink-0'
            : 'text-[10px] text-ok font-mono font-bold shrink-0';
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
                   class="scene-media-dropzone border ${shortInfo.isTooShort ? 'border-danger-line bg-danger-soft' : 'border-info-line bg-info-soft'} rounded-xl p-2 text-left gap-1.5"
                   ondragover="onFileDragOver(event, ${idx})"
                   ondragleave="onFileDragLeave(event, ${idx})"
                   ondrop="onFileDrop(event, ${idx})">
                <div class="flex items-center justify-between gap-1.5 shrink-0">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-info-soft text-info truncate min-w-0 flex-1" title="${asset.file_name || asset.asset_id} (${asset.file_path || asset.path})">
                    ${asset.file_name || asset.asset_id}
                  </span>
                  <div class="flex items-center gap-2 shrink-0">
                    <span id="videoDurBadge_${idx}" class="${durBadgeClass}">
                      ${durBadgeText}
                    </span>
                    <button type="button" onclick="clearAsset(${idx})" class="text-[10px] font-bold text-danger hover:underline cursor-pointer shrink-0">
                      清除绑定
                    </button>
                  </div>
                </div>

                ${
                  isVideo
                    ? `
                    <div id="videoShortWarn_${idx}" class="${shortInfo.isTooShort ? '' : 'hidden '}px-2 py-1 rounded-lg bg-danger-soft border border-danger-line text-danger text-[10px] font-bold flex items-center gap-1.5 shrink-0">
                      ${shortInfo.isTooShort ? buildVideoShortWarnText(shortInfo, durSec) : ''}
                    </div>
                    <div class="scene-media-preview rounded-lg border border-line flex items-center justify-center">
                      <video data-lazy-src="${videoSrc}#t=1" controls playsinline preload="none" onloadedmetadata="checkVideoElementDuration(this, ${idx}); if (this.paused && this.duration > 0 && this.duration < 1) this.currentTime = 0.1" class="w-full h-full object-contain"></video>
                    </div>
                  `
                    : `
                    <div class="scene-media-preview rounded-lg border border-line flex items-center justify-center">
                      <img src="${videoSrc}" class="w-full h-full object-cover" />
                    </div>
                  `
                }

                ${isVideo ? (() => {
                  const hasAudioTrack = asset.has_audio !== false;
                  const keepAudio = Boolean(scene.media_modifiers && scene.media_modifiers.keep_original_audio);
                  const audioVolPct = Math.round(((scene.media_modifiers && scene.media_modifiers.original_audio_volume !== undefined) ? scene.media_modifiers.original_audio_volume : 0.3) * 100);
                  if (!hasAudioTrack) {
                    return `
                      <div class="flex items-center justify-between gap-2 px-2 py-0.5 rounded-lg bg-subtle border border-line text-[10px] text-ink-muted shrink-0">
                        <span>🔇 该素材无音轨</span>
                      </div>
                    `;
                  }
                  return `
                    <div class="flex items-center justify-between gap-2 px-2 py-0.5 rounded-lg bg-subtle border border-info-line text-[10px] shrink-0">
                      <label class="flex items-center gap-1.5 text-info font-semibold cursor-pointer select-none shrink-0">
                        <input type="checkbox" id="keepAudioCheck_${idx}" ${keepAudio ? 'checked' : ''}
                               onchange="updateSceneAudioOption(${idx})"
                               class="rounded border-line-strong bg-input text-info focus:ring-ink cursor-pointer" />
                        <span>🔊 保留原声</span>
                      </label>
                      <div class="flex items-center gap-1.5 min-w-0 ${keepAudio ? '' : 'opacity-40 pointer-events-none'}">
                        <input type="range" id="keepAudioVol_${idx}" min="0" max="100" step="5" value="${audioVolPct}"
                               oninput="document.getElementById('keepAudioVolText_${idx}').textContent = this.value + '%'"
                               onchange="updateSceneAudioOption(${idx})"
                               class="w-16 accent-sky-400 cursor-pointer" />
                        <span id="keepAudioVolText_${idx}" class="font-mono text-info w-8 text-right shrink-0">${audioVolPct}%</span>
                      </div>
                    </div>
                  `;
                })() : ''}
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
                   class="scene-media-dropzone scene-media-dropzone-empty w-full border-2 border-dashed border-info-line hover:border-info-line bg-subtle rounded-xl p-2.5 text-center transition cursor-pointer group"
                   ondragover="onFileDragOver(event, ${idx})"
                   ondragleave="onFileDragLeave(event, ${idx})"
                   ondrop="onFileDrop(event, ${idx})"
                   onclick="document.getElementById('fileInput_${idx}').click()">
                <span class="block text-info text-lg mb-0.5">📥</span>
                <span class="block text-[11px] font-bold text-info">选择或拖入视频 / 图片</span>
                <span class="block text-[9px] text-ink-muted mt-0.5">或先在上方口令框指定秒数 ➔ 编译 ➔ 填 URL 下载</span>
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

        // Keep the manual media slot under its narration, independent of the editing controls in column four.
        if (!isAi) {
          const mediaSlot = td6.querySelector('#dropzone_' + idx);
          if (mediaSlot) {
            mediaSlot.remove();
            const cutPicker = td2.querySelector('#charCutPicker_' + idx);
            td2.insertBefore(mediaSlot, cutPicker);
          }
        }

        // 7. 镜头节拍操作列 (加切点 / 挪切点 / 删切点)
        const td7 = document.createElement('td');
        td7.className = 'p-3 text-center';
        td7.innerHTML = `
          <div class="flex flex-col gap-1.5">
            <button type="button" onclick="openCutPickerForSplit(${idx})" class="w-full px-2 py-1.5 rounded-lg bg-accent-soft hover:bg-action-hover border border-accent-line text-accent hover:text-ink-inverse text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm cursor-pointer" title="展开点字切画面面板，点任意字前新增换画面点">
              <span>✂️ 加切点</span>
            </button>
            ${
              idx > 0
                ? `<div class="grid grid-cols-2 gap-1">
                    <button type="button" onclick="nudgeCutPoint(${idx}, 'earlier')" class="px-1 py-1 rounded-lg bg-accent-soft hover:bg-action-hover border border-accent-line text-accent hover:text-ink-inverse text-[10px] font-bold transition cursor-pointer" title="把本画面切入点往前挪（上一句话没说完就切入本画面）">
                      ⏪提前换
                    </button>
                    <button type="button" onclick="nudgeCutPoint(${idx}, 'later')" class="px-1 py-1 rounded-lg bg-accent-soft hover:bg-action-hover border border-accent-line text-accent hover:text-ink-inverse text-[10px] font-bold transition cursor-pointer" title="把本画面切入点往后挪">
                      ⏩推迟换
                    </button>
                  </div>`
                : ''
            }
            ${
              idx < (manifestData.scenes.length - 1)
                ? `<button type="button" onclick="mergeShotWithNext(${idx})" class="w-full px-2 py-1.5 rounded-lg bg-ok-soft hover:bg-ok-hover border border-ok-line text-ok hover:text-ink-inverse text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm cursor-pointer" title="删掉与下一镜头之间的切点，合并成一个画面">
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
      const oldRect = existingRow.getBoundingClientRect();
      const listRect = listEl ? listEl.getBoundingClientRect() : null;
      const newRow = buildSceneRow(scene, idx);
      existingRow.replaceWith(newRow);
      observeLazySceneVideos(newRow);
      updateCounters();
      const heightDelta = newRow.getBoundingClientRect().height - oldRect.height;
      const targetScrollTop = (listEl && listRect && oldRect.top < listRect.top)
        ? savedScrollTop + heightDelta
        : savedScrollTop;
      const restoreScroll = () => {
        if (listEl) {
          listEl.scrollTop = targetScrollTop;
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
        <div class="text-sm font-bold text-warn">📭 暂无视觉分镜镜头</div>
        <p class="text-xs text-ink-muted max-w-lg mx-auto leading-relaxed">${escapeHtml(msg || '当前工程尚未生成镜头清单，请先前往文案创作台完成文案并同步至制作台。')}</p>
        <div class="pt-1">
          <button type="button" onclick="switchWorkspaceTab('writer')" class="px-4 py-2 rounded-xl bg-action hover:bg-action-hover text-ink-inverse text-xs font-bold shadow transition cursor-pointer">
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
      observeLazySceneVideos(tbody);
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
