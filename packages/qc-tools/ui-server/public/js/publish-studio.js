let publishRequest = 0;
async function loadPublishProject() {
  const project = activeProjectId;
  const request = ++publishRequest;
  restoreYoutubeUpload(project);
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem('whyvideo_publish_' + project) || '{}'); } catch {}
  document.getElementById('publishTitle').value = draft.title || '';
  document.getElementById('publishDescription').value = draft.description || '';
  document.getElementById('publishTags').value = draft.tags || '';
  const video = document.getElementById('publishVideo');
  const status = document.getElementById('publishVideoStatus');
  video.src = '/output/' + encodeURIComponent(project) + '/final_video_1080p.mp4';
  status.textContent = '正在查找当前工程的最终成片…';
  video.onloadedmetadata = () => { status.textContent = '已载入当前工程的最终成片。'; };
  video.onerror = () => { status.textContent = '未找到可播放的最终成片，请先在视觉分镜台完成最终渲染。'; };
  document.getElementById('publishCover').value = '';
  document.getElementById('publishCoverPreview').classList.add('hidden');
  const captions = document.getElementById('publishCaptions');
  captions.value = '';
  try {
    const response = await fetch('/public/' + encodeURIComponent(project) + '/captions/captions.srt');
    if (response.ok) { const text = await response.text(); if (request === publishRequest) captions.value = text; }
  } catch {}
}
function savePublishDraft() {
  localStorage.setItem('whyvideo_publish_' + activeProjectId, JSON.stringify({title: document.getElementById('publishTitle').value, description: document.getElementById('publishDescription').value, tags: document.getElementById('publishTags').value}));
  showToast('发布资料已保存到此浏览器');
}
function downloadPublishCaptions() {
  const url = URL.createObjectURL(new Blob([document.getElementById('publishCaptions').value], {type:'application/x-subrip'}));
  const a = document.createElement('a'); a.href = url; a.download = 'captions.srt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('publishCover').addEventListener('change', function () {
  const preview = document.getElementById('publishCoverPreview');
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  if (!this.files[0]) { preview.classList.add('hidden'); return; }
  preview.dataset.url = URL.createObjectURL(this.files[0]); preview.src = preview.dataset.url; preview.classList.remove('hidden');
});

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
  const text = await file.text();
  if (project === activeProjectId) { document.getElementById('publishCaptions').value = text; showToast('已载入本地字幕，可编辑并下载'); }
});
const YOUTUBE_TOKEN_KEY = 'whyvideo_youtube_access_token';
let youtubeAccessToken = '';
let youtubeCheckVersion = 0;
function setYoutubeStatus(state, message) {
  const badge = document.getElementById('youtubeSettingsButton');
  const status = document.getElementById('youtubeSettingsStatus');
  const summary = document.getElementById('youtubeConnectionStatus');
  const button = document.getElementById('youtubeConnect');
  badge.textContent = state === 'connected' ? '🟢 YouTube · 已连接' : state === 'checking' ? '⏳ YouTube · 验证中' : state === 'expired' ? '🟠 YouTube · 需重新授权' : '⚙️ YouTube · 未连接';
  badge.className = 'px-4 py-2 rounded-lg border ' + (state === 'connected' ? 'bg-emerald-950 border-emerald-500 text-emerald-300' : 'bg-gray-800 border-gray-600');
  status.textContent = message;
  summary.textContent = message;
  button.textContent = state === 'connected' ? '重新验证' : '验证并连接';
}
function openYoutubeSettings() { document.getElementById('youtubeSettings').classList.remove('hidden'); }
function closeYoutubeSettings() { document.getElementById('youtubeSettings').classList.add('hidden'); }
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
      if (response.status === 401) { youtubeAccessToken = ''; setYoutubeStatus('expired', '令牌无效或已过期，请重新获取后验证。'); return; }
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
    setYoutubeStatus('connected', '已连接频道：' + channel.snippet.title);
  } catch (err) {
    if (version === youtubeCheckVersion) { youtubeAccessToken = ''; setYoutubeStatus('disconnected', '验证失败：' + err.message + '。请检查网络或授权后重试。'); }
  } finally { if (version === youtubeCheckVersion) button.disabled = false; }
}
function disconnectYoutube() {
  ++youtubeCheckVersion;
  youtubeAccessToken = ''; localStorage.removeItem(YOUTUBE_TOKEN_KEY);
  document.getElementById('youtubeToken').value = '';
  document.getElementById('youtubeConnect').disabled = false;
  setYoutubeStatus('disconnected', '已断开连接并删除此浏览器中保存的令牌。');
}
try {
  const savedYoutubeToken = localStorage.getItem(YOUTUBE_TOKEN_KEY);
  if (savedYoutubeToken) { document.getElementById('youtubeToken').value = savedYoutubeToken; void connectYoutube(); }
} catch { setYoutubeStatus('disconnected', '无法读取浏览器保存的令牌。'); }

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
async function uploadYoutubeVideo() {
  if (youtubeUploadBusy) return;
  const project = activeProjectId;
  const title = document.getElementById('publishTitle').value.trim();
  const description = document.getElementById('publishDescription').value.trim();
  const tags = document.getElementById('publishTags').value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean);
  const tagsLength = tags.map(tag => tag.includes(' ') ? '"' + tag + '"' : tag).join(',').length;
  const audience = document.getElementById('youtubeAudience').value;
  const privacy = document.getElementById('youtubePrivacy').value;
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
    const cover = document.getElementById('publishCover').files[0] || null;
    const captions = document.getElementById('publishCaptions').value.trim();
    const language = document.getElementById('youtubeCaptionLanguage').value.trim();
    if (captions && !language) throw new Error('请填写字幕语言代码。');
    uploadMessage('正在创建 YouTube 上传任务…');
    const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method:'POST', headers:{...youtubeHeaders(),'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type || 'video/mp4','X-Upload-Content-Length':String(file.size)},
      body: JSON.stringify({snippet:{title,description,tags,categoryId:'27'},status:{privacyStatus:privacy,selfDeclaredMadeForKids:audience==='yes'}})
    });
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
      const r = await fetch('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + encodeURIComponent(job.videoId) + '&uploadType=media', {method:'POST',headers:{...youtubeHeaders(),'Content-Type':job.cover.type || 'image/jpeg'},body:job.cover});
      if (!r.ok) throw new Error(await youtubeError(r)); job.coverDone = true;
    } catch (err) { failures.push('封面：' + err.message); }
  }
  if (!job.captionsDone && job.captions) {
    try {
      uploadMessage('视频已上传，正在上传字幕…');
      const boundary = 'whyvideo_' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({snippet:{videoId:job.videoId,language:job.language,name:'中文字幕',isDraft:false}});
      const body = new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: application/octet-stream\r\n\r\n',job.captions,'\r\n--'+boundary+'--\r\n']);
      const r = await fetch('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart', {method:'POST',headers:{...youtubeHeaders(),'Content-Type':'multipart/related; boundary='+boundary},body});
      if (!r.ok) throw new Error(await youtubeError(r)); job.captionsDone = true;
    } catch (err) { failures.push('字幕：' + err.message); }
  }
  sessionStorage.setItem('whyvideo_uploaded_' + job.project, JSON.stringify({videoId:job.videoId,coverDone:job.coverDone,captionsDone:job.captionsDone}));
  document.getElementById('youtubeRetryAssets').classList.toggle('hidden', job.coverDone && job.captionsDone);
  uploadMessage(failures.length ? '视频已上传；' + failures.join('；') + '。可重试失败项目。' : '视频及所选封面、字幕已上传。YouTube 仍可能需要时间处理视频。');
}
async function retryYoutubeAssets() {
  if (youtubeUploadBusy || !youtubeAssetVideo || youtubeAssetVideo.project !== activeProjectId) return;
  if (!youtubeAccessToken) { uploadMessage('请先连接 YouTube 账号。'); return; }
  youtubeAssetVideo.cover = document.getElementById('publishCover').files[0] || youtubeAssetVideo.cover;
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
