// producer-art-text.js — shared classic-script scope; loaded before studio initialization.
let artTextDraft = [];
    let artDraftProject = null;
    function openArtTextPanel() {
      document.getElementById('artTextPanel').classList.toggle('hidden');
      if (artDraftProject && artDraftProject !== activeProjectId) { artTextDraft = []; renderArtTextDraft(); }
    }
    function artEsc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function artOptions(values, selected) { return values.map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join(''); }
    function renderArtTextDraft() {
      const el = document.getElementById('artTextItems');
      el.innerHTML = artTextDraft.map((item, i) => `<div class="rounded-lg bg-surface border border-line p-3 space-y-2 text-xs">
        <div class="flex items-center gap-2"><input type="checkbox" data-art="enabled" data-i="${i}" ${item.enabled ? 'checked' : ''}><strong class="text-accent">${artEsc(item.scene_id)}</strong><span class="text-ink-muted">对应旁白：${artEsc(item.anchor)}</span></div>
        <div class="flex flex-wrap gap-2 items-center"><label>文字 <input data-art="text" data-i="${i}" maxlength="40" value="${artEsc(item.text)}" class="bg-input border border-line-strong rounded p-1 text-ink"></label>
        <label>镜头内第 <input type="number" min="0" step="0.1" data-art="start_sec" data-i="${i}" value="${item.start_sec}" class="w-16 bg-input border border-line-strong rounded p-1"> 秒</label>
        <label>持续 <input type="number" min="0.1" step="0.1" data-art="duration_sec" data-i="${i}" value="${item.duration_sec}" class="w-16 bg-input border border-line-strong rounded p-1"> 秒</label>
        <label>字号 <input type="number" min="28" max="130" data-design="font_size" data-i="${i}" value="${item.design.font_size}" class="w-16 bg-input border border-line-strong rounded p-1"></label>
        <label>文字颜色 <input type="color" data-design="text_color" data-i="${i}" value="${artEsc(item.design.text_color)}"></label>
        <label>横向 % <input type="number" min="8" max="92" data-design="x" data-i="${i}" value="${item.design.x}" class="w-16 bg-input border border-line-strong rounded p-1"></label>
        <label>纵向 % <input type="number" min="10" max="78" data-design="y" data-i="${i}" value="${item.design.y}" class="w-16 bg-input border border-line-strong rounded p-1"></label></div>
        <p class="text-ink-muted">AI 设计：${artEsc(item.reason || '根据旁白设计动态文字')}</p>
        <details><summary class="cursor-pointer text-accent">查看和修改完整设计与动画关键帧</summary><textarea data-art="designJson" data-i="${i}" rows="8" class="w-full mt-2 p-2 bg-input border border-line-strong rounded text-ink font-mono">${artEsc(JSON.stringify(item.design, null, 2))}</textarea></details></div>`).join('');
      document.getElementById('artApplyBtn').classList.toggle('hidden', !artTextDraft.length);
    }
    document.getElementById('artTextItems').addEventListener('input', event => {
      const input = event.target, item = artTextDraft[Number(input.dataset.i)];
      if (!item) return;
      if (input.dataset.design) { item.design[input.dataset.design] = input.type === 'number' ? Number(input.value) : input.value; const editor = document.querySelector(`textarea[data-art="designJson"][data-i="${input.dataset.i}"]`); if (editor) editor.value = JSON.stringify(item.design, null, 2); delete item.designJson; return; }
      if (input.dataset.art === 'designJson') { item.designJson = input.value; return; }
      if (!input.dataset.art) return;
      item[input.dataset.art] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    });
    async function generateArtText() {
      if (!activeProjectId) return;
      const btn = document.getElementById('artGenerateBtn'), status = document.getElementById('artTextStatus');
      const project = activeProjectId; btn.disabled = true; status.textContent = 'AI 正在阅读全文，并分段设计各章节的重点艺术字；长视频可能需要几分钟…';
      try {
        const response = await fetch('/api/producer/art-text/generate?project=' + encodeURIComponent(project), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({creative_request: document.getElementById('artCreativeRequest').value})});
        const data = await response.json(); if (!response.ok) throw new Error(data.error || '生成失败');
        if (project !== activeProjectId) throw new Error('工程已切换，请在当前工程重新生成');
        artDraftProject = project;
        artTextDraft = data.items.map(item => ({...item, enabled: !(manifestData?.scenes || []).find(scene => scene.scene_id === item.scene_id)?.media_modifiers?.text_overlays?.length}));
        renderArtTextDraft(); status.textContent = artTextDraft.length ? `已生成 ${artTextDraft.length} 条提案${data.stats && data.stats.returned > artTextDraft.length ? `（另有 ${data.stats.returned - artTextDraft.length} 条未通过检查）` : ""}。已有艺术字的镜头默认不勾选；时间是镜头内的秒数。` : 'AI 本次没有生成提案，请调整创意要求后重试。';
      } catch (err) { status.textContent = '生成失败：' + err.message; } finally { btn.disabled = false; }
    }
    async function applyArtText() {
      const status = document.getElementById('artTextStatus'), btn = document.getElementById('artApplyBtn');
      if (artDraftProject !== activeProjectId) { status.textContent = '工程已切换，请重新生成。'; return; }
      const items = artTextDraft.filter(item => item.enabled);
      try { for (const item of items) if (item.designJson !== undefined) item.design = JSON.parse(item.designJson); } catch { status.textContent = '设计参数不是有效 JSON，请检查关键帧。'; return; }
      if (!items.length) { status.textContent = '请至少勾选一条。'; return; }
      btn.disabled = true;
      try {
        const response = await fetch('/api/producer/art-text/apply?project=' + encodeURIComponent(activeProjectId), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items})});
        const data = await response.json(); if (!response.ok) throw new Error(data.error || '应用失败');
        artTextDraft = []; renderArtTextDraft(); status.textContent = `已应用 ${data.count} 条艺术字。请在 Remotion 刷新页面查看；原有艺术字已保留。`;
        await loadWorkflow();
      } catch (err) { status.textContent = '应用失败：' + err.message; } finally { btn.disabled = false; }
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.getElementById('artTextPanel').classList.contains('hidden')) openArtTextPanel();
    });
