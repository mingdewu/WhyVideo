let publishRequest = 0;
let publishCaptionRequest = 0;
let publishCoverRequest = 0;
let publishGeneratedCoverUrl = '';
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
async function loadPublishProject() {
  const project = activeProjectId;
  const request = ++publishRequest;
  const captionRequest = ++publishCaptionRequest;
  const coverRequest = ++publishCoverRequest;
  restoreYoutubeUpload(project);
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem('whyvideo_publish_' + project) || '{}'); } catch {}
  document.getElementById('publishTitle').value = draft.title || '';
  document.getElementById('publishDescription').value = draft.description || '';
  document.getElementById('publishTags').value = draft.tags || '';
  const kwInput = document.getElementById('publishCoverKeywords');
  if (kwInput) kwInput.value = draft.coverKeywords || '';
  const video = document.getElementById('publishVideo');
  const status = document.getElementById('publishVideoStatus');
  video.src = '/output/' + encodeURIComponent(project) + '/final_video_1080p.mp4';
  status.textContent = '正在查找当前工程的最终成片…';
  video.onloadedmetadata = () => { status.textContent = '已载入当前工程的最终成片。'; };
  video.onerror = () => { status.textContent = '未找到可播放的最终成片，请先在视觉分镜台完成最终渲染。'; };
  document.getElementById('publishCover').value = '';
  clearPublishCoverPreview();
  const coverStatus = document.getElementById('publishCoverStatus');
  if (coverStatus) coverStatus.textContent = '';
  const captionFileInput = document.getElementById('publishCaptionFile');
  if (captionFileInput) captionFileInput.value = '';
  const captions = document.getElementById('publishCaptions');
  captions.value = '';
  const captionsPromise = (async () => {
    try {
      const response = await fetch('/public/' + encodeURIComponent(project) + '/captions/captions.srt', { cache: 'no-store' });
      if (response.ok) { const text = await response.text(); if (request === publishRequest && captionRequest === publishCaptionRequest) captions.value = text; }
    } catch {}
  })();
  const coverPromise = (async () => {
    try {
      const response = await fetch('/api/publish/cover?project=' + encodeURIComponent(project), { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (request === publishRequest && coverRequest === publishCoverRequest && data?.coverUrl) {
          publishGeneratedCoverUrl = data.coverUrl;
          showPublishCoverPreview(data.coverUrl, { downloadName: data.fileName || 'cover.jpg' });
          if (coverStatus) coverStatus.textContent = '已载入当前工程保存的 AI 封面。';
        }
      }
    } catch {}
  })();
  await Promise.all([captionsPromise, coverPromise, loadLocalization(project, request)]);
}
function savePublishDraft() {
  localStorage.setItem('whyvideo_publish_' + activeProjectId, JSON.stringify({
    title: document.getElementById('publishTitle').value,
    description: document.getElementById('publishDescription').value,
    tags: document.getElementById('publishTags').value,
    coverKeywords: document.getElementById('publishCoverKeywords')?.value || '',
  }));
  showToast('发布资料已保存到此浏览器');
}
function downloadPublishCaptions() {
  const url = URL.createObjectURL(new Blob([document.getElementById('publishCaptions').value], {type:'application/x-subrip'}));
  const a = document.createElement('a'); a.href = url; a.download = 'captions.srt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const response = await fetch('/api/publish/generate-cover?project=' + encodeURIComponent(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, title }),
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
  button.disabled = true; button.textContent = '正在生成…';
  try {
    const response = await fetch('/api/publish/generate?project=' + encodeURIComponent(project), {method:'POST'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '生成失败');
    if (project !== activeProjectId) { showToast('工程已切换，生成结果未应用'); return; }
    document.getElementById('publishTitle').value = data.title;
    document.getElementById('publishDescription').value = data.description;
    document.getElementById('publishTags').value = data.tags.join(', ');
    showToast('已生成标题、简介和标签，请检查后保存草稿');
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; button.textContent = '✨ AI 生成发布资料'; }
}
document.getElementById('publishCaptionFile').addEventListener('change', async function() {
  const file = this.files[0]; if (!file) return;
  const project = activeProjectId;
  const captionRequest = ++publishCaptionRequest;
  const text = await file.text();
  if (project === activeProjectId && captionRequest === publishCaptionRequest) { document.getElementById('publishCaptions').value = text; showToast('已载入本地 SRT 字幕，可编辑、下载或在上传 YouTube 时一并提交'); }
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
    youtubeAssetVideo = record ? {...record, project, cover:null, captions:'', language:''} : null;
    const link = document.getElementById('youtubeVideoLink');
    const retry = document.getElementById('youtubeRetryAssets');
    if (record) { showYoutubeVideo(record.videoId); uploadMessage('本次浏览器会话已有上传记录。'); } else { link.classList.add('hidden'); uploadMessage(''); }
    retry.classList.toggle('hidden', !record || (record.coverDone && record.captionsDone));
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
  link.textContent = '打开已上传的视频'; link.classList.remove('hidden');
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
async function uploadYoutubeVideo() {
  if (youtubeUploadBusy) return;
  const project = activeProjectId;
  const title = document.getElementById('publishTitle').value.trim();
  const description = document.getElementById('publishDescription').value.trim();
  const tags = document.getElementById('publishTags').value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean);
  const tagsLength = tags.map(tag => tag.includes(' ') ? '"' + tag + '"' : tag).join(',').length;
  const audience = document.getElementById('youtubeAudience').value;
  const privacy = document.getElementById('youtubePrivacy').value;
  if (youtubeAuthMode === 'oauth') {
    try { await ensureYoutubeToken(false); }
    catch (err) { uploadMessage(err.message); return; }
  }
  if (!youtubeAccessToken) { uploadMessage('请先连接具有上传权限的 YouTube 账号。'); return; }
  if (!title) { uploadMessage('请先填写视频标题。'); return; }
  if (tagsLength > 500) { uploadMessage('标签总长度超过 YouTube 的 500 字符限制，请删减。'); return; }
  if (!audience) { uploadMessage('请选择视频是否专为儿童制作。'); return; }
  if (youtubeAssetVideo && youtubeAssetVideo.project === project && !confirm('本工程已有上传记录。继续会创建一个新的视频和新链接，确定继续吗？')) return;
  if (!confirm('即将把视频上传到已连接的 YouTube 频道，可见范围为「' + ({private:'私密',unlisted:'不公开',public:'公开'}[privacy]) + '」。确认上传吗？')) return;
  setUploadBusy(true);
  try {
    uploadMessage('正在准备视频文件…');
    let file = document.getElementById('youtubeVideoFile').files[0];
    if (!file) {
      const response = await fetch('/output/' + encodeURIComponent(project) + '/final_video_1080p.mp4');
      if (!response.ok) throw new Error('未找到工程成片，请先渲染或选择视频文件。');
      file = await response.blob();
    }
    if (!file.size) throw new Error('视频文件为空。');
    const cover = await resolveSelectedPublishCover();
    const captions = document.getElementById('publishCaptions').value.trim();
    const language = document.getElementById('youtubeCaptionLanguage').value.trim();
    if (captions && !language) throw new Error('请填写字幕语言代码。');
    uploadMessage('正在创建 YouTube 上传任务…');
    const response = await youtubeFetchWithRefresh(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      () => ({
        method:'POST',
        headers:{...youtubeHeaders(),'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type || 'video/mp4','X-Upload-Content-Length':String(file.size)},
        body: JSON.stringify({snippet:{title,description,tags,categoryId:'27',defaultLanguage:document.getElementById('localizationSourceLanguage').value,defaultAudioLanguage:document.getElementById('localizationSourceLanguage').value},status:{privacyStatus:privacy,selfDeclaredMadeForKids:audience==='yes'}})
      })
    );
    if (!response.ok) throw new Error(await youtubeError(response));
    const location = response.headers.get('Location');
    if (!location || new URL(location).hostname !== 'www.googleapis.com') throw new Error('无法取得可信的 YouTube 上传地址。');
    uploadMessage('开始上传视频…');
    const videoId = await sendYoutubeVideo(location, file);
    youtubeAssetVideo = {project, videoId, cover, captions, language, coverDone:!cover, captionsDone:!captions};
    sessionStorage.setItem('whyvideo_uploaded_' + project, JSON.stringify({videoId,coverDone:!cover,captionsDone:!captions}));
    showYoutubeVideo(videoId);
    if (activeProjectId !== project) { uploadMessage('视频已上传，工程已切换；请回到原工程继续上传封面和字幕。'); return; }
    await uploadYoutubeAssets();
  } catch (err) { uploadMessage('上传失败：' + err.message); }
  finally { setUploadBusy(false); }
}
async function uploadYoutubeAssets() {
  const job = youtubeAssetVideo;
  const failures = [];
  if (!job.coverDone && job.cover) {
    try {
      uploadMessage('视频已上传，正在上传封面…');
      const r = await youtubeFetchWithRefresh(
        'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + encodeURIComponent(job.videoId) + '&uploadType=media',
        () => ({method:'POST',headers:{...youtubeHeaders(),'Content-Type':job.cover.type || 'image/jpeg'},body:job.cover})
      );
      if (!r.ok) throw new Error(await youtubeError(r)); job.coverDone = true;
    } catch (err) { failures.push('封面：' + err.message); }
  }
  if (!job.captionsDone && job.captions) {
    try {
      uploadMessage('视频已上传，正在上传字幕…');
      const boundary = 'whyvideo_' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({snippet:{videoId:job.videoId,language:job.language,name:job.language + ' 字幕',isDraft:false}});
      const body = new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: application/octet-stream\r\n\r\n',job.captions,'\r\n--'+boundary+'--\r\n']);
      const r = await youtubeFetchWithRefresh(
        'https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart',
        () => ({method:'POST',headers:{...youtubeHeaders(),'Content-Type':'multipart/related; boundary='+boundary},body})
      );
      if (!r.ok) throw new Error(await youtubeError(r)); job.captionsDone = true;
    } catch (err) { failures.push('字幕：' + err.message); }
  }
  sessionStorage.setItem('whyvideo_uploaded_' + job.project, JSON.stringify({videoId:job.videoId,coverDone:job.coverDone,captionsDone:job.captionsDone}));
  document.getElementById('youtubeRetryAssets').classList.toggle('hidden', job.coverDone && job.captionsDone);
  uploadMessage(failures.length ? '视频已上传；' + failures.join('；') + '。可重试失败项目。' : '视频及所选封面、字幕已上传。YouTube 仍可能需要时间处理视频。');
}
async function retryYoutubeAssets() {
  if (youtubeUploadBusy || !youtubeAssetVideo || youtubeAssetVideo.project !== activeProjectId) return;
  if (youtubeAuthMode === 'oauth') {
    try { await ensureYoutubeToken(false); }
    catch (err) { uploadMessage(err.message); return; }
  }
  if (!youtubeAccessToken) { uploadMessage('请先连接 YouTube 账号。'); return; }
  try {
    youtubeAssetVideo.cover = (await resolveSelectedPublishCover()) || youtubeAssetVideo.cover;
  } catch (err) {
    uploadMessage('获取封面失败：' + err.message);
    return;
  }
  youtubeAssetVideo.captions = document.getElementById('publishCaptions').value.trim() || youtubeAssetVideo.captions;
  youtubeAssetVideo.language = document.getElementById('youtubeCaptionLanguage').value.trim();
  if ((!youtubeAssetVideo.coverDone && !youtubeAssetVideo.cover) || (!youtubeAssetVideo.captionsDone && (!youtubeAssetVideo.captions || !youtubeAssetVideo.language))) { uploadMessage('请重新选择封面或填写字幕及语言，再重试。'); return; }
  setUploadBusy(true);
  try { await uploadYoutubeAssets(); } finally { setUploadBusy(false); }
}

let publishPromptProject = null;
async function openPublishPrompt() {
  const project = activeProjectId; publishPromptProject = project;
  document.getElementById('publishPromptModal').classList.remove('hidden');
  document.getElementById('publishPromptStatus').textContent = '正在读取提示词…';
  try { const res = await fetch('/api/publish/prompt?project=' + encodeURIComponent(project)); const data = await res.json(); if (!res.ok) throw new Error(data.error); if (publishPromptProject !== project) return; document.getElementById('publishPrompt').value = data.prompt; document.getElementById('publishPromptStatus').textContent = ''; } catch (err) { document.getElementById('publishPromptStatus').textContent = '读取失败：' + err.message; }
}
function closePublishPrompt() { document.getElementById('publishPromptModal').classList.add('hidden'); publishPromptProject = null; }
async function savePublishPrompt(reset) {
  const project = publishPromptProject; if (!project || project !== activeProjectId) { document.getElementById('publishPromptStatus').textContent = '工程已切换，请关闭后重新打开。'; return; }
  const status = document.getElementById('publishPromptStatus'); status.textContent = '正在保存…';
  try { const res = await fetch('/api/publish/prompt?project=' + encodeURIComponent(project), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reset ? {reset:true} : {prompt:document.getElementById('publishPrompt').value})}); const data = await res.json(); if (!res.ok) throw new Error(data.error); if (publishPromptProject !== project) return; document.getElementById('publishPrompt').value = data.prompt; status.textContent = reset ? '已恢复默认提示词。' : '提示词已保存到当前工程。'; } catch (err) { status.textContent = '保存失败：' + err.message; }
}

let localizationData = {sourceLanguage:'zh-Hans', master:'', languages:{}};
let localizationSelected = 'en';
let localizationProject = '';
function captureLocalization() {
  if (!localizationProject) return;
  const current = localizationData.languages[localizationSelected] || {};
  localizationData.languages[localizationSelected] = {...current,
    title:document.getElementById('localizationTitle').value,
    description:document.getElementById('localizationDescription').value,
    captions:document.getElementById('localizationCaptions').value,
    metaStatus:document.getElementById('localizationMetaStatus').value,
    captionStatus:document.getElementById('localizationCaptionStatus').value};
  localizationData.sourceLanguage = document.getElementById('localizationSourceLanguage').value;
}
function displayLocalization() {
  const data = localizationData.languages[localizationSelected] || {};
  document.getElementById('localizationLanguage').value = localizationSelected;
  document.getElementById('localizationSourceLanguage').value = localizationData.sourceLanguage || 'zh-Hans';
  document.getElementById('localizationTitle').value = data.title || '';
  document.getElementById('localizationDescription').value = data.description || '';
  document.getElementById('localizationCaptions').value = data.captions || '';
  document.getElementById('localizationMetaStatus').value = data.metaStatus || 'draft';
  document.getElementById('localizationCaptionStatus').value = data.captionStatus || 'draft';
  document.getElementById('localizationMasterStatus').textContent = localizationData.master ? '已保存字幕母版；更换母版后请重新检查译文。' : '尚未保存母版';
}
function setLocalizationStatus(message, { tone = 'muted', toast = false, includeGenerate = false } = {}) {
  const toneClass = tone === 'error' ? 'text-danger' : tone === 'success' ? 'text-ok' : 'text-ink-muted';
  const statusEl = document.getElementById('localizationStatus');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = 'text-sm ' + toneClass;
  }
  if (includeGenerate) {
    const genEl = document.getElementById('localizationGenerateStatus');
    if (genEl) {
      genEl.textContent = message;
      genEl.className = 'text-xs ' + toneClass;
    }
  }
  if (toast && message && typeof showToast === 'function') showToast(message);
}
async function loadLocalization(project, request) {
  localizationProject = '';
  const genEl = document.getElementById('localizationGenerateStatus');
  if (genEl) genEl.textContent = '';
  try {
    const response = await fetch('/api/publish/localizations?project=' + encodeURIComponent(project), {cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    if (project !== activeProjectId || request !== publishRequest) return;
    localizationData = {sourceLanguage:data.sourceLanguage || 'zh-Hans', master:data.master || '', languages:data.languages || {}};
    localizationProject = project; localizationSelected = 'en'; displayLocalization();
    setLocalizationStatus('状态由你手动标记；此处不会自动发布多语言资料。');
  } catch (err) { if (project === activeProjectId && request === publishRequest) setLocalizationStatus('读取多语言资料失败：' + err.message, { tone: 'error' }); }
}
function switchLocalizationLanguage() { captureLocalization(); localizationSelected = document.getElementById('localizationLanguage').value; displayLocalization(); }
async function persistLocalization(project, data) {
  const response = await fetch('/api/publish/localizations?project=' + encodeURIComponent(project), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '保存失败');
}
async function saveLocalization() {
  if (!localizationProject || localizationProject !== activeProjectId) {
    setLocalizationStatus('当前工程的多语言资料尚未加载完成，请稍后重试。', { tone: 'error', toast: true });
    return;
  }
  captureLocalization(); const project = localizationProject;
  try { await persistLocalization(project, localizationData); if (project === activeProjectId) setLocalizationStatus('多语言资料已保存到当前工程。', { tone: 'success', toast: true }); }
  catch (err) { if (project === activeProjectId) setLocalizationStatus('保存失败：' + err.message, { tone: 'error', toast: true }); }
}
async function checkSrt(captions) {
  const video = document.getElementById('publishVideo');
  const response = await fetch('/api/publish/check-srt?project=' + encodeURIComponent(activeProjectId), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({captions,duration:Number.isFinite(video.duration) ? video.duration : 0})});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '字幕检查失败'); return data;
}
async function freezeLocalizationMaster() {
  const project = activeProjectId;
  const captions = document.getElementById('publishCaptions').value.trim();
  try {
    const checked = await checkSrt(captions);
    if (project !== activeProjectId || project !== localizationProject) {
      setLocalizationStatus('工程切换或尚未加载完成，请稍后重试。', { tone: 'error', toast: true });
      return;
    }
    if (localizationData.master && localizationData.master !== captions && !confirm('更换母版后，已有翻译可能需要重新检查。确定保存新母版吗？')) return;
    captureLocalization(); localizationData.master = captions;
    await persistLocalization(project, localizationData);
    if (project !== activeProjectId) return;
    displayLocalization();
    setLocalizationStatus('字幕母版已保存（' + checked.count + ' 段）。' + (checked.warnings.length ? '提醒：' + checked.warnings.slice(0, 5).join('；') : '请确认内容已人工校对。'), { tone: 'success', toast: true });
  } catch (err) { if (project === activeProjectId) setLocalizationStatus('母版未保存：' + err.message, { tone: 'error', toast: true }); }
}
async function generateLocalization(kind) {
  const project = activeProjectId, language = localizationSelected;
  if (!project || localizationProject !== project) {
    setLocalizationStatus('当前工程的多语言资料尚未加载完成，请稍后重试或刷新页面。', { tone: 'error', toast: true, includeGenerate: true });
    return;
  }
  captureLocalization();
  const current = localizationData.languages[language] || {};
  if ((kind === 'metadata' ? current.title || current.description : current.captions) && !confirm('生成结果将覆盖当前语言对应内容，确定继续吗？')) return;
  if (kind === 'metadata' && (!document.getElementById('publishTitle').value.trim() || !document.getElementById('publishDescription').value.trim())) {
    setLocalizationStatus('请先填写上方原版「视频标题」和「视频简介」。', { tone: 'error', toast: true, includeGenerate: true });
    return;
  }
  if (kind === 'captions' && !localizationData.master) {
    setLocalizationStatus('请先点击「保存已校对字幕母版」后再翻译字幕。', { tone: 'error', toast: true, includeGenerate: true });
    return;
  }
  const original = JSON.stringify(kind === 'metadata' ? [current.title, current.description] : current.captions);
  const button = document.getElementById(kind === 'metadata' ? 'localizationGenerateMeta' : 'localizationGenerateCaptions');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '⏳ 正在生成…';
  setLocalizationStatus('正在生成，请稍候；长字幕需要分批处理。', { includeGenerate: true });
  try {
    const body = {kind, language, title:document.getElementById('publishTitle').value, description:document.getElementById('publishDescription').value, captions:localizationData.master};
    const response = await fetch('/api/publish/localize?project=' + encodeURIComponent(project), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '生成失败');
    if (project !== activeProjectId || language !== localizationSelected || localizationProject !== project) { showToast('工程或语言已切换，生成结果未应用'); return; }
    const now = JSON.stringify(kind === 'metadata' ? [document.getElementById('localizationTitle').value, document.getElementById('localizationDescription').value] : document.getElementById('localizationCaptions').value);
    if (now !== original) { setLocalizationStatus('生成期间内容已修改，结果未覆盖，请重新生成。', { tone: 'error', toast: true, includeGenerate: true }); return; }
    if (kind === 'metadata') { document.getElementById('localizationTitle').value = data.title; document.getElementById('localizationDescription').value = data.description; document.getElementById('localizationMetaStatus').value = 'draft'; }
    else { document.getElementById('localizationCaptions').value = data.captions; document.getElementById('localizationCaptionStatus').value = 'draft'; }
    setLocalizationStatus('生成完成，请人工校对并点击「保存多语言资料」。', { tone: 'success', toast: true, includeGenerate: true });
  } catch (err) { if (project === activeProjectId) setLocalizationStatus('生成失败：' + err.message, { tone: 'error', toast: true, includeGenerate: true }); }
  finally { button.disabled = false; button.textContent = originalLabel; }
}
async function checkLocalizationCaptions() {
  const project = activeProjectId;
  try { const data = await checkSrt(document.getElementById('localizationCaptions').value); if (project === activeProjectId) document.getElementById('localizationStatus').textContent = '字幕格式通过，共 ' + data.count + ' 段。' + (data.warnings.length ? '提醒：' + data.warnings.slice(0, 10).join('；') : '请结合成片检查翻译和断句。'); }
  catch (err) { if (project === activeProjectId) document.getElementById('localizationStatus').textContent = '字幕检查未通过：' + err.message; }
}
async function downloadLocalizationCaptions() {
  const project = activeProjectId, language = localizationSelected, captions = document.getElementById('localizationCaptions').value;
  try { await checkSrt(captions); if (project !== activeProjectId || language !== localizationSelected) return; const url = URL.createObjectURL(new Blob([captions], {type:'application/x-subrip;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = 'captions.' + language + '.srt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  catch (err) { if (project === activeProjectId) document.getElementById('localizationStatus').textContent = '无法下载：' + err.message; }
}
for (const id of ['localizationTitle', 'localizationDescription']) document.getElementById(id).addEventListener('input', () => { document.getElementById('localizationMetaStatus').value = 'draft'; });
document.getElementById('localizationCaptions').addEventListener('input', () => { document.getElementById('localizationCaptionStatus').value = 'draft'; });
