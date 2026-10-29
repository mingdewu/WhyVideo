import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const PORT = process.env.PORT || 4000;
const defaultProjectId = 'why_ai_renamed_to_si_001';

// 优先读取 .env
function loadEnv() {
  const envPath = path.resolve(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
}
loadEnv();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function getPaths(projectId = defaultProjectId) {
  const projectDir = path.join(rootDir, 'projects', projectId);
  return {
    projectId,
    projectDir,
    dataDir: path.join(projectDir, 'data'),
    publicDir: path.join(projectDir, 'public'),
    outputDir: path.join(projectDir, 'output'),
    manifestPath: path.join(projectDir, 'data', 'scene-manifest.json'),
    assetIndexPath: path.join(projectDir, 'data', 'asset-index.json'),
    statusPath: path.join(projectDir, 'data', 'project-status.json'),
    promptConfigPath: path.join(projectDir, 'data', 'prompt-config.json'),
    finalScriptPath: path.join(projectDir, 'data', 'final-script.json'),
    videoPath: path.join(projectDir, 'output', 'final_video_1080p.mp4'),
    audioDir: path.join(projectDir, 'public', 'audio'),
  };
}

// 动态获取 projects/ 下所有工程清单
function listProjects() {
  const projectsDir = path.join(rootDir, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const list = [];

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const pId = ent.name;
    const paths = getPaths(pId);

    let title = pId;
    let stage = '新建工程';
    let scenesCount = 0;
    let hasVideo = fs.existsSync(paths.videoPath);
    let hasScript = fs.existsSync(paths.finalScriptPath);
    let hasManifest = fs.existsSync(paths.manifestPath);

    if (hasScript) {
      try {
        const sc = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8'));
        if (sc.title) title = `《${sc.title}》`;
      } catch (e) {}
    }

    if (hasManifest) {
      try {
        const mf = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
        scenesCount = (mf.scenes || []).length;
        if (mf.project_title && title === pId) title = `《${mf.project_title}》`;
      } catch (e) {}
    }

    if (hasVideo) {
      stage = `已渲染 1080p 成片 · ${scenesCount} 镜头`;
    } else if (hasManifest && scenesCount > 0) {
      stage = `分镜已就绪 (${scenesCount} 句/镜头) · 待配音/渲染`;
    } else if (hasScript) {
      stage = '文案已定稿 · 待编排分镜';
    }

    list.push({
      id: pId,
      title,
      stage,
      scenesCount,
      hasVideo,
      hasScript,
      hasManifest,
    });
  }

  return list.sort((a, b) => (a.id === defaultProjectId ? -1 : 1));
}

function ensureTableFields(manifest) {
  let changed = false;
  for (const s of manifest.scenes || []) {
    if (!s.source_mode) {
      s.source_mode = ['broll_video', 'photo_motion'].includes(s.visual_type)
        ? 'manual_upload'
        : 'ai_ppt_slide';
      changed = true;
    }
    if (!Array.isArray(s.content_keywords) || s.content_keywords.length === 0) {
      s.content_keywords =
        s.search_queries_zh && s.search_queries_zh.length > 0
          ? s.search_queries_zh
          : ['核心主题', '深度洞察'];
      changed = true;
    }
    if (!s.ppt_slide_spec) {
      const kw = s.content_keywords[0] || '核心观点';
      s.ppt_slide_spec = {
        theme_title:
          s.procedural_props?.headline ||
          s.fallback?.component_spec ||
          (kw.length >= 4 ? kw : `「${kw}」`),
        subtitle: s.procedural_props?.subheadline || s.visual_purpose || s.narration_text.slice(0, 24),
        bullet_points:
          s.procedural_props?.items && s.procedural_props.items.length > 0
            ? s.procedural_props.items
            : [`核心要义：${s.narration_text.slice(0, 20)}`, `标志关键词：${s.content_keywords.join(' · ')}`],
        custom_prompt: '',
      };
      changed = true;
    }
  }
  return changed;
}

function syncTableToManifest(manifest) {
  for (const s of manifest.scenes || []) {
    const kws = Array.isArray(s.content_keywords) ? s.content_keywords : [];
    const ppt = s.ppt_slide_spec || {};

    if (s.source_mode === 'ai_ppt_slide') {
      if (['broll_video', 'photo_motion'].includes(s.visual_type)) {
        s.visual_type = 'data_card';
        s.scene_type = 'data_card';
      }
      s.status = 'READY_PROCEDURAL';
      s.procedural_props = {
        badge_label: `AI 生成画面 · ${kws.slice(0, 2).join(' / ') || s.scene_id}`,
        headline: ppt.theme_title || s.narration_text.slice(0, 16),
        subheadline: ppt.subtitle || `核心表达：${kws.join(' · ')}`,
        items:
          Array.isArray(ppt.bullet_points) && ppt.bullet_points.length > 0
            ? ppt.bullet_points
            : kws.map((k) => `核心表达：${k}`),
        accent_color: s.procedural_props?.accent_color || '#6366f1',
      };
    } else {
      if (!['broll_video', 'photo_motion'].includes(s.visual_type)) {
        s.visual_type = 'photo_motion';
        s.scene_type = 'photo_motion';
      }
      if (s.final_asset_id) {
        s.status = 'READY_APPROVED';
      } else {
        s.status = 'NEEDS_HUMAN_ASSET';
      }
    }
  }
}

function recompileProject(projectId) {
  spawnSync(
    'node',
    ['packages/qc-tools/generate-render-props.mjs', '--project', projectId],
    { cwd: rootDir, stdio: 'inherit' }
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const queryProject = url.searchParams.get('project') || defaultProjectId;
  const paths = getPaths(queryProject);

  try {
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

    // 1. 获取工作流完整数据 (镜头清单 + 素材库 + Prompt配置 + 工程信息)
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
      const assetIndex = fs.existsSync(paths.assetIndexPath)
        ? JSON.parse(fs.readFileSync(paths.assetIndexPath, 'utf8'))
        : { assets: [] };
      const promptConfig = fs.existsSync(paths.promptConfigPath)
        ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'))
        : {
            global_ai_visual_prompt:
              '作为 16:9 高规格纪录片视觉总监，根据本句【旁白原文】与【内容关键词】，在整个 16:9 画面中确立 1 个醒目标志性的核心关键词（字号大、冲击力强，不超过 14 字），并配 1 条副级阐述，用于动态视觉传达。',
          };

      let audioFile = null;
      if (fs.existsSync(paths.audioDir)) {
        const audios = fs.readdirSync(paths.audioDir).filter((f) => /\.(mp3|wav)$/i.test(f));
        if (audios.length > 0) audioFile = `/public/${queryProject}/audio/${audios[0]}`;
      }

      const hasVideo = fs.existsSync(paths.videoPath);
      const videoUrl = hasVideo ? `/output/${queryProject}/final_video_1080p.mp4` : null;

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
        })
      );
    }

    // 2. 保存数据库表格修改并同步至 Remotion
    if (req.method === 'POST' && pathname === '/api/workflow-save') {
      const body = await readBody(req);
      const targetProject = body.projectId || queryProject;
      const curPaths = getPaths(targetProject);

      if (body.promptConfig) {
        fs.writeFileSync(
          curPaths.promptConfigPath,
          JSON.stringify(body.promptConfig, null, 2),
          'utf8'
        );
      }
      if (body.manifest) {
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
      return res.end(JSON.stringify({ ok: true, manifest: updatedManifest }));
    }

    // 3. 按关键词 + Prompt 自动提炼生成单行或全部 AI 视觉画面（醒目标识词 + 副题）
    if (req.method === 'POST' && pathname === '/api/generate-ppt') {
      const body = await readBody(req);
      const { sceneId, globalPrompt, manifest, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      if (globalPrompt !== undefined) {
        fs.writeFileSync(
          curPaths.promptConfigPath,
          JSON.stringify(
            { global_ai_visual_prompt: globalPrompt, updated_at: new Date().toISOString() },
            null,
            2
          ),
          'utf8'
        );
      }

      const targetManifest =
        manifest || JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));

      for (const s of targetManifest.scenes || []) {
        if (sceneId && s.scene_id !== sceneId) continue;
        if (!sceneId && s.source_mode !== 'ai_ppt_slide') continue;

        s.source_mode = 'ai_ppt_slide';
        const kws =
          Array.isArray(s.content_keywords) && s.content_keywords.length > 0
            ? s.content_keywords
            : ['核心观点'];
        const rowPrompt = s.ppt_slide_spec?.custom_prompt || '';

        // 16:9 核心标志大字：醒目、凝练
        const mainKw = kws[0];
        const mainTitle = mainKw.length >= 4 ? mainKw : `「${mainKw}」`;

        const subtitle = rowPrompt
          ? `视觉重心：${rowPrompt}`
          : (s.narration_text.length > 26 ? s.narration_text.slice(0, 26) + '...' : s.narration_text);

        const bullets = [
          `核心要义：${s.narration_text.slice(0, 22)}`,
          `标志关键词：${kws.join(' · ')}`
        ];

        s.ppt_slide_spec = {
          theme_title: mainTitle,
          subtitle,
          bullet_points: bullets,
          custom_prompt: rowPrompt,
        };
      }

      syncTableToManifest(targetManifest);
      fs.writeFileSync(
        curPaths.manifestPath,
        JSON.stringify(targetManifest, null, 2),
        'utf8'
      );
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, manifest: targetManifest }));
    }

    // 4. 人工上传本地视频/图片素材并直接绑定到对应镜头行
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
      const isVideo =
        (fileType && fileType.startsWith('video/')) ||
        /\.(mp4|mov|webm)$/i.test(fileName);
      const folder = isVideo ? 'assets/video' : 'assets/images';
      const safeFile = `${sceneId.toLowerCase()}_${Date.now()}_${fileName.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )}`;
      const relPath = `${folder}/${safeFile}`;
      const diskPath = path.join(curPaths.publicDir, relPath);

      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, buffer);

      const assetIndex = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'));
      const newAssetId = `${isVideo ? 'AST-VID-' : 'AST-IMG-'}${String(
        assetIndex.assets.length + 1
      ).padStart(3, '0')}`;

      const newAsset = {
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${targetProject}/public/${relPath}`,
        type: isVideo ? 'video' : 'image',
        media_type: isVideo ? 'video' : 'image',
        duration_seconds: isVideo ? 16.0 : null,
        duration_sec: isVideo ? 16.0 : null,
        resolution: '1920x1080',
        license_status: 'approved',
        source_url: `manual_upload://${safeFile}`,
        tags: ['人工上传', sceneId, fileName],
      };
      assetIndex.assets.push(newAsset);
      fs.writeFileSync(
        curPaths.assetIndexPath,
        JSON.stringify(assetIndex, null, 2),
        'utf8'
      );

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.source_mode = 'manual_upload';
        scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
        scene.scene_type = scene.visual_type;
        scene.final_asset_id = newAssetId;
        scene.status = 'READY_APPROVED';
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ok: true,
          uploadedAsset: newAsset,
          manifest,
          assetIndex,
        })
      );
    }

    // 5. 镜头连用共用素材绑定接口
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

    // 6. ElevenLabs / 本地 Voicebox 配音合成接口
    if (req.method === 'POST' && pathname === '/api/synthesize-voice') {
      const body = await readBody(req);
      const {
        projectId = queryProject,
        provider = 'elevenlabs',
        voiceId = '21m00Tcm4TlvDq8ikWAM',
        apiKey,
        text,
        sceneId,
      } = body;
      const curPaths = getPaths(projectId);
      fs.mkdirSync(curPaths.audioDir, { recursive: true });

      if (provider === 'elevenlabs') {
        const effectiveKey = apiKey || process.env.ELEVENLABS_API_KEY;
        if (!effectiveKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error:
                '未配置 ElevenLabs API Key。请在操作界面中输入或在根目录 .env 中写入 ELEVENLABS_API_KEY=xxx',
            })
          );
        }

        const outFileName = sceneId
          ? `voice_${sceneId.toLowerCase()}.mp3`
          : `narration_${Date.now()}.mp3`;
        const outFilePath = path.join(curPaths.audioDir, outFileName);

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              Accept: 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': effectiveKey,
            },
            body: JSON.stringify({
              text: text || '这是来自 WhyVideo 操作界面的测试旁白音频。',
              model_id: 'eleven_multilingual_v2',
              voice_settings: {
                stability: 0.65,
                similarity_boost: 0.8,
                style: 0.15,
                use_speaker_boost: true,
              },
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({ error: `ElevenLabs 接口调用失败: ${errText}` })
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outFilePath, Buffer.from(arrayBuffer));

        const publicAudioUrl = `/public/${projectId}/audio/${outFileName}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            ok: true,
            audioUrl: publicAudioUrl,
            message: `ElevenLabs 配音已成功保存至 ${outFileName}`,
          })
        );
      } else if (provider === 'voicebox') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(
          JSON.stringify({
            ok: false,
            message:
              'Voicebox 本地模型已预留端口连接配置。请确保您的本地 Voicebox 服务已启动于 http://localhost:8080，或切换上方 ElevenLabs 进行一键合成。',
          })
        );
      }
    }

    // 7. 静态媒体文件路由 (支持预览视频与音频流，按工程隔离)
    if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
      const parts = pathname.split('/').filter(Boolean);
      let proj = queryProject;
      let relSubPath = '';

      if (parts.length >= 3 && listProjects().some((p) => p.id === parts[1])) {
        proj = parts[1];
        relSubPath = parts.slice(2).join('/');
      } else {
        relSubPath = parts.slice(1).join('/');
      }

      const filePath = path.join(rootDir, 'projects', proj, parts[0], relSubPath);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);

        const range = req.headers.range;
        if (range) {
          const rParts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(rParts[0], 10);
          const end = rParts[1] ? parseInt(rParts[1], 10) : stat.size - 1;
          const chunksize = end - start + 1;
          const file = fs.createReadStream(filePath, { start, end });
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
          });
          return file.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
          });
          return fs.createReadStream(filePath).pipe(res);
        }
      }
    }

    // 主工作流数据库表格页面
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMainHtml());
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

function startServer(portToTry) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && portToTry === 4000) {
      startServer(4200);
    } else {
      throw err;
    }
  });
  server.listen(portToTry, '0.0.0.0', () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 WhyVideo 多工程全流程操作工作台已成功启动！`);
    console.log(`👉 请在浏览器中打开：http://localhost:${portToTry}`);
    console.log(`=============================================================\n`);
  });
}
startServer(Number(PORT));

function renderMainHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhyVideo Studio - 分镜工作台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0B0F17; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .card { background-color: #151D2A; border: 1px solid #233044; }
    .db-table th { background-color: #1A2436; border-bottom: 2px solid #2E3D52; border-right: 1px solid #233044; }
    .db-table td { border-bottom: 1px solid #233044; border-right: 1px solid #233044; vertical-align: top; }
    .db-table tr:hover td { background-color: #192334; }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-6">
  <div class="max-w-[1700px] mx-auto space-y-5">

    <!-- 顶部导航栏与工程选择 -->
    <header class="flex flex-col lg:flex-row lg:items-center justify-between pb-4 border-b border-gray-800 gap-4">
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            WhyVideo Studio v2.8 · 逐句分镜版
          </span>
          
          <!-- 工程选择器 -->
          <div class="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-inner">
            <span class="text-xs font-bold text-amber-300">📁 切换制作工程：</span>
            <select id="projectSelect" onchange="onProjectChange(this.value)" class="bg-gray-950 text-white font-extrabold text-xs px-2 py-1 rounded-lg border border-gray-700 focus:outline-none focus:border-amber-400 cursor-pointer">
            </select>
          </div>

          <span id="projectStageBadge" class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            加载中...
          </span>
        </div>

        <h1 id="projectHeaderTitle" class="text-2xl font-black text-white mt-2">
          分镜工作流操作台（一句旁白一个画面 · 镜头连用与 AI 画面）
        </h1>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white transition shadow-lg flex items-center gap-1.5">
          🎙️ ElevenLabs / 本地配音配置
        </button>
        <button onclick="generateAllPpt()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition shadow-lg flex items-center gap-1.5">
          ⚡ 批量生成 AI 画面
        </button>
        <button onclick="saveAll()" class="px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 transition shadow-lg">
          💾 保存分镜表格并同步 Remotion
        </button>
        <a href="http://localhost:3100" target="_blank" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-blue-500 text-blue-300 transition">
          🎬 Remotion 预览 (:3100) ↗
        </a>
      </div>
    </header>

    <!-- 视频预览 / 工程状态概览 -->
    <div id="videoContainer" class="card p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
    </div>

    <!-- 全局 AI 画面规则配置 + 统计卡片 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div class="lg:col-span-8 card p-4 rounded-2xl space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-purple-300">🤖 全局 AI 画面生成规则（在 16:9 画幅中提炼醒目标志关键词与核心视觉重心）</span>
          <span class="text-[11px] text-gray-400">一句旁白对应一个 16:9 视觉画面</span>
        </div>
        <textarea id="globalPromptInput" rows="2" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-gray-100 focus:outline-none focus:border-purple-500" placeholder="在此输入你的 AI 画面生成规则..."></textarea>
      </div>

      <div class="lg:col-span-4 grid grid-cols-3 gap-3">
        <div class="card p-3.5 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-gray-400">总镜头行 (句)</span>
          <span class="text-2xl font-black text-white mt-1" id="statTotal">-</span>
        </div>
        <div class="card p-3.5 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-purple-300">🤖 AI 生成画面</span>
          <span class="text-2xl font-black text-purple-400 mt-1" id="statPpt">-</span>
        </div>
        <div class="card p-3.5 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-sky-300">📤 人工素材/连用</span>
          <span class="text-2xl font-black text-sky-400 mt-1" id="statUpload">-</span>
        </div>
      </div>
    </div>

    <!-- 分镜主表格 -->
    <div class="card rounded-2xl overflow-hidden border border-gray-800">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs db-table border-collapse">
          <thead>
            <tr class="text-gray-300 font-bold uppercase tracking-wider text-[11px]">
              <th class="p-3 w-28 text-center">镜头序号 / 归属</th>
              <th class="p-3 min-w-[300px]">旁白原文（一句一段 · 支持微调断句）</th>
              <th class="p-3 min-w-[200px]">核心标志关键词 (用逗号分隔)</th>
              <th class="p-3 w-44">画面方式选择</th>
              <th class="p-3 min-w-[340px]">AI 生成画面视觉设计（16:9 醒目主标 / 视觉重心 / 核心要点）</th>
              <th class="p-3 w-48 text-center">绑定素材 / 镜头连用</th>
            </tr>
          </thead>
          <tbody id="tableBody" class="divide-y divide-gray-800">
          </tbody>
        </table>
      </div>

      <div class="p-3 bg-gray-900/60 border-t border-gray-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button onclick="addNewRow()" class="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition">
            ➕ 在末尾追加分镜行
          </button>
          <span class="text-[11px] text-gray-400">💡 提示：在【绑定素材/镜头连用】列中，点击「🔗 与上一镜头连用」即可让多个连续镜头共用同一个上传的长视频。</span>
        </div>
        <button onclick="saveAll()" class="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-bold transition">
          💾 保存全部更改
        </button>
      </div>
    </div>

  </div>

  <!-- 配音配置抽屉/弹窗 -->
  <div id="audioModal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="card w-full max-w-xl p-6 rounded-2xl border border-rose-500/40 shadow-2xl space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <h3 class="text-lg font-bold text-white flex items-center gap-2">
          🎙️ AI 配音引擎控制中心
        </h3>
        <button onclick="toggleAudioModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">选择配音提供商：</label>
          <div class="grid grid-cols-2 gap-3">
            <label class="flex items-center gap-2 p-2.5 rounded-xl border border-rose-500 bg-rose-500/10 cursor-pointer text-xs font-bold text-rose-200">
              <input type="radio" name="audioProvider" value="elevenlabs" checked />
              <span>ElevenLabs (Multilingual v2)</span>
            </label>
            <label class="flex items-center gap-2 p-2.5 rounded-xl border border-gray-700 bg-gray-900 cursor-pointer text-xs font-bold text-gray-400">
              <input type="radio" name="audioProvider" value="voicebox" />
              <span>Voicebox 本地模型 (预留)</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">
            ElevenLabs API Key：
            <a href="https://elevenlabs.io" target="_blank" class="text-rose-400 hover:underline text-[11px] font-normal ml-2">获取 API Key ↗</a>
          </label>
          <input type="password" id="elevenlabsKeyInput" placeholder="在此输入 xi-api-key（或在根目录 .env 中写入）..." class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">精选纪录片音色 (Voice ID)：</label>
          <select id="voiceIdSelect" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500">
            <option value="21m00Tcm4TlvDq8ikWAM">Rachel - 知性沉稳纪录片女主播 (推荐中文)</option>
            <option value="ErXwobaYiN019PkySvjV">Antoni - 沉静克制学术旁白 (男声)</option>
            <option value="pNInz6obpgDQGcFmaJgB">Adam - 权威宏大历史讲述 (深沉男声)</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1">试听或测试文本：</label>
          <textarea id="sampleAudioText" rows="2" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-rose-500">这是来自 WhyVideo 工作台的高保真纪录片旁白语音测试。</textarea>
        </div>

        <div id="audioPlayerContainer" class="hidden p-3 rounded-xl bg-gray-950 border border-gray-800">
          <audio id="audioPreviewPlayer" controls class="w-full h-8"></audio>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-gray-800">
        <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
          关闭
        </button>
        <button onclick="synthesizeTestVoice()" id="btnSynth" class="px-5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition shadow-lg">
          🔊 立即生成测试配音
        </button>
      </div>
    </div>
  </div>

  <!-- Toast 提示 -->
  <div id="toast" class="fixed bottom-6 right-6 px-4 py-2.5 rounded-xl bg-amber-500 text-gray-950 font-extrabold text-xs shadow-2xl transition duration-300 hidden z-50">
  </div>

  <script>
    let activeProjectId = new URLSearchParams(window.location.search).get('project') || localStorage.getItem('whyvideo_active_project') || 'why_ai_renamed_to_si_001';
    let manifestData = null;
    let assetIndexData = null;
    let projectsList = [];

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 2600);
    }

    function toggleAudioModal() {
      const m = document.getElementById('audioModal');
      m.classList.toggle('hidden');
    }

    async function loadProjects() {
      try {
        const res = await fetch('/api/projects?project=' + activeProjectId);
        const data = await res.json();
        projectsList = data.projects || [];
        
        if (!projectsList.some(p => p.id === activeProjectId) && projectsList.length > 0) {
          activeProjectId = projectsList[0].id;
        }

        const sel = document.getElementById('projectSelect');
        sel.innerHTML = projectsList.map(p => \`
          <option value="\${p.id}" \${p.id === activeProjectId ? 'selected' : ''}>
            \${p.title} (\${p.id})
          </option>
        \`).join('');

        const cur = projectsList.find(p => p.id === activeProjectId);
        if (cur) {
          document.getElementById('projectStageBadge').textContent = cur.stage;
          document.getElementById('projectHeaderTitle').textContent = cur.title + ' · 分镜工作台';
        }
      } catch (e) {
        console.error('加载工程列表失败:', e);
      }
    }

    function onProjectChange(newId) {
      activeProjectId = newId;
      localStorage.setItem('whyvideo_active_project', newId);
      const url = new URL(window.location);
      url.searchParams.set('project', newId);
      window.history.pushState({}, '', url);
      loadProjects();
      loadWorkflow();
      showToast('🔀 已切换至工程：' + newId);
    }

    async function loadWorkflow() {
      try {
        const res = await fetch('/api/workflow-data?project=' + activeProjectId);
        if (!res.ok) {
          showToast('⚠️ 当前工程数据正在初始化...');
          return;
        }
        const data = await res.json();
        manifestData = data.manifest;
        assetIndexData = data.assetIndex;
        document.getElementById('globalPromptInput').value =
          data.promptConfig?.global_ai_visual_prompt || '';

        renderVideoContainer(data);
        renderTable();
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    }

    function renderVideoContainer(data) {
      const c = document.getElementById('videoContainer');
      const count = manifestData?.scenes?.length || 0;
      if (data.hasVideo && data.videoUrl) {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">1080p 纯净正片已就绪</span>
              <span class="text-xs text-gray-400">已对齐 \${count} 个镜头画面</span>
            </div>
            <p class="text-xs text-gray-300 font-medium">当前工程已完成高规格 Remotion 渲染，支持边查阅表格边拖拽播放进度检验音画。</p>
          </div>
          <div class="w-full md:w-96 rounded-xl overflow-hidden border border-gray-700 bg-black aspect-video flex items-center justify-center">
            <video src="\${data.videoUrl}" controls class="w-full h-full object-contain"></video>
          </div>
        \`;
      } else {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">逐句分镜已就绪 · \${count} 句/镜头</span>
              <span class="text-xs text-gray-400">总时长约 \${((manifestData?.total_duration_sec || 0)/60).toFixed(1)} 分钟</span>
            </div>
            <p class="text-xs text-gray-300">每一句旁白对应一个独立的 16:9 画面！您可以选择“AI 生成画面”（醒目大字主题卡），也可以选择“人工上传素材”（支持多个连续镜头共用同一个视频）。</p>
          </div>
          <div class="flex items-center gap-3">
            <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition">
              🎙️ 打开配音控制台
            </button>
            <a href="http://localhost:3100" target="_blank" class="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition">
              🎬 打开 Remotion 预览
            </a>
          </div>
        \`;
      }
    }

    function updateCounters() {
      const scenes = manifestData?.scenes || [];
      const pptCount = scenes.filter((s) => s.source_mode === 'ai_ppt_slide').length;
      const uploadCount = scenes.filter((s) => s.source_mode === 'manual_upload').length;
      document.getElementById('statTotal').textContent = scenes.length + ' 句';
      document.getElementById('statPpt').textContent = pptCount + ' 句';
      document.getElementById('statUpload').textContent = uploadCount + ' 句';
    }

    function renderTable() {
      updateCounters();
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      (manifestData?.scenes || []).forEach((scene, idx) => {
        const isAi = scene.source_mode === 'ai_ppt_slide';
        const ppt = scene.ppt_slide_spec || {};
        const kws = Array.isArray(scene.content_keywords) ? scene.content_keywords : [];
        const isSharedWithPrev = Boolean(scene.shared_asset_with_prev);

        const tr = document.createElement('tr');
        tr.className = 'transition ' + (isSharedWithPrev ? 'bg-sky-950/20' : '');

        // 1. 镜头序号与时间
        const td1 = document.createElement('td');
        td1.className = 'p-3 text-center';
        td1.innerHTML = \`
          <span class="px-2 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-amber-400 font-extrabold text-xs block mb-1">
            \${scene.scene_id}
          </span>
          <span class="text-[11px] text-gray-400 font-mono block">
            \${(scene.start_ms / 1000).toFixed(1)}s - \${(scene.end_ms / 1000).toFixed(1)}s
          </span>
          <span class="text-[10px] text-gray-500 block mt-0.5">\${scene.chapter_ref || ''}</span>
        \`;

        // 2. 旁白原文
        const td2 = document.createElement('td');
        td2.className = 'p-3';
        td2.innerHTML = \`
          <textarea rows="3" class="w-full p-2.5 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-xs leading-relaxed focus:border-blue-500 focus:outline-none"
            onchange="onNarrationEdit(\${idx}, this.value)">\${scene.narration_text}</textarea>
        \`;

        // 3. 核心标志关键词
        const td3 = document.createElement('td');
        td3.className = 'p-3';
        const chips = kws
          .map(
            (k) =>
              \`<span class="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-semibold"># \${k}</span>\`
          )
          .join('');
        td3.innerHTML = \`
          <div class="flex flex-wrap gap-1 mb-1.5">\${chips}</div>
          <input type="text" value="\${kws.join(', ')}"
            placeholder="核心标志词，用逗号分隔..."
            class="w-full px-2.5 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-gray-100 text-xs focus:border-purple-400 focus:outline-none font-semibold"
            onchange="onKeywordsEdit(\${idx}, this.value)" />
          <p class="text-[10px] text-gray-500 mt-1">将在 16:9 画幅中央作为醒目标志大字展示</p>
        \`;

        // 4. 画面生成方式选择
        const td4 = document.createElement('td');
        td4.className = 'p-3';
        td4.innerHTML = \`
          <div class="space-y-1.5">
            <label onclick="setMode(\${idx}, 'ai_ppt_slide')" class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition \${
              isAi
                ? 'bg-purple-500/20 border-purple-500 text-purple-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_\${idx}" \${isAi ? 'checked' : ''} />
              <span class="text-xs">🤖 AI 生成画面</span>
            </label>
            <label onclick="setMode(\${idx}, 'manual_upload')" class="flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition \${
              !isAi
                ? 'bg-sky-500/20 border-sky-500 text-sky-200 font-bold'
                : 'bg-gray-950 border-gray-800 text-gray-400'
            }">
              <input type="radio" name="mode_\${idx}" \${!isAi ? 'checked' : ''} />
              <span class="text-xs">📤 人工上传素材</span>
            </label>
          </div>
        \`;

        // 5. AI 生成画面视觉设计
        const td5 = document.createElement('td');
        td5.className = 'p-3';
        const bulletsText = (ppt.bullet_points || []).join('\\n');
        td5.innerHTML = \`
          <div class="space-y-1.5 \${isAi ? '' : 'opacity-40 pointer-events-none'}">
            <div>
              <span class="text-[10px] text-gray-400">16:9 核心标志大字（醒目标识）：</span>
              <input type="text" value="\${ppt.theme_title || ''}" placeholder="例如：「国家级语义战争」"
                class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-purple-500/40 text-purple-200 font-black text-xs focus:border-purple-400 focus:outline-none"
                onchange="onPptThemeEdit(\${idx}, 'theme_title', this.value)" />
            </div>
            <div>
              <span class="text-[10px] text-gray-400">副级阐述 / 视觉重心：</span>
              <input type="text" value="\${ppt.subtitle || ''}" placeholder="例如：核心表达：时代断代 · 规制套利"
                class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-gray-700 text-gray-200 text-xs focus:border-purple-400 focus:outline-none"
                onchange="onPptThemeEdit(\${idx}, 'subtitle', this.value)" />
            </div>
            <div>
              <span class="text-[10px] text-gray-400">核心要点 (每行一条)：</span>
              <textarea rows="2" class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-gray-700 text-gray-300 text-xs focus:border-purple-400 focus:outline-none"
                onchange="onPptBulletsEdit(\${idx}, this.value)">\${bulletsText}</textarea>
            </div>
            <div class="flex items-center justify-between pt-0.5">
              <button onclick="generateRowPpt(\${idx})" class="px-2 py-1 rounded-lg bg-purple-600/30 hover:bg-purple-600 border border-purple-500/50 text-purple-200 text-[11px] font-semibold transition">
                ⚡ 重新提炼本行 AI 画面
              </button>
            </div>
          </div>
        \`;

        // 6. 绑定素材 / 镜头连用
        const td6 = document.createElement('td');
        td6.className = 'p-3 text-center';

        if (isAi) {
          td6.innerHTML = \`
            <div class="p-2.5 rounded-xl bg-purple-950/40 border border-purple-800 text-purple-300 text-xs font-semibold space-y-1">
              <span>🤖 16:9 动态视觉</span>
              <span class="text-[10px] text-gray-400 block">程序化提炼标志词</span>
            </div>
          \`;
        } else {
          // 人工上传或连用
          const asset = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
          const prevScene = idx > 0 ? manifestData.scenes[idx - 1] : null;

          let linkHtml = '';
          if (idx > 0 && prevScene) {
            if (isSharedWithPrev) {
              linkHtml = \`
                <div class="p-1.5 rounded-lg bg-sky-950/60 border border-sky-500/50 text-[11px] text-sky-300 font-bold flex items-center justify-between gap-1 mb-1.5">
                  <span>🔗 与上一镜头连用</span>
                  <button onclick="unlinkScene(\${idx})" class="text-rose-400 hover:text-rose-300 text-xs">✕ 取消</button>
                </div>
              \`;
            } else {
              linkHtml = \`
                <button onclick="linkWithPrevious(\${idx})" class="w-full px-2 py-1 rounded-lg bg-gray-800 hover:bg-sky-600 border border-gray-700 hover:border-sky-400 text-gray-300 hover:text-white text-[11px] font-semibold transition mb-1.5 block">
                  🔗 与上一镜头连用 (共用视频)
                </button>
              \`;
            }
          }

          if (asset) {
            td6.innerHTML = \`
              <div class="space-y-1">
                \${linkHtml}
                <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-500/20 text-sky-300 block">
                  \${asset.asset_id}
                </span>
                <span class="text-[10px] text-gray-400 block truncate" title="\${asset.file_path}">
                  \${asset.type} · \${asset.resolution || '1080p'}
                </span>
                <button onclick="document.getElementById('fileInput_\${idx}').click()" class="text-[11px] text-sky-400 hover:underline block mx-auto">
                  重新上传替换
                </button>
              </div>
            \`;
          } else {
            td6.innerHTML = \`
              <div class="space-y-1">
                \${linkHtml}
                <button onclick="document.getElementById('fileInput_\${idx}').click()" class="w-full px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow">
                  📤 上传新视频/图片
                </button>
                <span class="text-[10px] text-gray-400 block">或选择连用上一镜头</span>
              </div>
            \`;
          }
        }

        const hiddenFile = document.createElement('input');
        hiddenFile.type = 'file';
        hiddenFile.id = 'fileInput_' + idx;
        hiddenFile.className = 'hidden';
        hiddenFile.accept = 'video/*,image/*';
        hiddenFile.onchange = (e) => uploadFileForRow(idx, e.target.files[0]);
        td6.appendChild(hiddenFile);

        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);
        tr.appendChild(td6);
        tbody.appendChild(tr);
      });
    }

    function onNarrationEdit(idx, val) {
      manifestData.scenes[idx].narration_text = val;
    }

    function onKeywordsEdit(idx, val) {
      const arr = val.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean);
      manifestData.scenes[idx].content_keywords = arr;
      if (arr.length > 0 && manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec.theme_title = arr[0].length >= 4 ? arr[0] : '「' + arr[0] + '」';
      }
      renderTable();
    }

    function setMode(idx, mode) {
      manifestData.scenes[idx].source_mode = mode;
      renderTable();
    }

    function onPptThemeEdit(idx, key, val) {
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec[key] = val;
    }

    function onPptBulletsEdit(idx, val) {
      const arr = val.split('\\n').map((s) => s.trim()).filter(Boolean);
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec.bullet_points = arr;
    }

    // 镜头连用：与上一镜头共用素材
    async function linkWithPrevious(idx) {
      if (idx <= 0) return;
      const prevScene = manifestData.scenes[idx - 1];
      const targetAssetId = prevScene.final_asset_id;

      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: targetAssetId,
          isSharedWithPrev: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('🔗 已与上一镜头 ' + prevScene.scene_id + ' 建立素材连用！');
      }
    }

    async function unlinkScene(idx) {
      const res = await fetch('/api/link-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: manifestData.scenes[idx].scene_id,
          assetId: null,
          isSharedWithPrev: false,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已取消与上一镜头的连用。');
      }
    }

    function addNewRow() {
      const scenes = manifestData.scenes || [];
      const last = scenes[scenes.length - 1];
      const nextNum = scenes.length + 1;
      const startMs = last ? last.end_ms : 0;
      const endMs = startMs + 8000;
      scenes.push({
        scene_id: 'SC-' + String(nextNum).padStart(3, '0'),
        scene_index: nextNum,
        chapter_ref: 'custom_section',
        start_ms: startMs,
        end_ms: endMs,
        duration_ms: 8000,
        visual_type: 'data_card',
        source_mode: 'ai_ppt_slide',
        visual_purpose: '新增自定义分镜段落',
        narration_text: '请在此输入这句旁白内容...',
        content_keywords: ['核心标志词'],
        ppt_slide_spec: {
          theme_title: '「核心标志词」',
          subtitle: '视觉重心阐述',
          bullet_points: ['核心要点 1', '核心要点 2'],
          custom_prompt: '',
        },
        status: 'READY_PROCEDURAL',
        final_asset_id: null,
        shared_asset_with_prev: false,
        fallback: {
          fallback_scene_type: 'data_card',
          component_spec: '新增视觉卡',
        },
        human_review_required: false,
        review_status: 'approved_by_user',
      });
      manifestData.total_duration_ms = endMs;
      manifestData.total_duration_sec = Number((endMs / 1000).toFixed(1));
      renderTable();
    }

    async function generateRowPpt(idx) {
      const scene = manifestData.scenes[idx];
      const globalPrompt = document.getElementById('globalPromptInput').value;
      const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          globalPrompt,
          manifest: manifestData,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✨ 已重新提炼 ' + scene.scene_id + ' 的 AI 画面！');
      }
    }

    async function generateAllPpt() {
      const globalPrompt = document.getElementById('globalPromptInput').value;
      const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: null,
          globalPrompt,
          manifest: manifestData,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('⚡ 已按关键词批量生成全部 16:9 AI 画面！');
      }
    }

    async function uploadFileForRow(idx, file) {
      if (!file) return;
      const scene = manifestData.scenes[idx];
      const reader = new FileReader();
      reader.onload = async () => {
        const res = await fetch('/api/upload-asset?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            fileName: file.name,
            fileType: file.type,
            dataUrl: reader.result,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          assetIndexData = data.assetIndex;
          renderTable();
          showToast('📤 已上传并绑定素材 ' + data.uploadedAsset.asset_id + '！');
        }
      };
      reader.readAsDataURL(file);
    }

    async function saveAll() {
      const globalPrompt = document.getElementById('globalPromptInput').value;
      const res = await fetch('/api/workflow-save?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          manifest: manifestData,
          promptConfig: {
            global_ai_visual_prompt: globalPrompt,
            updated_at: new Date().toISOString(),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✅ 已保存分镜表格，并同步至 Remotion 视频引擎！');
      }
    }

    async function synthesizeTestVoice() {
      const btn = document.getElementById('btnSynth');
      const apiKey = document.getElementById('elevenlabsKeyInput').value;
      const voiceId = document.getElementById('voiceIdSelect').value;
      const text = document.getElementById('sampleAudioText').value;

      btn.disabled = true;
      btn.textContent = '⏳ 正在合成中...';

      try {
        const res = await fetch('/api/synthesize-voice?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            provider: 'elevenlabs',
            voiceId,
            apiKey,
            text,
          }),
        });
        const data = await res.json();
        if (data.ok && data.audioUrl) {
          const playerCont = document.getElementById('audioPlayerContainer');
          const player = document.getElementById('audioPreviewPlayer');
          player.src = data.audioUrl;
          playerCont.classList.remove('hidden');
          player.play();
          showToast('🎉 配音合成成功！已自动播放');
        } else {
          alert(data.error || '合成配音失败');
        }
      } catch (err) {
        alert('配音请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔊 立即生成测试配音';
      }
    }

    // 初始化加载
    loadProjects().then(() => {
      loadWorkflow();
    });
  </script>
</body>
</html>`;
}
