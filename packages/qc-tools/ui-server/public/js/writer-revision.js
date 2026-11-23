// writer-revision.js — shared classic-script scope; loaded before studio initialization.
let pendingRevisionPlan = null;
    let pendingRevisionFacts = [];
    let pendingRevisionResult = null;
    let revisionDiffMode = 'split';
    let currentRevisionQuickChips = [];

    function renderRevisionQuickChipsBar(chips = []) {
      currentRevisionQuickChips = Array.isArray(chips) ? chips.map((c) => ({ ...c })) : [];
      const bar = document.getElementById('wRevisionQuickChipsBar');
      if (!bar) return;
      const labelHtml = '<span class="text-gray-400 font-semibold">快捷指令：</span>';
      if (currentRevisionQuickChips.length === 0) {
        bar.innerHTML = labelHtml + '<span class="text-gray-500">点击右侧可配置快捷指令</span>';
        return;
      }
      bar.innerHTML = labelHtml + currentRevisionQuickChips
        .map((c, idx) => `<button type="button" data-chip-idx="${idx}" onclick="applyRevisionQuickChipByIndex(Number(this.dataset.chipIdx))" title="${escapeHtml(c.prompt)}" class="px-2 py-0.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700 text-amber-200 transition cursor-pointer">${escapeHtml(c.label)}</button>`)
        .join('');
    }

    function applyRevisionQuickChipByIndex(idx) {
      const chip = currentRevisionQuickChips[idx];
      if (!chip || !chip.prompt) return;
      appendRevisionQuickChip(chip.prompt);
    }

    function openEditorialRevisionWorkbench() {
      if (pendingRevisionResult) {
        openEditorialRevisionModal('diff');
      } else if (pendingRevisionPlan) {
        openEditorialRevisionModal('plan');
      } else {
        openEditorialRevisionModal('input');
        setTimeout(() => document.getElementById('wRevisionInstructionInput')?.focus(), 40);
      }
    }

    function openEditorialRevisionModal(step = 'input') {
      const modal = document.getElementById('editorialRevisionModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      switchEditorialRevisionModalStep(step);
      syncRevisionPendingBanner();
    }

    function closeEditorialRevisionModal() {
      document.getElementById('editorialRevisionModal')?.classList.add('hidden');
      syncRevisionPendingBanner();
    }

    function switchEditorialRevisionModalStep(step = 'input') {
      let target = step;
      if (target === 'diff' && !pendingRevisionResult) {
        target = pendingRevisionPlan ? 'plan' : 'input';
      }
      if (target === 'plan' && !pendingRevisionPlan) {
        target = 'input';
      }

      const inputBox = document.getElementById('wRevisionInputBox');
      const planBox = document.getElementById('wRevisionPlanBox');
      const diffBox = document.getElementById('wRevisionDiffBox');
      const btnInput = document.getElementById('btnRevModalStepInput');
      const btnPlan = document.getElementById('btnRevModalStepPlan');
      const btnDiff = document.getElementById('btnRevModalStepDiff');

      if (inputBox) inputBox.classList.toggle('hidden', target !== 'input');
      if (planBox) planBox.classList.toggle('hidden', target !== 'plan');
      if (diffBox) diffBox.classList.toggle('hidden', target !== 'diff');

      if (btnInput) {
        btnInput.className = target === 'input'
          ? 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer bg-amber-500 text-gray-950'
          : 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer text-gray-300 hover:text-white';
      }
      if (btnPlan) {
        btnPlan.disabled = !pendingRevisionPlan;
        btnPlan.className = target === 'plan'
          ? 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer bg-amber-500 text-gray-950'
          : 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';
      }
      if (btnDiff) {
        btnDiff.disabled = !pendingRevisionResult;
        btnDiff.className = target === 'diff'
          ? 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer bg-emerald-500 text-gray-950'
          : 'px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed';
      }

      if (target === 'diff') {
        renderRevisionDiffView();
      }
    }

    function syncRevisionPendingBanner() {
      const dot = document.getElementById('wRevisionPendingDot');
      const modal = document.getElementById('editorialRevisionModal');
      if (!dot) return;
      const modalHidden = !modal || modal.classList.contains('hidden');
      const hasPending = Boolean(pendingRevisionResult || pendingRevisionPlan);
      dot.classList.toggle('hidden', !(modalHidden && hasPending));
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const revModal = document.getElementById('editorialRevisionModal');
        if (revModal && !revModal.classList.contains('hidden')) {
          closeEditorialRevisionModal();
        }
        const humModal = document.getElementById('humanizeWorkbenchModal');
        if (humModal && !humModal.classList.contains('hidden')) {
          closeHumanizeWorkbenchModal();
        }
      }
    });

    function resetEditorialRevisionWorkbench() {
      pendingRevisionPlan = null;
      pendingRevisionFacts = [];
      pendingRevisionResult = null;
      const instr = document.getElementById('wRevisionInstructionInput');
      if (instr) instr.value = '';
      document.getElementById('editorialRevisionModal')?.classList.add('hidden');
      const followBox = document.getElementById('wRevisionFollowUpBox');
      if (followBox) followBox.classList.add('hidden');
      const followInput = document.getElementById('wRevisionFollowUpInput');
      if (followInput) followInput.value = '';
      const warnEl = document.getElementById('wRevisionSearchWarning');
      if (warnEl) warnEl.classList.add('hidden');
      switchEditorialRevisionModalStep('input');
      syncRevisionPendingBanner();
      setStep5StageMode('editor');
      renderScriptSnapshotsDropdown([]);
      renderRevisionChapterPicker();
    }

    function appendRevisionQuickChip(snippet) {
      const el = document.getElementById('wRevisionInstructionInput');
      if (!el) return;
      const cur = el.value.trim();
      el.value = cur ? (cur + '\n' + snippet) : snippet;
      el.focus();
    }

    function getClientOrderedSegments() {
      const seg = writerData?.finalScript?.script_segments;
      const items = [];
      if (seg && typeof seg === 'object') {
        if (typeof seg.opening === 'string' && seg.opening.trim()) {
          items.push({ seg_id: 'opening', title: '开篇导引' });
        }
        if (Array.isArray(seg.chapters)) {
          seg.chapters.forEach((ch, idx) => {
            const chNum = Number(ch?.chapter_number || idx + 1);
            items.push({
              seg_id: `ch_${idx}_${chNum}`,
              title: String(ch?.chapter_title || `第${chNum}章`).trim(),
            });
          });
        }
        if (typeof seg.ending === 'string' && seg.ending.trim()) {
          items.push({ seg_id: 'ending', title: '全片终局结尾' });
        }
      }
      return items;
    }

    function onRevisionScopeChange() {
      const scope = document.getElementById('wRevisionScopeSelect')?.value || 'full';
      const picker = document.getElementById('wRevisionChapterPicker');
      if (picker) {
        picker.classList.toggle('hidden', scope !== 'selected');
        if (scope === 'selected') renderRevisionChapterPicker();
      }
    }

    function renderRevisionChapterPicker() {
      const box = document.getElementById('wRevisionChapterCheckboxes');
      if (!box) return;
      const segs = getClientOrderedSegments();
      if (segs.length === 0) {
        box.innerHTML = '<span class="text-gray-500">当前暂无已拆分的章节，请先生成或保存定稿文案。</span>';
        return;
      }
      box.innerHTML = segs
        .map(
          (s) => `
          <label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 cursor-pointer select-none">
            <input type="checkbox" class="w-revision-seg-cb accent-amber-500" value="${escapeHtml(s.seg_id)}" />
            <span>${escapeHtml(s.title)}</span>
          </label>
        `
        )
        .join('');
    }

    async function loadScriptSnapshots(projectId = activeProjectId) {
      try {
        const res = await fetch('/api/writer/revision/snapshots?project=' + encodeURIComponent(projectId));
        const data = await res.json();
        if (activeProjectId === projectId && data?.ok) {
          renderScriptSnapshotsDropdown(data.snapshots || []);
        }
      } catch (e) {}
    }

    function renderScriptSnapshotsDropdown(snapshots = []) {
      const sel = document.getElementById('wRevisionSnapshotSelect');
      const btn = document.getElementById('btnRestoreSnapshot');
      if (!sel) return;
      if (!Array.isArray(snapshots) || snapshots.length === 0) {
        sel.innerHTML = '<option value="">暂无历史版本快照</option>';
        if (btn) btn.disabled = true;
        return;
      }
      sel.innerHTML = snapshots
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)} (${s.total_word_count || 0}字)</option>`)
        .join('');
      if (btn) btn.disabled = false;
    }

    async function restoreSelectedScriptSnapshot() {
      const sel = document.getElementById('wRevisionSnapshotSelect');
      const snapshotId = sel?.value;
      if (!snapshotId) return;
      if (!window.confirm('确认还原到选中的历史版本？当前定稿也会自动保存一份备份再还原。')) return;

      const btn = document.getElementById('btnRestoreSnapshot');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 还原中...';
      }
      try {
        const res = await fetch('/api/writer/revision/restore?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshotId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '还原失败');

        if (!writerData) writerData = {};
        writerData.finalScript = data.finalScript;
        if (data.outline) writerData.outline = data.outline;
        if (Array.isArray(data.chapters)) writerData.chapters = data.chapters;
        if (Array.isArray(data.evidenceCards)) writerData.evidenceCards = data.evidenceCards;
        writerData.hasExistingContent = true;
        pendingRevisionPlan = null;
        pendingRevisionFacts = [];
        pendingRevisionResult = null;
        document.getElementById('editorialRevisionModal')?.classList.add('hidden');
        switchEditorialRevisionModalStep('input');
        syncRevisionPendingBanner();
        renderFinalScriptView();
        applyWriterInspectorMode(writerData);
        renderScriptSnapshotsDropdown(data.snapshots || []);
        setWriterPersistenceStatus('saved', '✅ 已还原历史版本');
        showToast('↩️ 已还原到历史版本（还原前版本已自动备份）！');
        showCompletionModal({
          icon: '↩️',
          title: '历史版本还原已完成',
          message: '已还原到所选历史版本。',
          detail: '还原前的版本已自动快照备份。',
        });
      } catch (err) {
        alert('还原失败: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '↩️ 还原版本';
        }
      }
    }

    async function generateEditorialRevisionPlan() {
      const instruction = (document.getElementById('wRevisionInstructionInput')?.value || '').trim();
      if (!instruction) {
        alert('请先在输入框中写出你的审稿或改稿意见！');
        return;
      }

      const scope = document.getElementById('wRevisionScopeSelect')?.value || 'full';
      const selectedSegIds = scope === 'selected'
        ? Array.from(document.querySelectorAll('.w-revision-seg-cb:checked')).map((el) => el.value)
        : [];
      if (scope === 'selected' && selectedSegIds.length === 0) {
        alert('请至少勾选一个需要改写的章节！');
        return;
      }

      const useWebSearch = Boolean(document.getElementById('wRevisionUseWebSearch')?.checked);
      const currentContent = document.getElementById('wFinalScriptFullText')?.value || '';
      const model = document.getElementById('wInputModel')?.value || '';
      const btn = document.getElementById('btnPlanRevision');
      const projectId = activeProjectId;

      btn.disabled = true;
      btn.innerHTML = useWebSearch
        ? '<span>🌐 正在查证资料并制定改稿方案...</span>'
        : '<span>⏳ 正在分析受影响章节并制定方案...</span>';

      try {
        const res = await fetch('/api/writer/revision/plan?project=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction,
            scope,
            selectedSegIds,
            useWebSearch,
            currentContent,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.plan) {
          throw new Error(data.error || '生成改稿方案失败');
        }
        if (activeProjectId !== projectId) return;

        pendingRevisionPlan = data.plan;
        pendingRevisionFacts = Array.isArray(data.researched_facts) ? data.researched_facts : [];
        pendingRevisionResult = null;
        document.getElementById('wRevisionDiffBox')?.classList.add('hidden');
        document.getElementById('wRevisionFollowUpBox')?.classList.add('hidden');

        renderRevisionPlanBox(data.search_warning || '');
        openEditorialRevisionModal('plan');
        showToast('📐 改稿影响方案已生成，请在弹窗中确认各章策略后执行！');
      } catch (err) {
        alert('生成改稿方案失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>📋 生成改稿影响方案</span>';
      }
    }

    function renderRevisionPlanBox(searchWarning = '') {
      const box = document.getElementById('wRevisionPlanBox');
      if (!box || !pendingRevisionPlan) return;
      box.classList.remove('hidden');

      document.getElementById('wRevisionPlanStrategy').textContent =
        '全篇策略：' + (pendingRevisionPlan.overall_strategy || '');

      const threadEl = document.getElementById('wRevisionPlanThread');
      if (pendingRevisionPlan.new_thread_or_hook) {
        threadEl.textContent = '新增切入/贯穿主线：' + pendingRevisionPlan.new_thread_or_hook;
        threadEl.classList.remove('hidden');
      } else {
        threadEl.classList.add('hidden');
      }

      const factsBox = document.getElementById('wRevisionFactsBox');
      const factsList = document.getElementById('wRevisionFactsList');
      if (pendingRevisionFacts.length > 0) {
        factsBox.classList.remove('hidden');
        factsList.innerHTML = pendingRevisionFacts
          .map(
            (f, i) => `
            <div class="p-1.5 rounded bg-gray-950 border border-gray-800">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-cyan-200 truncate">${i + 1}. ${escapeHtml(f.title)}</span>
                <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline shrink-0">打开来源</a>
              </div>
              <div class="text-gray-400 text-[10px] mt-0.5 line-clamp-2">${escapeHtml(f.snippet)}</div>
            </div>
          `
          )
          .join('');
      } else {
        factsBox.classList.add('hidden');
      }

      const warnEl = document.getElementById('wRevisionSearchWarning');
      if (searchWarning) {
        warnEl.textContent = '⚠️ ' + searchWarning;
        warnEl.classList.remove('hidden');
      } else {
        warnEl.classList.add('hidden');
      }

      const rowsEl = document.getElementById('wRevisionPlanRows');
      rowsEl.innerHTML = (pendingRevisionPlan.segment_plans || [])
        .map(
          (sp, idx) => `
          <div class="p-2 rounded-lg bg-gray-900/90 border border-gray-800 space-y-1.5 text-[11px]" data-rev-seg-idx="${idx}">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-bold text-white truncate">${escapeHtml(sp.title)}</span>
                <span class="text-[10px] text-gray-500 font-mono">(${sp.char_count || 0}字)</span>
              </div>
              <select data-rev-field="action" style="color-scheme: dark;" class="bg-gray-950 text-xs px-2 py-0.5 rounded border border-gray-700 font-bold text-amber-200">
                <option value="rewrite" ${sp.action === 'rewrite' ? 'selected' : ''}>✍️ 重写本段</option>
                <option value="light_edit" ${sp.action === 'light_edit' ? 'selected' : ''}>🪄 微调融入</option>
                <option value="keep" ${sp.action === 'keep' ? 'selected' : ''}>🔒 保持不动</option>
              </select>
            </div>
            <div class="text-[10px] text-gray-400">判断理由：${escapeHtml(sp.reason)}</div>
            <input type="text" data-rev-field="edit_instructions" value="${escapeHtml(sp.edit_instructions || '')}" placeholder="保持不动时可留空；需要改动请写明要求..."
              class="w-full bg-gray-950 text-gray-200 text-[11px] px-2 py-1 rounded border border-gray-800 focus:outline-none focus:border-amber-400" />
          </div>
        `
        )
        .join('');
    }

    function readEditedRevisionPlanFromUI() {
      if (!pendingRevisionPlan) return null;
      const rows = document.querySelectorAll('#wRevisionPlanRows [data-rev-seg-idx]');
      const updated = (pendingRevisionPlan.segment_plans || []).map((sp) => ({ ...sp }));
      rows.forEach((row) => {
        const idx = Number(row.getAttribute('data-rev-seg-idx'));
        if (!updated[idx]) return;
        const actionEl = row.querySelector('[data-rev-field="action"]');
        const instrEl = row.querySelector('[data-rev-field="edit_instructions"]');
        if (actionEl) updated[idx].action = actionEl.value;
        if (instrEl) updated[idx].edit_instructions = instrEl.value.trim();
      });
      return {
        ...pendingRevisionPlan,
        segment_plans: updated,
      };
    }

    function cancelEditorialRevisionPlan() {
      pendingRevisionPlan = null;
      pendingRevisionFacts = [];
      pendingRevisionResult = null;
      document.getElementById('wRevisionFollowUpBox')?.classList.add('hidden');
      switchEditorialRevisionModalStep('input');
      syncRevisionPendingBanner();
    }

    async function executeEditorialRevisionUI() {
      const editedPlan = readEditedRevisionPlanFromUI();
      if (!editedPlan) return;
      const targetCount = (editedPlan.segment_plans || []).filter((p) => p.action !== 'keep').length;
      if (targetCount === 0) {
        alert('当前方案所有章节都设为「保持不动」，请至少将一章设为重写或微调！');
        return;
      }

      const instruction = (document.getElementById('wRevisionInstructionInput')?.value || '').trim();
      const currentContent = document.getElementById('wFinalScriptFullText')?.value || '';
      const model = document.getElementById('wInputModel')?.value || '';
      const btn = document.getElementById('btnExecuteRevision');
      const projectId = activeProjectId;

      btn.disabled = true;
      btn.innerHTML = `<span>⏳ 正在按方案改写 ${targetCount} 个章节...</span>`;

      try {
        const res = await fetch('/api/writer/revision/execute?project=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction,
            plan: editedPlan,
            researchedFacts: pendingRevisionFacts,
            currentContent,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.revisedFinalScript) {
          throw new Error(data.error || '执行定向改稿失败');
        }
        if (activeProjectId !== projectId) return;

        pendingRevisionPlan = editedPlan;
        pendingRevisionResult = {
          projectId,
          instruction,
          beforeText: data.beforeText,
          afterText: data.afterText,
          revisedFinalScript: data.revisedFinalScript,
          changedSegmentsCount: data.changedSegmentsCount,
          totalSegmentsCount: data.totalSegmentsCount,
        };

        document.getElementById('wRevisionDiffSummary').textContent =
          `已定向改写 ${data.changedSegmentsCount}/${data.totalSegmentsCount} 个章节，其余章节 100% 原样保留`;
        openEditorialRevisionModal('diff');
        setWriterPersistenceStatus('dirty', '● 定向改稿已完成，请在左右对比审阅后点击「✅ 保留并替换定稿」');
        showToast('🔍 定向改稿已完成，请审阅 GitHub 左右对比后决定是否保留！');
        showCompletionModal({
          icon: '🔍',
          title: '定向改稿生成已完成',
          message: '已定向改写 ' + data.changedSegmentsCount + '/' + data.totalSegmentsCount + ' 个章节，其余章节原样保留。',
          detail: '关闭提示后请在对比窗口审阅修改差异，确认后点击「✅ 保留并替换定稿」。',
        });
      } catch (err) {
        alert('执行改稿失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🚀 按此方案执行定向改稿</span>';
      }
    }

    function setRevisionDiffMode(mode) {
      revisionDiffMode = mode;
      const btnU = document.getElementById('btnRevDiffUnified');
      const btnS = document.getElementById('btnRevDiffSplit');
      if (btnU && btnS) {
        btnU.className = mode === 'unified'
          ? 'px-2.5 py-0.5 rounded bg-amber-600 text-white font-bold cursor-pointer'
          : 'px-2.5 py-0.5 rounded text-gray-400 hover:text-white font-bold cursor-pointer';
        btnS.className = mode === 'split'
          ? 'px-2.5 py-0.5 rounded bg-amber-600 text-white font-bold cursor-pointer'
          : 'px-2.5 py-0.5 rounded text-gray-400 hover:text-white font-bold cursor-pointer';
      }
      renderRevisionDiffView();
    }

    function renderRevisionDiffView() {
      if (!pendingRevisionResult) return;
      renderScriptDiff({
        bodyId: 'wRevisionDiffBody',
        addedId: 'wRevisionAddedCount',
        removedId: 'wRevisionRemovedCount',
        changesId: 'wRevisionChangesOnly',
        before: pendingRevisionResult.beforeText,
        after: pendingRevisionResult.afterText,
        mode: revisionDiffMode,
        leftLabel: '改稿前原稿',
        rightLabel: '定向改稿新版',
      });
    }

    function openRevisionFollowUp() {
      const box = document.getElementById('wRevisionFollowUpBox');
      if (!box) return;
      box.classList.remove('hidden');
      document.getElementById('wRevisionFollowUpInput')?.focus();
    }

    async function submitRevisionFollowUp() {
      const followText = (document.getElementById('wRevisionFollowUpInput')?.value || '').trim();
      if (!followText) {
        alert('请输入补充追评意见！');
        return;
      }
      const mainInput = document.getElementById('wRevisionInstructionInput');
      if (mainInput) {
        mainInput.value = mainInput.value.trim() + '\n【补充追评】：' + followText;
      }
      const btnFollow = document.getElementById('btnSubmitRevisionFollowUp');
      if (btnFollow) {
        btnFollow.disabled = true;
        btnFollow.textContent = '⏳ 重新生成方案中...';
      }
      document.getElementById('wRevisionFollowUpInput').value = '';
      document.getElementById('wRevisionFollowUpBox')?.classList.add('hidden');
      try {
        await generateEditorialRevisionPlan();
      } finally {
        if (btnFollow) {
          btnFollow.disabled = false;
          btnFollow.textContent = '重新生成方案';
        }
      }
    }

    function discardEditorialRevisionResult() {
      pendingRevisionResult = null;
      document.getElementById('wRevisionFollowUpBox')?.classList.add('hidden');
      document.getElementById('editorialRevisionModal')?.classList.add('hidden');
      document.getElementById('wRevisionDiffBox')?.classList.add('hidden');
      syncRevisionPendingBanner();
      setWriterPersistenceStatus('saved');
      showToast('↩️ 已放弃本次改稿预览，原定稿保持不变。');
    }

    async function applyEditorialRevisionUI() {
      const pending = pendingRevisionResult;
      if (!pending || pending.projectId !== activeProjectId) return;

      const btn = document.getElementById('btnApplyRevision');
      const saveNewEvidenceCards = Boolean(document.getElementById('wRevisionSaveEvidenceCheckbox')?.checked);
      btn.disabled = true;
      btn.textContent = '⏳ 正在保存快照并替换...';

      try {
        const res = await fetch('/api/writer/revision/apply?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revisedFinalScript: pending.revisedFinalScript,
            instruction: pending.instruction,
            researchedFacts: pendingRevisionFacts,
            saveNewEvidenceCards,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '保存改稿失败');

        if (!writerData) writerData = {};
        writerData.finalScript = data.finalScript || pending.revisedFinalScript;
        if (data.outline) writerData.outline = data.outline;
        if (Array.isArray(data.chapters)) writerData.chapters = data.chapters;
        if (Array.isArray(data.evidenceCards)) {
          writerData.evidenceCards = data.evidenceCards;
          renderEvidenceCardsList();
        }
        writerData.hasExistingContent = true;

        pendingRevisionPlan = null;
        pendingRevisionFacts = [];
        pendingRevisionResult = null;
        document.getElementById('editorialRevisionModal')?.classList.add('hidden');
        document.getElementById('wRevisionFollowUpBox')?.classList.add('hidden');
        switchEditorialRevisionModalStep('input');
        syncRevisionPendingBanner();

        renderFinalScriptView();
        applyWriterInspectorMode(writerData);
        renderScriptSnapshotsDropdown(data.snapshots || []);
        setWriterPersistenceStatus('saved', '✅ 定向改稿已采纳并自动留存快照');

        const evTip = data.addedEvidenceCount > 0 ? `，新增 ${data.addedEvidenceCount} 张查证证据卡` : '';
        showToast(`✅ 定向改稿已生效并保存${evTip}（原稿已自动快照备份）！`);
        showCompletionModal({
          icon: '✅',
          title: '定向改稿已完成',
          message: '定向改稿已生效并保存' + evTip + '！',
          detail: '原稿已自动快照备份，可随时还原。',
        });
      } catch (err) {
        alert('保存改稿失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '✅ 保留并替换定稿';
      }
    }
