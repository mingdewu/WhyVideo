import fs from 'fs';
import path from 'path';
import { rootDir, defaultProjectId, getPaths, readBody, alignJobs } from '../lib/config.mjs';
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
import { getMeowloadApiKey } from '../lib/llm-gateway.mjs';
import {
  getProducerPromptsState,
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

const autoPlanProgressMap = globalThis.__whyvideoAutoPlanProgressMap || (globalThis.__whyvideoAutoPlanProgressMap = new Map());

export async function handleProducerRoutes(req, res, { url, pathname, queryProject, paths }) {
  // 0. 工程列表 API
  if (req.method === 'GET' && pathname === '/api/projects') {
    const projects = listProjects();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        currentProjectId: queryProject,
        projects,
      })
    );
  }

  // 删除工程（基准工程保护）
  if (req.method === 'POST' && pathname === '/api/delete-project') {
    const body = await readBody(req);
    const targetProject = String(body.projectId || '').trim();
    if (!/^[\w-]+$/.test(targetProject)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '工程 ID 无效' }));
    }
    if (targetProject === defaultProjectId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '基准工程不可删除' }));
    }
    const targetDir = path.join(rootDir, 'projects', targetProject);
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    const projects = listProjects();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      deletedProjectId: targetProject,
      nextActiveProjectId: projects[0]?.id || defaultProjectId,
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
    if (ensureTableFields(manifest)) {
      fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }
    const assetIndex = syncLocalProjectAssets(queryProject);
    const promptConfig = fs.existsSync(paths.promptConfigPath)
      ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'))
      : {
          selected_visual_model: 'remotion_procedural',
          global_ai_visual_prompt:
            '作为 16:9 纪录片视觉总监，结合旁白片段与关键词，在 16:9 画幅中央提炼一个醒目标志大字（不超过 14 字），搭配 1 条副级阐述，用于动效视觉传达。',
        };
    promptConfig.tavilyKeyConfigured = Boolean(promptConfig.tavilyApiKey || process.env.TAVILY_API_KEY);
    delete promptConfig.tavilyApiKey;
    promptConfig.meowloadKeyConfigured = Boolean(getMeowloadApiKey(paths.projectDir));
    delete promptConfig.meowloadApiKey;

    let audioFile = null;
    if (fs.existsSync(paths.audioDir)) {
      const audios = fs.readdirSync(paths.audioDir).filter((f) => /\.(mp3|wav)$/i.test(f));
      if (audios.length > 0) audioFile = `/public/${queryProject}/audio/${audios[0]}`;
    }

    const hasVideo = fs.existsSync(paths.videoPath);
    const videoUrl = hasVideo ? `/output/${queryProject}/final_video_1080p.mp4` : null;
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
        elevenlabsKeyConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
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
    const updatedManifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: true,
        manifest: updatedManifest,
        timingSummary: buildProjectTimingSummary(targetProject, updatedManifest),
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
    const job = autoPlanProgressMap.get(jobId) || { percent: 0, text: '准备分析切点...', done: false, error: null };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...job }));
  }

  // 4.0.2 ⚡ 按关键词与停顿智能排切点（支持句中换画面 + 长镜头自动补切点）
  if (req.method === 'POST' && pathname === '/api/auto-plan-cuts') {
    const body = await readBody(req).catch(() => ({}));
    const targetProject = body.projectId || queryProject;
    const jobId = String(body.jobId || targetProject).trim();
    const updateCutProgress = (percent, text, extra = {}) => {
      autoPlanProgressMap.set(jobId, {
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

  return false;
}
