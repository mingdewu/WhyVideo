// bgm-workbench.js — shared classic-script scope; loaded before studio initialization.
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
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-ok-soft text-ok border border-ok-line';
        if (btn) btn.title = '已挂载 BGM：' + summary.trackTitle;
      } else if (summary && summary.tracksCount > 0) {
        badge.textContent = '待启用';
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-subtle text-ink';
        if (btn) btn.title = '本地已有 ' + summary.tracksCount + ' 首 BGM，点击配置启用';
      } else {
        badge.textContent = '未启用';
        badge.className = 'px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-subtle text-ink';
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
        pollAutoBgm(activeProjectId);
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
      const modelSlug = visualConfig.bgmModel || bgmWorkbenchState.modelInfo?.bgmModel || 'google/gemini-2.5-flash';
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

      const tracks = cfg.tracks || [];
      const taggedCount = tracks.filter((t) => Boolean(t.analysis)).length;
      const untaggedCount = tracks.length - taggedCount;
      const autoStatusEl = document.getElementById('bgmAutoStatus');
      if (autoStatusEl) {
        if (tracks.length === 0) {
          autoStatusEl.textContent = '上传音乐后点击按钮；已上传的音乐可以直接使用。';
        } else if (untaggedCount === 0) {
          autoStatusEl.textContent = '曲库共 ' + tracks.length + ' 首：全部已打标签（本次将直接复用，零音频 Token 重听）。';
        } else {
          autoStatusEl.textContent = '曲库共 ' + tracks.length + ' 首：' + taggedCount + ' 首已打标签（直接复用不重听），' + untaggedCount + ' 首待首次听歌标记。';
        }
      }

      const autoSummary = document.getElementById('bgmAutoSummary');
      if (autoSummary) autoSummary.textContent = cfg.ai_plan && cfg.multi_track && cfg.enabled
        ? '已使用 ' + cfg.ai_plan.model + ' 分析 ' + cfg.ai_plan.track_count + ' 首音乐。' + (cfg.ai_plan.summary ? '\n' + cfg.ai_plan.summary : '') + '\n' + (cfg.playlist || []).map(c => formatBgmTime(c.start_ms) + '  ' + c.title).join('\n')
        : '尚未生成 AI 选曲方案。现有轮换不代表 AI 已听过音乐。';
      renderBgmSegments();
      const multiToggle = document.getElementById('bgmMultiTrackToggle');
      if (multiToggle) multiToggle.checked = Boolean(cfg.multi_track);
      const plan = document.getElementById('bgmPlaylistPreview');
      if (plan) plan.textContent = cfg.multi_track ? ((cfg.playlist || []).length
        ? '已保存的轮换方案：\n' + cfg.playlist.map(c => formatBgmTime(c.start_ms) + ' ' + c.title).join('\n')
        : '保存后生成轮换方案。') : '';
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
        if (cfg.enabled && cfg.multi_track) {
          hintEl.textContent = '💡 将按曲库时长自动轮换，保存后同步到成片';
        } else if (cfg.enabled && selected) {
          hintEl.innerHTML = '💡 已选 <strong class="text-warn">' + escapeHtml(selected.title) + '</strong>，保存后将写入 <code class="text-warn">audio_track.bgm</code>';
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
        box.innerHTML = '<div class="col-span-full p-3.5 rounded-xl bg-subtle border border-dashed border-line text-ink-muted text-center">暂无情绪曲线。点击右上角「🤖 AI 分析全片情绪弧度」将读取当前工程真实台词生成分段电平方案。</div>';
        return;
      }

      box.innerHTML = segs.map((seg, idx) => {
        const energyColor = seg.energy === 'high'
          ? 'text-warn border-warn-line bg-warn-soft'
          : (seg.energy === 'low'
            ? 'text-ok border-ok-line bg-ok-soft'
            : 'text-info border-info-line bg-info-soft');
        const energyBadge = seg.energy === 'high' ? '高潮/张力' : (seg.energy === 'low' ? '沉静/铺垫' : '稳健推进');
        return '<div class="p-3 rounded-xl bg-subtle border border-line space-y-1.5">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<span class="font-bold text-ink truncate">' + escapeHtml(seg.label || ('段落 ' + (idx + 1))) + '</span>' +
            '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ' + energyColor + ' shrink-0">' + escapeHtml(energyBadge) + '</span>' +
          '</div>' +
          '<div class="text-[11px] text-ink-muted font-mono">' + formatBgmTime(seg.start_ms) + ' ~ ' + formatBgmTime(seg.end_ms) + ' · <span class="text-warn font-sans font-semibold">' + escapeHtml(seg.mood || '') + '</span></div>' +
          (seg.music_style_hint ? '<div class="text-[10px] text-accent">🎼 ' + escapeHtml(seg.music_style_hint) + '</div>' : '') +
          (seg.reason ? '<div class="text-[10px] text-ink-muted line-clamp-2">' + escapeHtml(seg.reason) + '</div>' : '') +
          '<div class="flex items-center justify-between gap-2 pt-1 border-t border-line">' +
            '<span class="text-[10px] text-ink-muted">目标电平</span>' +
            '<div class="flex items-center gap-2 flex-1 max-w-[180px]">' +
              '<input type="range" min="-28" max="-6" step="1" value="' + Number(seg.target_db ?? -16) + '" oninput="onBgmSegmentDbChange(' + idx + ', this.value)" class="flex-1 accent-amber-400 cursor-pointer" />' +
              '<span id="bgmSegDbVal_' + idx + '" class="font-mono text-[11px] font-bold text-warn w-12 text-right">' + Number(seg.target_db ?? -16) + ' dB</span>' +
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
        box.innerHTML = '<div class="p-4 rounded-xl bg-subtle border border-dashed border-line text-xs text-ink-muted text-center">当前工程暂无 BGM 音轨。请点击右上角「📤 上传本地 BGM」导入授权音乐。</div>';
        return;
      }

      box.innerHTML = tracks.map((tr) => {
        const isSelected = !bgmWorkbenchState.config?.multi_track && tr.track_id === selectedId;
        const cardCls = isSelected
          ? 'bg-warn-soft border-warn-line shadow'
          : 'bg-subtle border-line hover:border-line-strong';
        const durLabel = tr.duration_ms ? formatBgmTime(tr.duration_ms) : '未知时长';
        const safeId = escapeHtml(tr.track_id);
        let tagHtml = '<div class="mt-1 text-[10px] text-ink-muted"><span class="px-1.5 py-0.2 rounded bg-subtle text-ink-muted border border-line">未标记（首次配乐时分析一次）</span></div>';
        if (tr.analysis) {
          const energyText = tr.analysis.energy === 'high' ? '高能量' : (tr.analysis.energy === 'low' ? '低能量' : '中能量');
          const energyBadgeCls = tr.analysis.energy === 'high'
            ? 'bg-warn-soft text-warn border-warn-line'
            : (tr.analysis.energy === 'low' ? 'bg-ok-soft text-ok border-ok-line' : 'bg-info-soft text-info border-info-line');
          const metaParts = [
            tr.analysis.suitable ? ('适合：' + tr.analysis.suitable) : '',
            tr.analysis.instruments ? ('乐器：' + tr.analysis.instruments) : '',
          ].filter(Boolean);
          tagHtml = '<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">' +
            '<span class="px-1.5 py-0.2 rounded bg-ok-soft text-ok border border-ok-line shrink-0">🏷️ 已标记</span>' +
            '<span class="px-1.5 py-0.2 rounded border shrink-0 ' + energyBadgeCls + '">' + energyText + '</span>' +
            '<span class="text-warn truncate">' + escapeHtml(tr.analysis.mood || '') + '</span>' +
          '</div>' +
          (metaParts.length ? '<div class="text-[10px] text-ink-muted mt-0.5 line-clamp-1">' + escapeHtml(metaParts.join(' · ')) + '</div>' : '');
        }
        return '<div data-track-id="' + safeId + '" ' + (!bgmWorkbenchState.config?.multi_track ? 'onclick="selectBgmTrack(this.dataset.trackId)"' : '') + ' class="flex items-center justify-between gap-3 p-3 rounded-xl border transition ' + cardCls + '">' +
          '<div class="flex items-center gap-2.5 min-w-0">' +
            (!bgmWorkbenchState.config?.multi_track ? '<input type="radio" name="bgmTrackRadio" data-track-id="' + safeId + '" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); selectBgmTrack(this.dataset.trackId)" class="accent-amber-400 w-4 h-4 shrink-0 cursor-pointer" />' : '') +
            '<div class="min-w-0">' +
              '<div class="text-xs font-bold text-ink truncate flex items-center gap-2">' +
                '<span>' + escapeHtml(tr.title || tr.file_name) + '</span>' +
                (isSelected ? '<span class="px-1.5 py-0.2 rounded text-[9px] bg-warn-soft text-warn border border-warn-line shrink-0">当前选中</span>' : '') +
              '</div>' +
              '<div class="text-[10px] text-ink-muted font-mono mt-0.5 truncate">' + escapeHtml(tr.file_name) + ' · ' + durLabel + ' · ' + formatFileSize(tr.size_bytes) + '</div>' +
              tagHtml +
            '</div>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 shrink-0">' +
            '<button type="button" data-track-id="' + safeId + '" onclick="event.stopPropagation(); previewBgmTrack(this.dataset.trackId)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-subtle hover:bg-muted text-warn border border-line transition cursor-pointer">▶ 试听</button>' +
            (tr.analysis ? '<button type="button" data-track-id="' + safeId + '" onclick="event.stopPropagation(); clearBgmTrackAnalysis(this.dataset.trackId)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-subtle hover:bg-accent-soft text-accent border border-line hover:border-ink transition cursor-pointer" title="清除标签，下次自动配乐时重新听歌分析">🔄</button>' : '') +
            '<button type="button" data-track-id="' + safeId + '" onclick="event.stopPropagation(); deleteBgmTrack(this.dataset.trackId)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-subtle hover:bg-danger-soft text-danger border border-line hover:border-danger-line transition cursor-pointer" title="从当前工程删除该 BGM">🗑</button>' +
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
        '<div class="p-2.5 rounded-xl bg-subtle border border-accent-line space-y-0.5">' +
          '<div class="text-[11px] font-bold text-accent">' + escapeHtml(r.title) + ' <span class="text-[10px] font-mono text-warn">(' + escapeHtml(r.bpm_range || '') + ')</span></div>' +
          (r.instrumentation ? '<div class="text-[10px] text-ink-secondary">乐器：' + escapeHtml(r.instrumentation) + '</div>' : '') +
          (r.fit_reason ? '<div class="text-[10px] text-ink-muted">' + escapeHtml(r.fit_reason) + '</div>' : '') +
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
        badge.textContent = '参数检查（未试听成片）';
        badge.className = audit.grade === 'A+' || audit.grade === 'A'
          ? 'px-2 py-0.5 rounded text-[10px] font-black bg-ok-soft text-ok border border-ok-line'
          : (audit.grade === '待配置'
            ? 'px-2 py-0.5 rounded text-[10px] font-black bg-subtle text-ink-secondary border border-line'
            : 'px-2 py-0.5 rounded text-[10px] font-black bg-warn-soft text-warn border border-warn-line');
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
      const files = Array.from(input?.files || []);
      if (files.length === 0) return;
      const btn = document.getElementById('btnUploadBgm');
      if (btn) {
        btn.disabled = true;
      }
      let uploadedCount = 0;
      const failures = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (btn) {
            btn.textContent = files.length > 1
              ? ('⏳ 上传中 (' + (i + 1) + '/' + files.length + ')...')
              : '⏳ 上传解析中...';
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
              failures.push(file.name + ': ' + (data.error || res.status));
              continue;
            }
            bgmWorkbenchState = {
              config: data.config,
              modelInfo: data.modelInfo,
              totalDurationMs: data.totalDurationMs || 0,
              scenesCount: data.scenesCount || 0,
            };
            uploadedCount++;
          } catch (err) {
            failures.push(file.name + ': ' + err.message);
          }
        }
        if (uploadedCount > 0) {
          renderBgmModal();
        }
        if (failures.length === 0) {
          showToast(files.length === 1
            ? ('✅ 已上传并选中 BGM：' + files[0].name)
            : ('✅ 已批量上传 ' + uploadedCount + ' 首 BGM 到全局共享曲库'));
        } else if (uploadedCount > 0) {
          showToast('⚠️ 成功上传 ' + uploadedCount + ' 首，失败 ' + failures.length + ' 首：' + failures[0]);
        } else {
          showToast('❌ 上传失败: ' + failures[0]);
        }
      } finally {
        if (input) input.value = '';
        if (btn) {
          btn.disabled = false;
          btn.textContent = '📤 上传本地 BGM';
        }
      }
    }

    async function deleteBgmTrack(trackId) {
      if (!window.confirm('确定删除这首 BGM 音频文件吗？删除后全局曲库及其他工程也将不再显示该曲目。')) return;
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

    async function clearBgmTrackAnalysis(trackId) {
      try {
        const res = await fetch('/api/bgm/clear-track-analysis?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId, trackId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast('❌ 清除标签失败: ' + (data.error || res.status));
          return;
        }
        bgmWorkbenchState = {
          config: data.config,
          modelInfo: data.modelInfo,
          totalDurationMs: data.totalDurationMs || 0,
          scenesCount: data.scenesCount || 0,
        };
        renderBgmModal();
        showToast('🔄 已清除该曲目标签，下次自动配乐时将重新听歌分析');
      } catch (err) {
        showToast('❌ 清除标签异常: ' + err.message);
      }
    }

    let bgmAutoPollToken = 0;
    async function pollAutoBgm(projectId) {
      const token = ++bgmAutoPollToken;
      const button = document.getElementById('btnAutoBgm');
      const status = document.getElementById('bgmAutoStatus');
      while (token === bgmAutoPollToken) {
        try {
          const r = await fetch('/api/bgm/auto-status?project=' + encodeURIComponent(projectId));
          const data = await r.json();
          const job = data.job || {};
          if (activeProjectId !== projectId) break;
          if (status && (job.status === 'running' || job.status === 'error')) {
            status.textContent = job.error || job.progress || '正在配乐中…';
          }
          if (button) { button.disabled = job.status === 'running'; button.textContent = job.status === 'running' ? '⏳ AI 配乐中…' : '✨ AI 自动配乐'; }
          if (job.status !== 'running') {
            if (job.status === 'complete') {
              await loadBgmState();
              const reuseNote = (typeof job.cachedCount === 'number' || typeof job.analyzedCount === 'number')
                ? ('（复用 ' + (job.cachedCount || 0) + ' 首已有标签，新听 ' + (job.analyzedCount || 0) + ' 首）')
                : '';
              if (status) {
                status.textContent = (job.compiledToRenderProps
                  ? 'AI 配乐已应用到成片。请试听后再导出。'
                  : '方案已保存，但尚未生成渲染配置，请检查工程素材。') + reuseNote;
              }
            }
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err) { if (status) status.textContent = '读取配乐进度失败：' + err.message; if (button) button.disabled = false; break; }
      }
    }
    async function startAutoBgm() {
      if (!bgmWorkbenchState.config?.tracks?.length) { showToast('请先上传音乐'); return; }
      const status = document.getElementById('bgmAutoStatus');
      const button = document.getElementById('btnAutoBgm');
      const projectId = activeProjectId;
      if (button) button.disabled = true;
      if (status) status.textContent = '正在启动 AI 自动配乐…';
      try {
        const res = await fetch('/api/bgm/auto?project=' + encodeURIComponent(projectId), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,bgmModel:visualConfig.bgmModel,baseUrl:visualConfig.baseUrl,apiKey:visualConfig.apiKey})});
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '启动失败');
        await pollAutoBgm(projectId);
      } catch (err) { if (status) status.textContent = '自动配乐失败：' + err.message; if (button) button.disabled = false; }
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
            multi_track: Boolean(cfg.multi_track),
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
