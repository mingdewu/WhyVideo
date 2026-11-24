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
      resetFinalScriptSaveState();
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
      btn.innerHTML = '<span>⏳ 规划大纲</span>';
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

