import fs from 'fs';
import { BAILIAN_MODEL, BAILIAN_VOICE, bailianBaseUrl, validateBailianVoice } from '../../synthesize-bailian.mjs';
import { readSharedServices, saveSharedServices } from '../lib/shared-services.mjs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { generateAiBgmPlan } from '../../bgm-ai.mjs';
import {
  getPaths,
  readBody,
  normalizePromptConfig,
  renderJobs,
  voiceJobs,
  voiceJobControllers,
  bgmAiJobs,
} from '../lib/config.mjs';
import { recompileProject } from '../lib/project-store.mjs';
import { callOpenRouterText } from '../lib/llm-gateway.mjs';
import { runProjectRenderJob, runVoiceboxJob, runElevenlabsFullJob, runBailianJob } from '../lib/jobs-service.mjs';
import { projectRenderPaths, DEFAULT_RENDER_CONCURRENCY } from '../../render-project.mjs';
import { getSharedBgmDirectory } from '../../project-paths.mjs';
import { getVoiceboxProfiles } from '../../synthesize-voicebox.mjs';
import { buildElevenlabsTtsPayload } from '../../synthesize-elevenlabs.mjs';
import { probeDurationMs, scenesText } from '../../narration-timing.mjs';
import {
  ALLOWED_AUDIO_EXTS,
  BGM_PUBLIC_SUBDIR,
  buildBgmAudit,
  buildBgmPlaylist,
  buildDeterministicSegments,
  deleteBgmTrackAnalysis,
  ensureProjectBgmFile,
  findDuplicateSharedBgmFile,
  findTrackAnalysisInCache,
  loadBgmAnalysisCache,
  loadBgmConfig,
  normalizeBgmSegments,
  normalizeBgmSettings,
  parseBgmAnalysisJson,
  resolveBgmTrackDiskPath,
  saveBgmConfig,
} from '../../bgm-manager.mjs';

// 10.5 AI 自适应 BGM 工作台后端接口
const resolveBgmGatewayLabel = (baseUrl = '') => {
  const lower = String(baseUrl || '').toLowerCase();
  if (lower.includes('googleapis.com')) return 'Gemini Official';
  if (lower.includes('openrouter.ai')) return 'OpenRouter';
  try {
    return new URL(baseUrl).hostname || 'Custom Gateway';
  } catch (e) {
    return 'Custom Gateway';
  }
};

const safeRecompileBgmProject = (curPaths, targetProj) => {
  if (fs.existsSync(curPaths.manifestPath) && fs.existsSync(curPaths.assetIndexPath)) {
    try {
      recompileProject(targetProj);
      return true;
    } catch (err) {
      console.warn('[BGM Recompile Warning]', err.message);
    }
  }
  return false;
};

const loadBgmProjectContext = (targetProj) => {
  projectRenderPaths(targetProj);
  const curPaths = getPaths(targetProj);
  let manifest = {};
  if (fs.existsSync(curPaths.manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    } catch (e) {}
  }
  let promptCfg = {};
  if (fs.existsSync(curPaths.promptConfigPath)) {
    try {
      promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8'));
    } catch (e) {}
  }
  const normalizedCfg = normalizePromptConfig(promptCfg);
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const totalDurationMs = Math.max(
    Number(manifest?.total_duration_ms) || 0,
    scenes.length > 0 ? Number(scenes[scenes.length - 1]?.end_ms) || 0 : 0
  );
  return { curPaths, manifest, normalizedCfg, scenes, totalDurationMs };
};

const buildBgmApiResponse = (targetProj, configOverride = null, extra = {}) => {
  const { curPaths, manifest, normalizedCfg, scenes, totalDurationMs } = loadBgmProjectContext(targetProj);
  const config = configOverride || loadBgmConfig(curPaths.projectDir, curPaths.publicDir);
  const analysisCache = loadBgmAnalysisCache(curPaths.projectDir, getSharedBgmDirectory());
  const tracksWithUrl = (config.tracks || []).map((tr) => {
    let mtimeMs;
    const diskPath = resolveBgmTrackDiskPath(curPaths.publicDir, tr.src, getSharedBgmDirectory());
    if (diskPath) {
      try { mtimeMs = fs.statSync(diskPath).mtimeMs; } catch {}
    }
    const hit = findTrackAnalysisInCache(analysisCache, {
      fileName: tr.file_name,
      src: tr.src,
      size: tr.size_bytes,
      mtimeMs,
      model: normalizedCfg.bgmModel,
      baseUrl: normalizedCfg.baseUrl,
    });
    return {
      ...tr,
      url: `/public/${encodeURIComponent(targetProj)}/${tr.src}`,
      analysis: hit?.analysis || null,
    };
  });
  const computedAudit = buildBgmAudit(config, manifest, {
    modelUsed: config.audit?.model_used || 'deterministic',
  });
  if (config.audit?.summary && config.audit?.model_used && config.audit.model_used !== 'deterministic') {
    computedAudit.model_summary = config.audit.model_summary || config.audit.summary;
  }
  return {
    ok: true,
    projectId: targetProj,
    config: {
      ...config,
      playlist: config.multi_track ? buildBgmPlaylist(config.tracks, config.segments, totalDurationMs, 30, config.ai_plan?.track_order || []).map(c => ({ ...c, start_ms: Math.round(c.start_frame * 1000 / 30) })) : [],
      tracks: tracksWithUrl,
      audit: computedAudit,
    },
    modelInfo: {
      baseUrl: normalizedCfg.baseUrl,
      bgmModel: normalizedCfg.bgmModel,
      providerLabel: resolveBgmGatewayLabel(normalizedCfg.baseUrl),
      hasApiKey: Boolean(normalizedCfg.apiKey || process.env.OPENROUTER_API_KEY),
    },
    totalDurationMs,
    scenesCount: scenes.length,
    ...extra,
  };
};

export async function handleAudioRenderRoutes(req, res, { pathname, queryProject }) {
  if (req.method === 'GET' && pathname === '/api/render-status') {
    if (req.user && !req.accountStore.canReadProject(req.user, queryProject)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无权访问此工程' }));
    }
    projectRenderPaths(queryProject);
    const job = renderJobs.get(queryProject) || { projectId: queryProject, status: 'idle' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, job }));
  }

  if (req.method === 'POST' && pathname === '/api/render-project') {
    const body = await readBody(req);
    const projectId = body.projectId || queryProject;
    if (req.user && !req.accountStore.canWriteProject(req.user, projectId)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无权修改此工程' }));
    }
    projectRenderPaths(projectId);
    const existing = renderJobs.get(projectId);
    const activeVoice = voiceJobs.get(projectId);
    if (activeVoice?.useAsNarration && ['queued', 'generating'].includes(activeVoice.status)) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '当前工程正在生成旁白，请等待完成后再渲染' }));
    }
    if (existing && ['preparing', 'rendering'].includes(existing.status)) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '这个工程已有渲染任务在运行', job: existing }));
    }
    if ([...renderJobs.values()].some(job => ['preparing', 'rendering'].includes(job.status))) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '服务器正在渲染其他视频，请稍后重试' }));
    }
    const job = {
      projectId,
      preview: Boolean(body.preview),
      burnCaptions: Boolean(body.burnCaptions),
      concurrency: Number(body.concurrency) || DEFAULT_RENDER_CONCURRENCY,
      status: 'preparing',
      startedAt: new Date().toISOString(),
      log: '',
    };
    renderJobs.set(projectId, job);
    void runProjectRenderJob(job);
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, job }));
  }

  if (pathname === '/api/bailian/config') {
    const respond = (code, data) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); return res.end(JSON.stringify(data)); };
    const canManage = !req.user || req.user.role === 'superuser';
    if (req.method === 'POST') {
      if (!canManage) return respond(403, {error:'百炼配置由超级用户管理'});
      const body = await readBody(req);
      try {
        bailianBaseUrl(body.workspaceId || '');
        saveSharedServices({bailianApiKey:body.apiKey || '', bailianWorkspaceId:body.workspaceId || ''});
      } catch { return respond(400, {error:'百炼配置无效，请检查业务空间 ID'}); }
    } else if (req.method !== 'GET') return respond(405, {});
    const config = readSharedServices();
    return respond(200, {apiKeyConfigured:Boolean(config.bailianApiKey), workspaceId:config.bailianWorkspaceId || '', canManage, modelId:BAILIAN_MODEL, voiceId:BAILIAN_VOICE});
  }

  if (req.method === 'GET' && pathname === '/api/voicebox/profiles') {
    const profiles = await getVoiceboxProfiles();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, profiles: profiles.map(({ id, name, language }) => ({ id, name, language })) }));
  }

  if (req.method === 'GET' && pathname === '/api/voicebox/status') {
    projectRenderPaths(queryProject);
    const job = voiceJobs.get(queryProject) || { projectId: queryProject, status: 'idle' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, job }));
  }

  if (req.method === 'POST' && pathname === '/api/voicebox/cancel') {
    const body = await readBody(req).catch(() => ({}));
    const projectId = body.projectId || queryProject;
    projectRenderPaths(projectId);
    const controller = voiceJobControllers.get(projectId);
    const job = voiceJobs.get(projectId);
    if (controller) controller.abort();
    if (job && ['queued', 'generating'].includes(job.status)) {
      job.status = 'cancelled';
      job.error = '已手动取消配音任务';
      job.finishedAt = new Date().toISOString();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, job: job || { projectId, status: 'idle' } }));
  }

  if (req.method === 'POST' && pathname === '/api/elevenlabs/voices') {
    const body = await readBody(req).catch(() => ({}));
    const effectiveKey = String(body.apiKey || '').trim() || process.env.ELEVENLABS_API_KEY;
    if (!effectiveKey) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先输入 ElevenLabs API Key（或在根目录 .env 中写入 ELEVENLABS_API_KEY）' }));
    }

    const categoryRank = { cloned: 0, professional: 1, generated: 2, premade: 4 };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'xi-api-key': effectiveKey,
        },
        signal: controller.signal,
      });
      const rawText = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {}

      if (!response.ok) {
        const detailMsg = parsed?.detail?.message || parsed?.detail || parsed?.error || rawText || `HTTP ${response.status}`;
        res.writeHead(response.status >= 400 && response.status < 600 ? response.status : 502, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        return res.end(JSON.stringify({ ok: false, error: `拉取 ElevenLabs 音色失败: ${detailMsg}` }));
      }

      const rawVoices = Array.isArray(parsed?.voices) ? parsed.voices : [];
      const voices = rawVoices
        .map((v) => ({
          voice_id: String(v.voice_id || ''),
          name: String(v.name || '未命名音色'),
          category: String(v.category || 'other').toLowerCase(),
          labels: v.labels && typeof v.labels === 'object' ? v.labels : {},
          preview_url: v.preview_url ? String(v.preview_url) : '',
          description: v.description ? String(v.description) : '',
        }))
        .filter((v) => v.voice_id)
        .sort((a, b) => {
          const ra = Object.prototype.hasOwnProperty.call(categoryRank, a.category) ? categoryRank[a.category] : 3;
          const rb = Object.prototype.hasOwnProperty.call(categoryRank, b.category) ? categoryRank[b.category] : 3;
          if (ra !== rb) return ra - rb;
          return a.name.localeCompare(b.name, 'zh-CN');
        });

      const customCount = voices.filter((v) => v.category !== 'premade').length;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, voices, customCount, totalCount: voices.length }));
    } catch (err) {
      const isTimeout = err?.name === 'AbortError';
      res.writeHead(isTimeout ? 504 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: isTimeout ? '连接 ElevenLabs 超时（15s），请检查网络或代理' : `拉取 ElevenLabs 音色异常: ${err.message}` }));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 10. 配音合成接口 (ElevenLabs / Voicebox)
  if (req.method === 'POST' && pathname === '/api/synthesize-voice') {
    const body = await readBody(req);
    const {
      projectId = queryProject,
      provider = 'elevenlabs',
      voiceId = '',
      modelId = 'eleven_v4',
      stability,
      similarityBoost,
      languageCode,
      apiKey,
      text,
      sceneId,
    } = body;
    const fullScript = Boolean(body.fullScript);
    const useAsNarration = Boolean(body.useAsNarration || fullScript);
    projectRenderPaths(projectId);
    const curPaths = getPaths(projectId);
    fs.mkdirSync(curPaths.audioDir, { recursive: true });

    if (provider === 'bailian') {
      const respond = (code, data) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify(data)); };
      const config = readSharedServices();
      const key = String(apiKey || config.bailianApiKey || '').trim();
      const selectedModel = body.modelId || BAILIAN_MODEL, selectedVoice = body.voiceId || BAILIAN_VOICE;
      const workspaceId = body.workspaceId || config.bailianWorkspaceId || '';
      try { validateBailianVoice(selectedModel, selectedVoice); bailianBaseUrl(workspaceId); }
      catch (err) { return respond(400, {ok:false, error:err.message}); }
      if (!key) return respond(400, {ok:false, error:'请先在配音引擎配置中保存百炼 API Key，或配置 DASHSCOPE_API_KEY'});
      const existing = voiceJobs.get(projectId);
      if (existing && ['queued','generating'].includes(existing.status)) return respond(409, {ok:false, error:'这个工程已有配音任务在运行', job:existing});
      if (useAsNarration && ['preparing','rendering'].includes(renderJobs.get(projectId)?.status)) return respond(409, {ok:false, error:'当前工程正在渲染，请完成后再替换旁白'});
      if (useAsNarration && !fs.existsSync(curPaths.manifestPath)) return respond(400, {ok:false, error:'工程缺少镜头清单'});
      const fullText = fullScript ? scenesText(JSON.parse(fs.readFileSync(curPaths.manifestPath,'utf8')).scenes || []) : String(text || '');
      if (!fullText.trim()) return respond(400, {ok:false, error:'请输入配音文本'});
      const job = {projectId, provider, fullScript, useAsNarration, status:'queued', progressText:'正在准备百炼配音…', startedAt:new Date().toISOString()};
      voiceJobs.set(projectId, job);
      void runBailianJob(job, {fullText, apiKey:key, workspaceId, modelId:selectedModel, voiceId:selectedVoice});
      return respond(202, {ok:true, job});
    }

    if (!['elevenlabs', 'voicebox'].includes(provider)) { res.writeHead(400); return res.end(JSON.stringify({ok:false,error:'不支持的配音提供商'})); }
    if (fullScript) {
      if (!fs.existsSync(curPaths.manifestPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '工程缺少镜头清单，请先导入文案或创建分镜' }));
      }
      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const fullText = scenesText(manifest.scenes || []);
      if (!fullText.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '当前工程分镜文案为空，无法生成全片旁白' }));
      }
      const existing = voiceJobs.get(projectId);
      if (existing && ['queued', 'generating'].includes(existing.status)) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '这个工程已有配音任务正在运行', job: existing }));
      }
      const activeRender = renderJobs.get(projectId);
      if (['preparing', 'rendering'].includes(activeRender?.status)) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '当前工程正在渲染，请完成后再替换旁白音频' }));
      }

      if (provider === 'elevenlabs') {
        const effectiveKey = String(apiKey || '').trim() || process.env.ELEVENLABS_API_KEY;
        if (!effectiveKey) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '未配置 ElevenLabs API Key。请在操作界面中输入或在根目录 .env 中写入 ELEVENLABS_API_KEY=xxx' }));
        }
        const selectedVoiceId = String(voiceId || '').trim();
        if (!selectedVoiceId) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '请先拉取并选择一个 ElevenLabs 音色' }));
        }
        const job = {
          projectId,
          provider: 'elevenlabs',
          useAsNarration: true,
          fullScript: true,
          status: 'queued',
          progressText: '正在准备用 ElevenLabs 生成全片旁白…',
          startedAt: new Date().toISOString(),
        };
        voiceJobs.set(projectId, job);
        void runElevenlabsFullJob(job, {
          fullText,
          voiceId: selectedVoiceId,
          modelId: String(modelId || 'eleven_v4').trim(),
          stability,
          similarityBoost,
          languageCode,
          apiKey: effectiveKey,
        });
        res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, job }));
      } else if (provider === 'voicebox') {
        const job = {
          projectId,
          provider: 'voicebox',
          profileId: body.profileId || null,
          useAsNarration: true,
          fullScript: true,
          status: 'queued',
          progressText: '已提交至本地 Voicebox，准备生成全片旁白…',
          startedAt: new Date().toISOString(),
        };
        voiceJobs.set(projectId, job);
        void runVoiceboxJob(job, fullText);
        res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, job }));
      }
    }

    if (provider === 'elevenlabs') {
      const effectiveKey = String(apiKey || '').trim() || process.env.ELEVENLABS_API_KEY;
      if (!effectiveKey) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '未配置 ElevenLabs API Key。请在操作界面中输入或在根目录 .env 中写入 ELEVENLABS_API_KEY=xxx' }));
      }
      const selectedVoiceId = String(voiceId || '').trim();
      if (!selectedVoiceId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '请先拉取并选择一个 ElevenLabs 音色' }));
      }

      const safeSceneId = String(sceneId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const outFileName = `${safeSceneId ? `voice_${safeSceneId}` : 'narration'}_${randomUUID()}.mp3`;
      const outFilePath = path.join(curPaths.audioDir, outFileName);

      const ttsPayload = buildElevenlabsTtsPayload({
        text: text || '这是来自 WhyVideo 操作界面的测试旁白音频。',
        modelId: String(modelId || 'eleven_v4').trim(),
        stability,
        similarityBoost,
        languageCode,
      });

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(selectedVoiceId)}`, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': effectiveKey,
        },
        body: JSON.stringify(ttsPayload),
      });

      if (!response.ok) {
        const errText = await response.text();
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: `ElevenLabs 接口调用失败: ${errText}` }));
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(outFilePath, Buffer.from(arrayBuffer));

      const publicAudioUrl = `/public/${projectId}/audio/${outFileName}`;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, audioUrl: publicAudioUrl, message: `ElevenLabs 配音已成功保存至 ${outFileName}` }));
    } else if (provider === 'voicebox') {
      if (!String(text || '').trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '请输入配音文本' }));
      }
      const existing = voiceJobs.get(projectId);
      if (existing && ['queued', 'generating'].includes(existing.status)) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '这个工程已有 Voicebox 配音任务在运行', job: existing }));
      }
      if (useAsNarration && !fs.existsSync(curPaths.manifestPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '工程缺少镜头清单，无法设置成片旁白' }));
      }
      const activeRender = renderJobs.get(projectId);
      if (useAsNarration && ['preparing', 'rendering'].includes(activeRender?.status)) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '当前工程正在渲染，请完成后再替换旁白音频' }));
      }
      const job = {
        projectId,
        provider: 'voicebox',
        profileId: body.profileId || null,
        useAsNarration,
        status: 'queued',
        startedAt: new Date().toISOString(),
      };
      voiceJobs.set(projectId, job);
      void runVoiceboxJob(job, String(text));
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, job }));
    }
  }

  if (req.method === 'GET' && pathname === '/api/bgm/state') {
    const payload = buildBgmApiResponse(queryProject);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(payload));
  }

  if (req.method === 'POST' && pathname === '/api/bgm/upload') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const { curPaths, manifest } = loadBgmProjectContext(targetProj);

    const rawName = path.basename(String(body.fileName || '').trim());
    const ext = path.extname(rawName).toLowerCase();
    if (!rawName || !ALLOWED_AUDIO_EXTS.has(ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '仅支持 .mp3 / .wav / .m4a / .ogg / .aac 音频文件' }));
    }

    const matches = String(body.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无效的音频文件内容 (dataUrl)' }));
    }

    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length === 0 || buffer.length > 40 * 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '音频文件大小需在 1B ~ 40MB 之间' }));
    }

    const baseStem = path.basename(rawName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'track';
    fs.mkdirSync(getSharedBgmDirectory(), { recursive: true });
    const existingFile = findDuplicateSharedBgmFile(getSharedBgmDirectory(), buffer);
    const safeFile = existingFile || `bgm_${Date.now()}_${baseStem}${ext}`;
    const sharedDiskPath = path.join(getSharedBgmDirectory(), safeFile);
    if (!existingFile) {
      fs.writeFileSync(sharedDiskPath, buffer);
    }
    const relSrc = `${BGM_PUBLIC_SUBDIR}/${safeFile}`;
    ensureProjectBgmFile(curPaths.publicDir, relSrc, getSharedBgmDirectory());

    const durationMs = probeDurationMs(sharedDiskPath);
    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);
    const existingTrack = config.tracks.find((t) => t.src === relSrc);
    const newTrack = {
      track_id: existingTrack?.track_id || `bgm_${randomUUID().slice(0, 8)}`,
      title: existingTrack?.title || path.basename(rawName, ext) || safeFile,
      file_name: safeFile,
      src: relSrc,
      duration_ms: durationMs > 0 ? durationMs : null,
      size_bytes: buffer.length,
      source_type: 'manual_upload',
      license_status: 'approved',
      scope: 'shared',
      added_at: existingTrack?.added_at || new Date().toISOString(),
    };

    const existingIdx = config.tracks.findIndex((t) => t.src === newTrack.src);
    if (existingIdx >= 0) {
      config.tracks[existingIdx] = newTrack;
    } else {
      config.tracks.push(newTrack);
    }
    config.selected_track_id = newTrack.track_id;
    config.enabled = true;
    config.audit = buildBgmAudit(config, manifest, {
      modelUsed: config.audit?.model_used || 'deterministic',
    });

    const saved = saveBgmConfig(curPaths.projectDir, config);
    const compiledToRenderProps = safeRecompileBgmProject(curPaths, targetProj);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify(
        buildBgmApiResponse(targetProj, saved, {
          uploadedTrack: {
            ...newTrack,
            url: `/public/${encodeURIComponent(targetProj)}/${newTrack.src}`,
          },
          compiledToRenderProps,
        })
      )
    );
  }

  if (req.method === 'POST' && pathname === '/api/bgm/delete-track') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const trackId = String(body.trackId || '').trim();
    const { curPaths, manifest } = loadBgmProjectContext(targetProj);
    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);

    const idx = config.tracks.findIndex((t) => t.track_id === trackId);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '未找到指定 BGM 音轨' }));
    }

    const target = config.tracks[idx];
    deleteBgmTrackAnalysis(target, curPaths.projectDir, getSharedBgmDirectory());
    const sharedRoot = path.resolve(getSharedBgmDirectory());
    const fileName = path.basename(target.src || '');
    if (fileName) {
      const sharedFile = path.resolve(sharedRoot, fileName);
      if (sharedFile.startsWith(sharedRoot + path.sep) && fs.existsSync(sharedFile) && fs.statSync(sharedFile).isFile()) {
        fs.unlinkSync(sharedFile);
      }
    }
    const bgmRoot = path.resolve(curPaths.bgmDir);
    const resolvedFile = path.resolve(curPaths.publicDir, target.src);
    if (resolvedFile.startsWith(bgmRoot + path.sep) && fs.existsSync(resolvedFile) && fs.statSync(resolvedFile).isFile()) {
      fs.unlinkSync(resolvedFile);
    }

    config.tracks.splice(idx, 1);
    if (config.ai_plan?.track_order?.includes(trackId)) config.ai_plan = null;
    if (config.selected_track_id === trackId) {
      config.selected_track_id = config.tracks[0]?.track_id || null;
    }
    if (!config.selected_track_id) {
      config.enabled = false;
    }
    config.audit = buildBgmAudit(config, manifest, {
      modelUsed: config.audit?.model_used || 'deterministic',
    });

    const saved = saveBgmConfig(curPaths.projectDir, config);
    const compiledToRenderProps = safeRecompileBgmProject(curPaths, targetProj);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify(
        buildBgmApiResponse(targetProj, saved, {
          deletedTrackId: trackId,
          compiledToRenderProps,
        })
      )
    );
  }

  if (req.method === 'POST' && pathname === '/api/bgm/clear-track-analysis') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const trackId = String(body.trackId || '').trim();
    const { curPaths } = loadBgmProjectContext(targetProj);
    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);
    const target = config.tracks.find((t) => t.track_id === trackId);
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '未找到指定 BGM 音轨' }));
    }
    deleteBgmTrackAnalysis(target, curPaths.projectDir, getSharedBgmDirectory());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(buildBgmApiResponse(targetProj, config, { clearedTrackId: trackId })));
  }

  if (req.method === 'GET' && pathname === '/api/bgm/auto-status') {
    const job = bgmAiJobs.get(queryProject);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ok:true, job:job || {status:'idle'}}));
  }

  if (req.method === 'POST' && pathname === '/api/bgm/auto') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const {curPaths, manifest, normalizedCfg} = loadBgmProjectContext(targetProj);
    const existing = bgmAiJobs.get(targetProj);
    if (existing?.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ok:false,error:'此工程的 AI 配乐正在进行中。'}));
    }
    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);
    const job = {status:'running',progress:'正在准备音乐与旁白',started_at:new Date().toISOString()};
    bgmAiJobs.set(targetProj, job);
    const model = String(body.bgmModel || normalizedCfg.bgmModel || '').trim();
    const baseUrl = String(body.baseUrl || normalizedCfg.baseUrl || '').trim();
    const apiKey = String(body.apiKey || normalizedCfg.apiKey || process.env.OPENROUTER_API_KEY || '').trim();
    void (async () => {
      try {
        const ai = await generateAiBgmPlan({projectDir:curPaths.projectDir, publicDir:curPaths.publicDir,config,manifest,model,baseUrl,apiKey,sharedBgmDir:getSharedBgmDirectory(),onProgress:p=>{job.progress=p;}});
        const latest = loadBgmConfig(curPaths.projectDir,curPaths.publicDir);
        if (ai.track_order.some(id => !latest.tracks.some(t => t.track_id === id))) throw new Error('分析期间曲库发生变化，请重新生成配乐。');
        latest.ai_plan=ai;
        latest.segments=ai.segments;
        latest.enabled=true;
        latest.multi_track=true;
        latest.selected_track_id=ai.track_order[0];
        latest.audit=buildBgmAudit(latest,manifest,{modelUsed:model});
        saveBgmConfig(curPaths.projectDir,latest);
        job.cachedCount = ai.cached_count ?? 0;
        job.analyzedCount = ai.analyzed_count ?? 0;
        job.compiledToRenderProps=safeRecompileBgmProject(curPaths,targetProj);
        job.status='complete'; job.progress='AI 配乐方案已生成';
      } catch(err) {job.status='error'; job.error=String(err.message || err);}
    })();
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ok:true,job}));
  }

  if (req.method === 'POST' && pathname === '/api/bgm/analyze') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const { curPaths, manifest, normalizedCfg, scenes, totalDurationMs } = loadBgmProjectContext(targetProj);
    if (scenes.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '当前工程尚无镜头清单，请先切分镜头后再分析情绪弧度' }));
    }

    const effectiveModel = String(body.bgmModel || normalizedCfg.bgmModel || 'google/gemini-2.5-flash').trim();
    const effectiveBaseUrl = String(body.baseUrl || normalizedCfg.baseUrl || 'https://openrouter.ai/api/v1').trim();
    const effectiveApiKey = String(body.apiKey || normalizedCfg.apiKey || '').trim();

    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);
    const step = Math.max(1, Math.ceil(scenes.length / 45));
    const sceneDigest = scenes
      .filter((_, idx) => idx % step === 0 || idx === scenes.length - 1)
      .map((s) => ({
        scene_id: s.scene_id,
        chapter_ref: s.chapter_ref || 'section',
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        visual_type: s.visual_type || s.scene_type,
        narration: String(s.narration_text || '').slice(0, 90),
      }));

    const sysPrompt = `你是资深纪录片与知识类视频音乐总监（Music Supervisor）。
  根据提供的【视频标题】与【按时间顺序的镜头台词摘要】，把全片划分为 3~6 个连贯、无空隙、完全覆盖 [0, ${totalDurationMs}] 毫秒的情绪配乐阶段，并给出风格配乐方向建议。
  严格输出合法 JSON（不要 markdown 代码块，不要多余解释），格式如下：
  {
    "segments": [
  {
    "label": "阶段标题（如 01 悬念引入）",
    "start_ms": 0,
    "end_ms": 15000,
    "mood": "情绪与张力概括（6~12字）",
    "energy": "low" | "medium" | "high",
    "target_db": -18,
    "music_style_hint": "具体乐器与律动建议",
    "reason": "结合台词内容的配乐理由"
  }
    ],
    "style_recommendations": [
  {
    "title": "推荐配乐风格方向名称",
    "bpm_range": "90-115 BPM",
    "instrumentation": "主要乐器编排",
    "fit_reason": "为何契合本片叙事与听感"
  }
    ],
    "audit_summary": "一句话总结全片背景音乐混音策略与听感注意事项"
  }`;

    const userPrompt = `【视频标题】：${manifest.title || targetProj}
  【全片总时长】：${totalDurationMs} ms (${(totalDurationMs / 1000).toFixed(1)} 秒)
  【当前配乐设置】：基准音量 ${config.settings.base_volume_db} dB，Ducking ${config.settings.ducking_enabled ? config.settings.ducking_db + ' dB' : '关闭'}
  【镜头摘要（共 ${scenes.length} 镜，采样展示 ${sceneDigest.length} 镜）】：
  ${JSON.stringify(sceneDigest, null, 2)}`;

    let segments = null;
    let styleRecommendations = [];
    let modelAuditSummary = '';
    let usedFallback = false;
    let fallbackReason = '';

    try {
      const aiText = await callOpenRouterText(sysPrompt, userPrompt, {
        model: effectiveModel,
        apiKey: effectiveApiKey,
        baseUrl: effectiveBaseUrl,
        maxTokens: 2500,
      });
      if (!aiText) {
        throw new Error(globalThis.__lastWriterLlmError || '模型返回为空');
      }
      const parsed = parseBgmAnalysisJson(aiText, manifest);
      segments = parsed.segments;
      styleRecommendations = parsed.style_recommendations;
      modelAuditSummary = parsed.audit_note;
    } catch (err) {
      usedFallback = true;
      fallbackReason = String(err.message || err);
      segments = buildDeterministicSegments(manifest);
      styleRecommendations = [
        {
          title: '克制纪实氛围铺底 (Minimal Documentary Bed)',
          bpm_range: '88-105 BPM',
          instrumentation: '温暖钢琴、低频脉冲与柔和弦乐铺底',
          fit_reason: '频段主要避开中文旁白中高频区，长时间解说不易引发听觉疲劳。',
        },
        {
          title: '历史/机制推进律动 (Tension & Pulse)',
          bpm_range: '108-122 BPM',
          instrumentation: '大提琴拨弦、轻打击乐与环境合成器',
          fit_reason: '适合证据拆解与高潮转折段落，配合 Ducking 可兼顾节奏感与台词清晰度。',
        },
      ];
    }

    config.segments = segments;
    config.style_recommendations = styleRecommendations;
    config.audit = buildBgmAudit(config, manifest, {
      modelUsed: usedFallback ? 'deterministic_fallback' : effectiveModel,
    });
    if (modelAuditSummary) {
      config.audit.model_summary = modelAuditSummary;
    }

    const saved = saveBgmConfig(curPaths.projectDir, config);
    const compiledToRenderProps =
      saved.enabled && saved.selected_track_id ? safeRecompileBgmProject(curPaths, targetProj) : false;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify(
        buildBgmApiResponse(targetProj, saved, {
          usedFallback,
          fallbackReason,
          compiledToRenderProps,
        })
      )
    );
  }

  if (req.method === 'POST' && pathname === '/api/bgm/save') {
    const body = await readBody(req);
    const targetProj = body.projectId || queryProject;
    const { curPaths, manifest, totalDurationMs } = loadBgmProjectContext(targetProj);
    const config = loadBgmConfig(curPaths.projectDir, curPaths.publicDir);

    if (body.selected_track_id !== undefined) {
      if (body.selected_track_id === null || body.selected_track_id === '') {
        config.selected_track_id = null;
      } else {
        const exists = config.tracks.some((t) => t.track_id === body.selected_track_id);
        if (!exists) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '所选 BGM 音轨不存在或已被删除' }));
        }
        config.selected_track_id = body.selected_track_id;
      }
    }

    if (body.multi_track !== undefined) config.multi_track = Boolean(body.multi_track);

    if (body.settings && typeof body.settings === 'object') {
      config.settings = normalizeBgmSettings({ ...config.settings, ...body.settings });
    }
    if (Array.isArray(body.segments)) {
      config.segments = normalizeBgmSegments(body.segments, totalDurationMs);
    }

    config.enabled = Boolean(body.enabled) && Boolean(config.selected_track_id);
    config.audit = buildBgmAudit(config, manifest, {
      modelUsed: config.audit?.model_used || 'deterministic',
    });

    const saved = saveBgmConfig(curPaths.projectDir, config);
    const compiledToRenderProps = safeRecompileBgmProject(curPaths, targetProj);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify(
        buildBgmApiResponse(targetProj, saved, {
          saved: true,
          compiledToRenderProps,
        })
      )
    );
  }

  return false;
}
