let publishRequest = 0;
let publishCaptionRequest = 0;
let publishCoverRequest = 0;
let publishGeneratedCoverUrl = '';
let publishResolvedVideo = { project: '', url: '' };
let publishActiveLang = 'zh';
let publishLangDrafts = { zh: {}, en: {}, ja: {} };
let publishLangCaptions = { zh: '', en: '', ja: '' };
const PUBLISH_LANG_META = {
  zh: { label: '中文', ytCode: 'zh-Hans' },
  en: { label: 'English', ytCode: 'en' },
  ja: { label: '日本語', ytCode: 'ja' },
};

function getPublishStorageKey(project, lang = 'zh') {
  return lang === 'zh' ? ('whyvideo_publish_' + project) : ('whyvideo_publish_' + project + '_' + lang);
}

function readLocalPublishDraft(project, lang = 'zh') {
  try {
    return JSON.parse(localStorage.getItem(getPublishStorageKey(project, lang)) || '{}') || {};
  } catch {
    return {};
  }
}

function captureCurrentPublishFormToDraft(project = activeProjectId, lang = publishActiveLang) {
  if (!project) return {};
  const draft = {
    title: document.getElementById('publishTitle')?.value || '',
    description: document.getElementById('publishDescription')?.value || '',
    tags: document.getElementById('publishTags')?.value || '',
    coverKeywords: document.getElementById('publishCoverKeywords')?.value || '',
  };
  publishLangDrafts[lang] = draft;
  try {
    localStorage.setItem(getPublishStorageKey(project, lang), JSON.stringify(draft));
  } catch {}
  refreshYoutubeBundleSummary();
  return draft;
}

function mergeMultilingualTags(drafts, maxLen = 500) {
  const seen = new Set();
  const merged = [];
  for (const code of ['zh', 'en', 'ja']) {
    const raw = String(drafts?.[code]?.tags || '');
    for (const part of raw.split(/[,，\n]/)) {
      const tag = part.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      const candidate = [...merged, tag];
      const encodedLen = candidate.map((t) => (t.includes(' ') ? '"' + t + '"' : t)).join(',').length;
      if (encodedLen > maxLen) continue;
      seen.add(key);
      merged.push(tag);
    }
  }
  return merged;
}

function refreshYoutubeBundleSummary() {
  const summaryEl = document.getElementById('youtubeMultiLangSummary');
  if (!summaryEl) return;
  const activeTitle = document.getElementById('publishTitle')?.value || '';
  const activeDesc = document.getElementById('publishDescription')?.value || '';
  const activeCap = document.getElementById('publishCaptions')?.value || '';
  const snapshotDrafts = {
    zh: publishActiveLang === 'zh' ? { ...(publishLangDrafts.zh || {}), title: activeTitle, description: activeDesc, tags: document.getElementById('publishTags')?.value || '' } : (publishLangDrafts.zh || {}),
    en: publishActiveLang === 'en' ? { ...(publishLangDrafts.en || {}), title: activeTitle, description: activeDesc, tags: document.getElementById('publishTags')?.value || '' } : (publishLangDrafts.en || {}),
    ja: publishActiveLang === 'ja' ? { ...(publishLangDrafts.ja || {}), title: activeTitle, description: activeDesc, tags: document.getElementById('publishTags')?.value || '' } : (publishLangDrafts.ja || {}),
  };
  const snapshotCaps = {
    zh: publishActiveLang === 'zh' ? activeCap : (publishLangCaptions.zh || ''),
    en: publishActiveLang === 'en' ? activeCap : (publishLangCaptions.en || ''),
    ja: publishActiveLang === 'ja' ? activeCap : (publishLangCaptions.ja || ''),
  };
  const zhReady = Boolean((snapshotDrafts.zh.title || '').trim());
  const enReady = Boolean((snapshotDrafts.en.title || '').trim());
  const jaReady = Boolean((snapshotDrafts.ja.title || '').trim());
  const mergedTagCount = mergeMultilingualTags(snapshotDrafts, 500).length;
  const srtReady = [
    snapshotCaps.zh.trim() ? '中文' : '',
    snapshotCaps.en.trim() ? 'English' : '',
    snapshotCaps.ja.trim() ? '日本語' : '',
  ].filter(Boolean);

  summaryEl.textContent =
    '本次上传将自动合并提交：主视频资料（' + (zhReady ? '中文 ✓' : '中文未填') +
    '）｜多语言标题/简介（English ' + (enReady ? '✓' : '未填') + ' · 日本語 ' + (jaReady ? '✓' : '未填') +
    '）｜合并标签（' + mergedTagCount + ' 个）｜自动挂载字幕（' + (srtReady.length ? srtReady.join(' / ') : '暂无') +
    '）。注：YouTube API 仅支持 1 张主封面，外语独立封面与配音音轨请在上传后前往 YouTube Studio 补充。';

  const summaryCaptionEl = document.getElementById('publishCaptionSummary');
  if (summaryCaptionEl) {
    const curSrt = snapshotCaps[publishActiveLang] || '';
    if (curSrt.trim()) {
      const cueCount = curSrt.trim().split(/\n\s*\n/).length;
      summaryCaptionEl.textContent = '✅ 已就绪（约 ' + cueCount + ' 段）';
    } else {
      summaryCaptionEl.textContent = publishActiveLang === 'zh' ? '尚未载入字幕' : '尚未生成';
    }
  }
}

function applyPublishDraftToForm(lang = publishActiveLang) {
  const draft = publishLangDrafts[lang] || {};
  const titleEl = document.getElementById('publishTitle');
  const descEl = document.getElementById('publishDescription');
  const tagsEl = document.getElementById('publishTags');
  const kwInput = document.getElementById('publishCoverKeywords');
  if (titleEl) titleEl.value = draft.title || '';
  if (descEl) descEl.value = draft.description || '';
  if (tagsEl) tagsEl.value = draft.tags || '';
  if (kwInput) kwInput.value = draft.coverKeywords || '';
}

function setPublishTranslateBanner(message, { visible = true, tone = 'info' } = {}) {
  const banner = document.getElementById('publishTranslateBanner');
  if (!banner) return;
  if (!visible || !message) {
    banner.textContent = '';
    banner.classList.add('hidden');
    return;
  }
  const toneClass = tone === 'error'
    ? 'border-danger text-danger bg-subtle'
    : (tone === 'success' ? 'border-ok-line text-ok bg-ok-soft' : 'border-line-strong text-ink bg-subtle');
  banner.className = 'rounded-xl border px-4 py-3 text-sm font-medium ' + toneClass;
  banner.textContent = message;
  banner.classList.remove('hidden');
}

function updatePublishLanguageUi(lang = publishActiveLang) {
  const meta = PUBLISH_LANG_META[lang] || PUBLISH_LANG_META.zh;
  const tabMap = { zh: 'publishLangTabZh', en: 'publishLangTabEn', ja: 'publishLangTabJa' };
  for (const [code, id] of Object.entries(tabMap)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const active = code === lang;
    btn.className = active
      ? 'px-3.5 py-1.5 rounded-lg text-sm font-bold bg-action text-ink-inverse transition'
      : 'px-3.5 py-1.5 rounded-lg text-sm font-semibold text-ink hover:bg-subtle transition';
  }
  for (const badgeId of ['publishCoverLangBadge', 'publishCopyLangBadge', 'publishCaptionLangBadge']) {
    const el = document.getElementById(badgeId);
    if (el) el.textContent = meta.label;
  }
  refreshYoutubeBundleSummary();

  const zhRow = document.getElementById('publishZhTranslateRow');
  if (zhRow) zhRow.classList.toggle('hidden', lang !== 'zh');
  const zhCaptionBar = document.getElementById('publishZhCaptionBar');
  if (zhCaptionBar) zhCaptionBar.classList.toggle('hidden', lang !== 'zh');
  const dubBox = document.getElementById('publishForeignDubBox');
  if (dubBox) dubBox.classList.toggle('hidden', lang === 'zh');
  const dubScriptEl = document.getElementById('englishDubScript');
  if (dubScriptEl) dubScriptEl.classList.toggle('hidden', lang === 'zh');
  const genBtn = document.getElementById('englishDubGenerateBtn');
  if (genBtn && !genBtn.disabled) {
    genBtn.textContent = lang === 'ja' ? '🎙️ 一键翻译并生成日语配音 + 字幕' : '🎙️ 一键翻译并生成英语配音 + 字幕';
  }
  const dubTitle = document.getElementById('publishForeignDubTitle');
  if (dubTitle) {
    dubTitle.textContent = lang === 'ja'
      ? '一键自动完成：大模型翻译中文终稿 → 本地 Voicebox（或 ElevenLabs）日语配音 → 本地 Whisper 同步字幕。'
      : '一键自动完成：大模型翻译中文终稿 → 本地 Voicebox（或 ElevenLabs）英语配音 → 本地 Whisper 同步字幕。';
  }
}
function showPublishCoverPreview(url, { isBlob = false, downloadName = 'cover.jpg' } = {}) {
  const preview = document.getElementById('publishCoverPreview');
  if (preview) {
    if (!preview.dataset) preview.dataset = {};
    if (preview.dataset.blobUrl) URL.revokeObjectURL(preview.dataset.blobUrl);
    preview.dataset.blobUrl = isBlob ? url : '';
    preview.src = url;
    preview.classList.remove('hidden');
  }
  const dl = document.getElementById('publishCoverDownload');
  if (dl) {
    dl.href = url;
    dl.download = downloadName;
    dl.classList.remove('hidden');
  }
}
function clearPublishCoverPreview() {
  const preview = document.getElementById('publishCoverPreview');
  if (preview) {
    if (!preview.dataset) preview.dataset = {};
    if (preview.dataset.blobUrl) URL.revokeObjectURL(preview.dataset.blobUrl);
    preview.dataset.blobUrl = '';
    preview.removeAttribute?.('src');
    preview.classList.add('hidden');
  }
  const dl = document.getElementById('publishCoverDownload');
  if (dl) {
    dl.removeAttribute?.('href');
    dl.classList.add('hidden');
  }
  publishGeneratedCoverUrl = '';
}
async function resolveSelectedPublishCover() {
  const localFile = document.getElementById('publishCover')?.files?.[0] || null;
  if (localFile) return localFile;
  if (!publishGeneratedCoverUrl) return null;
  const resp = await fetch(publishGeneratedCoverUrl, { cache: 'no-store' });
  if (!resp.ok) throw new Error('无法读取已生成的封面图片，请重新生成或选择本地图片。');
  const blob = await resp.blob();
  if (!blob || !blob.size) throw new Error('已生成的封面图片为空，请重新生成。');
  return blob;
}
async function loadPublishCoverForLang(project, lang, request, coverRequest) {
  const coverInput = document.getElementById('publishCover');
  if (coverInput) coverInput.value = '';
  clearPublishCoverPreview();
  const coverStatus = document.getElementById('publishCoverStatus');
  if (coverStatus) coverStatus.textContent = '';
  try {
    const langQuery = lang && lang !== 'zh' ? ('&lang=' + encodeURIComponent(lang)) : '';
    const response = await fetch('/api/publish/cover?project=' + encodeURIComponent(project) + langQuery, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (request === publishRequest && coverRequest === publishCoverRequest && data?.coverUrl) {
        publishGeneratedCoverUrl = data.coverUrl;
        showPublishCoverPreview(data.coverUrl, { downloadName: data.fileName || 'cover.jpg' });
        if (coverStatus) {
          coverStatus.textContent = data.isFallback
            ? '当前语言尚未单独生成封面，默认复用中文封面。'
            : '已载入当前工程保存的 AI 封面。';
        }
      }
    }
  } catch {}
}

async function loadPublishCaptionsForZh(project, request, captionRequest) {
  const captionFileInput = document.getElementById('publishCaptionFile');
  if (captionFileInput) captionFileInput.value = '';
  const captions = document.getElementById('publishCaptions');
  if (captions) captions.value = '';
  try {
    const response = await fetch('/public/' + encodeURIComponent(project) + '/captions/captions.srt', { cache: 'no-store' });
    if (response.ok) {
      const text = await response.text();
      if (request === publishRequest) {
        publishLangCaptions.zh = text;
        if (captionRequest === publishCaptionRequest && publishActiveLang === 'zh' && captions) {
          captions.value = text;
        }
        refreshYoutubeBundleSummary();
      }
    }
  } catch {}
}

async function loadPublishProject() {
  const project = activeProjectId;
  const request = ++publishRequest;
  const captionRequest = ++publishCaptionRequest;
  const coverRequest = ++publishCoverRequest;
  publishActiveLang = 'zh';
  publishLangCaptions = { zh: '', en: '', ja: '' };
  setPublishTranslateBanner('', { visible: false });
  restoreYoutubeUpload(project);
  publishLangDrafts = {
    zh: readLocalPublishDraft(project, 'zh'),
    en: readLocalPublishDraft(project, 'en'),
    ja: readLocalPublishDraft(project, 'ja'),
  };
  updatePublishLanguageUi('zh');
  applyPublishDraftToForm('zh');
  refreshYoutubeBundleSummary();
  publishResolvedVideo = { project: '', url: '' };
  const video = document.getElementById('publishVideo');
  const status = document.getElementById('publishVideoStatus');
  video.onloadedmetadata = null;
  video.onerror = null;
  video.removeAttribute?.('src');
  video.load?.();
  status.textContent = '正在查找当前工程的最终成片…';
  const videoPromise = (async () => {
    try {
      const response = await fetch('/api/publish/video?project=' + encodeURIComponent(project), { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (request === publishRequest) {
          if (data?.videoUrl) {
            publishResolvedVideo = { project, url: data.videoUrl };
            video.onloadedmetadata = () => {
              if (request === publishRequest) {
                status.textContent = '已载入当前工程的最终成片' + (data.fileName ? '（' + data.fileName + '）' : '') + '。';
              }
            };
            video.onerror = () => {
              if (request === publishRequest) {
                status.textContent = '未找到可播放的最终成片，请先在视觉分镜台完成最终渲染。';
              }
            };
            video.src = data.videoUrl;
            return;
          }
          status.textContent = '未找到可播放的最终成片，请先在视觉分镜台完成最终渲染。';
          return;
        }
      }
    } catch {}
    if (request === publishRequest) {
      status.textContent = '未找到可播放的最终成片，请先在视觉分镜台完成最终渲染。';
    }
  })();
  const captionsPromise = loadPublishCaptionsForZh(project, request, captionRequest);
  const coverPromise = loadPublishCoverForLang(project, 'zh', request, coverRequest);
  await Promise.all([videoPromise, captionsPromise, coverPromise, loadEnglishDubState(project, request, 'en', { hydrateOnly: true })]);
}

async function switchPublishLanguage(lang, { skipSaveCurrent = false, keepBanner = false } = {}) {
  const targetLang = ['zh', 'en', 'ja'].includes(lang) ? lang : 'zh';
  const project = activeProjectId;
  if (!skipSaveCurrent) {
    captureCurrentPublishFormToDraft(project, publishActiveLang);
    const curSrt = document.getElementById('publishCaptions')?.value;
    if (typeof curSrt === 'string') {
      publishLangCaptions[publishActiveLang] = curSrt;
    }
  }
  publishActiveLang = targetLang;
  if (!keepBanner) {
    setPublishTranslateBanner('', { visible: false });
  }
  updatePublishLanguageUi(targetLang);
  applyPublishDraftToForm(targetLang);
  const request = publishRequest;
  const captionRequest = ++publishCaptionRequest;
  const coverRequest = ++publishCoverRequest;
  const coverPromise = loadPublishCoverForLang(project, targetLang, request, coverRequest);
  if (targetLang === 'zh') {
    stopEnglishDubPolling();
    const captions = document.getElementById('publishCaptions');
    if (publishLangCaptions.zh && captions) {
      captions.value = publishLangCaptions.zh;
      refreshYoutubeBundleSummary();
      await coverPromise;
    } else {
      await Promise.all([coverPromise, loadPublishCaptionsForZh(project, request, captionRequest)]);
    }
  } else {
    const captionFileInput = document.getElementById('publishCaptionFile');
    if (captionFileInput) captionFileInput.value = '';
    const captions = document.getElementById('publishCaptions');
    if (captions) captions.value = publishLangCaptions[targetLang] || '';
    await Promise.all([coverPromise, loadEnglishDubState(project, request, targetLang, { hydrateOnly: false })]);
  }
}

async function savePublishDraft() {
  const project = activeProjectId;
  const lang = publishActiveLang;
  const draft = captureCurrentPublishFormToDraft(project, lang);
  try {
    await fetch('/api/publish/copy?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, ...draft }),
    });
  } catch {}
  showToast('已保存当前语言（' + (PUBLISH_LANG_META[lang]?.label || lang) + '）的发布资料');
}

async function translatePublishToLanguage(targetLang) {
  if (!['en', 'ja'].includes(targetLang)) return;
  const project = activeProjectId;
  const zhDraft = captureCurrentPublishFormToDraft(project, 'zh');
  const langLabel = targetLang === 'ja' ? '日语 (日本語)' : '英语 (English)';
  const enBtn = document.getElementById('publishTranslateToEnBtn');
  const jaBtn = document.getElementById('publishTranslateToJaBtn');
  if (enBtn) enBtn.disabled = true;
  if (jaBtn) jaBtn.disabled = true;

  await switchPublishLanguage(targetLang, { skipSaveCurrent: true, keepBanner: true });
  setPublishTranslateBanner('⏳ 正在将中文标题、简介、标签翻译为' + langLabel + '，请稍候…', { visible: true, tone: 'info' });

  try {
    const res = await fetch('/api/publish/translate-copy?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLang, ...zhDraft }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '翻译失败');
    if (project !== activeProjectId) return;
    const translated = data?.data || {};
    publishLangDrafts[targetLang] = {
      title: translated.title || '',
      description: translated.description || '',
      tags: translated.tags || '',
      coverKeywords: translated.coverKeywords || zhDraft.coverKeywords || '',
    };
    try {
      localStorage.setItem(getPublishStorageKey(project, targetLang), JSON.stringify(publishLangDrafts[targetLang]));
    } catch {}
    if (publishActiveLang === targetLang) {
      applyPublishDraftToForm(targetLang);
    }
    setPublishTranslateBanner(
      '✅ 已完成' + langLabel + '标题、简介、标签翻译并填入当前界面（如需外语配音与同步字幕，可在下方字幕区点击独立按钮生成）。',
      { visible: true, tone: 'success' }
    );
    if (typeof showToast === 'function') showToast('已完成' + langLabel + '发布资料翻译');
  } catch (err) {
    if (project === activeProjectId) {
      setPublishTranslateBanner('❌ 翻译失败：' + err.message, { visible: true, tone: 'error' });
    }
  } finally {
    if (enBtn) enBtn.disabled = false;
    if (jaBtn) jaBtn.disabled = false;
  }
}

function downloadPublishCaptions() {
  const content = document.getElementById('publishCaptions')?.value || '';
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-subrip;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = publishActiveLang === 'zh'
    ? 'captions.srt'
    : (englishDubCurrentFileNames.srt || (activeProjectId + '_' + publishActiveLang + '.srt'));
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('publishCover').addEventListener('change', function () {
  ++publishCoverRequest;
  publishGeneratedCoverUrl = '';
  const coverStatus = document.getElementById('publishCoverStatus');
  if (!this.files[0]) {
    clearPublishCoverPreview();
    if (coverStatus) coverStatus.textContent = '';
    return;
  }
  showPublishCoverPreview(URL.createObjectURL(this.files[0]), { isBlob: true, downloadName: this.files[0].name || 'cover.jpg' });
  if (coverStatus) coverStatus.textContent = '已选择本地封面图片。';
});
async function generatePublishCover() {
  const kwInput = document.getElementById('publishCoverKeywords');
  const statusEl = document.getElementById('publishCoverStatus');
  const btn = document.getElementById('publishCoverGenerateBtn');
  const keywords = (kwInput?.value || '').trim();
  if (!keywords) {
    if (statusEl) statusEl.textContent = '请先输入封面关键词。';
    kwInput?.focus?.();
    return;
  }
  const project = activeProjectId;
  const coverRequest = ++publishCoverRequest;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在生成…';
  }
  if (statusEl) statusEl.textContent = '正在调用生图模型生成 16:9 封面…';
  try {
    const title = (document.getElementById('publishTitle')?.value || '').trim();
    const coverBody = publishActiveLang === 'zh' ? { keywords, title } : { keywords, title, lang: publishActiveLang };
    const response = await fetch('/api/publish/generate-cover?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coverBody),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '生成封面失败');
    if (project !== activeProjectId || coverRequest !== publishCoverRequest) {
      showToast('工程已切换或封面已变更，生成结果未覆盖');
      return;
    }
    const coverInput = document.getElementById('publishCover');
    if (coverInput) coverInput.value = '';
    publishGeneratedCoverUrl = data.coverUrl;
    showPublishCoverPreview(data.coverUrl, { downloadName: data.fileName || 'cover.jpg' });
    if (statusEl) {
      statusEl.textContent = '已生成 AI 封面（模型：' + (data.model || '默认生图模型') + '），上传视频时会一并提交。';
    }
    showToast('AI 视频封面已生成');
  } catch (err) {
    if (statusEl) statusEl.textContent = '生成失败：' + err.message;
    alert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✨ AI 生成封面';
    }
  }
}

async function generatePublishCopy() {
  const button = document.getElementById('publishGenerate');
  const project = activeProjectId;
  const lang = publishActiveLang;
  button.disabled = true; button.textContent = '正在生成…';
  try {
    const fetchOpts = lang === 'zh'
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) };
    const response = await fetch('/api/publish/generate?project=' + encodeURIComponent(project), fetchOpts);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '生成失败');
    if (project !== activeProjectId || lang !== publishActiveLang) { showToast('工程或语言已切换，生成结果未应用'); return; }
    document.getElementById('publishTitle').value = data.title;
    document.getElementById('publishDescription').value = data.description;
    document.getElementById('publishTags').value = data.tags.join(', ');
    captureCurrentPublishFormToDraft(project, lang);
    showToast('已生成标题、简介和标签，请检查后保存');
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; button.textContent = '✨ AI 生成发布资料'; }
}
document.getElementById('publishCaptionFile').addEventListener('change', async function() {
  const file = this.files[0]; if (!file) return;
  const project = activeProjectId;
  const lang = publishActiveLang;
  const captionRequest = ++publishCaptionRequest;
  const text = await file.text();
  if (project === activeProjectId && captionRequest === publishCaptionRequest && lang === publishActiveLang) {
    document.getElementById('publishCaptions').value = text;
    publishLangCaptions[lang] = text;
    refreshYoutubeBundleSummary();
    showToast('已载入本地 SRT 字幕，可编辑、下载或在上传 YouTube 时一并提交');
  }
});
for (const fieldId of ['publishTitle', 'publishDescription', 'publishTags', 'publishCoverKeywords']) {
  document.getElementById(fieldId)?.addEventListener?.('input', () => {
    captureCurrentPublishFormToDraft(activeProjectId, publishActiveLang);
  });
}
document.getElementById('publishCaptions')?.addEventListener?.('input', function() {
  publishLangCaptions[publishActiveLang] = this.value || '';
  refreshYoutubeBundleSummary();
});
const YOUTUBE_TOKEN_KEY = 'whyvideo_youtube_access_token';
let youtubeAccessToken = '';
let youtubeAuthMode = 'none';
let youtubeTokenExpiresAt = 0;
let youtubeCheckVersion = 0;

function getYoutubeRedirectUri() {
  const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';
  return origin + '/api/publish/youtube/oauth/callback';
}

function syncYoutubeRedirectUriField() {
  const field = document.getElementById('youtubeRedirectUri');
  if (field) field.value = getYoutubeRedirectUri();
}

function setYoutubeStatus(state, message) {
  const badge = document.getElementById('youtubeSettingsButton');
  const status = document.getElementById('youtubeSettingsStatus');
  const summary = document.getElementById('youtubeConnectionStatus');
  const button = document.getElementById('youtubeConnect');
  badge.textContent = state === 'connected' ? '🟢 YouTube · 已连接' : state === 'checking' ? '⏳ YouTube · 验证中' : state === 'expired' ? '🟠 YouTube · 需重新授权' : '⚙️ YouTube · 未连接';
  badge.className = 'px-4 py-2 rounded-lg border ' + (state === 'connected' ? 'bg-ok-soft border-ok-line text-ok' : 'bg-subtle border-line-strong');
  status.textContent = message;
  summary.textContent = message;
  if (button) button.textContent = state === 'connected' && youtubeAuthMode === 'manual' ? '重新验证' : '验证并连接';
}

function openYoutubeSettings() {
  syncYoutubeRedirectUriField();
  document.getElementById('youtubeSettings').classList.remove('hidden');
}

function closeYoutubeSettings() {
  document.getElementById('youtubeSettings').classList.add('hidden');
}

async function copyYoutubeRedirectUri() {
  syncYoutubeRedirectUriField();
  const field = document.getElementById('youtubeRedirectUri');
  const value = field ? field.value : getYoutubeRedirectUri();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else if (field) {
      field.select();
      document.execCommand('copy');
    }
    showToast('已复制 OAuth 回调地址');
  } catch {
    if (field) field.select();
    showToast('请手动复制输入框中的回调地址');
  }
}

async function refreshYoutubeOAuthStatus(forceRefresh = false) {
  syncYoutubeRedirectUriField();
  const version = ++youtubeCheckVersion;
  try {
    const response = await fetch('/api/publish/youtube/token' + (forceRefresh ? '?force=1' : ''), { cache: 'no-store' });
    const data = await response.json();
    if (version !== youtubeCheckVersion) return false;

    const clientIdInput = document.getElementById('youtubeClientId');
    const clientSecretInput = document.getElementById('youtubeClientSecret');
    if (clientIdInput && data.clientId && !clientIdInput.value) {
      clientIdInput.value = data.clientId;
    }
    if (clientSecretInput) {
      clientSecretInput.placeholder = data.hasCredentials
        ? '已保存（留空则沿用已保存的 Secret）'
        : '输入 Google OAuth Client Secret';
    }

    if (data.connected && data.accessToken) {
      youtubeAccessToken = data.accessToken;
      youtubeAuthMode = 'oauth';
      youtubeTokenExpiresAt = Number(data.expiresAt) || 0;
      setYoutubeStatus('connected', '已连接频道：' + (data.channelTitle || 'YouTube 频道') + '（长期自动续期）');
      return true;
    }

    youtubeAccessToken = '';
    youtubeTokenExpiresAt = 0;

    if (data.expired) {
      youtubeAuthMode = 'oauth';
      setYoutubeStatus('expired', data.error || '刷新令牌已过期，请重新前往 Google 授权。');
      return false;
    }

    if (data.error) {
      youtubeAuthMode = 'oauth';
      setYoutubeStatus('disconnected', data.error);
      return false;
    }

    youtubeAuthMode = 'none';
    try {
      const savedYoutubeToken = localStorage.getItem(YOUTUBE_TOKEN_KEY);
      if (savedYoutubeToken) {
        const manualInput = document.getElementById('youtubeToken');
        if (manualInput) manualInput.value = savedYoutubeToken;
        await connectYoutube();
        return Boolean(youtubeAccessToken);
      }
    } catch {}

    setYoutubeStatus(
      'disconnected',
      data.hasCredentials
        ? '已保存 OAuth 凭据，请点击「保存并前往 Google 授权」完成连接。'
        : '尚未连接频道，请配置 Google OAuth 或临时令牌。'
    );
    return false;
  } catch (err) {
    if (version === youtubeCheckVersion) {
      youtubeAccessToken = '';
      youtubeTokenExpiresAt = 0;
      setYoutubeStatus('disconnected', '读取 YouTube 授权状态失败：' + err.message);
    }
    return false;
  }
}

async function ensureYoutubeToken(forceRefresh = false) {
  if (youtubeAuthMode !== 'oauth') return youtubeAccessToken;
  if (!forceRefresh && youtubeAccessToken && Date.now() < youtubeTokenExpiresAt - 120000) {
    return youtubeAccessToken;
  }
  const response = await fetch('/api/publish/youtube/token?force=1', { cache: 'no-store' });
  const data = await response.json();
  if (data.connected && data.accessToken) {
    youtubeAccessToken = data.accessToken;
    youtubeTokenExpiresAt = Number(data.expiresAt) || 0;
    setYoutubeStatus('connected', '已连接频道：' + (data.channelTitle || 'YouTube 频道') + '（长期自动续期）');
    return youtubeAccessToken;
  }
  youtubeAccessToken = '';
  youtubeTokenExpiresAt = 0;
  setYoutubeStatus(data.expired ? 'expired' : 'disconnected', data.error || 'YouTube 授权已失效，请重新授权。');
  throw new Error(data.error || 'YouTube 授权已失效，请重新授权。');
}

async function startYoutubeOAuth() {
  const button = document.getElementById('youtubeOAuthStartButton');
  const fallback = document.getElementById('youtubeOAuthFallbackLink');
  const clientId = document.getElementById('youtubeClientId')?.value.trim() || '';
  const clientSecret = document.getElementById('youtubeClientSecret')?.value.trim() || '';
  if (fallback) fallback.classList.add('hidden');
  if (button) button.disabled = true;
  setYoutubeStatus('checking', '正在保存 OAuth 配置并生成授权链接…');
  try {
    const response = await fetch('/api/publish/youtube/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = await response.json();
    if (!response.ok || !data.authUrl) {
      throw new Error(data.error || '无法生成 Google 授权链接');
    }
    const secretField = document.getElementById('youtubeClientSecret');
    if (secretField) {
      secretField.value = '';
      secretField.placeholder = '已保存（留空则沿用已保存的 Secret）';
    }
    const popup = window.open(data.authUrl, 'whyvideo_youtube_oauth', 'width=560,height=720,menubar=no,toolbar=no');
    if (!popup) {
      if (fallback) {
        fallback.href = data.authUrl;
        fallback.classList.remove('hidden');
      }
      setYoutubeStatus('disconnected', '浏览器拦截了弹窗，请点击下方链接前往 Google 完成授权；授权完成后刷新状态即可。');
    } else {
      setYoutubeStatus('checking', '已打开 Google 授权窗口，请在弹窗中完成登录并授予权限…');
    }
  } catch (err) {
    setYoutubeStatus('disconnected', err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'whyvideo-youtube-oauth') return;
    const fallback = document.getElementById('youtubeOAuthFallbackLink');
    if (fallback) fallback.classList.add('hidden');
    if (event.data.ok) {
      const secretField = document.getElementById('youtubeClientSecret');
      if (secretField) secretField.value = '';
      if (typeof window !== 'undefined') void refreshYoutubeOAuthStatus(false);
      showToast('✅ YouTube 长期授权已连接：' + (event.data.channelTitle || '频道'));
    } else {
      setYoutubeStatus('disconnected', '授权未完成：' + (event.data.error || '未知错误'));
    }
  });
}

async function connectYoutube() {
  const input = document.getElementById('youtubeToken');
  const button = document.getElementById('youtubeConnect');
  const token = input.value.trim();
  if (!token) { setYoutubeStatus('disconnected', '请输入 OAuth 访问令牌'); return; }
  const version = ++youtubeCheckVersion;
  button.disabled = true; setYoutubeStatus('checking', '正在验证 YouTube 频道…');
  try {
    const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {headers:{Authorization:'Bearer ' + token}});
    const data = await response.json();
    if (version !== youtubeCheckVersion) return;
    if (!response.ok) {
      if (response.status === 401) { youtubeAccessToken = ''; youtubeAuthMode = 'none'; setYoutubeStatus('expired', '令牌无效或已过期，请重新获取后验证。'); return; }
      const reasons = (data.error?.errors || []).map(item => item.reason);
      if (reasons.some(reason => /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) || /quota/i.test(data.error?.message || '')) {
        setYoutubeStatus('disconnected', 'YouTube API 配额已用尽。OAuth Playground 默认使用共享项目；请使用自己的 Google Cloud OAuth 凭据重新授权，或等待配额恢复。');
        return;
      }
      throw new Error((data.error?.message || '验证失败').replace(/<[^>]*>/g, ''));
    }
    const channel = data.items?.[0];
    if (!channel) throw new Error('未找到频道，请检查账号及授权范围');
    try { localStorage.setItem(YOUTUBE_TOKEN_KEY, token); }
    catch { youtubeAccessToken = ''; setYoutubeStatus('disconnected', '无法保存到浏览器，请检查浏览器存储设置。'); return; }
    youtubeAccessToken = token;
    youtubeAuthMode = 'manual';
    youtubeTokenExpiresAt = 0;
    setYoutubeStatus('connected', '已连接频道：' + channel.snippet.title + '（临时令牌）');
  } catch (err) {
    if (version === youtubeCheckVersion) { youtubeAccessToken = ''; youtubeAuthMode = 'none'; setYoutubeStatus('disconnected', '验证失败：' + err.message + '。请检查网络或授权后重试。'); }
  } finally { if (version === youtubeCheckVersion) button.disabled = false; }
}

async function disconnectYoutube() {
  ++youtubeCheckVersion;
  youtubeAccessToken = '';
  youtubeAuthMode = 'none';
  youtubeTokenExpiresAt = 0;
  try { localStorage.removeItem(YOUTUBE_TOKEN_KEY); } catch {}
  const manualInput = document.getElementById('youtubeToken');
  if (manualInput) manualInput.value = '';
  const connectBtn = document.getElementById('youtubeConnect');
  if (connectBtn) connectBtn.disabled = false;
  try {
    await fetch('/api/publish/youtube/oauth/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCredentials: false }),
    });
  } catch {}
  setYoutubeStatus('disconnected', '已断开连接并清除保存的授权令牌。');
}

if (typeof window !== 'undefined') void refreshYoutubeOAuthStatus(false);

let youtubeUploadBusy = false;
var youtubeAssetVideo = null;
function restoreYoutubeUpload(project) {
  try {
    const record = JSON.parse(sessionStorage.getItem('whyvideo_uploaded_' + project) || 'null');
    const locDone = record ? (record.localizationsDone ?? true) : true;
    youtubeAssetVideo = record ? { ...record, project, cover: null, localizations: null, captionTracks: [], localizationsDone: locDone } : null;
    const link = document.getElementById('youtubeVideoLink');
    const studioLink = document.getElementById('youtubeStudioLanguagesLink');
    const retry = document.getElementById('youtubeRetryAssets');
    if (record) {
      showYoutubeVideo(record.videoId);
      uploadMessage('本次浏览器会话已有上传记录。');
    } else {
      link.classList.add('hidden');
      if (studioLink) studioLink.classList.add('hidden');
      uploadMessage('');
    }
    retry.classList.toggle('hidden', !record || (record.coverDone && locDone && record.captionsDone));
  } catch {}
}
function youtubeHeaders() { return {Authorization: 'Bearer ' + youtubeAccessToken}; }
async function youtubeError(response) {
  let data; try { data = await response.json(); } catch {}
  const reason = data?.error?.errors?.[0]?.reason || '';
  if (response.status === 401) return '令牌已失效，请重新授权并连接。';
  if (reason === 'insufficientPermissions' || response.status === 403 && /scope|permission|insufficient/i.test(data?.error?.message || '')) return '授权权限不足：请重新获取带 youtube.force-ssl 权限的令牌。';
  return (data?.error?.message || ('请求失败（HTTP ' + response.status + '）')).replace(/<[^>]*>/g, '');
}
function uploadMessage(text) { document.getElementById('youtubeUploadStatus').textContent = text; }
function setUploadBusy(busy) {
  youtubeUploadBusy = busy;
  document.getElementById('youtubeUploadButton').disabled = busy;
  document.getElementById('youtubeRetryAssets').disabled = busy;
}
function showYoutubeVideo(videoId) {
  const link = document.getElementById('youtubeVideoLink');
  link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
  link.textContent = '打开已上传的视频';
  link.classList.remove('hidden');
  const studioLink = document.getElementById('youtubeStudioLanguagesLink');
  if (studioLink) {
    studioLink.href = 'https://studio.youtube.com/video/' + encodeURIComponent(videoId) + '/translations';
    studioLink.classList.remove('hidden');
  }
}
function sendYoutubeVideo(sessionUrl, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Authorization', 'Bearer ' + youtubeAccessToken);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = event => { if (event.lengthComputable) uploadMessage('视频上传中：' + Math.round(event.loaded / event.total * 100) + '%'); };
    xhr.onload = () => {
      let data; try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data?.id) resolve(data.id);
      else reject(new Error((data?.error?.message || ('上传结果不明确（HTTP ' + xhr.status + '）')).replace(/<[^>]*>/g, '')));
    };
    xhr.onerror = () => reject(new Error('网络中断，上传结果可能尚未确认。请先检查 YouTube Studio，避免重复上传。'));
    xhr.send(file);
  });
}
async function youtubeFetchWithRefresh(url, initFactory) {
  if (youtubeAuthMode === 'oauth') await ensureYoutubeToken(false);
  let response = await fetch(url, initFactory());
  if (response.status === 401 && youtubeAuthMode === 'oauth') {
    await ensureYoutubeToken(true);
    response = await fetch(url, initFactory());
  }
  return response;
}
async function resolvePrimaryYoutubeCover(project) {
  const localFile = document.getElementById('publishCover')?.files?.[0] || null;
  if (localFile) return localFile;
  if (publishActiveLang === 'zh') {
    return await resolveSelectedPublishCover();
  }
  const resp = await fetch('/api/publish/cover?project=' + encodeURIComponent(project), { cache: 'no-store' });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data?.coverUrl) return null;
  const imgResp = await fetch(data.coverUrl, { cache: 'no-store' });
  if (!imgResp.ok) return null;
  const blob = await imgResp.blob();
  return blob && blob.size ? blob : null;
}

async function collectAllYoutubeCaptionTracks(project, primaryLangCode) {
  const tracks = [];
  let zhText = (publishLangCaptions.zh || '').trim();
  if (!zhText) {
    try {
      const res = await fetch('/public/' + encodeURIComponent(project) + '/captions/captions.srt', { cache: 'no-store' });
      if (res.ok) {
        zhText = (await res.text()).trim();
        if (zhText) publishLangCaptions.zh = zhText;
      }
    } catch {}
  }
  if (zhText) {
    tracks.push({ key: 'zh', language: primaryLangCode || 'zh-Hans', name: '中文', text: zhText, done: false });
  }
  for (const code of ['en', 'ja']) {
    let text = (publishLangCaptions[code] || '').trim();
    if (!text) {
      try {
        const res = await fetch('/api/publish/english-dub?project=' + encodeURIComponent(project) + (code === 'ja' ? '&lang=ja' : ''), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data?.srtText && String(data.srtText).trim()) {
            text = String(data.srtText).trim();
            publishLangCaptions[code] = text;
          }
        }
      } catch {}
    }
    if (text) {
      tracks.push({ key: code, language: code, name: code === 'en' ? 'English' : '日本語', text, done: false });
    }
  }
  return tracks;
}

async function uploadYoutubeVideo() {
  if (youtubeUploadBusy) return;
  const project = activeProjectId;
  captureCurrentPublishFormToDraft(project, publishActiveLang);
  const activeSrt = document.getElementById('publishCaptions')?.value;
  if (typeof activeSrt === 'string') {
    publishLangCaptions[publishActiveLang] = activeSrt;
  }

  const zhDraft = publishLangDrafts.zh || {};
  const fallbackDraft = publishLangDrafts[publishActiveLang] || {};
  const title = (zhDraft.title || fallbackDraft.title || '').trim().slice(0, 100);
  const description = (zhDraft.description || fallbackDraft.description || '').trim();
  const tags = mergeMultilingualTags(publishLangDrafts, 500);
  const primarySourceLang = document.getElementById('youtubeSourceLanguage')?.value || 'zh-Hans';
  const primaryCaptionLang = document.getElementById('youtubeCaptionLanguage')?.value.trim() || 'zh-Hans';
  const baseLang = primarySourceLang.toLowerCase().split('-')[0];
  const localizations = {};
  for (const code of ['en', 'ja']) {
    if (code === baseLang) continue;
    const d = publishLangDrafts[code];
    if (d && String(d.title || '').trim()) {
      localizations[code] = {
        title: String(d.title).trim().slice(0, 100),
        description: String(d.description || '').trim(),
      };
    }
  }

  const audience = document.getElementById('youtubeAudience').value;
  const privacy = document.getElementById('youtubePrivacy').value;
  if (youtubeAuthMode === 'oauth') {
    try { await ensureYoutubeToken(false); }
    catch (err) { uploadMessage(err.message); return; }
  }
  if (!youtubeAccessToken) { uploadMessage('请先连接具有上传权限的 YouTube 账号。'); return; }
  if (!title) { uploadMessage('请先填写中文主视频标题。'); return; }
  if (!audience) { uploadMessage('请选择视频是否专为儿童制作。'); return; }
  if (youtubeAssetVideo && youtubeAssetVideo.project === project && !confirm('本工程已有上传记录。继续会创建一个新的视频和新链接，确定继续吗？')) return;
  const locNames = Object.keys(localizations).map((c) => (c === 'en' ? 'English' : '日本語')).join(' + ');
  const confirmMsg = '即将把视频上传到已连接的 YouTube 频道，可见范围为「' + ({ private: '私密', unlisted: '不公开', public: '公开' }[privacy]) + '」' + (locNames ? '，并自动打包上传 ' + locNames + ' 多语言资料与全部已备字幕' : '') + '。确认上传吗？';
  if (!confirm(confirmMsg)) return;
  setUploadBusy(true);
  try {
    uploadMessage('正在准备成片、多语言资料和全部字幕…');
    let file = document.getElementById('youtubeVideoFile').files[0];
    if (!file) {
      let videoUrl = publishResolvedVideo.project === project ? publishResolvedVideo.url : '';
      if (!videoUrl) {
        const lookupResp = await fetch('/api/publish/video?project=' + encodeURIComponent(project), { cache: 'no-store' });
        if (lookupResp.ok) {
          const lookupData = await lookupResp.json();
          if (lookupData?.videoUrl) {
            videoUrl = lookupData.videoUrl;
            publishResolvedVideo = { project, url: videoUrl };
          }
        }
      }
      if (!videoUrl) throw new Error('未找到工程成片，请先渲染或选择视频文件。');
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error('未找到工程成片，请先渲染或选择视频文件。');
      file = await response.blob();
    }
    if (!file.size) throw new Error('视频文件为空。');
    const cover = await resolvePrimaryYoutubeCover(project);
    const captionTracks = await collectAllYoutubeCaptionTracks(project, primaryCaptionLang);
    uploadMessage('正在创建 YouTube 上传任务…');
    const response = await youtubeFetchWithRefresh(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      () => ({
        method: 'POST',
        headers: { ...youtubeHeaders(), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'video/mp4', 'X-Upload-Content-Length': String(file.size) },
        body: JSON.stringify({ snippet: { title, description, tags, categoryId: '27', defaultLanguage: primarySourceLang, defaultAudioLanguage: primarySourceLang }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: audience === 'yes' } }),
      })
    );
    if (!response.ok) throw new Error(await youtubeError(response));
    const location = response.headers.get('Location');
    if (!location || new URL(location).hostname !== 'www.googleapis.com') throw new Error('无法取得可信的 YouTube 上传地址。');
    uploadMessage('开始上传视频…');
    const videoId = await sendYoutubeVideo(location, file);
    const hasLoc = Object.keys(localizations).length > 0;
    youtubeAssetVideo = {
      project,
      videoId,
      cover,
      localizations,
      captionTracks,
      coverDone: !cover,
      localizationsDone: !hasLoc,
      captionsDone: !captionTracks.length,
    };
    sessionStorage.setItem('whyvideo_uploaded_' + project, JSON.stringify({
      videoId,
      coverDone: youtubeAssetVideo.coverDone,
      localizationsDone: youtubeAssetVideo.localizationsDone,
      captionsDone: youtubeAssetVideo.captionsDone,
    }));
    showYoutubeVideo(videoId);
    if (activeProjectId !== project) { uploadMessage('视频已上传，工程已切换；请回到原工程继续提交封面、多语言和字幕。'); return; }
    await uploadYoutubeAssets();
  } catch (err) { uploadMessage('上传失败：' + err.message); }
  finally { setUploadBusy(false); }
}
async function uploadYoutubeAssets() {
  const job = youtubeAssetVideo;
  const failures = [];
  if (!job.coverDone && job.cover) {
    try {
      uploadMessage('视频已上传，正在上传主封面…');
      const r = await youtubeFetchWithRefresh(
        'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + encodeURIComponent(job.videoId) + '&uploadType=media',
        () => ({ method: 'POST', headers: { ...youtubeHeaders(), 'Content-Type': job.cover.type || 'image/jpeg' }, body: job.cover })
      );
      if (!r.ok) throw new Error(await youtubeError(r));
      job.coverDone = true;
    } catch (err) { failures.push('封面：' + err.message); }
  }
  if (!job.localizationsDone && job.localizations && Object.keys(job.localizations).length > 0) {
    try {
      uploadMessage('正在写入多语言标题与简介（English / 日本語）…');
      const r = await youtubeFetchWithRefresh(
        'https://www.googleapis.com/youtube/v3/videos?part=localizations',
        () => ({
          method: 'PUT',
          headers: { ...youtubeHeaders(), 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ id: job.videoId, localizations: job.localizations }),
        })
      );
      if (!r.ok) throw new Error(await youtubeError(r));
      job.localizationsDone = true;
    } catch (err) { failures.push('多语言标题简介：' + err.message); }
  }
  if (!job.captionsDone && Array.isArray(job.captionTracks) && job.captionTracks.length > 0) {
    for (const track of job.captionTracks) {
      if (track.done || !track.text) continue;
      try {
        uploadMessage('正在上传字幕轨：' + track.name + ' (' + track.language + ')…');
        const boundary = 'whyvideo_' + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ snippet: { videoId: job.videoId, language: track.language, name: track.name, isDraft: false } });
        const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n', track.text, '\r\n--' + boundary + '--\r\n']);
        const r = await youtubeFetchWithRefresh(
          'https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart',
          () => ({ method: 'POST', headers: { ...youtubeHeaders(), 'Content-Type': 'multipart/related; boundary=' + boundary }, body })
        );
        if (!r.ok) throw new Error(await youtubeError(r));
        track.done = true;
      } catch (err) {
        failures.push(track.name + '字幕：' + err.message);
      }
    }
    job.captionsDone = job.captionTracks.every((t) => t.done);
  }
  sessionStorage.setItem('whyvideo_uploaded_' + job.project, JSON.stringify({
    videoId: job.videoId,
    coverDone: job.coverDone,
    localizationsDone: job.localizationsDone,
    captionsDone: job.captionsDone,
  }));
  document.getElementById('youtubeRetryAssets').classList.toggle('hidden', job.coverDone && job.localizationsDone && job.captionsDone);
  if (failures.length) {
    uploadMessage('视频已上传；' + failures.join('；') + '。可点击重试失败项。');
  } else {
    const uploadedCaps = (job.captionTracks || []).filter((t) => t.done).map((t) => t.name).join(' / ');
    const uploadedLocs = Object.keys(job.localizations || {}).map((c) => (c === 'en' ? 'English' : '日本語')).join(' / ');
    uploadMessage('✅ 视频、主封面' + (uploadedLocs ? '、多语言标题简介(' + uploadedLocs + ')' : '') + (uploadedCaps ? '及字幕(' + uploadedCaps + ')' : '') + '已全部上传！如需上传多语言配音音轨或独立封面，请点击下方「前往 YouTube Studio」链接补充。');
  }
}
async function retryYoutubeAssets() {
  if (youtubeUploadBusy || !youtubeAssetVideo || youtubeAssetVideo.project !== activeProjectId) return;
  if (youtubeAuthMode === 'oauth') {
    try { await ensureYoutubeToken(false); }
    catch (err) { uploadMessage(err.message); return; }
  }
  if (!youtubeAccessToken) { uploadMessage('请先连接 YouTube 账号。'); return; }
  try {
    if (!youtubeAssetVideo.coverDone && !youtubeAssetVideo.cover) {
      youtubeAssetVideo.cover = await resolvePrimaryYoutubeCover(activeProjectId);
    }
  } catch (err) {
    uploadMessage('获取封面失败：' + err.message);
    return;
  }
  if (!youtubeAssetVideo.captionsDone && (!youtubeAssetVideo.captionTracks || !youtubeAssetVideo.captionTracks.length)) {
    const primaryCaptionLang = document.getElementById('youtubeCaptionLanguage')?.value.trim() || 'zh-Hans';
    youtubeAssetVideo.captionTracks = await collectAllYoutubeCaptionTracks(activeProjectId, primaryCaptionLang);
  }
  if ((!youtubeAssetVideo.coverDone && !youtubeAssetVideo.cover) && (!youtubeAssetVideo.localizationsDone && !Object.keys(youtubeAssetVideo.localizations || {}).length) && (!youtubeAssetVideo.captionsDone && !(youtubeAssetVideo.captionTracks || []).length)) {
    uploadMessage('没有可重试的封面、多语言资料或字幕。');
    return;
  }
  setUploadBusy(true);
  try { await uploadYoutubeAssets(); } finally { setUploadBusy(false); }
}

let publishPromptProject = null;
async function openPublishAiSettings() {
  const project = activeProjectId;
  publishPromptProject = project;
  document.getElementById('publishPromptModal').classList.remove('hidden');
  document.getElementById('publishPromptStatus').textContent = '正在读取发布台 AI 设置…';
  if (typeof loadOpenRouterModels === 'function') void loadOpenRouterModels();
  if (typeof loadOpenRouterImageModels === 'function') void loadOpenRouterImageModels();
  try {
    const res = await fetch('/api/publish/ai-settings?project=' + encodeURIComponent(project), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '读取失败');
    if (publishPromptProject !== project) return;
    const trInput = document.getElementById('publishTranslateModelInput');
    if (trInput) {
      trInput.value = data.translateModel || '';
      trInput.placeholder = '留空默认：' + (data.fallbackTranslateModel || 'deepseek/deepseek-chat');
    }
    const cvInput = document.getElementById('publishCoverModelInput');
    if (cvInput) {
      cvInput.value = data.coverModel || '';
      cvInput.placeholder = '留空默认：' + (data.fallbackCoverModel || 'black-forest-labs/flux-3-image');
    }
    document.getElementById('publishPrompt').value = data.prompt || '';
    const cpEl = document.getElementById('publishCoverPrompt');
    if (cpEl) cpEl.value = data.coverPrompt || '';
    document.getElementById('publishPromptStatus').textContent = '';
  } catch (err) {
    document.getElementById('publishPromptStatus').textContent = '读取失败：' + err.message;
  }
}
async function openPublishPrompt() { return await openPublishAiSettings(); }
function closePublishPrompt() { document.getElementById('publishPromptModal').classList.add('hidden'); publishPromptProject = null; }
async function savePublishAiSettings(reset) {
  const project = publishPromptProject;
  if (!project || project !== activeProjectId) {
    document.getElementById('publishPromptStatus').textContent = '工程已切换，请关闭后重新打开。';
    return;
  }
  const status = document.getElementById('publishPromptStatus');
  status.textContent = '正在保存…';
  try {
    const body = reset
      ? { reset: true }
      : {
          translateModel: (document.getElementById('publishTranslateModelInput')?.value || '').trim(),
          coverModel: (document.getElementById('publishCoverModelInput')?.value || '').trim(),
          prompt: document.getElementById('publishPrompt').value,
          coverPrompt: document.getElementById('publishCoverPrompt')?.value || '',
        };
    const res = await fetch('/api/publish/ai-settings?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    if (publishPromptProject !== project) return;
    document.getElementById('publishPrompt').value = data.prompt || '';
    const cpEl = document.getElementById('publishCoverPrompt');
    if (cpEl) cpEl.value = data.coverPrompt || '';
    const globalTr = document.getElementById('currentTranslateModelInput');
    if (globalTr && typeof data.translateModel === 'string' && data.translateModel) {
      globalTr.value = data.translateModel;
      if (typeof visualConfig === 'object' && visualConfig) visualConfig.translateModel = data.translateModel;
      if (typeof updateModelHeaderBadges === 'function') updateModelHeaderBadges();
    }
    status.textContent = reset ? '已恢复默认提示词。' : '✅ 发布台模型与提示词设置已保存到当前工程。';
    if (typeof showToast === 'function') showToast(reset ? '已恢复默认提示词' : '发布台 AI 设置已保存');
  } catch (err) {
    status.textContent = '保存失败：' + err.message;
  }
}
async function savePublishPrompt(reset) { return await savePublishAiSettings(reset); }

let englishDubPollTimer = null;
let englishDubCurrentFileNames = { audio: '', srt: '' };

function stopEnglishDubPolling() {
  if (englishDubPollTimer) {
    clearInterval(englishDubPollTimer);
    englishDubPollTimer = null;
  }
}

function setEnglishDubStatus(message, { tone = 'muted' } = {}) {
  const el = document.getElementById('englishDubStatus');
  if (!el) return;
  const toneClass = tone === 'error' ? 'text-danger' : tone === 'success' ? 'text-ok' : 'text-ink-muted';
  el.textContent = message;
  el.className = 'text-sm ' + toneClass;
}

function populatePublishElevenlabsSelect(voices = []) {
  const select = document.getElementById('englishDubElevenlabsVoiceId');
  if (!select) return;
  const list = Array.isArray(voices) ? voices : [];
  const prev = select.value || (() => { try { return localStorage.getItem('whyvideo_elevenlabs_voice_id') || ''; } catch { return ''; } })();
  select.replaceChildren();
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '暂无可用音色，请点右侧拉取';
    select.appendChild(opt);
    return;
  }
  const customVoices = list.filter((v) => v.category !== 'premade');
  const premadeVoices = list.filter((v) => v.category === 'premade');
  const appendGroup = (label, items) => {
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const v of items) {
      const opt = document.createElement('option');
      opt.value = v.voice_id;
      const catTag = v.category === 'cloned' ? '[克隆]' : v.category === 'professional' ? '[专业]' : v.category === 'generated' ? '[生成]' : '';
      opt.textContent = catTag ? `${catTag} ${v.name}` : v.name;
      grp.appendChild(opt);
    }
    select.appendChild(grp);
  };
  appendGroup(`我的定制/克隆音色 (${customVoices.length})`, customVoices);
  appendGroup(`ElevenLabs 官方预设 (${premadeVoices.length})`, premadeVoices);
  if (prev && list.some((v) => v.voice_id === prev)) {
    select.value = prev;
  } else if (list[0]?.voice_id) {
    select.value = list[0].voice_id;
  }
  try {
    if (select.value) localStorage.setItem('whyvideo_elevenlabs_voice_id', select.value);
  } catch {}
}

async function loadPublishElevenlabsVoices(showNotice = false) {
  const select = document.getElementById('englishDubElevenlabsVoiceId');
  const btn = document.getElementById('btnFetchPublishElevenlabsVoices');
  if (!select) return;
  if (!showNotice && Array.isArray(window._elevenlabsVoices) && window._elevenlabsVoices.length > 0) {
    populatePublishElevenlabsSelect(window._elevenlabsVoices);
    return;
  }
  const apiKey = (() => {
    try {
      const inputVal = (document.getElementById('elevenlabsKeyInput')?.value || '').trim();
      return inputVal || (localStorage.getItem('whyvideo_elevenlabs_api_key') || '').trim();
    } catch {
      return '';
    }
  })();
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 拉取中...';
  }
  try {
    const res = await fetch('/api/elevenlabs/voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || '拉取 ElevenLabs 音色失败');
    const voices = Array.isArray(data.voices) ? data.voices : [];
    window._elevenlabsVoices = voices;
    populatePublishElevenlabsSelect(voices);
    if (showNotice) {
      setEnglishDubStatus(`已拉取 ${voices.length} 个 ElevenLabs 音色。`, { tone: 'success' });
      if (typeof showToast === 'function') showToast(`✅ 已拉取 ${voices.length} 个 ElevenLabs 音色`);
    }
  } catch (err) {
    if (showNotice) {
      setEnglishDubStatus('拉取 ElevenLabs 音色失败：' + err.message, { tone: 'error' });
      if (typeof showToast === 'function') showToast('❌ ' + err.message);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '拉取音色';
    }
  }
}

function onEnglishDubEngineChange() {
  const engine = document.getElementById('englishDubEngine')?.value || 'voicebox';
  const vbRow = document.getElementById('englishDubVoiceboxRow');
  const elRow = document.getElementById('englishDubElevenlabsRow');
  if (vbRow) vbRow.classList.toggle('hidden', engine !== 'voicebox');
  if (elRow) elRow.classList.toggle('hidden', engine !== 'elevenlabs');
  if (engine === 'elevenlabs') {
    void loadPublishElevenlabsVoices(false);
  }
}

async function loadEnglishDubVoiceboxProfiles(forceToast = false) {
  const sel = document.getElementById('englishDubVoiceboxProfile');
  if (!sel) return;
  try {
    const res = await fetch('/api/voicebox/profiles', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || '获取 Voicebox 音色失败');
    const prev = sel.value;
    const profiles = Array.isArray(data.profiles) ? data.profiles : [];
    const optionsHtml = ['<option value="">自动选择英文音色</option>'];
    for (const p of profiles) {
      const langTag = p.language ? ' [' + p.language + ']' : '';
      const safeId = String(p.id || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const safeName = String(p.name || p.id || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      optionsHtml.push('<option value="' + safeId + '">' + safeName + langTag + '</option>');
    }
    sel.innerHTML = optionsHtml.join('');
    if (prev && profiles.some((p) => p.id === prev)) {
      sel.value = prev;
    } else {
      const targetPrefix = publishActiveLang === 'ja' ? 'ja' : 'en';
      const matchedProfile = profiles.find((p) => new RegExp('^' + targetPrefix, 'i').test(String(p.language || '')));
      if (matchedProfile) sel.value = matchedProfile.id;
    }
    if (forceToast && typeof showToast === 'function') {
      showToast('已加载 ' + profiles.length + ' 个 Voicebox 音色');
    }
  } catch (err) {
    if (forceToast && typeof showToast === 'function') {
      showToast('Voicebox 未启动或无法连接：' + err.message);
    }
  }
}

function applyEnglishDubArtifacts(data, { updateScript = true, syncToCaptions = true } = {}) {
  if (!data) return;
  if (data.copy && typeof data.copy === 'object') {
    for (const code of ['zh', 'en', 'ja']) {
      const serverLangCopy = data.copy[code];
      if (serverLangCopy && typeof serverLangCopy === 'object') {
        const cur = publishLangDrafts[code] || {};
        if (!cur.title && !cur.description && (serverLangCopy.title || serverLangCopy.description)) {
          publishLangDrafts[code] = {
            title: serverLangCopy.title || '',
            description: serverLangCopy.description || '',
            tags: serverLangCopy.tags || '',
            coverKeywords: serverLangCopy.coverKeywords || '',
          };
          if (publishActiveLang === code) applyPublishDraftToForm(code);
        }
      }
    }
  }
  const scriptEl = document.getElementById('englishDubScript');
  if (updateScript && scriptEl) {
    scriptEl.value = data.scriptText || '';
  }
  const audioEl = document.getElementById('englishDubAudio');
  const audioDlEl = document.getElementById('englishDubAudioDownload');
  englishDubCurrentFileNames.audio = data.audioFileName || '';
  englishDubCurrentFileNames.srt = data.srtFileName || '';
  if (data.audioUrl) {
    if (audioEl) {
      audioEl.src = data.audioUrl;
      audioEl.classList.remove('hidden');
    }
    if (audioDlEl) {
      audioDlEl.href = data.audioUrl;
      audioDlEl.download = data.audioFileName || (activeProjectId + '_' + (data.lang || publishActiveLang) + '.mp3');
      audioDlEl.classList.remove('hidden');
    }
  } else {
    if (audioEl) {
      audioEl.removeAttribute?.('src');
      audioEl.load?.();
      audioEl.classList.add('hidden');
    }
    if (audioDlEl) {
      audioDlEl.removeAttribute?.('href');
      audioDlEl.classList.add('hidden');
    }
  }
  const srtEl = document.getElementById('englishDubSrt');
  if (srtEl && typeof data.srtText === 'string') {
    srtEl.value = data.srtText;
  }
  const artifactLang = data.lang || publishActiveLang;
  if (typeof data.srtText === 'string' && data.srtText.trim() && ['en', 'ja'].includes(artifactLang)) {
    publishLangCaptions[artifactLang] = data.srtText;
  }
  if (syncToCaptions && publishActiveLang !== 'zh' && typeof data.srtText === 'string') {
    const captionsEl = document.getElementById('publishCaptions');
    if (captionsEl) captionsEl.value = data.srtText;
  }
  refreshYoutubeBundleSummary();
}

function applyEnglishDubJobStatus(job) {
  const genBtn = document.getElementById('englishDubGenerateBtn');
  const cancelBtn = document.getElementById('englishDubCancelBtn');
  const status = job?.status || 'idle';
  const busy = ['preparing', 'translating', 'generating', 'transcribing'].includes(status);
  const idleBtnText = publishActiveLang === 'ja'
    ? '🎙️ 一键翻译并生成日语配音 + 字幕'
    : '🎙️ 一键翻译并生成英语配音 + 字幕';
  if (genBtn) {
    genBtn.disabled = busy;
    genBtn.textContent = busy ? '⏳ 正在处理…' : idleBtnText;
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !busy);
  }
  if (busy) {
    setEnglishDubStatus(job.progressText || '正在后台翻译并生成配音与字幕…');
  } else if (status === 'completed') {
    const durText = job.durationSec ? '（时长 ' + job.durationSec + 's）' : '';
    setEnglishDubStatus('✅ ' + (job.progressText || '外语配音与同步字幕已生成') + durText, { tone: 'success' });
  } else if (status === 'failed') {
    setEnglishDubStatus('❌ 生成失败：' + (job.error || '未知错误'), { tone: 'error' });
  } else if (status === 'cancelled') {
    setEnglishDubStatus('已取消配音任务。');
  }
}

function pollEnglishDubStatus(project, lang = publishActiveLang) {
  stopEnglishDubPolling();
  const targetLang = lang === 'ja' ? 'ja' : 'en';
  englishDubPollTimer = setInterval(async () => {
    if (activeProjectId !== project || (publishActiveLang !== targetLang && publishActiveLang !== 'zh')) {
      stopEnglishDubPolling();
      return;
    }
    try {
      const res = await fetch('/api/publish/english-dub/status?project=' + encodeURIComponent(project) + '&lang=' + encodeURIComponent(targetLang), { cache: 'no-store' });
      const data = await res.json();
      if (activeProjectId !== project) return;
      const job = data?.job || null;
      applyEnglishDubJobStatus(job);
      const status = job?.status || 'idle';
      if (!['preparing', 'translating', 'generating', 'transcribing'].includes(status)) {
        stopEnglishDubPolling();
        if (data?.artifacts) {
          applyEnglishDubArtifacts(data.artifacts, { updateScript: true, syncToCaptions: publishActiveLang === targetLang });
        }
        if (status === 'completed' && typeof showToast === 'function') {
          showToast((targetLang === 'ja' ? '日语' : '英语') + '配音与同步字幕 (SRT) 已生成');
        }
      }
    } catch {}
  }, 2000);
}

async function loadEnglishDubState(project, request, lang = 'en', { hydrateOnly = false } = {}) {
  stopEnglishDubPolling();
  onEnglishDubEngineChange();
  const targetLang = lang === 'ja' ? 'ja' : 'en';
  const scriptFileEl = document.getElementById('englishDubScriptFile');
  if (scriptFileEl) scriptFileEl.value = '';
  void loadEnglishDubVoiceboxProfiles(false);
  try {
    const langQuery = targetLang === 'ja' ? '&lang=ja' : '';
    const res = await fetch('/api/publish/english-dub?project=' + encodeURIComponent(project) + langQuery, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '读取配音状态失败');
    if (project !== activeProjectId || request !== publishRequest) return;
    applyEnglishDubArtifacts(data, { updateScript: !hydrateOnly, syncToCaptions: !hydrateOnly && publishActiveLang === targetLang });
    if (hydrateOnly) return;
    if (data.job) {
      applyEnglishDubJobStatus(data.job);
      if (['preparing', 'translating', 'generating', 'transcribing'].includes(data.job.status)) {
        pollEnglishDubStatus(project, targetLang);
      }
    } else if (data.audioUrl && data.srtUrl) {
      const durText = data.durationSec ? '（时长 ' + data.durationSec + 's）' : '';
      setEnglishDubStatus('已载入本工程' + (targetLang === 'ja' ? '日语' : '英语') + '音频与同步 SRT' + durText + '。', { tone: 'success' });
    } else {
      setEnglishDubStatus('点击上方按钮，自动将中文终稿翻译为' + (targetLang === 'ja' ? '日语' : '英语') + '并生成本地配音与同步 SRT。');
    }
  } catch (err) {
    if (!hydrateOnly && project === activeProjectId && request === publishRequest) {
      setEnglishDubStatus('读取配音状态失败：' + err.message, { tone: 'error' });
    }
  }
}

async function translateScriptForDub() {
  const project = activeProjectId;
  const targetLang = publishActiveLang === 'ja' ? 'ja' : 'en';
  const langLabel = targetLang === 'ja' ? '日语' : '英语';
  setEnglishDubStatus('正在从中文终稿按段落翻译' + langLabel + '旁白稿，请稍候…');
  try {
    const res = await fetch('/api/publish/translate-script?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLang }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '翻译旁白稿失败');
    if (project !== activeProjectId) return;
    const scriptEl = document.getElementById('englishDubScript');
    if (scriptEl) scriptEl.value = data.scriptText || '';
    setEnglishDubStatus('✅ 已生成' + langLabel + '旁白稿。', { tone: 'success' });
    if (typeof showToast === 'function') showToast('已翻译' + langLabel + '旁白稿');
  } catch (err) {
    if (project === activeProjectId) {
      setEnglishDubStatus('翻译旁白稿失败：' + err.message, { tone: 'error' });
    }
  }
}

async function startEnglishDubGenerate() {
  const project = activeProjectId;
  const lang = publishActiveLang === 'ja' ? 'ja' : 'en';
  const text = (document.getElementById('englishDubScript')?.value || '').trim();
  const engine = document.getElementById('englishDubEngine')?.value || 'voicebox';
  const profileId = document.getElementById('englishDubVoiceboxProfile')?.value || '';
  const voiceId = (document.getElementById('englishDubElevenlabsVoiceId')?.value || '').trim()
    || (() => { try { return (localStorage.getItem('whyvideo_elevenlabs_voice_id') || '').trim(); } catch { return ''; } })();
  const apiKey = (() => {
    try {
      const inputVal = (document.getElementById('elevenlabsKeyInput')?.value || '').trim();
      return inputVal || (localStorage.getItem('whyvideo_elevenlabs_api_key') || '').trim();
    } catch {
      return '';
    }
  })();
  setEnglishDubStatus(text ? '⏳ 正在启动配音与字幕生成…' : '⏳ 正在启动：自动翻译中文终稿 → 配音 → Whisper 字幕…');
  try {
    const res = await fetch('/api/publish/english-dub/generate?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, text, autoTranslate: !text, engine, profileId, voiceId, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '启动生成任务失败');
    if (project !== activeProjectId) return;
    applyEnglishDubJobStatus(data.job);
    pollEnglishDubStatus(project, lang);
  } catch (err) {
    if (project === activeProjectId) {
      setEnglishDubStatus('启动失败：' + err.message, { tone: 'error' });
    }
  }
}

async function cancelEnglishDubGenerate() {
  const project = activeProjectId;
  const lang = publishActiveLang === 'ja' ? 'ja' : 'en';
  try {
    await fetch('/api/publish/english-dub/cancel?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    setEnglishDubStatus('正在取消配音任务…');
  } catch {}
}

async function savePublishCurrentSrt() {
  const project = activeProjectId;
  const lang = publishActiveLang === 'ja' ? 'ja' : 'en';
  const srt = (document.getElementById('publishCaptions')?.value || document.getElementById('englishDubSrt')?.value || '');
  if (!srt.trim()) {
    setEnglishDubStatus('当前没有可保存的 SRT 内容。', { tone: 'error' });
    return;
  }
  try {
    const res = await fetch('/api/publish/english-dub/save-srt?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, srt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '保存失败');
    if (project !== activeProjectId) return;
    englishDubCurrentFileNames.srt = data.fileName || (project + '_' + lang + '.srt');
    setEnglishDubStatus('✅ 已保存 SRT 到工程 output/' + englishDubCurrentFileNames.srt, { tone: 'success' });
    if (typeof showToast === 'function') showToast('已保存 ' + englishDubCurrentFileNames.srt);
  } catch (err) {
    if (project === activeProjectId) {
      setEnglishDubStatus('保存失败：' + err.message, { tone: 'error' });
    }
  }
}

async function saveEnglishDubSrt() {
  return await savePublishCurrentSrt();
}

function downloadEnglishDubSrt() {
  return downloadPublishCaptions();
}

document.getElementById('englishDubScriptFile')?.addEventListener?.('change', async function () {
  const file = this.files && this.files[0];
  if (!file) return;
  try {
    const content = await file.text();
    const el = document.getElementById('englishDubScript');
    if (el) el.value = content;
    setEnglishDubStatus('已导入英文稿：' + file.name);
  } catch (err) {
    setEnglishDubStatus('读取英文稿文件失败：' + err.message, { tone: 'error' });
  }
});
