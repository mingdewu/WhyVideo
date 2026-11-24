// writer-views.js — shared classic-script scope; loaded before studio initialization.
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
        resetFinalScriptSaveState();
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
      resetFinalScriptSaveState();

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
