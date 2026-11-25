// writer-persistence.js — shared classic-script scope; loaded before studio initialization.
let pendingFinalizedScript = null;
let savedFinalScriptText = '';

    function resetFinalScriptSaveState() {
      savedFinalScriptText = document.getElementById('wFinalScriptFullText').value;
      updateFinalScriptSaveButton();
    }

    function updateFinalScriptSaveButton() {
      const button = document.getElementById('btnSaveFinalScript');
      const editor = document.getElementById('wFinalScriptFullText');
      if (button && editor) button.classList.toggle('hidden', editor.value === savedFinalScriptText);
    }

    function getFinalizedScriptText(script) {
      const seg = script?.script_segments;
      if (seg) return [seg.opening, ...(seg.chapters || []).map((c) => c.narration_text), seg.ending].filter(Boolean).map((v) => String(v).trim()).filter(Boolean).join('\n\n');
      return String(script?.full_narration_text || script?.content || (script?.approved_narration_sentences || []).join('\n')).trim();
    }

    async function aiFinalizeFullScript() {
      if (pendingFinalizedScript && !window.confirm('已有待审阅的统稿结果，重新生成会丢弃该结果。是否继续？')) return;
      const projectId = activeProjectId;
      const before = document.getElementById('wFinalScriptFullText').value;
      const btn = document.getElementById('btnAiFinalize');
      const task = startWriterAiTask(5, btn, {
        loadingLabel: '正在全文统稿...',
        statusMessage: '🏁 正在进行跨章去重、剔除伪结尾与全文统稿，请稍候...',
        toastMessage: '🏁 正在全文统稿，请稍候...',
        restoreHtml: '<span>🤖 全文统稿</span>',
      });
      try {
        const res = await fetch('/api/writer/ai/finalize-script?project=' + encodeURIComponent(projectId), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outline: writerData?.outline, chapters: writerData?.chapters || [], evidenceCards: writerData?.evidenceCards || [], model: document.getElementById('wInputModel').value, apiKey: visualConfig.apiKey, baseUrl: visualConfig.baseUrl }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.finalScript) throw new Error(data.error || `HTTP ${res.status || '异常'}`);
        if (activeProjectId !== projectId) {
          task.finish(false, '工程已切换，本次统稿结果未保存。');
          showToast('工程已切换，本次统稿结果未保存。');
          return;
        }
        pendingFinalizedScript = { projectId, before, result: data.finalScript, fallback: data.usedFallback };
        const note = document.getElementById('wFinalizeReviewNote');
        note.textContent = data.usedFallback
          ? '模型未返回完整结果，右侧是合并后的章节稿，尚需 AI 统稿复核。确认前不会覆盖定稿。'
          : '左侧为生成前定稿，右侧为 AI 统稿结果；红色为原文删改，绿色为新增或改写。确认前不会覆盖已保存的定稿。';
        setStep5StageMode('finalize_diff');
        renderFinalizeDiffView();
        document.getElementById('wStep5MainStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        task.finish(true, data.usedFallback ? '✅ 章节合并稿已生成（待审阅替换）' : '✅ 统稿结果已生成，请审阅对比后确认替换');
        showToast('统稿结果已生成，请先审阅并确认。');
        showCompletionModal({
          icon: '🤖',
          title: 'AI 全文统稿已完成',
          message: data.usedFallback ? '章节合并稿已生成（模型未返回完整统稿，请复核）。' : '全文去重、去伪结尾与统稿结果已生成！',
          detail: '请先审阅左右对比差异，确认后点击「✅ 确认替换并保存」。',
        });
      } catch (err) {
        const errMsg = '全文统稿失败: ' + err.message;
        task.finish(false, errMsg);
        showToast('❌ ' + errMsg);
        alert(errMsg);
      } finally {
        task.finish(false);
      }
    }

    function renderFinalizeDiffView() {
      if (!pendingFinalizedScript) return;
      renderScriptDiff({ bodyId: 'wFinalizeDiffBody', addedId: 'wFinalizeAddedCount', removedId: 'wFinalizeRemovedCount', changesId: 'wFinalizeChangesOnly', before: pendingFinalizedScript.before, after: getFinalizedScriptText(pendingFinalizedScript.result), mode: 'split', leftLabel: '生成前定稿', rightLabel: 'AI 统稿结果' });
    }

    function discardFinalizedScript() {
      pendingFinalizedScript = null;
      setStep5StageMode('editor');
      showToast('已放弃统稿结果，原定稿保持不变。');
    }

    async function acceptFinalizedScript() {
      const pending = pendingFinalizedScript;
      if (!pending || pending.projectId !== activeProjectId) return;
      if (document.getElementById('wFinalScriptFullText').value !== pending.before) {
        alert('生成期间定稿内容发生了变化。为避免覆盖新修改，请放弃此结果并重新生成。'); return;
      }
      const btn = document.getElementById('btnAcceptFinalize');
      const discardBtn = document.getElementById('btnDiscardFinalize');
      const textarea = document.getElementById('wFinalScriptFullText');
      btn.disabled = true;
      discardBtn.disabled = true;
      textarea.disabled = true;
      btn.textContent = '⏳ 正在保存...';
      try {
        const res = await fetch('/api/writer/save?project=' + encodeURIComponent(pending.projectId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part: 'finalScript', data: pending.result }) });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '保存失败');
        if (activeProjectId === pending.projectId && pendingFinalizedScript === pending) {
          writerData.finalScript = data.finalScript || pending.result;
          writerData.hasExistingContent = true;
          renderFinalScriptView();
          applyWriterInspectorMode(writerData);
          setWriterPersistenceStatus('saved');
          pendingFinalizedScript = null;
          setStep5StageMode('editor');
          showToast(pending.fallback ? '章节合并稿已保存，仍需 AI 统稿复核。' : '✅ 已确认并保存 AI 统稿结果。');
          showCompletionModal({
            icon: '✅',
            title: 'AI 统稿保存已完成',
            message: pending.fallback ? '章节合并稿已保存至本地。' : '已确认并保存 AI 统稿结果至本地定稿！',
          });
        }
      } catch (err) { alert('保存失败，审阅结果仍保留：' + err.message); }
      finally { btn.disabled = false; discardBtn.disabled = false; textarea.disabled = false; btn.textContent = '✅ 确认替换并保存'; }
    }

    function setWriterPersistenceStatus(mode, customText) {
      const badge = document.getElementById('writerPersistenceStatusBadge');
      if (!badge) return;
      if (mode === 'dirty') {
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-warn-soft text-warn border border-warn-line';
        badge.textContent = customText || '● 有未保存修改（点击保存写盘）';
      } else if (mode === 'saving') {
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-info-soft text-info border border-info-line';
        badge.textContent = customText || '⏳ 正在写入本地...';
      } else {
        const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-ok-soft text-ok border border-ok-line';
        badge.textContent = customText || ('✅ 已保存至本地 ' + nowStr);
      }
    }

    (function bindWriterDirtyTracking() {
      const container = document.getElementById('viewWriterContainer');
      if (!container) return;
      container.addEventListener('input', (e) => {
        if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) {
          setWriterPersistenceStatus('dirty');
        }
      });
    })();

    async function saveStep2EvidenceCards() {
      const saved = await saveWriterProjectDataAsync('evidenceCards', writerData?.evidenceCards || []);
      if (!saved?.ok) {
        alert('保存证据卡失败：' + (saved?.error || '请重试'));
        return saved;
      }
      showToast('💾 证据卡库已保存至本地！');
      showCompletionModal({
        icon: '💾',
        title: '证据卡保存已完成',
        message: '证据卡库修改已保存至本地！',
      });
      return saved;
    }

    async function saveWriterProjectDataAsync(part, data) {
      setWriterPersistenceStatus('saving');
      try {
        const res = await fetch('/api/writer/save?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ part, data }),
        });
        const json = await res.json();
        if (res.ok && json && json.ok) {
          setWriterPersistenceStatus('saved');
          return json;
        }
        setWriterPersistenceStatus('dirty', '⚠️ 本地保存异常，请重试');
        return json || { ok: false };
      } catch (e) {
        console.warn('异步保存失败:', e);
        setWriterPersistenceStatus('dirty', '⚠️ 本地保存异常，请重试');
        return null;
      }
    }

    function readWriterBriefFromForm() {
      const brief = writerData?.brief;
      return {
        ...brief,
        project_id: activeProjectId,
        title: document.getElementById('wInputTitle').value.trim(),
        core_question: document.getElementById('wBriefCoreQuestion').value.trim(),
        short_answer: document.getElementById('wBriefShortAnswer').value.trim(),
        target_duration_minutes: parseInt(document.getElementById('wInputDuration').value, 10) || 25,
        planned_chapter_count: parseInt(document.getElementById('wInputChapterCount').value, 10) || 6,
        scope: { ...brief?.scope, time_range: document.getElementById('wBriefScope').value.trim() },
        taboos_and_exclusions: document.getElementById('wBriefTaboos').value.split(/[、,，\n]+/).filter(Boolean),
      };
    }

    async function saveWriterPartManual(part) {
      if (part === 'brief') {
        const briefObj = readWriterBriefFromForm();
        const materialsText = document.getElementById('wInputMaterials').value;
        if (!writerData) writerData = {};
        writerData.brief = briefObj;
        writerData.materials = materialsText;
        const savedBrief = await saveWriterProjectDataAsync('brief', briefObj);
        let savedMat = { ok: true };
        if (materialsText.trim()) {
          savedMat = await saveWriterProjectDataAsync('materials', materialsText);
        }
        updateActiveProjectTitleUI(briefObj.title);
        if (!savedBrief?.ok || !savedMat?.ok) {
          alert('保存 Brief 立项失败：' + (savedBrief?.error || savedMat?.error || '请重试'));
          return savedBrief?.ok ? savedMat : savedBrief;
        }
        showToast('💾 Brief 立项与参考资料已保存！');
        showCompletionModal({
          icon: '💾',
          title: '立项修改保存已完成',
          message: 'Brief 立项与参考资料已保存至本地！',
        });
        return savedBrief;
      }
      if (part === 'finalScript') {
        const fullContent = document.getElementById('wFinalScriptFullText').value;
        const saved = await saveWriterProjectDataAsync('finalScript', {
          title: document.getElementById('wInputTitle').value,
          content: fullContent,
          ...(arguments[1] ? { humanizeMeta: arguments[1] } : {}),
        });
        if (saved?.finalScript) {
          if (!writerData) writerData = {};
          writerData.finalScript = saved.finalScript;
          writerData.hasExistingContent = true;
          if (saved.finalScript.title) updateActiveProjectTitleUI(saved.finalScript.title);
          renderFinalScriptView();
          applyWriterInspectorMode(writerData);
        }
        return saved;
      }
    }

    async function saveCurrentWriterPart() {
      if (currentWriterStep === 1) await saveWriterPartManual('brief');
      else if (currentWriterStep === 2) {
        await saveStep2EvidenceCards();
      } else if (currentWriterStep === 3) {
        await saveOutlineManual();
      } else if (currentWriterStep === 4) await saveCurrentChapterDraft();
      else if (currentWriterStep === 5) {
        await saveFinalScriptOnlyUI();
      }
    }

    function updateFinalScriptLiveStats() {
      updateFinalScriptSaveButton();
      const val = document.getElementById('wFinalScriptFullText').value || '';
      const words = val.replace(/s+/g, '').length;
      document.getElementById('wFinalScriptWords').textContent = words;
      document.getElementById('wFinalScriptMin').textContent = (words / 240).toFixed(1);
    }

    async function saveFinalScriptOnlyUI() {
      const fullContent = document.getElementById('wFinalScriptFullText').value.trim();
      if (!fullContent) {
        alert('定稿文案为空，无法保存！');
        return;
      }
      const saved = await saveWriterPartManual('finalScript');
      if (!saved?.ok) {
        alert('保存文案失败：' + (saved?.error || '请重试'));
        return;
      }
      showToast('💾 文案底稿已保存！（制作台镜头保持原样未改动）');
      showCompletionModal({
        icon: '💾',
        title: '文案修改保存已完成',
        message: '完整定稿文案已保存至本地！',
        detail: '制作台现有镜头未改动；如需将文案修改同步切镜，请点击右上角「🚀 文案定稿 · 一键流转至制作台」。',
      });
    }
