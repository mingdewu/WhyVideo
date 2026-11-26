// render-controls.js — shared classic-script scope; loaded before studio initialization.
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

    function formatShortClock(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return '';
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }

    function formatDurationHuman(totalSec) {
      if (!Number.isFinite(totalSec) || totalSec < 0) return '-';
      const sec = Math.round(totalSec);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return `${h}小时${rm}分`;
      }
      return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
    }

    function formatVideoSpan(startFrame, endFrame, fps = 30) {
      const rate = Math.max(1, Number(fps) || 30);
      const fmt = (f) => {
        const totalSec = Math.floor(Math.max(0, f) / rate);
        const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const ss = String(totalSec % 60).padStart(2, '0');
        return `${mm}:${ss}`;
      };
      return `${fmt(startFrame)}–${fmt(endFrame + 1)}`;
    }

    function deriveProgressFromJob(job) {
      if (job.progress && typeof job.progress === 'object') {
        return job.progress;
      }
      const log = String(job.log || '');
      const planMatch = log.match(/全片共\s*(\d+)\s*帧，已切分为\s*(\d+)\s*段/);
      const totalFrames = planMatch
        ? Number(planMatch[1])
        : Math.max(0, Math.round((Number(window.manifestData?.total_duration_sec) || 0) * 30));
      const totalChunks = planMatch
        ? Number(planMatch[2])
        : (totalFrames > 3600 ? Math.ceil(totalFrames / 3600) : (totalFrames > 0 ? 1 : 0));

      const chunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const startFrame = i * 3600;
        const endFrame = i === totalChunks - 1 && totalFrames > 0
          ? totalFrames - 1
          : Math.min(Math.max(0, totalFrames - 1), (i + 1) * 3600 - 1);
        chunks.push({
          index: i,
          number: i + 1,
          startFrame,
          endFrame,
          totalFrames: Math.max(1, endFrame - startFrame + 1),
          renderedFrames: 0,
          status: 'pending',
          startedAt: null,
          finishedAt: null,
          durationSec: null,
        });
      }

      const startRegex = /▶\s*(?:\[(\d{2}:\d{2}:\d{2})\]\s*)?\[分段\s*(\d+)\/(\d+)\]/g;
      let m;
      while ((m = startRegex.exec(log)) !== null) {
        const idx = Number(m[2]) - 1;
        if (chunks[idx]) {
          chunks[idx].status = 'rendering';
          if (m[1]) chunks[idx].startedClock = m[1];
        }
      }
      const doneRegex = /✅\s*(?:\[(\d{2}:\d{2}:\d{2})\]\s*)?\[分段\s*(\d+)\/(\d+)\]/g;
      while ((m = doneRegex.exec(log)) !== null) {
        const idx = Number(m[2]) - 1;
        if (chunks[idx]) {
          chunks[idx].status = 'completed';
          chunks[idx].renderedFrames = chunks[idx].totalFrames;
          if (m[1]) chunks[idx].finishedClock = m[1];
        }
      }

      const completedChunks = chunks.filter((c) => c.status === 'completed').length;
      const activeChunk = chunks.find((c) => c.status === 'rendering') || null;
      if (activeChunk) {
        const frameRe = new RegExp(`(\\d+)\\/${activeChunk.totalFrames}(?!\\d)`, 'g');
        let fm;
        while ((fm = frameRe.exec(log)) !== null) {
          const val = Number(fm[1]);
          if (Number.isFinite(val) && val <= activeChunk.totalFrames) {
            activeChunk.renderedFrames = val;
          }
        }
      }

      const renderedFrames = chunks.reduce(
        (sum, c) => sum + (c.status === 'completed' ? c.totalFrames : c.renderedFrames),
        0
      );
      const isConcat = /正在用 ffmpeg 无损拼接/.test(log);
      const isBundling = /正在预打包 Remotion 工程/.test(log) && completedChunks === 0 && !activeChunk;
      let percent = job.status === 'completed' ? 100 : (job.status === 'preparing' ? 1 : 2);
      if (job.status === 'rendering') {
        if (isConcat) percent = 99;
        else if (totalFrames > 0) percent = Math.round((3 + (renderedFrames / totalFrames) * 95) * 10) / 10;
      }

      let etaSeconds = null;
      if (job.status === 'rendering' && job.startedAt && renderedFrames > 30 && totalFrames > renderedFrames) {
        const elapsedSec = Math.max(1, (Date.now() - new Date(job.startedAt).getTime()) / 1000);
        const rate = renderedFrames / elapsedSec;
        if (rate > 0.05) etaSeconds = Math.round((totalFrames - renderedFrames) / rate);
      }

      const phaseLabel = job.status === 'preparing'
        ? '⏳ 正在校验镜头时间轴与编译渲染参数…'
        : isConcat
          ? `🔗 [3/3] 正在用 ffmpeg 无损拼接 ${totalChunks} 个分段…`
          : isBundling
            ? `📦 [1/3] 正在预打包工程 Bundle…`
            : activeChunk
              ? `🎬 [2/3] 正在渲染第 ${activeChunk.number}/${totalChunks} 段（${activeChunk.renderedFrames}/${activeChunk.totalFrames} 帧）`
              : (job.status === 'completed' ? '🎉 全片渲染已完成' : '🎬 正在后台渲染…');

      return {
        phase: job.status,
        phaseLabel,
        fps: 30,
        totalFrames,
        renderedFrames,
        totalChunks,
        completedChunks,
        percent,
        startedAt: job.startedAt,
        etaSeconds,
        chunks,
      };
    }

    function renderJobProgressUI(job, status) {
      const panelEl = document.getElementById('renderProgressPanel');
      const phaseEl = document.getElementById('renderPhaseDetail');
      const pctEl = document.getElementById('renderProgressPercent');
      const fillEl = document.getElementById('renderProgressBarFill');
      const timeStatsEl = document.getElementById('renderTimeStats');
      const timelineEl = document.getElementById('renderChunksTimeline');
      if (!panelEl) return;

      const isActive = ['preparing', 'rendering'].includes(status);
      const hasChunks = Array.isArray(job?.progress?.chunks) && job.progress.chunks.length > 0;
      const showPanel = isActive || (status === 'completed' && hasChunks);
      panelEl.classList.toggle('hidden', !showPanel);
      if (timeStatsEl) timeStatsEl.classList.toggle('hidden', !showPanel);
      if (!showPanel) return;

      const prog = deriveProgressFromJob(job);
      const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
      if (phaseEl) phaseEl.textContent = prog.phaseLabel || '正在后台渲染…';
      if (pctEl) pctEl.textContent = `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
      if (fillEl) fillEl.style.width = `${pct}%`;

      if (timeStatsEl) {
        const startMs = new Date(prog.startedAt || job.startedAt || Date.now()).getTime();
        const endMs = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
        const elapsedSec = Math.max(0, Math.round((endMs - startMs) / 1000));
        const parts = [`已耗时 ${formatDurationHuman(elapsedSec)}`];
        if (isActive) {
          if (Number.isFinite(prog.etaSeconds) && prog.etaSeconds > 0) {
            parts.push(`预计剩余 ~${formatDurationHuman(prog.etaSeconds)}`);
          } else {
            parts.push('正在计算预计剩余时间…');
          }
        } else if (status === 'completed') {
          parts.push(`已完成 ${prog.totalChunks || 1} 段`);
        }
        timeStatsEl.textContent = parts.join(' · ');
      }

      if (timelineEl) {
        const chunks = Array.isArray(prog.chunks) ? prog.chunks : [];
        const fps = Number(prog.fps) || 30;
        timelineEl.innerHTML = chunks.map((c) => {
          const span = formatVideoSpan(c.startFrame, c.endFrame, fps);
          const startClock = c.startedClock || formatShortClock(c.startedAt);
          const endClock = c.finishedClock || formatShortClock(c.finishedAt);
          const chunkPct = c.totalFrames > 0 ? Math.min(100, Math.round((c.renderedFrames / c.totalFrames) * 100)) : 0;

          if (c.status === 'completed') {
            const timeInfo = [
              startClock ? `${startClock} 开始` : '',
              endClock ? `${endClock} 完成` : '已完成',
              c.durationSec ? `(${formatDurationHuman(c.durationSec)})` : '',
            ].filter(Boolean).join(' → ').replace(' → (', ' (');
            return `<div class="px-2.5 py-1.5 rounded-lg bg-ok-soft border border-ok-line text-[11px] space-y-0.5">
              <div class="flex items-center justify-between font-bold text-ok">
                <span>✅ 第 ${c.number} 段 (${span})</span>
                <span>100%</span>
              </div>
              <div class="text-[10px] text-ink-secondary truncate" title="${timeInfo}">${timeInfo}</div>
            </div>`;
          }

          if (c.status === 'rendering') {
            const timeInfo = `${startClock ? startClock + ' 开始 · ' : ''}${c.renderedFrames}/${c.totalFrames} 帧`;
            return `<div class="px-2.5 py-1.5 rounded-lg bg-action-soft border border-action-line text-[11px] space-y-0.5">
              <div class="flex items-center justify-between font-bold text-action">
                <span>⏳ 第 ${c.number} 段 (${span})</span>
                <span>${chunkPct}%</span>
              </div>
              <div class="text-[10px] text-ink-secondary truncate" title="${timeInfo}">${timeInfo}</div>
            </div>`;
          }

          return `<div class="px-2.5 py-1.5 rounded-lg bg-subtle border border-line text-[11px] opacity-75 space-y-0.5">
            <div class="flex items-center justify-between font-semibold text-ink-muted">
              <span>⏸ 第 ${c.number} 段 (${span})</span>
              <span>待渲染</span>
            </div>
            <div class="text-[10px] text-ink-muted truncate">帧 ${c.startFrame}–${c.endFrame}</div>
          </div>`;
        }).join('');
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
        renderJobProgressUI(job, status);
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
      const burnCaptionsEl = document.getElementById('finalRenderBurnCaptions');
      const burnCaptions = burnCaptionsEl ? Boolean(burnCaptionsEl.checked) : false;
      buttonEl.disabled = true;
      try {
        const response = await fetch('/api/render-project?project=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, burnCaptions }),
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
