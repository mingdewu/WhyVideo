import fs from 'fs';
import { normalizePromptConfig } from '../lib/config.mjs';
import { hasProjectEditLease, canDeleteProjectNow, clearProjectEditState } from '../lib/edit-service.mjs';
import { sharedRuntimeConfig } from '../lib/shared-services.mjs';
import path from 'path';
import { rootDir, defaultProjectId, getPaths, readBody, alignJobs } from '../lib/config.mjs';
import { resolveProjectVideoPath } from '../../project-paths.mjs';
import { ensureRemotionStudio, stopRemotionStudio } from '../lib/remotion-studio-service.mjs';
import {
  listProjects,
  getProjectTiming,
  recalculateTimelines,
  ensureTableFields,
  syncTableToManifest,
  recompileProject,
  findProjectAudioPath,
  buildProjectTimingSummary,
} from '../lib/project-store.mjs';
import { extractVisualKeywordsMap, syncLocalProjectAssets } from '../lib/media-gateway.mjs';
import { getMeowloadApiKey, getWriterTavilyKey, callOpenRouterText, extractJsonFromText } from '../lib/llm-gateway.mjs';
import {
  getProducerPromptsState,
  renderProducerPrompt,
  saveProjectProducerPromptPreset,
  resetProjectProducerPromptPreset,
} from '../../producer-prompts.mjs';
import {
  alignNarration,
  buildTimeLookup,
  isSpoken,
  timingPath,
  scenesText,
  sceneSpokenRanges,
} from '../../narration-timing.mjs';
import {
  planCuts,
  resliceSceneTexts,
  splitAtSpokenIndex,
  moveCutTo,
  regroupScenesByKeywords,
  mergeEligibleScenesPass,
  bridgeThreeSentencesToTwoShotsPass,
  refreshSceneKeywordMetadata,
} from '../../cut-planner.mjs';
import { loadBgmConfig } from '../../bgm-manager.mjs';

// Only bounded declarative design data reaches Remotion; model output is never executed.
export function normalizeArtDesign(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.keyframes) || value.keyframes.length < 2 || value.keyframes.length > 12) return null;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v)));
  const ranges = {x:[8,92], y:[10,78], font_size:[28,130], font_weight:[400,900], background_opacity:[0,1], border_width:[0,12], radius:[0,80], padding_x:[0,80], padding_y:[0,50], letter_spacing:[-3,15], glow:[0,60]};
  const out = {};
  const weights = {normal: 400, bold: 700, bolder: 800, lighter: 400};
  for (const [key, range] of Object.entries(ranges)) {
    const raw = key === 'font_weight' && typeof value[key] === 'string'
      ? (weights[value[key].trim().toLowerCase()] ?? value[key]) : value[key];
    if (raw === null || raw === '' || raw === undefined || !Number.isFinite(Number(raw))) return null;
    out[key] = clamp(raw, ...range);
  }
  for (const key of ['text_color','background_color','border_color']) { if (!/^#[0-9a-f]{6}$/i.test(value[key] || '')) return null; out[key] = value[key]; }
  out.keyframes = [];
  for (const frame of value.keyframes) {
    if (!frame || !['at','x','y','scale','rotation','opacity'].every(k => Number.isFinite(Number(frame[k])))) return null;
    out.keyframes.push({at:clamp(frame.at,0,1), x:clamp(frame.x,-1000,1000), y:clamp(frame.y,-600,600), scale:clamp(frame.scale,0.1,3), rotation:clamp(frame.rotation,-90,90), opacity:clamp(frame.opacity,0,1)});
  }
  if (out.keyframes[0].at !== 0 || out.keyframes.at(-1).at !== 1 || out.keyframes.some((f,i) => i > 0 && f.at <= out.keyframes[i-1].at)) return null;
  return out;
}

const autoPlanProgressMap = globalThis.__whyvideoAutoPlanProgressMap || (globalThis.__whyvideoAutoPlanProgressMap = new Map());

export async function handleProducerRoutes(req, res, { url, pathname, queryProject, paths }) {
  // 全文艺术字：先生成可编辑提案，应用时才修改镜头。
  if (req.method === 'POST' && pathname === '/api/producer/art-text/generate') {
    const body = await readBody(req);
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    const scenes = (manifest.scenes || []).filter(s => s.narration_text && s.duration_ms > 0);
    if (!scenes.length) { res.writeHead(400); return res.end(JSON.stringify({error: '请先生成带旁白的分镜'})); }
    const cfg = normalizePromptConfig(fs.existsSync(paths.promptConfigPath) ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')) : {});
    const input = scenes.map(s => ({id: s.scene_id, text: s.narration_text, duration: Math.round(s.duration_ms / 100) / 10}));
    // Keep the full story available for context, but distribute detailed design output
    // across bounded sections so a long video is not limited to one response.
    const chunks = [];
    for (let i = 0; i < scenes.length; i += 12) chunks.push(scenes.slice(i, i + 12));
    const prompt = renderProducerPrompt(paths.projectDir, 'P7_art_director');
    const creativeRequest = String(body.creative_request || '').slice(0, 1000);
    const responses = new Array(chunks.length);
    let nextChunk = 0;
    async function generateSection() {
      while (nextChunk < chunks.length) {
        const sectionIndex = nextChunk++;
        const section = chunks[sectionIndex];
        const sectionIds = section.map(s => s.scene_id);
        const response = await callOpenRouterText(prompt, JSON.stringify({creative_request: creativeRequest, full_story: input, section_index: sectionIndex + 1, total_sections: chunks.length, target_scene_ids: sectionIds, instruction: '全文仅供理解上下文。本次只为 target_scene_ids 的镜头生成艺术字，独立考虑本段所有值得强调的内容。允许同一镜头出现多条不同重点。'}), {apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.textModel || cfg.model, maxTokens: 6000});
        if (!response) throw new Error(`第 ${sectionIndex + 1}/${chunks.length} 段生成失败：${globalThis.__lastWriterLlmError || '请检查模型配置'}`);
        const parsed = extractJsonFromText(response);
        if (!Array.isArray(parsed?.items)) throw new Error(`第 ${sectionIndex + 1}/${chunks.length} 段 AI 返回格式不完整，请重试`);
        responses[sectionIndex] = parsed.items.filter(item => sectionIds.includes(item.scene_id));
      }
    }
    try { await Promise.all(Array.from({length: Math.min(3, chunks.length)}, generateSection)); }
    catch (error) { res.writeHead(502); return res.end(JSON.stringify({error: error.message})); }
    const seen = new Set();
    const stats = { returned: responses.flat().length, unmatched: 0, invalid_design: 0, duplicate: 0 };
    const items = responses.flat().flatMap(item => {
      const scene = scenes.find(s => s.scene_id === item.scene_id);
      const text = String(item.text || '').trim().slice(0, 40);
      const anchor = String(item.anchor || '').trim();
      const design = normalizeArtDesign(item.design);
      const key = JSON.stringify([item.scene_id, anchor, text]);
      if (!scene || !text || !anchor || !scene.narration_text.includes(anchor)) { stats.unmatched++; return []; }
      if (!design) { stats.invalid_design++; return []; }
      if (seen.has(key)) { stats.duplicate++; return []; }
      seen.add(key);
      const duration = scene.duration_ms / 1000;
      const estimate = scene.narration_text.indexOf(anchor) / Math.max(1, scene.narration_text.length) * duration;
      return [{scene_id: scene.scene_id, text, anchor, start_sec: Math.round(Math.max(0, Math.min(duration - 0.5, estimate)) * 10) / 10, duration_sec: Math.max(0.5, Math.min(Number(item.duration_sec) || 3, duration)), reason: String(item.reason || '').slice(0, 160), design}];
    });
    if (!items.length && stats.returned) { res.writeHead(422, {'Content-Type': 'application/json; charset=utf-8'}); return res.end(JSON.stringify({error: `AI 返回了 ${stats.returned} 条提案，但未通过检查：${stats.unmatched} 条原文或镜头无法匹配，${stats.invalid_design} 条设计参数不完整，${stats.duplicate} 条重复。`, stats})); }
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok: true, items, stats}));
  }

  if (req.method === 'POST' && pathname === '/api/producer/art-text/apply') {
    const body = await readBody(req);
    if (!Array.isArray(body.items) || body.items.length > 1000) { res.writeHead(400); return res.end(JSON.stringify({error:'提案格式不正确'})); }
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    const projectConfig = fs.existsSync(path.join(paths.dataDir, 'project-config.json')) ? JSON.parse(fs.readFileSync(path.join(paths.dataDir, 'project-config.json'), 'utf8')) : {};
    const fps = Number(projectConfig.video_spec?.fps || 30);
    const additions = [];
    for (const item of body.items) {
      const scene = (manifest.scenes || []).find(s => s.scene_id === item.scene_id);
      const duration = Number(scene?.duration_ms) / 1000;
      const text = String(item.text || '').trim();
      const start = Number(item.start_sec), length = Number(item.duration_sec);
      const design = normalizeArtDesign(item.design);
      if (!scene || !text || text.length > 40 || !Number.isFinite(start) || !Number.isFinite(length) || start < 0 || start >= duration || length <= 0 || !design) {
        res.writeHead(400); return res.end(JSON.stringify({error: '请检查文字、镜头时间和动画设置'}));
      }
      additions.push({scene, overlay: {text, design, reason:String(item.reason || '').slice(0, 160), start_frame:Math.round(start * fps), duration_frames:Math.max(1, Math.min(Math.round(length * fps), Math.round(duration * fps) - Math.round(start * fps))), source:'ai_art_text', anchor:String(item.anchor || '').slice(0, 150)}});
    }
    for (const {scene, overlay} of additions) {
      scene.media_modifiers ||= {};
      scene.media_modifiers.text_overlays ||= [];
      scene.media_modifiers.text_overlays.push(overlay);
    }
    fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(queryProject);
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok:true, count:additions.length}));
  }

  // 0. 工程列表 API
  if (req.method === 'GET' && pathname === '/api/projects') {
    const projects = listProjects().filter(project => !req.user || req.accountStore.canReadProject(req.user, project.id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        currentProjectId: projects.some(project => project.id === queryProject) ? queryProject : projects[0]?.id || null,
        projects,
      })
    );
  }

  // 删除工程
  if (req.method === 'POST' && pathname === '/api/delete-project') {
    const body = await readBody(req);
    const targetProject = String(body.projectId || '').trim();
    if (!/^[\w-]+$/.test(targetProject)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '工程 ID 无效' }));
    }
    if (req.user && !req.accountStore.canWriteProject(req.user, targetProject)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无权删除此工程' }));
    }
    if (req.user) {
      const check = canDeleteProjectNow(req, targetProject);
      if (!check.ok) {
        res.writeHead(check.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: check.error }));
      }
    }
    stopRemotionStudio(targetProject);
    const targetDir = path.join(rootDir, 'projects', targetProject);
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    clearProjectEditState(targetProject, req.accountStore);
    if (req.user) req.accountStore.removeProjectOwner(targetProject);
    const projects = listProjects().filter(project => !req.user || req.accountStore.canReadProject(req.user, project.id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      deletedProjectId: targetProject,
      nextActiveProjectId: projects[0]?.id || null,
      projects,
    }));
  }

  // 0.741 获取视觉分镜台提示词模板与视觉风格预设（按当前工程独立生效）
  if (req.method === 'GET' && pathname === '/api/producer/prompts') {
    const state = getProducerPromptsState(paths.projectDir, queryProject);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(state));
  }

  // 0.742 保存视觉分镜台自定义提示词模板（仅对当前工程生效）
  if (req.method === 'POST' && pathname === '/api/producer/prompts/save') {
    const body = await readBody(req);
    const saved = saveProjectProducerPromptPreset(paths.projectDir, queryProject, body);
    res.writeHead(saved.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(saved));
  }

  // 0.743 重置视觉分镜台提示词模板（支持单阶段或全部恢复出厂默认）
  if (req.method === 'POST' && pathname === '/api/producer/prompts/reset') {
    const body = await readBody(req);
    const resetRes = resetProjectProducerPromptPreset(paths.projectDir, queryProject, body.template_id || null);
    res.writeHead(resetRes.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(resetRes));
  }

  // 1. 获取工作流完整数据
  if (req.method === 'GET' && pathname === '/api/workflow-data') {
    if (!fs.existsSync(paths.manifestPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({ error: `工程 ${queryProject} 尚未生成 scene-manifest.json` })
      );
    }
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    const canWrite = hasProjectEditLease(req, queryProject);
    if (ensureTableFields(manifest) && canWrite) {
      fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }
    const assetIndex = canWrite ? syncLocalProjectAssets(queryProject) : (fs.existsSync(paths.assetIndexPath) ? JSON.parse(fs.readFileSync(paths.assetIndexPath, 'utf8')) : { project_id: queryProject, assets: [] });
    let promptConfig = fs.existsSync(paths.promptConfigPath)
      ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'))
      : {
          selected_visual_model: 'remotion_procedural',
          global_ai_visual_prompt:
            '作为 16:9 纪录片视觉总监，结合旁白片段与关键词，在 16:9 画幅中央提炼一个醒目标志大字（不超过 14 字），搭配 1 条副级阐述，用于动效视觉传达。',
        };
    promptConfig = normalizePromptConfig(promptConfig);
    promptConfig.apiKeyConfigured = Boolean(promptConfig.apiKey);
    promptConfig.tavilyKeyConfigured = Boolean(getWriterTavilyKey(paths.projectDir));
    delete promptConfig.tavilyApiKey;
    promptConfig.meowloadKeyConfigured = Boolean(getMeowloadApiKey(paths.projectDir));
    delete promptConfig.meowloadApiKey;
    if (req.user) delete promptConfig.apiKey;
    if (req.user) delete promptConfig.elevenlabsApiKey;

    let audioFile = null;
    if (fs.existsSync(paths.audioDir)) {
      const audios = fs.readdirSync(paths.audioDir).filter((f) => /\.(mp3|wav)$/i.test(f));
      if (audios.length > 0) audioFile = `/public/${queryProject}/audio/${audios[0]}`;
    }

    const resolvedVideoPath = resolveProjectVideoPath(paths);
    const hasVideo = Boolean(resolvedVideoPath);
    const videoUrl = hasVideo ? `/output/${encodeURIComponent(queryProject)}/${encodeURIComponent(path.basename(resolvedVideoPath))}` : null;
    const bgmCfg = loadBgmConfig(paths.projectDir, paths.publicDir);
    const selectedBgmTrack = bgmCfg.tracks.find((t) => t.track_id === bgmCfg.selected_track_id) || null;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        projectId: queryProject,
        manifest,
        assetIndex,
        promptConfig,
        hasVideo,
        videoUrl,
        audioUrl: audioFile,
        elevenlabsKeyConfigured: Boolean(sharedRuntimeConfig()?.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY),
        timingSummary: buildProjectTimingSummary(queryProject, manifest),
        bgmSummary: {
          enabled: bgmCfg.enabled,
          trackTitle: selectedBgmTrack?.title || null,
          tracksCount: bgmCfg.tracks.length,
        },
      })
    );
  }

  // 2. 保存数据库表格修改并同步至 Remotion
  if (req.method === 'POST' && pathname === '/api/workflow-save') {
    const body = await readBody(req);
    const targetProject = body.projectId || queryProject;
    if (req.user && !req.accountStore.canWriteProject(req.user, targetProject)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '无权修改此工程' }));
    }
    const curPaths = getPaths(targetProject);

    if (body.promptConfig) {
      let previousPromptConfig = {};
      if (fs.existsSync(curPaths.promptConfigPath)) {
        try { previousPromptConfig = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
      }
      fs.writeFileSync(
        curPaths.promptConfigPath,
        JSON.stringify({
          ...previousPromptConfig,
          ...body.promptConfig,
          ...(req.user ? { apiKey: previousPromptConfig.apiKey || '', baseUrl: previousPromptConfig.baseUrl || '' } : {}),
          tavilyApiKey: previousPromptConfig.tavilyApiKey || '',
          meowloadApiKey: previousPromptConfig.meowloadApiKey || '',
        }, null, 2),
        'utf8'
      );
    }
    if (body.manifest) {
      recalculateTimelines(body.manifest, targetProject);
      syncTableToManifest(body.manifest);
      fs.writeFileSync(
        curPaths.manifestPath,
        JSON.stringify(body.manifest, null, 2),
        'utf8'
      );
    }
    recompileProject(targetProject);
    let remotionStudio = { ok: false, projectId: targetProject, url: '/?preview=' + encodeURIComponent(targetProject) };
    try {
      remotionStudio = await ensureRemotionStudio(targetProject);
    } catch (err) {
      remotionStudio = { ok: false, projectId: targetProject, url: '/?preview=' + encodeURIComponent(targetProject), error: err.message };
    }
    const updatedManifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: true,
        manifest: updatedManifest,
        timingSummary: buildProjectTimingSummary(targetProject, updatedManifest),
        remotionStudio,
      })
    );
  }

  // 3. ✂️ 画面切分 (Split Shot / 在指定字前加换画面点)
  if (req.method === 'POST' && pathname === '/api/split-shot') {
    const body = await readBody(req);
    const { sceneIndex, splitCharIndex, splitSpokenOffset, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scenes = manifest.scenes || [];
    const idx = typeof sceneIndex === 'number' ? sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

    if (idx >= 0 && idx < scenes.length) {
      const original = scenes[idx];
      const fullText = original.narration_text || '';

      let splitPos = splitCharIndex;
      if (typeof splitSpokenOffset === 'number' && splitSpokenOffset > 0) {
        let cnt = 0;
        for (let i = 0; i < fullText.length; i++) {
          if (isSpoken(fullText[i])) {
            if (cnt === splitSpokenOffset) {
              splitPos = i;
              break;
            }
            cnt++;
          }
        }
      }
      if (typeof splitPos !== 'number' || splitPos <= 0 || splitPos >= fullText.length) {
        const offset = fullText.length > 12 ? 8 : 2;
        const matchComma = fullText.slice(offset).search(/[，,；;。！？!?]/);
        splitPos = matchComma !== -1 ? offset + matchComma + 1 : Math.floor(fullText.length / 2);
      }

      const text1 = fullText.slice(0, splitPos).trim();
      const text2 = fullText.slice(splitPos).trim();

      if (text1 && text2) {
        const ratio = text1.length / (text1.length + text2.length);
        const origDur = original.duration_ms || 5000;
        const dur1 = Math.max(1500, Math.round(origDur * ratio));
        const dur2 = Math.max(1500, origDur - dur1);

        original.narration_text = text1;
        original.duration_ms = dur1;
        if (original.ppt_slide_spec) {
          original.ppt_slide_spec.subtitle = text1.slice(0, 24);
        }

        const newShot = JSON.parse(JSON.stringify(original));
        newShot.narration_text = text2;
        newShot.duration_ms = dur2;
        delete newShot.cut_offset_ms;
        newShot.ppt_slide_spec = {
          theme_title: text2.slice(0, 10),
          subtitle: text2.slice(0, 24),
          bullet_points: [`要义阐述：${text2.slice(0, 20)}`],
          custom_prompt: '',
        };
        newShot.shared_asset_with_prev = false;

        scenes.splice(idx + 1, 0, newShot);
        recalculateTimelines(manifest, targetProject);
        syncTableToManifest(manifest);

        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        recompileProject(targetProject);

        const actualDur1 = (scenes[idx].duration_ms || dur1) / 1000;
        const actualDur2 = (scenes[idx + 1].duration_ms || dur2) / 1000;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            ok: true,
            manifest,
            timingSummary: buildProjectTimingSummary(targetProject, manifest),
            message: `成功新增换画面点：${actualDur1.toFixed(1)}s 和 ${actualDur2.toFixed(1)}s`,
          })
        );
      }
    }

    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: '切分失败：未找到有效切分点' }));
  }

  // 4. 🔗 画面合并 (Merge Shot with Next / 删掉两个画面之间的切点)
  if (req.method === 'POST' && pathname === '/api/merge-shot') {
    const body = await readBody(req);
    const { sceneIndex, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scenes = manifest.scenes || [];
    const idx = typeof sceneIndex === 'number' ? sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

    if (idx >= 0 && idx < scenes.length - 1) {
      const s1 = scenes[idx];
      const s2 = scenes[idx + 1];

      const t1 = String(s1.narration_text || '').trim();
      const t2 = String(s2.narration_text || '').trim();
      const sep = /[A-Za-z0-9]$/.test(t1) && /^[A-Za-z0-9]/.test(t2) ? ' ' : '';
      s1.narration_text = `${t1}${sep}${t2}`.trim();
      s1.duration_ms = (s1.duration_ms || 5000) + (s2.duration_ms || 5000);
      s1.content_keywords = Array.from(new Set([...(s1.content_keywords || []), ...(s2.content_keywords || [])]));

      if (s1.ppt_slide_spec) {
        s1.ppt_slide_spec.subtitle = s1.narration_text.slice(0, 28);
        s1.ppt_slide_spec.bullet_points = [
          `核心要义：${s1.narration_text.slice(0, 24)}...`,
          `标志关键词：${s1.content_keywords.join(' · ')}`,
        ];
      }

      scenes.splice(idx + 1, 1);
      recalculateTimelines(manifest, targetProject);
      syncTableToManifest(manifest);

      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ok: true,
          manifest,
          timingSummary: buildProjectTimingSummary(targetProject, manifest),
          message: `成功合并两个镜头，总时长为 ${((s1.duration_ms || 0) / 1000).toFixed(1)}s`,
        })
      );
    }

    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: '合并失败：下一镜头不存在' }));
  }

  if (req.method === 'GET' && pathname === '/api/auto-plan-cuts-progress') {
    const jobId = String(url.searchParams.get('jobId') || queryProject || '').trim();
    const job = autoPlanProgressMap.get(queryProject + ':' + jobId) || { percent: 0, text: '准备分析切点...', done: false, error: null };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...job }));
  }

  // 4.0.2 ⚡ 按关键词与停顿智能排切点（支持句中换画面 + 长镜头自动补切点）
  if (req.method === 'POST' && pathname === '/api/auto-plan-cuts') {
    const body = await readBody(req).catch(() => ({}));
    const targetProject = body.projectId || queryProject;
    const jobId = String(body.jobId || targetProject).trim();
    const updateCutProgress = (percent, text, extra = {}) => {
      autoPlanProgressMap.set(targetProject + ':' + jobId, {
        percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
        text: String(text || ''),
        done: Boolean(extra.done),
        error: extra.error || null,
        updatedAt: Date.now(),
      });
    };
    updateCutProgress(5, '正在读取分镜清单与配音时间轴...');
    const curPaths = getPaths(targetProject);

    if (!fs.existsSync(curPaths.manifestPath)) {
      updateCutProgress(0, '缺少镜头清单', { done: true, error: `工程 ${targetProject} 缺少镜头清单` });
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: `工程 ${targetProject} 缺少镜头清单` }));
    }
    if (alignJobs.get(targetProject)) {
      updateCutProgress(0, '时间轴正在对齐中', { done: true, error: '当前工程正在对齐配音时间轴，请稍后再试' });
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '当前工程正在对齐配音时间轴，请稍后再试' }));
    }

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scenes = manifest.scenes || [];
    if (scenes.length < 2) {
      updateCutProgress(0, '镜头数不足', { done: true, error: '镜头数不足 2 个，无需重排切点' });
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '镜头数不足 2 个，无需重排切点' }));
    }

    try {
      let timing = getProjectTiming(targetProject);
      const text = scenesText(scenes);
      if (!timing || buildTimeLookup(timing, text).stale) {
        const audioPath = findProjectAudioPath(curPaths, manifest);
        if (!audioPath) {
          updateCutProgress(0, '缺少配音音频', { done: true, error: '请先生成或上传配音音频，再按声音时间轴排切点' });
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '请先生成或上传配音音频，再按声音时间轴排切点' }));
        }
        alignJobs.set(targetProject, true);
        updateCutProgress(12, '正在用 Whisper 对齐配音时间轴（首次或文案改动后需数秒）...');
        try {
          timing = await alignNarration({ audioPath, scriptText: text });
          fs.writeFileSync(timingPath(curPaths.dataDir), JSON.stringify(timing, null, 2), 'utf8');
          manifest.audio_file = path.relative(curPaths.publicDir, audioPath).split(path.sep).join('/');
        } finally {
          alignJobs.delete(targetProject);
        }
        updateCutProgress(35, '配音时间轴对齐完成，准备分析画面关键词...');
      } else {
        updateCutProgress(25, '配音时间轴已就绪，准备分析画面关键词...');
      }

      const beforeShotCount = scenes.length;
      let keywordsByScene = {};
      let aiKeywordsUsed = false;
      if (body.useAiKeywords !== false) {
        const kwBase = 30;
        const kwSpan = 45;
        const kwRes = await extractVisualKeywordsMap(manifest, curPaths, (doneCount, totalCount) => {
          const ratio = totalCount > 0 ? doneCount / totalCount : 1;
          updateCutProgress(
            kwBase + ratio * kwSpan,
            `正在提炼画面触发关键词 (${doneCount}/${totalCount} 镜)...`
          );
        });
        keywordsByScene = kwRes.map;
        aiKeywordsUsed = kwRes.aiUsed;
      }

      updateCutProgress(78, '正在按关键词与声音停顿计算最佳切点...');
      const minShotMs = Number(body.minShotMs) || 2500;
      const maxShotMs = Number(body.maxShotMs) || 9600;
      const reg = regroupScenesByKeywords(manifest, timing, { keywordsByScene, minShotMs, maxShotMs });
      const plan = planCuts(manifest, timing, { minShotMs, maxShotMs });

      resliceSceneTexts(scenes, plan.newRanges);

      updateCutProgress(86, '正在合并短碎句并切分超长镜头...');
      let splitCount = reg.keywordSplitCount || 0;
      if (body.autoSplitLongShots !== false && plan.splitSuggestions.length > 0) {
        const sortedSplits = [...plan.splitSuggestions].sort((a, b) => b.split_char - a.split_char);
        for (const sp of sortedSplits) {
          const addedIdx = splitAtSpokenIndex(scenes, sp.split_char);
          if (addedIdx >= 0) splitCount++;
        }
      }

      const postMerged = mergeEligibleScenesPass(scenes, timing, { minShotMs, maxShotMs });
      const postBridged = bridgeThreeSentencesToTwoShotsPass(scenes, timing, { minShotMs, maxShotMs });
      const totalMerged = (reg.mergedCount || 0) + postMerged + postBridged;

      for (const s of scenes) {
        refreshSceneKeywordMetadata(s, s.visual_keywords || []);
      }

      updateCutProgress(94, '正在重算时间轴并保存分镜清单...');
      recalculateTimelines(manifest, targetProject);
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      const afterShotCount = scenes.length;
      const timingSummary = buildProjectTimingSummary(targetProject, manifest);
      updateCutProgress(100, `智能排切完成：${beforeShotCount} ➔ ${afterShotCount} 镜`, { done: true });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ok: true,
          manifest,
          timingSummary,
          changes: plan.changes,
          splitCount,
          mergedCount: totalMerged,
          beforeShotCount,
          afterShotCount,
          stats: timingSummary.rhythm || plan.stats,
          aiKeywordsUsed,
          message: `智能排切完成：总镜头 ${beforeShotCount} ➔ ${afterShotCount} 镜（合并同主题/短碎句 ${totalMerged} 处，按多关键词/长镜拆分 ${splitCount} 处，句中/关键词切点对齐 ${plan.changes.length} 处${aiKeywordsUsed ? ' · AI 关键词' : ' · 关键词/停顿规则'}）`,
        })
      );
    } catch (err) {
      updateCutProgress(0, err.message || '智能排切失败', { done: true, error: err.message });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '智能排切失败: ' + err.message }));
    }
  }

  // 4.0.3 ⏪⏩ 挪动换画面点（在相邻两镜之间移动切点，或微调画面提前量）
  if (req.method === 'POST' && pathname === '/api/move-cut') {
    const body = await readBody(req);
    const targetProject = body.projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scenes = manifest.scenes || [];
    const idx = typeof body.sceneIndex === 'number' ? body.sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

    if (idx < 0 || idx >= scenes.length) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无效的镜头索引' }));
    }

    const mode = body.mode || 'move_between';
    let actionMsg = '';

    if (mode === 'offset') {
      const clamped = Math.max(-1000, Math.min(1000, Math.round(Number(body.cutOffsetMs) || 0)));
      scenes[idx].cut_offset_ms = clamped;
      actionMsg = `${scenes[idx].scene_id} 画面提前量已调为 ${clamped}ms`;
    } else {
      if (idx <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '第 1 个镜头没有前一个切点可以挪动' }));
      }
      const sPrev = scenes[idx - 1];
      const sCurr = scenes[idx];
      const prevText = String(sPrev.narration_text || '');
      const currText = String(sCurr.narration_text || '');
      const { ranges } = sceneSpokenRanges(scenes);
      const [pStart, pEnd] = ranges[idx - 1];
      const [cStart, cEnd] = ranges[idx];

      const rawPosToSpoken = (str, rawPos) => {
        let cnt = 0;
        const lim = Math.max(0, Math.min(str.length, rawPos));
        for (let k = 0; k < lim; k++) if (isSpoken(str[k])) cnt++;
        return cnt;
      };

      let targetJ = null;
      if (typeof body.splitInPrevAtChar === 'number') {
        const off = rawPosToSpoken(prevText, body.splitInPrevAtChar);
        if (off <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '至少保留上一镜头的第 1 个字，或者直接点「合并」' }));
        }
        targetJ = pStart + off;
      } else if (typeof body.splitInCurrAtChar === 'number') {
        const off = rawPosToSpoken(currText, body.splitInCurrAtChar);
        if (cStart + off >= cEnd) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '至少保留当前镜头的最后 1 个字' }));
        }
        targetJ = cStart + off;
      } else if (body.step === 'earlier') {
        const prevSpoken = pEnd - pStart;
        if (prevSpoken <= 2) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '上一镜头旁白已太短，不能再往前挪' }));
        }
        // 优先在上一镜尾部 3~14 字内找最近的停顿标点，找不到则往前拨半截（2~5字）实现句中提前切入
        let chosenOff = null;
        let sIdx = 0;
        const candidates = [];
        for (let k = 0; k < prevText.length; k++) {
          if (isSpoken(prevText[k])) sIdx++;
          else if (/[，,；;。！？!?、：:]/.test(prevText[k]) && sIdx >= 2 && prevSpoken - sIdx >= 2 && prevSpoken - sIdx <= 14) {
            candidates.push(sIdx);
          }
        }
        if (candidates.length) chosenOff = candidates[candidates.length - 1];
        else chosenOff = Math.max(1, prevSpoken - Math.min(5, Math.max(2, Math.floor(prevSpoken / 2))));
        targetJ = pStart + chosenOff;
      } else if (body.step === 'later') {
        const currSpoken = cEnd - cStart;
        if (currSpoken <= 2) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: '当前镜头旁白已太短，不能再往后挪' }));
        }
        let chosenOff = null;
        let sIdx = 0;
        for (let k = 0; k < currText.length; k++) {
          if (isSpoken(currText[k])) sIdx++;
          else if (/[，,；;。！？!?、：:]/.test(currText[k]) && sIdx >= 2 && currSpoken - sIdx >= 2 && sIdx <= 14) {
            chosenOff = sIdx;
            break;
          }
        }
        if (chosenOff === null) chosenOff = Math.min(currSpoken - 1, Math.min(5, Math.max(2, Math.floor(currSpoken / 2))));
        targetJ = cStart + chosenOff;
      }

      if (targetJ === null || !moveCutTo(scenes, idx, targetJ)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '无法移动到目标切点位置' }));
      }
      if (sPrev.ppt_slide_spec) sPrev.ppt_slide_spec.subtitle = (sPrev.narration_text || '').slice(0, 24);
      if (sCurr.ppt_slide_spec) sCurr.ppt_slide_spec.subtitle = (sCurr.narration_text || '').slice(0, 24);
      actionMsg = `已调整 ${sPrev.scene_id} / ${sCurr.scene_id} 的换画面位置`;
    }

    recalculateTimelines(manifest, targetProject);
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: true,
        manifest,
        timingSummary: buildProjectTimingSummary(targetProject, manifest),
        message: actionMsg,
      })
    );
  }

  // 10. 切换或启动当前工程对应的 Remotion Studio (:3100)
  if (req.method === 'POST' && pathname === '/api/remotion-studio/open') {
    const body = await readBody(req);
    const targetProject = body.projectId || queryProject;
    if (req.user && !req.accountStore.canReadProject(req.user, targetProject)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '无权访问此工程' }));
    }
    try {
      const studio = await ensureRemotionStudio(targetProject);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...studio }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  return false;
}
