import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { getPaths, readBody, normalizePromptConfig } from '../lib/config.mjs';
import { syncTableToManifest, recompileProject } from '../lib/project-store.mjs';
import {
  parseTimeRangeFromText,
  formatSecToMMSS,
  formatSecToFileTag,
  callLlmRemotionCompiler,
} from '../lib/scene-compiler.mjs';
import {
  syncLocalProjectAssets,
  extractLocalSmartPrompt,
  callOpenRouterPromptExtractor,
  registerGeneratedAsset,
  callSearchKeywordExtractor,
  downloadRemoteMedia,
  callGatewayVideoGeneration,
  callGatewayImageGeneration,
} from '../lib/media-gateway.mjs';
import { getVoiceSttCapabilities, transcribeAudioBuffer } from '../lib/voice-stt.mjs';

const downloadProgressMap = globalThis.__whyvideoDownloadProgressMap || (globalThis.__whyvideoDownloadProgressMap = new Map());
const ALLOWED_SOURCE_MODES = new Set(['manual_upload', 'ai_ppt_slide', 'ai_generated_image', 'ai_generated_video']);

export async function handleMediaRoutes(req, res, { url, pathname, queryProject }) {
  // 4.5 智能分镜与指示词提炼 API (调用 OpenRouter 统一网关指定的模型)
  if (req.method === 'POST' && pathname === '/api/extract-prompt') {
    const body = await readBody(req);
    const { projectId, narrationText, targetMode = 'video', keywords = [], templateStyle = 'data_card' } = body;
    const targetProj = projectId || queryProject;
    const curPaths = getPaths(targetProj);
    let promptCfg = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
    }
    let projectContext = {};
    if (fs.existsSync(curPaths.briefPath)) {
      try { projectContext = JSON.parse(fs.readFileSync(curPaths.briefPath, 'utf8')); } catch (e) {}
    }
    const normalizedCfg = normalizePromptConfig(promptCfg);
    const result = await callOpenRouterPromptExtractor(normalizedCfg, narrationText, targetMode, keywords, templateStyle, projectContext, curPaths.projectDir);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...result }));
  }

  // 4.55 AI 搜索关键词提炼 API (唯一最佳纯中文素材搜索词，支持单镜头或批量逐镜调用)
  if (req.method === 'POST' && pathname === '/api/extract-search-keywords') {
    const body = await readBody(req);
    const { projectId, sceneId, narrationText = '', chapterRef = '', keywordModel: overrideModel = '', excludeKeyword = '', persist = true } = body;
    const targetProj = projectId || queryProject;
    const curPaths = getPaths(targetProj);
    let promptCfg = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
    }
    let projectContext = {};
    if (fs.existsSync(curPaths.briefPath)) {
      try { projectContext = JSON.parse(fs.readFileSync(curPaths.briefPath, 'utf8')); } catch (e) {}
    }
    const normalizedCfg = normalizePromptConfig(promptCfg);
    if (overrideModel && String(overrideModel).trim()) {
      normalizedCfg.keywordModel = String(overrideModel).trim();
    }
    try {
      const result = await callSearchKeywordExtractor(normalizedCfg, narrationText, projectContext, chapterRef, curPaths.projectDir, excludeKeyword);
      if (persist && sceneId && fs.existsSync(curPaths.manifestPath)) {
        try {
          const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
          const targetScene = (mf.scenes || []).find((s) => s.scene_id === sceneId);
          if (targetScene) {
            targetScene.selected_search_keyword = result.keyword;
            targetScene.search_keyword_candidates = [result.keyword];
            fs.writeFileSync(curPaths.manifestPath, JSON.stringify(mf, null, 2), 'utf8');
          }
        } catch (persistErr) {
          console.warn('[extract-search-keywords persist warning]:', persistErr.message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message || '关键词提炼失败' }));
    }
  }

  // 5. 单行或批量生成 AI 画面与真实实体视频
  if (req.method === 'POST' && (pathname === '/api/generate-ppt' || pathname === '/api/generate-visual')) {
    const body = await readBody(req);
    const {
      sceneId,
      globalPrompt,
      manifest,
      projectId,
      visualTarget = 'video', // 'video' | 'image' | 'card'
      customPrompt,
      templateStyle,
      themeTitle,
    } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    let promptCfg = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
    }
    const normalizedCfg = normalizePromptConfig(promptCfg);

    if (globalPrompt !== undefined) {
      normalizedCfg.global_ai_visual_prompt = globalPrompt;
      normalizedCfg.updated_at = new Date().toISOString();
      fs.writeFileSync(curPaths.promptConfigPath, JSON.stringify(normalizedCfg, null, 2), 'utf8');
    }

    const targetManifest = manifest || JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));

    // 5.1 🎬 生成实体真实动态视频 (调用用户指定的视频生成模型)
    if (visualTarget === 'video') {
      if (!sceneId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: '实体视频需针对单镜头生成，请点击对应镜头行内的【🎬 一键生成真实动态视频】' }));
      }
      const s = (targetManifest.scenes || []).find((sc) => sc.scene_id === sceneId);
      if (!s) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: '未找到指定镜头 ' + sceneId }));
      }

      const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : [];
      let videoPrompt = (customPrompt || '').trim();
      if (!videoPrompt) {
        videoPrompt = `${s.narration_text}，${kws.join('，')}，电影质感，超清4K，慢动作运镜，真实自然光影，细腻纹理`;
      } else if (!videoPrompt.includes('超清') && !videoPrompt.includes('4k') && !videoPrompt.includes('cinematic')) {
        videoPrompt += '，电影质感，超清4K，细腻写实，真实环境光影';
      }

      try {
        const videoUrl = await callGatewayVideoGeneration(
          {
            apiKey: normalizedCfg.apiKey,
            baseUrl: normalizedCfg.baseUrl,
            videoModel: normalizedCfg.videoModel
          },
          videoPrompt
        );

        const safeScene = s.scene_id.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileName = `${safeScene}_ai_${Date.now()}.mp4`;
        const relPath = `assets/video/${fileName}`;
        const localDiskPath = path.join(curPaths.publicDir, relPath);

        await downloadRemoteMedia(videoUrl, localDiskPath, normalizedCfg.apiKey);

        const reqSec = Number(((s.duration_ms || 5000) / 1000).toFixed(1));
        const assetId = registerGeneratedAsset(curPaths, targetProject, s.scene_id, relPath, 'video', reqSec);

        s.source_mode = 'ai_generated_video';
        s.final_asset_id = assetId;
        s.visual_type = 'broll_video';
        s.scene_type = 'broll_video';
        s.status = 'READY_APPROVED';
        s.review_status = 'APPROVED';
        s.human_review_required = false;
        s.trim_start_sec = 0.0;
        s.trim_end_sec = reqSec;
        s.trim_prompt = `默认前 ${reqSec} 秒`;
        s.preview_image_url = null;
        s.target_visual_mode = 'video';
        if (!s.ppt_slide_spec) s.ppt_slide_spec = {};
        s.ppt_slide_spec.custom_prompt = customPrompt || s.ppt_slide_spec.custom_prompt || '';

        syncTableToManifest(targetManifest);
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
        recompileProject(targetProject);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          manifest: targetManifest,
          videoUrl: `/public/${targetProject}/${relPath}`,
          assetId,
          message: `🎬 镜头 ${s.scene_id} 实体动态视频已由 ${normalizedCfg.videoModel} 成功生成并下载挂载！`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    // 5.2 🖼️ 生成超写实实景图 (调用指定的生图模型)
    if (visualTarget === 'image') {
      const s = (targetManifest.scenes || []).find((sc) => sc.scene_id === sceneId);
      if (!s) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: '未找到指定镜头 ' + sceneId }));
      }

      const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : [];
      const imgPrompt = (customPrompt || `${s.narration_text}，${kws.join('，')}`) + '，超清写实摄影，8k电影画质，真实光影';

      try {
        const remoteImgUrl = await callGatewayImageGeneration(
          {
            apiKey: normalizedCfg.apiKey,
            baseUrl: normalizedCfg.baseUrl,
            imageModel: normalizedCfg.imageModel
          },
          imgPrompt
        );

        const safeScene = s.scene_id.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileName = `${safeScene}_ai_${Date.now()}.jpg`;
        const relPath = `assets/images/${fileName}`;
        const localDiskPath = path.join(curPaths.publicDir, relPath);

        await downloadRemoteMedia(remoteImgUrl, localDiskPath, normalizedCfg.apiKey);

        const assetId = registerGeneratedAsset(curPaths, targetProject, s.scene_id, relPath, 'image', null);

        s.source_mode = 'ai_generated_image';
        s.final_asset_id = assetId;
        s.visual_type = 'photo_motion';
        s.scene_type = 'photo_motion';
        s.status = 'READY_APPROVED';
        s.review_status = 'APPROVED';
        s.human_review_required = false;
        s.preview_image_url = `/public/${targetProject}/${relPath}?t=${Date.now()}`;
        s.target_visual_mode = 'image';

        syncTableToManifest(targetManifest);
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
        recompileProject(targetProject);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          manifest: targetManifest,
          previewUrl: s.preview_image_url,
          assetId,
          message: `🖼️ 镜头 ${s.scene_id} 超清实景图已由 ${normalizedCfg.imageModel} 成功生成并挂载！`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    // 5.3 📊 AI 动态图文卡片生成 (调用指定的生图大模型，根据所选 PPT 模板与指导词，由 AI 绘制 16:9 商业演说卡片)
    const validCardTypes = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
    const targetScene = (targetManifest.scenes || []).find((sc) => sc.scene_id === sceneId);

    const templateStylePrompts = {
      data_card: "16:9 modern keynote presentation slide infographic card, bold central typography title, elegant dark glassmorphism card container, amber gold and deep navy ambient lighting, structured bullet points, sleek UI graphics, minimalist editorial design, 8k resolution, award-winning slide design, no clutter",
      document_highlight: "16:9 historical document archive presentation slide, elegant vintage Japanese classical calligraphy book layout, dark textured washi paper surface, gold leaf foil accents, refined quote highlight container, ancient scroll seal, editorial museum infographic slide, 8k resolution",
      versus_dual: "16:9 versus dual-column comparison presentation slide, keynote infographic comparison card, side-by-side balanced dual containers, high contrast cyan blue vs purple ambient lighting, structured comparative bullet points, clean modern vector layout, 8k resolution",
      timeline: "16:9 chronological milestone evolution roadmap presentation slide, sleek connecting horizontal timeline track, glowing step-by-step milestone nodes, clean tech-historical editorial slide, gold and emerald subtle glow, 8k resolution",
      kinetic_text: "16:9 kinetic typography presentation slide, oversized impactful bold headline, dynamic focal hierarchy, spotlight radial glow on dark backdrop, sleek modern poster card layout, ultra clean editorial graphic design, 8k resolution"
    };

    const scenesToProcess = sceneId ? (targetScene ? [targetScene] : []) : (targetManifest.scenes || []).filter(s => s.source_mode === 'ai_ppt_slide' || s.target_visual_mode === 'card');

    if (scenesToProcess.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: '未找到待生成的卡片镜头 ' + (sceneId || '') }));
    }

    for (const s of scenesToProcess) {
      const kws = Array.isArray(s.content_keywords) && s.content_keywords.length > 0 ? s.content_keywords : ['核心要点'];
      const chosenTemplate = (templateStyle && validCardTypes.includes(templateStyle))
        ? templateStyle
        : (validCardTypes.includes(s.visual_type) ? s.visual_type : 'data_card');
      s.target_visual_mode = 'card';

      const activePrompt = (customPrompt !== undefined && sceneId)
        ? customPrompt
        : (s.ppt_slide_spec?.custom_prompt || extractLocalSmartPrompt(s.narration_text, 'card', kws, chosenTemplate));

      const layoutStyle = templateStylePrompts[chosenTemplate] || templateStylePrompts.data_card;
      const cardImgPrompt = `${activePrompt}，${layoutStyle}，16:9 商业演讲信息图PPT动态卡片，高端海报质感，排版清晰美观，8k超高分辨率`;

      // 未配置外部生图 API Key 时：调用 Remotion 原生离线卡片引擎进行即时渲染
      if (!normalizedCfg.apiKey) {
        s.source_mode = 'ai_ppt_slide';
        s.visual_type = chosenTemplate;
        s.scene_type = chosenTemplate;
        s.status = 'READY_APPROVED';
        s.review_status = 'APPROVED';
        s.human_review_required = false;
        s.ppt_slide_spec = {
          theme_title: themeTitle || s.ppt_slide_spec?.theme_title || kws[0] || '核心要点',
          subtitle: s.narration_text.slice(0, 24),
          custom_prompt: activePrompt,
          template_style: chosenTemplate,
          generated_model: 'Remotion Native Card',
          generated_at: new Date().toISOString()
        };
        syncTableToManifest(targetManifest);
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
        recompileProject(targetProject);
        const stillRelPath = renderRemotionCardStill(curPaths, s.scene_id, targetProject);
        if (stillRelPath) {
          s.preview_image_url = `/public/${targetProject}/${stillRelPath}?t=${Date.now()}`;
        }
        continue;
      }

      try {
        const remoteImgUrl = await callGatewayImageGeneration(
          {
            apiKey: normalizedCfg.apiKey,
            baseUrl: normalizedCfg.baseUrl,
            imageModel: normalizedCfg.imageModel
          },
          cardImgPrompt
        );

        const safeScene = s.scene_id.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileName = `${safeScene}_card_${Date.now()}.jpg`;
        const relPath = `assets/images/${fileName}`;
        const localDiskPath = path.join(curPaths.publicDir, relPath);

        await downloadRemoteMedia(remoteImgUrl, localDiskPath, normalizedCfg.apiKey);

        const reqSec = Number(((s.duration_ms || 5000) / 1000).toFixed(1));
        const assetId = registerGeneratedAsset(curPaths, targetProject, s.scene_id, relPath, 'image', reqSec);

        s.source_mode = 'ai_generated_image';
        s.final_asset_id = assetId;
        s.visual_type = 'photo_motion';
        s.scene_type = 'photo_motion';
        s.status = 'READY_APPROVED';
        s.review_status = 'APPROVED';
        s.human_review_required = false;
        s.preview_image_url = `/public/${targetProject}/${relPath}?t=${Date.now()}`;
        s.target_visual_mode = 'card';
        s.ppt_slide_spec = {
          theme_title: themeTitle || s.ppt_slide_spec?.theme_title || kws[0] || '核心要点',
          subtitle: s.narration_text.slice(0, 24),
          custom_prompt: activePrompt,
          template_style: chosenTemplate,
          generated_model: normalizedCfg.imageModel,
          generated_at: new Date().toISOString()
        };
      } catch (err) {
        console.error(`AI 绘制卡片失败 (${s.scene_id}):`, err);
        if (sceneId) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: `AI 动态卡片生成失败: ${err.message}` }));
        }
      }
    }

    syncTableToManifest(targetManifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      manifest: targetManifest,
      previewUrl: targetScene ? targetScene.preview_image_url : null,
      message: targetScene
        ? `✨ 镜头 ${targetScene.scene_id} 动态卡片已由 AI 生图大模型 (${normalizedCfg.imageModel}) 成功生成！`
        : '⚡ 已批量由 AI 生图大模型生成指定卡片！'
    }));

    const modelDisplayName = hasOpenRouter ? `OpenRouter (${normalizedCfg.textModel?.split('/').pop() || 'Claude'})` : 'Remotion';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      manifest: targetManifest,
      previewUrl: generatedRelPath ? `/public/${targetProject}/${generatedRelPath}` : null,
      message: targetScene
        ? (generatedRelPath ? `✨ 镜头 ${targetScene.scene_id} 已由 ${modelDisplayName} 提炼并由 Remotion 渲染出 1080p 超清画面！` : `⚠️ 镜头 ${targetScene.scene_id} 规格已提炼，但静态画面渲染未完成，请重试`)
        : '⚡ 已为指定镜头完成 AI 画面更新！'
    }));
  }

  // 6. 人工上传本地素材
  if (req.method === 'POST' && pathname === '/api/upload-asset') {
    const body = await readBody(req);
    const { sceneId, fileName, fileType, dataUrl, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid file dataUrl' }));
    }

    const buffer = Buffer.from(matches[2], 'base64');
    const isVideo = (fileType && fileType.startsWith('video/')) || /\.(mp4|mov|webm)$/i.test(fileName);
    const folder = isVideo ? 'assets/video' : 'assets/images';
    const safeFile = `${sceneId.toLowerCase()}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const relPath = `${folder}/${safeFile}`;
    const diskPath = path.join(curPaths.publicDir, relPath);

    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, buffer);

    const assetIndex = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'));
    const newAssetId = `${isVideo ? 'AST-VID-' : 'AST-IMG-'}${String(assetIndex.assets.length + 1).padStart(3, '0')}`;

    let probedDur = null;
    if (isVideo) {
      try {
        const probe = spawnSync(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', diskPath],
          { encoding: 'utf8', timeout: 5000 }
        );
        if (probe.status === 0 && probe.stdout) {
          const val = Number(probe.stdout.trim());
          if (Number.isFinite(val) && val > 0) {
            probedDur = Number(val.toFixed(1));
          }
        }
      } catch (e) {}
    }

    const newAsset = {
      asset_id: newAssetId,
      path: relPath,
      file_path: `projects/${targetProject}/public/${relPath}`,
      file_name: fileName,
      type: isVideo ? 'video' : 'image',
      media_type: isVideo ? 'video' : 'image',
      duration_seconds: isVideo ? probedDur : null,
      duration_sec: isVideo ? probedDur : null,
      resolution: '1920x1080',
      license_status: 'approved',
      source_url: `manual_upload://${safeFile}`,
      tags: ['人工上传', sceneId, fileName],
    };
    assetIndex.assets.push(newAsset);
    fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (scene) {
      scene.source_mode = 'manual_upload';
      scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
      scene.scene_type = scene.visual_type;
      scene.final_asset_id = newAssetId;
      scene.status = 'READY_APPROVED';
      if (isVideo) {
        const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
        scene.trim_start_sec = 0.0;
        scene.trim_end_sec = reqSec;
        scene.trim_prompt = `默认前 ${reqSec} 秒`;
      }
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, uploadedAsset: newAsset, manifest, assetIndex }));
  }

  if (req.method === 'GET' && pathname === '/api/download-progress') {
    const jobId = String(url.searchParams.get('jobId') || '').trim();
    const job = downloadProgressMap.get(jobId) || { percent: 0, text: '准备中...', done: false, error: null };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...job }));
  }

  // 6.5 仅通过本机哼哼猫桌面端 (meowload CLI) 解析网络链接并按指定片段下载视频/图片素材到当前工程专属 assets 目录（绝不调用远程收费 API）
  if (req.method === 'POST' && pathname === '/api/download-url-asset') {
    const body = await readBody(req);
    const { sceneId, url: rawInputUrl, projectId, clipStartSec: reqStartSec, clipEndSec: reqEndSec, rawPrompt, jobId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);
    const updateDlProgress = (percent, text, extra = {}) => {
      if (!jobId) return;
      downloadProgressMap.set(String(jobId), {
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        text: text || '',
        done: Boolean(extra.done),
        error: extra.error || null,
        updatedAt: Date.now(),
      });
    };
    updateDlProgress(2, '正在校验视频链接...');

    const normalizeDownloadUrl = (raw) => {
      let s = String(raw || '')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
        .trim();
      if (!s) return '';

      // 修正全角冒号或单斜杠等常见粘贴格式问题
      s = s
        .replace(/^https?\s*：\s*\/\//i, (m) => (m.toLowerCase().startsWith('https') ? 'https://' : 'http://'))
        .replace(/^(https?):\/([^/])/i, '$1://$2');

      if (s.startsWith('//')) {
        s = `https:${s}`;
      }

      // 优先提取标准 RFC3986 URL（遇到中文、空格、全角标点自动截断，避免把分享文案拼进 URL）
      const rfcMatch = s.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
      let candidate = rfcMatch ? rfcMatch[0] : '';

      // 若无协议头，兼容 www.bilibili.com/... / b23.tv/... / youtu.be/... 等裸域名链接
      if (!candidate) {
        const bareMatch = s.match(/(?:^|\s)((?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?)/);
        if (bareMatch) {
          candidate = `https://${bareMatch[1]}`;
        }
      }

      // 清理尾部多余的非转义 % 或孤立标点（如 "100%好评" 截断后残留的 "%"）
      candidate = candidate.replace(/[.,;:!?'"`~)\]}>]+$/g, (m) => (m === '/' ? '/' : ''));
      candidate = candidate.replace(/%(?![0-9A-Fa-f]{2}).*$/, '');

      if (!candidate) return '';
      try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
        return parsed.toString();
      } catch (e) {
        return '';
      }
    };

    const targetUrl = normalizeDownloadUrl(rawInputUrl);
    if (!targetUrl) {
      updateDlProgress(0, '链接无效', { done: true, error: '请输入有效的网络视频或帖子链接' });
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请输入有效的网络视频或帖子链接（支持 YouTube、B站、抖音、TikTok、小红书等，请勿仅输入纯文字）' }));
    }

    const resolveMeowloadCli = () => {
      const candidates = ['/usr/local/bin/meowload', '/opt/homebrew/bin/meowload'];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      const whichRes = spawnSync('which', ['meowload'], { encoding: 'utf8' });
      if (whichRes.status === 0 && whichRes.stdout.trim()) return whichRes.stdout.trim();
      return '';
    };

    const meowloadCli = resolveMeowloadCli();

    if (!meowloadCli) {
      updateDlProgress(0, '未检测到本机哼哼猫客户端', { done: true, error: '未检测到本机哼哼猫客户端 CLI (meowload)' });
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: '未检测到本机哼哼猫客户端 CLI (meowload)。请确认已安装并登录本机哼哼猫桌面端。'
      }));
    }

    try {
      const manifestPre = fs.existsSync(curPaths.manifestPath)
        ? JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'))
        : { scenes: [] };
      const sceneIdx = (manifestPre.scenes || []).findIndex((s) => s.scene_id === sceneId);
      const scenePre = sceneIdx >= 0 ? manifestPre.scenes[sceneIdx] : null;
      const seqNumStr = String(sceneIdx >= 0 ? sceneIdx + 1 : 1).padStart(2, '0');
      const seqLabel = `序列${seqNumStr}`;
      const safeProject = String(targetProject || 'proj').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');

      // 解析用户指定的片段截取区间（优先级：请求显式传入 > 口令实时解析 > 镜头已编译的 download_clip_*）
      let clipStart = (reqStartSec !== undefined && reqStartSec !== null && reqStartSec !== '') ? Number(reqStartSec) : null;
      let clipEnd = (reqEndSec !== undefined && reqEndSec !== null && reqEndSec !== '') ? Number(reqEndSec) : null;
      if (clipStart === null || clipEnd === null || Number.isNaN(clipStart) || Number.isNaN(clipEnd) || clipEnd <= clipStart) {
        const parsedFromPrompt = parseTimeRangeFromText(rawPrompt || '');
        if (parsedFromPrompt) {
          clipStart = parsedFromPrompt.startSec;
          clipEnd = parsedFromPrompt.endSec;
        } else if (
          scenePre &&
          scenePre.download_clip_start_sec !== undefined &&
          scenePre.download_clip_end_sec !== undefined &&
          Number(scenePre.download_clip_end_sec) > Number(scenePre.download_clip_start_sec)
        ) {
          clipStart = Number(scenePre.download_clip_start_sec);
          clipEnd = Number(scenePre.download_clip_end_sec);
        }
      }

      const hasClipRange = clipStart !== null && clipEnd !== null && !Number.isNaN(clipStart) && !Number.isNaN(clipEnd) && clipEnd > clipStart;
      const startSec = hasClipRange ? Math.max(0, Number(clipStart.toFixed(1))) : 0;
      const endSec = hasClipRange ? Number(clipEnd.toFixed(1)) : 0;
      const rangeFileTag = hasClipRange ? `_${formatSecToFileTag(startSec)}-${formatSecToFileTag(endSec)}` : '';
      const rangeDisplayTag = hasClipRange ? `${formatSecToMMSS(startSec)}~${formatSecToMMSS(endSec)}` : '';

      let isVideo = true;
      let folder = 'assets/video';
      let siteName = 'web';
      let postTitle = '';
      let relPath = '';
      let diskPath = '';
      let detectedDuration = null;
      let detectedResolution = '1920x1080';
      let detectedHasAudio = false;
      let downloadSourceMode = 'desktop_app';

      try {
        const u = new URL(targetUrl);
        siteName = u.hostname.replace(/^www\./, '').split('.')[0] || 'web';
      } catch (e) {}

      // 仅使用本机已登录会员的哼哼猫桌面端 CLI，将临时目录放在 public/ 之外，避免 Remotion Studio 监听 public/ 时因删除临时目录触发 ENOENT 崩溃
      const tmpDir = path.join(path.dirname(curPaths.publicDir), '.tmp_downloads', `meow_tmp_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      updateDlProgress(8, hasClipRange ? `正在连接本机哼哼猫解析直链 (${rangeDisplayTag})...` : '正在连接本机哼哼猫桌面端解析并下载...');

      const killProcTree = (proc) => {
        if (!proc || !proc.pid) return;
        try {
          if (process.platform !== 'win32') {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch (e) {
          try { proc.kill('SIGKILL'); } catch (_) {}
        }
      };

      const runAsyncCmd = (cmd, args, timeoutMs = 120000) => new Promise((resolve) => {
        const proc = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
        let outLog = '';
        let errLog = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killProcTree(proc);
        }, timeoutMs);
        proc.stdout.on('data', (d) => { outLog += d.toString(); });
        proc.stderr.on('data', (d) => { errLog += d.toString(); });
        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ status: -1, stdout: outLog, stderr: err.message || errLog, timedOut });
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ status: code ?? -1, stdout: outLog, stderr: errLog, timedOut });
        });
      });

      const rewriteMcdnHost = (rawU, mirrorHost) => {
        if (!rawU) return '';
        try {
          const u = new URL(rawU);
          const isMcdn = (/upgcxcode/i.test(u.pathname) || /bilivideo|mountaintoys|mcdn/i.test(u.hostname))
            && (Boolean(u.port) || /mountaintoys|mcdn/i.test(u.hostname) || /[?&](?:os|sche)=mcdn/i.test(rawU));
          if (isMcdn && mirrorHost) {
            u.hostname = mirrorHost;
            u.port = '';
            return u.toString();
          }
          return rawU;
        } catch (e) {
          return rawU;
        }
      };

      const fetchMeowloadInfo = async () => {
        const infoRes = await runAsyncCmd(meowloadCli, ['info', targetUrl], 30000);
        if (infoRes.status !== 0 || !infoRes.stdout) return null;
        try {
          const infoJson = JSON.parse(infoRes.stdout);
          const mediaItem = Array.isArray(infoJson?.medias) ? infoJson.medias[0] : null;
          if (!mediaItem) return null;
          const hdrs = mediaItem.headers || {};
          const ua = hdrs['User-Agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
          const referer = hdrs['Referer'] || targetUrl;
          const rawTitle = String(infoJson.text || siteName || 'media')
            .replace(/[\\/:*?"<>|\r\n]+/g, '_')
            .trim()
            .slice(0, 60) || 'media';
          return { infoJson, mediaItem, ua, referer, rawTitle };
        } catch (e) {
          return null;
        }
      };

      const tryFfmpegDirect = async ({ vUrl, aUrl, ua, referer, outPath, clipRange }) => {
        if (!vUrl) return false;
        const args = ['-y'];
        const headerStr = `Referer: ${referer}\r\n`;
        const clipDur = clipRange ? Math.max(0.1, Number((endSec - startSec).toFixed(2))) : 0;
        const pushInput = (url) => {
          args.push('-user_agent', ua, '-headers', headerStr);
          if (clipRange) {
            args.push('-ss', String(startSec), '-t', String(clipDur));
          }
          args.push('-i', url);
        };
        pushInput(vUrl);
        if (aUrl) pushInput(aUrl);
        if (clipRange) {
          args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', outPath);
        } else {
          args.push('-c', 'copy', '-movflags', '+faststart', outPath);
        }
        const ff = await runAsyncCmd('ffmpeg', args, clipRange ? 90000 : 180000);
        return ff.status === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
      };

      const tryDirectMediaDownload = async (clipRange) => {
        const info = await fetchMeowloadInfo();
        if (!info) return { files: [], trimmed: false };
        const { mediaItem, ua, referer, rawTitle } = info;
        if (clipRange && mediaItem.media_type === 'image') return { files: [], trimmed: false };

        const outFiles = [];
        const fallbackOut = path.join(tmpDir, `${rawTitle}.mp4`);
        const formats = Array.isArray(mediaItem.formats)
          ? [...mediaItem.formats].sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))
          : [];

        let downloaded = false;
        if (formats.length > 0 && formats[0].video_url) {
          const triedPairs = new Set();
          for (const mirrorHost of ['upos-sz-mirrorcos.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com', '']) {
            const vUrl = rewriteMcdnHost(formats[0].video_url, mirrorHost);
            const aUrl = formats[0].audio_url ? rewriteMcdnHost(formats[0].audio_url, mirrorHost) : '';
            const pairKey = `${vUrl}||${aUrl}`;
            if (triedPairs.has(pairKey)) continue;
            triedPairs.add(pairKey);
            if (await tryFfmpegDirect({ vUrl, aUrl, ua, referer, outPath: fallbackOut, clipRange })) {
              downloaded = true;
              break;
            }
          }
        }

        if (!downloaded && mediaItem.resource_url) {
          if (mediaItem.media_type === 'image') {
            const imgOut = path.join(tmpDir, `${rawTitle}.jpg`);
            const curlRes = await runAsyncCmd('curl', ['-fsSL', '-A', ua, '-e', referer, '-o', imgOut, mediaItem.resource_url], 60000);
            if (curlRes.status === 0 && fs.existsSync(imgOut) && fs.statSync(imgOut).size > 0) {
              outFiles.push({ name: path.basename(imgOut), fullPath: imgOut, stat: fs.statSync(imgOut) });
              downloaded = true;
            }
          } else {
            const triedUrls = new Set();
            for (const cand of [rewriteMcdnHost(mediaItem.resource_url, 'upos-sz-mirrorcos.bilivideo.com'), mediaItem.resource_url]) {
              if (!cand || triedUrls.has(cand)) continue;
              triedUrls.add(cand);
              if (await tryFfmpegDirect({ vUrl: cand, aUrl: '', ua, referer, outPath: fallbackOut, clipRange })) {
                downloaded = true;
                break;
              }
            }
          }
        }

        if (downloaded && fs.existsSync(fallbackOut) && fs.statSync(fallbackOut).size > 0 && outFiles.length === 0) {
          outFiles.push({ name: path.basename(fallbackOut), fullPath: fallbackOut, stat: fs.statSync(fallbackOut) });
        }
        return { files: outFiles, trimmed: Boolean(clipRange && downloaded && outFiles.length > 0) };
      };

      const runCliDownload = () => new Promise((resolve, reject) => {
        const proc = spawn(meowloadCli, ['download', targetUrl, '--media_type', 'video,image', '--output-dir', tmpDir], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
        let outLog = '';
        let errLog = '';
        let simPct = 10;
        const simTimer = setInterval(() => {
          if (simPct < 70) {
            simPct += 3;
            updateDlProgress(simPct, `本机哼哼猫下载中 (${simPct}%)...`);
          }
        }, 800);

        const handleChunk = (chunkStr) => {
          const pctMatches = [...chunkStr.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
          if (pctMatches.length > 0) {
            const rawPct = parseFloat(pctMatches[pctMatches.length - 1][1]);
            if (!Number.isNaN(rawPct) && rawPct >= 0 && rawPct <= 100) {
              const mapped = 10 + Math.round(rawPct * 0.65);
              if (mapped > simPct) simPct = mapped;
              updateDlProgress(simPct, `本机哼哼猫下载中 (${Math.round(rawPct)}%)...`);
            }
          }
        };

        proc.stdout.on('data', (d) => {
          const s = d.toString();
          outLog += s;
          handleChunk(s);
        });
        proc.stderr.on('data', (d) => {
          const s = d.toString();
          errLog += s;
          handleChunk(s);
        });

        const timer = setTimeout(() => {
          clearInterval(simTimer);
          killProcTree(proc);
          reject(new Error('本机哼哼猫下载超时（超过 5 分钟）'));
        }, 300000);

        proc.on('error', (err) => {
          clearInterval(simTimer);
          clearTimeout(timer);
          reject(err);
        });
        proc.on('close', (code) => {
          clearInterval(simTimer);
          clearTimeout(timer);
          if (code === 0) {
            resolve({ outLog, errLog });
          } else {
            const cleanLines = `${errLog || ''}\n${outLog || ''}`
              .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
              .split(/[\r\n]+/)
              .map((l) => l.trim())
              .filter(Boolean);
            const msg = cleanLines.pop() || `退出码 ${code}`;
            const isUrlErr = /URL is empty or invalid|Invalid link format/i.test(msg);
            const hint = isUrlErr
              ? `（请检查链接格式是否完整，当前解析目标: ${targetUrl}）`
              : '（请确认桌面端已启动并登录会员账号）';
            reject(new Error(`本机哼哼猫客户端下载失败: ${msg}${hint}`));
          }
        });
      });

      const collectMediaFiles = (dir) => {
        const results = [];
        const walk = (curDir) => {
          let entries = [];
          try {
            entries = fs.readdirSync(curDir, { withFileTypes: true });
          } catch (e) {
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(curDir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.isFile()) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size > 0) {
                  results.push({ name: entry.name, fullPath, stat });
                }
              } catch (e) {}
            }
          }
        };
        walk(dir);
        return results;
      };

      try {
        let files = [];
        let cliRes = null;
        let alreadyTrimmed = false;

        // 当指定了截取区间时，优先通过 meowload info 解析直链并用 ffmpeg -ss/-t 远程按段抓取（不下载整片）
        if (hasClipRange) {
          updateDlProgress(16, `正在远程截取 ${rangeDisplayTag} 片段（不下载整片）...`);
          try {
            const directRes = await tryDirectMediaDownload(true);
            if (directRes.files.length > 0) {
              files = directRes.files;
              alreadyTrimmed = directRes.trimmed;
              updateDlProgress(82, `远程片段 ${rangeDisplayTag} 截取完成，正在校验...`);
            } else {
              updateDlProgress(15, `远程直链截取未命中，回退本机哼哼猫客户端下载...`);
            }
          } catch (directErr) {
            console.warn('[download-url-asset] remote range clip failed, falling back to full download:', directErr.message);
            updateDlProgress(15, `远程直链截取失败，回退本机哼哼猫客户端下载...`);
          }
        }

        if (files.length === 0) {
          cliRes = await runCliDownload();
          updateDlProgress(78, '下载完成，正在检查媒体文件...');
          files = collectMediaFiles(tmpDir);

          // 若目录扫描为空，尝试从 meowload stdout 的 "completed -> <path>" 中兜底提取实际落盘路径
          if (files.length === 0 && cliRes && cliRes.outLog) {
            const completedMatches = [...cliRes.outLog.matchAll(/completed\s*->\s*([^\r\n]+)/gi)];
            for (const m of completedMatches) {
              const candidatePath = String(m[1] || '').trim();
              if (candidatePath && fs.existsSync(candidatePath)) {
                try {
                  const st = fs.statSync(candidatePath);
                  if (st.isFile() && st.size > 0) {
                    files.push({ name: path.basename(candidatePath), fullPath: candidatePath, stat: st });
                  }
                } catch (e) {}
              }
            }
          }

          // 若 meowload download 因 MCDN/P2P 节点超时等原因静默失败（退出码 0 但无文件），用 meowload info 解析直链并用 mirror CDN + ffmpeg 兜底下载
          if (files.length === 0) {
            updateDlProgress(79, '哼哼猫直连节点超时，正在切换镜像 CDN 兜底下载...');
            try {
              const fallbackRes = await tryDirectMediaDownload(false);
              files = fallbackRes.files;
            } catch (fallbackErr) {
              console.warn('[download-url-asset] meowload info fallback failed:', fallbackErr.message);
            }
          }
        }

        const videoRegex = /\.(mp4|mov|webm|mkv|m4v|flv|ts)$/i;
        const imageRegex = /\.(jpg|jpeg|png|webp|gif|heic|avif)$/i;
        const videoFile = files.find((f) => videoRegex.test(f.name));
        const imageFile = files.find((f) => imageRegex.test(f.name));
        const picked = videoFile || imageFile || files[0];

        if (!picked) {
          const rawDiag = `${cliRes?.errLog || ''}\n${cliRes?.outLog || ''}`
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .split(/[\r\n]+/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' | ');
          console.warn('[download-url-asset] meowload exited 0 but no media file found in', tmpDir, 'diag:', rawDiag);
          const diagSuffix = rawDiag ? `（CLI 输出: ${rawDiag.slice(0, 180)}）` : '';
          throw new Error(`哼哼猫桌面端未在目录中输出有效媒体文件，请检查该链接是否受限或桌面端是否已登录${diagSuffix}`);
        }

        isVideo = Boolean(videoFile) || !imageRegex.test(picked.name);
        const origExt = path.extname(picked.name).replace(/^\./, '').toLowerCase();
        const rawExt = (isVideo && hasClipRange) ? 'mp4' : (origExt || (isVideo ? 'mp4' : 'jpg'));
        const baseName = path.basename(picked.name, path.extname(picked.name));
        postTitle = baseName.slice(0, 60);

        folder = isVideo ? 'assets/video' : 'assets/images';
        const safeFile = `${safeProject}_${seqLabel}${rangeFileTag}_${siteName}_${String(Date.now()).slice(-6)}.${rawExt}`;
        relPath = `${folder}/${safeFile}`;
        diskPath = path.join(curPaths.publicDir, relPath);
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });

        if (isVideo && hasClipRange && !alreadyTrimmed) {
          updateDlProgress(84, `正在用 FFmpeg 截取 ${rangeDisplayTag} 片段...`);
          // 仅截取 startSec ~ endSec 片段写入工程专属 assets/video 目录，原完整临时文件在 finally 中立即销毁，绝不占满硬盘
          const ffTrim = await runAsyncCmd(
            'ffmpeg',
            [
              '-y',
              '-ss', String(startSec),
              '-to', String(endSec),
              '-i', picked.fullPath,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '20',
              '-c:a', 'aac',
              '-movflags', '+faststart',
              diskPath,
            ],
            120000
          );
          if (ffTrim.status !== 0 || !fs.existsSync(diskPath) || fs.statSync(diskPath).size === 0) {
            throw new Error(`视频片段截取 (${rangeDisplayTag}) 失败，请检查指定秒数是否超出原视频总长度`);
          }
        } else {
          fs.renameSync(picked.fullPath, diskPath);
        }
        updateDlProgress(94, '正在写入工程素材库并绑定镜头...');
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
      }

      // 用 ffprobe 探测本地已落盘短视频真实时长与分辨率
      if (isVideo) {
        if (detectedDuration === null) {
          detectedDuration = hasClipRange ? Number((endSec - startSec).toFixed(1)) : 15.0;
        }
        try {
          const probe = spawnSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', diskPath],
            { encoding: 'utf8' }
          );
          if (probe.status === 0 && probe.stdout) {
            const info = JSON.parse(probe.stdout);
            const dur = parseFloat(info?.format?.duration);
            if (!Number.isNaN(dur) && dur > 0) {
              detectedDuration = Number(dur.toFixed(1));
            }
            const w = info?.streams?.[0]?.width;
            const h = info?.streams?.[0]?.height;
            if (w && h) {
              detectedResolution = `${w}x${h}`;
            }
          }
          const audioProbe = spawnSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', diskPath],
            { encoding: 'utf8' }
          );
          detectedHasAudio = audioProbe.status === 0 && String(audioProbe.stdout || '').trim().length > 0;
        } catch (e) {}
      }

      const assetIndex = fs.existsSync(curPaths.assetIndexPath)
        ? JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'))
        : { project_id: targetProject, assets: [] };
      const newAssetId = `${isVideo ? 'AST-VID-' : 'AST-IMG-'}${String(assetIndex.assets.length + 1).padStart(3, '0')}`;
      const ext = path.extname(relPath).replace(/^\./, '') || (isVideo ? 'mp4' : 'jpg');
      const cleanTitle = (postTitle || siteName || '素材').replace(/[\r\n]+/g, ' ').slice(0, 22);
      const displayFileName = `[${targetProject}·${seqLabel}]${hasClipRange ? ` (${rangeDisplayTag})` : ''} ${cleanTitle}.${ext}`;

      const newAsset = {
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${targetProject}/public/${relPath}`,
        file_name: displayFileName,
        sequence_label: `${targetProject}·${seqLabel}`,
        clip_range: hasClipRange ? { start_sec: startSec, end_sec: endSec, label: rangeDisplayTag } : null,
        type: isVideo ? 'video' : 'image',
        media_type: isVideo ? 'video' : 'image',
        duration_seconds: detectedDuration,
        duration_sec: detectedDuration,
        resolution: detectedResolution,
        has_audio: isVideo ? detectedHasAudio : false,
        license_status: 'approved',
        source_url: targetUrl,
        tags: [
          '网络链接下载',
          hasClipRange ? `片段:${rangeDisplayTag}` : '完整下载',
          `${targetProject}·${seqLabel}`,
          siteName,
          sceneId,
        ],
      };
      assetIndex.assets.push(newAsset);
      fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');
      const syncedAssetIndex = syncLocalProjectAssets(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.source_mode = 'manual_upload';
        scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
        scene.scene_type = scene.visual_type;
        scene.final_asset_id = newAssetId;
        scene.status = 'READY_APPROVED';
        if (isVideo) {
          const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
          const playEndSec = detectedDuration ? Math.min(reqSec, detectedDuration) : reqSec;
          // 本地文件本身已经是截取后的短视频，因此本地播放从 0.0s 开始，作为后续加字幕/动效的基准
          scene.trim_start_sec = 0.0;
          scene.trim_end_sec = playEndSec;
          if (scene.media_modifiers) {
            delete scene.media_modifiers.trim_start_sec;
            delete scene.media_modifiers.trim_end_sec;
          }
          if (hasClipRange) {
            scene.downloaded_clip_info = {
              source_start_sec: startSec,
              source_end_sec: endSec,
              label: rangeDisplayTag,
              local_duration_sec: detectedDuration,
              sequence_label: `${targetProject}·${seqLabel}`,
            };
            delete scene.download_clip_start_sec;
            delete scene.download_clip_end_sec;
            scene.trim_prompt = `已截取原片 ${rangeDisplayTag} (本地长 ${detectedDuration}s)`;
            scene.ai_speech_reply = `✅ 已为你从原视频只截取并下载了 ${rangeDisplayTag} 片段（共 ${detectedDuration}s），命名为「${displayFileName}」并存入本工程专属目录 projects/${targetProject}/public/${folder}/！现在可以在上方口令框针对这段短视频继续加字幕、滤镜或运镜动效。`;
          } else {
            scene.downloaded_clip_info = null;
            scene.trim_prompt = `默认前 ${playEndSec} 秒`;
          }
        }
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);
      updateDlProgress(100, '下载并绑定完成 (100%)', { done: true });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        uploadedAsset: newAsset,
        manifest,
        assetIndex: syncedAssetIndex,
        message: hasClipRange
          ? `✅ 已精准截取原视频 ${rangeDisplayTag} 片段 (${detectedDuration}s) 存入 projects/${targetProject}/public/assets/video/ 并绑定至 ${seqLabel}！`
          : `✅ 已下载到本地 projects/${targetProject}/public/assets/ (${detectedResolution}${detectedDuration ? `, ${detectedDuration}s` : ''}) 并绑定至 ${seqLabel}！`
      }));
    } catch (err) {
      updateDlProgress(0, err.message, { done: true, error: err.message });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: `链接解析下载失败: ${err.message}`
      }));
    }
  }

  // 6.6 从当前工程已下载/上传的本地素材列表中直接选用绑定到指定镜头
  if (req.method === 'POST' && pathname === '/api/bind-project-asset') {
    const body = await readBody(req);
    const { sceneId, assetId, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const syncedAssetIndex = syncLocalProjectAssets(targetProject);
    const pickedAsset = (syncedAssetIndex.assets || []).find((a) => a.asset_id === assetId);
    if (!pickedAsset) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '未在本工程素材库中找到该素材' }));
    }

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (!scene) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '未找到指定分镜' }));
    }

    const isVideo = pickedAsset.type === 'video' || /\.(mp4|mov|webm|mkv)$/i.test(pickedAsset.path || '');
    scene.source_mode = 'manual_upload';
    scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
    scene.scene_type = scene.visual_type;
    scene.final_asset_id = pickedAsset.asset_id;
    scene.status = 'READY_APPROVED';
    if (isVideo) {
      const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
      const dur = Number(pickedAsset.duration_seconds) > 0 ? Number(pickedAsset.duration_seconds) : reqSec;
      scene.trim_start_sec = 0.0;
      scene.trim_end_sec = Math.min(reqSec, dur);
      scene.trim_prompt = pickedAsset.clip_range?.label
        ? `复用片段 ${pickedAsset.clip_range.label} (本地长 ${dur}s)`
        : `默认前 ${Math.min(reqSec, dur)} 秒`;
    }

    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      manifest,
      assetIndex: syncedAssetIndex,
      message: `✅ 已将本工程素材「${pickedAsset.file_name || pickedAsset.asset_id}」绑定至镜头 ${sceneId}！`,
    }));
  }

  // 6.7 清除预设的局部下载时间段限制（恢复整片下载）
  if (req.method === 'POST' && pathname === '/api/clear-download-range') {
    const body = await readBody(req);
    const { sceneId, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (scene) {
      delete scene.download_clip_start_sec;
      delete scene.download_clip_end_sec;
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, manifest }));
  }

  // 6.8 更新指定镜头的原视频音轨保留开关与音量
  if (req.method === 'POST' && pathname === '/api/update-scene-audio') {
    const body = await readBody(req);
    const { sceneId, projectId, keepOriginalAudio, originalAudioVolume } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (!scene) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '未找到指定分镜' }));
    }

    const volNum = Number(originalAudioVolume);
    const safeVol = Number.isFinite(volNum) ? Math.max(0, Math.min(1, Number(volNum.toFixed(2)))) : 0.3;
    scene.media_modifiers = scene.media_modifiers || {};
    scene.media_modifiers.keep_original_audio = Boolean(keepOriginalAudio);
    scene.media_modifiers.original_audio_volume = safeVol;

    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, manifest }));
  }

  // 7. 一句话 AI 剪辑指令
  if (req.method === 'POST' && pathname === '/api/trim-asset') {
    const body = await readBody(req);
    const { sceneId, prompt, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);

    if (!scene || !scene.final_asset_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '当前镜头未绑定有效视频素材' }));
    }

    const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
    let startSec = 0.0;
    let endSec = reqSec;
    const pStr = (prompt || '').trim();
    const parsedRange = parseTimeRangeFromText(pStr, reqSec);

    if (parsedRange) {
      startSec = parsedRange.startSec;
      endSec = parsedRange.endSec;
    } else if (pStr.includes('后半段') || pStr.includes('结尾') || pStr.includes('后')) {
      startSec = Math.max(0, 15.0 - reqSec);
      endSec = 15.0;
    } else if (pStr.includes('中间') || pStr.includes('高潮')) {
      startSec = Math.max(0, (15.0 - reqSec) / 2);
      endSec = startSec + reqSec;
    } else {
      startSec = 0.0;
      endSec = reqSec;
    }

    startSec = Math.max(0, Number(startSec.toFixed(1)));
    endSec = Math.max(startSec + 1.0, Number(endSec.toFixed(1)));

    scene.trim_prompt = pStr;
    scene.trim_start_sec = startSec;
    scene.trim_end_sec = endSec;

    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: true,
        manifest,
        trimInfo: { startSec, endSec, duration: (endSec - startSec).toFixed(1) },
        message: `已解析指令「${pStr}」➔ 截取范围：${startSec}s 到 ${endSec}s (持续 ${(endSec - startSec).toFixed(1)}s)`,
      })
    );
  }

  // 7.4 语音输入能力检测与本地 Whisper 语音转文字接口
  if (req.method === 'GET' && pathname === '/api/voice-input/status') {
    const caps = getVoiceSttCapabilities();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...caps }));
  }

  if (req.method === 'POST' && pathname === '/api/transcribe-voice') {
    const body = await readBody(req);
    const { audioBase64 = '', dataUrl = '', mimeType = '', promptHint = '', language = 'zh' } = body || {};

    let rawB64 = String(audioBase64 || '').trim();
    let resolvedMime = String(mimeType || '').trim();

    if (!rawB64 && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const markerIdx = dataUrl.indexOf(';base64,');
      if (markerIdx !== -1) {
        if (!resolvedMime) {
          resolvedMime = dataUrl.slice(5, markerIdx).trim();
        }
        rawB64 = dataUrl.slice(markerIdx + ';base64,'.length).trim();
      }
    }

    if (!rawB64) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '缺少语音音频数据' }));
    }

    if (rawB64.length > 20 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '录音文件过大，请控制在 60 秒以内' }));
    }

    const audioBuffer = Buffer.from(rawB64, 'base64');
    if (!audioBuffer || audioBuffer.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '无法解码录音音频数据' }));
    }

    try {
      const result = await transcribeAudioBuffer(audioBuffer, {
        mimeType: resolvedMime || 'audio/webm',
        promptHint: String(promptHint || ''),
        language: String(language || 'zh') || 'zh',
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message || '语音识别失败' }));
    }
  }

  // 7.5 自然语言 AI 剪辑、动效、艺术字与局部下载指令综合编译接口
  if (req.method === 'POST' && pathname === '/api/ai-intent') {
    const body = await readBody(req);
    const { sceneId, prompt, projectId, hasAsset, assetType, sourceMode } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);

    if (!scene) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '找不到指定镜头' }));
    }

    scene.source_mode = (typeof sourceMode === 'string' && ALLOWED_SOURCE_MODES.has(sourceMode))
      ? sourceMode
      : 'manual_upload';

    const pStr = (prompt || '').trim();
    const detRange = parseTimeRangeFromText(pStr);
    let promptCfg = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
    }
    const normalizedCfg = normalizePromptConfig(promptCfg);
    const parsed = await callLlmRemotionCompiler(pStr, scene, Boolean(hasAsset), assetType || 'video', normalizedCfg, curPaths.projectDir);

    const assetIndex = fs.existsSync(curPaths.assetIndexPath)
      ? JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'))
      : { assets: [] };
    const boundAsset = scene.final_asset_id
      ? (assetIndex.assets || []).find((a) => a.asset_id === scene.final_asset_id)
      : null;
    const hasBoundManualVideo = Boolean(boundAsset && scene.source_mode === 'manual_upload');

    if (parsed.action === 'media_modifiers' && parsed.media_modifiers) {
      const modCopy = { ...parsed.media_modifiers };
      const rawStart = detRange ? detRange.startSec : modCopy.trim_start_sec;
      const rawEnd = detRange ? detRange.endSec : modCopy.trim_end_sec;
      const hasValidRange = rawStart !== undefined && rawStart !== null && rawEnd !== undefined && rawEnd !== null && Number(rawEnd) > Number(rawStart);

      if (hasValidRange) {
        const sSec = Math.max(0, Number(Number(rawStart).toFixed(1)));
        const eSec = Number(Number(rawEnd).toFixed(1));
        // 始终将解析出的秒数绑定为下载按钮的片段跳转指令，方便用户随后点「⬇️ 下载」时直接局部下载
        scene.download_clip_start_sec = sSec;
        scene.download_clip_end_sec = eSec;

        const localDur = Number(boundAsset?.duration_seconds || 0);
        const isForRemoteDownload = !hasBoundManualVideo
          || /下载|原视频|原片|拉取|链接/.test(pStr)
          || (localDur > 0 && eSec > localDur + 0.5);

        if (isForRemoteDownload) {
          delete modCopy.trim_start_sec;
          delete modCopy.trim_end_sec;
          const rangeStr = `${formatSecToMMSS(sSec)} (${sSec}s) ~ ${formatSecToMMSS(eSec)} (${eSec}s)`;
          parsed.summary = `🎯 已生成下载片段跳转指令：${rangeStr} [共 ${(eSec - sSec).toFixed(1)}s]，现在填入 URL 点击「⬇️ 下载」将只下载该片段！`;
          parsed.ai_speech_reply = `🎯 已将你的口令编译为局部下载指令：点击下方「⬇️ 下载片段 (${formatSecToMMSS(sSec)}~${formatSecToMMSS(eSec)})」按钮时，将直接从原视频跳转抓取第 ${formatSecToMMSS(sSec)}（${sSec}秒）至 ${formatSecToMMSS(eSec)}（${eSec}秒）这 ${(eSec - sSec).toFixed(1)} 秒存入本工程 assets/video 目录，不占额外内存与空间！`;
        } else {
          scene.trim_start_sec = sSec;
          scene.trim_end_sec = eSec;
          modCopy.trim_start_sec = sSec;
          modCopy.trim_end_sec = eSec;
        }
      }

      scene.media_modifiers = {
        ...(scene.media_modifiers || {}),
        ...modCopy,
      };
      scene.ai_intent_prompt = pStr;
      scene.ai_speech_reply = parsed.ai_speech_reply || parsed.summary || '';
    } else if (parsed.action === 'switch_procedural' && scene.source_mode !== 'manual_upload') {
      scene.scene_type = parsed.scene_type;
      scene.visual_type = parsed.scene_type;
      scene.source_mode = 'ai_ppt_slide';
      scene.procedural_props = parsed.procedural_props;
      scene.ai_intent_prompt = pStr;
      scene.ai_speech_reply = parsed.ai_speech_reply || parsed.summary || '';
    } else {
      scene.ai_intent_prompt = pStr;
      scene.ai_speech_reply = parsed.ai_speech_reply || parsed.summary || '已保留当前「人工上传素材」模式，请指定下载时间段或上传/下载素材后继续编辑。';
    }

    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: true,
        manifest,
        scene,
        isAi: Boolean(parsed.isAi),
        modelUsed: parsed.modelUsed || '大模型调优引擎',
        summary: parsed.summary || `已由 AI 编译口语指令「${pStr.slice(0, 15)}...」`,
        message: parsed.summary || `已由 ${parsed.modelUsed || '大模型'} 编译指令「${pStr}」`,
      })
    );
  }

  // 7.6 重置动效与剪辑参数
  if (req.method === 'POST' && pathname === '/api/reset-modifiers') {
    const body = await readBody(req);
    const { sceneId, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (scene) {
      scene.media_modifiers = undefined;
      scene.trim_start_sec = undefined;
      scene.trim_end_sec = undefined;
      scene.trim_prompt = undefined;
      scene.ai_intent_prompt = undefined;
      scene.ai_speech_reply = undefined;
      scene.download_clip_start_sec = undefined;
      scene.download_clip_end_sec = undefined;
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, manifest }));
  }

  // 8. 清除素材绑定
  if (req.method === 'POST' && pathname === '/api/clear-asset') {
    const body = await readBody(req);
    const { sceneId, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (scene) {
      scene.final_asset_id = null;
      scene.shared_asset_with_prev = false;
      scene.trim_start_sec = undefined;
      scene.trim_end_sec = undefined;
      scene.trim_prompt = undefined;
      scene.ai_intent_prompt = undefined;
      scene.media_modifiers = undefined;
      scene.source_mode = 'manual_upload';
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, manifest }));
  }

  // 8.5 持久化切换单镜头画面生成方式
  if (req.method === 'POST' && pathname === '/api/set-scene-mode') {
    const body = await readBody(req);
    const { sceneId, sourceMode, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (!scene) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '找不到指定镜头' }));
    }

    if (typeof sourceMode === 'string' && ALLOWED_SOURCE_MODES.has(sourceMode)) {
      scene.source_mode = sourceMode;
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, scene }));
  }

  // 9. 镜头连用共用素材绑定
  if (req.method === 'POST' && pathname === '/api/link-asset') {
    const body = await readBody(req);
    const { sceneId, assetId, isSharedWithPrev, projectId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);

    const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
    if (scene) {
      scene.source_mode = 'manual_upload';
      scene.visual_type = 'broll_video';
      scene.scene_type = 'broll_video';
      scene.final_asset_id = assetId || null;
      scene.shared_asset_with_prev = Boolean(isSharedWithPrev);
      scene.status = assetId ? 'READY_APPROVED' : 'NEEDS_HUMAN_ASSET';
    }
    syncTableToManifest(manifest);
    fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    recompileProject(targetProject);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, manifest }));
  }

  return false;
}
