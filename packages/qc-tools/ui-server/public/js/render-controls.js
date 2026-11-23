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
