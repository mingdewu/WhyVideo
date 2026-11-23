// writer-import.js — shared classic-script scope; loaded before studio initialization.
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
