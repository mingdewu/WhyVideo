// producer-timeline.js — shared classic-script scope; loaded before studio initialization.
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
          (active ? 'bg-danger-solid text-ink-inverse border-danger-line' : 'bg-ok-soft hover:bg-ok-soft text-ok border-ok-line') +
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
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-surface border border-line text-ink-secondary font-semibold';
        badge.textContent = '📐 时间轴：按字数估算';
        if (rhythmEl) rhythmEl.classList.add('hidden');
        return;
      }
      if (summary.available && !summary.stale) {
        const mLabel = summary.method === 'whisper' ? 'Whisper 逐字对齐' : '音频停顿对齐';
        const sec = ((summary.audio_duration_ms || 0) / 1000).toFixed(1);
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-ok-soft border border-ok-line text-ok font-semibold';
        badge.textContent = '🎙️ 已对齐真实配音（' + mLabel + ' · ' + sec + 's）';
      } else if (summary.available && summary.stale) {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-warn-soft border border-warn-line text-warn font-semibold';
        badge.textContent = '⚠️ 文案变动，旧时间轴已过期（请重新生成全片旁白）';
      } else if (summary.has_audio_file) {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-info-soft border border-info-line text-info font-semibold';
        badge.textContent = '🎧 已检测到配音 (' + (summary.audio_file_name || '音频') + ')，点击右侧智能排切自动对齐';
      } else {
        badge.className = 'px-2.5 py-0.5 rounded-lg bg-surface border border-line text-ink-muted font-semibold';
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
            rhythmEl.className = 'px-2 py-0.5 rounded-lg bg-warn-soft border border-warn-line text-warn';
            rhythmEl.textContent = '⚠️ ' + warns[0] + '（句末切 ' + sentPct + '% · 句中切 ' + midPct + '%）';
          } else {
            rhythmEl.className = 'px-2 py-0.5 rounded-lg bg-accent-soft border border-accent-line text-accent';
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
          const pr = await fetch('/api/auto-plan-cuts-progress?project=' + encodeURIComponent(activeProjectId) + '&jobId=' + encodeURIComponent(jobId));
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
        if (tailStart > 0) prevCharsHtml += '<span class="text-ink-muted px-0.5">…</span>';
        for (let i = tailStart; i < prevText.length; i++) {
          const ch = prevText[i];
          if (!ch.trim()) continue;
          if (i === 0) {
            prevCharsHtml += '<span class="px-0.5 text-ink-muted">' + escapeHtml(ch) + '</span>';
          } else {
            prevCharsHtml += '<button type="button" onclick="moveCutToPrevChar(' + idx + ', ' + i + ')" title="点击后，从「' + escapeHtml(ch) + '」开始提前切到本画面" class="px-1 py-0.5 rounded hover:bg-action-hover hover:text-ink-inverse text-accent bg-accent-soft border border-accent-line text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
          }
        }

        const headEnd = Math.min(currText.length, 28);
        let currHeadHtml = '';
        for (let i = 0; i < headEnd; i++) {
          const ch = currText[i];
          if (!ch.trim()) continue;
          if (i === 0) {
            currHeadHtml += '<span class="px-0.5 text-ink-muted">' + escapeHtml(ch) + '</span>';
          } else {
            currHeadHtml += '<button type="button" onclick="moveCutToCurrChar(' + idx + ', ' + i + ')" title="点击后，把「' + escapeHtml(ch) + '」之前的字退回上一画面" class="px-1 py-0.5 rounded hover:bg-info-solid hover:text-ink-inverse text-info bg-info-soft border border-info-line text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
          }
        }
        if (headEnd < currText.length) currHeadHtml += '<span class="text-ink-muted px-0.5">…</span>';

        html += '<div class="space-y-1 pb-2 border-b border-line">' +
          '<div class="text-[10px] font-bold text-accent">⬅️ 挪动换画面点（点哪个字，本画面就从这个字开始，不增减镜头）：</div>' +
          '<div class="flex flex-wrap items-center gap-0.5 leading-relaxed">' +
            prevCharsHtml +
            '<span class="px-1.5 py-0.5 mx-1 rounded bg-warn-soft text-warn border border-warn-line text-[10px] font-black">｜当前切点</span>' +
            currHeadHtml +
          '</div>' +
        '</div>';
      }

      let splitCharsHtml = '';
      for (let i = 0; i < currText.length; i++) {
        const ch = currText[i];
        if (!ch.trim()) continue;
        if (i === 0) {
          splitCharsHtml += '<span class="px-0.5 text-ink-muted text-[11px]">' + escapeHtml(ch) + '</span>';
        } else {
          splitCharsHtml += '<button type="button" onclick="splitShotAtChar(' + idx + ', ' + i + ')" title="点击后，在「' + escapeHtml(ch) + '」前面新增一个换画面点" class="px-1 py-0.5 rounded hover:bg-action-hover hover:text-ink-inverse text-ink bg-subtle border border-line text-[11px] leading-tight cursor-pointer transition">' + escapeHtml(ch) + '</button>';
        }
      }

      html += '<div class="space-y-1">' +
        '<div class="flex flex-wrap items-center justify-between gap-1">' +
          '<span class="text-[10px] font-bold text-accent">✂️ 新增换画面点（点哪个字，就在那个字前切出新镜头）：</span>' +
          '<button type="button" onclick="quickAutoSplitShot(' + idx + ')" class="px-1.5 py-0.5 rounded bg-accent-soft hover:bg-action-hover text-accent hover:text-ink-inverse border border-accent-line text-[10px] font-bold cursor-pointer transition">⚡ 在逗号处自动一分为二</button>' +
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
