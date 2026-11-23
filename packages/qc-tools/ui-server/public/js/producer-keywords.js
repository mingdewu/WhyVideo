// producer-keywords.js — shared classic-script scope; loaded before studio initialization.
const GITHUB_COPY_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
    const GITHUB_CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

    function buildStep0BestKeywordHtml(idx, bestKw) {
      const kw = String(bestKw || '').trim();
      if (!kw) {
        return `
          <div class="flex items-center justify-between gap-1 text-[9px] text-cyan-300 font-bold">
            <span>🔎 Step 0 · 最佳搜索词</span>
            <button type="button" id="kwGenBtn_${idx}" onclick="extractSearchKeywordsForRow(${idx})"
              class="px-2 py-0.5 rounded bg-cyan-900/70 hover:bg-cyan-700 text-cyan-100 border border-cyan-500/40 font-bold text-[9px] cursor-pointer transition shrink-0">
              ✨ AI 提炼
            </button>
          </div>
        `;
      }
      const safeKw = escapeHtml(kw);
      const encodedKw = encodeURIComponent(kw);
      return `
        <div class="flex items-center gap-1 text-[10px]">
          <span class="text-[9px] text-cyan-300 font-bold shrink-0" title="Step 0 · AI 唯一最佳搜索词">🔎</span>
          <div class="flex-1 min-w-0 flex items-center justify-between rounded-md border border-cyan-500/50 bg-cyan-950/40 overflow-hidden">
            <span class="px-2 py-0.5 text-cyan-100 font-bold truncate" title="${safeKw}">${safeKw}</span>
            <button type="button" onclick="copySearchKeyword(event, decodeURIComponent('${encodedKw}'), this)" title="复制最佳搜索词「${safeKw}」"
              class="px-1.5 py-1 border-l border-cyan-500/40 text-cyan-200 hover:text-white hover:bg-cyan-500/30 cursor-pointer flex items-center justify-center shrink-0 transition">
              ${GITHUB_COPY_SVG}
            </button>
          </div>
          <button type="button" id="kwGenBtn_${idx}" onclick="extractSearchKeywordsForRow(${idx}, { forceChange: true })" title="换一个不同的画面搜索词"
            class="px-1.5 py-0.5 rounded bg-gray-900 hover:bg-cyan-900/60 text-gray-300 hover:text-cyan-200 border border-gray-700 hover:border-cyan-500/40 font-bold text-[9px] cursor-pointer transition shrink-0">
            🔄 换一个
          </button>
        </div>
      `;
    }

    async function copySearchKeyword(e, kw, btnEl) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const text = String(kw || '').trim();
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if (btnEl) {
          btnEl.innerHTML = GITHUB_CHECK_SVG;
          btnEl.classList.add('text-emerald-400');
          setTimeout(() => {
            btnEl.innerHTML = GITHUB_COPY_SVG;
            btnEl.classList.remove('text-emerald-400');
          }, 1500);
        }
        showToast('📋 已复制搜索词：' + text);
      } catch (err) {
        showToast('⚠️ 复制失败，请手动选中复制');
      }
    }

    async function extractSearchKeywordsForRow(idx, { silent = false, forceChange = false } = {}) {
      const scene = manifestData?.scenes?.[idx];
      if (!scene) return false;
      const btn = document.getElementById('kwGenBtn_' + idx);
      const prevKw = scene.selected_search_keyword || (scene.search_keyword_candidates && scene.search_keyword_candidates[0]) || '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳...';
      }
      try {
        const keywordModel = (document.getElementById('currentKeywordModelInput')?.value || visualConfig.keywordModel || visualConfig.textModel || '').trim();
        const res = await fetch('/api/extract-search-keywords?project=' + encodeURIComponent(activeProjectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            narrationText: scene.narration_text || '',
            chapterRef: scene.chapter_ref || '',
            keywordModel,
            excludeKeyword: forceChange ? prevKw : '',
            persist: true,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          if (!silent) showToast('❌ 搜索词提炼失败：' + (data.error || '未知错误'));
          if (btn) {
            btn.disabled = false;
            btn.textContent = prevKw ? '🔄 换一个' : '✨ AI 提炼';
          }
          return false;
        }
        const bestKw = data.keyword || (data.keywords && data.keywords[0]) || '';
        scene.selected_search_keyword = bestKw;
        scene.search_keyword_candidates = bestKw ? [bestKw] : [];
        const wrap = document.getElementById('step0KwWrap_' + idx);
        if (wrap) {
          wrap.innerHTML = buildStep0BestKeywordHtml(idx, bestKw);
        }
        if (!silent) showToast('✅ 最佳搜索词：' + bestKw);
        return true;
      } catch (err) {
        if (!silent) showToast('❌ 搜索词提炼请求出错：' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevKw ? '🔄 换一个' : '✨ AI 提炼';
        }
        return false;
      }
    }

    let _batchKeywordRunning = false;
    let _batchKeywordAbort = false;

    async function batchExtractAllSearchKeywords() {
      const btn = document.getElementById('btnBatchExtractKeywords');
      if (_batchKeywordRunning) {
        _batchKeywordAbort = true;
        if (btn) btn.textContent = '⏳ 正在停止...';
        return;
      }
      const scenes = manifestData?.scenes || [];
      if (scenes.length === 0) {
        showToast('当前工程没有镜头');
        return;
      }
      let targetIndices = scenes
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !Array.isArray(s.search_keyword_candidates) || s.search_keyword_candidates.length === 0)
        .map(({ i }) => i);

      if (targetIndices.length === 0) {
        if (!confirm('全部 ' + scenes.length + ' 个镜头已有关键词，是否全部重新提炼？')) return;
        targetIndices = scenes.map((_, i) => i);
      }

      _batchKeywordRunning = true;
      _batchKeywordAbort = false;
      let done = 0;
      let okCount = 0;
      const total = targetIndices.length;
      const updateBtn = () => {
        if (btn) btn.textContent = '⏹️ 停止提炼 (' + done + '/' + total + ')';
      };
      updateBtn();

      const concurrency = 3;
      let cursor = 0;
      const worker = async () => {
        while (cursor < targetIndices.length && !_batchKeywordAbort) {
          const idx = targetIndices[cursor++];
          const ok = await extractSearchKeywordsForRow(idx, { silent: true });
          done++;
          if (ok) okCount++;
          updateBtn();
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, targetIndices.length) }, () => worker()));

      const wasAborted = _batchKeywordAbort;
      _batchKeywordRunning = false;
      _batchKeywordAbort = false;
      if (btn) btn.textContent = '✨ 批量提炼全部镜头关键词';
      showToast(wasAborted ? ('⏹️ 已停止，完成 ' + okCount + '/' + done + ' 个镜头') : ('🎉 批量提炼完成：成功 ' + okCount + '/' + total + ' 个镜头'));
      if (!wasAborted) {
        showCompletionModal({
          icon: '🔎',
          title: '批量提炼镜头关键词已完成',
          message: '成功提炼 ' + okCount + '/' + total + ' 个镜头的最佳搜索词。',
          detail: okCount < total
            ? ('有 ' + (total - okCount) + ' 个镜头失败，可在对应镜头行点击「✨ AI 提炼」重试。')
            : '全部镜头均已就绪，可直接复制搜索词检索素材。',
        });
      }
    }
