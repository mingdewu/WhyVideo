    let writerData = null;
    let currentWriterStep = 1;
    let currentChapterIndex = 0;
    let verifyingEvidenceProjectId = null;

    async function loadWriterProjectData(projectId) {
      document.getElementById('writerProjectIdBadge').textContent = projectId;
      // 切换工程时彻底清空上一个工程残留的表单脏数据
      document.getElementById('wInputTitle').value = '';
      document.getElementById('wInputDuration').value = '25';
      document.getElementById('wInputChapterCount').value = '6';
      document.getElementById('wBriefCoreQuestion').value = '';
      document.getElementById('wBriefShortAnswer').value = '';
      document.getElementById('wBriefScope').value = '';
      document.getElementById('wBriefTaboos').value = '零编造、严禁模仿特定博主口吻、确保客观中立事实论证';
      document.getElementById('wInputMaterials').value = '';
      document.getElementById('wMaterialWordCount').textContent = '已就绪资料：0 字';
      document.getElementById('wOutlineOpeningQuestion').value = '';
      document.getElementById('wOutlineOpeningAnswer').value = '';
      document.getElementById('wOutlineEndingTakeaway').value = '';
      document.getElementById('wFinalScriptFullText').value = '';
      document.getElementById('wFinalScriptWords').textContent = '0';
      document.getElementById('wFinalScriptMin').textContent = '0.0';
      document.getElementById('wEditorialLogDetails').innerHTML = '<div>- 暂无统稿清洗记录。</div>';
      closeHumanizeWorkbenchModal();
      setStep5StageMode('editor');
      rawScriptBackupBeforeHumanize = '';
      latestHumanizedText = '';
      pendingHumanizeMeta = null;
      updateHumanizeVersionUI(null);
      if (typeof resetEditorialRevisionWorkbench === 'function') resetEditorialRevisionWorkbench();
      currentChapterIndex = 0;
      refreshWriterPromptsButtonStatus(projectId);

      try {
        const res = await fetch('/api/writer/data?project=' + projectId);
        const data = await res.json();
        if (data.ok) {
          writerData = data;
          const isBlankDraft = Boolean(data.brief?._blank_draft && !data.hasExistingContent);

          // 1. 填充标题与 Brief
          const curProj = projectsList.find((p) => p.id === projectId);
          const fallbackTitle = (curProj?.title || projectId).replace(/^《(.*)》$/, '$1');
          const title = isBlankDraft
            ? (data.brief?.title || '')
            : (data.brief?.title || data.finalScript?.title || fallbackTitle);
          document.getElementById('wInputTitle').value = title;
          updateActiveProjectTitleUI(isBlankDraft && !data.brief?.title ? '' : title);

          if (data.brief) {
            document.getElementById('wInputDuration').value = data.brief.target_duration_minutes || (data.finalScript?.estimated_duration_minutes || 25);
            document.getElementById('wInputChapterCount').value = data.brief.planned_chapter_count || (data.outline?.chapters?.length || 6);
            document.getElementById('wBriefCoreQuestion').value = isBlankDraft
              ? (data.brief.core_question || '')
              : (data.brief.core_question || (title ? `为什么${title}？背后的底层机制与历史脉络是什么？` : ''));
            document.getElementById('wBriefShortAnswer').value = data.brief.short_answer || '';
            document.getElementById('wBriefScope').value = data.brief.scope?.time_range || '';
            document.getElementById('wBriefTaboos').value = Array.isArray(data.brief.taboos_and_exclusions)
              ? data.brief.taboos_and_exclusions.join('、')
              : (data.brief.taboos_and_exclusions || '零编造、严禁模仿特定博主口吻、确保客观中立事实论证');
          }

          // 填充原始考证资料
          if (data.materials) {
            document.getElementById('wInputMaterials').value = data.materials;
            document.getElementById('wMaterialWordCount').textContent = `已就绪资料：${data.materials.length} 字`;
          }

          // 2. 渲染证据卡
          renderEvidenceCardsList();

          // 3. 渲染大纲
          renderOutlineView();

          // 4. 渲染章节
          renderChapterTabs();
          renderCurrentChapterEditor();

          // 5. 渲染定稿全文
          renderFinalScriptView();

          // 6. 自适应切换左栏为「工程文案实况摘要卡」或「新建向导表单」
          applyWriterInspectorMode(data);

          // 恢复用户所处的最优阶段（已有文案工程默认直达 Step 5 终稿 Review 或对应已就绪阶段）
          setWriterStep(data.activeStep || 1);
          setWriterPersistenceStatus('saved', '✅ 已从本地加载');
          void autoVerifyPendingEvidence(projectId);
          void loadScriptSnapshots(projectId);
        }
      } catch (err) {
        console.error('加载文案数据失败:', err);
      }
    }

    let isWriterSetupDrawerOpen = false;

    function syncWriterLeftColWidth() {
      const leftCol = document.getElementById('writerLeftCol');
      const rightCol = document.getElementById('writerRightCol');
      if (!leftCol || !rightCol) return;
      const useCompactCol = Boolean(writerData?.hasExistingContent) && !isWriterSetupDrawerOpen;
      leftCol.classList.remove('lg:col-span-2', 'lg:col-span-4');
      rightCol.classList.remove('lg:col-span-10', 'lg:col-span-8');
      leftCol.classList.add(useCompactCol ? 'lg:col-span-2' : 'lg:col-span-4');
      rightCol.classList.add(useCompactCol ? 'lg:col-span-10' : 'lg:col-span-8');
    }

    function applyWriterInspectorMode(data) {
      const hasContent = Boolean(data?.hasExistingContent);
      const inspectorCard = document.getElementById('wInspectorCard');
      const setupDrawer = document.getElementById('wWriterSetupDrawer');
      const importQuickCard = document.getElementById('wWriterImportQuickCard');
      const btnStep1Reset = document.getElementById('btnStep1ResetWriter');

      if (!inspectorCard || !setupDrawer) return;

      if (hasContent) {
        isWriterSetupDrawerOpen = false;
        inspectorCard.classList.remove('hidden');
        setupDrawer.classList.add('hidden');
        if (importQuickCard) importQuickCard.classList.add('hidden');
        if (btnStep1Reset) btnStep1Reset.classList.remove('hidden');
        document.getElementById('wSetupDrawerArrow').textContent = '▼ 展开';

        const wordCount = data.finalScript?.total_word_count || 0;
        const durationMin = data.finalScript?.estimated_duration_minutes || (wordCount > 0 ? (wordCount / 240).toFixed(1) : '-');
        const chCount = (data.chapters && data.chapters.length) || (data.outline?.chapters?.length) || 0;
        const evCount = (data.evidenceCards && data.evidenceCards.length) || 0;
        const title = data.finalScript?.title || data.brief?.title || data.projectId;

        document.getElementById('wInspectorProjectId').textContent = data.projectId;
        document.getElementById('wInspectorTitle').textContent = title;
        document.getElementById('wInspectorWords').textContent = wordCount > 0 ? `${wordCount.toLocaleString()} 字` : '草稿中';
        document.getElementById('wInspectorDuration').textContent = wordCount > 0 ? `${durationMin} 分钟` : '-';
        document.getElementById('wInspectorChapters').textContent = `${chCount} 章`;
        document.getElementById('wInspectorEvidence').textContent = `${evCount} 张`;
        document.getElementById('wInspectorStatusPill').textContent = wordCount > 0 ? '已有文案 · 审阅模式' : '草稿中 · 可继续编辑';
      } else {
        isWriterSetupDrawerOpen = true;
        inspectorCard.classList.add('hidden');
        setupDrawer.classList.remove('hidden');
        if (importQuickCard) importQuickCard.classList.remove('hidden');
        if (btnStep1Reset) btnStep1Reset.classList.add('hidden');
      }
      syncWriterLeftColWidth();
    }

    function toggleWriterSetupDrawer() {
      const setupDrawer = document.getElementById('wWriterSetupDrawer');
      const arrow = document.getElementById('wSetupDrawerArrow');
      if (!setupDrawer) return;
      isWriterSetupDrawerOpen = !isWriterSetupDrawerOpen;
      setupDrawer.classList.toggle('hidden', !isWriterSetupDrawerOpen);
      if (arrow) arrow.textContent = isWriterSetupDrawerOpen ? '▲ 收起' : '▼ 展开';
      syncWriterLeftColWidth();
    }

    function openCreateBlankProjectModal() {
      document.getElementById('newBlankProjTitleInput').value = '';
      document.getElementById('newBlankProjIdInput').value = '';
      document.getElementById('createBlankProjectModal').classList.remove('hidden');
      setTimeout(() => document.getElementById('newBlankProjTitleInput').focus(), 50);
    }

    function closeCreateBlankProjectModal() {
      document.getElementById('createBlankProjectModal').classList.add('hidden');
    }

    async function confirmCreateBlankProject() {
      const title = document.getElementById('newBlankProjTitleInput').value.trim();
      const projectId = document.getElementById('newBlankProjIdInput').value.trim();
      const btn = document.getElementById('btnConfirmCreateBlankProj');
      btn.disabled = true;
      btn.textContent = '⏳ 正在创建空白工程...';
      try {
        const res = await fetch('/api/writer/create-blank-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, projectId }),
        });
        const data = await res.json();
        if (data.ok && data.projectId) {
          closeCreateBlankProjectModal();
          activeProjectId = data.projectId;
          pendingSelectedProjectId = data.projectId;
          localStorage.setItem('whyvideo_active_project', data.projectId);
          const url = new URL(window.location);
          url.searchParams.set('project', data.projectId);
          window.history.pushState({}, '', url);
          await loadProjects();
          await loadWorkflow();
          await loadWriterProjectData(data.projectId);
          setWriterStep(1);
          switchStep1SubTab('create');
          showToast(`✨ 已新建空白工程「${data.title || data.projectId}」，可从第 1 步开始创作！`);
        } else {
          alert('新建失败：' + (data.error || '未知错误'));
        }
      } catch (e) {
        alert('创建异常：' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 创建并从第 1 步开始';
      }
    }

    function openResetWriterConfirmModal() {
      document.getElementById('resetTargetProjId').textContent = activeProjectId;
      document.getElementById('resetWriterConfirmModal').classList.remove('hidden');
    }

    function closeResetWriterConfirmModal() {
      document.getElementById('resetWriterConfirmModal').classList.add('hidden');
    }

    async function confirmResetWriterProject() {
      const btn = document.getElementById('btnConfirmResetWriter');
      btn.disabled = true;
      btn.textContent = '⏳ 正在清零文案草稿...';
      try {
        const res = await fetch('/api/writer/reset-project?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
        });
        const data = await res.json();
        if (data.ok) {
          closeResetWriterConfirmModal();
          await loadProjects();
          await loadWriterProjectData(activeProjectId);
          setWriterStep(1);
          switchStep1SubTab('create');
          showToast('🔄 当前工程文案已清零，现可从第 1 步全新立项！');
        } else {
          alert('清零失败：' + (data.error || '未知错误'));
        }
      } catch (e) {
        alert('清零异常：' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 确认清零并回到第 1 步';
      }
    }

    function setWriterStep(step, scrollToContent = false) {
      currentWriterStep = step;
      const stepNames = {
        1: 'Step 1 · 立项与资料输入',
        2: 'Step 2 · 证据卡提取与核验',
        3: 'Step 3 · 完整大纲策划',
        4: 'Step 4 · 逐章撰写与四段式润色',
        5: 'Step 5 · 全文统稿去伪结尾与定稿',
      };
      const badge = document.getElementById('writerCurrentStepBadge');
      if (badge) badge.textContent = stepNames[step] || `Step ${step}`;

      for (let i = 1; i <= 5; i++) {
        const panel = document.getElementById(`wPanelStep${i}`);
        const btn = document.getElementById(`stepBtn${i}`);
        if (panel) panel.classList.toggle('hidden', i !== step);
        if (btn) {
          if (i === step) {
            btn.setAttribute('aria-current', 'step');
            btn.className = 'px-2.5 py-1.5 rounded-xl border text-left transition flex items-center gap-2 bg-purple-600/20 border-purple-500 text-white shadow cursor-pointer';
          } else {
            btn.removeAttribute('aria-current');
            btn.className = 'px-2.5 py-1.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white cursor-pointer';
          }
        }
      }

      if (scrollToContent && window.matchMedia('(max-width: 1023px)').matches) {
        const contentId = step === 1 ? 'writerMainGrid' : 'wPanelStep' + step;
        document.getElementById(contentId).scrollIntoView({ block: 'start' });
      }
    }

    function hasEvidenceSourceUrl(card) {
      try {
        const url = new URL(String(card?.source_url || '').trim());
        return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
      } catch (e) {
        return false;
      }
    }

    // 渲染证据卡列表
    function renderEvidenceCardsList() {
      const container = document.getElementById('wEvidenceCardsList');
      if (!container) return;
      const cards = writerData?.evidenceCards || [];
      if (cards.length === 0) {
        const hasScript = Boolean(writerData?.finalScript && (writerData.finalScript.total_word_count > 0 || writerData.finalScript.script_segments));
        if (hasScript) {
          container.innerHTML = `
            <div class="p-6 rounded-2xl bg-gray-950 border border-purple-500/30 text-center space-y-3">
              <div class="text-xs text-purple-300 font-bold">📄 本工程已具备定稿文案（约 ${writerData.finalScript.total_word_count || '若干'} 字），暂无独立提取的证据卡</div>
              <p class="text-[11px] text-gray-400 max-w-md mx-auto">
                你可以继续直接查看与编辑大纲、分章正文和全文统稿，亦可一键让 AI 从当前定稿正文中反向提炼证据卡用于事实核验：
              </p>
              <div class="flex items-center justify-center gap-2.5 pt-1">
                <button type="button" onclick="aiExtractEvidence()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow transition flex items-center gap-1.5 cursor-pointer">
                  <span>🤖 从现有正文一键提炼证据卡</span>
                </button>
                <button type="button" onclick="addCustomEvidenceCard()" class="px-3.5 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300 transition flex items-center gap-1 cursor-pointer">
                  <span>➕ 手动补充证据卡</span>
                </button>
              </div>
            </div>
          `;
        } else {
          container.innerHTML = '<div class="text-center py-10 text-gray-500 text-xs">暂无证据卡，请在左侧填入资料后点击上方「🤖 从资料中提取证据卡」</div>';
        }
        return;
      }

      const claimTypeBadge = {
        verified_fact: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">已证实客观事实</span>',
        unverified_fact: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">事实线索·待核查</span>',
        disputed_claim: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">学界/行业存在争议</span>',
        legend_or_anecdote: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">民间传说/轶事</span>',
        author_interpretation: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">作者个人推论</span>',
      };

      container.innerHTML = cards
        .map(
          (c, idx) => `
        <div class="p-3 rounded-xl bg-gray-950 border border-gray-800/80 hover:border-purple-500/40 transition space-y-1.5 text-xs">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-amber-400">${c.evidence_id || 'EV-' + String(idx + 1).padStart(3, '0')}</span>
              ${c.verification_status === 'human_approved'
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">人工复核通过</span>'
                : c.claim_type === 'verified_fact' && !hasEvidenceSourceUrl(c)
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">来源待核查</span>'
                : c.claim_type === 'unverified_fact' && (c.verification_status === 'failed' || c.verification_checked_at)
                  ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">自动未通过 · 待人工复核</span>'
                  : (claimTypeBadge[c.claim_type] || '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/20 text-gray-300 border border-gray-500/30">类型待核查</span>')}
              <span class="text-[10px] text-gray-400 font-mono">可靠度: ${c.claim_type === 'verified_fact' && !hasEvidenceSourceUrl(c) && c.verification_status !== 'human_approved' ? '待核查' : (c.reliability || '未评估')}</span>
            </div>
            <div class="flex items-center gap-2">
              ${c.claim_type === 'unverified_fact' && (c.verification_status === 'failed' || c.verification_checked_at) ? '<button type="button" onclick="humanApproveEvidenceCard(' + idx + ')" class="text-amber-300 hover:text-amber-200 text-xs">人工复核</button>' : ''}
              <button type="button" onclick="deleteEvidenceCard(${idx})" class="text-gray-500 hover:text-rose-400 text-xs">✕ 删除</button>
            </div>
          </div>
          <div class="text-gray-200 leading-relaxed font-sans">${c.evidence_summary || c.claim || '无主张陈述'}</div>
          <div class="text-[11px] text-gray-500 flex items-center justify-between">
            <span class="truncate max-w-md">来源: ${escapeHtml(c.source_title || c.source_url || '待自动核查')}</span>
            ${hasEvidenceSourceUrl(c) ? '<a class="text-sky-400 hover:underline shrink-0" href="' + escapeHtml(c.source_url) + '" target="_blank" rel="noopener noreferrer">打开来源</a>' : ''}
          </div>
          ${c.source_excerpt ? '<div class="text-[11px] text-gray-400 leading-relaxed">原文依据：' + escapeHtml(c.source_excerpt) + '</div>' : ''}
          ${c.verification_status === 'failed' ? '<div class="text-[11px] text-rose-300 leading-relaxed">未通过原因：' + escapeHtml(c.verification_reason || '未找到支持完整主张的来源') + '</div>' : ''}
          ${c.verification_status === 'human_approved' ? '<div class="text-[11px] text-emerald-300 leading-relaxed">人工判断依据：' + escapeHtml(c.review_note || '') + '</div>' : ''}
        </div>
      `
        )
        .join('');
    }

    async function addCustomEvidenceCard() {
      const summary = prompt('请输入一条具体原子化事实主张（单一事实原则）：');
      if (!summary || !summary.trim()) return;
      const sourceUrl = prompt('来源链接（可留空，留空则标记为待核查）：');
      if (sourceUrl === null) return;
      let parsedSourceUrl;
      if (sourceUrl.trim()) {
        try { parsedSourceUrl = new URL(sourceUrl.trim()); } catch (e) {}
      }
      if (sourceUrl.trim() && (!parsedSourceUrl || !['http:', 'https:'].includes(parsedSourceUrl.protocol) || !parsedSourceUrl.hostname)) {
        alert('链接格式无效；请填写 http(s) 链接，或留空作为待核查线索。');
        return;
      }
      if (!writerData) writerData = {};
      if (!Array.isArray(writerData.evidenceCards)) writerData.evidenceCards = [];
      const newId = `EV-${String(writerData.evidenceCards.length + 1).padStart(3, '0')}`;
      writerData.evidenceCards.push({
        evidence_id: newId,
        claim_type: parsedSourceUrl ? 'verified_fact' : 'unverified_fact',
        evidence_summary: summary.trim(),
        source_title: parsedSourceUrl?.hostname || '人工补充待核查',
        source_url: parsedSourceUrl?.href || '',
        reliability: parsedSourceUrl ? 'medium' : 'low',
      });
      renderEvidenceCardsList();
      const saved = await saveWriterProjectDataAsync('evidenceCards', writerData.evidenceCards);
      if (saved?.ok && !parsedSourceUrl) void autoVerifyPendingEvidence(activeProjectId);
    }

    async function humanApproveEvidenceCard(idx) {
      const card = writerData?.evidenceCards?.[idx];
      if (!card || card.claim_type !== 'unverified_fact') return;
      const reviewNote = prompt('请写明你确认这条主张的依据；若只确认其中一部分，请先拆成独立证据卡：');
      if (!reviewNote || !reviewNote.trim()) return;
      const sourceInput = prompt('可补充来源链接（可留空）：', card.source_url || '');
      if (sourceInput === null) return;
      let sourceUrl = '';
      if (sourceInput.trim()) {
        try {
          const url = new URL(sourceInput.trim());
          if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Error('invalid');
          sourceUrl = url.href;
        } catch (e) {
          alert('来源链接格式无效，请填写 http(s) 链接或留空。');
          return;
        }
      }
      writerData.evidenceCards[idx] = {
        ...card,
        claim_type: 'verified_fact',
        verification_status: 'human_approved',
        verification_method: 'human_review',
        verification_reason: '',
        review_note: reviewNote.trim(),
        human_reviewed_at: new Date().toISOString(),
        source_url: sourceUrl,
        source_title: sourceUrl ? new URL(sourceUrl).hostname : (card.source_title || '人工复核'),
        reliability: sourceUrl ? 'medium' : 'low',
      };
      const saved = await saveWriterProjectDataAsync('evidenceCards', writerData.evidenceCards);
      if (saved?.ok) {
        renderEvidenceCardsList();
        showToast('✅ 已记录人工复核结论与判断依据。');
      }
    }

    function deleteEvidenceCard(idx) {
      if (!writerData?.evidenceCards) return;
      writerData.evidenceCards.splice(idx, 1);
      renderEvidenceCardsList();
      saveWriterProjectDataAsync('evidenceCards', writerData.evidenceCards);
    }

    // 渲染大纲（支持直接在界面上编辑章节标题、子问题、机制概述与过渡）
    function renderOutlineView() {
      const outline = writerData?.outline;
      if (!outline) {
        document.getElementById('wOutlineChaptersList').innerHTML =
          '<div class="text-center py-8 text-gray-500 text-xs">暂无大纲章节，请核验证据卡后点击「🤖 基于证据卡生成大纲」</div>';
        document.getElementById('wOutlineChapterCountBadge').textContent = '0 章';
        return;
      }

      if (outline.opening_hook) {
        document.getElementById('wOutlineOpeningQuestion').value = outline.opening_hook.opening_question || '';
        document.getElementById('wOutlineOpeningAnswer').value = outline.opening_hook.immediate_short_answer || '';
      }
      if (outline.single_ending_plan) {
        document.getElementById('wOutlineEndingTakeaway').value =
          outline.single_ending_plan.final_takeaway || outline.single_ending_plan.revisit_core_question || '';
      }

      const listEl = document.getElementById('wOutlineChaptersList');
      const countEl = document.getElementById('wOutlineChapterCountBadge');
      const chapters = outline.chapters || [];
      countEl.textContent = `${chapters.length} 章`;

      if (chapters.length === 0) {
        listEl.innerHTML = '<div class="text-center py-8 text-gray-500 text-xs">暂无大纲章节，请核验证据卡后点击「🤖 基于证据卡生成大纲」</div>';
        return;
      }

      const escAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const isHydrated = Boolean(outline._hydrated_from_script);

      listEl.innerHTML = (isHydrated
        ? '<div class="p-2 rounded-lg bg-purple-950/20 border border-purple-500/30 text-[11px] text-purple-300">💡 当前大纲已由定稿文案自动提取映射，你可以直接修改任意字段后点击「💾 保存大纲修改」：</div>'
        : '') + chapters
        .map(
          (ch, i) => `
        <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 hover:border-purple-500/40 transition space-y-2.5" data-outline-idx="${i}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="px-2 py-0.5 rounded bg-purple-600/25 text-purple-300 border border-purple-500/30 font-mono text-[10px] font-black shrink-0">第 ${ch.chapter_number || i + 1} 章</span>
              <input type="text" data-field="chapter_title" value="${escAttr(ch.chapter_title)}" placeholder="章节标题..."
                class="flex-1 min-w-0 bg-gray-900 text-white font-bold text-xs px-2.5 py-1 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500" />
            </div>
            <div class="flex items-center gap-1.5 flex-wrap shrink-0">
              ${(ch.supporting_evidence_ids || ch.bound_evidence_ids || [])
                .map((ev) => `<span class="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold">${ev}</span>`)
                .join('')}
            </div>
          </div>
          <div>
            <label class="block text-[10px] text-amber-300/90 font-semibold mb-1">🎯 核心子问题：</label>
            <input type="text" data-field="sub_question" value="${escAttr(ch.sub_question || ch.core_question || '')}" placeholder="本章要回答的核心子问题..."
              class="w-full bg-gray-900 text-amber-200 text-xs px-2.5 py-1 rounded-lg border border-gray-800 focus:outline-none focus:border-amber-400" />
          </div>
          <div>
            <label class="block text-[10px] text-emerald-300/90 font-semibold mb-1">📌 对总标题的直接原因回答（因为……）：</label>
            <input type="text" data-field="direct_reason_to_title" value="${escAttr(ch.direct_reason_to_title || ch.direct_answer_to_title || '')}" placeholder="本章直接证明了总标题的第几条原因：因为..."
              class="w-full bg-gray-900 text-emerald-200 text-xs px-2.5 py-1 rounded-lg border border-gray-800 focus:outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label class="block text-[10px] text-gray-400 font-semibold mb-1">💡 机制与内容概述：</label>
            <textarea rows="2" data-field="mechanism_or_background_summary" placeholder="机制与案例要点..."
              class="w-full bg-gray-900 text-gray-300 text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-800 focus:outline-none focus:border-purple-500 leading-relaxed">${escAttr(ch.mechanism_or_background_summary || ch.mechanism || '')}</textarea>
          </div>
          <div>
            <label class="block text-[10px] text-gray-500 font-semibold mb-1">↪ 承接下章过渡（可选）：</label>
            <input type="text" data-field="transition_to_next" value="${escAttr(ch.transition_to_next || '')}" placeholder="引向下一章的自然过渡设问..."
              class="w-full bg-gray-900 text-gray-400 font-mono text-[11px] px-2.5 py-1 rounded-lg border border-gray-800 focus:outline-none focus:border-purple-500" />
          </div>
        </div>
      `
        )
        .join('');
    }

    async function saveOutlineManual() {
      if (!writerData) writerData = {};
      if (!writerData.outline) {
        writerData.outline = {
          project_id: activeProjectId,
          title: document.getElementById('wInputTitle').value.trim() || activeProjectId,
          approval_status: 'pending_user_review',
          opening_hook: {},
          chapters: [],
          single_ending_plan: {},
        };
      }
      const outline = writerData.outline;
      if (!outline.opening_hook) outline.opening_hook = {};
      outline.opening_hook.opening_question = document.getElementById('wOutlineOpeningQuestion').value.trim();
      outline.opening_hook.immediate_short_answer = document.getElementById('wOutlineOpeningAnswer').value.trim();

      if (!outline.single_ending_plan) outline.single_ending_plan = {};
      outline.single_ending_plan.final_takeaway = document.getElementById('wOutlineEndingTakeaway').value.trim();

      const cards = document.querySelectorAll('#wOutlineChaptersList [data-outline-idx]');
      cards.forEach((card) => {
        const idx = Number(card.getAttribute('data-outline-idx'));
        if (!outline.chapters[idx]) return;
        const ch = outline.chapters[idx];
        const titleInput = card.querySelector('[data-field="chapter_title"]');
        const subQInput = card.querySelector('[data-field="sub_question"]');
        const reasonInput = card.querySelector('[data-field="direct_reason_to_title"]');
        const mechInput = card.querySelector('[data-field="mechanism_or_background_summary"]');
        const transInput = card.querySelector('[data-field="transition_to_next"]');
        if (titleInput) ch.chapter_title = titleInput.value.trim();
        if (subQInput) ch.sub_question = subQInput.value.trim();
        if (reasonInput) ch.direct_reason_to_title = reasonInput.value.trim();
        if (mechInput) ch.mechanism_or_background_summary = mechInput.value.trim();
        if (transInput) ch.transition_to_next = transInput.value.trim();

        // 同步更新内存中的分章标题与子问题
        if (Array.isArray(writerData.chapters)) {
          const matchCh = writerData.chapters.find((c) => Number(c.chapter_number) === Number(ch.chapter_number || idx + 1));
          if (matchCh) {
            matchCh.chapter_title = ch.chapter_title;
            matchCh.sub_question = ch.sub_question;
          }
        }
      });

      delete outline._hydrated_from_script;
      writerData.hasExistingContent = true;
      const saved = await saveWriterProjectDataAsync('outline', outline);
      if (!saved?.ok) {
        alert('保存大纲失败：' + (saved?.error || '请重试'));
        return;
      }
      renderChapterTabs();
      renderCurrentChapterEditor();
      applyWriterInspectorMode(writerData);
      showToast('💾 完整大纲已保存，并同步至逐章视图！');
      showCompletionModal({
        icon: '💾',
        title: '大纲修改保存已完成',
        message: '完整大纲修改已保存，并同步至逐章视图！',
      });
    }

    // 渲染单章 Tabs 与编辑器
    function renderChapterTabs() {
      const bar = document.getElementById('wChapterTabsBar');
      if (!bar) return;
      const outline = writerData?.outline;
      const chapters = outline?.chapters?.length ? outline.chapters : (writerData?.chapters || []);
      if (chapters.length === 0) {
        bar.innerHTML = '<span class="text-xs text-gray-500 py-1">请先完成大纲审核，章节选项卡将在此呈现</span>';
        return;
      }

      bar.innerHTML = chapters
        .map(
          (ch, idx) => `
        <button type="button" onclick="selectEditingChapter(${idx})" class="px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
          idx === currentChapterIndex
            ? 'bg-purple-600 text-white shadow'
            : 'card text-gray-400 hover:text-white hover:border-purple-500/40'
        }">
          第 ${ch.chapter_number || idx + 1} 章
        </button>
      `
        )
        .join('');
    }

    function selectEditingChapter(idx) {
      currentChapterIndex = idx;
      renderChapterTabs();
      renderCurrentChapterEditor();
    }

    function renderCurrentChapterEditor() {
      const outline = writerData?.outline;
      const chList = writerData?.chapters || [];
      const targetCh = outline?.chapters?.[currentChapterIndex] || chList[currentChapterIndex];
      const writtenData = chList.find(
        (c) => Number(c.chapter_number) === Number(targetCh?.chapter_number || currentChapterIndex + 1)
      ) || targetCh;

      const chNumber = targetCh?.chapter_number || currentChapterIndex + 1;
      const chTitle = writtenData?.chapter_title || targetCh?.chapter_title || `第 ${chNumber} 章`;
      const subQuestion = targetCh?.sub_question || targetCh?.core_question || writtenData?.sub_question || '';

      document.getElementById('wCurChapterPrefix').textContent = `第 ${chNumber} 章`;
      document.getElementById('wCurChapterTitleInput').value = chTitle;
      document.getElementById('wCurChapterSubQuestion').textContent = subQuestion ? `子问题：${subQuestion}` : '子问题：已自适应映射';

      if (writtenData) {
        const sec = writtenData.sections || {};
        document.getElementById('wSec1Question').value = sec['1_question_or_contradiction'] || '';
        document.getElementById('wSec2Mechanism').value = sec['2_mechanism_or_background'] || '';
        document.getElementById('wSec3Examples').value = sec['3_sourced_concrete_examples'] || '';
        document.getElementById('wSec4Transition').value = sec['4_mini_summary_and_transition'] || '';
        updateCurrentChapterLiveWordCount();
        document.getElementById('wCurChapterRevisionBadge').textContent = writtenData._hydrated_from_script
          ? '定稿文本回显'
          : `修订数: ${writtenData.revision_count || 0}`;
      } else {
        document.getElementById('wSec1Question').value = '';
        document.getElementById('wSec2Mechanism').value = '';
        document.getElementById('wSec3Examples').value = '';
        document.getElementById('wSec4Transition').value = '';
        document.getElementById('wCurChapterWordCount').textContent = '0';
        document.getElementById('wCurChapterRevisionBadge').textContent = '未撰写';
      }
    }

    function updateCurrentChapterLiveWordCount() {
      const len =
        document.getElementById('wSec1Question').value.trim().length +
        document.getElementById('wSec2Mechanism').value.trim().length +
        document.getElementById('wSec3Examples').value.trim().length +
        document.getElementById('wSec4Transition').value.trim().length;
      document.getElementById('wCurChapterWordCount').textContent = len;
    }

    function toggleEditorialLogDetails() {
      const details = document.getElementById('wEditorialLogDetails');
      const hint = document.getElementById('wEditorialLogToggleHint');
      if (!details) return;
      const isHidden = details.classList.toggle('hidden');
      if (hint) hint.textContent = isHidden ? '[▾ 详情]' : '[▴ 收起]';
    }

    // 渲染定稿与统稿报告
    function renderFinalScriptView() {
      const script = writerData?.finalScript;
      if (!script) {
        document.getElementById('wFinalScriptWords').textContent = '0';
        document.getElementById('wFinalScriptMin').textContent = '0.0';
        document.getElementById('wFinalScriptFullText').value = '';
        if (typeof renderRevisionChapterPicker === 'function') renderRevisionChapterPicker();
        return;
      }

      const fullText = [];
      if (script.script_segments) {
        if (script.script_segments.opening) {
          fullText.push(script.script_segments.opening.trim());
        }
        if (Array.isArray(script.script_segments.chapters)) {
          script.script_segments.chapters.forEach((c) => {
            const body = (c.narration_text || '').trim();
            if (body) fullText.push(body);
          });
        }
        if (script.script_segments.ending) {
          fullText.push(script.script_segments.ending.trim());
        }
      } else if (script.full_narration_text) {
        fullText.push(script.full_narration_text.trim());
      } else if (Array.isArray(script.approved_narration_sentences)) {
        fullText.push(script.approved_narration_sentences.join('\n'));
      } else if (script.content) {
        fullText.push(String(script.content).trim());
      }

      const combinedText = fullText.join('\n\n');
      document.getElementById('wFinalScriptFullText').value = combinedText;

      const calcWords = combinedText.replace(/\s+/g, '').length;
      const wordCount = script.total_word_count || calcWords;
      const durationMin = script.estimated_duration_minutes || Number((wordCount / 240).toFixed(1));

      document.getElementById('wFinalScriptWords').textContent = wordCount;
      document.getElementById('wFinalScriptMin').textContent = durationMin;

      const log = script.editorial_changes_log;
      if (script._merged_from_drafts) {
        document.getElementById('wRemovedFalseEndingsBadge').textContent = '章节已合并 · 待 AI 统稿复核';
        document.getElementById('wEditorialLogDetails').textContent = '已保留完整章节稿，请重新执行 AI 统稿完成证据复核。';
      } else if (log) {
        document.getElementById('wRemovedFalseEndingsBadge').textContent = `已清理伪结尾: ${log.removed_false_endings_count || 0} 处`;
        const logHtml = [];
        if (log.removed_duplicate_arguments?.length) {
          logHtml.push(`<div>🗑️ 删除重复论点：${log.removed_duplicate_arguments.join('；')}</div>`);
        }
        if (log.removed_duplicate_examples?.length) {
          logHtml.push(`<div>📦 统一案例出场：${log.removed_duplicate_examples.join('；')}</div>`);
        }
        if (log.unified_terms_and_names?.length) {
          logHtml.push(`<div>📝 统一专有名词与读法：${log.unified_terms_and_names.join('；')}</div>`);
        }
        document.getElementById('wEditorialLogDetails').innerHTML = logHtml.length ? logHtml.join('') : '<div>- 全篇逻辑顺畅，未发现明显冗余与伪结尾。</div>';
      } else {
        document.getElementById('wRemovedFalseEndingsBadge').textContent = '已清理伪结尾: 0 处';
        document.getElementById('wEditorialLogDetails').innerHTML = '<div>- 全篇已完成定稿，支持随时在线编辑或启动下方 AI 修复器。</div>';
      }
      updateHumanizeVersionUI(script?.humanize_meta || null);
      if (typeof renderRevisionChapterPicker === 'function') renderRevisionChapterPicker();
    }

    // ==========================================
    // AI 自动化生成执行与异步请求
    // ==========================================

    // 🌐 联网深度调查事实真相并补充资料库
    async function aiAutoResearchMaterials() {
      const title = document.getElementById('wInputTitle').value.trim();
      if (!title) {
        alert('请先在上方输入视频题目（例如：为什么日本旅馆总有那么多小碟子？）');
        return;
      }
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAutoResearchMaterials');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在联网考证事实真相...</span>';
      try {
        const res = await fetch('/api/writer/ai/research-materials?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.materials) {
          document.getElementById('wInputMaterials').value = data.materials;
          document.getElementById('wMaterialWordCount').textContent = '已自动考证补充 ' + data.materials.length + ' 字事实资料';
          setWriterPersistenceStatus('saved');
          showToast('✅ 事实调查完毕，已为您自动充实参考资料库！');
          showCompletionModal({
            icon: '🌐',
            title: '事实资料调查已完成',
            message: '已完成联网事实考证，共补充 ' + data.materials.length + ' 字参考资料。',
          });
        } else {
          alert('调查资料失败: ' + (data.error || '网关响应异常'));
        }
      } catch (err) {
        alert('网络考证异常: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🌐 联网调查事实补充资料</span>';
      }
    }

    async function aiGenerateBrief() {
      const title = document.getElementById('wInputTitle').value.trim();
      const materials = document.getElementById('wInputMaterials').value.trim();
      const duration = parseInt(document.getElementById('wInputDuration').value, 10) || 25;
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiBrief');

      if (!title) {
        alert('请在左侧填入视频标题！');
        return;
      }

      const isAutoResearching = !materials && !writerData?.materials;
      btn.disabled = true;
      btn.innerHTML = isAutoResearching
        ? '<span>🌐 正在自动调查事实真相并生成 Brief...</span>'
        : '<span>⏳ AI 正在深度分析资料生成 Brief...</span>';

      try {
        const res = await fetch('/api/writer/ai/generate-brief?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            materials,
            durationMinutes: duration,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.brief) {
          if (!writerData) writerData = {};
          writerData.brief = data.brief;
          const resolvedTitle = (data.brief.title || title || '').trim();
          if (resolvedTitle) {
            document.getElementById('wInputTitle').value = resolvedTitle;
            updateActiveProjectTitleUI(resolvedTitle);
          }
          document.getElementById('wBriefCoreQuestion').value = data.brief.core_question || '';
          document.getElementById('wBriefShortAnswer').value = data.brief.short_answer || '';
          document.getElementById('wBriefScope').value = data.brief.scope?.time_range || '';
          document.getElementById('wBriefTaboos').value = (data.brief.taboos_and_exclusions || []).join('、');
          if (data.brief.planned_chapter_count) document.getElementById('wInputChapterCount').value = data.brief.planned_chapter_count;
          writerData.materials = data.researchedMaterials || materials || writerData.materials;
          setWriterPersistenceStatus('saved');

          if (data.researchedMaterials) {
            document.getElementById('wInputMaterials').value = data.researchedMaterials;
            document.getElementById('wMaterialWordCount').textContent = '已自动考证补充 ' + data.researchedMaterials.length + ' 字事实资料';
            showToast('🌐 已自动调查事实真相并补充资料库，Brief 生成完毕！');
          } else {
            showToast('✅ Brief 立项已成功生成！');
          }
          showCompletionModal({
            icon: '📋',
            title: 'Brief 立项生成已完成',
            message: data.researchedMaterials ? '已自动调查补充事实资料并生成 Brief 立项！' : 'Brief 立项已生成并保存！',
          });
        } else {
          alert('生成 Brief 失败: ' + (data.error || '大模型返回格式异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 AI 分析资料并生成 Brief</span>';
      }
    }

    async function autoVerifyPendingEvidence(projectId) {
      if (verifyingEvidenceProjectId || !writerData?.evidenceCards?.some(
        (card) => card.claim_type === 'unverified_fact' && !card.verification_checked_at
      )) return;
      verifyingEvidenceProjectId = projectId;
      let checked = 0;
      let verified = 0;
      try {
        showToast('🔎 正在用 Tavily 自动核查待核查事实...');
        for (let batch = 0; batch < 100; batch++) {
          const res = await fetch('/api/writer/ai/verify-pending-evidence?project=' + projectId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: document.getElementById('wInputModel').value,
              apiKey: visualConfig.apiKey,
              baseUrl: visualConfig.baseUrl,
            }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.errors?.join('；') || data.error || '自动核查失败');
          checked += data.checkedCount || 0;
          verified += data.verifiedCount || 0;
          if (activeProjectId === projectId && Array.isArray(data.evidenceCards)) {
            writerData.evidenceCards = data.evidenceCards;
            renderEvidenceCardsList();
          }
          if (!data.remainingCount || !data.checkedCount) break;
        }
        if (checked) {
          showToast('🔎 自动核查完成：核查 ' + checked + ' 张，通过 ' + verified + ' 张；其余未通过本次核查。');
          showCompletionModal({
            icon: '🔎',
            title: '证据卡自动核查已完成',
            message: '共核查 ' + checked + ' 张卡片，通过 ' + verified + ' 张。',
            detail: checked > verified ? '未通过自动核查的卡片已保留为人工复核候选。' : '全部待核查卡片均已通过核验！',
          });
        }
      } catch (error) {
        console.error('自动核查证据卡失败:', error);
        showToast('⚠️ 自动核查暂停：' + error.message);
      } finally {
        verifyingEvidenceProjectId = null;
      }
    }

    async function aiExtractEvidence() {
      const brief = readWriterBriefFromForm();
      const title = brief.title;
      const materials = document.getElementById('wInputMaterials').value.trim();
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiEvidence');

      if (!title) {
        alert('请在左侧填入视频标题！');
        return;
      }

      const isAutoResearching = !materials && !writerData?.materials;
      btn.disabled = true;
      btn.innerHTML = isAutoResearching
        ? '<span>🌐 正在自动调查事实真相并提取证据卡...</span>'
        : '<span>⏳ 正在提取原子化证据卡...</span>';

      try {
        const res = await fetch('/api/writer/ai/extract-evidence?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            brief,
            materials,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.evidenceCards)) {
          if (!writerData) writerData = {};
          writerData.brief = brief;
          writerData.materials = data.researchedMaterials || materials || writerData.materials;
          writerData.evidenceCards = data.evidenceCards;
          renderEvidenceCardsList();
          setWriterPersistenceStatus('saved');

          if (data.researchedMaterials) {
            document.getElementById('wInputMaterials').value = data.researchedMaterials;
            document.getElementById('wMaterialWordCount').textContent = '已自动考证补充 ' + data.researchedMaterials.length + ' 字事实资料';
            showToast('🌐 事实真相调查完毕，已成功抽取 ' + data.evidenceCards.length + ' 张证据卡！');
          } else {
            showToast('✅ 已成功提取 ' + data.evidenceCards.length + ' 张独立证据卡！');
          }
          showCompletionModal({
            icon: '🃏',
            title: '证据卡提取已完成',
            message: '已成功提取 ' + data.evidenceCards.length + ' 张独立证据卡！',
            detail: data.pendingEvidenceCount ? ('其中 ' + data.pendingEvidenceCount + ' 张待核查卡片将在后台自动核验。') : '',
          });
          if (data.pendingEvidenceCount) void autoVerifyPendingEvidence(activeProjectId);
        } else {
          alert('提取证据卡失败: ' + (data.error || '格式异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 从资料中提取证据卡</span>';
      }
    }

    function approveEvidenceCardsGate() {
      const count = writerData?.evidenceCards?.length || 0;
      if (count === 0) {
        alert('当前尚未提取或录入任何证据卡，无法开启大纲策划！');
        return;
      }
      const approved = writerData.evidenceCards.filter((card) => card.claim_type !== 'unverified_fact').length;
      if (approved === 0) {
        alert('当前证据卡均未通过自动核验，已列为人工复核候选；请先逐张复核，再进入大纲策划。');
        return;
      }
      const unresolved = writerData.evidenceCards.filter((card) => card.claim_type === 'unverified_fact').length;
      showToast(unresolved
        ? '🚦 已进入大纲策划；仍有 ' + unresolved + ' 张待人工复核卡，不能作为已核实事实使用。'
        : '🚦 证据卡已审核，进入阶段 3：大纲策划');
      setWriterStep(3);
    }

    async function aiBuildOutline() {
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiOutline');

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在规划 5~7 章结构化大纲...</span>';
      try {
        const res = await fetch('/api/writer/ai/build-outline?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brief: readWriterBriefFromForm(),
            materials: document.getElementById('wInputMaterials').value.trim(),
            evidenceCards: writerData?.evidenceCards || [],
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.outline) {
          if (!writerData) writerData = {};
          writerData.outline = data.outline;
          if (Array.isArray(data.evidenceCards)) {
            writerData.evidenceCards = data.evidenceCards;
            renderEvidenceCardsList();
          }
          currentChapterIndex = 0;
          renderOutlineView();
          renderChapterTabs();
          renderCurrentChapterEditor();
          setWriterPersistenceStatus('saved');
          showToast('✅ 结构化大纲生成完成，请人工审核！');
          showCompletionModal({
            icon: '🗂️',
            title: '结构化大纲生成已完成',
            message: '已生成 ' + (data.outline?.chapters?.length || 0) + ' 章结构化大纲并保存！',
            detail: '请人工审核各章子问题与过渡后再进入单章撰写。',
          });
        } else {
          alert('生成大纲失败: ' + (data.error || '大模型异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 基于证据卡生成大纲</span>';
      }
    }

    function approveOutlineGate() {
      if (!writerData?.outline || !writerData.outline.chapters?.length) {
        alert('请先生成大纲后再进行人工审核！');
        return;
      }
      writerData.outline.approval_status = 'approved';
      saveWriterProjectDataAsync('outline', writerData.outline);
      showToast('🚦 大纲审核通过 (APPROVED)！解锁阶段 4 单章撰写');
      renderChapterTabs();
      renderCurrentChapterEditor();
      setWriterStep(4);
    }

    async function aiWriteCurrentChapter() {
      const outline = writerData?.outline;
      const targetCh = outline?.chapters?.[currentChapterIndex];
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiWriteChapter');

      if (!targetCh) {
        alert('未找到当前章节的大纲规划！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在撰写本章 (四段式结构)...</span>';
      try {
        const res = await fetch('/api/writer/ai/write-chapter?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapterNumber: targetCh.chapter_number || currentChapterIndex + 1,
            outline,
            evidenceCards: writerData.evidenceCards || [],
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.chapter) {
          if (!Array.isArray(writerData.chapters)) writerData.chapters = [];
          const existIdx = writerData.chapters.findIndex((c) => Number(c.chapter_number) === Number(data.chapter.chapter_number));
          if (existIdx >= 0) {
            writerData.chapters[existIdx] = data.chapter;
          } else {
            writerData.chapters.push(data.chapter);
          }
          renderCurrentChapterEditor();
          setWriterPersistenceStatus('saved');
          showToast(`✅ 第 ${data.chapter.chapter_number} 章文案撰写完成（${data.chapter.word_count} 字）！`);
          showCompletionModal({
            icon: '✍️',
            title: '第 ' + data.chapter.chapter_number + ' 章撰写已完成',
            message: '第 ' + data.chapter.chapter_number + ' 章文案撰写完成并已保存（共 ' + data.chapter.word_count + ' 字）。',
          });
        } else {
          alert('撰写章节失败: ' + (data.error || '大模型异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 AI 撰写当前章节</span>';
      }
    }

    async function saveCurrentChapterDraft() {
      const outlineCh = writerData?.outline?.chapters?.[currentChapterIndex];
      const chapters = writerData?.chapters || [];
      const targetNum = outlineCh?.chapter_number || chapters[currentChapterIndex]?.chapter_number || currentChapterIndex + 1;
      const existingCh = chapters.find((chapter) => Number(chapter.chapter_number) === Number(targetNum));
      const editedTitle = document.getElementById('wCurChapterTitleInput').value.trim() || outlineCh?.chapter_title || `第${targetNum}章`;
      const sec1 = document.getElementById('wSec1Question').value.trim();
      const sec2 = document.getElementById('wSec2Mechanism').value.trim();
      const sec3 = document.getElementById('wSec3Examples').value.trim();
      const sec4 = document.getElementById('wSec4Transition').value.trim();
      const fullText = [sec1, sec2, sec3, sec4].filter(Boolean).join('\n\n');

      const chObj = {
        chapter_number: Number(targetNum),
        chapter_title: editedTitle,
        sub_question: outlineCh?.sub_question || existingCh?.sub_question || '',
        sections: {
          '1_question_or_contradiction': sec1,
          '2_mechanism_or_background': sec2,
          '3_sourced_concrete_examples': sec3,
          '4_mini_summary_and_transition': sec4,
        },
        full_chapter_narration: fullText,
        used_evidence_ids: existingCh?.used_evidence_ids || [],
        word_count: fullText.length,
        revision_count: (existingCh?.revision_count || 0) + 1,
      };

      if (!writerData) writerData = {};
      if (!Array.isArray(writerData.chapters)) writerData.chapters = [];
      const existIdx = writerData.chapters.findIndex((c) => Number(c.chapter_number) === Number(targetNum));
      if (existIdx >= 0) {
        writerData.chapters[existIdx] = chObj;
      } else {
        writerData.chapters.push(chObj);
      }

      if (outlineCh) {
        outlineCh.chapter_title = editedTitle;
      }

      if (writerData.finalScript?.script_segments?.chapters) {
        const fsCh = writerData.finalScript.script_segments.chapters.find((c) => Number(c.chapter_number) === Number(targetNum));
        if (fsCh) {
          fsCh.chapter_title = editedTitle;
          fsCh.narration_text = fullText;
          let totalW = (writerData.finalScript.script_segments.opening || '').length + (writerData.finalScript.script_segments.ending || '').length;
          writerData.finalScript.script_segments.chapters.forEach((c) => { totalW += (c.narration_text || '').length; });
          writerData.finalScript.total_word_count = totalW;
          writerData.finalScript.estimated_duration_minutes = Number((totalW / 240).toFixed(1));
          renderFinalScriptView();
        }
      }

      writerData.hasExistingContent = true;
      document.getElementById('wCurChapterWordCount').textContent = fullText.length;
      document.getElementById('wCurChapterRevisionBadge').textContent = `修订数: ${chObj.revision_count}`;

      const savedCh = await saveWriterProjectDataAsync('chapter', chObj);
      if (!savedCh?.ok) {
        alert('保存章节失败：' + (savedCh?.error || '请重试'));
        return;
      }
      if (outlineCh) {
        renderOutlineView();
        const savedOut = await saveWriterProjectDataAsync('outline', writerData.outline);
        if (!savedOut?.ok) {
          alert('同步大纲标题失败：' + (savedOut?.error || '请重试'));
          return;
        }
      }
      applyWriterInspectorMode(writerData);
      showToast(`💾 第 ${targetNum} 章已保存（并同步至定稿全文与概览）！`);
      showCompletionModal({
        icon: '💾',
        title: '章节修改保存已完成',
        message: '第 ' + targetNum + ' 章修改已保存（共 ' + fullText.length + ' 字），并同步至定稿全文与概览！',
      });
    }

    let pendingFinalizedScript = null;

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
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在全文去重去伪结尾与统稿...</span>';
      try {
        const res = await fetch('/api/writer/ai/finalize-script?project=' + encodeURIComponent(projectId), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outline: writerData?.outline, chapters: writerData?.chapters || [], evidenceCards: writerData?.evidenceCards || [], model: document.getElementById('wInputModel').value, apiKey: visualConfig.apiKey, baseUrl: visualConfig.baseUrl }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.finalScript) throw new Error(data.error || '异常');
        if (activeProjectId !== projectId) { showToast('工程已切换，本次统稿结果未保存。'); return; }
        pendingFinalizedScript = { projectId, before, result: data.finalScript, fallback: data.usedFallback };
        const note = document.getElementById('wFinalizeReviewNote');
        note.textContent = data.usedFallback
          ? '模型未返回完整结果，右侧是合并后的章节稿，尚需 AI 统稿复核。确认前不会覆盖定稿。'
          : '左侧为生成前定稿，右侧为 AI 统稿结果；红色为原文删改，绿色为新增或改写。确认前不会覆盖已保存的定稿。';
        setStep5StageMode('finalize_diff');
        renderFinalizeDiffView();
        document.getElementById('wStep5MainStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('统稿结果已生成，请先审阅并确认。');
        showCompletionModal({
          icon: '🤖',
          title: 'AI 全文统稿已完成',
          message: data.usedFallback ? '章节合并稿已生成（模型未返回完整统稿，请复核）。' : '全文去重、去伪结尾与统稿结果已生成！',
          detail: '请先审阅左右对比差异，确认后点击「✅ 确认替换并保存」。',
        });
      } catch (err) { alert('全文统稿失败: ' + err.message); }
      finally { btn.disabled = false; btn.innerHTML = '<span>🤖 AI 全文统稿去重去伪结尾</span>'; }
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
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
        badge.textContent = customText || '● 有未保存修改（点击保存写盘）';
      } else if (mode === 'saving') {
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40';
        badge.textContent = customText || '⏳ 正在写入本地...';
      } else {
        const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        badge.className = 'px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
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

    let step1SelectedScriptText = '';
    let step1ScannedScripts = [];

    async function loadStep1ScannedScripts() {
      const container = document.getElementById('wStep1ScannedList');
      if (!container) return;
      container.innerHTML =
        '<div class="text-center py-6 text-gray-400 text-xs flex items-center justify-center gap-2"><span class="animate-spin">🔄</span> 正在检索 exports/ 目录下的可用文案...</div>';
      try {
        const res = await fetch('/api/scan-local-scripts');
        const data = await res.json();
        step1ScannedScripts = data.scripts || [];
        if (step1ScannedScripts.length === 0) {
          container.innerHTML =
            '<div class="text-center py-6 text-gray-500 text-xs">exports/ 目录下未发现 .txt / .md / .json 文案文件。</div>';
          return;
        }

        container.innerHTML = step1ScannedScripts
          .map(
            (s) => `
          <div class="p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-500/50 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold text-white truncate max-w-md">${s.title}</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded ${s.isFullScript ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold' : 'bg-gray-800 text-gray-400'}">
                  ${s.isFullScript ? '✨ 完整长片文案' : '📄 章节草稿'}
                </span>
                <span class="text-[10px] text-gray-400">${s.wordCount} 字 · ${s.sizeKb} KB · ${s.ext}</span>
              </div>
              <div class="text-[11px] text-gray-400 line-clamp-1 font-mono">${s.preview || s.filename}</div>
            </div>
            <button type="button" onclick="selectStep1Script('${s.filename}')" class="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white shrink-0 transition flex items-center gap-1 shadow cursor-pointer">
              <span>📥 选择并切镜</span>
            </button>
          </div>
        `
          )
          .join('');
      } catch (err) {
        container.innerHTML = '<div class="text-center py-4 text-rose-400 text-xs">扫描失败: ' + err.message + '</div>';
      }
    }

    async function selectStep1Script(filename) {
      const script = step1ScannedScripts.find((s) => s.filename === filename);
      if (!script) return;
      showToast('正在读取《' + script.title + '》...');
      try {
        const res = await fetch('/api/get-export-script?filename=' + encodeURIComponent(filename));
        const data = await res.json();
        if (data.ok) {
          step1SelectedScriptText = data.content;
          document.getElementById('wStep1ImportProjId').value = data.suggestedProjectId || script.suggestedProjectId;
          document.getElementById('wStep1ImportProjTitle').value = data.title || script.title;
          document.getElementById('wStep1SelectedSummary').textContent = `已选: ${data.title || script.title} (${data.content.length} 字)`;
          document.getElementById('wStep1ImportConfigBox').classList.remove('hidden');
          previewStep1ImportSegmentation();
        } else {
          alert('读取失败: ' + data.error);
        }
      } catch (e) {
        alert('读取异常: ' + e.message);
      }
    }

    async function previewStep1ImportSegmentation() {
      if (!step1SelectedScriptText) return;
      const targetSeconds = parseFloat(document.getElementById('wStep1ImportDuration').value) || 5.5;
      const previewEl = document.getElementById('wStep1ImportPreviewCount');
      previewEl.textContent = '⏳ 计算切镜分段中...';
      try {
        const res = await fetch('/api/preview-script-segmentation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: step1SelectedScriptText, targetSecondsPerScene: targetSeconds }),
        });
        const data = await res.json();
        if (data.ok) {
          previewEl.textContent = `⚡ 预估将切分为 ${data.totalScenes} 个镜头 (总长约 ${data.totalDurationMinutes} 分钟，平均 ${data.avgSecondsPerScene} 秒/镜)`;
        }
      } catch (e) {
        previewEl.textContent = '';
      }
    }

    async function confirmStep1ImportToProducer() {
      if (!step1SelectedScriptText) {
        alert('请先选择要导入的文案！');
        return;
      }
      const projectId = document.getElementById('wStep1ImportProjId').value.trim();
      const title = document.getElementById('wStep1ImportProjTitle').value.trim();
      const targetSeconds = parseFloat(document.getElementById('wStep1ImportDuration').value) || 5.5;
      const btn = document.getElementById('btnStep1ImportExec');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在切镜并生成镜头清单...</span>';

      try {
        const res = await fetch('/api/import-script-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            title,
            content: step1SelectedScriptText,
            targetSecondsPerScene: targetSeconds,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast(`🎉 成功导入！已生成 ${data.totalScenes} 个镜头，正在进入制作台...`);
          activeProjectId = data.projectId;
          localStorage.setItem('whyvideo_active_project', activeProjectId);
          await loadProjects();
          switchWorkspaceTab('producer');
          await loadWorkflow();
        } else {
          alert('导入失败: ' + (data.error || '未知错误'));
          btn.disabled = false;
          btn.innerHTML = '<span>🚀 确认切镜并直接进入制作台</span>';
        }
      } catch (e) {
        alert('导入异常: ' + e.message);
        btn.disabled = false;
        btn.innerHTML = '<span>🚀 确认切镜并直接进入制作台</span>';
      }
    }

    let scannedExportScripts = [];
    let importDebounceTimer = null;

    function toggleImportScriptModal() {
      const modal = document.getElementById('importScriptModal');
      const isHidden = modal.classList.contains('hidden');
      if (isHidden) {
        modal.classList.remove('hidden');
        loadScannedScripts();
      } else {
        modal.classList.add('hidden');
      }
    }

    function switchImportTab(tab) {
      document.getElementById('importTabLocal').classList.toggle('hidden', tab !== 'local');
      document.getElementById('importTabPaste').classList.toggle('hidden', tab !== 'paste');
      document.getElementById('importTabUpload').classList.toggle('hidden', tab !== 'upload');

      const tabs = ['local', 'paste', 'upload'];
      const btnMap = { local: 'tabBtnLocal', paste: 'tabBtnPaste', upload: 'tabBtnUpload' };
      tabs.forEach((t) => {
        const btn = document.getElementById(btnMap[t]);
        if (t === tab) {
          btn.className = 'px-3 py-1 rounded-lg bg-violet-600 text-white shadow transition cursor-pointer';
        } else {
          btn.className = 'px-3 py-1 rounded-lg text-gray-400 hover:text-white transition cursor-pointer';
        }
      });
    }

    async function loadScannedScripts() {
      const container = document.getElementById('scannedScriptsList');
      container.innerHTML =
        '<div class="text-center py-6 text-gray-400 text-xs flex items-center justify-center gap-2"><span class="animate-spin">🔄</span> 正在扫描 exports/ 目录下的可用文案...</div>';
      try {
        const res = await fetch('/api/scan-local-scripts');
        const data = await res.json();
        scannedExportScripts = data.scripts || [];
        if (scannedExportScripts.length === 0) {
          container.innerHTML =
            '<div class="text-center py-6 text-gray-500 text-xs">exports/ 目录下未发现 .txt / .md / .json 文案文件，请使用“剪贴板快速粘贴”或“文件拖拽”。</div>';
          return;
        }

        container.innerHTML = scannedExportScripts
          .map(
            (s) => `
          <div class="p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-500/50 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold text-white truncate max-w-md">${s.title}</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded ${s.isFullScript ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold' : 'bg-gray-800 text-gray-400'}">
                  ${s.isFullScript ? '✨ 完整长片文案' : '📄 章节草稿'}
                </span>
                <span class="text-[10px] text-gray-400">${s.wordCount} 字 · ${s.sizeKb} KB · ${s.ext}</span>
              </div>
              <div class="text-[11px] text-gray-400 line-clamp-1 font-mono">${s.preview || s.filename}</div>
            </div>
            <button type="button" onclick="selectScannedScript('${s.filename}')" class="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-violet-600/90 hover:bg-violet-600 text-white shrink-0 transition flex items-center gap-1 shadow cursor-pointer">
              <span>📥 载入并智能切镜</span>
            </button>
          </div>
        `
          )
          .join('');
      } catch (e) {
        container.innerHTML = '<div class="text-center py-4 text-rose-400 text-xs">扫描失败: ' + e.message + '</div>';
      }
    }

    async function selectScannedScript(filename) {
      const script = scannedExportScripts.find((s) => s.filename === filename);
      if (!script) return;
      document.getElementById('importStatusMessage').innerHTML = '<span class="text-amber-400">正在读取文案内容...</span>';
      try {
        const res = await fetch('/api/get-export-script?filename=' + encodeURIComponent(filename));
        const data = await res.json();
        if (data.ok) {
          document.getElementById('importProjectId').value = data.suggestedProjectId || script.suggestedProjectId;
          document.getElementById('importProjectTitle').value = data.title || script.title;
          document.getElementById('importRawText').value = data.content;
          document.getElementById('importStatusMessage').innerHTML =
            '<span class="text-emerald-400 font-bold">✅ 已成功载入 《' + (data.title || script.title) + '》</span>';
          triggerUpdatePreview();
        } else {
          alert('读取文案失败: ' + data.error);
        }
      } catch (e) {
        alert('读取文案出错: ' + e.message);
      }
    }

    function onScriptTextInput() {
      clearTimeout(importDebounceTimer);
      importDebounceTimer = setTimeout(() => {
        triggerUpdatePreview();
      }, 400);
    }

    async function triggerUpdatePreview() {
      const content = document.getElementById('importRawText').value;
      const targetSeconds = parseFloat(document.getElementById('importTargetDuration').value) || 5.5;
      const title = document.getElementById('importProjectTitle').value;
      const projectId = document.getElementById('importProjectId').value;

      if (!content || !content.trim()) {
        document.getElementById('statWordCount').textContent = '0';
        document.getElementById('statDurationMin').textContent = '0.0';
        document.getElementById('statScenesCount').textContent = '0';
        document.getElementById('segmentPreviewList').innerHTML =
          '<div class="text-gray-500 text-center py-3 text-[11px]">暂无预览数据，请选择文案或粘贴内容</div>';
        return;
      }

      document.getElementById('previewNotice').textContent = '正在计算切片...';
      try {
        const res = await fetch('/api/preview-script-segmentation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, title, projectId, targetSeconds }),
        });
        const data = await res.json();
        if (data.ok) {
          if (!document.getElementById('importProjectId').value && data.projectId) {
            document.getElementById('importProjectId').value = data.projectId;
          }
          if (!document.getElementById('importProjectTitle').value && data.title) {
            document.getElementById('importProjectTitle').value = data.title;
          }

          document.getElementById('statWordCount').textContent = data.totalWords;
          document.getElementById('statDurationMin').textContent = data.estimatedMinutes;
          document.getElementById('statScenesCount').textContent = data.scenesCount;
          document.getElementById('previewNotice').textContent = `共预估切分为 ${data.scenesCount} 个镜头 (无缝拼接)`;

          const previewEl = document.getElementById('segmentPreviewList');
          if (data.sampleScenes && data.sampleScenes.length > 0) {
            previewEl.innerHTML = data.sampleScenes
              .map(
                (sc) => `
              <div class="p-2 rounded bg-gray-950 border border-gray-800 text-[11px] space-y-0.5">
                <div class="flex items-center justify-between text-gray-400">
                  <span class="text-amber-400 font-bold">${sc.scene_id} · [${sc.chapter_ref}]</span>
                  <span class="text-[10px] text-gray-500">${(sc.start_ms / 1000).toFixed(1)}s ~ ${(sc.end_ms / 1000).toFixed(1)}s (${(sc.duration_ms / 1000).toFixed(1)}s)</span>
                </div>
                <div class="text-gray-200 line-clamp-1">${sc.narration_text}</div>
                <div class="text-[10px] text-purple-400 font-semibold">🎯 提炼关键词: ${sc.content_keywords?.join('、')}</div>
              </div>
            `
              )
              .join('');
          }
        }
      } catch (e) {
        console.warn('切片预览失败:', e);
      }
    }

    function onImportDragOver(e) {
      e.preventDefault();
      document.getElementById('importDropZone').classList.add('border-violet-500', 'bg-violet-950/20');
    }

    function onImportDragLeave(e) {
      e.preventDefault();
      document.getElementById('importDropZone').classList.remove('border-violet-500', 'bg-violet-950/20');
    }

    function onImportDrop(e) {
      e.preventDefault();
      document.getElementById('importDropZone').classList.remove('border-violet-500', 'bg-violet-950/20');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportFile(e.dataTransfer.files[0]);
      }
    }

    function onImportFileSelected(e) {
      if (e.target.files && e.target.files.length > 0) {
        handleImportFile(e.target.files[0]);
      }
    }

    function handleImportFile(file) {
      const reader = new FileReader();
      reader.onload = function (evt) {
        const text = evt.target.result;
        document.getElementById('importRawText').value = text;
        const baseName = file.name.replace(/.[^/.]+$/, '');
        if (!document.getElementById('importProjectTitle').value) {
          document.getElementById('importProjectTitle').value = baseName;
        }
        switchImportTab('paste');
        triggerUpdatePreview();
        showToast('📄 已成功读取文件: ' + file.name);
      };
      reader.readAsText(file);
    }

    async function confirmImportScript() {
      const content = document.getElementById('importRawText').value;
      const title = document.getElementById('importProjectTitle').value.trim();
      const projectId = document.getElementById('importProjectId').value.trim();
      const targetSeconds = parseFloat(document.getElementById('importTargetDuration').value) || 5.5;
      const statusEl = document.getElementById('importStatusMessage');
      const btn = document.getElementById('confirmImportBtn');

      if (!content || !content.trim()) {
        alert('请先选择或粘贴文案内容！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在切镜并构建工程...</span>';
      statusEl.innerHTML = '<span class="text-amber-400">正在生成镜头清单、时间轴与 Remotion 属性...</span>';

      try {
        const res = await fetch('/api/import-script-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, title, content, targetSeconds }),
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.innerHTML = '<span class="text-emerald-400 font-bold">🎉 工程构建完成！</span>';
          showToast('🎉 工程《' + data.title + '》创建成功！共 ' + data.totalScenes + ' 个镜头');
          toggleImportScriptModal();

          activeProjectId = data.projectId;
          localStorage.setItem('whyvideo_active_project', data.projectId);
          const url = new URL(window.location);
          url.searchParams.set('project', data.projectId);
          window.history.pushState({}, '', url);
          await loadProjects();
          await loadWorkflow();
        } else {
          statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ ' + (data.error || '创建失败') + '</span>';
          alert('创建失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ 网络异常: ' + e.message + '</span>';
        alert('导入异常: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 确认导入并立即进入工程';
      }
    }

    // ==========================================
    // 🧭 Step 5 总编审稿与定向改稿台 (Editorial Review & Revision)
    // ==========================================
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


