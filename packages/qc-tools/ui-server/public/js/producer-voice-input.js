// producer-voice-input.js — shared classic-script scope; loaded before studio initialization.
window._voiceInputState = window._voiceInputState || {
      phase: 'idle',
      activeIdx: null,
      engine: null,
      starting: false,
      mediaRecorder: null,
      mediaStream: null,
      chunks: [],
      startedAt: 0,
      timerId: null,
      maxStopTimerId: null,
      recognition: null,
      baseValue: '',
      latestTranscript: '',
      cancelled: false,
      finishPromise: null,
      resolveFinish: null,
    };

    if (!window._voiceGlobalListenersBound) {
      window._voiceGlobalListenersBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && window._voiceInputState?.phase === 'recording') {
          cancelActiveVoiceInput(true);
        }
      });
      window.addEventListener('beforeunload', () => {
        if (typeof cancelActiveVoiceInput === 'function') {
          cancelActiveVoiceInput(false);
        }
      });
    }

    async function fetchVoiceSttCapabilities() {
      if (window._voiceSttCaps) return window._voiceSttCaps;
      try {
        const res = await fetch('/api/voice-input/status');
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.localWhisperAvailable === 'boolean') {
            window._voiceSttCaps = data;
            return data;
          }
        }
      } catch (e) {}
      return { localWhisperAvailable: false };
    }

    function formatVoiceElapsed(ms) {
      const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return m + ':' + String(s).padStart(2, '0');
    }

    function joinVoiceText(baseText, spokenText) {
      const base = String(baseText || '');
      const spoken = String(spokenText || '').trim();
      if (!spoken) return base;
      const trimmedBase = base.trimEnd();
      if (!trimmedBase) return spoken;
      if (/[\s，,。；;、：:！!？?]$/.test(trimmedBase)) {
        return trimmedBase + spoken;
      }
      return trimmedBase + '，' + spoken;
    }

    function setVoiceRowUi(idx, mode, btnLabel = '', statusText = '') {
      if (idx === null || idx === undefined) return;
      const btn = document.getElementById('aiVoiceBtn_' + idx);
      const statusWrap = document.getElementById('aiVoiceStatus_' + idx);
      const statusEl = document.getElementById('aiVoiceStatusText_' + idx);

      if (btn) {
        if (mode === 'recording') {
          btn.disabled = false;
          btn.setAttribute('aria-pressed', 'true');
          btn.textContent = btnLabel || '⏹️ 0:00';
          btn.title = '点击结束录音并转为文字（按 Esc 取消）';
          btn.className = 'px-2 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1 voice-recording-pulse';
        } else if (mode === 'transcribing') {
          btn.disabled = true;
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = btnLabel || '⏳ 识别中';
          btn.title = '正在将录音转换为文字...';
          btn.className = 'px-2 py-1.5 rounded-lg bg-amber-600/80 border border-amber-400/70 text-white font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-wait transition flex items-center gap-1 opacity-90';
        } else {
          btn.disabled = false;
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = '🎤 语音';
          btn.title = '点击开始语音输入口语指令（再次点击结束并转文字）';
          btn.className = 'px-2 py-1.5 rounded-lg bg-gray-900 hover:bg-rose-600/25 border border-sky-500/50 hover:border-rose-400/70 text-sky-200 hover:text-rose-100 font-bold text-[10px] whitespace-nowrap shrink-0 shadow cursor-pointer transition flex items-center gap-1';
        }
      }

      if (statusWrap && statusEl) {
        if (mode === 'recording') {
          statusWrap.className = 'flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[10px] text-rose-200';
          statusEl.textContent = statusText || '🔴 正在录音... 说完后点红色按钮结束（Esc 取消）';
        } else if (mode === 'transcribing') {
          statusWrap.className = 'flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-amber-950/60 border border-amber-500/40 text-[10px] text-amber-200';
          statusEl.textContent = statusText || '⏳ 正在将语音转为文字...';
        } else {
          statusWrap.classList.add('hidden');
          statusEl.textContent = '';
        }
      }
    }

    function resetVoiceStateToIdle(idxToReset = null) {
      const st = window._voiceInputState;
      const targetIdx = idxToReset !== null ? idxToReset : st.activeIdx;
      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);
      if (st.mediaStream) {
        st.mediaStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }
      const resolver = st.resolveFinish;
      st.phase = 'idle';
      st.activeIdx = null;
      st.engine = null;
      st.mediaRecorder = null;
      st.mediaStream = null;
      st.chunks = [];
      st.startedAt = 0;
      st.timerId = null;
      st.maxStopTimerId = null;
      st.recognition = null;
      st.baseValue = '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = null;
      st.resolveFinish = null;
      if (targetIdx !== null && targetIdx !== undefined) {
        setVoiceRowUi(targetIdx, 'idle');
      }
      if (typeof resolver === 'function') {
        resolver();
      }
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取录音数据失败'));
        reader.readAsDataURL(blob);
      });
    }

    function insertVoiceTranscriptIntoInput(idx, transcript) {
      const cleanText = String(transcript || '').trim();
      if (!cleanText) return;
      const input = document.getElementById('aiIntentInput_' + idx);
      if (!input) return;
      const nextVal = joinVoiceText(input.value, cleanText);
      input.value = nextVal;
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(nextVal.length, nextVal.length);
      }
      input.classList.add('ring-2', 'ring-emerald-400');
      setTimeout(() => input.classList.remove('ring-2', 'ring-emerald-400'), 900);
      const preview = cleanText.length > 24 ? cleanText.slice(0, 24) + '...' : cleanText;
      showToast('🎙️ 已填入语音指令：「' + preview + '」（按回车或点「✨ 编译」）');
    }

    function cancelActiveVoiceInput(showNotice = false) {
      const st = window._voiceInputState;
      if (!st) return;
      const prevIdx = st.activeIdx;
      const prevEngine = st.engine;
      const prevBaseVal = st.baseValue;
      const prevRecorder = st.mediaRecorder;
      const prevStream = st.mediaStream;
      const prevRecognition = st.recognition;

      if (st.phase === 'idle' && !prevStream && !prevRecorder && !prevRecognition) {
        if (st.starting) {
          st.cancelled = true;
        }
        return;
      }

      st.cancelled = true;
      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);

      if (prevStream) {
        prevStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }
      if (prevRecorder && prevRecorder.state !== 'inactive') {
        try { prevRecorder.stop(); } catch (e) {}
      }
      if (prevRecognition) {
        try { prevRecognition.abort(); } catch (e) {}
      }
      if (prevEngine === 'web_speech' && prevIdx !== null && prevIdx !== undefined) {
        const input = document.getElementById('aiIntentInput_' + prevIdx);
        if (input) input.value = prevBaseVal;
      }

      resetVoiceStateToIdle(prevIdx);
      if (showNotice) {
        showToast('已取消语音输入');
      }
    }

    function stopAndFinishVoiceInput() {
      const st = window._voiceInputState;
      if (!st) return Promise.resolve();
      if (st.phase === 'transcribing') {
        return st.finishPromise || Promise.resolve();
      }
      if (st.phase !== 'recording') {
        return Promise.resolve();
      }

      clearInterval(st.timerId);
      clearTimeout(st.maxStopTimerId);
      st.timerId = null;
      st.maxStopTimerId = null;

      const waitPromise = st.finishPromise || Promise.resolve();
      if (st.engine === 'local_whisper' && st.mediaRecorder && st.mediaRecorder.state !== 'inactive') {
        try {
          st.mediaRecorder.stop();
        } catch (e) {
          cancelActiveVoiceInput(false);
          return Promise.resolve();
        }
      } else if (st.engine === 'web_speech' && st.recognition) {
        try {
          st.recognition.stop();
        } catch (e) {
          cancelActiveVoiceInput(false);
          return Promise.resolve();
        }
      } else {
        cancelActiveVoiceInput(false);
        return Promise.resolve();
      }
      return waitPromise;
    }

    function pickSupportedAudioMimeType() {
      if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
      }
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      for (const mime of candidates) {
        try {
          if (MediaRecorder.isTypeSupported(mime)) return mime;
        } catch (e) {}
      }
      return '';
    }

    async function startLocalWhisperVoiceInput(idx) {
      const st = window._voiceInputState;
      st.cancelled = false;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const errName = err?.name || '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          showToast('❌ 未获得麦克风权限，请在浏览器地址栏允许访问麦克风');
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          showToast('❌ 未检测到麦克风设备');
        } else {
          showToast('❌ 无法开启麦克风：' + (err?.message || '未知错误'));
        }
        return;
      }

      if (st.cancelled || !document.getElementById('aiVoiceBtn_' + idx)) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
        return;
      }

      const chosenMime = pickSupportedAudioMimeType();
      let recorder;
      try {
        recorder = chosenMime
          ? new MediaRecorder(stream, { mimeType: chosenMime })
          : new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
        showToast('❌ 浏览器不支持录音编码：' + (err?.message || '初始化失败'));
        return;
      }

      const input = document.getElementById('aiIntentInput_' + idx);
      let resolveFinishFn;
      const finishPromise = new Promise((resolve) => {
        resolveFinishFn = resolve;
      });

      st.phase = 'recording';
      st.activeIdx = idx;
      st.engine = 'local_whisper';
      st.mediaRecorder = recorder;
      st.mediaStream = stream;
      st.chunks = [];
      st.startedAt = Date.now();
      st.baseValue = input ? input.value : '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = finishPromise;
      st.resolveFinish = resolveFinishFn;

      setVoiceRowUi(
        idx,
        'recording',
        '⏹️ 0:00',
        '🔴 正在录音 (0:00)... 说完后点红色按钮结束（Esc 取消）'
      );

      st.timerId = setInterval(() => {
        if (st.phase !== 'recording' || st.activeIdx !== idx) return;
        const elapsed = formatVoiceElapsed(Date.now() - st.startedAt);
        setVoiceRowUi(
          idx,
          'recording',
          '⏹️ ' + elapsed,
          '🔴 正在录音 (' + elapsed + ')... 说完后点红色按钮结束（Esc 取消）'
        );
      }, 1000);

      st.maxStopTimerId = setTimeout(() => {
        if (st.phase === 'recording' && st.activeIdx === idx) {
          showToast('⏱️ 单次录音已达 60 秒上限，正在自动识别...');
          stopAndFinishVoiceInput();
        }
      }, 60000);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          st.chunks.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        clearInterval(st.timerId);
        clearTimeout(st.maxStopTimerId);
        st.timerId = null;
        st.maxStopTimerId = null;

        if (st.mediaStream) {
          st.mediaStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
          st.mediaStream = null;
        }

        const wasCancelled = st.cancelled;
        const elapsedMs = Date.now() - st.startedAt;
        const chunksCopy = st.chunks.slice();
        const mimeType = recorder.mimeType || chosenMime || 'audio/webm';
        st.mediaRecorder = null;
        st.chunks = [];

        if (wasCancelled) {
          resetVoiceStateToIdle(idx);
          return;
        }

        if (elapsedMs < 350 || chunksCopy.length === 0) {
          resetVoiceStateToIdle(idx);
          showToast('录音时间过短，请再试一次');
          return;
        }

        const blob = new Blob(chunksCopy, { type: mimeType });
        if (!blob || blob.size === 0) {
          resetVoiceStateToIdle(idx);
          showToast('未录到有效声音，请重试');
          return;
        }

        st.phase = 'transcribing';
        setVoiceRowUi(idx, 'transcribing', '⏳ 识别中', '⏳ 正在将语音转为文字...');

        try {
          const dataUrl = await blobToDataUrl(blob);
          if (st.cancelled) {
            resetVoiceStateToIdle(idx);
            return;
          }

          const res = await fetch('/api/transcribe-voice?project=' + encodeURIComponent(activeProjectId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              mimeType: blob.type || mimeType,
              language: 'zh',
            }),
          });
          const data = await res.json();
          if (st.cancelled) {
            resetVoiceStateToIdle(idx);
            return;
          }
          if (!res.ok || !data.ok) {
            throw new Error(data.error || '语音识别失败');
          }

          const transcript = String(data.text || '').trim();
          resetVoiceStateToIdle(idx);
          if (data.silent || !transcript) {
            showToast('未检测到清晰语音，请靠近麦克风重试');
          } else {
            insertVoiceTranscriptIntoInput(idx, transcript);
          }
        } catch (err) {
          const wasCanceledDuringFetch = st.cancelled;
          resetVoiceStateToIdle(idx);
          if (!wasCanceledDuringFetch) {
            showToast('❌ 语音识别失败：' + (err?.message || '请稍后重试'));
          }
        }
      };

      try {
        recorder.start(250);
      } catch (err) {
        resetVoiceStateToIdle(idx);
        showToast('❌ 启动录音失败：' + (err?.message || '未知错误'));
      }
    }

    function startWebSpeechVoiceInput(idx) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) return false;

      const st = window._voiceInputState;
      const input = document.getElementById('aiIntentInput_' + idx);
      const recognition = new SpeechRec();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;

      let resolveFinishFn;
      const finishPromise = new Promise((resolve) => {
        resolveFinishFn = resolve;
      });

      st.phase = 'recording';
      st.activeIdx = idx;
      st.engine = 'web_speech';
      st.recognition = recognition;
      st.startedAt = Date.now();
      st.baseValue = input ? input.value : '';
      st.latestTranscript = '';
      st.cancelled = false;
      st.finishPromise = finishPromise;
      st.resolveFinish = resolveFinishFn;

      setVoiceRowUi(
        idx,
        'recording',
        '⏹️ 0:00',
        '🔴 正在实时听写 (0:00)... 说完后点红色按钮结束（Esc 取消）'
      );

      st.timerId = setInterval(() => {
        if (st.phase !== 'recording' || st.activeIdx !== idx) return;
        const elapsed = formatVoiceElapsed(Date.now() - st.startedAt);
        setVoiceRowUi(
          idx,
          'recording',
          '⏹️ ' + elapsed,
          '🔴 正在实时听写 (' + elapsed + ')... 说完后点红色按钮结束（Esc 取消）'
        );
      }, 1000);

      st.maxStopTimerId = setTimeout(() => {
        if (st.phase === 'recording' && st.activeIdx === idx) {
          stopAndFinishVoiceInput();
        }
      }, 60000);

      let hadFatalError = false;
      recognition.onresult = (event) => {
        if (st.cancelled) return;
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const resItem = event.results[i];
          const textPart = resItem[0]?.transcript || '';
          if (resItem.isFinal) {
            finalText += textPart;
          } else {
            interimText += textPart;
          }
        }
        st.latestTranscript = (finalText + interimText).trim();
        const curInput = document.getElementById('aiIntentInput_' + idx);
        if (curInput) {
          curInput.value = joinVoiceText(st.baseValue, st.latestTranscript);
        }
      };

      recognition.onerror = (event) => {
        const code = event?.error || '';
        if (code === 'aborted' && st.cancelled) return;
        hadFatalError = true;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          showToast('❌ 未获得麦克风权限，请在浏览器地址栏允许访问麦克风');
        } else if (code === 'audio-capture') {
          showToast('❌ 未检测到可用麦克风设备');
        } else if (code === 'no-speech') {
          showToast('未检测到语音，请靠近麦克风重试');
        } else if (code === 'network') {
          showToast('❌ 浏览器语音识别网络异常，请检查网络或确认本机 Whisper 可用');
        } else {
          showToast('❌ 语音识别出错：' + (code || '未知错误'));
        }
      };

      recognition.onend = () => {
        const wasCancelled = st.cancelled;
        const spoken = String(st.latestTranscript || '').trim();
        const curInput = document.getElementById('aiIntentInput_' + idx);
        if (wasCancelled) {
          if (curInput) curInput.value = st.baseValue;
          resetVoiceStateToIdle(idx);
          return;
        }
        if (curInput && spoken) {
          const finalVal = joinVoiceText(st.baseValue, spoken);
          curInput.value = finalVal;
          curInput.focus();
          if (typeof curInput.setSelectionRange === 'function') {
            curInput.setSelectionRange(finalVal.length, finalVal.length);
          }
          curInput.classList.add('ring-2', 'ring-emerald-400');
          setTimeout(() => curInput.classList.remove('ring-2', 'ring-emerald-400'), 900);
          const preview = spoken.length > 24 ? spoken.slice(0, 24) + '...' : spoken;
          showToast('🎙️ 已填入语音指令：「' + preview + '」（按回车或点「✨ 编译」）');
        } else if (!hadFatalError) {
          showToast('未检测到清晰语音，请靠近麦克风重试');
        }
        resetVoiceStateToIdle(idx);
      };

      try {
        recognition.start();
        return true;
      } catch (err) {
        resetVoiceStateToIdle(idx);
        showToast('❌ 启动浏览器语音识别失败：' + (err?.message || '未知错误'));
        return false;
      }
    }

    async function toggleVoiceInputForRow(idx) {
      const st = window._voiceInputState;
      if (st.starting) return;
      if (st.phase === 'transcribing') {
        showToast('⏳ 语音识别进行中，请稍候...');
        return;
      }
      if (st.phase === 'recording') {
        if (st.activeIdx === idx) {
          await stopAndFinishVoiceInput();
          return;
        }
        cancelActiveVoiceInput(false);
      }

      st.starting = true;
      try {
        const caps = await fetchVoiceSttCapabilities();
        const canLocalWhisper = Boolean(
          caps?.localWhisperAvailable &&
          navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === 'function' &&
          typeof MediaRecorder !== 'undefined'
        );

        if (canLocalWhisper) {
          await startLocalWhisperVoiceInput(idx);
          return;
        }

        if (window.SpeechRecognition || window.webkitSpeechRecognition) {
          startWebSpeechVoiceInput(idx);
          return;
        }

        showToast(
          !window.isSecureContext
            ? '⚠️ 当前页面非安全上下文，请通过 http://localhost:4000 打开工作台后再使用语音输入'
            : '⚠️ 当前浏览器不支持麦克风录音或语音识别，请使用最新版 Chrome / Edge / Safari'
        );
      } finally {
        st.starting = false;
      }
    }
