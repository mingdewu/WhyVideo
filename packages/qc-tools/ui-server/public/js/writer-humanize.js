// writer-humanize.js — shared classic-script scope; loaded before studio initialization.
let selectedHumanizeStyle = 'humorous';
    let rawScriptBackupBeforeHumanize = '';
    let latestHumanizedText = '';
    let humanizeDiffMode = 'split';
    let pendingHumanizeMeta = null;

    const HUMANIZE_STYLE_LABELS = {
      humorous: '幽默风趣',
      suspense: '悬疑反转',
      colloquial: '亲切大白话',
    };

    function updateHumanizeVersionUI(meta, isPreview = false) {
      const badge = document.getElementById('wHumanizeVersionBadge');
      const btn = document.getElementById('btnExecuteHumanize');
      const acceptBtn = document.getElementById('btnAcceptHumanize');
      const styleName = meta?.style ? (HUMANIZE_STYLE_LABELS[meta.style] || meta.style) : '';
      const ver = meta?.version || '';

      if (badge) {
        if (isPreview && meta) {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
          badge.textContent = `⏳ 待确认替换 · ${ver}${styleName ? ' · ' + styleName : ''}`;
        } else if (meta && meta.version) {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          badge.textContent = `✅ 已修复 · ${ver}${styleName ? ' · ' + styleName : ''}${meta.humanized_at ? ' · ' + meta.humanized_at : ''}`;
        } else {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-gray-800 text-gray-400 border border-gray-700';
          badge.textContent = '📄 原稿未修复 (v1.0)';
        }
      }

      if (btn) {
        if (isPreview && meta) {
          btn.disabled = false;
          btn.className = 'px-4 py-2 text-xs font-black rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white transition shadow-lg flex items-center gap-1.5 shrink-0 cursor-pointer';
          btn.innerHTML = '<span>✅ 确认替换定稿文案</span>';
        } else if (meta && meta.version) {
          btn.disabled = false;
          btn.className = 'px-4 py-2 text-xs font-black rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:brightness-110 text-white transition shadow-lg flex items-center gap-1.5 shrink-0 cursor-pointer';
          btn.innerHTML = '<span>🪄 再次执行真人化修复</span>';
        } else {
          btn.disabled = false;
          btn.className = 'px-4 py-2 text-xs font-black rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:brightness-110 text-white transition shadow-lg flex items-center gap-1.5 shrink-0 cursor-pointer';
          btn.innerHTML = '<span>🪄 启动全篇 AI 真人化修复</span>';
        }
      }

      if (acceptBtn) {
        if (isPreview && meta) {
          acceptBtn.disabled = false;
          acceptBtn.className = 'px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black shadow transition cursor-pointer';
          acceptBtn.textContent = '✅ 确认替换定稿文案';
        } else if (meta && meta.version) {
          acceptBtn.disabled = true;
          acceptBtn.className = 'px-3 py-1 rounded-lg bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold cursor-default';
          acceptBtn.textContent = '✅ 已修复';
        }
      }
    }

    function setStep5StageMode(mode = 'editor') {
      const editorStage = document.getElementById('wFinalScriptEditorStage');
      const humanizeStage = document.getElementById('wHumanizeAuditBox');
      const finalizeStage = document.getElementById('wFinalizeReview');
      if (editorStage) editorStage.classList.toggle('hidden', mode !== 'editor');
      if (humanizeStage) humanizeStage.classList.toggle('hidden', mode !== 'humanize_diff');
      if (finalizeStage) finalizeStage.classList.toggle('hidden', mode !== 'finalize_diff');
    }

    function setHumanizeDiffMode(mode) {
      humanizeDiffMode = mode;
      const btnU = document.getElementById('btnDiffUnified');
      const btnS = document.getElementById('btnDiffSplit');
      if (btnU && btnS) {
        btnU.className = mode === 'unified'
          ? 'px-2.5 py-0.5 rounded bg-violet-600 text-white font-bold cursor-pointer'
          : 'px-2.5 py-0.5 rounded text-gray-400 hover:text-white font-bold cursor-pointer';
        btnS.className = mode === 'split'
          ? 'px-2.5 py-0.5 rounded bg-violet-600 text-white font-bold cursor-pointer'
          : 'px-2.5 py-0.5 rounded text-gray-400 hover:text-white font-bold cursor-pointer';
      }
      renderHumanizeDiffView();
    }

    function tokenizeScriptForDiff(text) {
      const lines = String(text || '').split(/\n+/);
      const tokens = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t || /^={10,}$/.test(t)) continue;
        if (t.startsWith('【') && t.endsWith('】')) {
          tokens.push(t);
          continue;
        }
        const sentences = t.split(/(?<=[。！？!?])\s*/).map((s) => s.trim()).filter(Boolean);
        for (const s of sentences) tokens.push(s);
      }
      return tokens;
    }

    function computeLineDiff(beforeArr, afterArr) {
      const n = beforeArr.length;
      const m = afterArr.length;
      // 长度适中时用标准 LCS；超长时先剥除公共前后缀，保证毫秒级响应
      let prefix = 0;
      while (prefix < n && prefix < m && beforeArr[prefix] === afterArr[prefix]) prefix++;
      let suffix = 0;
      while (suffix < (n - prefix) && suffix < (m - prefix) && beforeArr[n - 1 - suffix] === afterArr[m - 1 - suffix]) suffix++;

      const result = [];
      for (let i = 0; i < prefix; i++) {
        result.push({ type: 'same', text: beforeArr[i], oldLine: i + 1, newLine: i + 1 });
      }

      const aMid = beforeArr.slice(prefix, n - suffix);
      const bMid = afterArr.slice(prefix, m - suffix);
      const am = aMid.length;
      const bm = bMid.length;

      if (am * bm <= 200000) {
        const dp = Array.from({ length: am + 1 }, () => new Int32Array(bm + 1));
        for (let i = am - 1; i >= 0; i--) {
          for (let j = bm - 1; j >= 0; j--) {
            dp[i][j] = aMid[i] === bMid[j]
              ? dp[i + 1][j + 1] + 1
              : Math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
        let i = 0, j = 0;
        while (i < am && j < bm) {
          if (aMid[i] === bMid[j]) {
            result.push({ type: 'same', text: aMid[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 });
            i++; j++;
          } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            result.push({ type: 'del', text: aMid[i], oldLine: prefix + i + 1 });
            i++;
          } else {
            result.push({ type: 'add', text: bMid[j], newLine: prefix + j + 1 });
            j++;
          }
        }
        while (i < am) { result.push({ type: 'del', text: aMid[i], oldLine: prefix + i + 1 }); i++; }
        while (j < bm) { result.push({ type: 'add', text: bMid[j], newLine: prefix + j + 1 }); j++; }
      } else {
        for (let i = 0; i < am; i++) result.push({ type: 'del', text: aMid[i], oldLine: prefix + i + 1 });
        for (let j = 0; j < bm; j++) result.push({ type: 'add', text: bMid[j], newLine: prefix + j + 1 });
      }

      for (let k = 0; k < suffix; k++) {
        const oi = n - suffix + k;
        const ni = m - suffix + k;
        result.push({ type: 'same', text: beforeArr[oi], oldLine: oi + 1, newLine: ni + 1 });
      }
      return result;
    }

    function renderHumanizeDiffView() {
      renderScriptDiff({ bodyId: 'wHumanizeDiffBody', addedId: 'wDiffAddedCount', removedId: 'wDiffRemovedCount', changesId: 'wDiffChangesOnlyCheckbox', before: rawScriptBackupBeforeHumanize, after: latestHumanizedText || document.getElementById('wFinalScriptFullText')?.value || '', mode: humanizeDiffMode, leftLabel: '修复前原稿', rightLabel: '修复后新版' });
    }

    function renderScriptDiff({ bodyId, addedId, removedId, changesId, before, after, mode, leftLabel, rightLabel }) {
      const bodyEl = document.getElementById(bodyId);
      if (!bodyEl) return;
      const beforeTokens = tokenizeScriptForDiff(before);
      const afterTokens = tokenizeScriptForDiff(after);
      const diffOps = computeLineDiff(beforeTokens, afterTokens);

      const addedCount = diffOps.filter((o) => o.type === 'add').length;
      const removedCount = diffOps.filter((o) => o.type === 'del').length;
      const addEl = document.getElementById(addedId);
      const remEl = document.getElementById(removedId);
      if (addEl) addEl.textContent = addedCount;
      if (remEl) remEl.textContent = removedCount;

      const changesOnly = Boolean(document.getElementById(changesId)?.checked);
      const visibleOps = changesOnly ? diffOps.filter((o) => o.type !== 'same') : diffOps;

      const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      if (visibleOps.length === 0) {
        bodyEl.innerHTML = '<div class="p-4 text-center text-gray-500">前后语句完全一致，未产生文字差异。</div>';
        return;
      }

      if (mode === 'unified') {
        bodyEl.innerHTML = visibleOps
          .map((op) => {
            if (op.type === 'del') {
              return `<div class="flex items-start gap-2 px-3 py-1.5 bg-rose-950/55 border-l-2 border-rose-500 text-rose-200"><span class="w-8 shrink-0 font-mono text-[11px] text-right text-rose-400/70 select-none">${op.oldLine}</span><span class="w-4 shrink-0 font-mono text-rose-400 font-black select-none">-</span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
            }
            if (op.type === 'add') {
              return `<div class="flex items-start gap-2 px-3 py-1.5 bg-emerald-950/50 border-l-2 border-emerald-500 text-emerald-200"><span class="w-8 shrink-0 font-mono text-[11px] text-right text-emerald-400/70 select-none">${op.newLine}</span><span class="w-4 shrink-0 font-mono text-emerald-400 font-black select-none">+</span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
            }
            return `<div class="flex items-start gap-2 px-3 py-1.5 bg-transparent text-gray-300"><span class="w-8 shrink-0 font-mono text-[11px] text-right text-gray-600 select-none">${op.newLine}</span><span class="w-4 shrink-0 font-mono text-gray-600 select-none"> </span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
          })
          .join('');
      } else {
        // GitHub 风格左右并排 Split Diff：将连续的 del 与 add 配对对齐
        const rows = [];
        let idx = 0;
        while (idx < visibleOps.length) {
          const cur = visibleOps[idx];
          if (cur.type === 'same') {
            rows.push({ left: cur, right: cur });
            idx++;
          } else {
            const dels = [];
            const adds = [];
            while (idx < visibleOps.length && visibleOps[idx].type !== 'same') {
              if (visibleOps[idx].type === 'del') dels.push(visibleOps[idx]);
              else adds.push(visibleOps[idx]);
              idx++;
            }
            const maxLen = Math.max(dels.length, adds.length);
            for (let k = 0; k < maxLen; k++) {
              rows.push({ left: dels[k] || null, right: adds[k] || null });
            }
          }
        }
        const renderSplitCell = (op, side) => {
          if (!op) {
            return '<div class="flex items-stretch min-w-0 bg-[#161b22]/70 text-gray-700 select-none"><span class="w-10 shrink-0 font-mono border-r border-gray-800/50 bg-[#161b22]/90"></span><span class="flex-1 px-2.5 py-1.5"></span></div>';
          }
          const isDel = side === 'left' && op.type === 'del';
          const isAdd = side === 'right' && op.type === 'add';
          const lineNo = side === 'left' ? op.oldLine : op.newLine;
          if (isDel) {
            return `<div class="flex items-stretch min-w-0 bg-rose-950/45 border-l-2 border-rose-500 text-rose-100"><span class="w-10 shrink-0 font-mono px-1.5 py-1.5 text-right text-[11px] text-rose-400/80 bg-rose-950/60 border-r border-rose-900/40 select-none">${lineNo}</span><span class="w-5 shrink-0 font-mono py-1.5 text-center text-rose-400 font-black select-none">-</span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed px-2.5 py-1.5 whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
          }
          if (isAdd) {
            return `<div class="flex items-stretch min-w-0 bg-emerald-950/40 border-l-2 border-emerald-500 text-emerald-100"><span class="w-10 shrink-0 font-mono px-1.5 py-1.5 text-right text-[11px] text-emerald-400/80 bg-emerald-950/55 border-r border-emerald-900/40 select-none">${lineNo}</span><span class="w-5 shrink-0 font-mono py-1.5 text-center text-emerald-400 font-black select-none">+</span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed px-2.5 py-1.5 whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
          }
          return `<div class="flex items-stretch min-w-0 bg-[#0d1117] text-gray-300"><span class="w-10 shrink-0 font-mono px-1.5 py-1.5 text-right text-[11px] text-gray-600 bg-[#0d1117] border-r border-gray-800/60 select-none">${lineNo}</span><span class="w-5 shrink-0 font-mono py-1.5 text-center text-gray-700 select-none"> </span><span class="flex-1 min-w-0 font-sans text-[13px] leading-relaxed px-2.5 py-1.5 whitespace-pre-wrap break-words">${escHtml(op.text)}</span></div>`;
        };
        bodyEl.innerHTML =
          `<div class="grid grid-cols-2 bg-[#161b22] text-[11px] font-bold text-gray-300 sticky top-0 z-10 border-b border-gray-800 divide-x divide-gray-800"><div class="px-3 py-2 flex items-center gap-1.5 text-rose-200/90">📄 ${escHtml(leftLabel)}</div><div class="px-3 py-2 flex items-center gap-1.5 text-emerald-200/90">✨ ${escHtml(rightLabel)}</div></div>` +
          rows
            .map((r) => `<div class="grid grid-cols-2 divide-x divide-gray-800">${renderSplitCell(r.left, 'left')}${renderSplitCell(r.right, 'right')}</div>`)
            .join('');
      }
    }

    async function acceptHumanizedScript() {
      const btn = document.getElementById('btnAcceptHumanize');
      const topBtn = document.getElementById('btnExecuteHumanize');
      const badge = document.getElementById('wHumanizePendingBadge');
      const textarea = document.getElementById('wFinalScriptFullText');

      if (latestHumanizedText && textarea) {
        textarea.value = latestHumanizedText;
        updateFinalScriptLiveStats();
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在替换并保存...';
      }
      if (topBtn) {
        topBtn.disabled = true;
        topBtn.innerHTML = '<span>⏳ 正在替换并保存...</span>';
      }

      const nextCount = pendingHumanizeMeta?.count || ((writerData?.finalScript?.humanize_meta?.count || 0) + 1);
      const nextVer = pendingHumanizeMeta?.version || ('v2.' + String(nextCount).padStart(2, '0'));
      const metaToSave = {
        count: nextCount,
        version: nextVer,
        style: pendingHumanizeMeta?.style || selectedHumanizeStyle,
        humanized_at: pendingHumanizeMeta?.humanized_at || new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      };
      try {
        const saved = await saveWriterPartManual('finalScript', metaToSave);
        if (!saved?.ok) {
          alert('替换并保存定稿失败：' + (saved?.error || '请重试'));
          return;
        }
        pendingHumanizeMeta = null;
        latestHumanizedText = '';
        updateHumanizeVersionUI(writerData?.finalScript?.humanize_meta || metaToSave, false);
        closeHumanizeWorkbenchModal();
        setStep5StageMode('editor');
        if (badge) {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          badge.textContent = `✅ 已替换定稿文案并保存 (${metaToSave.version})`;
        }
        showToast('✅ 已将修复后的文字置换到「完整长视频定稿文案」并保存！');
        showCompletionModal({
          icon: '✅',
          title: '定稿文案替换已完成',
          message: '修复后的文案已替换到「完整长视频定稿文案」并保存！',
          detail: '当前版本：' + metaToSave.version,
        });
      } finally {
        if (btn) btn.disabled = false;
        if (topBtn) topBtn.disabled = false;
      }
    }

    function selectHumanizeStyle(style) {
      selectedHumanizeStyle = style;
      const btnHumor = document.getElementById('btnStyleHumor');
      const btnSuspense = document.getElementById('btnStyleSuspense');
      const btnColloquial = document.getElementById('btnStyleColloquial');

      const activeClass = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-violet-600 text-white transition shadow cursor-pointer';
      const inactiveClass = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-900 text-gray-400 hover:text-white border border-gray-800 transition cursor-pointer';

      if (btnHumor) btnHumor.className = style === 'humorous' ? activeClass : inactiveClass;
      if (btnSuspense) btnSuspense.className = style === 'suspense' ? activeClass : inactiveClass;
      if (btnColloquial) btnColloquial.className = style === 'colloquial' ? activeClass : inactiveClass;

      // 切换人设风格时，若当前不处于待确认状态，则允许重新启动修复
      if (!pendingHumanizeMeta) {
        updateHumanizeVersionUI(null, false);
      }
    }

    function openHumanizeWorkbenchModal() {
      const modal = document.getElementById('humanizeWorkbenchModal');
      if (modal) modal.classList.remove('hidden');
    }

    function closeHumanizeWorkbenchModal() {
      const modal = document.getElementById('humanizeWorkbenchModal');
      if (modal) modal.classList.add('hidden');
    }

    async function executeFullScriptHumanize() {
      // 若已完成 AI 修复、正处于等待用户确认状态，点击主按钮即执行「确认替换定稿文案」
      if (pendingHumanizeMeta && latestHumanizedText) {
        await acceptHumanizedScript();
        return;
      }

      const textarea = document.getElementById('wFinalScriptFullText');
      let content = textarea.value.trim();

      if (!content && writerData?.chapters && writerData.chapters.length > 0) {
        content = writerData.chapters.map((c) => c.full_chapter_narration || Object.values(c.sections || {}).join('\n\n')).join('\n\n');
        textarea.value = content;
      }

      if (!content) {
        alert('请先在下方输入或生成待修复的文案！');
        return;
      }

      const btn = document.getElementById('btnExecuteHumanize');
      const model = document.getElementById('wInputModel')?.value || 'deepseek/deepseek-chat';
      const auditBox = document.getElementById('wHumanizeAuditBox');
      const auditContent = document.getElementById('wHumanizeAuditContent');
      const auditSummary = document.getElementById('wHumanizeAuditSummary');
      const revertBtn = document.getElementById('btnRevertScript');

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在全篇去AI味、去冗余与幽默重构 (约15~30秒)...</span>';
      rawScriptBackupBeforeHumanize = content;
      let humanizedSucceeded = false;

      try {
        const res = await fetch('/api/writer/ai/humanize-script?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            style: selectedHumanizeStyle,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.result) {
          const resObj = data.result;
          // 仅暂存修复结果用于对比预览，不直接覆盖「完整长视频定稿文案」，待用户点击确认后再置换
          latestHumanizedText = resObj.humanized_text;
          setWriterPersistenceStatus('dirty', '● AI 修复已完成，请点击「✅ 确认替换定稿文案」生效');

          const nextCount = (writerData?.finalScript?.humanize_meta?.count || 0) + 1;
          const nextVer = 'v2.' + String(nextCount).padStart(2, '0');
          pendingHumanizeMeta = {
            count: nextCount,
            version: nextVer,
            style: selectedHumanizeStyle,
            humanized_at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          };
          humanizedSucceeded = true;
          updateHumanizeVersionUI(pendingHumanizeMeta, true);

          const badge = document.getElementById('wHumanizePendingBadge');
          if (badge) {
            badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
            badge.textContent = `⏳ ${nextVer} 待确认 · 确认后将置换下方定稿文案`;
          }

          if (auditBox && auditContent) {
            const stats = resObj.stats || {};
            const wordCount = resObj.humanized_text.length;
            auditContent.innerHTML = `
              <div class="bg-gray-900/90 p-2 rounded border border-gray-800">
                <div class="text-[10px] text-gray-500">字数变化 / 脱脂率</div>
                <div class="text-xs font-bold text-white">${stats.original_chars || content.length} ➔ ${stats.humanized_chars || wordCount} 字 <span class="text-emerald-400">(${stats.compression_rate || '脱脂精简'})</span></div>
              </div>
              <div class="bg-gray-900/90 p-2 rounded border border-gray-800">
                <div class="text-[10px] text-gray-500">已斩断 AI 八股词</div>
                <div class="text-xs font-bold text-rose-300 truncate" title="${(stats.removed_ai_phrases || []).join(', ')}">${(stats.removed_ai_phrases || ['总而言之', '不可否认']).slice(0, 2).join('、')}等</div>
              </div>
              <div class="bg-gray-900/90 p-2 rounded border border-gray-800">
                <div class="text-[10px] text-gray-500">碎化长复合句</div>
                <div class="text-xs font-bold text-blue-300">${stats.split_long_sentences_count || 30}+ 处呼吸短句</div>
              </div>
              <div class="bg-gray-900/90 p-2 rounded border border-gray-800">
                <div class="text-[10px] text-gray-500">注入生活幽默比喻</div>
                <div class="text-xs font-bold text-amber-300">${stats.humorous_analogies_count || 8} 处生动笑点</div>
              </div>
            `;
            auditSummary.textContent = resObj.audit_report || '全篇文案已由 AI 完成真人声学与幽默化重构，节奏紧凑、听感流畅自然！';
            closeHumanizeWorkbenchModal();
            setStep5StageMode('humanize_diff');
            setHumanizeDiffMode(humanizeDiffMode);
            document.getElementById('wStep5MainStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }

          if (revertBtn) revertBtn.classList.remove('hidden');
          showToast('🎉 AI 修复已完成！请对比审阅后点击「✅ 确认替换定稿文案」。');
          showCompletionModal({
            icon: '🪄',
            title: '全篇 AI 真人化修复已完成',
            message: '已完成全篇去 AI 味与口语化重构。',
            detail: '请在对比视图审阅修改差异，确认后点击「✅ 确认替换定稿文案」。',
          });
        } else {
          showToast('❌ 修复失败：' + (data.error || '未知异常'));
          alert('修复文案失败: ' + (data.error || '未知异常'));
        }
      } catch (err) {
        showToast('❌ 文案修复请求异常：' + err.message);
        alert('文案修复请求异常: ' + err.message);
      } finally {
        if (!humanizedSucceeded) {
          btn.disabled = false;
          updateHumanizeVersionUI(writerData?.finalScript?.humanize_meta || null, false);
        }
      }
    }

    function revertHumanizedScript() {
      if (rawScriptBackupBeforeHumanize) {
        document.getElementById('wFinalScriptFullText').value = rawScriptBackupBeforeHumanize;
        updateFinalScriptLiveStats();
      }
      latestHumanizedText = '';
      pendingHumanizeMeta = null;
      setWriterPersistenceStatus('saved', '✅ 已还原原稿');
      updateHumanizeVersionUI(writerData?.finalScript?.humanize_meta || null, false);
      const revertBtn = document.getElementById('btnRevertScript');
      if (revertBtn) revertBtn.classList.add('hidden');
      setStep5StageMode('editor');
      showToast('↩️ 已放弃本次修复并保持原稿。');
    }

    function copyHumanizedScript() {
      const text = latestHumanizedText || document.getElementById('wFinalScriptFullText').value;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        showToast('📋 已复制全篇修复文案到剪贴板！');
      });
    }

    function loadSelectedScriptToStep5ForHumanize() {
      if (!step1SelectedScriptText) {
        alert('请先选择要导入的文案！');
        return;
      }
      document.getElementById('wFinalScriptFullText').value = step1SelectedScriptText;
      updateFinalScriptSaveButton();
      latestHumanizedText = '';
      pendingHumanizeMeta = null;
      updateHumanizeVersionUI(null, false);
      setStep5StageMode('editor');
      const wordCount = step1SelectedScriptText.length;
      document.getElementById('wFinalScriptWords').textContent = wordCount;
      document.getElementById('wFinalScriptMin').textContent = (wordCount / 240).toFixed(1);
      setWriterStep(5);
      showToast('✨ 已将文案载入阶段 5，现在可一键执行全篇 AI 修复！');
    }

    async function syncWriterToProducerUI() {
      const fullText = document.getElementById('wFinalScriptFullText').value.trim();
      const title = document.getElementById('wInputTitle').value.trim();

      if (!fullText && !writerData?.finalScript) {
        alert('当前没有可同步的终稿文案，请先在阶段 5 统稿或粘贴文案！');
        return;
      }

      showToast('🚀 正在保存定稿并同步切镜至制作台（自动保留已有素材）...');
      try {
        const res = await fetch('/api/writer/sync-to-producer?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            content: fullText,
            finalScript: writerData?.finalScript,
            preserveAssets: true,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          const preservedTip = data.preservedAssetsCount > 0 ? `，自动保留 ${data.preservedAssetsCount} 个已有素材` : '';
          showToast(`🎉 成功同步！共 ${data.totalScenes} 个镜头${preservedTip}，正在进入制作台...`);
          switchWorkspaceTab('producer');
          await loadProjects();
          await loadWorkflow();
          showCompletionModal({
            icon: '🚀',
            title: '文案定稿同步已完成',
            message: '已同步至视觉分镜台，共 ' + data.totalScenes + ' 个镜头' + preservedTip + '！',
          });
        } else {
          alert('流转制作台失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        alert('流转异常: ' + err.message);
      }
    }

    function loadSampleMaterialToWriter() {
      document.getElementById('wInputTitle').value = '富士山，日本象征，富士山为什么如此出名';
      document.getElementById('wInputMaterials').value = `【参考资料 1】：日本气象厅火山调查档案
富士山标高 3776 米，为日本最高成层火山。地质演变经历小御岳、古富士（约10万年前）与新富士（约1万年前）三阶段。公元864年贞观大喷发喷出大量熔岩填平部分湖泊，形成青木原树海与富士五湖雏形。

【参考资料 2】：神道与民间信仰史
古代因狂暴喷发被视为神灵化身，建立浅间神社以镇平火山神怒。江户时期诞生“富士讲”，庶民阶层通过互助金制度组织群体登顶朝圣，并修建人造富士冢。

【参考资料 3】：艺术与全球传播
江户晚期葛饰北斋创作浮世绘《富岳三十六景》，大量使用普鲁士蓝（ベロ藍），随后通过万国博览会传入欧洲，对印象派画家及德彪西音乐创作产生深刻影响。

【参考资料 4】：现代治理
2013年登录世界文化遗产（信仰的对象与艺术的源泉）。近年面临游客拥堵、弹丸登山安全隐患，2024年吉田路线推行限流与通行费配额管理。`;
      document.getElementById('wMaterialWordCount').textContent = `已输入 ${document.getElementById('wInputMaterials').value.length} 字资料`;
      showToast('💡 已成功填入富士山真实考证资料范例！');
    }

    function switchStep1SubTab(tab) {
      const isCreate = tab === 'create';
      const btnCreate = document.getElementById('wStep1SubTabCreateBtn');
      const btnImport = document.getElementById('wStep1SubTabImportBtn');
      const viewCreate = document.getElementById('wStep1SubViewCreate');
      const viewImport = document.getElementById('wStep1SubViewImport');

      if (btnCreate && btnImport && viewCreate && viewImport) {
        btnCreate.className = isCreate
          ? 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-purple-600 text-white shadow cursor-pointer'
          : 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';

        btnImport.className = !isCreate
          ? 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-violet-600 text-white shadow cursor-pointer'
          : 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';

        viewCreate.classList.toggle('hidden', !isCreate);
        viewImport.classList.toggle('hidden', isCreate);
      }

      if (!isCreate) {
        loadStep1ScannedScripts();
      }
    }

    function openWriterImportDirectly() {
      setWriterStep(1);
      switchStep1SubTab('import');
      const el = document.getElementById('wPanelStep1');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
