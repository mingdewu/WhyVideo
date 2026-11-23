    // ==========================================
    // ⚙️ 文案创作台提示词设置（按 5 步工作流分组）
    // ==========================================
    const WRITER_PROMPT_STEP_GROUPS = [
      {
        step: 1,
        label: '1. 立项与资料',
        items: [
          { key: 'W1_research', label: '资料调研' },
          { key: 'W2_brief', label: '立项 Brief' },
        ],
      },
      {
        step: 2,
        label: '2. 证据卡提取核验',
        items: [
          { key: 'W3_evidence', label: '证据卡提取' },
        ],
      },
      {
        step: 3,
        label: '3. 完整大纲策划',
        items: [
          { key: 'W4_outline', label: '大纲策划' },
        ],
      },
      {
        step: 4,
        label: '4. 逐章撰写与润色',
        items: [
          { key: 'W5_chapter', label: '逐章撰写' },
        ],
      },
      {
        step: 5,
        label: '5. 全文统稿与定稿',
        items: [
          { key: 'W6_finalize', label: '全文统稿' },
          { key: 'W7_humanize', label: '去AI味润色' },
          { key: 'W8_revision_search', label: '改稿联网检索' },
          { key: 'W9_revision_plan', label: '改稿方案规划' },
          { key: 'W10_revision_execute', label: '按章定向改写' },
          { key: 'revision_quick_chips', label: '⚡ 快捷改稿指令' },
        ],
      },
    ];

    const WRITER_PROMPT_STAGE_KEYS = WRITER_PROMPT_STEP_GROUPS.flatMap((g) => g.items);

    let writerPromptsModalState = {
      activeStep: 1,
      activeKey: 'W1_research',
      builtins: {},
      builtinQuickChips: [],
      customQuickChips: [],
      customTemplates: {},
      preset: null,
      hasCustom: false,
    };

    function findStepGroupForKey(stageKey) {
      return WRITER_PROMPT_STEP_GROUPS.find((g) => g.items.some((it) => it.key === stageKey)) || WRITER_PROMPT_STEP_GROUPS[0];
    }

    function updateWriterPromptsBadgeUI(hasCustom, preset) {
      const btnStatus = document.getElementById('writerPromptsBtnStatus');
      const modalBadge = document.getElementById('writerModalPromptBadge');
      const btn = document.getElementById('writerPromptsModalBtn');
      const revText = preset && preset.revision ? ('r' + preset.revision) : 'r1';

      if (btnStatus) {
        btnStatus.textContent = hasCustom ? ('已自定义 (' + revText + ')') : '出厂默认';
      }
      if (btn) {
        if (hasCustom) {
          btn.classList.add('border-emerald-400/60', 'bg-emerald-600/25', 'text-emerald-200');
          btn.classList.remove('border-teal-500/40', 'bg-teal-600/20', 'text-teal-300');
        } else {
          btn.classList.remove('border-emerald-400/60', 'bg-emerald-600/25', 'text-emerald-200');
          btn.classList.add('border-teal-500/40', 'bg-teal-600/20', 'text-teal-300');
        }
      }
      if (modalBadge) {
        if (hasCustom) {
          modalBadge.textContent = '已应用当前工程预设 (' + revText + ')';
          modalBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-900/70 text-emerald-300 border border-emerald-500/50';
        } else {
          modalBadge.textContent = '出厂默认基线';
          modalBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-800 text-gray-300 border border-gray-700';
        }
      }
    }

    async function refreshWriterPromptsButtonStatus(projectId) {
      const targetId = projectId || activeProjectId;
      if (!targetId) return;
      try {
        const res = await fetch('/api/writer/prompts?project=' + encodeURIComponent(targetId));
        const data = await res.json();
        if (data && data.ok) {
          updateWriterPromptsBadgeUI(Boolean(data.has_custom_preset), data.preset || null);
          if (typeof renderRevisionQuickChipsBar === 'function') {
            renderRevisionQuickChipsBar(data.revision_quick_chips || []);
          }
        }
      } catch (e) {
        // ignore silent status fetch error
      }
    }

    async function openWriterPromptsModal(initialStageKey = null) {
      if (!activeProjectId) {
        alert('请先选择或创建一个工程！');
        return;
      }
      try {
        const res = await fetch('/api/writer/prompts?project=' + encodeURIComponent(activeProjectId));
        const data = await res.json();
        if (!data || !data.ok) {
          alert('加载提示词配置失败: ' + (data?.error || '未知错误'));
          return;
        }
        writerPromptsModalState.builtins = data.builtins || {};
        writerPromptsModalState.builtinQuickChips = Array.isArray(data.builtin_revision_quick_chips) ? data.builtin_revision_quick_chips : [];
        writerPromptsModalState.customQuickChips = Array.isArray(data.revision_quick_chips)
          ? data.revision_quick_chips.map((c) => ({ ...c }))
          : writerPromptsModalState.builtinQuickChips.map((c) => ({ ...c }));
        writerPromptsModalState.preset = data.preset || null;
        writerPromptsModalState.hasCustom = Boolean(data.has_custom_preset);
        writerPromptsModalState.customTemplates = {};

        WRITER_PROMPT_STAGE_KEYS.forEach((st) => {
          const k = st.key;
          if (k === 'revision_quick_chips') return;
          if (writerPromptsModalState.preset?.templates?.[k]?.raw_template) {
            writerPromptsModalState.customTemplates[k] = writerPromptsModalState.preset.templates[k].raw_template;
          } else if (writerPromptsModalState.builtins[k]) {
            writerPromptsModalState.customTemplates[k] = writerPromptsModalState.builtins[k].raw_template;
          }
        });

        const fallbackStep = typeof currentWriterStep === 'number' && currentWriterStep >= 1 && currentWriterStep <= 5
          ? currentWriterStep
          : 1;
        if (initialStageKey && WRITER_PROMPT_STAGE_KEYS.some((st) => st.key === initialStageKey)) {
          const grp = findStepGroupForKey(initialStageKey);
          writerPromptsModalState.activeStep = grp.step;
          writerPromptsModalState.activeKey = initialStageKey;
        } else {
          const grp = WRITER_PROMPT_STEP_GROUPS.find((g) => g.step === fallbackStep) || WRITER_PROMPT_STEP_GROUPS[0];
          writerPromptsModalState.activeStep = grp.step;
          writerPromptsModalState.activeKey = grp.items[0].key;
        }

        const projEl = document.getElementById('writerPromptsTargetProjId');
        if (projEl) projEl.textContent = activeProjectId;

        updateWriterPromptsBadgeUI(writerPromptsModalState.hasCustom, writerPromptsModalState.preset);
        renderWriterPromptTabs();
        loadWriterPromptIntoEditor(writerPromptsModalState.activeKey);

        const modal = document.getElementById('writerPromptsModal');
        if (modal) modal.classList.remove('hidden');
      } catch (err) {
        alert('加载提示词配置异常: ' + err.message);
      }
    }

    function closeWriterPromptsModal() {
      const modal = document.getElementById('writerPromptsModal');
      if (modal) modal.classList.add('hidden');
    }

    function isWriterPromptStageModified(stageKey) {
      if (stageKey === 'revision_quick_chips') {
        const cur = writerPromptsModalState.customQuickChips || [];
        const base = writerPromptsModalState.builtinQuickChips || [];
        if (cur.length !== base.length) return true;
        return cur.some((c, idx) =>
          String(c?.label || '').trim() !== String(base[idx]?.label || '').trim() ||
          String(c?.prompt || '').trim() !== String(base[idx]?.prompt || '').trim()
        );
      }
      const cur = (writerPromptsModalState.customTemplates[stageKey] || '').trim();
      const base = (writerPromptsModalState.builtins[stageKey]?.raw_template || '').trim();
      return Boolean(cur && base && cur !== base);
    }

    function renderWriterPromptTabs() {
      const stepContainer = document.getElementById('writerPromptStageTabs');
      const subContainer = document.getElementById('writerPromptSubTabs');
      if (!stepContainer) return;

      stepContainer.innerHTML = WRITER_PROMPT_STEP_GROUPS.map((grp) => {
        const isActive = grp.step === writerPromptsModalState.activeStep;
        const isModified = grp.items.some((it) => isWriterPromptStageModified(it.key));
        const cls = isActive
          ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600/30 text-teal-200 border border-teal-400 shadow whitespace-nowrap cursor-pointer flex items-center gap-1.5'
          : 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 text-gray-400 hover:text-white border border-gray-800 whitespace-nowrap cursor-pointer flex items-center gap-1.5';
        const dotHtml = isModified ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" title="本步骤下有已自定义修改的提示词"></span>' : '';
        return '<button type="button" onclick="switchWriterPromptStep(' + grp.step + ')" class="' + cls + '">' + escapeHtml(grp.label) + dotHtml + '</button>';
      }).join('');

      if (!subContainer) return;
      const activeGroup = WRITER_PROMPT_STEP_GROUPS.find((g) => g.step === writerPromptsModalState.activeStep);
      if (!activeGroup || activeGroup.items.length <= 1) {
        subContainer.classList.add('hidden');
        subContainer.innerHTML = '';
        return;
      }

      subContainer.classList.remove('hidden');
      subContainer.innerHTML = '<span class="text-[11px] text-gray-400 font-semibold mr-1">包含模块：</span>' + activeGroup.items.map((st) => {
        const isActive = st.key === writerPromptsModalState.activeKey;
        const isModified = isWriterPromptStageModified(st.key);
        const cls = isActive
          ? 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-600/35 text-purple-200 border border-purple-400 shadow cursor-pointer flex items-center gap-1.5'
          : 'px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-900 text-gray-400 hover:text-white border border-gray-800 cursor-pointer flex items-center gap-1.5';
        const dotHtml = isModified ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>' : '';
        return '<button type="button" data-stage-key="' + escapeHtml(st.key) + '" onclick="switchWriterPromptTab(this.dataset.stageKey)" class="' + cls + '">' + escapeHtml(st.label) + dotHtml + '</button>';
      }).join('');
    }

    function switchWriterPromptStep(stepNum) {
      const textarea = document.getElementById('writerPromptTextarea');
      if (textarea && writerPromptsModalState.activeKey !== 'revision_quick_chips') {
        writerPromptsModalState.customTemplates[writerPromptsModalState.activeKey] = textarea.value;
      }
      const grp = WRITER_PROMPT_STEP_GROUPS.find((g) => g.step === Number(stepNum)) || WRITER_PROMPT_STEP_GROUPS[0];
      writerPromptsModalState.activeStep = grp.step;
      if (!grp.items.some((it) => it.key === writerPromptsModalState.activeKey)) {
        writerPromptsModalState.activeKey = grp.items[0].key;
      }
      renderWriterPromptTabs();
      loadWriterPromptIntoEditor(writerPromptsModalState.activeKey);
    }

    function switchWriterPromptTab(newKey) {
      const textarea = document.getElementById('writerPromptTextarea');
      if (textarea && writerPromptsModalState.activeKey !== 'revision_quick_chips') {
        writerPromptsModalState.customTemplates[writerPromptsModalState.activeKey] = textarea.value;
      }
      const grp = findStepGroupForKey(newKey);
      writerPromptsModalState.activeStep = grp.step;
      writerPromptsModalState.activeKey = newKey;
      renderWriterPromptTabs();
      loadWriterPromptIntoEditor(newKey);
    }

    function onWriterPromptTextareaInput() {
      const textarea = document.getElementById('writerPromptTextarea');
      if (!textarea) return;
      writerPromptsModalState.customTemplates[writerPromptsModalState.activeKey] = textarea.value;
      renderWriterPromptTabs();
      updateWriterPromptEditorStatus(writerPromptsModalState.activeKey, textarea.value);
    }

    function updateWriterPromptEditorStatus(stageKey, text) {
      const statusEl = document.getElementById('writerPromptEditorStatus');
      if (!statusEl) return;
      if (stageKey === 'revision_quick_chips') {
        const invalid = (writerPromptsModalState.customQuickChips || []).some((c) => !String(c?.label || '').trim() || !String(c?.prompt || '').trim());
        if (invalid || (writerPromptsModalState.customQuickChips || []).length === 0) {
          statusEl.className = 'text-[11px] text-rose-400 shrink-0';
          statusEl.textContent = '⚠️ 请至少保留 1 条快捷指令，且名称与提示词内容均不能为空。';
          return;
        }
        statusEl.className = 'text-[11px] text-gray-400 shrink-0';
        statusEl.textContent = isWriterPromptStageModified(stageKey)
          ? '✏️ 快捷指令已修改（点击右下角「保存并应用到当前工程」后生效，仅影响当前工程）。'
          : '✅ 当前为系统出厂默认快捷指令。';
        return;
      }
      const builtin = writerPromptsModalState.builtins[stageKey];
      if (!builtin) return;
      if (!text || !text.trim()) {
        statusEl.className = 'text-[11px] text-rose-400 shrink-0';
        statusEl.textContent = '⚠️ 提示词不能为空。';
        return;
      }
      if (builtin.require_json && !/json/i.test(text)) {
        statusEl.className = 'text-[11px] text-amber-400 shrink-0';
        statusEl.textContent = '⚠️ 本阶段需要后端解析 JSON，请确保提示词中保留 JSON 输出格式要求。';
        return;
      }
      if (builtin.require_audit_marker && !text.includes('<<<AUDIT>>>')) {
        statusEl.className = 'text-[11px] text-amber-300 shrink-0';
        statusEl.textContent = '💡 提示：保留 <<<AUDIT>>> 尾部标记可自动生成润色审计对比报告。';
        return;
      }
      statusEl.className = 'text-[11px] text-gray-400 shrink-0';
      statusEl.textContent = isWriterPromptStageModified(stageKey)
        ? '✏️ 本阶段已修改（点击右下角「保存并应用到当前工程」后生效，仅影响当前工程）。'
        : '✅ 当前为系统出厂默认模板。';
    }

    function renderWriterQuickChipsEditor() {
      const listEl = document.getElementById('writerQuickChipsList');
      if (!listEl) return;
      const chips = writerPromptsModalState.customQuickChips || [];
      if (chips.length === 0) {
        listEl.innerHTML = '<div class="text-center py-6 text-gray-500 text-xs">暂无快捷指令，点击上方「➕ 新增快捷指令」添加。</div>';
        return;
      }
      listEl.innerHTML = chips.map((c, idx) => `
        <div class="p-2.5 rounded-xl bg-[#030712] border border-gray-800 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <input type="text" value="${escapeHtml(c.label)}" oninput="onWriterQuickChipChange(${idx}, 'label', this.value)" placeholder="按钮名称"
              class="flex-1 bg-gray-900 text-amber-200 font-bold text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-teal-400" />
            <button type="button" onclick="deleteWriterQuickChipRow(${idx})" class="px-2 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-[11px] shrink-0 cursor-pointer">
              ✕ 删除
            </button>
          </div>
          <textarea rows="2" oninput="onWriterQuickChipChange(${idx}, 'prompt', this.value)" placeholder="点击按钮后填入审稿意见框的完整 Prompt 提示词..."
            class="w-full bg-gray-900 text-gray-100 text-xs p-2 rounded-lg border border-gray-700 focus:outline-none focus:border-teal-400 leading-relaxed resize-y">${escapeHtml(c.prompt)}</textarea>
        </div>
      `).join('');
    }

    function onWriterQuickChipChange(idx, field, val) {
      if (!writerPromptsModalState.customQuickChips[idx]) return;
      writerPromptsModalState.customQuickChips[idx][field] = val;
      renderWriterPromptTabs();
      updateWriterPromptEditorStatus('revision_quick_chips', '');
    }

    function addWriterQuickChipRow() {
      writerPromptsModalState.customQuickChips.push({
        id: 'custom_' + Date.now(),
        label: '✨ 新快捷指令',
        prompt: '',
      });
      renderWriterQuickChipsEditor();
      renderWriterPromptTabs();
      updateWriterPromptEditorStatus('revision_quick_chips', '');
    }

    function deleteWriterQuickChipRow(idx) {
      if ((writerPromptsModalState.customQuickChips || []).length <= 1) {
        alert('至少保留 1 条快捷改稿指令！');
        return;
      }
      writerPromptsModalState.customQuickChips.splice(idx, 1);
      renderWriterQuickChipsEditor();
      renderWriterPromptTabs();
      updateWriterPromptEditorStatus('revision_quick_chips', '');
    }

    function loadWriterPromptIntoEditor(stageKey) {
      const textarea = document.getElementById('writerPromptTextarea');
      const chipsEditor = document.getElementById('writerQuickChipsEditor');
      const titleEl = document.getElementById('writerPromptEditorTitle');
      const descEl = document.getElementById('writerPromptStageDesc');

      if (stageKey === 'revision_quick_chips') {
        if (textarea) textarea.classList.add('hidden');
        if (chipsEditor) chipsEditor.classList.remove('hidden');
        if (titleEl) titleEl.textContent = '当前编辑：第 5 步 · ⚡ 快捷改稿指令（按钮对应 Prompt）';
        if (descEl) descEl.textContent = '每个按钮点击后会将对应 Prompt 自动填充至第 5 步总编审稿意见框，支持自由增删与改写。';
        renderWriterQuickChipsEditor();
        updateWriterPromptEditorStatus(stageKey, '');
        return;
      }

      if (textarea) textarea.classList.remove('hidden');
      if (chipsEditor) chipsEditor.classList.add('hidden');

      const val = writerPromptsModalState.customTemplates[stageKey] || '';
      if (textarea) textarea.value = val;

      const builtin = writerPromptsModalState.builtins[stageKey];
      const grp = findStepGroupForKey(stageKey);
      const subItem = grp.items.find((it) => it.key === stageKey);
      if (titleEl) titleEl.textContent = '当前编辑：' + grp.label + (grp.items.length > 1 && subItem ? (' · ' + subItem.label) : '');
      if (descEl) descEl.textContent = builtin?.description || '';

      updateWriterPromptEditorStatus(stageKey, val);
    }

    async function saveWriterPromptsFromModal() {
      const textarea = document.getElementById('writerPromptTextarea');
      if (textarea && writerPromptsModalState.activeKey !== 'revision_quick_chips') {
        writerPromptsModalState.customTemplates[writerPromptsModalState.activeKey] = textarea.value;
      }
      const templatesPayload = {};
      WRITER_PROMPT_STAGE_KEYS.forEach((st) => {
        const k = st.key;
        if (k === 'revision_quick_chips') return;
        templatesPayload[k] = {
          template_id: k,
          raw_template: writerPromptsModalState.customTemplates[k] || '',
          description: st.label,
        };
      });

      const btn = document.getElementById('btnSaveWriterPrompts');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/writer/prompts/save?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: '项目文案预设_' + activeProjectId,
            templates: templatesPayload,
            revision_quick_chips: writerPromptsModalState.customQuickChips || [],
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert('保存失败: ' + (data?.error || '校验未通过'));
          return;
        }
        updateWriterPromptsBadgeUI(Boolean(data.has_custom_preset), data.preset || null);
        if (typeof renderRevisionQuickChipsBar === 'function') {
          renderRevisionQuickChipsBar(data.revision_quick_chips || writerPromptsModalState.customQuickChips || []);
        }
        closeWriterPromptsModal();
        showToast(data.has_custom_preset
          ? '💾 提示词预设已保存 (r' + (data.preset?.revision || 1) + ')，仅对工程 ' + activeProjectId + ' 生效！'
          : '✅ 提示词与出厂基线一致，已保存！');
        showCompletionModal({
          icon: '⚙️',
          title: '文案提示词修改已完成',
          message: data.has_custom_preset
            ? ('提示词预设已保存 (r' + (data.preset?.revision || 1) + ')，仅对当前工程生效！')
            : '提示词与出厂基线一致，已保存！',
        });
      } catch (err) {
        alert('保存异常: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function resetWriterPromptsFromModal(onlyCurrent) {
      const curKey = writerPromptsModalState.activeKey;
      const curLabel = curKey === 'revision_quick_chips'
        ? '⚡ 快捷改稿指令'
        : (writerPromptsModalState.builtins[curKey]?.label || curKey);
      const msg = onlyCurrent
        ? '确定将【' + curLabel + '】恢复为系统出厂默认配置吗？（仅影响当前工程）'
        : '确定将当前工程全部提示词与快捷指令恢复为系统出厂基线吗？';
      if (!window.confirm(msg)) return;

      try {
        const payload = onlyCurrent ? { template_id: curKey } : {};
        const res = await fetch('/api/writer/prompts/reset?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert('重置失败: ' + (data?.error || '未知错误'));
          return;
        }
        if (onlyCurrent) {
          if (curKey === 'revision_quick_chips') {
            writerPromptsModalState.customQuickChips = (data.revision_quick_chips || writerPromptsModalState.builtinQuickChips || []).map((c) => ({ ...c }));
            if (typeof renderRevisionQuickChipsBar === 'function') {
              renderRevisionQuickChipsBar(writerPromptsModalState.customQuickChips);
            }
          } else {
            writerPromptsModalState.customTemplates[curKey] = writerPromptsModalState.builtins[curKey]?.raw_template || '';
          }
          writerPromptsModalState.preset = data.preset || null;
          writerPromptsModalState.hasCustom = Boolean(data.has_custom_preset);
          updateWriterPromptsBadgeUI(writerPromptsModalState.hasCustom, writerPromptsModalState.preset);
          renderWriterPromptTabs();
          loadWriterPromptIntoEditor(curKey);
          showToast('↺ 已将【' + curLabel + '】恢复为出厂默认模板');
        } else {
          if (typeof renderRevisionQuickChipsBar === 'function') {
            renderRevisionQuickChipsBar(data.revision_quick_chips || writerPromptsModalState.builtinQuickChips || []);
          }
          updateWriterPromptsBadgeUI(false, null);
          closeWriterPromptsModal();
          showToast('↺ 已将当前工程全部提示词与快捷指令恢复为出厂默认基线');
        }
      } catch (err) {
        alert('重置异常: ' + err.message);
      }
    }

    // =========================================================================
    // ⚙️ 视觉分镜台提示词设置
    // =========================================================================
    const PRODUCER_PROMPT_STAGES = [
      { key: 'P1_keywords', shortLabel: '1. 最佳搜索词' },
      { key: 'P2_video_prompt', shortLabel: '2. 实体视频词' },
      { key: 'P3_image_prompt', shortLabel: '3. 超清实景图' },
      { key: 'P4_card_prompt', shortLabel: '4. 动效卡片' },
      { key: 'P5_clip_compiler', shortLabel: '5. 口语剪辑编译' },
    ];

    let producerPromptsModalState = {
      activeKey: 'P1_keywords',
      builtins: {},
      preset: null,
      customTemplates: {},
      hasCustom: false,
    };

    function updateProducerPromptsBadgeUI(hasCustom, presetObj) {
      const btnStatus = document.getElementById('producerPromptsBtnStatus');
      const modalBadge = document.getElementById('producerModalPromptBadge');
      const revText = presetObj?.revision ? ('v' + presetObj.revision) : '自定义';
      if (btnStatus) {
        btnStatus.textContent = hasCustom ? ('已自定义 (' + revText + ')') : '出厂默认';
        btnStatus.className = hasCustom ? 'text-amber-300 font-extrabold' : 'text-teal-200 font-extrabold';
      }
      if (modalBadge) {
        if (hasCustom) {
          modalBadge.textContent = '已自定义 (' + revText + ')';
          modalBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
        } else {
          modalBadge.textContent = '出厂默认基线';
          modalBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-800 text-gray-300 border border-gray-700';
        }
      }
    }

    async function refreshProducerPromptsStatus() {
      try {
        const res = await fetch('/api/producer/prompts?project=' + encodeURIComponent(activeProjectId));
        const data = await res.json();
        if (data && data.ok) {
          updateProducerPromptsBadgeUI(Boolean(data.has_custom_preset), data.preset || null);
        }
      } catch (e) {}
    }

    async function openProducerPromptsModal() {
      try {
        const res = await fetch('/api/producer/prompts?project=' + encodeURIComponent(activeProjectId));
        const data = await res.json();
        if (!data || !data.ok) {
          alert('读取视觉分镜台提示词设置失败');
          return;
        }
        producerPromptsModalState.builtins = data.builtins || {};
        producerPromptsModalState.preset = data.preset || null;
        producerPromptsModalState.hasCustom = Boolean(data.has_custom_preset);
        producerPromptsModalState.customTemplates = {};
        for (const st of PRODUCER_PROMPT_STAGES) {
          const k = st.key;
          if (producerPromptsModalState.preset?.templates?.[k]?.raw_template) {
            producerPromptsModalState.customTemplates[k] = producerPromptsModalState.preset.templates[k].raw_template;
          } else if (producerPromptsModalState.builtins[k]) {
            producerPromptsModalState.customTemplates[k] = producerPromptsModalState.builtins[k].raw_template;
          }
        }

        const projEl = document.getElementById('producerPromptsTargetProjId');
        if (projEl) projEl.textContent = activeProjectId;
        updateProducerPromptsBadgeUI(producerPromptsModalState.hasCustom, producerPromptsModalState.preset);
        renderProducerPromptTabs();
        loadProducerPromptIntoEditor(producerPromptsModalState.activeKey);

        const modal = document.getElementById('producerPromptsModal');
        if (modal) modal.classList.remove('hidden');
      } catch (err) {
        alert('打开视觉分镜台提示词设置异常: ' + err.message);
      }
    }

    function closeProducerPromptsModal() {
      const modal = document.getElementById('producerPromptsModal');
      if (modal) modal.classList.add('hidden');
    }

    function isProducerStageModified(stageKey) {
      const cur = (producerPromptsModalState.customTemplates[stageKey] || '').trim();
      const base = (producerPromptsModalState.builtins[stageKey]?.raw_template || '').trim();
      return Boolean(cur && base && cur !== base);
    }

    function renderProducerPromptTabs() {
      const wrap = document.getElementById('producerPromptStageTabs');
      if (!wrap) return;
      wrap.innerHTML = PRODUCER_PROMPT_STAGES.map((st) => {
        const isActive = st.key === producerPromptsModalState.activeKey;
        const modified = isProducerStageModified(st.key);
        return `
          <button type="button" onclick="switchProducerPromptStage('${st.key}')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${isActive ? 'bg-teal-600 text-white shadow' : 'bg-gray-900 text-gray-300 hover:bg-gray-800 border border-gray-800'}">
            <span>${st.shortLabel}</span>
            ${modified ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-300" title="已自定义"></span>' : ''}
          </button>
        `;
      }).join('');
    }

    function switchProducerPromptStage(newKey) {
      const textarea = document.getElementById('producerPromptTextarea');
      if (textarea && producerPromptsModalState.activeKey) {
        producerPromptsModalState.customTemplates[producerPromptsModalState.activeKey] = textarea.value;
      }
      producerPromptsModalState.activeKey = newKey;
      renderProducerPromptTabs();
      loadProducerPromptIntoEditor(newKey);
    }

    function onProducerPromptTextareaInput() {
      const textarea = document.getElementById('producerPromptTextarea');
      if (textarea && producerPromptsModalState.activeKey) {
        producerPromptsModalState.customTemplates[producerPromptsModalState.activeKey] = textarea.value;
        renderProducerPromptTabs();
      }
    }

    function loadProducerPromptIntoEditor(stageKey) {
      const spec = producerPromptsModalState.builtins[stageKey];
      const titleEl = document.getElementById('producerPromptEditorTitle');
      const descEl = document.getElementById('producerPromptStageDesc');
      const textarea = document.getElementById('producerPromptTextarea');
      if (!spec) return;

      if (titleEl) titleEl.textContent = '当前编辑：' + (spec.full_label || spec.label);
      if (descEl) descEl.textContent = spec.description || '';
      if (textarea) textarea.value = producerPromptsModalState.customTemplates[stageKey] ?? spec.raw_template ?? '';
    }

    async function saveProducerPromptsFromModal() {
      const textarea = document.getElementById('producerPromptTextarea');
      if (textarea && producerPromptsModalState.activeKey) {
        producerPromptsModalState.customTemplates[producerPromptsModalState.activeKey] = textarea.value;
      }
      const btn = document.getElementById('btnSaveProducerPrompts');
      const statusEl = document.getElementById('producerPromptEditorStatus');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在保存...';
      }
      try {
        const templatesPayload = {};
        for (const st of PRODUCER_PROMPT_STAGES) {
          const k = st.key;
          templatesPayload[k] = {
            template_id: k,
            template_version: producerPromptsModalState.builtins[k]?.template_version || '1.0.0',
            raw_template: producerPromptsModalState.customTemplates[k] ?? producerPromptsModalState.builtins[k]?.raw_template ?? '',
          };
        }
        const res = await fetch('/api/producer/prompts/save?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templates: templatesPayload }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (statusEl) statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ 保存失败：' + escapeHtml(data?.error || '未知错误') + '</span>';
          return;
        }
        producerPromptsModalState.preset = data.preset || null;
        producerPromptsModalState.hasCustom = Boolean(data.has_custom_preset);
        updateProducerPromptsBadgeUI(producerPromptsModalState.hasCustom, producerPromptsModalState.preset);
        closeProducerPromptsModal();
        showToast('💾 视觉分镜台提示词已保存（仅对当前工程生效）');
        showCompletionModal({
          icon: '⚙️',
          title: '视觉提示词修改已完成',
          message: '视觉分镜台提示词修改已保存（仅对当前工程生效）！',
        });
      } catch (err) {
        if (statusEl) statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ 保存异常：' + escapeHtml(err.message) + '</span>';
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '💾 保存并应用到当前工程';
        }
      }
    }

    async function resetProducerPromptsFromModal(onlyCurrent) {
      const curKey = producerPromptsModalState.activeKey;
      const curLabel = producerPromptsModalState.builtins[curKey]?.label || curKey;
      const msg = onlyCurrent
        ? ('确定将【' + curLabel + '】重置为出厂默认模板吗？')
        : '确定将当前工程全部视觉分镜台提示词恢复为出厂默认基线吗？';
      if (!confirm(msg)) return;

      try {
        const payload = onlyCurrent ? { template_id: curKey } : {};
        const res = await fetch('/api/producer/prompts/reset?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert('重置失败: ' + (data?.error || '未知错误'));
          return;
        }
        if (onlyCurrent) {
          producerPromptsModalState.customTemplates[curKey] = producerPromptsModalState.builtins[curKey]?.raw_template || '';
          producerPromptsModalState.preset = data.preset || null;
          producerPromptsModalState.hasCustom = Boolean(data.has_custom_preset);
          updateProducerPromptsBadgeUI(producerPromptsModalState.hasCustom, producerPromptsModalState.preset);
          renderProducerPromptTabs();
          loadProducerPromptIntoEditor(curKey);
          showToast('↺ 已将【' + curLabel + '】恢复为出厂默认模板');
        } else {
          updateProducerPromptsBadgeUI(false, null);
          closeProducerPromptsModal();
          showToast('↺ 已将当前工程全部视觉分镜台提示词恢复为出厂默认基线');
        }
      } catch (err) {
        alert('重置异常: ' + err.message);
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const wpModal = document.getElementById('writerPromptsModal');
        if (wpModal && !wpModal.classList.contains('hidden')) {
          closeWriterPromptsModal();
        }
        const ppModal = document.getElementById('producerPromptsModal');
        if (ppModal && !ppModal.classList.contains('hidden')) {
          closeProducerPromptsModal();
        }
      }
    });

    loadProjects().then(() => {
      restoreSavedAudioConfig();
      loadWorkflow();
      refreshProducerPromptsStatus();
      updateRenderStatus();
      updateVoiceboxStatus();
      if (currentWorkspaceTab === 'writer') {
        switchWorkspaceTab('writer');
      }
    });
    setInterval(updateRenderStatus, 5000);
    setInterval(updateVoiceboxStatus, 5000);
