import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const PORT = process.env.PORT || 4000;
const defaultProjectId = 'why_nikko_heritage_road_001';

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

// 动态挂载开发态 Antigravity 调试副驾驶 (发布生产环境时直接删除 dev-bridge.mjs 即可无缝自动剥离)
let devBridge = null;
try {
  devBridge = await import('./dev-bridge.mjs');
} catch (e) {
  devBridge = null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
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
    briefPath: path.join(projectDir, 'data', 'brief.json'),
    evidencePath: path.join(projectDir, 'data', 'evidence-cards.json'),
    outlinePath: path.join(projectDir, 'data', 'outline.json'),
    manifestPath: path.join(projectDir, 'data', 'scene-manifest.json'),
    assetIndexPath: path.join(projectDir, 'data', 'asset-index.json'),
    statusPath: path.join(projectDir, 'data', 'project-status.json'),
    promptConfigPath: path.join(projectDir, 'data', 'prompt-config.json'),
    finalScriptPath: path.join(projectDir, 'data', 'final-script.json'),
    videoPath: path.join(projectDir, 'output', 'final_video_1080p.mp4'),
    audioDir: path.join(projectDir, 'public', 'audio'),
    captionsPath: path.join(projectDir, 'public', 'captions', 'captions.srt'),
    propsPath: path.join(projectDir, 'public', 'render-props.json'),
  };
}

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
      stage = `视觉镜头就绪 (${scenesCount} 镜 · 4~8s 节奏) · 待配音/渲染`;
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

function msToSrt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

function syncCaptions(manifest, captionsPath) {
  if (!manifest?.scenes || !captionsPath) return;
  const srtLines = [];
  manifest.scenes.forEach((sc, i) => {
    srtLines.push(String(i + 1));
    srtLines.push(`${msToSrt(sc.start_ms)} --> ${msToSrt(sc.end_ms)}`);
    srtLines.push(sc.narration_text || '');
    srtLines.push('');
  });
  fs.mkdirSync(path.dirname(captionsPath), { recursive: true });
  fs.writeFileSync(captionsPath, srtLines.join('\n'), 'utf8');
}

function recalculateTimelines(manifest) {
  let cur = 0;
  (manifest.scenes || []).forEach((s, idx) => {
    s.scene_index = idx + 1;
    s.scene_id = `Shot-${String(idx + 1).padStart(3, '0')}`;
    const dur = s.duration_ms || Math.max(4200, Math.min(9500, Math.round((s.narration_text || '').length * 230)));
    s.duration_ms = dur;
    s.start_ms = cur;
    s.end_ms = cur + dur;
    cur += dur;
  });
  manifest.total_scenes = manifest.scenes.length;
  manifest.total_duration_ms = cur;
  manifest.total_duration_sec = Number((cur / 1000).toFixed(1));
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
      s.content_keywords = ['核心观点'];
      changed = true;
    }
    if (!s.ppt_slide_spec) {
      const kw = s.content_keywords[0] || '核心观点';
      s.ppt_slide_spec = {
        theme_title: kw.length >= 4 ? kw : `「${kw}」`,
        subtitle: s.narration_text.slice(0, 24),
        bullet_points: [`核心要义：${s.narration_text.slice(0, 20)}`, `标志关键词：${s.content_keywords.join(' · ')}`],
        custom_prompt: '',
      };
      changed = true;
    }
  }
  return changed;
}

function syncTableToManifest(manifest) {
  const validCardTypes = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
  for (const s of manifest.scenes || []) {
    const kws = Array.isArray(s.content_keywords) ? s.content_keywords : [];
    const ppt = s.ppt_slide_spec || {};

    if (s.source_mode === 'ai_ppt_slide') {
      if (!validCardTypes.includes(s.visual_type)) {
        s.visual_type = 'data_card';
        s.scene_type = 'data_card';
      }
      s.status = 'READY_PROCEDURAL';
      s.procedural_props = {
        badge_label: `AI 画面 · ${kws.slice(0, 2).join(' / ') || s.scene_id}`,
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
  const curPaths = getPaths(projectId);
  if (fs.existsSync(curPaths.manifestPath)) {
    const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    syncCaptions(mf, curPaths.captionsPath);
  }
  spawnSync(
    'node',
    ['packages/qc-tools/generate-render-props.mjs', '--project', projectId],
    { cwd: rootDir, stdio: 'inherit' }
  );
}

function scanLocalExportScripts() {
  const exportsDir = path.join(rootDir, 'exports');
  if (!fs.existsSync(exportsDir)) return [];
  const files = fs.readdirSync(exportsDir);
  const results = [];

  for (const f of files) {
    if (f.startsWith('.')) continue;
    const ext = path.extname(f).toLowerCase();
    if (!['.txt', '.md', '.json'].includes(ext)) continue;
    const fullPath = path.join(exportsDir, f);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(fullPath, 'utf8');

      let title = path.basename(f, ext);
      let suggestedProjectId = '';
      let wordCount = 0;
      let isFullScript = false;
      let preview = '';

      if (ext === '.json') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.title) title = parsed.title;
          if (parsed.project_id) suggestedProjectId = parsed.project_id;
          if (parsed.total_word_count) wordCount = parsed.total_word_count;
          if (parsed.script_segments) isFullScript = true;
          preview = (parsed.script_segments?.opening || raw).slice(0, 160);
        } catch (e) {
          continue;
        }
      } else {
        const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const cleanFirst = lines[0].replace(/^#+\s*/, '').replace(/^《(.*)》$/, '$1').trim();
          if (cleanFirst && cleanFirst.length < 50) {
            title = cleanFirst;
          }
        }
        const idMatch = raw.match(/(?:项目ID|project_id|Project ID)[:：]\s*([a-zA-Z0-9_-]+)/i);
        if (idMatch) suggestedProjectId = idMatch[1];

        const cnChars = (raw.match(/[\u4e00-\u9fa5]/g) || []).length;
        wordCount = cnChars || raw.length;
        if (f.includes('完整文案') || f.includes('final') || raw.includes('第1章') || raw.includes('第一章') || raw.includes('开篇')) {
          isFullScript = true;
        }
        preview = lines.slice(0, 5).join(' ').slice(0, 160);
      }

      if (!suggestedProjectId) {
        const safeBase = path.basename(f, ext).replace(/[^\w]/g, '_').toLowerCase().slice(0, 24);
        suggestedProjectId = `why_${safeBase || 'project'}_001`.replace(/_+/g, '_');
      }

      results.push({
        filename: f,
        filePath: fullPath,
        title,
        suggestedProjectId,
        wordCount,
        sizeKb: Math.round(stat.size / 1024),
        isFullScript,
        preview,
        ext,
      });
    } catch (e) {}
  }

  return results.sort((a, b) => {
    if (a.isFullScript && !b.isFullScript) return -1;
    if (!a.isFullScript && b.isFullScript) return 1;
    return b.wordCount - a.wordCount;
  });
}

function parseScriptToScenes(content, { projectId = 'why_project_001', title = '', targetSeconds = 5.5 } = {}) {
  let detectedTitle = title || '';
  let detectedProjectId = projectId;
  const chapters = [];

  let isJson = false;
  if (typeof content === 'string' && (content.trim().startsWith('{') || content.trim().startsWith('['))) {
    try {
      const obj = JSON.parse(content);
      isJson = true;
      if (obj.title && !detectedTitle) detectedTitle = obj.title;
      if (obj.project_id && (!detectedProjectId || detectedProjectId === 'why_project_001')) {
        detectedProjectId = obj.project_id;
      }
      if (obj.script_segments) {
        if (obj.script_segments.opening) {
          chapters.push({ chapterTitle: '开篇导引', text: obj.script_segments.opening });
        }
        if (Array.isArray(obj.script_segments.chapters)) {
          for (const ch of obj.script_segments.chapters) {
            chapters.push({
              chapterTitle: ch.chapter_title ? `第${ch.chapter_number || ''}章: ${ch.chapter_title}` : `第${ch.chapter_number || ''}章`,
              text: ch.narration_text || '',
            });
          }
        }
        if (obj.script_segments.ending) {
          chapters.push({ chapterTitle: '单片终局结尾', text: obj.script_segments.ending });
        }
      }
    } catch (e) {
      isJson = false;
    }
  }

  if (!isJson) {
    const rawLines = content.split('\n');
    let currentChapter = '开篇导引';
    let currentTextLines = [];

    for (let i = 0; i < Math.min(15, rawLines.length); i++) {
      const line = rawLines[i].trim();
      if (!line) continue;
      if (!detectedTitle && !line.startsWith('=') && !line.startsWith('#') && !line.includes('字数') && !line.includes('项目ID') && !line.includes('编写标准')) {
        detectedTitle = line.replace(/^[#\s]+/, '').replace(/^《(.*)》$/, '$1').trim();
      }
      const idMatch = line.match(/(?:项目ID|project_id)[:：]\s*([a-zA-Z0-9_-]+)/i);
      if (idMatch && (!detectedProjectId || detectedProjectId === 'why_project_001')) {
        detectedProjectId = idMatch[1];
      }
    }

    const chapterHeaderRegex = /^[ \t]*(?:[#=*-]{2,}\s*)?(?:【)?\s*(开篇[^\n】]*|开场[^\n】]*|导[言读][^\n】]*|引言[^\n】]*|第\s*\d+\s*章[^\n=】]*|第\s*[一二三四五六七八九十百]+\s*章[^\n=】]*|结[尾局][^\n】]*|single_final_ending[^\n】]*)(?:】)?\s*(?:[#=*-]{2,})?$/i;

    let seenFirstHeader = false;
    for (let line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^={3,}$/.test(trimmed)) continue;
      if (/^[-*_]{3,}$/.test(trimmed)) continue;
      if (/^(?:全片总字数|预计播讲时长|编写标准|支持证据卡)/.test(trimmed)) continue;

      const headerMatch = trimmed.match(chapterHeaderRegex);
      if (headerMatch) {
        if (currentTextLines.length > 0) {
          chapters.push({ chapterTitle: currentChapter, text: currentTextLines.join('\n') });
          currentTextLines = [];
        }
        currentChapter = headerMatch[1].replace(/[\s=*-]+$/, '').trim();
        seenFirstHeader = true;
      } else {
        if (!seenFirstHeader) {
          // Skip leading title / meta lines before the first chapter header
          if (trimmed === detectedTitle || trimmed.includes(detectedProjectId) || trimmed.includes('项目ID')) {
            continue;
          }
        }
        currentTextLines.push(trimmed);
      }
    }

    if (currentTextLines.length > 0) {
      chapters.push({ chapterTitle: currentChapter, text: currentTextLines.join('\n') });
    }
  }

  if (chapters.length === 0) {
    chapters.push({ chapterTitle: '正文', text: content });
  }

  if (!detectedTitle) detectedTitle = '未命名工程';
  if (!detectedProjectId) detectedProjectId = 'why_' + Date.now().toString(36);

  const msPerChar = 240;
  const targetChars = Math.round((targetSeconds * 1000) / msPerChar);
  const minShotDuration = 4000;
  const maxShotDuration = 9000;

  const scenes = [];
  let curMs = 0;
  let totalWords = 0;

  function pushScene(text, chTitle) {
    const idx = scenes.length;
    const rawDur = Math.round(text.length * msPerChar);
    const dur = Math.max(minShotDuration, Math.min(maxShotDuration, rawDur));
    const startMs = curMs;
    const endMs = curMs + dur;
    curMs = endMs;

    let kw = text.replace(/^[“"‘'（(【\[\s]+/, '').replace(/[，。！？!?、；：“”"’'）)】\]\s]/g, '').slice(0, 10);
    if (!kw || kw.length < 2) kw = chTitle.slice(0, 8) || '核心观点';

    scenes.push({
      scene_id: `Shot-${String(idx + 1).padStart(3, '0')}`,
      scene_index: idx + 1,
      chapter_ref: chTitle,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: dur,
      visual_type: 'data_card',
      source_mode: 'ai_ppt_slide',
      visual_purpose: `${chTitle} · ${kw}`,
      narration_text: text,
      content_keywords: [kw],
      ppt_slide_spec: {
        theme_title: kw,
        subtitle: text.slice(0, 32),
        bullet_points: [`核心要点：${text.slice(0, 24)}`, `章节归属：${chTitle}`],
        custom_prompt: '',
      },
      procedural_props: {
        badge_label: `镜头 ${idx + 1} · ${kw}`,
        headline: kw,
        subheadline: text.slice(0, 32),
        items: [text.slice(0, 26)],
        accent_color: '#6366f1',
      },
      status: 'READY_PROCEDURAL',
      final_asset_id: null,
      human_review_required: false,
    });
  }

  for (const ch of chapters) {
    const chTitle = ch.chapterTitle;
    const paragraphs = ch.text.split('\n').map((p) => p.trim()).filter(Boolean);
    const rawSentences = [];

    for (const para of paragraphs) {
      const parts = para.split(/([。！？!?；;\n]+)/);
      for (let i = 0; i < parts.length; i += 2) {
        const sentence = (parts[i] + (parts[i + 1] || '')).trim();
        if (!sentence) continue;
        if (sentence.length > 38) {
          const subParts = sentence.split(/([，,、]+)/);
          for (let j = 0; j < subParts.length; j += 2) {
            const sub = (subParts[j] + (subParts[j + 1] || '')).trim();
            if (sub) rawSentences.push(sub);
          }
        } else {
          rawSentences.push(sentence);
        }
      }
    }

    let currentShotText = '';
    for (const s of rawSentences) {
      totalWords += s.length;
      if (!currentShotText) {
        currentShotText = s;
      } else if (
        currentShotText.length + s.length <= targetChars + 6 &&
        currentShotText.length * msPerChar < targetSeconds * 1000
      ) {
        currentShotText += s;
      } else {
        pushScene(currentShotText, chTitle);
        currentShotText = s;
      }
    }
    if (currentShotText) {
      pushScene(currentShotText, chTitle);
    }
  }

  const totalDurationSec = Number((curMs / 1000).toFixed(1));
  const estimatedMinutes = Number((curMs / 60000).toFixed(1));

  const manifest = {
    project_id: detectedProjectId,
    project_title: detectedTitle,
    total_scenes: scenes.length,
    total_duration_ms: curMs,
    total_duration_sec: totalDurationSec,
    captions_file: 'captions/captions.srt',
    scenes,
  };

  const finalScript = {
    project_id: detectedProjectId,
    title: detectedTitle,
    total_word_count: totalWords,
    estimated_duration_minutes: estimatedMinutes,
    revision_count: 0,
    script_segments: {
      chapters: chapters.map((c, i) => ({
        chapter_number: i + 1,
        chapter_title: c.chapterTitle,
        narration_text: c.text,
      })),
    },
  };

  return {
    projectId: detectedProjectId,
    title: detectedTitle,
    manifest,
    finalScript,
    totalWords,
    totalDurationSec,
    estimatedMinutes,
    scenesCount: scenes.length,
    sampleScenes: scenes.slice(0, 4),
  };
}

function createProjectFromScript({ projectId, title, content, targetSeconds = 5.5 }) {
  if (!content || !content.trim()) {
    return { ok: false, error: '文案内容不能为空' };
  }

  const parsed = parseScriptToScenes(content, { projectId, title, targetSeconds });
  const cleanId = (parsed.projectId || projectId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_') || `why_${Date.now().toString(36)}`;
  const curPaths = getPaths(cleanId);

  fs.mkdirSync(curPaths.dataDir, { recursive: true });
  fs.mkdirSync(curPaths.audioDir, { recursive: true });
  fs.mkdirSync(path.dirname(curPaths.captionsPath), { recursive: true });
  fs.mkdirSync(curPaths.outputDir, { recursive: true });

  parsed.manifest.project_id = cleanId;
  parsed.manifest.project_title = parsed.title;
  parsed.manifest.captions_file = 'captions/captions.srt';
  parsed.finalScript.project_id = cleanId;

  fs.writeFileSync(curPaths.finalScriptPath, JSON.stringify(parsed.finalScript, null, 2), 'utf8');
  fs.writeFileSync(curPaths.manifestPath, JSON.stringify(parsed.manifest, null, 2), 'utf8');

  if (!fs.existsSync(curPaths.assetIndexPath)) {
    fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify({ project_id: cleanId, assets: [] }, null, 2), 'utf8');
  }

  if (!fs.existsSync(curPaths.promptConfigPath)) {
    fs.writeFileSync(
      curPaths.promptConfigPath,
      JSON.stringify(
        {
          selected_visual_model: 'minimax/hailuo-3',
          selected_image_model: 'black-forest-labs/flux-1-schnell',
          selected_text_model: 'deepseek/deepseek-chat',
          global_ai_visual_prompt:
            '作为 16:9 纪录片视觉总监，结合旁白片段与关键词，在 16:9 画幅中央提炼一个醒目标志大字（不超过 14 字），搭配 1 条副级阐述，用于动效视觉传达。',
        },
        null,
        2
      ),
      'utf8'
    );
  }

  recompileProject(cleanId);

  return {
    ok: true,
    projectId: cleanId,
    title: parsed.title,
    totalScenes: parsed.manifest.scenes.length,
    totalDurationSec: parsed.manifest.total_duration_sec,
    estimatedMinutes: parsed.estimatedMinutes,
  };
}

function getWriterData(projectId) {
  const curPaths = getPaths(projectId);
  let brief = null;
  let evidenceCards = [];
  let outline = null;
  let chapters = [];
  let finalScript = null;

  if (fs.existsSync(curPaths.briefPath)) {
    try {
      brief = JSON.parse(fs.readFileSync(curPaths.briefPath, 'utf8'));
    } catch (e) {}
  }

  if (fs.existsSync(curPaths.evidencePath)) {
    try {
      evidenceCards = JSON.parse(fs.readFileSync(curPaths.evidencePath, 'utf8'));
    } catch (e) {}
  }

  if (fs.existsSync(curPaths.outlinePath)) {
    try {
      outline = JSON.parse(fs.readFileSync(curPaths.outlinePath, 'utf8'));
    } catch (e) {}
  }

  const chaptersPath = path.join(curPaths.dataDir, 'chapters.json');
  if (fs.existsSync(chaptersPath)) {
    try {
      chapters = JSON.parse(fs.readFileSync(chaptersPath, 'utf8'));
    } catch (e) {}
  } else if (fs.existsSync(curPaths.dataDir)) {
    const chFiles = fs
      .readdirSync(curPaths.dataDir)
      .filter((f) => /^chapter_\d+\.json$/.test(f))
      .sort();
    for (const cf of chFiles) {
      try {
        const cData = JSON.parse(fs.readFileSync(path.join(curPaths.dataDir, cf), 'utf8'));
        chapters.push(cData);
      } catch (e) {}
    }
  }

  if (fs.existsSync(curPaths.finalScriptPath)) {
    try {
      finalScript = JSON.parse(fs.readFileSync(curPaths.finalScriptPath, 'utf8'));
    } catch (e) {}
  }

  let activeStep = 1;
  if (finalScript && finalScript.total_word_count > 0) {
    activeStep = 5;
  } else if (chapters.length > 0) {
    activeStep = 4;
  } else if (outline && outline.chapters && outline.chapters.length > 0) {
    activeStep = outline.approval_status === 'approved' ? 4 : 3;
  } else if (evidenceCards.length > 0) {
    activeStep = 2;
  } else if (brief) {
    activeStep = 1;
  }

  return {
    projectId,
    brief,
    evidenceCards,
    outline,
    chapters,
    finalScript,
    activeStep,
  };
}

function extractJsonFromText(text) {
  if (!text) return null;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = match ? match[1] : text;
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (err) {}
    }
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      } catch (err) {}
    }
    return null;
  }
}

async function callOpenRouterText(systemPrompt, userPrompt, { model, apiKey, baseUrl, maxTokens = 3500 } = {}) {
  const curApiKey = (apiKey || process.env.OPENROUTER_API_KEY || '').trim();
  const curBase = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const curModel = (model || 'deepseek/deepseek-chat').trim();

  if (!curApiKey) {
    return null;
  }

  try {
    const resp = await fetch(`${curBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${curApiKey}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio',
      },
      body: JSON.stringify({
        model: curModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.warn(`[Writer Text Warning] Status ${resp.status}: ${err.slice(0, 100)}`);
      return null;
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('[Writer Text Error]:', err);
    return null;
  }
}

function renderRemotionStill(projectId, sceneId) {
  const curPaths = getPaths(projectId);
  if (!fs.existsSync(curPaths.manifestPath)) return null;
  const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
  const scene = (mf.scenes || []).find((s) => s.scene_id === sceneId);
  if (!scene) return null;

  const frame = Math.round((scene.start_ms / 1000) * 30) + 15;
  const outDir = path.join(curPaths.publicDir, 'assets', 'generated');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFileName = `${sceneId.toLowerCase()}_still.jpg`;
  const outPath = path.join(outDir, outFileName);
  const relPath = `assets/generated/${outFileName}`;

  if (fs.existsSync(outPath)) {
    try { fs.unlinkSync(outPath); } catch (e) {}
  }

  try {
    const localBin = path.join(rootDir, 'node_modules/.bin/remotion');
    const isLocal = fs.existsSync(localBin);
    const cmd = isLocal ? localBin : 'npx';
    const args = isLocal
      ? [
          'still',
          'packages/video-template/src/index.ts',
          'WhyExplainerFinal',
          outPath,
          `--frame=${frame}`,
          `--props=${curPaths.propsPath}`,
          `--public-dir=${curPaths.publicDir}`,
          '--image-format=jpeg',
          '--jpeg-quality=85',
          '--log=warn',
        ]
      : [
          'remotion',
          'still',
          'packages/video-template/src/index.ts',
          'WhyExplainerFinal',
          outPath,
          `--frame=${frame}`,
          `--props=${curPaths.propsPath}`,
          `--public-dir=${curPaths.publicDir}`,
          '--image-format=jpeg',
          '--jpeg-quality=85',
          '--log=warn',
        ];

    const res = spawnSync(cmd, args, { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
    if (res.status === 0 && fs.existsSync(outPath)) {
      return relPath;
    }
    console.error(`Remotion still failed for ${sceneId} (exitCode: ${res.status}):`, res.stderr || res.stdout);
    if (fs.existsSync(outPath)) {
      return relPath;
    }
  } catch (err) {
    console.error(`Remotion still spawn exception for ${sceneId}:`, err);
  }
  return null;
}

async function callOpenRouterDirector(cfg, scene, customPrompt, templateStyle) {
  const apiKey = (cfg.apiKey || '').trim();
  if (!apiKey || apiKey === 'antigravity-local-dev') {
    const kws = scene.content_keywords || [];
    const narration = scene.narration_text || '';
    return {
      theme_title: kws[0] || (narration ? narration.slice(0, 10) : '核心要点'),
      subtitle: narration.slice(0, 24),
      bullet_points: [
        narration.slice(0, 18),
        kws[1] ? `关注焦点：${kws[1]}` : '关键事实依据'
      ],
      recommended_template: templateStyle || 'data_card'
    };
  }

  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (cfg.model || 'anthropic/claude-3.5-sonnet').trim();

  const url = `${baseUrl}/chat/completions`;
  const systemPrompt = `你是一位顶尖的 YouTube 科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】与【用户视觉 Prompt】，为 16:9 画幅视频提炼具有极强认知冲击力与视听节奏感的核心画面信息。

必须且仅返回纯净 JSON 格式，严禁返回任何额外文字、markdown标记或问候：
{
  "theme_title": "核心大字醒目标题（4~14字，具颠覆性或总结性）",
  "subtitle": "副级精炼阐释说明（12~30字）",
  "bullet_points": [
    "提炼论点一（12~24字）",
    "提炼论点二（12~24字）"
  ],
  "recommended_template": "data_card 或 versus_dual 或 document_highlight 或 timeline"
}`;

  const userMessage = `【镜头序号】：${scene.scene_id}
【章节分类】：${scene.chapter_ref || '核心解析'}
【本镜台词】：${scene.narration_text}
【用户指示词/Prompt】：${customPrompt || '冷峻科技风、概念颠覆、强化视觉记忆'}
【指定模板样式】：${templateStyle || '自动分析决定'}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 状态码 ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('无法从模型返回中提取 JSON 数据');
  return JSON.parse(match[0]);
}

function extractLocalSmartPrompt(narrationText, targetMode, keywords = [], templateStyle = 'data_card') {
  if (!narrationText) return '';
  const raw = narrationText.trim();
  const kwList = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

  let cleaned = raw
    .replace(/^(在|顺着|沿着|当|经过|据|由于|因为|为了|根据)[^，,。；;]{1,15}[，,]/g, '')
    .replace(/^(有一条|坐落着|迎面出现的却是|映入眼帘的是|矗立着|车辆必须|这就是|可以说|事实上|实际上)/g, '')
    .replace(/[，,。；;！!？?]+$/g, '')
    .trim();

  if (cleaned.length < 4) cleaned = raw.replace(/[，,。；;！!？?]+$/g, '');

  const mainSubject = kwList.length > 0 ? kwList[0] : (cleaned.length > 25 ? cleaned.slice(0, 25) : cleaned);
  const contextDesc = cleaned;

  let cameraMove = '平稳推镜头向前聚焦';
  if (/转弯|急弯|弯道|穿行|盘山|环绕/.test(raw)) {
    cameraMove = '大范围航拍连续弧形环绕跟随';
  } else if (/落差|悬崖|山峰|俯瞰|冲上|高度|海拔/.test(raw)) {
    cameraMove = '高空俯冲推拉运镜转开阔全景';
  } else if (/细节|金箔|雕刻|纹理|双眼|双手|微观|精细|古老|建筑/.test(raw)) {
    cameraMove = '慢速微距浅景深焦点平移特写';
  } else if (/穿过|延伸|漫步|走入|深入/.test(raw)) {
    cameraMove = '第一人称低角度正前向稳定推进运镜';
  }

  if (targetMode === 'video') {
    let videoSubject = mainSubject;
    if (/修验|苦行|神域|上人|僧|行者/.test(raw)) {
      videoSubject = '修验道白衣苦行僧在险峰岩壁间手持金刚杖前行';
    } else if (/德川|幕府|防线|关卡|东照宫|灵庙|家康/.test(raw)) {
      videoSubject = '德川幕府森严石鸟居与关防石垣在晨雾险峰中矗立';
    } else if (/发卡弯|急弯|伊吕波|公路|盘山|弯道/.test(raw)) {
      videoSubject = '48道急弯发卡弯在险峻山体间连续折叠延伸';
    } else if (/避暑|公馆|外交|洋馆|使节|使馆/.test(raw)) {
      videoSubject = '中禅寺湖畔西洋木造使馆公馆倒映在冷凉湖水间';
    }
    return `【镜头主体】${videoSubject}，画面生动呈现「${contextDesc}」；【运镜设计】${cameraMove}；【光影与质感】自然光影真实漫反射，丰富环境层次，电影级光学动态细节`;
  } else if (targetMode === 'image') {
    let visualSubject = mainSubject;
    let visualDetails = contextDesc;
    if (/修验|苦行|神域|上人|僧|行者/.test(raw)) {
      visualSubject = '险峰绝壁悬崖边缘的修验道白衣苦行僧持杖背影，与苍茫古道注连绳结界';
    } else if (/德川|幕府|防线|关卡|东照宫|灵庙|家康/.test(raw)) {
      visualSubject = '日光险隘处的德川幕府金漆葵纹铜装石鸟居，与崇山峻岭间森严防御石垣';
    } else if (/发卡弯|急弯|伊吕波|公路|盘山|弯道/.test(raw)) {
      visualSubject = '日光山林海间蜿蜒盘旋的48道发卡弯绝壁险道高空俯瞰轨迹';
    } else if (/避暑|公馆|外交|洋馆|使节|使馆/.test(raw)) {
      visualSubject = '中禅寺湖畔清幽冷凉的西洋木造外交使馆别墅与百叶窗湖光倒影';
    }
    return `【画面叙事核心】大师级摄影定格「${visualSubject}」，核心表意细节：${visualDetails}；【构图与空间透视】大景深险峰空间层次，环境空气透视；【细节与质感】微米级物理材质特写（粗麻衣袍、金刚杖斑驳纹理、黑金铜雕葵纹），8K超写实胶片光影，无杂乱文字`;
  } else {
    // 📊 动效排版卡片形态：根据不同模板选项定制排版指导词
    const title = mainSubject.length > 10 ? mainSubject.slice(0, 8) : mainSubject;
    if (templateStyle === 'document_highlight') {
      return `【文献考据】「${title}」\n【核心引录】“${contextDesc}”\n【考据重点】金石文献与建筑工艺考据\n【版式视觉】16:9 古典金石史料信息图卡片，和风古典深色肌理，金箔反光点缀，典雅宣纸书卷排版风格，博物馆展签级`;
    } else if (templateStyle === 'versus_dual') {
      return `【核心辩题】「${title}」\n【传统认知】既往常态定式阐述\n【颠覆突破】全新机制与核心突破\n【版式视觉】16:9 对比双栏Keynote信息图卡片，左右对称深色信息容器，冷蓝与渐变紫双色对比辉光，极简数据对撞排版`;
    } else if (templateStyle === 'timeline') {
      return `【演进主线】「${title}」\n【阶段推进】阶段01关键转折 ➔ 阶段02演进升华\n【版式视觉】16:9 历史时空演进路线图卡片，发光连接轴线，阶段卡片发光边框，现代信息图表极简科技排版`;
    } else if (templateStyle === 'kinetic_text') {
      return `【聚光焦点】「${title}」\n【视觉递进】层层展开的递进阐述短句\n【版式视觉】16:9 视觉冲击排版海报卡片，特大号粗体文字层级，径向聚光灯深色氛围，极简高张力视觉平面设计`;
    } else {
      return `【核心大字】「${title}」\n【副级阐述】${contextDesc}\n【排版重点】突出核心论据与工艺细节\n【版式视觉】16:9 现代暗色高阶演说PPT信息图卡片，微光磨砂玻璃容器，金珀与深蓝氛围光晕，顶级平面设计排版`;
    }
  }
}

async function callOpenRouterPromptExtractor(cfg, narrationText, targetMode, keywords = [], templateStyle = 'data_card', projectContext = {}) {
  const apiKey = (cfg.apiKey || '').trim();
  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (cfg.textModel || cfg.model || 'deepseek/deepseek-chat').trim();

  if (!apiKey) {
    return {
      prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords, templateStyle),
      usedModel: '本地语义解析 (未配置 API Key)',
      isAi: false
    };
  }

  const projTitle = projectContext.title || '历史文化与地理深度纪录片';
  const projSummary = projectContext.short_answer || projectContext.subtitle || '';

  let modeName = '🎬 真实实体视频 (Text-to-Video MP4)';
  let modeRequirement = `【实体视频提炼要求】：
必须输出为如下结构：
【镜头叙事核心】必须紧扣台词中的历史人物动作、政权军事遗存、宗教法器或地理工程实体，严禁空洞死景；
【运镜轨迹】电影摄影运镜（如：45度低角度向前推进聚焦主体、悬崖俯瞰慢速环绕拉远、浅景深焦点从前景转移至后景）；
【具象细节与动态】人物袍服随风扬起、香火薄雾流淌、微雨浸润石壁等真实物理动态；
【光影与时代质感】符合该历史时期电影级光影质感与空气透视，真实自然光。`;

  if (targetMode === 'image') {
    modeName = '🖼️ 超写实实景图 (FLUX / Midjourney HD)';
    modeRequirement = `【超写实实景图提炼要求】：
必须输出为如下结构：
【画面叙事核心】必须紧扣台词中的核心时代实体与历史隐喻（如：苦行僧白衣持杖身影、德川幕府葵纹关防与险峰鸟居），绝对严禁脱离文案仅拍摄无意义的自然死风景；
【构图与空间透视】大师级电影摄影构图与视觉纵深（如：悬崖险隘对角线构图，前景为...，远景为...）；
【具象细节与材质】特定历史实体的真实微观质感（粗麻白衣纤维、斑驳金刚杖、黑金铜雕葵纹、湿润险峰玄武岩）；
【光影与时代氛围】晨雾穿透林冠的圣洁丁达尔光线，深沉苍凉的历史色调与胶片景深，无任何杂乱文字。`;
  } else if (targetMode === 'card') {
    modeName = `📊 AI 动态图文卡片 (PPT视觉卡片 · ${templateStyle})`;
    if (templateStyle === 'document_highlight') {
      modeRequirement = `【典籍史料考据卡 (DocHighlight) 排版要求】：
必须输出为如下规范结构：
【文献考据】台词涉及的典籍/古道/历史事件主题名（4~8字）；
【原文引录】14~28 字史料风雅精炼名句或记载原文；
【考据重点】2 条历史考据论据或金箔建筑/地理工艺事实；
【版式视觉】16:9 古典金石史料图解卡片，和风古典深色肌理，金箔反光点缀，典雅宣纸书卷排版风格，博物馆展签级别。`;
    } else if (templateStyle === 'versus_dual') {
      modeRequirement = `【概念对比双栏卡 (VersusDual) 排版要求】：
必须输出为如下规范结构：
【核心辩题】反差鲜明的对比总论点（4~10字）；
【传统认知】12~24 字左栏既往观点与传统定式；
【颠覆突破】12~24 字右栏全新机制与核心突破；
【版式视觉】16:9 对比双栏Keynote信息图卡片，左右对称深色信息容器，冷蓝与渐变紫双色对比辉光，极简数据对撞排版。`;
    } else if (templateStyle === 'timeline') {
      modeRequirement = `【时空演进脉络卡 (Timeline) 排版要求】：
必须输出为如下规范结构：
【演进主线】时空跨度主题标题（4~8字）；
【阶段推进】阶段01关键转折点 ➔ 阶段02演进里程碑；
【演进论述】14~28 字时空演变深度提炼；
【版式视觉】16:9 历史时空演进路线图卡片，发光连接轴线，阶段卡片发光边框，现代信息图表极简科技排版。`;
    } else if (templateStyle === 'kinetic_text') {
      modeRequirement = `【动感文字聚光卡 (KineticText) 排版要求】：
必须输出为如下规范结构：
【聚光焦点】1~3 个最震撼的核心关键词大字；
【视觉递进】层层展开的递进阐述短句（10~22字）；
【视觉重音】核心词语反差与视觉张力；
【版式视觉】16:9 视觉冲击排版海报卡片，特大号粗体文字层级，径向聚光灯深色氛围，极简高张力视觉平面设计。`;
    } else {
      modeRequirement = `【科技人文大字冲击卡 (DataCard) 排版要求】：
必须输出为如下规范结构：
【核心大字】从台词提炼极具视觉冲击力的 4~8 字醒目标题；
【副级阐述】14~28 字直击要害的解说精要；
【排版重点】2 条结构化核心论据或工艺事实；
【版式视觉】16:9 现代暗色高阶演说PPT信息图卡片，微光磨砂玻璃容器，金珀与深蓝氛围光晕，顶级平面设计排版。`;
    }
  }

  const systemPrompt = `你是一位享誉全球的顶级历史文化、地理发现与科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】、【关键词】与【项目全局背景】，为该镜头提炼出与解说词语义高度咬合、具象写实、视听冲击力极强的画面指示词（Prompt）。

【项目全局背景】：
纪录片主题：《${projTitle}》
${projSummary ? `核心叙事概要：${projSummary}\n` : ''}
【最高法则：抽象概念强制具象化（Iconography Mapping）】：
1. 绝对严禁“死风景敷衍”！严禁仅用“石阶、树林、水面、青苔、石缝蕨类”等无主观意图的通用自然静物充当主角！画面必须出现直接承载台词历史/文化/事件意义的【具象历史符号 / 实体人物行动 / 建筑遗存】。
2. 历史、文化与政治概念具象化规则：
   - 出现“信仰 / 神域 / 修验道 / 苦行僧”：必须出现具体的宗教实体符号，如【悬崖险峰间头戴斑驳斗笠、身着粗麻白衣、手持金刚杖的修验僧背影】、【险峰古杉上缠绕的粗大白色注连绳与纸垂结界】、【山伏石碑与法器】；
   - 出现“幕府 / 王权 / 军事防线 / 权力政治”：必须出现具体的政权实体符号，如【险峰关口处刻有德川三叶葵纹的森严黑漆铜装石鸟居】、【崇山峻岭间构筑的森严巨石关防石垣与青铜常夜灯】、【德川家康金箔灵庙在深林云雾中的巍然一隅】；
   - 出现“工程 / 交通 / 盘山公路 / 险道”：必须出现具体的工程视觉线索，如【绝壁急弯发卡弯的连续沥青折叠轨迹】、【险峻海拔标牌与盘山防护落石网】；
   - 出现“近代开国 / 外交使节 / 避暑胜地”：必须转化为近代具象符号，如【高山冷凉湖畔的洋风木造使馆别墅百叶窗、高山湖泊上的西洋帆船与遮阳伞】。
3. 音画咬合度原则：让观众即使静音不听解说，仅看画面，也能立刻读懂其传达的特定时代、核心人物与历史意境！

请严格遵循指定形态的结构规范进行输出：
${modeRequirement}

请直接输出提炼后的最终提示词文本，字数控制在 160~240 字之间，严禁包含任何前缀客套、说明或额外markdown代码块：`;

  const userMessage = `【镜头旁白台词】：${narrationText}
【关键词参考】：${keywords.length ? keywords.join('、') : '无'}
【指定视觉形态】：${modeName}

请立即提炼：`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.4,
        max_tokens: 350
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[OpenRouter Prompt Warning] Status ${response.status}: ${errText.slice(0, 100)}，回退至本地实体解析。`);
      return {
        prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
        usedModel: `本地语义解析 (${model.split('/').pop()} 网关异常)`,
        isAi: false
      };
    }

    const resJson = await response.json();
    const rawContent = resJson.choices?.[0]?.message?.content?.trim() || '';
    if (!rawContent) {
      return {
        prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
        usedModel: '本地语义解析 (AI返回为空)',
        isAi: false
      };
    }

    const cleanPrompt = rawContent.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return {
      prompt: cleanPrompt,
      usedModel: `AI 分镜总监 (${model.split('/').pop()})`,
      isAi: true
    };
  } catch (err) {
    console.warn(`[OpenRouter Prompt Exception] ${err.message}，回退至本地实体解析。`);
    return {
      prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
      usedModel: '本地语义解析 (网络回退)',
      isAi: false
    };
  }
}

function registerGeneratedAsset(curPaths, projectId, sceneId, relPath, type = 'video', durationSec = 6.0) {
  let assetIdx = { assets: [] };
  if (fs.existsSync(curPaths.assetIndexPath)) {
    try { assetIdx = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8')); } catch (e) {}
  }
  const assetId = `AST-${type.toUpperCase()}-${sceneId.toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const assetRecord = {
    asset_id: assetId,
    path: relPath,
    file_path: `projects/${projectId}/public/${relPath}`,
    type: type,
    media_type: type,
    resolution: '1920x1080',
    duration_seconds: durationSec,
    duration_sec: durationSec,
    license_status: 'approved',
    source: 'ai_visual_video_generator',
    tags: ['ai_generated', type, sceneId]
  };
  assetIdx.assets.push(assetRecord);
  fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIdx, null, 2), 'utf8');
  return assetId;
}

function normalizePromptConfig(cfg = {}) {
  let vModel = cfg.videoModel || 'minimax/hailuo-3-max';
  if (vModel === 'minimax/video-01' || vModel === 'minimax/hailuo' || vModel === 'video-01') {
    vModel = 'minimax/hailuo-3-max';
  }
  let iModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
  if (iModel === 'black-forest-labs/flux-1-schnell' || iModel.includes('flux-1')) {
    iModel = 'black-forest-labs/flux-3-image';
  }
  return {
    provider: 'openrouter',
    baseUrl: cfg.baseUrl || 'https://openrouter.ai/api/v1',
    apiKey: cfg.apiKey || '',
    textModel: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    videoModel: vModel,
    imageModel: iModel,
    bgmModel: cfg.bgmModel || 'deepseek/deepseek-chat',
    model: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
    global_ai_visual_prompt: cfg.global_ai_visual_prompt || cfg.global_ppt_prompt || '作为 16:9 纪录片视觉总监，结合旁白片段与关键词提炼震撼的真实画面。',
    updated_at: cfg.updated_at || new Date().toISOString()
  };
}

async function downloadRemoteMedia(remoteUrl, localDestPath, apiKey = '') {
  const dir = path.dirname(localDestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (remoteUrl.startsWith('data:')) {
    const base64Data = remoteUrl.split(',')[1];
    fs.writeFileSync(localDestPath, Buffer.from(base64Data, 'base64'));
    return;
  }
  const headers = {};
  if (apiKey && remoteUrl.includes('openrouter.ai')) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    headers['HTTP-Referer'] = 'https://github.com/mingdewu/WhyVideo';
    headers['X-Title'] = 'WhyVideo Studio';
  }
  const resp = await fetch(remoteUrl, { headers });
  if (!resp.ok) throw new Error(`下载媒体文件失败 (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(localDestPath, buf);
}

// 统一 AI 实体视频生成器 (支持 OpenRouter 原生视频端点、各类多模态代理网关、SiliconFlow、Runway 等任意模型 Slug)
async function callGatewayVideoGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', videoModel = 'minimax/hailuo-3' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key，请先在右上角【🎬 AI 画面/视频模型指定】中填入您的 API Key 并保存');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = videoModel.trim();

  // 0. 原生 OpenRouter 官方视频生成端点 (POST https://openrouter.ai/api/v1/videos)
  if (base.includes('openrouter.ai')) {
    // 智能映射：MiniMax 视频在 OpenRouter 上的标准模型 ID
    if (model === 'minimax/video-01' || model === 'minimax/hailuo' || model === 'minimax-01' || model === 'video-01') {
      console.log(`[OpenRouter Video] 自动将 ${model} 映射为 OpenRouter 标准模型: minimax/hailuo-3-max`);
      model = 'minimax/hailuo-3-max';
    }

    // 针对各模型官方支持的 resolution / duration 动态适配
    let resolution = '720p';
    let duration = 5;
    if (model === 'minimax/hailuo-3') {
      resolution = '2K';
      duration = 5;
    } else if (model === 'minimax/hailuo-3-max') {
      resolution = '768p';
      duration = 5;
    } else if (model === 'minimax/hailuo-2.3') {
      resolution = '1080p';
      duration = 6;
    } else if (model.includes('veo')) {
      resolution = '720p';
      duration = 4;
    }

    console.log(`[OpenRouter Video] 正在提交任务至 ${base}/videos，模型: ${model} (分辨率: ${resolution}, 时长: ${duration}s)...`);
    const submitResp = await fetch(`${base}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9',
        duration: duration,
        resolution: resolution
      })
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 视频生成请求未通过 (HTTP ${submitResp.status}): ${errMsg}`);
    }

    const jobData = await submitResp.json();
    console.log('[OpenRouter Video Job Created]', jobData);

    if (Array.isArray(jobData.urls) && jobData.urls.length > 0) {
      return jobData.urls[0];
    }
    if (Array.isArray(jobData.unsigned_urls) && jobData.unsigned_urls.length > 0) {
      return jobData.unsigned_urls[0];
    }

    const jobId = jobData.id;
    if (!jobId) throw new Error('OpenRouter 已受理但未返回任务 ID');

    const pollUrl = jobData.polling_url || `${base}/videos/${jobId}`;

    // 轮询生成结果 (最长约 4 分钟，每 4 秒轮询一次)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const pollResp = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        }
      });
      if (!pollResp.ok) continue;
      const pollData = await pollResp.json();
      const status = (pollData.status || '').toLowerCase();
      console.log(`[OpenRouter Video Polling] Job ${jobId} 状态: ${status} (${(i + 1) * 4}s)`);

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        const videoUrl = pollData.urls?.[0] || pollData.unsigned_urls?.[0] || pollData.url || pollData.video_url;
        if (videoUrl) return videoUrl;
      }

      if (status === 'failed' || status === 'error') {
        const failMsg = pollData.error?.message || pollData.error || '视频生成任务失败';
        throw new Error(`OpenRouter 视频生成失败: ${failMsg}`);
      }
    }

    throw new Error(`OpenRouter 视频生成超时 (任务 ID: ${jobId})，请稍后检查网关或重试`);
  }

  // 1. 如果是原生 SiliconFlow 网关
  if (base.includes('siliconflow')) {
    const submitResp = await fetch(`${base}/video/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model, prompt: prompt, image_size: '1280x720' })
    });
    if (!submitResp.ok) throw new Error(`SiliconFlow 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { requestId } = await submitResp.json();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const sResp = await fetch(`${base}/video/status?requestId=${requestId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      const st = (sData.status || '').toLowerCase();
      if (st === 'succeed' || st === 'succeeded') {
        const vUrl = sData.results?.videos?.[0]?.url || sData.results?.url;
        if (vUrl) return vUrl;
      }
      if (st === 'failed') throw new Error(`SiliconFlow 视频生成失败: ${sData.reason || '未知错误'}`);
    }
    throw new Error('SiliconFlow 视频生成超时');
  }

  // 2. 如果是 MiniMax 官方网关
  if (base.includes('minimax')) {
    const submitResp = await fetch(`${base}/video_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model === 'minimax/video-01' ? 'video-01' : model, prompt: prompt })
    });
    if (!submitResp.ok) throw new Error(`MiniMax 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { task_id } = await submitResp.json();
    if (!task_id) throw new Error('MiniMax 未返回 task_id');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const qResp = await fetch(`${base}/query/video_generation?task_id=${task_id}`, {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
      });
      if (!qResp.ok) continue;
      const qData = await qResp.json();
      const st = (qData.status || '').toLowerCase();
      if (st === 'success' || st === 'succeeded' || qData.file_id) {
        if (qData.file_id) {
          const dlResp = await fetch(`${base}/files/retrieve?file_id=${qData.file_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          if (dlResp.ok) {
            const dlData = await dlResp.json();
            if (dlData.file?.download_url) return dlData.file.download_url;
          }
        }
        if (qData.download_url) return qData.download_url;
      }
      if (st === 'failed' || st === 'error') throw new Error(`MiniMax 视频生成失败: ${qData.error_message || '未知错误'}`);
    }
    throw new Error('MiniMax 视频生成超时');
  }

  // 3. 如果是原生 Runway 网关
  if (base.includes('runwayml')) {
    const submitResp = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' },
      body: JSON.stringify({ taskType: model, promptText: prompt, duration: 5, ratio: '16:9' })
    });
    if (!submitResp.ok) throw new Error(`Runway 提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { id: taskId } = await submitResp.json();
    for (let i = 0; i < 35; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const sResp = await fetch(`${base}/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      if (sData.status === 'SUCCEEDED') return sData.output?.[0] || sData.output?.url;
      if (sData.status === 'FAILED') throw new Error(`Runway 视频生成失败: ${sData.failure || '未知原因'}`);
    }
    throw new Error('Runway 视频生成超时');
  }

  // 4. 通用 OpenAI 兼容 / 第三方中转聚合网关：依次尝试端点
  const candidateEndpoints = [
    `${base}/videos`,
    `${base}/video/generations`,
    `${base}/videos/generations`,
    `${base}/video_generation`,
    `${base}/video/submit`,
    `${base}/tasks`
  ];

  let submitResp = null;
  let lastErrorDetail = '';
  for (const ep of candidateEndpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          promptText: prompt,
          ratio: '16:9',
          aspect_ratio: '16:9',
          image_size: '1280x720',
          duration: 5
        })
      });
      if (resp.status !== 404) {
        submitResp = resp;
        break;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  // 若标准端点未命中，尝试 /chat/completions (针对通过 Chat 路由视频模型的第三方代理)
  if (!submitResp || submitResp.status === 404) {
    try {
      const chatResp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: `请生成 16:9 动态 MP4 实体视频：${prompt}` }]
        })
      });
      if (chatResp.ok) {
        const cData = await chatResp.json();
        const text = cData.choices?.[0]?.message?.content || '';
        const m = text.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i);
        if (m) return m[0];
        if (cData.url) return cData.url;
        if (cData.data?.[0]?.url) return cData.data[0].url;
      } else {
        lastErrorDetail = `HTTP ${chatResp.status}: ${(await chatResp.text()).slice(0, 160)}`;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  if (!submitResp || !submitResp.ok) {
    const errText = submitResp ? await submitResp.text() : (lastErrorDetail || '未能连接到任何有效的视频生成端点 (/videos, /video/generations, /video_generation, /video/submit)');
    throw new Error(`视频模型 ${model} 生成请求未通过 (HTTP ${submitResp ? submitResp.status : 500}): ${errText.slice(0, 260)}`);
  }

  const sData = await submitResp.json();
  if (sData.urls?.[0]) return sData.urls[0];
  if (sData.url) return sData.url;
  if (sData.data?.[0]?.url) return sData.data[0].url;
  if (sData.results?.videos?.[0]?.url) return sData.results.videos[0].url;
  if (sData.output?.[0]) return sData.output[0];
  if (Array.isArray(sData.unsigned_urls) && sData.unsigned_urls.length > 0) return sData.unsigned_urls[0];

  const taskId = sData.id || sData.taskId || sData.requestId || sData.task_id;
  if (!taskId) throw new Error('网关已响应但未返回视频 URL 或任务 ID');

  // 轮询任务
  const pollPaths = [
    `${base}/videos/${taskId}`,
    `${base}/video/generations/${taskId}`,
    `${base}/video/status?requestId=${taskId}`,
    `${base}/tasks/${taskId}`
  ];

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    for (const pUrl of pollPaths) {
      try {
        const pollResp = await fetch(pUrl, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
        if (!pollResp.ok) continue;
        const pData = await pollResp.json();
        const st = (pData.status || '').toLowerCase();
        if (st === 'succeed' || st === 'succeeded' || st === 'success' || st === 'completed') {
          return pData.urls?.[0] || pData.unsigned_urls?.[0] || pData.results?.videos?.[0]?.url || pData.data?.[0]?.url || pData.output?.[0] || pData.url;
        }
        if (st === 'failed' || st === 'failure' || st === 'error') {
          throw new Error(`视频生成任务失败: ${pData.reason || pData.error?.message || pData.error || '未知原因'}`);
        }
      } catch (err) {
        if (err.message.includes('视频生成任务失败')) throw err;
      }
    }
  }

  throw new Error(`视频生成超时 (任务 ID: ${taskId})，请稍后刷新或检查网关`);
}

// 统一 AI 超清实景生图器 (支持 OpenRouter 原生 /api/v1/images、FLUX 3、FLUX.2、Recraft、Gemini Image 等)
async function callGatewayImageGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', imageModel = 'black-forest-labs/flux-3-image' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = imageModel.trim();

  // 智能映射：将用户输入的 FLUX.1 (如 black-forest-labs/flux-1-schnell) 自动映射为 OpenRouter 官方的 FLUX 3
  if (
    model === 'black-forest-labs/flux-1-schnell' ||
    model === 'black-forest-labs/flux-1-dev' ||
    model.includes('flux-1') ||
    model === 'flux-schnell' ||
    model === 'flux'
  ) {
    console.log(`[OpenRouter Image] 自动将旧版 ${model} 映射为 OpenRouter 官方标准模型: black-forest-labs/flux-3-image`);
    model = 'black-forest-labs/flux-3-image';
  } else if (model === 'recraft-v3') {
    model = 'recraft/recraft-v3';
  }

  // 1. 如果是 OpenRouter 官方网关，直接调用官方统一生图 API: POST https://openrouter.ai/api/v1/images
  if (base.includes('openrouter.ai')) {
    console.log(`[OpenRouter Image] 正在向 ${base}/images 提交生图请求，模型: ${model}...`);
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 生图请求未通过 (HTTP ${resp.status}): ${errMsg}`);
    }

    const data = await resp.json();
    const firstItem = data.data?.[0];
    if (firstItem?.b64_json) {
      const mediaType = firstItem.media_type || 'image/png';
      return `data:${mediaType};base64,${firstItem.b64_json}`;
    }
    if (firstItem?.url) return firstItem.url;
    if (data.url) return data.url;
    throw new Error('OpenRouter 已受理但未返回图片数据');
  }

  // 2. 其他 OpenAI 兼容代理网关：依次尝试 /images、/images/generations
  try {
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const firstItem = data.data?.[0];
      if (firstItem?.b64_json) return `data:${firstItem.media_type || 'image/png'};base64,${firstItem.b64_json}`;
      if (firstItem?.url) return firstItem.url;
    }
  } catch (e) {}

  try {
    const resp = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        size: '1024x576',
        num_inference_steps: 4
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const imgUrl = data.data?.[0]?.url || data.images?.[0]?.url || data.url;
      if (imgUrl) return imgUrl;
    }
  } catch (e) {}

  // 3. 尝试 Chat 接口兼容生图
  const chatResp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: `Generate a high quality 16:9 realistic photo: ${prompt}` }]
    })
  });

  if (!chatResp.ok) {
    throw new Error(`生图请求未通过 (HTTP ${chatResp.status}): ${(await chatResp.text()).slice(0, 200)}`);
  }
  const chatData = await chatResp.json();
  const content = chatData.choices?.[0]?.message?.content || '';
  const m = content.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  if (m) return m[0];
  if (chatData.data?.[0]?.url) return chatData.data[0].url;

  throw new Error('未能从模型返回中提取图片 URL');
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

function getWriterProjectData(projectId) {
  const paths = getPaths(projectId);
  let brief = null;
  let evidenceCards = [];
  let outline = null;
  let chapters = [];
  let finalScript = null;

  if (fs.existsSync(paths.briefPath)) {
    try { brief = JSON.parse(fs.readFileSync(paths.briefPath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.evidencePath)) {
    try { evidenceCards = JSON.parse(fs.readFileSync(paths.evidencePath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.outlinePath)) {
    try { outline = JSON.parse(fs.readFileSync(paths.outlinePath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.dataDir)) {
    const files = fs.readdirSync(paths.dataDir);
    for (const f of files) {
      if (/^chapter_(\d+)\.json$/i.test(f)) {
        try {
          const chData = JSON.parse(fs.readFileSync(path.join(paths.dataDir, f), 'utf8'));
          chapters.push(chData);
        } catch (e) {}
      }
    }
    chapters.sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
  }
  if (fs.existsSync(paths.finalScriptPath)) {
    try { finalScript = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8')); } catch (e) {}
  }

  // 兜底补齐：若工程缺少 brief，则提供标准化 WhyExplainerVideoWriter 规范默认 Brief 骨架
  if (!brief) {
    let defaultTitle = projectId.replace(/^why_/, '').replace(/_\d+$/, '').replace(/_/g, ' ');
    if (finalScript && finalScript.title) defaultTitle = finalScript.title;
    brief = {
      project_id: projectId,
      title: defaultTitle || '为什么……？',
      core_question: `为什么${defaultTitle}？背后的地理、历史与经济机制是什么？`,
      tentative_conclusion: '核心答案简述：由地理环境演变、历史传统沉淀与产业分工共同造就。',
      target_audience: '泛知识纪录片观众、高知好奇心探索者',
      target_duration_minutes: 25,
      target_word_count: 7500,
      planned_chapter_count: outline && Array.isArray(outline.chapters) ? outline.chapters.length : 6,
      forbidden_claims: [
        "绝对禁止使用'全世界只有'、'所有外国人'、'自古以来无一例外'等绝对化词汇",
        "传说与轶事 (legend_or_anecdote) 严禁写成客观事实，必须标注'相传'或'有一种说法'",
        "严禁脑补伪造历史人物现场心理活动或微表情独白"
      ],
      reference_materials: []
    };
  }

  // 兜底补齐：若无 outline 但有 finalScript，提取大纲
  if (!outline && finalScript && finalScript.script_segments && Array.isArray(finalScript.script_segments.chapters)) {
    outline = {
      project_id: projectId,
      title: finalScript.title || brief.title,
      review_status: 'APPROVED',
      human_review_notes: '已由定稿文案自动生成大纲映射',
      chapters: finalScript.script_segments.chapters.map((ch, idx) => ({
        chapter_number: ch.chapter_number || idx + 1,
        chapter_title: ch.chapter_title || `第${idx + 1}章`,
        core_question: `第${idx + 1}章核心问题探讨`,
        mechanism: '背景与机制分析',
        bound_evidence_ids: [],
        target_words: (ch.narration_text || '').length || 1200
      }))
    };
  }

  return {
    projectId,
    brief,
    evidenceCards: Array.isArray(evidenceCards) ? evidenceCards : [],
    outline,
    chapters,
    finalScript
  };
}

function saveWriterProjectData(projectId, part, payload) {
  const paths = getPaths(projectId);
  if (!fs.existsSync(paths.dataDir)) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  if (part === 'brief') {
    fs.writeFileSync(paths.briefPath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: '立项 Brief 已保存' };
  }
  if (part === 'evidence') {
    fs.writeFileSync(paths.evidencePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: '证据卡库已保存' };
  }
  if (part === 'outline') {
    fs.writeFileSync(paths.outlinePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: '结构大纲已保存' };
  }
  if (part === 'chapter') {
    const chNum = payload.chapter_number || 1;
    const chPath = path.join(paths.dataDir, `chapter_${chNum}.json`);
    fs.writeFileSync(chPath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: `第 ${chNum} 章已保存` };
  }
  if (part === 'finalScript') {
    fs.writeFileSync(paths.finalScriptPath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: '全文文案与终稿已保存' };
  }
  return { ok: false, error: '未知数据分区类型: ' + part };
}

function syncWriterToProducer(projectId, finalScriptOrText) {
  let content = '';
  let title = '';
  if (typeof finalScriptOrText === 'string') {
    content = finalScriptOrText;
  } else if (finalScriptOrText && typeof finalScriptOrText === 'object') {
    title = finalScriptOrText.title || '';
    content = JSON.stringify(finalScriptOrText, null, 2);
  }
  const result = createProjectFromScript({
    projectId,
    title,
    content,
    targetSeconds: 5.5
  });
  return result;
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

    // 0.1 扫描本地 exports/ 文案库
    if (req.method === 'GET' && pathname === '/api/scan-local-scripts') {
      const scripts = scanLocalExportScripts();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, scripts }));
    }

    // 0.2 获取 exports/ 具体文案全文
    if (req.method === 'GET' && pathname === '/api/get-export-script') {
      const filename = path.basename(url.searchParams.get('filename') || '');
      const fullPath = path.join(rootDir, 'exports', filename);
      if (!fs.existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '文件不存在' }));
      }
      const raw = fs.readFileSync(fullPath, 'utf8');
      const ext = path.extname(filename).toLowerCase();
      let title = path.basename(filename, ext);
      let suggestedProjectId = '';

      if (ext === '.json') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.title) title = parsed.title;
          if (parsed.project_id) suggestedProjectId = parsed.project_id;
        } catch (e) {}
      } else {
        const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const cleanFirst = lines[0].replace(/^#+\s*/, '').replace(/^《(.*)》$/, '$1').trim();
          if (cleanFirst && cleanFirst.length < 50) title = cleanFirst;
        }
        const idMatch = raw.match(/(?:项目ID|project_id|Project ID)[:：]\s*([a-zA-Z0-9_-]+)/i);
        if (idMatch) suggestedProjectId = idMatch[1];
      }

      if (!suggestedProjectId) {
        const safeBase = path.basename(filename, ext).replace(/[^\w]/g, '_').toLowerCase().slice(0, 24);
        suggestedProjectId = `why_${safeBase || 'project'}_001`.replace(/_+/g, '_');
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, filename, title, suggestedProjectId, content: raw }));
    }

    // 0.3 实时切片预览
    if (req.method === 'POST' && pathname === '/api/preview-script-segmentation') {
      const body = await readBody(req);
      const previewResult = parseScriptToScenes(body.content || '', {
        projectId: body.projectId || 'why_preview',
        title: body.title || '',
        targetSeconds: Number(body.targetSeconds) || 5.5,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...previewResult }));
    }

    // 0.4 确认导入并创建工程
    if (req.method === 'POST' && pathname === '/api/import-script-project') {
      const body = await readBody(req);
      const resData = createProjectFromScript({
        projectId: body.projectId,
        title: body.title,
        content: body.content,
        targetSeconds: Number(body.targetSeconds) || 5.5,
      });
      res.writeHead(resData.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(resData));
    }

    // 0.5 获取文案创作台 (Writer) 数据
    if (req.method === 'GET' && pathname === '/api/writer/data') {
      const data = getWriterProjectData(queryProject);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...data }));
    }

    // 0.6 保存文案创作台 (Writer) 单个阶段数据
    if (req.method === 'POST' && pathname === '/api/writer/save') {
      const body = await readBody(req);
      const part = body.part;
      const payload = body.data;
      const resData = saveWriterProjectData(queryProject, part, payload);
      res.writeHead(resData.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(resData));
    }

    // 0.7 文案终稿一键同步至视觉分镜台 (Producer) 并生成镜头清单
    if (req.method === 'POST' && pathname === '/api/writer/sync-to-producer') {
      const body = await readBody(req);
      const resData = syncWriterToProducer(queryProject, body.finalScript || body.content);
      res.writeHead(resData.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(resData));
    }

    // 0.8 AI 生成立项 Brief
    if (req.method === 'POST' && pathname === '/api/writer/ai/generate-brief') {
      const body = await readBody(req);
      const { title, materials, durationMinutes = 25, model, apiKey, baseUrl } = body;
      if (!title || !materials || materials.trim().length < 15) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '请提供明确的视频题目和至少一段真实的参考资料' }));
      }
      const sys = `你是一名严谨的知识型长视频纪录片策划总监。请根据用户提供的选题与资料，生成一份标准的视频立项 brief。
必须且仅输出合法的 JSON 格式，字段包括：
{
  "project_id": "why_xxx_001",
  "title": "视频标题（为什么……）",
  "core_question": "全片核心设问",
  "short_answer": "开篇前2分钟给出的简短核心答案（2-4句话，通俗透彻）",
  "target_duration_minutes": 25,
  "estimated_word_count": 6500,
  "planned_chapter_count": 6,
  "scope": {
    "time_range": "时间跨度",
    "geographic_scope": "地理范围",
    "included_dimensions": ["机制一", "机制二"],
    "excluded_dimensions": ["排除领域"]
  },
  "taboos_and_exclusions": ["严禁模仿特定博主口吻", "零编造", "禁用排外煽情"]
}`;
      const user = `【视频题目】：${title}\n【预期时长】：${durationMinutes} 分钟\n【原始研究资料】：\n${materials}`;
      const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 2500 });
      const parsed = extractJsonFromText(aiText);
      if (parsed) {
        parsed.project_id = queryProject;
        saveWriterProjectData(queryProject, 'brief', parsed);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, brief: parsed, rawAi: aiText }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '大模型未返回符合规范的 Brief JSON', rawAi: aiText }));
    }

    // 0.9 AI 从原始资料提取原子化证据卡
    if (req.method === 'POST' && pathname === '/api/writer/ai/extract-evidence') {
      const body = await readBody(req);
      const { title, materials, model, apiKey, baseUrl } = body;
      const sys = `你是一名严谨的知识型纪录片资料考证员。你的任务是将用户提供的原始资料拆解为一组原子化的证据卡（Evidence Cards）。
核心规则：
1. 每张证据卡只包含一个独立事实主张；
2. claim_type 严格限定四选一：verified_fact（已证实客观事实）、disputed_claim（存在争议）、legend_or_anecdote（民间传说/轶事）、author_interpretation（主观推论）；
3. 必须输出 JSON 数组，每项包含：
   - evidence_id: 如 "EV-001"
   - claim_type: 四选一
   - evidence_summary: 事实客观中文概括
   - source_title: 资料出处说明
   - reliability: high / medium / low
请直接输出纯 JSON 数组，严禁包含任何前缀后缀说明。`;
      const user = `【视频题目】：${title}\n【原始资料内容】：\n${materials}`;
      const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 3500 });
      let list = extractJsonFromText(aiText);
      if (Array.isArray(list) && list.length > 0) {
        saveWriterProjectData(queryProject, 'evidenceCards', list);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, evidenceCards: list }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '大模型未返回证据卡 JSON 数组', rawAi: aiText }));
    }

    // 0.10 AI 基于证据卡构建 5~7 章大纲
    if (req.method === 'POST' && pathname === '/api/writer/ai/build-outline') {
      const body = await readBody(req);
      const { brief, evidenceCards, model, apiKey, baseUrl } = body;
      const sys = `你是一名知识型长视频总编剧。请基于 brief 与已审核的证据卡列表，构建一份 5 到 7 章的标准结构化大纲。
核心规则：
1. 单章单问：每一章必须且仅回答一个明确的子问题；
2. 5~7 章递进：第1章破除表面误解与建立反差，第2-3章底层地理/历史/技术机制，第4-5章商业/基建/制度转折，第6-7章现代固化与代价；
3. 必须绑定 supporting_evidence_ids；
4. 必须且仅输出合法的 JSON 格式：
{
  "project_id": "xxx",
  "title": "视频标题",
  "approval_status": "pending_user_review",
  "opening_hook": {
    "opening_question": "开头抛出的生活反差矛盾",
    "immediate_short_answer": "前2分钟直接给出的核心答案",
    "supporting_evidence_ids": ["EV-001"]
  },
  "chapters": [
    {
      "chapter_number": 1,
      "chapter_title": "第1章标题",
      "sub_question": "本章回答的核心子问题",
      "mechanism_or_background_summary": "机制阐述",
      "supporting_evidence_ids": ["EV-001", "EV-002"],
      "transition_to_next": "引向下一章的自然过渡设问"
    }
  ],
  "single_ending_plan": {
    "revisit_core_question": "回扣开篇核心问题",
    "final_takeaway": "全片唯一收尾升华，严禁加入未经前文证实的新事实"
  }
}`;
      const user = `【立项 Brief】：\n${JSON.stringify(brief, null, 2)}\n\n【可用证据卡列表】：\n${JSON.stringify(evidenceCards, null, 2)}`;
      const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 4000 });
      const outline = extractJsonFromText(aiText);
      if (outline && Array.isArray(outline.chapters)) {
        outline.project_id = queryProject;
        outline.approval_status = 'pending_user_review';
        saveWriterProjectData(queryProject, 'outline', outline);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, outline }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '大模型未返回符合规范的 Outline JSON', rawAi: aiText }));
    }

    // 0.11 AI 单章受控撰写 (四段式结构)
    if (req.method === 'POST' && pathname === '/api/writer/ai/write-chapter') {
      const body = await readBody(req);
      const { chapterNumber, outline, evidenceCards, model, apiKey, baseUrl } = body;
      const targetChapter = (outline.chapters || []).find((c) => Number(c.chapter_number) === Number(chapterNumber));
      if (!targetChapter) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: `在大纲中未找到第 ${chapterNumber} 章` }));
      }

      const sys = `你是一名知识型纪录片撰稿人。你的任务是严格撰写指定单章的旁白文稿。
核心规则：
1. 严禁一次写整片，只写当前这一章（约 800-1400 中文字）；
2. 内部结构严格遵循四段式：
   - 1_question_or_contradiction: 章节问题或矛盾（承接上文）
   - 2_mechanism_or_background: 形成机制或底层背景（逻辑拆解）
   - 3_sourced_concrete_examples: 有来源的具体例子（绑定证据卡，平实具象，严禁伪造内心独白）
   - 4_mini_summary_and_transition: 小结与自然引出下一章（非终章严禁做全局大总结）
3. 必须输出合法 JSON 格式：
{
  "chapter_number": ${chapterNumber},
  "chapter_title": "${targetChapter.chapter_title}",
  "sub_question": "${targetChapter.sub_question}",
  "sections": {
    "1_question_or_contradiction": "...",
    "2_mechanism_or_background": "...",
    "3_sourced_concrete_examples": "...",
    "4_mini_summary_and_transition": "..."
  },
  "full_chapter_narration": "拼接后的单章完整口语化旁白正文",
  "used_evidence_ids": targetChapter.supporting_evidence_ids,
  "word_count": 1000
}`;
      const user = `【本章大纲规划】：\n${JSON.stringify(targetChapter, null, 2)}\n\n【关联证据卡库】：\n${JSON.stringify(evidenceCards, null, 2)}`;
      const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 4000 });
      const chData = extractJsonFromText(aiText);
      if (chData && chData.sections) {
        chData.chapter_number = Number(chapterNumber);
        if (!chData.full_chapter_narration) {
          chData.full_chapter_narration = Object.values(chData.sections).filter(Boolean).join('\n\n');
        }
        chData.word_count = chData.full_chapter_narration.length;
        saveWriterProjectData(queryProject, 'chapter', chData);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, chapter: chData }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '大模型未返回符合规范的章节 JSON', rawAi: aiText }));
    }

    // 0.12 AI 全文统稿去伪结尾与定稿
    if (req.method === 'POST' && pathname === '/api/writer/ai/finalize-script') {
      const body = await readBody(req);
      const { outline, chapters, model, apiKey, baseUrl } = body;
      const sys = `你是一名资深长视频总编审。你的任务是对全片章节进行全文统稿编辑（Full Script Editing）。
核心规则：
1. 删除跨章节重复论点与重复例子；
2. 统一全片术语、年代读法与口语化节奏；
3. 识别并删除中间各章节末尾的“伪结尾”，全片只保留一个正式终局结尾；
4. 输出标准 final-script.json 结构：
{
  "project_id": "xxx",
  "title": "视频标题",
  "total_word_count": 6500,
  "estimated_duration_minutes": 25.0,
  "revision_count": 0,
  "editorial_changes_log": {
    "removed_duplicate_arguments": ["删除了第X章关于...的重复解释"],
    "removed_duplicate_examples": ["统一了...案例的出场位置"],
    "unified_terms_and_names": ["统一专有名词"],
    "removed_false_endings_count": 2
  },
  "script_segments": {
    "opening": "开篇旁白正文",
    "chapters": [
      {
        "chapter_number": 1,
        "chapter_title": "第1章标题",
        "narration_text": "本章正文"
      }
    ],
    "ending": "全片唯一终局收尾正文"
  }
}`;
      const user = `【大纲结构】：\n${JSON.stringify(outline, null, 2)}\n\n【全部已撰写章节】：\n${JSON.stringify(chapters, null, 2)}`;
      const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 4500 });
      const finalScript = extractJsonFromText(aiText);
      if (finalScript && finalScript.script_segments) {
        finalScript.project_id = queryProject;
        saveWriterProjectData(queryProject, 'finalScript', finalScript);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, finalScript }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '大模型未返回符合规范的 final-script JSON', rawAi: aiText }));
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
      const assetIndex = fs.existsSync(paths.assetIndexPath)
        ? JSON.parse(fs.readFileSync(paths.assetIndexPath, 'utf8'))
        : { assets: [] };
      const promptConfig = fs.existsSync(paths.promptConfigPath)
        ? JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'))
        : {
            selected_visual_model: 'remotion_procedural',
            global_ai_visual_prompt:
              '作为 16:9 纪录片视觉总监，结合旁白片段与关键词，在 16:9 画幅中央提炼一个醒目标志大字（不超过 14 字），搭配 1 条副级阐述，用于动效视觉传达。',
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
        recalculateTimelines(body.manifest);
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

    // 3. ✂️ 画面切分 (Split Shot)
    if (req.method === 'POST' && pathname === '/api/split-shot') {
      const body = await readBody(req);
      const { sceneIndex, splitCharIndex, projectId } = body;
      const targetProject = projectId || queryProject;
      const curPaths = getPaths(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scenes = manifest.scenes || [];
      const idx = typeof sceneIndex === 'number' ? sceneIndex : scenes.findIndex((s) => s.scene_id === body.sceneId);

      if (idx >= 0 && idx < scenes.length) {
        const original = scenes[idx];
        const fullText = original.narration_text || '';

        let splitPos = splitCharIndex;
        if (typeof splitPos !== 'number' || splitPos <= 0 || splitPos >= fullText.length) {
          const matchComma = fullText.slice(10).search(/[，,；;。]/);
          splitPos = matchComma !== -1 ? 10 + matchComma + 1 : Math.floor(fullText.length / 2);
        }

        const text1 = fullText.slice(0, splitPos).trim();
        const text2 = fullText.slice(splitPos).trim();

        if (text1 && text2) {
          const ratio = text1.length / (text1.length + text2.length);
          const dur1 = Math.max(3500, Math.round(original.duration_ms * ratio));
          const dur2 = Math.max(3500, original.duration_ms - dur1);

          original.narration_text = text1;
          original.duration_ms = dur1;
          if (original.ppt_slide_spec) {
            original.ppt_slide_spec.subtitle = text1.slice(0, 24);
          }

          const newShot = JSON.parse(JSON.stringify(original));
          newShot.narration_text = text2;
          newShot.duration_ms = dur2;
          newShot.ppt_slide_spec = {
            theme_title: text2.slice(0, 10),
            subtitle: text2.slice(0, 24),
            bullet_points: [`要义阐述：${text2.slice(0, 20)}`],
            custom_prompt: '',
          };
          newShot.shared_asset_with_prev = false;

          scenes.splice(idx + 1, 0, newShot);
          recalculateTimelines(manifest);
          syncTableToManifest(manifest);

          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          recompileProject(targetProject);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, manifest, message: `成功切分为两个镜头：${(dur1/1000).toFixed(1)}s 和 ${(dur2/1000).toFixed(1)}s` }));
        }
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '切分失败：未找到有效切分点' }));
    }

    // 4. 🔗 画面合并 (Merge Shot with Next)
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

        s1.narration_text = `${s1.narration_text} ${s2.narration_text}`.trim();
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
        recalculateTimelines(manifest);
        syncTableToManifest(manifest);

        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        recompileProject(targetProject);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, manifest, message: `成功合并两个镜头，总时长为 ${(s1.duration_ms/1000).toFixed(1)}s` }));
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '合并失败：下一镜头不存在' }));
    }

    // 4.1 测试各平台 API 连接 (OpenRouter / SiliconFlow / Runway / Remotion)
    if (req.method === 'POST' && (pathname === '/api/test-provider' || pathname === '/api/test-openrouter')) {
      const body = await readBody(req);
      const { provider = 'openrouter', apiKey, baseUrl, model } = body;

      // 本地免 Key 开发模式 / Antigravity 调试模式
      if (!apiKey || apiKey === 'antigravity-local-dev' || provider === 'antigravity' || (baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')))) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs: 1,
          message: '✅ Antigravity 本地协同开发引擎已就绪！开发调试全程零费用，无需外部 API Key！'
        }));
      }

      const startTime = Date.now();
      try {
        if (provider === 'siliconflow') {
          const cleanBase = (baseUrl || 'https://api.siliconflow.cn/v1').trim().replace(/\/+$/, '');
          const testRes = await fetch(`${cleanBase}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          const latencyMs = Date.now() - startTime;
          if (!testRes.ok) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `SiliconFlow 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            message: `SiliconFlow (硅基流动) 连接成功！模型网关正常（耗时 ${latencyMs}ms）`
          }));
        } else if (provider === 'runway') {
          const cleanBase = (baseUrl || 'https://api.dev.runwayml.com/v1').trim().replace(/\/+$/, '');
          const testRes = await fetch(`${cleanBase}/tasks`, {
            headers: {
              'Authorization': `Bearer ${apiKey.trim()}`,
              'X-Runway-Version': '2024-09-13'
            }
          });
          const latencyMs = Date.now() - startTime;
          if (testRes.status === 401 || testRes.status === 403) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `Runway 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            message: `Runway API 连接正常！耗时 ${latencyMs}ms`
          }));
        } else if (provider === 'gemini' || (baseUrl && baseUrl.includes('generativelanguage.googleapis.com'))) {
          // Google Gemini 官方端点：直接向官方 /models 端点验证 API Key 有效性（零模型依赖）
          const cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '');
          const rootBase = cleanBase.replace(/\/openai\/?$/, '');
          const testUrl = `${rootBase}/models?key=${apiKey.trim()}`;

          const testRes = await fetch(testUrl);
          const latencyMs = Date.now() - startTime;
          if (!testRes.ok) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `Google Gemini 校验未通过 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`,
            }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            message: `Google Gemini 官方 API 连接成功！（密钥有效，耗时 ${latencyMs}ms）`,
          }));
        } else if (baseUrl && (baseUrl.includes('127.0.0.1:51000') || baseUrl.includes('localhost:51000'))) {
          // 本地 Antigravity 网关测试
          const cleanBase = baseUrl.trim().replace(/\/+$/, '');
          const testRes = await fetch(`${cleanBase.replace(/\/v1beta\/?$/, '')}/health`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          const latencyMs = Date.now() - startTime;
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: testRes.ok,
            latencyMs,
            message: testRes.ok ? `本地 Antigravity 模型网关连接成功！（耗时 ${latencyMs}ms）` : '本地网关返回异常',
          }));
        } else if (provider === 'remotion') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs: 1,
            message: 'Remotion 内置规则引擎零成本就绪，无需 API Key！'
          }));
        } else {
          // OpenRouter
          const cleanBase = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
          const targetUrl = `${cleanBase}/chat/completions`;
          const testRes = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey.trim()}`,
              'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
              'X-Title': 'WhyVideo Studio'
            },
            body: JSON.stringify({
              model: (model || 'deepseek/deepseek-chat').trim(),
              messages: [{ role: 'user', content: 'Say "OK" in 1 word' }],
              max_tokens: 5,
            }),
          });

          const latencyMs = Date.now() - startTime;
          if (!testRes.ok) {
            const errText = await testRes.text();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: false,
              latencyMs,
              error: `OpenRouter 响应异常 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
            }));
          }

          const data = await testRes.json();
          const reply = data.choices?.[0]?.message?.content?.trim() || 'OK';
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            latencyMs,
            model: (model || 'deepseek/deepseek-chat').trim(),
            reply,
            message: `OpenRouter 连接成功！模型 ${model || 'deepseek/deepseek-chat'} 响应正常（耗时 ${latencyMs}ms）`
          }));
        }
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: `无法连接到服务: ${err.message}`
        }));
      }
    }

    // 4.15 获取 OpenRouter 真实支持的最新模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 80) : '',
            context_length: m.context_length
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash' },
          { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic Claude Sonnet 4.5' },
          { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
          { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' }
        ]
      }));
    }

    // 4.16 获取 OpenRouter 原生支持的全部 31+ 款 AI 视频生成模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-video-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/videos/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : '',
            durations: m.supported_durations,
            aspect_ratios: m.supported_aspect_ratios
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter video models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'minimax/hailuo-3-max', name: 'MiniMax: H3 Max' },
          { id: 'minimax/hailuo-3', name: 'MiniMax: H3 (海螺视频 3)' },
          { id: 'bytedance/seedance-2.0', name: 'ByteDance: Seedance 2.0' },
          { id: 'alibaba/wan-2.6', name: 'Alibaba: Wan 2.6' },
          { id: 'kwaivgi/kling-v3.0-std', name: 'Kling: Video v3.0 Standard' },
          { id: 'google/veo-3.1-fast', name: 'Google: Veo 3.1 Fast' },
          { id: 'runway/gen-4.5', name: 'Runway: Gen-4.5' }
        ]
      }));
    }

    // 4.17 获取 OpenRouter 原生支持的全部 62+ 款 AI 生图模型列表
    if (req.method === 'GET' && pathname === '/api/openrouter-image-models') {
      try {
        const resModels = await fetch('https://openrouter.ai/api/v1/images/models', {
          headers: {
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          }
        });
        if (resModels.ok) {
          const mJson = await resModels.json();
          const list = (mJson.data || []).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : ''
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, models: list }));
        }
      } catch (e) {
        console.error('Failed to fetch openrouter image models:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        models: [
          { id: 'black-forest-labs/flux-3-image', name: 'FLUX 3 Image' },
          { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max' },
          { id: 'recraft/recraft-v4.1', name: 'Recraft V4.1' },
          { id: 'google/gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
          { id: 'openai/gpt-image-2', name: 'GPT Image 2' }
        ]
      }));
    }

    // 4.2 保存模型网关配置 (统一 OpenRouter / 网关多模型映射)
    if (req.method === 'POST' && (pathname === '/api/save-visual-config' || pathname === '/api/save-openrouter-config')) {
      const body = await readBody(req);
      const targetProject = body.projectId || queryProject;
      const curPaths = getPaths(targetProject);
      let existing = {};
      if (fs.existsSync(curPaths.promptConfigPath)) {
        try { existing = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
      }
      const updated = {
        ...existing,
        provider: 'openrouter',
        baseUrl: body.baseUrl || existing.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey: body.apiKey !== undefined ? body.apiKey : (existing.apiKey || ''),
        textModel: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
        videoModel: body.videoModel || existing.videoModel || 'minimax/hailuo-3-max',
        imageModel: body.imageModel || existing.imageModel || 'black-forest-labs/flux-3-image',
        bgmModel: body.bgmModel || existing.bgmModel || 'deepseek/deepseek-chat',
        model: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
        selected_visual_model: 'openrouter',
        updated_at: new Date().toISOString()
      };

      fs.writeFileSync(curPaths.promptConfigPath, JSON.stringify(updated, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, config: updated, message: '模型网关配置已保存！' }));
    }

    // 4.25 开发态 Antigravity 调试副驾驶端点 (生产发布若移除 dev-bridge.mjs 则安全忽略)
    if (req.method === 'GET' && pathname === '/api/dev/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        enabled: Boolean(devBridge && devBridge.IS_DEV_MODE),
        mode: 'antigravity-dev-copilot',
        message: devBridge ? '开发态 Antigravity 调试助手已就绪' : '生产模式（开发态接口已剥离）'
      }));
    }

    if (req.method === 'GET' && pathname === '/api/dev/audit') {
      if (!devBridge) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '开发态组件已剥离' }));
      }
      const curPaths = getPaths(queryProject);
      if (!fs.existsSync(curPaths.manifestPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '未找到分镜清单' }));
      }
      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const report = devBridge.auditScenes(manifest);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, report }));
    }

    if (req.method === 'POST' && pathname === '/api/dev/chat') {
      if (!devBridge) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '开发态组件已剥离' }));
      }
      const body = await readBody(req);
      const { projectId = queryProject, prompt } = body;
      const curPaths = getPaths(projectId);
      let promptCfg = {};
      if (fs.existsSync(curPaths.promptConfigPath)) {
        try { promptCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
      }
      try {
        const result = await devBridge.executeDevChat({
          projectId,
          prompt,
          visualConfig: promptCfg
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    if (req.method === 'POST' && pathname === '/api/dev/apply-patch') {
      if (!devBridge) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '开发态组件已剥离' }));
      }
      const body = await readBody(req);
      const { projectId = queryProject, sceneId, patch } = body;
      try {
        const result = devBridge.applyScenePatch(projectId, sceneId, patch);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

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
      const result = await callOpenRouterPromptExtractor(normalizedCfg, narrationText, targetMode, keywords, templateStyle, projectContext);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, ...result }));
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

        // 本地免 Key 模式：调用 Remotion 离线动效引擎就绪
        if (!normalizedCfg.apiKey || normalizedCfg.apiKey === 'antigravity-local-dev' || (normalizedCfg.baseUrl && normalizedCfg.baseUrl.includes('localhost'))) {
          s.visual_type = 'photo_motion';
          s.target_visual_mode = 'video';
          s.status = 'READY_APPROVED';
          s.review_status = 'APPROVED';
          s.ai_visual_prompt = videoPrompt;
          syncTableToManifest(targetManifest);
          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
          recompileProject(targetProject);
          const stillRelPath = renderRemotionCardStill(curPaths, s.scene_id, targetProject);
          if (stillRelPath) {
            s.preview_image_url = `/public/${targetProject}/${stillRelPath}?t=${Date.now()}`;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            manifest: targetManifest,
            previewUrl: s.preview_image_url,
            message: `🎬 镜头 ${s.scene_id} 运镜画面已由 Remotion 本地动效引擎就绪！若需生成云端实体 MP4 视频，可在右上角填入对应视频模型 API Key。`
          }));
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

        // 本地免 Key 模式：无需 API Key，提示在 Antigravity 对话框中调用内置生图引擎
        if (!normalizedCfg.apiKey || normalizedCfg.apiKey === 'antigravity-local-dev' || (normalizedCfg.baseUrl && normalizedCfg.baseUrl.includes('localhost'))) {
          s.visual_type = 'photo_motion';
          s.scene_type = 'photo_motion';
          s.target_visual_mode = 'image';
          s.status = 'READY_APPROVED';
          s.review_status = 'APPROVED';
          s.ai_visual_prompt = imgPrompt;
          syncTableToManifest(targetManifest);
          fs.writeFileSync(curPaths.manifestPath, JSON.stringify(targetManifest, null, 2), 'utf8');
          recompileProject(targetProject);
          const stillRelPath = renderRemotionCardStill(curPaths, s.scene_id, targetProject);
          if (stillRelPath) {
            s.preview_image_url = `/public/${targetProject}/${stillRelPath}?t=${Date.now()}`;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            manifest: targetManifest,
            previewUrl: s.preview_image_url,
            message: `💡 镜头 ${s.scene_id} 已设定实景摄影构图。您可直接在 Antigravity 聊天窗口对我说：『请为镜头 ${s.scene_id} 生成 16:9 实景图』，我将调用内置生图引擎生成后自动存入工程，全程零费用！`
          }));
        }

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

        // 本地免 Key 模式：调用 Remotion 原生离线卡片引擎进行即时渲染
        if (!normalizedCfg.apiKey || normalizedCfg.apiKey === 'antigravity-local-dev' || (normalizedCfg.baseUrl && normalizedCfg.baseUrl.includes('localhost'))) {
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
            generated_model: 'Antigravity Local Engine',
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

      const newAsset = {
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${targetProject}/public/${relPath}`,
        file_name: fileName,
        type: isVideo ? 'video' : 'image',
        media_type: isVideo ? 'video' : 'image',
        duration_seconds: isVideo ? 15.0 : null,
        duration_sec: isVideo ? 15.0 : null,
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

      const rangeMatch = pStr.match(/(?:从)?(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:秒)?\s*(?:到|至|-|~)\s*(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:秒)?/i);
      const startMatch = pStr.match(/(?:从|第)\s*(\d+(?:\.\d+)?)\s*(?:秒)?(?:开始|起)?/i);
      const headMatch = pStr.match(/取前\s*(\d+(?:\.\d+)?)\s*秒/i);

      if (rangeMatch) {
        startSec = parseFloat(rangeMatch[1]);
        endSec = parseFloat(rangeMatch[2]);
      } else if (headMatch) {
        startSec = 0.0;
        endSec = parseFloat(headMatch[1]);
      } else if (startMatch) {
        startSec = parseFloat(startMatch[1]);
        endSec = startSec + reqSec;
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
        scene.source_mode = 'ai_ppt_slide';
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, manifest }));
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

    // 10. 配音合成接口 (ElevenLabs / Voicebox)
    if (req.method === 'POST' && pathname === '/api/synthesize-voice') {
      const body = await readBody(req);
      const { projectId = queryProject, provider = 'elevenlabs', voiceId = '21m00Tcm4TlvDq8ikWAM', apiKey, text, sceneId } = body;
      const curPaths = getPaths(projectId);
      fs.mkdirSync(curPaths.audioDir, { recursive: true });

      if (provider === 'elevenlabs') {
        const effectiveKey = apiKey || process.env.ELEVENLABS_API_KEY;
        if (!effectiveKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '未配置 ElevenLabs API Key。请在操作界面中输入或在根目录 .env 中写入 ELEVENLABS_API_KEY=xxx' }));
        }

        const outFileName = sceneId ? `voice_${sceneId.toLowerCase()}.mp3` : `narration_${Date.now()}.mp3`;
        const outFilePath = path.join(curPaths.audioDir, outFileName);

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': effectiveKey,
          },
          body: JSON.stringify({
            text: text || '这是来自 WhyVideo 操作界面的测试旁白音频。',
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `ElevenLabs 接口调用失败: ${errText}` }));
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outFilePath, Buffer.from(arrayBuffer));

        const publicAudioUrl = `/public/${projectId}/audio/${outFileName}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, audioUrl: publicAudioUrl, message: `ElevenLabs 配音已成功保存至 ${outFileName}` }));
      } else if (provider === 'voicebox') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, message: 'Voicebox 本地模型已预留端口连接配置。请确保您的本地 Voicebox 服务已启动于 http://localhost:8080。' }));
      }
    }

    // 11. 静态媒体文件路由
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
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
          return fs.createReadStream(filePath).pipe(res);
        }
      }
    }

    // 主页面渲染
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMainHtml(queryProject));
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
    console.log(`🚀 WhyVideo 视觉模型配置与即时生成工作台已启动！`);
    console.log(`👉 请在浏览器中打开：http://localhost:${portToTry}`);
    console.log(`=============================================================\n`);
  });
}
startServer(Number(PORT));

function renderMainHtml(curProjectId = defaultProjectId) {
  const serverProjects = listProjects();
  const serverOptions = serverProjects.map((project) => {
    const selected = project.id === curProjectId ? ' selected' : '';
    const safeId = String(project.id).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeTitle = String(project.title || project.id).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<option value="${safeId}"${selected}>${safeTitle} (${safeId})</option>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhyVideo Studio - 视觉模型配置与生成工作台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0B0F17; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .card { background-color: #151D2A; border: 1px solid #233044; }
    .db-table th { background-color: #1A2436; border-bottom: 2px solid #2E3D52; border-right: 1px solid #233044; position: sticky; top: 0; z-index: 10; }
    .db-table td { border-bottom: 1px solid #233044; border-right: 1px solid #233044; vertical-align: top; }
    .db-table tr:hover td { background-color: #192334; }
    .badge-gold { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); }
    .dropzone-hover { border-color: #38bdf8 !important; background-color: rgba(56, 189, 248, 0.25) !important; transform: scale(1.02); }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-6">
  <div class="max-w-[1720px] mx-auto space-y-5">

    <!-- 顶部导航栏与工程选择 -->
    <header class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-6 gap-y-3 pb-4 border-b border-gray-800">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            WhyVideo Studio · AI 视频模型调度版
          </span>
          
          <div class="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded-xl border border-amber-500/40 shadow-inner relative z-20">
            <span class="text-xs font-bold text-amber-300 shrink-0">📁 制作工程：</span>
            <select id="projectSelect" onchange="onProjectSelectChange(this.value)" style="color-scheme: dark;" class="relative z-30 bg-gray-950 text-white font-extrabold text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-amber-400 cursor-pointer min-w-[200px] max-w-[320px]">
              ${serverOptions}
            </select>
            <button id="btnConfirmProject" onclick="confirmSwitchProject()" class="px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 hover:brightness-110 text-gray-950 font-black text-xs shadow transition cursor-pointer shrink-0">确定</button>
            <button id="btnDeleteProject" onclick="deleteCurrentProject()" class="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-600 border border-rose-500/50 text-rose-300 hover:text-white text-xs font-bold transition cursor-pointer shrink-0" title="删除当前工程">🗑️ 删除</button>
          </div>

          <span id="projectStageBadge" class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            加载中...
          </span>
        </div>

        <h1 id="projectHeaderTitle" class="text-2xl font-black text-white mt-2">
          视觉镜头工作台（AI 视频模型指定 · 行内即时生成与 16:9 预览 · 桌面拖拽）
        </h1>
      </div>

      <div class="min-w-0 flex flex-col items-end gap-2 w-full">
        <!-- 固定的共享导航行：切换工作台时位置不变 -->
        <div class="inline-flex p-1 bg-gray-950/90 rounded-xl border border-purple-500/40 shadow-inner self-end">
          <button id="navTabWriter" type="button" onclick="switchWorkspaceTab('writer')" class="px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer">
            ✍️ 文案创作台 (Writer)
          </button>
          <button id="navTabProducer" type="button" onclick="switchWorkspaceTab('producer')" class="px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-gray-950 shadow cursor-pointer">
            🎬 视觉分镜台 (Producer)
          </button>
        </div>

        <!-- 两种工作台共用固定高度的操作区，避免下方内容随按钮换行跳动 -->
        <div class="min-h-[80px] w-full flex items-start justify-end">
      <!-- 视觉分镜制作台快捷操作组 -->
      <div id="producerHeaderActions" class="w-full flex flex-wrap content-start justify-end items-center gap-3">
        <!-- 核心新增：AI 视频与画面模型配置中心 -->
        <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition shadow-lg flex items-center gap-1.5 cursor-pointer">
          🎬 AI 画面/视频模型指定
        </button>
        <button onclick="toggleAudioModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white transition shadow-lg flex items-center gap-1.5 cursor-pointer">
          🎙️ 配音引擎配置
        </button>
        <button onclick="toggleBgmModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-gray-950 transition shadow-lg flex items-center gap-1.5 cursor-pointer">
          🎵 AI 自适应 BGM 工作台
        </button>
        <button onclick="autoGenerateAllPromptsForPage()" class="px-3.5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition shadow-lg flex items-center gap-1.5 cursor-pointer" title="根据本页所有镜头的旁白内容，一键自动填入最佳运镜与视觉指示词">
          ✨ 一键提炼全页指示词
        </button>
        <button onclick="generateAllPpt()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition shadow-lg flex items-center gap-1.5 cursor-pointer">
          ⚡ 批量生成全部 AI 画面
        </button>
        <button onclick="saveAll()" class="px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-gray-950 transition shadow-lg cursor-pointer">
          💾 保存镜头表并同步 Remotion
        </button>
        <a href="http://localhost:3100" target="_blank" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-blue-500 text-blue-300 transition">
          🎬 Remotion 预览 (:3100) ↗
        </a>
      </div>

      <!-- 文案创作台快捷操作组 (初始隐藏，切换到 Writer 时激活) -->
      <div id="writerHeaderActions" class="hidden w-full flex flex-wrap content-start justify-end items-center gap-3">
        <button type="button" onclick="openWriterImportDirectly()" class="px-3.5 py-2 text-xs font-bold rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/40 transition shadow flex items-center gap-1.5 cursor-pointer">
          📥 导入已有文案 (exports/)
        </button>
        <button type="button" onclick="saveCurrentWriterPart()" class="px-3.5 py-2 text-xs font-bold rounded-xl bg-gray-900 hover:bg-gray-800 text-amber-300 border border-amber-500/40 transition shadow flex items-center gap-1.5 cursor-pointer">
          💾 保存当前草稿
        </button>
        <button type="button" onclick="syncWriterToProducerUI()" class="px-4 py-2 text-xs font-extrabold rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-110 text-gray-950 transition shadow-xl flex items-center gap-1.5 cursor-pointer">
          🚀 文案定稿 · 一键流转至制作台
        </button>
      </div>
        </div>
      </div>
    </header>

    <!-- 视图 1：视觉分镜制作台 (Producer Workspace) -->
    <div id="viewProducerContainer" class="space-y-5">

    <!-- 视频预览 / 工程状态概览 -->
    <div id="videoContainer" class="card p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
    </div>

    <!-- 统计卡片与节拍看板 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div class="lg:col-span-8 card p-4 rounded-2xl space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-purple-300">🤖 当前指定模型：</span>
            <span id="currentVideoModelBadge" class="px-2 py-0.5 rounded text-[11px] font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">
              🎬 视频: minimax/hailuo-3
            </span>
            <span id="currentTextModelBadge" class="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/25 text-purple-200 border border-purple-500/40">
              ✍️ 分镜: deepseek-chat
            </span>
            <span id="currentImageModelBadge" class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/25 text-blue-200 border border-blue-500/40">
              🖼️ 生图: flux-3-image
            </span>
          </div>
          <button onclick="toggleVisualModelModal()" class="text-xs text-purple-400 hover:underline">
            切换 AI 视频 / 文本 / 生图模型 ⚙️
          </button>
        </div>
        <textarea id="globalPromptInput" rows="2" class="w-full px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-gray-100 focus:outline-none focus:border-purple-500" placeholder="在此输入你的 AI 画面生成规则..."></textarea>
      </div>

      <div class="lg:col-span-4 grid grid-cols-3 gap-3">
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-gray-400">镜头总数</span>
          <span class="text-xl font-black text-white mt-0.5" id="statTotal">-</span>
          <span class="text-[10px] text-gray-500" id="statAvgDur">平均 -s/镜</span>
        </div>
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-emerald-400">🟢 黄金节奏 (≤8.5s)</span>
          <span class="text-xl font-black text-emerald-400 mt-0.5" id="statGold">-</span>
          <span class="text-[10px] text-emerald-500/80">最适眼球留存</span>
        </div>
        <div class="card p-3 rounded-2xl flex flex-col justify-center">
          <span class="text-xs text-rose-400">🔴 超时镜头 (>10s)</span>
          <span class="text-xl font-black text-rose-400 mt-0.5" id="statOver">-</span>
          <span class="text-[10px] text-rose-500/80">点击 ✂️ 一键切分</span>
        </div>
      </div>
    </div>

    <!-- 视觉镜头主表格 -->
    <div class="card rounded-2xl overflow-hidden border border-gray-800">
      <div class="max-h-[720px] overflow-y-auto overflow-x-auto">
        <table class="w-full text-left text-xs db-table border-collapse">
          <thead>
            <tr class="text-gray-300 font-bold uppercase tracking-wider text-[11px]">
              <th class="p-3 w-32 text-center">镜头序号 / 时长</th>
              <th class="p-3 min-w-[240px]">当前镜头覆盖的旁白文本</th>
              <th class="p-3 min-w-[160px]">16:9 核心标志关键词</th>
              <th class="p-3 w-36">画面方式</th>
              <th class="p-3 min-w-[340px]">🎨 AI 生成画面（点击按钮即时生成 16:9 预览视觉卡）</th>
              <th class="p-3 min-w-[260px] text-center">📥 桌面拖拽素材 / 即时检验与 AI 剪辑</th>
              <th class="p-3 w-28 text-center">节拍调整</th>
            </tr>
          </thead>
          <tbody id="tableBody" class="divide-y divide-gray-800">
          </tbody>
        </table>
      </div>

      <div class="p-3 bg-gray-900/60 border-t border-gray-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-gray-400">💡 <b>提示</b>：点击第 5 列的 <b>【🎨 一键生成本镜头画面】</b>，系统会立即根据指定的 AI 模型在行内渲染出 16:9 科技视觉卡供您肉眼检验！</span>
        </div>
        <button onclick="saveAll()" class="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-gray-950 text-xs font-bold transition">
          💾 保存修改并同步渲染
        </button>
      </div>
    </div>

  </div>
  <!-- 视觉分镜制作台 (Producer Workspace) 结束 -->

  <!-- 视图 2：✍️ 知识长视频文案创作工坊 (Writer Workspace - 深度落地 WhyExplainerVideoWriter 标准) -->
  <div id="viewWriterContainer" class="space-y-5 hidden">
    
    <!-- 顶部五阶段导航与人工审核门禁指示条 -->
    <div class="card p-4 rounded-2xl border border-purple-500/30 bg-gradient-to-r from-gray-950 via-purple-950/20 to-gray-950">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-gray-800/80">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-purple-500/20 text-purple-300 border border-purple-500/40">
            ✍️ 文案策划工作流
          </span>
          <span class="text-xs text-gray-400">
            遵循知识型纪录片规范 · 零编造 · 证据卡核验 · 5~7章大纲 · 四段式单章受控撰写 · 单一终局结尾
          </span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="text-gray-400">当前阶段：</span>
          <span id="writerCurrentStepBadge" class="px-2.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            Step 1 · 立项与资料输入
          </span>
        </div>
      </div>

      <!-- 五阶段按钮指示器 (点击可直接跳转查看对应阶段) -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3">
        <button type="button" onclick="setWriterStep(1)" id="stepBtn1" class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-purple-600/20 border-purple-500 text-white shadow">
          <span class="w-6 h-6 rounded-full bg-purple-600 text-white font-bold flex items-center justify-center text-xs shrink-0">1</span>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate">立项与资料</div>
            <div class="text-[10px] text-gray-400 truncate">Brief & 设问</div>
          </div>
        </button>

        <button type="button" onclick="setWriterStep(2)" id="stepBtn2" class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white">
          <span class="w-6 h-6 rounded-full bg-gray-800 text-gray-300 font-bold flex items-center justify-center text-xs shrink-0">2</span>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate">证据卡提取核验</div>
            <div class="text-[10px] text-gray-400 truncate">Evidence Cards</div>
          </div>
        </button>

        <button type="button" onclick="setWriterStep(3)" id="stepBtn3" class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white">
          <span class="w-6 h-6 rounded-full bg-gray-800 text-gray-300 font-bold flex items-center justify-center text-xs shrink-0">3</span>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate">5~7章大纲策划</div>
            <div class="text-[10px] text-gray-400 truncate">Outline & 门禁</div>
          </div>
        </button>

        <button type="button" onclick="setWriterStep(4)" id="stepBtn4" class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white">
          <span class="w-6 h-6 rounded-full bg-gray-800 text-gray-300 font-bold flex items-center justify-center text-xs shrink-0">4</span>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate">逐章撰写与润色</div>
            <div class="text-[10px] text-gray-400 truncate">四段式单章受控</div>
          </div>
        </button>

        <button type="button" onclick="setWriterStep(5)" id="stepBtn5" class="p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white">
          <span class="w-6 h-6 rounded-full bg-gray-800 text-gray-300 font-bold flex items-center justify-center text-xs shrink-0">5</span>
          <div class="min-w-0">
            <div class="text-xs font-bold truncate">全文统稿与定稿</div>
            <div class="text-[10px] text-gray-400 truncate">去伪结尾并同步</div>
          </div>
        </button>
      </div>
    </div>

    <!-- 主工作区：左 30% 资料与设定参数，右 70% 阶段执行看板 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
      
      <!-- 左栏 (30% / 4 Cols)：工程基本设定、资料库与大模型配置 -->
      <div class="lg:col-span-4 space-y-4">
        
        <!-- 工程基础卡片 -->
        <div class="card p-4 rounded-2xl border border-gray-800 space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-gray-800">
            <span class="text-xs font-bold text-white flex items-center gap-1.5">
              <span>📌 当前工程信息</span>
            </span>
            <span id="writerProjectIdBadge" class="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800 text-purple-300 font-bold">
              why_project
            </span>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-300 mb-1">🏷️ 视频核心标题（提问形式）</label>
            <input type="text" id="wInputTitle" placeholder="例如：为什么日本温泉旅馆的晚餐常常是一小碟一小碟？"
              class="w-full bg-gray-950 text-white font-bold text-xs px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500" />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] text-gray-400 mb-1">⏱️ 目标时长 (分钟)</label>
              <input type="number" id="wInputDuration" value="25" min="5" max="60"
                class="w-full bg-gray-950 text-white font-mono text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label class="block text-[11px] text-gray-400 mb-1">📑 规划章节数</label>
              <input type="number" id="wInputChapterCount" value="6" min="5" max="7"
                class="w-full bg-gray-950 text-white font-mono text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500" />
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-gray-400 mb-1">🤖 写作所用大模型 (OpenRouter 网关)</label>
            <select id="wInputModel" class="w-full bg-gray-950 text-white text-xs px-2.5 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500">
              <option value="deepseek/deepseek-chat" selected>DeepSeek Chat (V3 / 高效严谨推理 · 推荐)</option>
              <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet (纪录片文学文风)</option>
              <option value="google/gemini-2.5-pro">Gemini 2.5 Pro (超长上下文与深度事实考证)</option>
              <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B Instruct</option>
            </select>
          </div>
        </div>

        <!-- 文案快速导入入口 (置顶醒目呈现) -->
        <div class="card p-3.5 rounded-2xl border border-violet-500/40 bg-gradient-to-r from-violet-950/40 to-indigo-950/30 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-violet-300 flex items-center gap-1.5">
              <span>📥 本地已有文案？</span>
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30">
              免从头生成
            </span>
          </div>
          <p class="text-[11px] text-gray-300 leading-relaxed">
            本地已有 10 篇定稿文案？一键直接载入并自动切分分镜。
          </p>
          <button type="button" onclick="switchStep1SubTab('import')" class="w-full py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white transition shadow flex items-center justify-center gap-1.5 cursor-pointer">
            📝 打开文案导入中心 (exports/ 库)
          </button>
        </div>

        <!-- 原始资料与文献输入区 (核心拦截保护：无资料不硬编) -->
        <div class="card p-4 rounded-2xl border border-gray-800 space-y-2.5">
          <div class="flex items-center justify-between pb-2 border-b border-gray-800">
            <span class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <span>📚 原始研究资料与来源</span>
            </span>
            <span class="text-[10px] text-gray-500">零硬编</span>
          </div>

          <p class="text-[11px] text-gray-400 leading-relaxed">
            粘贴人工收集的历史档案、统计数据、著作摘录。系统将严格基于此资料提取证据卡。
          </p>

          <textarea id="wInputMaterials" rows="5" placeholder="在此粘贴原始资料文本、文献记载、统计年份与数字、学术论文要点或考证事实..."
            class="w-full bg-gray-950 text-gray-200 text-xs p-3 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500 font-mono leading-relaxed resize-y"></textarea>

          <div class="flex items-center justify-between pt-1">
            <span id="wMaterialWordCount" class="text-[11px] text-gray-400">已输入 0 字资料</span>
            <button type="button" onclick="loadSampleMaterialToWriter()" class="text-xs text-purple-400 hover:underline">
              💡 载入示例考证资料
            </button>
          </div>
        </div>

      </div>

      <!-- 右栏 (70% / 8 Cols)：阶段执行与人工审核看板 -->
      <div class="lg:col-span-8 space-y-4">

        <!-- ==================== Step 1 面板：立项与设问定义 (Brief) / 本地文案直接导入 ==================== -->
        <div id="wPanelStep1" class="card p-5 rounded-2xl border border-gray-800 space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-2">
                <span>📋 阶段 1：立项设问与文案建项</span>
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">支持从 0 全新设问立项，或直接从本地 exports/ 库导入已有定稿文案</p>
            </div>
            <!-- 双模式切换 Tab 胶囊 -->
            <div class="inline-flex p-1 bg-gray-950 rounded-xl border border-purple-500/30">
              <button type="button" id="wStep1SubTabCreateBtn" onclick="switchStep1SubTab('create')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-purple-600 text-white shadow cursor-pointer">
                ✍️ 全新设问立项
              </button>
              <button type="button" id="wStep1SubTabImportBtn" onclick="switchStep1SubTab('import')" class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer">
                📂 导入本地已有文案 (exports/)
              </button>
            </div>
          </div>

          <!-- 子模式 1：从 0 全新设问立项 (Brief Setup) -->
          <div id="wStep1SubViewCreate" class="space-y-4">
            <div class="flex items-center justify-between bg-purple-950/20 p-3 rounded-xl border border-purple-500/30">
              <div class="text-xs text-purple-200">
                <span class="font-bold">🎯 标准 5 步流程：</span>基于左侧考证资料，提炼核心设问与开篇答案
              </div>
              <button type="button" onclick="aiGenerateBrief()" id="btnAiBrief" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1 shadow cursor-pointer">
                <span>🤖 AI 分析资料并生成 Brief</span>
              </button>
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-xs font-bold text-gray-300 mb-1">🎯 全片核心问题 (Core Question)</label>
                <input type="text" id="wBriefCoreQuestion" placeholder="例如：为什么富士山能跨越千年成为日本的国家精神象征，并在全世界享誉盛名？"
                  class="w-full bg-gray-950 text-white text-xs px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500" />
              </div>

              <div>
                <label class="block text-xs font-bold text-gray-300 mb-1">⚡ 开篇前2分钟简短直接答案 (Immediate Short Answer)</label>
                <textarea id="wBriefShortAnswer" rows="3" placeholder="先用 2~4 句话给出客观清晰的答案框架，拒绝卖关子拖延，让观众一听就懂核心因果链条..."
                  class="w-full bg-gray-950 text-gray-200 text-xs p-3 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500 font-sans leading-relaxed"></textarea>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold text-gray-300 mb-1">🗺️ 讨论范围与地理/历史跨度</label>
                  <input type="text" id="wBriefScope" placeholder="例如：从公元864年贞观喷发至2024年现代过度旅游治理"
                    class="w-full bg-gray-950 text-white text-xs px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-300 mb-1">🚫 内容禁区与排外排除规范</label>
                  <input type="text" id="wBriefTaboos" value="严禁模仿特定博主口吻、零编造数据年代、禁用排外与煽情口吻"
                    class="w-full bg-gray-950 text-white text-xs px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-500" />
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-gray-800 flex items-center justify-between">
              <span class="text-xs text-gray-400">💡 确认立项信息无误后，即可进入证据卡提取</span>
              <div class="flex items-center gap-2">
                <button type="button" onclick="saveWriterPartManual('brief')" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300 cursor-pointer">
                  💾 保存 Brief
                </button>
                <button type="button" onclick="setWriterStep(2)" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition flex items-center gap-1 cursor-pointer">
                  <span>👉 进入阶段 2：提取证据卡</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 子模式 2：直接导入本地已有文案 (exports/ 库快速切镜建项) -->
          <div id="wStep1SubViewImport" class="space-y-4 hidden">
            <div class="p-4 rounded-xl bg-gradient-to-r from-violet-950/40 via-indigo-950/30 to-gray-950 border border-violet-500/40 space-y-2">
              <div class="flex items-center justify-between">
                <div class="text-xs font-black text-violet-300 flex items-center gap-1.5">
                  <span>📂 本地 exports/ 文案库扫描</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] bg-violet-500/20 text-violet-200 border border-violet-500/30">
                    一键切镜建项
                  </span>
                </div>
                <button type="button" onclick="loadStep1ScannedScripts()" class="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer">
                  🔄 刷新 exports/ 目录
                </button>
              </div>
              <p class="text-xs text-gray-400 leading-relaxed">
                无需从头策划，直接选择下方已完成的深度长片文案（包含《富士山》《美国AI改名SI》等），系统将自动进行 4.0 ~ 8.0 秒智能节奏切镜并建立工程：
              </p>
            </div>

            <!-- 扫描到的文案列表容器 -->
            <div id="wStep1ScannedList" class="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              <div class="text-center py-8 text-gray-500 text-xs">正在扫描 exports/ 文案...</div>
            </div>

            <!-- 当前选中导入的文案参数与切镜配置 -->
            <div id="wStep1ImportConfigBox" class="p-4 rounded-xl bg-gray-950 border border-gray-800 space-y-3 hidden">
              <div class="flex items-center justify-between pb-2 border-b border-gray-800">
                <span class="text-xs font-bold text-amber-300 flex items-center gap-1">
                  <span>⚡ 切镜与建项设定</span>
                </span>
                <span id="wStep1SelectedSummary" class="text-xs text-purple-300 font-mono"></span>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold text-gray-300 mb-1">🆔 项目英文 ID</label>
                  <input type="text" id="wStep1ImportProjId" class="w-full bg-gray-900 text-white font-mono text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-300 mb-1">🏷️ 视频中文标题</label>
                  <input type="text" id="wStep1ImportProjTitle" class="w-full bg-gray-900 text-white font-bold text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-violet-500" />
                </div>
              </div>

              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-400">⏱️ 切镜步长：</span>
                  <select id="wStep1ImportDuration" onchange="previewStep1ImportSegmentation()" class="bg-gray-900 text-white text-xs px-2 py-1 rounded border border-gray-700">
                    <option value="5.5" selected>标准长视频节奏 (4.0 ~ 7.5 秒/镜 · 推荐)</option>
                    <option value="4.2">紧凑信息流节奏 (3.5 ~ 5.5 秒/镜)</option>
                    <option value="7.0">沉稳纪录片节奏 (5.5 ~ 9.0 秒/镜)</option>
                  </select>
                </div>
                <div id="wStep1ImportPreviewCount" class="text-xs text-emerald-400 font-bold"></div>
              </div>

              <div class="pt-2 flex justify-end gap-2 border-t border-gray-800">
                <button type="button" onclick="confirmStep1ImportToProducer()" id="btnStep1ImportExec" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white transition shadow-lg flex items-center gap-1.5 cursor-pointer">
                  🚀 确认切镜并直接进入制作台
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ==================== Step 2 面板：证据卡提取与核验 (Evidence Cards) ==================== -->
        <div id="wPanelStep2" class="card p-5 rounded-2xl border border-gray-800 space-y-4 hidden">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-2">
                <span>🗂️ 阶段 2：证据卡提取与事实分型 (Evidence Cards Review)</span>
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">单一主张原则 · 严格区分事实(verified_fact)与传说(legend_or_anecdote)</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="addCustomEvidenceCard()" class="px-3 py-1.5 rounded-xl card hover:border-gray-600 text-xs font-bold text-gray-300 transition flex items-center gap-1 cursor-pointer">
                <span>➕ 手动添加证据卡</span>
              </button>
              <button type="button" onclick="aiExtractEvidence()" id="btnAiEvidence" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1 shadow cursor-pointer">
                <span>🤖 从资料中提取证据卡</span>
              </button>
            </div>
          </div>

          <!-- 证据卡列表容器 -->
          <div id="wEvidenceCardsList" class="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            <div class="text-center py-10 text-gray-500 text-xs">暂无证据卡，请在左侧填入资料后点击上方「🤖 从资料中提取证据卡」</div>
          </div>

          <!-- 人工审核门禁 (Human Review Gate) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="text-base">🚦</span>
              <div>
                <div class="text-xs font-bold text-amber-300">人工审核门禁：事实真实性核对</div>
                <div class="text-[11px] text-gray-400">请逐一核验上述证据卡是否存在编造或存疑，确认无误后方可生成大纲。</div>
              </div>
            </div>
            <button type="button" onclick="approveEvidenceCardsGate()" class="px-4 py-2 text-xs font-extrabold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition shadow flex items-center gap-1.5 shrink-0 cursor-pointer">
              <span>✅ 证据核验无误 · 解锁大纲策划</span>
            </button>
          </div>
        </div>

        <!-- ==================== Step 3 面板：5~7 章大纲策划与审核门禁 (Outline) ==================== -->
        <div id="wPanelStep3" class="card p-5 rounded-2xl border border-gray-800 space-y-4 hidden">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-2">
                <span>📑 阶段 3：5~7 章结构化大纲策划 (Outline Gate)</span>
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">单章单问原则 · 层层递进 · 绑定证据卡 · 严禁未审核即写正文</p>
            </div>
            <button type="button" onclick="aiBuildOutline()" id="btnAiOutline" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1 shadow cursor-pointer">
              <span>🤖 基于证据卡生成大纲</span>
            </button>
          </div>

          <!-- 开篇反差设计 -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
            <div class="text-xs font-bold text-purple-300 flex items-center gap-1.5">
              <span>🪝 开篇反差切入与直接答案 (Opening Hook)</span>
            </div>
            <input type="text" id="wOutlineOpeningQuestion" placeholder="开篇具体反常矛盾..."
              class="w-full bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500" />
            <textarea id="wOutlineOpeningAnswer" rows="2" placeholder="开篇简短直接结论..."
              class="w-full bg-gray-900 text-gray-300 text-xs p-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-purple-500"></textarea>
          </div>

          <!-- 5~7 章列表容器 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs font-bold text-gray-300 px-1">
              <span>📚 章节规划列表 (严格 5~7 章)：</span>
              <span id="wOutlineChapterCountBadge" class="text-[10px] text-purple-400 font-mono">0 章</span>
            </div>
            <div id="wOutlineChaptersList" class="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              <div class="text-center py-8 text-gray-500 text-xs">暂无大纲数据，请核验证据卡后点击「🤖 基于证据卡生成大纲」</div>
            </div>
          </div>

          <!-- 唯一终局结尾规划 -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
            <div class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <span>🏁 全片唯一终局收尾规划 (Single Ending Plan)</span>
              <span class="text-[10px] text-gray-500 font-normal">全片只准保留一个正式结尾，严禁在中间各章作总结</span>
            </div>
            <input type="text" id="wOutlineEndingTakeaway" placeholder="回扣核心问题，升华本质运转机制..."
              class="w-full bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-amber-400" />
          </div>

          <!-- 大纲审核门禁 (STOP & REVIEW) -->
          <div class="p-4 rounded-xl bg-purple-950/30 border border-purple-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div class="text-xs font-extrabold text-purple-300 flex items-center gap-1.5">
                <span>🛑 强制人工审核门禁 (STOP & REVIEW)</span>
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                请确认上述章节是否条理清晰、因果链条严密。<b>未经明确确认，系统绝不启动正文撰写！</b>
              </div>
            </div>
            <button type="button" onclick="approveOutlineGate()" id="btnApproveOutline" class="px-5 py-2 text-xs font-black rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition shadow-lg flex items-center gap-1.5 shrink-0 cursor-pointer">
              <span>👉 审核通过大纲 · 解锁逐章撰写</span>
            </button>
          </div>
        </div>

        <!-- ==================== Step 4 面板：逐章受控撰写与四段式结构 (Chapter Writer) ==================== -->
        <div id="wPanelStep4" class="card p-5 rounded-2xl border border-gray-800 space-y-4 hidden">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-2">
                <span>✍️ 阶段 4：单章受控撰写 (Chapter by Chapter)</span>
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">一次只写一章 · 强制四段式结构 · 绑定证据卡 · 最多重写2次防死循环</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="aiWriteCurrentChapter()" id="btnAiWriteChapter" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1 shadow cursor-pointer">
                <span>🤖 AI 撰写当前章节</span>
              </button>
            </div>
          </div>

          <!-- 章节切换 Tabs -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1" id="wChapterTabsBar">
            <span class="text-xs text-gray-500">大纲审核后在此切换章节</span>
          </div>

          <!-- 当前章节信息概览 -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="text-xs font-black text-white" id="wCurChapterHeader">第 1 章：正在载入...</div>
              <div class="text-[11px] text-purple-300" id="wCurChapterSubQuestion">子问题：...</div>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <span class="text-gray-400">已写字数: <b id="wCurChapterWordCount" class="text-emerald-400 font-mono">0</b> 字</span>
              <span id="wCurChapterRevisionBadge" class="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">初稿</span>
            </div>
          </div>

          <!-- 单章四段式结构编辑器 -->
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-bold text-amber-300 mb-1">
                1️⃣ 章节问题或矛盾 (承接上文悬念，抛出本章反差)
              </label>
              <textarea id="wSec1Question" rows="2" placeholder="三五句话点出本章要解决的具体矛盾或反常现象..."
                class="w-full bg-gray-950 text-gray-200 text-xs p-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-amber-400 leading-relaxed"></textarea>
            </div>

            <div>
              <label class="block text-xs font-bold text-blue-300 mb-1">
                2️⃣ 形成机制或背景 (拆解气候/运输/技术/商业/制度底层逻辑)
              </label>
              <textarea id="wSec2Mechanism" rows="3" placeholder="清晰拆解运作逻辑，把复杂概念拆成听得懂的因果链条..."
                class="w-full bg-gray-950 text-gray-200 text-xs p-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-400 leading-relaxed"></textarea>
            </div>

            <div>
              <label class="block text-xs font-bold text-emerald-300 mb-1">
                3️⃣ 有来源的具体例子 (基于证据卡，具象平实，严禁伪造内心戏)
              </label>
              <textarea id="wSec3Examples" rows="4" placeholder="具体案例、器物细节、动作或数据对比，必须严格有证据卡支持..."
                class="w-full bg-gray-950 text-gray-200 text-xs p-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-emerald-400 leading-relaxed"></textarea>
            </div>

            <div>
              <label class="block text-xs font-bold text-purple-300 mb-1">
                4️⃣ 小结与自然过渡 (收束本章子问题，引出下一章疑问，非终章严禁总结)
              </label>
              <textarea id="wSec4Transition" rows="2" placeholder="简短收束本章，并抛出下一章的悬念..."
                class="w-full bg-gray-950 text-gray-200 text-xs p-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-purple-400 leading-relaxed"></textarea>
            </div>
          </div>

          <div class="pt-3 border-t border-gray-800 flex items-center justify-between">
            <span class="text-xs text-gray-400">💡 每一章完成后点击保存，全部写完即可进入全文统稿</span>
            <div class="flex items-center gap-2">
              <button type="button" onclick="saveCurrentChapterDraft()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300 cursor-pointer">
                💾 保存本章
              </button>
              <button type="button" onclick="setWriterStep(5)" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition flex items-center gap-1 cursor-pointer">
                <span>👉 进入阶段 5：全文统稿与定稿</span>
              </button>
            </div>
          </div>
        </div>

        <!-- ==================== Step 5 面板：全文统稿去伪结尾与定稿同步 (Finalize) ==================== -->
        <div id="wPanelStep5" class="card p-5 rounded-2xl border border-gray-800 space-y-4 hidden">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
            <div>
              <h3 class="text-sm font-black text-white flex items-center gap-2">
                <span>🏁 阶段 5：全文统稿与定稿 (Full Script Finalize & Sync)</span>
              </h3>
              <p class="text-xs text-gray-400 mt-0.5">跨章节去重 · 专有名词与年代统一 · 剔除中间伪结尾 · 唯一结尾回扣</p>
            </div>
            <button type="button" onclick="aiFinalizeFullScript()" id="btnAiFinalize" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-1 shadow cursor-pointer">
              <span>🤖 AI 全文统稿去重去伪结尾</span>
            </button>
          </div>

          <!-- 统稿编辑报告 (去重、伪结尾统计) -->
          <div id="wEditorialLogContainer" class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2 text-xs">
            <div class="font-bold text-gray-300 flex items-center justify-between">
              <span>📊 统稿清洗审计报告：</span>
              <span id="wRemovedFalseEndingsBadge" class="text-[10px] text-amber-400">已清理伪结尾: 0 处</span>
            </div>
            <div id="wEditorialLogDetails" class="text-gray-400 space-y-1 font-mono text-[11px]">
              <div>- 暂无统稿清洗记录，点击上方按钮由 AI 进行跨章去重与格式统稿。</div>
            </div>
          </div>

          <!-- 全文旁白终稿预览区 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-white">📑 完整长视频定稿文案 (Ready for Narration)：</span>
              <span class="text-purple-300">总字数: <b id="wFinalScriptWords" class="font-mono">0</b> 字 · 预估播讲: <b id="wFinalScriptMin" class="font-mono">0.0</b> 分钟</span>
            </div>
            <textarea id="wFinalScriptFullText" rows="14" placeholder="统稿后的完整旁白文案将在此呈现，包含开篇导引、各章正文与唯一定稿结尾..."
              class="w-full bg-gray-950 text-gray-200 text-xs p-3.5 rounded-xl border border-gray-700 focus:outline-none focus:border-amber-400 font-mono leading-relaxed resize-y"></textarea>
          </div>

          <!-- 核心直通车按钮：一键进入分镜制作台 -->
          <div class="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-amber-500/15 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div class="text-xs font-black text-amber-300 flex items-center gap-1.5">
                <span>🚀 文案已定稿！一键直通分镜视觉工作台</span>
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                系统将自动按 4.0 ~ 8.0 秒标准口语断句切分成全套镜头（Shots），生成时间轴并无缝切入制作台！
              </div>
            </div>
            <button type="button" onclick="syncWriterToProducerUI()" class="px-6 py-2.5 text-xs font-black rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-110 text-gray-950 transition shadow-xl flex items-center gap-1.5 shrink-0 cursor-pointer">
              <span>🚀 确认定稿并进入分镜镜头工作台</span>
            </button>
          </div>
        </div>

      </div>

    </div>

  </div>
  <!-- ✍️ 知识长视频文案创作工坊结束 -->

  <!-- 【核心升级】：全功能 AI 视频与分镜视觉模型控制中心 (OpenRouter 统一网关) -->
  <div id="visualModelModal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
    <div class="card w-full max-w-2xl p-6 rounded-2xl border border-purple-500/50 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <div>
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            🎬 AI 实体视频与分镜模型控制中心 (OpenRouter 统一网关)
          </h3>
          <p class="text-xs text-purple-300/80 mt-0.5">只需填入一个 OpenRouter Key，自由指定实体视频模型、文本分镜模型与超清生图模型</p>
        </div>
        <button onclick="toggleVisualModelModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <div class="space-y-4">
        <!-- 模型生态一键预设方案 (Gemini / OpenRouter / Antigravity 本地) -->
        <div class="p-3.5 rounded-xl bg-gradient-to-r from-blue-950/70 via-purple-950/60 to-cyan-950/70 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <div class="text-xs font-black text-cyan-300 flex items-center gap-1.5">
              <span>🪐 一键载入全家桶预设</span>
              <span class="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/30">推荐</span>
            </div>
            <p class="text-[10px] text-gray-400 mt-0.5">自动配置 5 大模型位（分镜总监、卡片排版、AI 生图、实体视频、BGM情绪）最佳组合</p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" onclick="applyModelPreset('antigravity-dev')" class="px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-600/40 hover:bg-emerald-600/70 text-emerald-200 border border-emerald-400/60 transition flex items-center gap-1 shadow-sm">
              <span>🆓 Antigravity 本地免 Key (推荐开发期)</span>
            </button>
            <button type="button" onclick="applyModelPreset('gemini')" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-600/30 hover:bg-blue-600/60 text-blue-200 border border-blue-400/50 transition flex items-center gap-1 shadow-sm">
              <span>🪐 Gemini 生态全家桶</span>
            </button>
            <button type="button" onclick="applyModelPreset('gemini-pro')" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-cyan-600/30 hover:bg-cyan-600/60 text-cyan-200 border border-cyan-400/50 transition flex items-center gap-1 shadow-sm">
              <span>💎 Gemini 2.5 Pro 顶配版</span>
            </button>
            <button type="button" onclick="applyModelPreset('openrouter-fast')" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-600/30 hover:bg-purple-600/60 text-purple-200 border border-purple-400/50 transition flex items-center gap-1 shadow-sm">
              <span>🚀 OpenRouter 混合极速</span>
            </button>
            <button type="button" onclick="applyModelPreset('antigravity-local')" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600/30 hover:bg-emerald-600/60 text-emerald-200 border border-emerald-400/50 transition flex items-center gap-1 shadow-sm">
              <span>🧪 本地 Antigravity 网关</span>
            </button>
          </div>
        </div>

        <!-- 统一网关与 API Key -->
        <div class="p-4 rounded-xl bg-gray-950 border border-purple-500/30 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-purple-300">🔑 统一 API Key 与 网关地址 (适用全部模型)</span>
            <span class="text-[10px] text-gray-400">（仅保存在本地工程，不上传 Git）</span>
          </div>

          <div>
            <label class="block text-[11px] font-bold text-gray-300 mb-1">
              API Key：
              <a href="https://openrouter.ai/keys" target="_blank" class="text-purple-400 hover:underline text-[10px] ml-1">OpenRouter Key ↗</a>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-blue-400 hover:underline text-[10px] ml-2">Google Gemini Key ↗</a>
            </label>
            <input type="password" id="currentApiKeyInput" placeholder="在此填入您的 API Key (OpenRouter sk-or-... 或 Gemini Key)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono focus:outline-none focus:border-purple-400" />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-[11px] font-bold text-gray-300">
                🌐 API 基础网关地址 (Base URL)：
              </label>
              <div class="flex items-center gap-2">
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://openrouter.ai/api/v1'" class="text-[10px] text-purple-400 hover:underline">
                  OpenRouter 官方
                </button>
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://generativelanguage.googleapis.com/v1beta/openai'" class="text-[10px] text-blue-400 hover:underline">
                  Google Gemini (兼容)
                </button>
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'http://127.0.0.1:51000/v1beta'" class="text-[10px] text-cyan-400 hover:underline">
                  本地 Antigravity
                </button>
                <button type="button" onclick="document.getElementById('currentBaseUrlInput').value = 'https://api.siliconflow.cn/v1'; document.getElementById('currentVideoModelInput').value = 'tencent/HunyuanVideo';" class="text-[10px] text-emerald-400 hover:underline">
                  硅基流动
                </button>
              </div>
            </div>
            <input type="text" id="currentBaseUrlInput" value="https://openrouter.ai/api/v1" placeholder="API 基础网关地址 (例如: https://openrouter.ai/api/v1 或第三方中转站)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono focus:outline-none focus:border-purple-400" />
            <p class="text-[10px] text-gray-400 mt-1">
              💡 <b>注意</b>：已全面接入 OpenRouter 原生文生视频 API（POST /api/v1/videos），直接支持 MiniMax 海螺、阿里万象、字节 Seedance、快手可灵 Kling、Google Veo 等全部 31+ 款官方视频模型。
            </p>
          </div>

          <!-- 测试连接按钮 -->
          <div class="flex items-center justify-between pt-1">
            <button type="button" onclick="testCurrentProviderConnection()" id="btnTestProvider"
              class="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-800 hover:bg-purple-900/60 border border-purple-500/40 text-purple-200 transition flex items-center gap-1.5">
              <span>⚡ 测试网关 API 连接</span>
            </button>
            <div id="testConnStatus" class="text-xs text-gray-400 hidden"></div>
          </div>
        </div>

        <!-- 3 大模型分别指定区域 -->
        <div class="space-y-3.5">
          <!-- 1. 🎬 AI 视频生成模型 (Video Generation Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-emerald-500/40 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                <span>🎬 指定 AI 视频生成模型 (Video Generation Model Slug)：</span>
              </label>
              <span class="text-[10px] text-emerald-400/90 font-mono">负责渲染 16:9 真实 MP4 实体视频</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectVideoModelSlug('minimax/hailuo-3')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">MiniMax 海螺 H3</button>
              <button type="button" onclick="selectVideoModelSlug('minimax/hailuo-3-max')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">MiniMax H3 Max</button>
              <button type="button" onclick="selectVideoModelSlug('bytedance/seedance-2.0')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">字节 Seedance 2.0</button>
              <button type="button" onclick="selectVideoModelSlug('alibaba/wan-2.6')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">阿里万象 Wan 2.6</button>
              <button type="button" onclick="selectVideoModelSlug('kwaivgi/kling-v3.0-std')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">快手可灵 Kling v3</button>
              <button type="button" onclick="selectVideoModelSlug('google/veo-3.1-fast')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">Google Veo 3.1</button>
              <button type="button" onclick="selectVideoModelSlug('runway/gen-4.5')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">Runway Gen-4.5</button>
              <button type="button" onclick="selectVideoModelSlug('x-ai/grok-imagine-video-1.5')" class="px-2 py-0.5 rounded text-[10px] bg-emerald-600/25 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40">SpaceX Grok Video</button>
            </div>
            <input type="text" id="currentVideoModelInput" list="openrouterVideoModelsList" value="minimax/hailuo-3" placeholder="选择或输入 OpenRouter 支持的视频模型 slug (如: minimax/hailuo-3, alibaba/wan-2.6)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-emerald-500/50 text-emerald-200 font-mono font-bold focus:outline-none focus:border-emerald-400" />
            <datalist id="openrouterVideoModelsList"></datalist>
          </div>

          <!-- 2. ✍️ AI 分镜与指示词提炼模型 (Prompt Director Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-purple-500/30 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                <span>✍️ 指定 AI 分镜与指示词提炼模型 (Prompt Director Model Slug)：</span>
              </label>
              <span class="text-[10px] text-purple-300/80 font-mono">负责台词深度理解、运镜设计与画面提炼</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectTextModelSlug('deepseek/deepseek-chat')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">DeepSeek Chat (推荐)</button>
              <button type="button" onclick="selectTextModelSlug('anthropic/claude-3.5-sonnet')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">Claude 3.5 Sonnet (纪录片大师)</button>
              <button type="button" onclick="selectTextModelSlug('google/gemini-2.5-flash')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">Gemini 2.5 Flash (极速秒级)</button>
              <button type="button" onclick="selectTextModelSlug('openai/gpt-4o-mini')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">GPT-4o Mini</button>
              <button type="button" onclick="selectTextModelSlug('qwen/qwen-2.5-72b-instruct')" class="px-2 py-0.5 rounded text-[10px] bg-purple-600/25 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40">通义千问 Qwen 2.5</button>
            </div>
            <input type="text" id="currentTextModelInput" value="deepseek/deepseek-chat" placeholder="选择或输入文本/分镜提炼大模型 slug (如: deepseek/deepseek-chat, anthropic/claude-3.5-sonnet)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono font-bold focus:outline-none focus:border-purple-400" />
            <p class="text-[10px] text-gray-400 mt-1">
              💡 <b>注意</b>：当您在镜头列表中点击【✨ 自动提炼运镜词/实景词/排版词】时，系统将调用此模型深度理解旁白台词，提炼出 100% 紧扣台词实体的电影级画面提示词。
            </p>
          </div>

          <!-- 3. 🖼️ AI 超清实景生图模型 (Image Generation Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-blue-500/30 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-blue-200 flex items-center gap-1.5">
                <span>🖼️ 指定 AI 超清生图模型 (Image Model Slug)：</span>
              </label>
              <span class="text-[10px] text-blue-300/80 font-mono">负责超清摄影实景图输出</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectImageModelSlug('black-forest-labs/flux-3-image')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">FLUX 3 Image (推荐)</button>
              <button type="button" onclick="selectImageModelSlug('black-forest-labs/flux.2-max')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">FLUX.2 Max (极速)</button>
              <button type="button" onclick="selectImageModelSlug('recraft/recraft-v4.1')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">Recraft V4.1</button>
              <button type="button" onclick="selectImageModelSlug('google/gemini-3.1-flash-image')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">Gemini 3.1 Image</button>
              <button type="button" onclick="selectImageModelSlug('openai/gpt-image-2')" class="px-2 py-0.5 rounded text-[10px] bg-blue-600/25 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40">GPT Image 2</button>
            </div>
            <input type="text" id="currentImageModelInput" list="openrouterImageModelsList" value="black-forest-labs/flux-3-image" placeholder="输入或从下拉列表选择 OpenRouter 生图模型 (如: black-forest-labs/flux-3-image, recraft/recraft-v4.1)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono font-bold focus:outline-none focus:border-blue-400" />
            <datalist id="openrouterImageModelsList"></datalist>
          </div>

          <!-- 4. 🎵 AI 自适应 BGM 背景音乐生成与审查模型 (BGM & Review Model) -->
          <div class="p-3.5 rounded-xl bg-gray-950 border border-amber-500/30 space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                <span>🎵 指定 AI 自适应 BGM 音乐与审查模型 (BGM & Music Review Model Slug)：</span>
              </label>
              <span class="text-[10px] text-amber-300/80 font-mono">负责台词情绪起伏分析、BGM曲风生成与审查评分</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onclick="selectBgmModelSlug('deepseek/deepseek-chat')" class="px-2 py-0.5 rounded text-[10px] bg-amber-600/25 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40">DeepSeek Chat (选乐审查推荐)</button>
              <button type="button" onclick="selectBgmModelSlug('anthropic/claude-3.5-sonnet')" class="px-2 py-0.5 rounded text-[10px] bg-amber-600/25 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40">Claude 3.5 Sonnet (金牌音乐监制)</button>
              <button type="button" onclick="selectBgmModelSlug('google/gemini-2.5-flash')" class="px-2 py-0.5 rounded text-[10px] bg-amber-600/25 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40">Gemini 2.5 Flash</button>
              <button type="button" onclick="selectBgmModelSlug('meta/musicgen')" class="px-2 py-0.5 rounded text-[10px] bg-amber-600/25 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40">Meta MusicGen (生成)</button>
              <button type="button" onclick="selectBgmModelSlug('suno/v3.5')" class="px-2 py-0.5 rounded text-[10px] bg-amber-600/25 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40">Suno v3.5</button>
            </div>
            <input type="text" id="currentBgmModelInput" value="deepseek/deepseek-chat" placeholder="选择或输入 OpenRouter 支持的 BGM 音乐/审查模型 slug (如: deepseek/deepseek-chat, meta/musicgen)..."
              class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white font-mono font-bold focus:outline-none focus:border-amber-400" />
            <p class="text-[10px] text-gray-400 mt-1">
              💡 <b>注意</b>：同样通过您的 OpenRouter 统一网关调度，用于自适应 BGM 工作台对台词情绪节奏的高低起伏进行匹配、生成对应曲调并开展闭环 AI Review 审查。
            </p>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-gray-800">
        <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
          取消
        </button>
        <button onclick="saveVisualModelConfig()" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-600 hover:brightness-110 text-white transition shadow-lg">
          💾 保存并应用全部模型配置
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

  <!-- 🎵 AI 自适应 BGM 背景音乐与闭环 Review 工作台 -->
  <div id="bgmModal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
    <div class="card w-full max-w-2xl p-6 rounded-2xl border border-amber-500/50 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <div>
          <h3 class="text-lg font-bold text-white flex items-center gap-2">
            🎵 AI 自适应 BGM 音乐与审查工作台
          </h3>
          <p class="text-xs text-amber-300/80 mt-0.5">
            根据旁白抑扬顿挫自适应编曲 · 4 点闭环审查 · 自动人声避让 (Ducking)
          </p>
        </div>
        <button onclick="toggleBgmModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <div class="space-y-4">
        <!-- 调度模型提示 -->
        <div class="flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          <span>🧠 当前调度模型：<b id="bgmModelActiveDisplay" class="font-mono text-white">OpenRouter / deepseek-chat</b></span>
          <button type="button" onclick="toggleBgmModal(); toggleVisualModelModal();" class="text-purple-400 hover:underline font-bold text-[11px]">
            ⚙️ 切换模型 ↗
          </button>
        </div>

        <!-- 步骤 1：台词情绪起伏与节奏曲线 -->
        <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-200 flex items-center gap-1.5">
              <span>📈 步骤一：全片台词情绪起伏与节奏弧度</span>
            </span>
            <span class="text-[10px] text-gray-400 font-mono">已智能解析当前工程 3 个章节的情绪阶段</span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
              <div class="text-[10px] text-gray-400">01 序幕引入 (0~15s)</div>
              <div class="font-bold text-blue-300 mt-1">悬念探索 · 平和</div>
              <div class="text-[10px] text-gray-500 mt-0.5 font-mono">建议电平: -18dB</div>
            </div>
            <div class="p-2.5 rounded-xl bg-gray-900 border border-amber-500/40 bg-amber-500/5">
              <div class="text-[10px] text-amber-300">02 危机与高潮 (15~45s)</div>
              <div class="font-bold text-amber-400 mt-1">48急弯悬崖 · 紧张激昂</div>
              <div class="text-[10px] text-amber-300/80 mt-0.5 font-mono">建议电平: -12dB</div>
            </div>
            <div class="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
              <div class="text-[10px] text-gray-400">03 结语沉思 (45~60s)</div>
              <div class="font-bold text-emerald-300 mt-1">湖泊使馆 · 宁静深远</div>
              <div class="text-[10px] text-gray-500 mt-0.5 font-mono">建议电平: -20dB</div>
            </div>
          </div>
        </div>

        <!-- 步骤 2：推荐自适应 BGM 候选轨 -->
        <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-200">🎼 步骤二：AI 自适应配乐候选轨</span>
            <span class="text-[10px] text-gray-400">点击试听并对比审查得分</span>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between p-3 rounded-xl bg-gray-900/90 border border-amber-500/50 hover:border-amber-400 transition">
              <div>
                <div class="text-xs font-bold text-white flex items-center gap-2">
                  <span>Track A: 险峻史诗与东方空灵 (Epic History & Strings)</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30">推荐匹配 96%</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5">管弦交响 · 沉静启动后渐强 · 112 BPM · 契合急弯险峻山路与金箔灵庙</div>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onclick="playBgmSample('epic')" id="btnPlayEpic" class="px-2.5 py-1 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-amber-300 border border-gray-700 transition">
                  ▶ 试听片段
                </button>
              </div>
            </div>
            <div class="flex items-center justify-between p-3 rounded-xl bg-gray-900/40 border border-gray-800 hover:border-gray-700 transition">
              <div>
                <div class="text-xs font-bold text-gray-300 flex items-center gap-2">
                  <span>Track B: 现代公路纪实律动 (Modern Documentary Pulse)</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30">匹配度 89%</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5">极简电音鼓点 · 沉浸推进 · 120 BPM · 适合自驾行驶感镜头</div>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onclick="playBgmSample('pulse')" id="btnPlayPulse" class="px-2.5 py-1 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-blue-300 border border-gray-700 transition">
                  ▶ 试听片段
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 步骤 3：AI 闭环 Review 审查结果 -->
        <div class="p-3.5 rounded-xl bg-gradient-to-br from-gray-950 via-purple-950/20 to-gray-900 border border-purple-500/30 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-purple-200 flex items-center gap-1.5">
              <span>🔍 步骤三：AI 音乐闭环审查报告 (Review Audit)</span>
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              综合评级: A+ (极佳匹配)
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-[11px] pt-1">
            <div class="p-2 rounded-lg bg-black/40 border border-purple-500/20">
              <div class="text-[10px] text-gray-400">人声避让 (Ducking)</div>
              <div class="font-bold text-emerald-400 mt-0.5">自动下潜 -6dB</div>
              <div class="text-[9px] text-gray-500 mt-0.5">台词清晰不被掩盖</div>
            </div>
            <div class="p-2 rounded-lg bg-black/40 border border-purple-500/20">
              <div class="text-[10px] text-gray-400">节奏卡点一致性</div>
              <div class="font-bold text-emerald-400 mt-0.5">契合度 94%</div>
              <div class="text-[9px] text-gray-500 mt-0.5">急弯镜头平滑切换</div>
            </div>
            <div class="p-2 rounded-lg bg-black/40 border border-purple-500/20">
              <div class="text-[10px] text-gray-400">听觉疲劳度控制</div>
              <div class="font-bold text-emerald-400 mt-0.5">优异 (舒缓释放)</div>
              <div class="text-[9px] text-gray-500 mt-0.5">高潮后适度回落</div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-gray-800">
        <span class="text-[11px] text-gray-400">💡 确认后将自动挂载至 Remotion <code class="text-amber-300">audio_track.bgm</code> 音轨</span>
        <div class="flex items-center gap-2">
          <button onclick="toggleBgmModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
            关闭
          </button>
          <button onclick="applyBgmToProject()" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:brightness-110 text-gray-950 transition shadow-lg">
            💾 确认并应用本套自适应 BGM
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 📝 文案导入与镜头切分工作台 Modal -->
  <div id="importScriptModal" class="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 hidden">
    <div class="card bg-gray-900 border border-violet-500/40 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
      
      <!-- Modal 头部 -->
      <div class="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-violet-950/40 via-gray-900 to-gray-900">
        <div>
          <h2 class="text-lg font-black text-white flex items-center gap-2">
            <span class="p-1.5 rounded-lg bg-violet-600/30 text-violet-400 border border-violet-500/30">📝</span>
            导入定稿文案 · 自动切分镜头工作台
          </h2>
          <p class="text-xs text-gray-400 mt-0.5">
            直接载入本地生成的文案或自由粘贴，智能按 4.0 ~ 8.0 秒标准节奏切分镜头与生成时间轴
          </p>
        </div>
        <button type="button" onclick="toggleImportScriptModal()" class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 text-lg transition">✕</button>
      </div>

      <!-- Modal 滚动主体 -->
      <div class="p-6 overflow-y-auto space-y-5 flex-1 text-sm custom-scrollbar">
        
        <!-- 1. 工程基本设定 (项目ID 与 中文标题) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-950/60 p-4 rounded-xl border border-gray-800">
          <div>
            <label class="block text-xs font-bold text-gray-300 mb-1 flex items-center gap-1">
              <span>🆔 项目唯一英文 ID</span>
              <span class="text-[10px] text-gray-500 font-normal">(仅支持英文、数字、下划线)</span>
            </label>
            <input type="text" id="importProjectId" placeholder="例如: why_fujisan_symbol_001"
              class="w-full bg-gray-900 text-white font-mono text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-300 mb-1 flex items-center gap-1">
              <span>🏷️ 视频中文标题</span>
              <span class="text-[10px] text-gray-500 font-normal">(用于展示与分镜主题)</span>
            </label>
            <input type="text" id="importProjectTitle" placeholder="例如: 富士山，日本象征，富士山为什么如此出名"
              class="w-full bg-gray-900 text-white font-bold text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-violet-500" />
          </div>
        </div>

        <!-- 2. 文案载入模式切换 Tabs -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-violet-300 flex items-center gap-1.5">
              <span>📂 文案载入来源：</span>
            </span>
            <div class="inline-flex p-1 bg-gray-950 rounded-xl border border-gray-800 text-xs font-semibold">
              <button type="button" id="tabBtnLocal" onclick="switchImportTab('local')" class="px-3 py-1 rounded-lg bg-violet-600 text-white shadow transition">
                📁 本地导出库 (exports/)
              </button>
              <button type="button" id="tabBtnPaste" onclick="switchImportTab('paste')" class="px-3 py-1 rounded-lg text-gray-400 hover:text-white transition">
                ✍️ 剪贴板快速粘贴
              </button>
              <button type="button" id="tabBtnUpload" onclick="switchImportTab('upload')" class="px-3 py-1 rounded-lg text-gray-400 hover:text-white transition">
                📤 本地文件拖拽
              </button>
            </div>
          </div>

          <!-- Tab 1: 本地 exports 扫描库 -->
          <div id="importTabLocal" class="space-y-2">
            <div class="flex items-center justify-between text-xs text-gray-400 px-1">
              <span>自动检索项目根目录下 <code class="text-violet-300 font-mono">exports/</code> 的文案文件：</span>
              <button type="button" onclick="loadScannedScripts()" class="text-violet-400 hover:underline flex items-center gap-1">
                🔄 刷新扫描
              </button>
            </div>
            <div id="scannedScriptsList" class="grid grid-cols-1 gap-2.5 max-h-56 overflow-y-auto pr-1">
              <div class="text-center py-6 text-gray-500 text-xs">正在扫描 exports/ 目录...</div>
            </div>
          </div>

          <!-- Tab 2: 自由粘贴 -->
          <div id="importTabPaste" class="space-y-2 hidden">
            <textarea id="importRawText" rows="7" placeholder="在此粘贴在 Antigravity 中生成的完整文案（支持 TXT、Markdown、章节标题或 JSON 格式）..."
              oninput="onScriptTextInput()"
              class="w-full bg-gray-950 text-gray-200 text-xs p-3 rounded-xl border border-gray-800 focus:outline-none focus:border-violet-500 font-mono leading-relaxed resize-y"></textarea>
          </div>

          <!-- Tab 3: 文件上传/拖拽 -->
          <div id="importTabUpload" class="space-y-2 hidden">
            <div id="importDropZone" ondragover="onImportDragOver(event)" ondragleave="onImportDragLeave(event)" ondrop="onImportDrop(event)"
              class="border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-xl p-6 text-center cursor-pointer transition bg-gray-950/40">
              <div class="text-3xl mb-2">📄</div>
              <div class="text-xs font-semibold text-gray-300">拖拽文案文件到此处，或点击浏览文件</div>
              <div class="text-[11px] text-gray-500 mt-1">支持 .txt、.md、.json 格式的完整文案文件</div>
              <input type="file" id="importFileInput" accept=".txt,.md,.json" onchange="onImportFileSelected(event)" class="hidden" />
              <button type="button" onclick="document.getElementById('importFileInput').click()" class="mt-3 px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-800 hover:bg-gray-700 text-violet-300 border border-gray-700">
                选择本地文件
              </button>
            </div>
          </div>
        </div>

        <!-- 3. 切镜参数与实时统计 -->
        <div class="bg-gray-950/70 p-4 rounded-xl border border-gray-800/80 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-amber-300">⏱️ 切镜节奏策略：</span>
              <select id="importTargetDuration" onchange="triggerUpdatePreview()" class="bg-gray-900 text-white font-bold text-xs px-2.5 py-1 rounded-lg border border-gray-700 focus:outline-none focus:border-amber-400">
                <option value="5.5" selected>标准长视频节奏 (约 4.0 ~ 7.5 秒/镜 · 推荐)</option>
                <option value="4.2">紧凑信息流节奏 (约 3.5 ~ 5.5 秒/镜)</option>
                <option value="7.0">沉稳纪录片节奏 (约 5.5 ~ 9.0 秒/镜)</option>
              </select>
            </div>

            <!-- 统计标签 -->
            <div class="flex items-center gap-2 text-xs flex-wrap">
              <span class="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                字数: <b id="statWordCount">0</b> 字
              </span>
              <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                预估时长: <b id="statDurationMin">0.0</b> 分钟
              </span>
              <span class="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                预估镜头: <b id="statScenesCount">0</b> 镜
              </span>
            </div>
          </div>

          <!-- 分镜切片实时预览 -->
          <div>
            <div class="text-[11px] font-bold text-gray-400 mb-1.5 flex items-center justify-between">
              <span>🔍 自动切片效果预览 (前 3 镜)：</span>
              <span id="previewNotice" class="text-[10px] text-gray-500">载入或粘贴文案后自动计算</span>
            </div>
            <div id="segmentPreviewList" class="space-y-1.5 bg-gray-900/90 p-2.5 rounded-lg border border-gray-800 text-xs font-mono max-h-36 overflow-y-auto">
              <div class="text-gray-500 text-center py-3 text-[11px]">暂无预览数据，请选择文案或粘贴内容</div>
            </div>
          </div>
        </div>

      </div>

      <!-- Modal 底部提交按钮 -->
      <div class="px-6 py-3.5 border-t border-gray-800 bg-gray-950 flex items-center justify-between">
        <span id="importStatusMessage" class="text-xs text-gray-400 font-medium"></span>
        <div class="flex items-center gap-3">
          <button type="button" onclick="toggleImportScriptModal()" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 text-gray-300">
            取消
          </button>
          <button type="button" id="confirmImportBtn" onclick="confirmImportScript()" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white transition shadow-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
            🚀 确认导入并立即进入工程
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- Toast 提示 -->
  <div id="toast" class="fixed bottom-6 right-6 px-4 py-2.5 rounded-xl bg-amber-500 text-gray-950 font-extrabold text-xs shadow-2xl transition duration-300 hidden z-50">
  </div>

  <script>
    let activeProjectId = new URLSearchParams(window.location.search).get('project') || localStorage.getItem('whyvideo_active_project') || 'why_nikko_heritage_road_001';
    let manifestData = null;
    let assetIndexData = null;
    let projectsList = [];
    let currentSelectedModel = 'minimax/hailuo-3';

    let visualConfig = {
      apiKey: '',
      baseUrl: 'https://openrouter.ai/api/v1',
      videoModel: 'minimax/hailuo-3',
      textModel: 'deepseek/deepseek-chat',
      imageModel: 'black-forest-labs/flux-1-schnell',
      bgmModel: 'deepseek/deepseek-chat'
    };

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 3000);
    }

    // ==========================================
    // ✍️ 文案创作工坊 (Writer Workspace) SPA 状态与逻辑
    // ==========================================
    let currentWorkspaceTab = new URLSearchParams(window.location.search).get('tab') || 'producer';
    let writerData = null;
    let currentWriterStep = 1;
    let currentChapterIndex = 0;

    function switchWorkspaceTab(tab) {
      currentWorkspaceTab = tab;
      const url = new URL(window.location);
      url.searchParams.set('tab', tab);
      window.history.pushState({}, '', url);

      const isProducer = tab === 'producer';
      document.getElementById('viewProducerContainer').classList.toggle('hidden', !isProducer);
      document.getElementById('viewWriterContainer').classList.toggle('hidden', isProducer);

      document.getElementById('producerHeaderActions').classList.toggle('hidden', !isProducer);
      document.getElementById('writerHeaderActions').classList.toggle('hidden', isProducer);

      const navP = document.getElementById('navTabProducer');
      const navW = document.getElementById('navTabWriter');

      if (isProducer) {
        navP.className = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-gray-950 shadow cursor-pointer';
        navW.className = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';
      } else {
        navW.className = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow cursor-pointer';
        navP.className = 'px-3.5 py-1.5 text-xs font-black rounded-lg transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';
      }

      const curProj = projectsList.find((p) => p.id === activeProjectId);
      const titleStr = curProj ? curProj.title : activeProjectId;
      if (isProducer) {
        document.getElementById('projectHeaderTitle').textContent = titleStr + ' · 视觉镜头工作台';
      } else {
        document.getElementById('projectHeaderTitle').textContent = titleStr + ' · 知识长视频文案策划工坊';
        loadWriterProjectData(activeProjectId);
      }
    }

    async function loadWriterProjectData(projectId) {
      document.getElementById('writerProjectIdBadge').textContent = projectId;
      try {
        const res = await fetch('/api/writer/data?project=' + projectId);
        const data = await res.json();
        if (data.ok) {
          writerData = data;
          
          // 1. 填充 Brief
          const curTitle = data.brief?.title || (projectsList.find((p) => p.id === projectId)?.title || '');
          if (curTitle && !document.getElementById('wInputTitle').value) {
            document.getElementById('wInputTitle').value = curTitle.replace(/^《(.*)》$/, '$1');
          }
          if (data.brief) {
            document.getElementById('wInputTitle').value = data.brief.title || document.getElementById('wInputTitle').value;
            document.getElementById('wInputDuration').value = data.brief.target_duration_minutes || 25;
            document.getElementById('wInputChapterCount').value = data.brief.planned_chapter_count || 6;
            document.getElementById('wBriefCoreQuestion').value = data.brief.core_question || '';
            document.getElementById('wBriefShortAnswer').value = data.brief.short_answer || '';
            document.getElementById('wBriefScope').value = data.brief.scope?.time_range || '';
            document.getElementById('wBriefTaboos').value = (data.brief.taboos_and_exclusions || []).join('、');
          }

          // 2. 渲染证据卡
          renderEvidenceCardsList();

          // 3. 渲染大纲
          renderOutlineView();

          // 4. 渲染章节
          renderChapterTabs();
          renderCurrentChapterEditor();

          // 5. 渲染定稿全文
          renderFinalScriptView();

          // 恢复用户所处的最优阶段
          setWriterStep(data.activeStep || 1);
        }
      } catch (err) {
        console.error('加载文案数据失败:', err);
      }
    }

    function setWriterStep(step) {
      currentWriterStep = step;
      const stepNames = {
        1: 'Step 1 · 立项与资料输入',
        2: 'Step 2 · 证据卡提取与核验',
        3: 'Step 3 · 5~7 章大纲策划',
        4: 'Step 4 · 逐章撰写与四段式润色',
        5: 'Step 5 · 全文统稿去伪结尾与定稿',
      };
      const badge = document.getElementById('writerCurrentStepBadge');
      if (badge) badge.textContent = stepNames[step] || \`Step \${step}\`;

      for (let i = 1; i <= 5; i++) {
        const panel = document.getElementById(\`wPanelStep\${i}\`);
        const btn = document.getElementById(\`stepBtn\${i}\`);
        if (panel) panel.classList.toggle('hidden', i !== step);
        if (btn) {
          if (i === step) {
            btn.className = 'p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-purple-600/20 border-purple-500 text-white shadow cursor-pointer';
          } else {
            btn.className = 'p-2.5 rounded-xl border text-left transition flex items-center gap-2 bg-gray-900 border-gray-800 text-gray-400 hover:text-white cursor-pointer';
          }
        }
      }
    }

    // 渲染证据卡列表
    function renderEvidenceCardsList() {
      const container = document.getElementById('wEvidenceCardsList');
      if (!container) return;
      const cards = writerData?.evidenceCards || [];
      if (cards.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500 text-xs">暂无证据卡，请在左侧填入资料后点击上方「🤖 从资料中提取证据卡」</div>';
        return;
      }

      const claimTypeBadge = {
        verified_fact: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">已证实客观事实</span>',
        disputed_claim: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">学界/行业存在争议</span>',
        legend_or_anecdote: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">民间传说/轶事</span>',
        author_interpretation: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">作者个人推论</span>',
      };

      container.innerHTML = cards
        .map(
          (c, idx) => \`
        <div class="p-3 rounded-xl bg-gray-950 border border-gray-800/80 hover:border-purple-500/40 transition space-y-1.5 text-xs">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-amber-400">\${c.evidence_id || 'EV-' + String(idx + 1).padStart(3, '0')}</span>
              \${claimTypeBadge[c.claim_type] || claimTypeBadge.verified_fact}
              <span class="text-[10px] text-gray-400 font-mono">可靠度: \${c.reliability || 'high'}</span>
            </div>
            <button type="button" onclick="deleteEvidenceCard(\${idx})" class="text-gray-500 hover:text-rose-400 text-xs">✕ 删除</button>
          </div>
          <div class="text-gray-200 leading-relaxed font-sans">\${c.evidence_summary || c.claim || '无主张陈述'}</div>
          <div class="text-[11px] text-gray-500 flex items-center justify-between">
            <span class="truncate max-w-md">来源: \${c.source_title || c.source_url || '用户提供资料'}</span>
          </div>
        </div>
      \`
        )
        .join('');
    }

    function addCustomEvidenceCard() {
      const summary = prompt('请输入一条具体原子化事实主张（单一事实原则）：');
      if (!summary || !summary.trim()) return;
      if (!writerData) writerData = {};
      if (!Array.isArray(writerData.evidenceCards)) writerData.evidenceCards = [];
      const newId = \`EV-\${String(writerData.evidenceCards.length + 1).padStart(3, '0')}\`;
      writerData.evidenceCards.push({
        evidence_id: newId,
        claim_type: 'verified_fact',
        evidence_summary: summary.trim(),
        source_title: '人工补充证据',
        reliability: 'high',
      });
      renderEvidenceCardsList();
      saveWriterProjectDataAsync('evidenceCards', writerData.evidenceCards);
    }

    function deleteEvidenceCard(idx) {
      if (!writerData?.evidenceCards) return;
      writerData.evidenceCards.splice(idx, 1);
      renderEvidenceCardsList();
      saveWriterProjectDataAsync('evidenceCards', writerData.evidenceCards);
    }

    // 渲染大纲
    function renderOutlineView() {
      const outline = writerData?.outline;
      if (!outline) return;

      if (outline.opening_hook) {
        document.getElementById('wOutlineOpeningQuestion').value = outline.opening_hook.opening_question || '';
        document.getElementById('wOutlineOpeningAnswer').value = outline.opening_hook.immediate_short_answer || '';
      }
      if (outline.single_ending_plan) {
        document.getElementById('wOutlineEndingTakeaway').value = outline.single_ending_plan.final_takeaway || '';
      }

      const listEl = document.getElementById('wOutlineChaptersList');
      const countEl = document.getElementById('wOutlineChapterCountBadge');
      const chapters = outline.chapters || [];
      countEl.textContent = \`\${chapters.length} 章\`;

      if (chapters.length === 0) {
        listEl.innerHTML = '<div class="text-center py-8 text-gray-500 text-xs">暂无大纲章节，请核验证据卡后点击「🤖 基于证据卡生成大纲」</div>';
        return;
      }

      listEl.innerHTML = chapters
        .map(
          (ch, i) => \`
        <div class="p-3.5 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-white text-xs">第 \${ch.chapter_number || i + 1} 章：\${ch.chapter_title}</span>
            <div class="flex items-center gap-1.5 flex-wrap">
              \${(ch.supporting_evidence_ids || [])
                .map((ev) => \`<span class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold">\${ev}</span>\`)
                .join('')}
            </div>
          </div>
          <div class="text-xs text-amber-300/90 font-medium">🎯 子问题：\${ch.sub_question}</div>
          <div class="text-[11px] text-gray-400 leading-relaxed">💡 机制概述：\${ch.mechanism_or_background_summary || '无'}</div>
          \${ch.transition_to_next ? \`<div class="text-[10px] text-gray-500 font-mono">↪ 过渡：\${ch.transition_to_next}</div>\` : ''}
        </div>
      \`
        )
        .join('');
    }

    // 渲染单章 Tabs 与编辑器
    function renderChapterTabs() {
      const bar = document.getElementById('wChapterTabsBar');
      if (!bar) return;
      const outline = writerData?.outline;
      const chapters = outline?.chapters || [];
      if (chapters.length === 0) {
        bar.innerHTML = '<span class="text-xs text-gray-500 py-1">请先完成大纲审核，章节选项卡将在此呈现</span>';
        return;
      }

      bar.innerHTML = chapters
        .map(
          (ch, idx) => \`
        <button type="button" onclick="selectEditingChapter(\${idx})" class="px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer \${
          idx === currentChapterIndex
            ? 'bg-purple-600 text-white shadow'
            : 'card text-gray-400 hover:text-white hover:border-purple-500/40'
        }">
          第 \${ch.chapter_number || idx + 1} 章
        </button>
      \`
        )
        .join('');
    }

    function selectEditingChapter(idx) {
      currentChapterIndex = idx;
      renderChapterTabs();
      renderCurrentChapterEditor();
    }

    function renderCurrentChapterEditor() {
      const outline = writerData?.outline;
      const targetCh = outline?.chapters?.[currentChapterIndex];
      const chList = writerData?.chapters || [];
      const writtenData = chList.find((c) => Number(c.chapter_number) === Number(targetCh?.chapter_number || currentChapterIndex + 1));

      if (targetCh) {
        document.getElementById('wCurChapterHeader').textContent = \`第 \${targetCh.chapter_number || currentChapterIndex + 1} 章：\${targetCh.chapter_title}\`;
        document.getElementById('wCurChapterSubQuestion').textContent = \`子问题：\${targetCh.sub_question || '未设定'}\`;
      } else {
        document.getElementById('wCurChapterHeader').textContent = \`第 \${currentChapterIndex + 1} 章：草稿编辑\`;
        document.getElementById('wCurChapterSubQuestion').textContent = '子问题：待大纲生成';
      }

      if (writtenData) {
        document.getElementById('wSec1Question').value = writtenData.sections?.['1_question_or_contradiction'] || '';
        document.getElementById('wSec2Mechanism').value = writtenData.sections?.['2_mechanism_or_background'] || '';
        document.getElementById('wSec3Examples').value = writtenData.sections?.['3_sourced_concrete_examples'] || '';
        document.getElementById('wSec4Transition').value = writtenData.sections?.['4_mini_summary_and_transition'] || '';
        document.getElementById('wCurChapterWordCount').textContent = writtenData.word_count || writtenData.full_chapter_narration?.length || 0;
        document.getElementById('wCurChapterRevisionBadge').textContent = \`修订数: \${writtenData.revision_count || 0}\`;
      } else {
        document.getElementById('wSec1Question').value = '';
        document.getElementById('wSec2Mechanism').value = '';
        document.getElementById('wSec3Examples').value = '';
        document.getElementById('wSec4Transition').value = '';
        document.getElementById('wCurChapterWordCount').textContent = '0';
        document.getElementById('wCurChapterRevisionBadge').textContent = '未撰写';
      }
    }

    // 渲染定稿与统稿报告
    function renderFinalScriptView() {
      const script = writerData?.finalScript;
      if (!script) return;
      document.getElementById('wFinalScriptWords').textContent = script.total_word_count || 0;
      document.getElementById('wFinalScriptMin').textContent = script.estimated_duration_minutes || 0;

      const fullText = [];
      if (script.script_segments?.opening) {
        fullText.push('【开篇导引】\\n' + script.script_segments.opening);
      }
      if (Array.isArray(script.script_segments?.chapters)) {
        script.script_segments.chapters.forEach((c) => {
          fullText.push(\`【第 \${c.chapter_number} 章：\${c.chapter_title}】\\n\` + c.narration_text);
        });
      }
      if (script.script_segments?.ending) {
        fullText.push('【全片终局收尾】\\n' + script.script_segments.ending);
      }

      document.getElementById('wFinalScriptFullText').value = fullText.join('\\n\\n========================================\\n\\n');

      const log = script.editorial_changes_log;
      if (log) {
        document.getElementById('wRemovedFalseEndingsBadge').textContent = \`已清理伪结尾: \${log.removed_false_endings_count || 0} 处\`;
        const logHtml = [];
        if (log.removed_duplicate_arguments?.length) {
          logHtml.push(\`<div>🗑️ 删除重复论点：\${log.removed_duplicate_arguments.join('；')}</div>\`);
        }
        if (log.unified_terms_and_names?.length) {
          logHtml.push(\`<div>📝 统一专有名词与读法：\${log.unified_terms_and_names.join('；')}</div>\`);
        }
        document.getElementById('wEditorialLogDetails').innerHTML = logHtml.length ? logHtml.join('') : '<div>- 全篇逻辑顺畅，未发现明显冗余与伪结尾。</div>';
      }
    }

    // ==========================================
    // AI 自动化生成执行与异步请求
    // ==========================================

    async function aiGenerateBrief() {
      const title = document.getElementById('wInputTitle').value.trim();
      const materials = document.getElementById('wInputMaterials').value.trim();
      const duration = parseInt(document.getElementById('wInputDuration').value, 10) || 25;
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiBrief');

      if (!title) {
        alert('请在左侧填入视频标题！');
        return;
      }
      if (!materials || materials.length < 15) {
        alert('【缺资料前置拦截】：请在左侧至少粘贴一段实质性考证资料或点击“载入示例考证资料”，严禁凭空硬编！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ AI 正在深度分析资料...</span>';
      try {
        const res = await fetch('/api/writer/ai/generate-brief?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            materials,
            durationMinutes: duration,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.brief) {
          if (!writerData) writerData = {};
          writerData.brief = data.brief;
          document.getElementById('wBriefCoreQuestion').value = data.brief.core_question || '';
          document.getElementById('wBriefShortAnswer').value = data.brief.short_answer || '';
          document.getElementById('wBriefScope').value = data.brief.scope?.time_range || '';
          document.getElementById('wBriefTaboos').value = (data.brief.taboos_and_exclusions || []).join('、');
          showToast('✅ Brief 立项已由 AI 生成！');
        } else {
          alert('生成 Brief 失败: ' + (data.error || '大模型返回格式异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 AI 分析资料并生成 Brief</span>';
      }
    }

    async function aiExtractEvidence() {
      const title = document.getElementById('wInputTitle').value.trim();
      const materials = document.getElementById('wInputMaterials').value.trim();
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiEvidence');

      if (!materials || materials.length < 15) {
        alert('【缺资料拦截】：请先在左侧输入需要考证抽取的原始资料文本！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在提取原子化证据卡...</span>';
      try {
        const res = await fetch('/api/writer/ai/extract-evidence?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            materials,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.evidenceCards)) {
          if (!writerData) writerData = {};
          writerData.evidenceCards = data.evidenceCards;
          renderEvidenceCardsList();
          showToast(\`✅ 已成功提取 \${data.evidenceCards.length} 张独立证据卡！\`);
        } else {
          alert('提取证据卡失败: ' + (data.error || '格式异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 从资料中提取证据卡</span>';
      }
    }

    function approveEvidenceCardsGate() {
      const count = writerData?.evidenceCards?.length || 0;
      if (count === 0) {
        alert('当前尚未提取或录入任何证据卡，无法开启大纲策划！');
        return;
      }
      showToast('🚦 证据卡已通过人工审核！进入阶段 3：大纲策划');
      setWriterStep(3);
    }

    async function aiBuildOutline() {
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiOutline');
      if (!writerData?.evidenceCards || writerData.evidenceCards.length === 0) {
        alert('请先完成阶段 2 证据卡提取！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在规划 5~7 章结构化大纲...</span>';
      try {
        const res = await fetch('/api/writer/ai/build-outline?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brief: writerData.brief || { title: document.getElementById('wInputTitle').value },
            evidenceCards: writerData.evidenceCards,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.outline) {
          writerData.outline = data.outline;
          renderOutlineView();
          renderChapterTabs();
          showToast('✅ 结构化大纲生成完成，请人工审核！');
        } else {
          alert('生成大纲失败: ' + (data.error || '大模型异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 基于证据卡生成大纲</span>';
      }
    }

    function approveOutlineGate() {
      if (!writerData?.outline || !writerData.outline.chapters?.length) {
        alert('请先生成大纲后再进行人工审核！');
        return;
      }
      writerData.outline.approval_status = 'approved';
      saveWriterProjectDataAsync('outline', writerData.outline);
      showToast('🚦 大纲审核通过 (APPROVED)！解锁阶段 4 单章撰写');
      renderChapterTabs();
      renderCurrentChapterEditor();
      setWriterStep(4);
    }

    async function aiWriteCurrentChapter() {
      const outline = writerData?.outline;
      const targetCh = outline?.chapters?.[currentChapterIndex];
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiWriteChapter');

      if (!targetCh) {
        alert('未找到当前章节的大纲规划！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在撰写本章 (四段式结构)...</span>';
      try {
        const res = await fetch('/api/writer/ai/write-chapter?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapterNumber: targetCh.chapter_number || currentChapterIndex + 1,
            outline,
            evidenceCards: writerData.evidenceCards || [],
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.chapter) {
          if (!Array.isArray(writerData.chapters)) writerData.chapters = [];
          const existIdx = writerData.chapters.findIndex((c) => Number(c.chapter_number) === Number(data.chapter.chapter_number));
          if (existIdx >= 0) {
            writerData.chapters[existIdx] = data.chapter;
          } else {
            writerData.chapters.push(data.chapter);
          }
          renderCurrentChapterEditor();
          showToast(\`✅ 第 \${data.chapter.chapter_number} 章文案撰写完成（\${data.chapter.word_count} 字）！\`);
        } else {
          alert('撰写章节失败: ' + (data.error || '大模型异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 AI 撰写当前章节</span>';
      }
    }

    function saveCurrentChapterDraft() {
      const targetNum = writerData?.outline?.chapters?.[currentChapterIndex]?.chapter_number || currentChapterIndex + 1;
      const sec1 = document.getElementById('wSec1Question').value.trim();
      const sec2 = document.getElementById('wSec2Mechanism').value.trim();
      const sec3 = document.getElementById('wSec3Examples').value.trim();
      const sec4 = document.getElementById('wSec4Transition').value.trim();
      const fullText = [sec1, sec2, sec3, sec4].filter(Boolean).join('\\n\\n');

      const chObj = {
        chapter_number: Number(targetNum),
        chapter_title: writerData?.outline?.chapters?.[currentChapterIndex]?.chapter_title || \`第\${targetNum}章\`,
        sub_question: writerData?.outline?.chapters?.[currentChapterIndex]?.sub_question || '',
        sections: {
          '1_question_or_contradiction': sec1,
          '2_mechanism_or_background': sec2,
          '3_sourced_concrete_examples': sec3,
          '4_mini_summary_and_transition': sec4,
        },
        full_chapter_narration: fullText,
        word_count: fullText.length,
      };

      if (!Array.isArray(writerData.chapters)) writerData.chapters = [];
      const existIdx = writerData.chapters.findIndex((c) => Number(c.chapter_number) === Number(targetNum));
      if (existIdx >= 0) {
        writerData.chapters[existIdx] = chObj;
      } else {
        writerData.chapters.push(chObj);
      }

      saveWriterProjectDataAsync('chapter', chObj);
      showToast(\`💾 第 \${targetNum} 章草稿已保存！\`);
    }

    async function aiFinalizeFullScript() {
      const outline = writerData?.outline;
      const chapters = writerData?.chapters || [];
      const model = document.getElementById('wInputModel').value;
      const btn = document.getElementById('btnAiFinalize');

      if (chapters.length === 0) {
        alert('尚未撰写任何章节，无法统稿！');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在全文去重去伪结尾与统稿...</span>';
      try {
        const res = await fetch('/api/writer/ai/finalize-script?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outline,
            chapters,
            model,
            apiKey: visualConfig.apiKey,
            baseUrl: visualConfig.baseUrl,
          }),
        });
        const data = await res.json();
        if (data.ok && data.finalScript) {
          writerData.finalScript = data.finalScript;
          renderFinalScriptView();
          showToast('🎉 全文统稿去伪结尾完成，文案已定稿！');
        } else {
          alert('全文统稿失败: ' + (data.error || '异常'));
        }
      } catch (err) {
        alert('请求失败: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🤖 AI 全文统稿去重去伪结尾</span>';
      }
    }

    async function saveWriterProjectDataAsync(part, data) {
      try {
        await fetch('/api/writer/save?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ part, data }),
        });
      } catch (e) {
        console.warn('异步保存失败:', e);
      }
    }

    function saveWriterPartManual(part) {
      if (part === 'brief') {
        const briefObj = {
          project_id: activeProjectId,
          title: document.getElementById('wInputTitle').value.trim(),
          core_question: document.getElementById('wBriefCoreQuestion').value.trim(),
          short_answer: document.getElementById('wBriefShortAnswer').value.trim(),
          target_duration_minutes: parseInt(document.getElementById('wInputDuration').value, 10) || 25,
          planned_chapter_count: parseInt(document.getElementById('wInputChapterCount').value, 10) || 6,
          scope: { time_range: document.getElementById('wBriefScope').value.trim() },
          taboos_and_exclusions: document.getElementById('wBriefTaboos').value.split(/[、,，\\n]+/).filter(Boolean),
        };
        if (!writerData) writerData = {};
        writerData.brief = briefObj;
        saveWriterProjectDataAsync('brief', briefObj);
        showToast('💾 Brief 立项已手动保存！');
      }
    }

    function saveCurrentWriterPart() {
      if (currentWriterStep === 1) saveWriterPartManual('brief');
      else if (currentWriterStep === 2) saveWriterProjectDataAsync('evidenceCards', writerData?.evidenceCards);
      else if (currentWriterStep === 3) saveWriterProjectDataAsync('outline', writerData?.outline);
      else if (currentWriterStep === 4) saveCurrentChapterDraft();
      else if (currentWriterStep === 5) {
        const fullContent = document.getElementById('wFinalScriptFullText').value;
        saveWriterProjectDataAsync('finalScript', {
          title: document.getElementById('wInputTitle').value,
          content: fullContent,
        });
        showToast('💾 完整终稿已保存！');
      }
    }

    async function syncWriterToProducerUI() {
      const fullText = document.getElementById('wFinalScriptFullText').value.trim();
      const scriptObj = writerData?.finalScript || fullText;

      if (!fullText && !writerData?.finalScript) {
        alert('当前没有可同步的终稿文案，请先在阶段 5 统稿或粘贴文案！');
        return;
      }

      showToast('🚀 正在将定稿文案智能切分镜头 (4~8s) 并流转至制作台...');
      try {
        const res = await fetch('/api/writer/sync-to-producer?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            finalScript: writerData?.finalScript,
            content: fullText,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast(\`🎉 成功同步！已自动切分为 \${data.totalScenes} 个镜头，正在进入制作台...\`);
          switchWorkspaceTab('producer');
          await loadProjects();
          await loadWorkflow();
        } else {
          alert('流转制作台失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        alert('流转异常: ' + err.message);
      }
    }

    function loadSampleMaterialToWriter() {
      document.getElementById('wInputTitle').value = '富士山，日本象征，富士山为什么如此出名';
      document.getElementById('wInputMaterials').value = \`【参考资料 1】：日本气象厅火山调查档案
富士山标高 3776 米，为日本最高成层火山。地质演变经历小御岳、古富士（约10万年前）与新富士（约1万年前）三阶段。公元864年贞观大喷发喷出大量熔岩填平部分湖泊，形成青木原树海与富士五湖雏形。

【参考资料 2】：神道与民间信仰史
古代因狂暴喷发被视为神灵化身，建立浅间神社以镇平火山神怒。江户时期诞生“富士讲”，庶民阶层通过互助金制度组织群体登顶朝圣，并修建人造富士冢。

【参考资料 3】：艺术与全球传播
江户晚期葛饰北斋创作浮世绘《富岳三十六景》，大量使用普鲁士蓝（ベロ藍），随后通过万国博览会传入欧洲，对印象派画家及德彪西音乐创作产生深刻影响。

【参考资料 4】：现代治理
2013年登录世界文化遗产（信仰的对象与艺术的源泉）。近年面临游客拥堵、弹丸登山安全隐患，2024年吉田路线推行限流与通行费配额管理。\`;
      document.getElementById('wMaterialWordCount').textContent = \`已输入 \${document.getElementById('wInputMaterials').value.length} 字资料\`;
      showToast('💡 已成功填入富士山真实考证资料范例！');
    }

    function switchStep1SubTab(tab) {
      const isCreate = tab === 'create';
      const btnCreate = document.getElementById('wStep1SubTabCreateBtn');
      const btnImport = document.getElementById('wStep1SubTabImportBtn');
      const viewCreate = document.getElementById('wStep1SubViewCreate');
      const viewImport = document.getElementById('wStep1SubViewImport');

      if (btnCreate && btnImport && viewCreate && viewImport) {
        btnCreate.className = isCreate
          ? 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-purple-600 text-white shadow cursor-pointer'
          : 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';

        btnImport.className = !isCreate
          ? 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-violet-600 text-white shadow cursor-pointer'
          : 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-gray-400 hover:text-white cursor-pointer';

        viewCreate.classList.toggle('hidden', !isCreate);
        viewImport.classList.toggle('hidden', isCreate);
      }

      if (!isCreate) {
        loadStep1ScannedScripts();
      }
    }

    function openWriterImportDirectly() {
      setWriterStep(1);
      switchStep1SubTab('import');
      const el = document.getElementById('wPanelStep1');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }

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
            (s) => \`
          <div class="p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-500/50 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold text-white truncate max-w-md">\${s.title}</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded \${s.isFullScript ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold' : 'bg-gray-800 text-gray-400'}">
                  \${s.isFullScript ? '✨ 完整长片文案' : '📄 章节草稿'}
                </span>
                <span class="text-[10px] text-gray-400">\${s.wordCount} 字 · \${s.sizeKb} KB · \${s.ext}</span>
              </div>
              <div class="text-[11px] text-gray-400 line-clamp-1 font-mono">\${s.preview || s.filename}</div>
            </div>
            <button type="button" onclick="selectStep1Script('\${s.filename}')" class="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white shrink-0 transition flex items-center gap-1 shadow cursor-pointer">
              <span>📥 选择并切镜</span>
            </button>
          </div>
        \`
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
          document.getElementById('wStep1SelectedSummary').textContent = \`已选: \${data.title || script.title} (\${data.content.length} 字)\`;
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
          previewEl.textContent = \`⚡ 预估将切分为 \${data.totalScenes} 个镜头 (总长约 \${data.totalDurationMinutes} 分钟，平均 \${data.avgSecondsPerScene} 秒/镜)\`;
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
          showToast(\`🎉 成功导入！已生成 \${data.totalScenes} 个镜头，正在进入制作台...\`);
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
            (s) => \`
          <div class="p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-500/50 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-bold text-white truncate max-w-md">\${s.title}</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded \${s.isFullScript ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold' : 'bg-gray-800 text-gray-400'}">
                  \${s.isFullScript ? '✨ 完整长片文案' : '📄 章节草稿'}
                </span>
                <span class="text-[10px] text-gray-400">\${s.wordCount} 字 · \${s.sizeKb} KB · \${s.ext}</span>
              </div>
              <div class="text-[11px] text-gray-400 line-clamp-1 font-mono">\${s.preview || s.filename}</div>
            </div>
            <button type="button" onclick="selectScannedScript('\${s.filename}')" class="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-violet-600/90 hover:bg-violet-600 text-white shrink-0 transition flex items-center gap-1 shadow cursor-pointer">
              <span>📥 载入并智能切镜</span>
            </button>
          </div>
        \`
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
          document.getElementById('previewNotice').textContent = \`共预估切分为 \${data.scenesCount} 个镜头 (无缝拼接)\`;

          const previewEl = document.getElementById('segmentPreviewList');
          if (data.sampleScenes && data.sampleScenes.length > 0) {
            previewEl.innerHTML = data.sampleScenes
              .map(
                (sc) => \`
              <div class="p-2 rounded bg-gray-950 border border-gray-800 text-[11px] space-y-0.5">
                <div class="flex items-center justify-between text-gray-400">
                  <span class="text-amber-400 font-bold">\${sc.scene_id} · [\${sc.chapter_ref}]</span>
                  <span class="text-[10px] text-gray-500">\${(sc.start_ms / 1000).toFixed(1)}s ~ \${(sc.end_ms / 1000).toFixed(1)}s (\${(sc.duration_ms / 1000).toFixed(1)}s)</span>
                </div>
                <div class="text-gray-200 line-clamp-1">\${sc.narration_text}</div>
                <div class="text-[10px] text-purple-400 font-semibold">🎯 提炼关键词: \${sc.content_keywords?.join('、')}</div>
              </div>
            \`
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
        const baseName = file.name.replace(/\.[^/.]+$/, '');
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

    function toggleAudioModal() {
      document.getElementById('audioModal').classList.toggle('hidden');
    }

    function toggleVisualModelModal() {
      document.getElementById('visualModelModal').classList.toggle('hidden');
    }

    function toggleBgmModal() {
      const modal = document.getElementById('bgmModal');
      modal.classList.toggle('hidden');
      const d = document.getElementById('bgmModelActiveDisplay');
      if (d) {
        d.textContent = 'OpenRouter / ' + (visualConfig.bgmModel || 'deepseek/deepseek-chat');
      }
    }

    let bgmAudioCtx = null;
    function playBgmSample(type) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!bgmAudioCtx) bgmAudioCtx = new AudioCtx();
        if (bgmAudioCtx.state === 'suspended') bgmAudioCtx.resume();

        const osc = bgmAudioCtx.createOscillator();
        const gain = bgmAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(bgmAudioCtx.destination);

        const now = bgmAudioCtx.currentTime;
        if (type === 'epic') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(440, now + 1.2);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 1.8);
          osc.start(now);
          osc.stop(now + 1.8);
        } else {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(330, now);
          osc.frequency.setValueAtTime(495, now + 0.4);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
          osc.start(now);
          osc.stop(now + 1.2);
        }
        showToast('🎵 正在模拟试听 ' + (type === 'epic' ? 'Track A (交响史诗)' : 'Track B (公路律动)') + '...');
      } catch (e) {
        showToast('🎵 试听已触发');
      }
    }

    function applyBgmToProject() {
      toggleBgmModal();
      showToast('✅ 自适应 BGM 与人声避让设置已应用至当前工程！');
    }

    function selectVideoModelSlug(slug) {
      document.getElementById('currentVideoModelInput').value = slug;
    }

    function selectTextModelSlug(slug) {
      document.getElementById('currentTextModelInput').value = slug;
    }

    function selectImageModelSlug(slug) {
      document.getElementById('currentImageModelInput').value = slug;
    }

    function selectBgmModelSlug(slug) {
      document.getElementById('currentBgmModelInput').value = slug;
    }

    async function testCurrentProviderConnection() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const model = (document.getElementById('currentTextModelInput')?.value || '').trim() || 'deepseek/deepseek-chat';
      const statusEl = document.getElementById('testConnStatus');
      const btn = document.getElementById('btnTestProvider');

      if (!apiKey) {
        alert('请先输入 OpenRouter API Key');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在连接测试...</span>';
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = '<span class="text-amber-400">正在与服务网关通信...</span>';

      try {
        const res = await fetch('/api/test-provider?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openrouter', apiKey, baseUrl, model })
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.innerHTML = '<span class="text-emerald-400 font-bold">✅ ' + data.message + '</span>';
          showToast('✅ ' + data.message);
        } else {
          statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ ' + (data.error || '连接失败') + '</span>';
        }
      } catch (e) {
        statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ 请求失败: ' + e.message + '</span>';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>⚡ 测试网关 API 连接</span>';
      }
    }

    async function saveVisualModelConfig() {
      const apiKey = document.getElementById('currentApiKeyInput').value.trim();
      const baseUrl = document.getElementById('currentBaseUrlInput').value.trim();
      const videoModel = document.getElementById('currentVideoModelInput').value.trim();
      const textModel = document.getElementById('currentTextModelInput').value.trim();
      const imageModel = document.getElementById('currentImageModelInput').value.trim();
      const bgmModel = (document.getElementById('currentBgmModelInput')?.value || '').trim() || 'deepseek/deepseek-chat';

      visualConfig.apiKey = apiKey;
      visualConfig.baseUrl = baseUrl;
      visualConfig.videoModel = videoModel;
      visualConfig.textModel = textModel;
      visualConfig.imageModel = imageModel;
      visualConfig.bgmModel = bgmModel;

      try {
        const res = await fetch('/api/save-visual-config?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            apiKey,
            baseUrl,
            videoModel,
            textModel,
            imageModel,
            bgmModel
          })
        });
        const data = await res.json();
        toggleVisualModelModal();
        updateModelBadge();
        renderTable();
        showToast('🎯 已指定视频模型：' + videoModel);
      } catch (e) {
        showToast('❌ 保存失败: ' + e.message);
      }
    }

    function updateModelBadge() {
      const vBadge = document.getElementById('currentVideoModelBadge');
      const tBadge = document.getElementById('currentTextModelBadge');
      const iBadge = document.getElementById('currentImageModelBadge');

      const vModel = (visualConfig.videoModel || 'minimax/hailuo-3-max').split('/').pop();
      const tModel = (visualConfig.textModel || 'deepseek-chat').split('/').pop();
      const iModel = (visualConfig.imageModel || 'flux-3-image').split('/').pop();

      if (vBadge) {
        vBadge.textContent = '🎬 视频: ' + vModel + (visualConfig.apiKey ? ' (Key就绪)' : ' (待填Key)');
      }
      if (tBadge) {
        tBadge.textContent = '✍️ 分镜: ' + tModel;
      }
      if (iBadge) {
        iBadge.textContent = '🖼️ 生图: ' + iModel;
      }
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
          document.getElementById('projectHeaderTitle').textContent = cur.title + ' · 视觉镜头工作台';
        }
      } catch (e) {
        console.error('加载工程列表失败:', e);
      }
    }

    let pendingSelectedProjectId = activeProjectId;

    function onProjectSelectChange(newId) {
      pendingSelectedProjectId = newId;
    }

    function confirmSwitchProject() {
      if (!pendingSelectedProjectId || pendingSelectedProjectId === activeProjectId) return;
      onProjectChange(pendingSelectedProjectId);
    }

    async function deleteCurrentProject() {
      if (!activeProjectId || activeProjectId === 'why_nikko_heritage_road_001') {
        showToast('基准工程不可删除');
        return;
      }
      if (!window.confirm('确定删除当前工程及其本地文件吗？此操作无法撤销。')) return;
      try {
        const res = await fetch('/api/delete-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || '删除失败');
        activeProjectId = data.nextActiveProjectId;
        pendingSelectedProjectId = activeProjectId;
        const url = new URL(window.location);
        url.searchParams.set('project', activeProjectId);
        window.history.pushState({}, '', url);
        await loadProjects();
        await loadWorkflow();
        if (currentWorkspaceTab === 'writer') await loadWriterProjectData(activeProjectId);
        showToast('已删除工程：' + data.deletedProjectId);
      } catch (e) {
        showToast('删除失败：' + e.message);
      }
    }

    function onProjectChange(newId) {
      activeProjectId = newId;
      pendingSelectedProjectId = newId;
      localStorage.setItem('whyvideo_active_project', newId);
      const url = new URL(window.location);
      url.searchParams.set('project', newId);
      window.history.pushState({}, '', url);
      loadProjects();
      loadWorkflow();
      if (currentWorkspaceTab === 'writer') {
        loadWriterProjectData(newId);
      }
      showToast('🔀 已切换至工程：' + newId);
    }

    async function loadOpenRouterModels() {
      try {
        const res = await fetch('/api/openrouter-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 列表跳过:', e);
      }
    }

    async function loadOpenRouterVideoModels() {
      try {
        const res = await fetch('/api/openrouter-video-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterVideoModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 视频模型列表跳过:', e);
      }
    }

    async function loadOpenRouterImageModels() {
      try {
        const res = await fetch('/api/openrouter-image-models');
        const data = await res.json();
        if (data.ok && Array.isArray(data.models)) {
          const dl = document.getElementById('openrouterImageModelsList');
          if (dl) {
            dl.innerHTML = data.models.map(m => '<option value="' + m.id + '">' + (m.name || m.id) + '</option>').join('');
          }
        }
      } catch (e) {
        console.warn('加载 OpenRouter 生图模型列表跳过:', e);
      }
    }

    async function loadWorkflow() {
      try {
        loadOpenRouterModels();
        loadOpenRouterVideoModels();
        loadOpenRouterImageModels();
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

        if (data.promptConfig) {
          const cfg = data.promptConfig;
          let rawVideoModel = cfg.videoModel || 'minimax/hailuo-3-max';
          if (rawVideoModel === 'minimax/video-01' || rawVideoModel === 'minimax/hailuo' || rawVideoModel === 'video-01') {
            rawVideoModel = 'minimax/hailuo-3-max';
          }
          let rawImageModel = cfg.imageModel || 'black-forest-labs/flux-3-image';
          if (rawImageModel === 'black-forest-labs/flux-1-schnell' || rawImageModel.includes('flux-1')) {
            rawImageModel = 'black-forest-labs/flux-3-image';
          }

          visualConfig = {
            apiKey: cfg.apiKey || '',
            baseUrl: cfg.baseUrl || 'https://openrouter.ai/api/v1',
            videoModel: rawVideoModel,
            textModel: cfg.textModel || cfg.model || 'deepseek/deepseek-chat',
            imageModel: rawImageModel,
            bgmModel: cfg.bgmModel || 'deepseek/deepseek-chat'
          };

          const kEl = document.getElementById('currentApiKeyInput');
          const bEl = document.getElementById('currentBaseUrlInput');
          const vEl = document.getElementById('currentVideoModelInput');
          const tEl = document.getElementById('currentTextModelInput');
          const iEl = document.getElementById('currentImageModelInput');
          const bgmEl = document.getElementById('currentBgmModelInput');

          if (kEl && visualConfig.apiKey) kEl.value = visualConfig.apiKey;
          if (bEl && visualConfig.baseUrl) bEl.value = visualConfig.baseUrl;
          if (vEl && visualConfig.videoModel) vEl.value = visualConfig.videoModel;
          if (tEl && visualConfig.textModel) tEl.value = visualConfig.textModel;
          if (iEl && visualConfig.imageModel) iEl.value = visualConfig.imageModel;
          if (bgmEl && visualConfig.bgmModel) bgmEl.value = visualConfig.bgmModel;

          updateModelBadge();
        }

        renderVideoContainer(data);
        renderTable();
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    }

    function renderVideoContainer(data) {
      const c = document.getElementById('videoContainer');
      const count = manifestData?.scenes?.length || 0;
      const totalSec = manifestData?.total_duration_sec || 0;
      if (data.hasVideo && data.videoUrl) {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">1080p 纯净正片已就绪</span>
              <span class="text-xs text-gray-400">已对齐 \${count} 个视觉镜头 (平均 \${(totalSec/count).toFixed(1)}s/镜)</span>
            </div>
            <p class="text-xs text-gray-300 font-medium">当前工程已完成 Remotion 渲染，支持边查阅表格边拖拽播放进度检验音画节拍。</p>
          </div>
          <div class="w-full md:w-96 rounded-xl overflow-hidden border border-gray-700 bg-black aspect-video flex items-center justify-center">
            <video src="\${data.videoUrl}" controls class="w-full h-full object-contain"></video>
          </div>
        \`;
      } else {
        c.innerHTML = \`
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300">视觉镜头轨已就绪 · \${count} 个镜头</span>
              <span class="text-xs text-gray-400">全片约 \${(totalSec/60).toFixed(1)} 分钟 · 平均 \${(totalSec/count).toFixed(1)} 秒/镜头</span>
            </div>
            <p class="text-xs text-gray-300 font-normal">点击每行的 <b>【🎨 一键生成本镜头画面】</b>，可调用所选的 AI 模型在行内即时渲染出 16:9 视觉预览！桌面素材直接拖入右侧框中即可检验。</p>
          </div>
          <div class="flex items-center gap-3">
            <button onclick="toggleVisualModelModal()" class="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition">
              🎬 指定 AI 视频模型
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
      const totalCount = scenes.length;
      const totalSec = manifestData?.total_duration_sec || 0;
      const avgSec = totalCount > 0 ? (totalSec / totalCount).toFixed(1) : 0;

      const goldCount = scenes.filter((s) => s.duration_ms <= 8500).length;
      const overCount = scenes.filter((s) => s.duration_ms > 10000).length;

      document.getElementById('statTotal').textContent = totalCount + ' 镜';
      document.getElementById('statAvgDur').textContent = \`平均 \${avgSec}s / 镜\`;
      document.getElementById('statGold').textContent = goldCount + ' 镜';
      document.getElementById('statOver').textContent = overCount + ' 镜';
    }

    function renderTable() {
      updateCounters();
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      (manifestData?.scenes || []).forEach((scene, idx) => {
        const isAi = scene.source_mode !== 'manual_upload';
        const ppt = scene.ppt_slide_spec || {};
        const kws = Array.isArray(scene.content_keywords) ? scene.content_keywords : [];
        const durSec = (scene.duration_ms / 1000).toFixed(1);

        let badgeClass = 'badge-gold';
        let badgeLabel = \`🟢 \${durSec}s · 黄金节奏\`;
        if (scene.duration_ms > 10000) {
          badgeClass = 'badge-danger';
          badgeLabel = \`🔴 \${durSec}s · 建议切分 ✂️\`;
        } else if (scene.duration_ms > 8500) {
          badgeClass = 'badge-warn';
          badgeLabel = \`🟡 \${durSec}s · 偏长\`;
        }

        const isSharedWithPrev = Boolean(scene.shared_asset_with_prev);
        const tr = document.createElement('tr');
        tr.className = 'transition ' + (isSharedWithPrev ? 'bg-sky-950/20' : '');

        // 1. 镜头序号与时长
        const td1 = document.createElement('td');
        td1.className = 'p-3 text-center';
        td1.innerHTML = \`
          <span class="px-2 py-0.5 rounded-lg bg-gray-900 border border-gray-700 text-amber-400 font-extrabold text-xs block mb-1">
            \${scene.scene_id}
          </span>
          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold block mb-1 \${badgeClass}">
            \${badgeLabel}
          </span>
          <span class="text-[10px] text-gray-500 block font-mono">
            \${(scene.start_ms / 1000).toFixed(1)}s - \${(scene.end_ms / 1000).toFixed(1)}s
          </span>
          <span class="text-[10px] text-gray-400 block mt-0.5">\${scene.chapter_ref || ''}</span>
        \`;

        // 2. 旁白片段
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
          <p class="text-[10px] text-gray-500 mt-1">在 16:9 画幅中央醒目展示</p>
        \`;

        // 4. 画面生成方式
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
              <span class="text-xs">📤 人工素材/拖拽</span>
            </label>
          </div>
        \`;

        // 5. 【核心升级】：视觉呈现方式三选一 (🎬实体视频 / 🖼️超写实图 / 📊动效卡片) + 即时生成与真实预览
        const td5 = document.createElement('td');
        td5.className = 'p-3';

        const curVisualType = scene.visual_type || 'data_card';
        const curTargetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
        const mainTitle = ppt.theme_title || kws[0] || '核心要点';
        const subtitle = ppt.subtitle || scene.narration_text.slice(0, 24);
        const hasPreviewImage = Boolean(scene.preview_image_url);

        const assetRecord = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const hasGeneratedVideo = Boolean(scene.final_asset_id && scene.visual_type === 'broll_video' && assetRecord);
        const generatedVideoSrc = hasGeneratedVideo ? ('/public/' + activeProjectId + '/' + assetRecord.path) : null;

        const pName = (visualConfig.videoModel || 'tencent/hunyuan-video').split('/').pop();
        const iName = (visualConfig.imageModel || 'flux-1-schnell').split('/').pop();

        let innerContent = '';

        if (curTargetMode === 'video') {
          // 🎬 实体真实动态视频形态
          innerContent = \`
            <!-- Prompt 指导输入窗口 -->
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">🎬 视频描述 & 运镜指示词 (Text-to-Video):</span>
                <button type="button" id="prompt_btn_\${idx}" onclick="autoGenerateShotPrompt(\${idx}, 'video')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼电影级运镜与画面描述词">
                  ✨ 自动提炼运镜词
                </button>
              </div>
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入本镜头实体视频提示词（例如: 温泉酒店体验，热气升腾，日式露天风吕，4k电影质感，慢动作运镜...）"
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <!-- 一键生成实体视频按钮 -->
            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎬 一键生成真实动态视频 (\${pName})</span>
              </button>
            </div>

            <!-- 实体视频行内真实播放器或预览占位 -->
            \${hasGeneratedVideo ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <video src="\${generatedVideoSrc}" controls class="w-full h-full object-cover"></video>
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40 flex items-center gap-1 pointer-events-none">
                  <span>✅ 实体 MP4 视频就绪 (时长: \${durSec}s)</span>
                </div>
              </div>
            \` : \`
              <div class="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-gray-950 via-teal-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between relative overflow-hidden group">
                <div class="flex items-center justify-between">
                  <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">
                    待生成 · 🎬 实体动态视频 (MP4)
                  </span>
                  <span class="text-[9px] text-gray-500 font-mono">1920x1080 · \${durSec}s</span>
                </div>

                <div class="my-auto text-center px-1">
                  <h4 class="text-xs font-bold text-gray-200 line-clamp-2">
                    \${scene.narration_text}
                  </h4>
                  <p class="text-[10px] text-emerald-400/90 mt-1 line-clamp-1 font-mono">
                    \${ppt.custom_prompt ? ('🎯 ' + ppt.custom_prompt) : (kws.length ? ('标志: ' + kws.join(' · ')) : '等待指令')}
                  </p>
                </div>

                <div class="flex items-center justify-between pt-1 border-t border-emerald-500/20 text-[9px] text-emerald-300/70">
                  <span>⚡ 点击上方按钮调用 \${pName} 生成实体视频</span>
                  <span>⏱️ 需 \${durSec}s</span>
                </div>
              </div>
            \`}
          \`;
        } else if (curTargetMode === 'image') {
          // 🖼️ 超写实实景图形态
          innerContent = \`
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">🖼️ 实景图视觉指示词 (FLUX HD):</span>
                <button type="button" id="prompt_btn_\${idx}" onclick="autoGenerateShotPrompt(\${idx}, 'image')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/60 hover:bg-blue-800 text-blue-200 border border-blue-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼超清摄影构图与视觉特征词">
                  ✨ 自动提炼实景词
                </button>
              </div>
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入实景图描述词（如：极简日式露天风吕，水汽氤氲，雪山远景，8k超清写实...）"
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🖼️ 一键生成超清实景图 (\${iName})</span>
              </button>
            </div>

            \${hasPreviewImage ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="\${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="Image Still 1080p" onclick="window.open('\${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ 超清实景图已挂载</span>
                </div>
                <a href="\${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-blue-950/90 hover:bg-blue-600 text-blue-200 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold border border-blue-500/50 flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            \` : \`
              <div class="rounded-xl border border-blue-500/30 bg-gray-950 p-2.5 aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-blue-500/20 text-blue-300 w-fit">待生成 · 超清实景图</span>
                <p class="text-xs text-center text-gray-300 line-clamp-2">\${scene.narration_text}</p>
                <div class="text-[9px] text-blue-300/70 text-center">点击上方按钮由 \${iName} 生成超清实景图</div>
              </div>
            \`}
          \`;
        } else {
          // 📊 动效排版卡片形态
          innerContent = \`
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-gray-400 font-bold whitespace-nowrap">模板:</span>
              <select id="template_select_\${idx}" class="w-full text-[11px] px-2 py-1 rounded-lg bg-gray-900 border border-purple-500/30 text-purple-200 font-semibold focus:outline-none focus:border-purple-400"
                onchange="onSceneVisualTypeChange(\${idx}, this.value)">
                <option value="data_card" \${curVisualType === 'data_card' ? 'selected' : ''}>📊 科技人文大字冲击卡 (DataCard)</option>
                <option value="document_highlight" \${curVisualType === 'document_highlight' ? 'selected' : ''}>📜 典籍史料引文考据卡 (DocHighlight)</option>
                <option value="versus_dual" \${curVisualType === 'versus_dual' ? 'selected' : ''}>⚖️ 核心概念对比双栏卡 (VersusDual)</option>
                <option value="timeline" \${curVisualType === 'timeline' ? 'selected' : ''}>⏱️ 历史时空演进脉络卡 (Timeline)</option>
                <option value="kinetic_text" \${curVisualType === 'kinetic_text' ? 'selected' : ''}>⚡ 动感文字焦点聚光卡 (KineticText)</option>
              </select>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-purple-300 font-bold">📊 卡片排版指导词 (Prompt):</span>
                <button type="button" id="prompt_btn_\${idx}" onclick="autoGenerateShotPrompt(\${idx}, 'card')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/40 transition flex items-center gap-1 shadow-sm" title="根据旁白内容由 AI 视觉总监提炼卡片视觉排版提示">
                  ✨ 自动提炼排版词
                </button>
              </div>
              <textarea id="prompt_input_\${idx}" rows="2" placeholder="输入卡片 Prompt 指导词..."
                class="w-full px-2 py-1.5 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-100 text-[11px] font-mono focus:border-purple-400 focus:outline-none resize-none"
                onchange="onPptThemeEdit(\${idx}, 'custom_prompt', this.value)">\${ppt.custom_prompt || ''}</textarea>
            </div>

            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-gray-400 font-bold whitespace-nowrap">大字:</span>
              <input id="title_input_\${idx}" type="text" value="\${ppt.theme_title || ''}" placeholder="修改核心大字标题..."
                class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-purple-500/30 text-purple-200 font-bold text-[11px] focus:border-purple-400 focus:outline-none"
                onchange="onPptThemeEdit(\${idx}, 'theme_title', this.value)" />
            </div>

            <div class="pt-0.5">
              <button id="gen_btn_\${idx}" onclick="generateRowPpt(\${idx})" class="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:brightness-110 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5">
                <span>🎨 一键由 AI 绘制 PPT 动态卡片 (\${iName})</span>
              </button>
            </div>

            \${hasPreviewImage ? \`
              <div class="rounded-xl border border-emerald-500/60 bg-black aspect-[16/9] relative overflow-hidden group shadow-lg">
                <img src="\${scene.preview_image_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105 cursor-pointer" alt="AI Presentation Card" onclick="window.open('\${scene.preview_image_url}')" />
                <div class="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-black text-emerald-400 border border-emerald-500/40">
                  <span>✅ AI 绘制 PPT 动态卡片 (\${iName})</span>
                </div>
                <a href="\${scene.preview_image_url}" target="_blank" class="absolute top-2 right-2 bg-purple-950/90 hover:bg-purple-600 text-purple-200 hover:text-white px-2 py-0.5 rounded text-[10px] font-bold border border-purple-500/50 flex items-center gap-1 shadow transition z-20">
                  🔍 查看大图
                </a>
              </div>
            \` : \`
              <div class="rounded-xl border border-purple-500/40 bg-gradient-to-br from-gray-950 via-purple-950/20 to-gray-900 p-2.5 shadow-inner aspect-[16/9] flex flex-col justify-between">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-purple-500/25 text-purple-300 w-fit">待生成 · AI PPT 动态卡片</span>
                <div class="my-auto text-center px-1">
                  <h4 class="text-sm font-black text-purple-200">\${mainTitle}</h4>
                  <p class="text-[10px] text-gray-300 mt-1 line-clamp-1">\${subtitle}</p>
                </div>
                <div class="text-[9px] text-purple-300/70 text-center">点击上方按钮由 \${iName} 绘制 16:9 专业 PPT 信息图卡片</div>
              </div>
            \`}
          \`;
        }

        td5.innerHTML = \`
          <div class="space-y-2 \${isAi ? '' : 'opacity-40 pointer-events-none'}">
            <!-- 视觉呈现形态三态切换 -->
            <div class="flex items-center p-0.5 rounded-lg bg-gray-950 border border-gray-800 text-[10px] font-bold">
              <button type="button" onclick="setVisualTarget(\${idx}, 'video')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'video' ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🎬 实体视频
              </button>
              <button type="button" onclick="setVisualTarget(\${idx}, 'image')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'image' ? 'bg-blue-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                🖼️ 超写实图
              </button>
              <button type="button" onclick="setVisualTarget(\${idx}, 'card')"
                class="flex-1 py-1 rounded text-center transition \${curTargetMode === 'card' ? 'bg-purple-600 text-white shadow font-black' : 'text-gray-400 hover:text-gray-200'}">
                📊 动效卡片
              </button>
            </div>

            \${innerContent}
          </div>
        \`;

        // 6. 桌面拖拽放置框 + 在线检验播放器 + 一句话 AI 剪辑
        const td6 = document.createElement('td');
        td6.className = 'p-3';

        const asset = (assetIndexData?.assets || []).find((a) => a.asset_id === scene.final_asset_id);
        const prevScene = idx > 0 ? manifestData.scenes[idx - 1] : null;

        let linkHtml = '';
        if (idx > 0 && prevScene) {
          if (isSharedWithPrev) {
            linkHtml = \`
              <div class="p-1 rounded-lg bg-sky-950/70 border border-sky-500/50 text-[10px] text-sky-300 font-bold flex items-center justify-between gap-1 mb-1.5">
                <span>🔗 连用上一镜头素材</span>
                <button onclick="unlinkScene(\${idx})" class="text-rose-400 hover:text-rose-300 text-xs">✕ 取消</button>
              </div>
            \`;
          } else {
            linkHtml = \`
              <button onclick="linkWithPrevious(\${idx})" class="w-full px-2 py-1 rounded-lg bg-gray-800 hover:bg-sky-600 border border-gray-700 hover:border-sky-400 text-gray-300 hover:text-white text-[10px] font-semibold transition mb-1.5 block">
                🔗 与上一镜头连用 (共用视频)
              </button>
            \`;
          }
        }

        if (asset && scene.source_mode === 'manual_upload') {
          const isVideo = asset.type === 'video' || /\.(mp4|mov|webm)$/i.test(asset.path || '');
          const videoSrc = \`/public/\${activeProjectId}/\${asset.path}\`;

          td6.innerHTML = \`
            <div class="space-y-1.5">
              \${linkHtml}
              <div class="border border-sky-500/40 bg-sky-950/30 rounded-xl p-2.5 text-left space-y-1.5"
                   ondragover="onFileDragOver(event, \${idx})"
                   ondragleave="onFileDragLeave(event, \${idx})"
                   ondrop="onFileDrop(event, \${idx})">
                <div class="flex items-center justify-between">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-sky-500/20 text-sky-300 truncate max-w-[130px]" title="\${asset.file_name || asset.asset_id}">
                    \${asset.file_name || asset.asset_id}
                  </span>
                  <span class="text-[10px] text-emerald-400 font-mono font-bold">
                    ⏱️ 需 \${durSec}s
                  </span>
                </div>

                \${
                  isVideo
                    ? \`
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <video src="\${videoSrc}" controls class="w-full h-full object-contain"></video>
                    </div>
                    <div class="pt-1 space-y-1">
                      <div class="flex items-center gap-1">
                        <input type="text" id="trimInput_\${idx}"
                               placeholder="💬 剪辑指令 (如:从第3秒到第8秒 / 截取前段)"
                               value="\${scene.trim_prompt || ''}"
                               class="w-full px-2 py-1 rounded-lg bg-gray-950 border border-gray-700 text-white text-[10px] focus:border-sky-400 focus:outline-none" />
                        <button onclick="applyAiTrim(\${idx})" class="px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] whitespace-nowrap shadow">
                          ✂️ 截取
                        </button>
                      </div>
                      \${
                        scene.trim_start_sec !== undefined
                          ? \`
                          <div class="text-[10px] text-emerald-400 font-mono flex items-center justify-between">
                            <span>🎯 截取: \${scene.trim_start_sec}s ➔ \${scene.trim_end_sec}s</span>
                            <button onclick="resetTrim(\${idx})" class="text-rose-400 hover:underline">重置</button>
                          </div>
                        \`
                          : ''
                      }
                    </div>
                  \`
                    : \`
                    <div class="rounded-lg overflow-hidden bg-black border border-gray-800 aspect-video flex items-center justify-center">
                      <img src="\${videoSrc}" class="w-full h-full object-cover" />
                    </div>
                  \`
                }

                <div class="flex items-center justify-between pt-1 border-t border-gray-800/80 text-[10px]">
                  <button onclick="document.getElementById('fileInput_\${idx}').click()" class="text-sky-400 hover:underline">
                    从桌面拖入替换
                  </button>
                  <button onclick="clearAsset(\${idx})" class="text-rose-400 hover:underline">
                    清除
                  </button>
                </div>
              </div>
            </div>
          \`;
        } else {
          td6.innerHTML = \`
            <div class="space-y-1.5">
              \${linkHtml}
              <div id="dropzone_\${idx}"
                   class="border-2 border-dashed border-sky-500/40 hover:border-sky-300 bg-sky-950/25 hover:bg-sky-900/35 rounded-xl p-3 text-center transition cursor-pointer group"
                   ondragover="onFileDragOver(event, \${idx})"
                   ondragleave="onFileDragLeave(event, \${idx})"
                   ondrop="onFileDrop(event, \${idx})"
                   onclick="document.getElementById('fileInput_\${idx}').click()">
                <div class="text-sky-300 text-xl mb-1 group-hover:scale-110 transition">📥</div>
                <div class="text-[11px] font-bold text-sky-200">从桌面拖入视频 / 图片</div>
                <div class="text-[10px] text-gray-400 mt-0.5">松开即自动绑定并在线检验</div>
              </div>
            </div>
          \`;
        }

        const hiddenFile = document.createElement('input');
        hiddenFile.type = 'file';
        hiddenFile.id = 'fileInput_' + idx;
        hiddenFile.className = 'hidden';
        hiddenFile.accept = 'video/*,image/*';
        hiddenFile.onchange = (e) => uploadFileForRow(idx, e.target.files[0]);
        td6.appendChild(hiddenFile);

        // 7. 镜头节拍操作列 (切分 & 合并)
        const td7 = document.createElement('td');
        td7.className = 'p-3 text-center';
        td7.innerHTML = \`
          <div class="flex flex-col gap-1.5">
            <button onclick="splitShotPrompt(\${idx})" class="w-full px-2 py-1.5 rounded-lg bg-purple-600/25 hover:bg-purple-600 border border-purple-500/40 text-purple-200 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm">
              <span>✂️ 切分</span>
            </button>
            \${
              idx < (manifestData.scenes.length - 1)
                ? \`<button onclick="mergeShotWithNext(\${idx})" class="w-full px-2 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/40 text-emerald-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm">
                    <span>🔗 合并</span>
                  </button>\`
                : ''
            }
          </div>
        \`;

        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);
        tr.appendChild(td6);
        tr.appendChild(td7);
        tbody.appendChild(tr);
      });
    }

    function onFileDragOver(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.add('dropzone-hover');
    }

    function onFileDragLeave(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');
    }

    function onFileDrop(e, idx) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.getElementById('dropzone_' + idx) || e.currentTarget;
      el.classList.remove('dropzone-hover');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        manifestData.scenes[idx].source_mode = 'manual_upload';
        uploadFileForRow(idx, file);
      }
    }

    async function applyAiTrim(idx) {
      const scene = manifestData.scenes[idx];
      const input = document.getElementById('trimInput_' + idx);
      const promptText = input ? input.value.trim() : '';

      if (!promptText) {
        alert('请输入剪辑指令，例如：“从第3秒到第8秒” 或 “取前5秒”');
        return;
      }

      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: promptText,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✨ ' + data.message);
      } else {
        alert(data.error || '剪辑失败');
      }
    }

    async function resetTrim(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/trim-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
          prompt: '从0秒开始',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('↺ 已重置截取范围');
      }
    }

    async function clearAsset(idx) {
      const scene = manifestData.scenes[idx];
      const res = await fetch('/api/clear-asset?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneId: scene.scene_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('已清除当前镜头素材绑定');
      }
    }

    async function splitShotPrompt(idx) {
      const scene = manifestData.scenes[idx];
      const text = scene.narration_text || '';
      
      const defaultSplit = prompt(
        \`【方案 A 镜头切分】当前镜头时长 \${(scene.duration_ms/1000).toFixed(1)}s：\\n\"\${text}\"\\n\\n请输入第一段要保留的文字（留空将自动在中间逗号处一分为二）：\`,
        ''
      );

      if (defaultSplit === null) return;

      let splitCharIndex = undefined;
      if (defaultSplit.trim()) {
        const found = text.indexOf(defaultSplit.trim());
        if (found !== -1) {
          splitCharIndex = found + defaultSplit.trim().length;
        }
      }

      const res = await fetch('/api/split-shot?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
          splitCharIndex,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✂️ ' + data.message);
      } else {
        alert(data.error || '切分失败');
      }
    }

    async function mergeShotWithNext(idx) {
      const s1 = manifestData.scenes[idx];
      const s2 = manifestData.scenes[idx + 1];
      if (!confirm(\`确认将 \${s1.scene_id} 与 \${s2.scene_id} 合并为一个视觉镜头吗？\\n合并后总时长约为 \${((s1.duration_ms + s2.duration_ms)/1000).toFixed(1)} 秒。\`)) {
        return;
      }

      const res = await fetch('/api/merge-shot?project=' + activeProjectId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          sceneIndex: idx,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('🔗 ' + data.message);
      } else {
        alert(data.error || '合并失败');
      }
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
      renderTable();
    }

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

    async function onSceneVisualTypeChange(idx, val) {
      if (!manifestData.scenes[idx]) return;
      manifestData.scenes[idx].visual_type = val;
      if (!manifestData.scenes[idx].ppt_slide_spec) {
        manifestData.scenes[idx].ppt_slide_spec = {};
      }
      manifestData.scenes[idx].ppt_slide_spec.template_style = val;
      // 随着模板选项选择不同，对应的卡片排列、排版指导词自动同步变化并提炼
      await autoGenerateShotPrompt(idx, 'card', val);
      showToast('🎨 镜头 ' + manifestData.scenes[idx].scene_id + ' 模板已切换为: ' + val + '，排版指导词已自动适配！');
    }

    function extractLocalSmartPrompt(narrationText, targetMode, keywords, templateStyle) {
      if (!narrationText) return '';
      const raw = narrationText.trim();
      const kwList = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

      let cleaned = raw
        .replace(/^(在|顺着|沿着|当|经过|据|由于|因为|为了|根据)[^，,。；;]{1,15}[，,]/g, '')
        .replace(/^(有一条|坐落着|迎面出现的却是|映入眼帘的是|矗立着|车辆必须|这就是|可以说|事实上|实际上)/g, '')
        .replace(/[，,。；;！!？?]+$/g, '')
        .trim();

      if (cleaned.length < 4) cleaned = raw.replace(/[，,。；;！!？?]+$/g, '');

      const mainSubject = kwList.length > 0 ? kwList[0] : (cleaned.length > 25 ? cleaned.slice(0, 25) : cleaned);
      const contextDesc = cleaned;

      let cameraMove = '平稳推镜头向前聚焦';
      if (/转弯|急弯|弯道|穿行|盘山|环绕/.test(raw)) {
        cameraMove = '大范围航拍连续弧形环绕跟随';
      } else if (/落差|悬崖|山峰|俯瞰|冲上|高度|海拔/.test(raw)) {
        cameraMove = '高空俯冲推拉运镜转开阔全景';
      } else if (/细节|金箔|雕刻|纹理|双眼|双手|微观|精细|古老|建筑/.test(raw)) {
        cameraMove = '慢速微距浅景深焦点平移特写';
      } else if (/穿过|延伸|漫步|走入|深入/.test(raw)) {
        cameraMove = '第一人称低角度正前向稳定推进运镜';
      }

      if (targetMode === 'video') {
        return '【镜头主体】' + mainSubject + '，画面展现「' + contextDesc + '」；【运镜设计】' + cameraMove + '；【光影与质感】自然光影真实漫反射，丰富环境层次，电影级光学动态细节';
      } else if (targetMode === 'image') {
        return '【摄影构图】大师级构图定格「' + mainSubject + '」，核心视觉细节：' + contextDesc + '；【材质与光线】微米级物理材质纹理特写，真实环境自然光漫射，8K顶级摄影画质，无杂乱文字';
      } else {
        const title = mainSubject.length > 10 ? mainSubject.slice(0, 8) : mainSubject;
        if (templateStyle === 'document_highlight') {
          return '【文献考据】「' + title + '」\\n【核心引录】“' + contextDesc + '”\\n【考据重点】金石文献与建筑工艺考据\\n【版式视觉】16:9 古典金石史料信息图卡片，和风古典深色肌理，金箔反光点缀，典雅宣纸书卷排版风格，博物馆展签级';
        } else if (templateStyle === 'versus_dual') {
          return '【核心辩题】「' + title + '」\\n【传统认知】既往常态定式阐述\\n【颠覆突破】全新机制与核心突破\\n【版式视觉】16:9 对比双栏Keynote信息图卡片，左右对称深色信息容器，冷蓝与渐变紫双色对比辉光，极简数据对撞排版';
        } else if (templateStyle === 'timeline') {
          return '【演进主线】「' + title + '」\\n【阶段推进】阶段01关键转折 ➔ 阶段02演进里程碑\\n【版式视觉】16:9 历史时空演进路线图卡片，发光连接轴线，阶段卡片发光边框，现代信息图表极简科技排版';
        } else if (templateStyle === 'kinetic_text') {
          return '【聚光焦点】「' + title + '」\\n【视觉递进】层层展开的递进阐述短句\\n【版式视觉】16:9 视觉冲击排版海报卡片，特大号粗体文字层级，径向聚光灯深色氛围，极简高张力视觉平面设计';
        } else {
          return '【核心大字】「' + title + '」\\n【副级阐述】' + contextDesc + '\\n【排版重点】突出核心论据与工艺细节\\n【版式视觉】16:9 现代暗色高阶演说PPT信息图卡片，微光磨砂玻璃容器，金珀与深蓝氛围光晕，顶级平面设计排版';
        }
      }
    }

    async function autoGenerateShotPrompt(idx, targetMode, templateStyle) {
      const scene = manifestData.scenes[idx];
      if (!scene) return;
      const mode = targetMode || scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
      const curTemplate = templateStyle || scene.ppt_slide_spec?.template_style || scene.visual_type || 'data_card';
      const btn = document.getElementById('prompt_btn_' + idx);
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 提炼中...</span>';
      }

      try {
        const res = await fetch('/api/extract-prompt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            narrationText: scene.narration_text,
            targetMode: mode,
            keywords: scene.keywords || scene.content_keywords || [],
            templateStyle: curTemplate
          })
        });
        const data = await res.json();
        const generated = data.prompt || extractLocalSmartPrompt(scene.narration_text, mode, scene.keywords || scene.content_keywords, curTemplate);
        if (!scene.ppt_slide_spec) scene.ppt_slide_spec = {};
        scene.ppt_slide_spec.custom_prompt = generated;

        const input = document.getElementById('prompt_input_' + idx);
        if (input) {
          input.value = generated;
          input.classList.add('ring-2', 'ring-purple-400');
          setTimeout(() => input.classList.remove('ring-2', 'ring-purple-400'), 1000);
        }
        showToast('✨ [' + (data.usedModel || 'AI智能提炼') + '] 提示词已更新！');
      } catch (err) {
        const fallback = extractLocalSmartPrompt(scene.narration_text, mode, scene.keywords || scene.content_keywords, curTemplate);
        if (!scene.ppt_slide_spec) scene.ppt_slide_spec = {};
        scene.ppt_slide_spec.custom_prompt = fallback;
        const input = document.getElementById('prompt_input_' + idx);
        if (input) input.value = fallback;
        showToast('✨ [本地规则] 提示词已更新！');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    async function autoGenerateAllPromptsForPage() {
      if (!manifestData || !manifestData.scenes) return;
      const total = manifestData.scenes.length;
      showToast('🚀 正在由 AI 视觉总监并发提炼全页 ' + total + ' 个镜头的指示词，请稍候...');

      const promises = manifestData.scenes.map(async (sc, idx) => {
        const mode = sc.target_visual_mode || (sc.visual_type === 'broll_video' ? 'video' : sc.visual_type === 'photo_motion' ? 'image' : 'video');
        const tmpl = sc.visual_type || 'data_card';
        try {
          const res = await fetch('/api/extract-prompt?project=' + activeProjectId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: activeProjectId,
              narrationText: sc.narration_text,
              targetMode: mode,
              keywords: sc.keywords || sc.content_keywords || [],
              templateStyle: tmpl
            })
          });
          const data = await res.json();
          const generated = data.prompt || extractLocalSmartPrompt(sc.narration_text, mode, sc.keywords || sc.content_keywords, tmpl);
          if (!sc.ppt_slide_spec) sc.ppt_slide_spec = {};
          sc.ppt_slide_spec.custom_prompt = generated;
          const input = document.getElementById('prompt_input_' + idx);
          if (input) input.value = generated;
        } catch (e) {
          const fallback = extractLocalSmartPrompt(sc.narration_text, mode, sc.keywords || sc.content_keywords, tmpl);
          if (!sc.ppt_slide_spec) sc.ppt_slide_spec = {};
          sc.ppt_slide_spec.custom_prompt = fallback;
          const input = document.getElementById('prompt_input_' + idx);
          if (input) input.value = fallback;
        }
      });

      await Promise.all(promises);
      renderTable();
      showToast('🎉 全页 ' + total + ' 个镜头的指示词已全部提炼完成！');
    }

    function setVisualTarget(idx, mode) {
      if (!manifestData.scenes[idx]) return;
      const sc = manifestData.scenes[idx];
      sc.target_visual_mode = mode;
      if (mode === 'card') {
        const validCards = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
        if (!validCards.includes(sc.visual_type)) {
          sc.visual_type = 'data_card';
          sc.scene_type = 'data_card';
        }
      }
      if (!sc.ppt_slide_spec) {
        sc.ppt_slide_spec = {};
      }
      if (!sc.ppt_slide_spec.custom_prompt) {
        sc.ppt_slide_spec.custom_prompt = extractLocalSmartPrompt(sc.narration_text, mode, sc.keywords || sc.content_keywords, sc.visual_type || 'data_card');
      }
      renderTable();
      showToast('🎯 镜头 ' + sc.scene_id + ' 视觉形式已切换为: ' + (mode === 'video' ? '🎬 实体视频 (MP4)' : mode === 'image' ? '🖼️ 超写实图' : '📊 AI 动态卡片'));
    }

    async function generateRowPpt(idx) {
      const scene = manifestData.scenes[idx];
      const targetMode = scene.target_visual_mode || (scene.visual_type === 'broll_video' ? 'video' : scene.visual_type === 'photo_motion' ? 'image' : 'video');
      const btn = document.getElementById('gen_btn_' + idx);
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 正在请求 AI 引擎生成' + (targetMode === 'video' ? '真实实体视频 (约 20~40 秒)' : targetMode === 'image' ? '超清实景图' : 'AI 动态卡片大片') + '...</span>';
      }

      const promptInput = document.getElementById('prompt_input_' + idx);
      const titleInput = document.getElementById('title_input_' + idx);
      const customPrompt = promptInput ? promptInput.value : (scene.ppt_slide_spec?.custom_prompt || '');
      const themeTitle = titleInput ? titleInput.value : (scene.ppt_slide_spec?.theme_title || '');
      const globalPrompt = document.getElementById('globalPromptInput').value;

      const validCards = ['data_card', 'document_highlight', 'versus_dual', 'timeline', 'kinetic_text'];
      const templateEl = document.getElementById('template_select_' + idx);
      const chosenTemplate = templateEl ? templateEl.value : scene.visual_type;
      const effectiveTemplate = (targetMode === 'card')
        ? (validCards.includes(chosenTemplate) ? chosenTemplate : 'data_card')
        : (scene.visual_type || 'broll_video');

      try {
        const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: scene.scene_id,
            visualTarget: targetMode,
            globalPrompt,
            customPrompt,
            themeTitle,
            templateStyle: effectiveTemplate,
            manifest: manifestData,
            selectedModel: visualConfig.videoModel,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          await loadWorkflow();
          showToast('✨ ' + (data.message || ('镜头 ' + scene.scene_id + ' 画面生成成功！')));
        } else {
          showToast('❌ 生成失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    async function generateAllPpt() {
      const globalPrompt = document.getElementById('globalPromptInput').value;
      showToast('⚡ 正在批量渲染 AI 画面...');
      try {
        const res = await fetch('/api/generate-ppt?project=' + activeProjectId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: null,
            visualTarget: 'card',
            globalPrompt,
            manifest: manifestData,
            selectedModel: visualConfig.videoModel,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          manifestData = data.manifest;
          await loadWorkflow();
          showToast('⚡ 已批量完成 AI 卡片画面渲染与生成！');
        } else {
          showToast('❌ 批量生成失败: ' + (data.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 批量请求异常: ' + err.message);
      }
    }

    async function uploadFileForRow(idx, file) {
      if (!file) return;
      const scene = manifestData.scenes[idx];
      showToast('⏳ 正在上传并检验 ' + file.name + ' ...');
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
          showToast('✅ 成功绑定素材并进入检验模式！');
        } else {
          alert(data.error || '上传失败');
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
            selected_visual_model: visualConfig.videoModel,
            global_ai_visual_prompt: globalPrompt,
            updated_at: new Date().toISOString(),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        manifestData = data.manifest;
        renderTable();
        showToast('✅ 已保存镜头表格，并同步至 Remotion 视频引擎！');
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

    // 🪐 5 大模型预设快捷切换
    function applyModelPreset(type) {
      const bEl = document.getElementById('currentBaseUrlInput');
      const vEl = document.getElementById('currentVideoModelInput');
      const tEl = document.getElementById('currentTextModelInput');
      const iEl = document.getElementById('currentImageModelInput');
      const bgmEl = document.getElementById('currentBgmModelInput');
      const kEl = document.getElementById('currentApiKeyInput');

      if (type === 'antigravity-dev') {
        if (kEl) kEl.value = 'antigravity-local-dev';
        if (bEl) bEl.value = 'http://localhost:4000/api/dev (本地 Antigravity 免Key引擎)';
        if (vEl) vEl.value = 'remotion-procedural-motion';
        if (tEl) tEl.value = 'antigravity-gemini-director';
        if (iEl) iEl.value = 'antigravity-flux-image';
        if (bgmEl) bgmEl.value = 'antigravity-bgm-analyzer';
        showToast('🎉 已载入【Antigravity 本地免 Key 开发模式】！开发期零 API 费用！');
      } else if (type === 'gemini') {
        if (bEl) bEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai';
        if (vEl) vEl.value = 'veo-2.0-generate-001';
        if (tEl) tEl.value = 'gemini-flash-lite-latest';
        if (iEl) iEl.value = 'imagen-3.0-generate-002';
        if (bgmEl) bgmEl.value = 'gemini-flash-lite-latest';
        showToast('🪐 已载入【Google AI Studio 官方 Gemini 全家桶】预设！');
      } else if (type === 'gemini-pro') {
        if (bEl) bEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai';
        if (vEl) vEl.value = 'veo-2.0-generate-001';
        if (tEl) tEl.value = 'gemini-flash-lite-latest';
        if (iEl) iEl.value = 'imagen-3.0-generate-002';
        if (bgmEl) bgmEl.value = 'gemini-flash-lite-latest';
        showToast('💎 已载入【Google Gemini 官方深度通道】预设！');
      } else if (type === 'openrouter-fast') {
        if (bEl) bEl.value = 'https://openrouter.ai/api/v1';
        if (vEl) vEl.value = 'minimax/hailuo-3-max';
        if (tEl) tEl.value = 'deepseek/deepseek-chat';
        if (iEl) iEl.value = 'black-forest-labs/flux-3-image';
        if (bgmEl) bgmEl.value = 'deepseek/deepseek-chat';
        showToast('🚀 已载入【OpenRouter 混合高性价比】预设！');
      } else if (type === 'antigravity-local') {
        if (bEl) bEl.value = 'http://127.0.0.1:51000/v1beta';
        if (tEl) tEl.value = 'gemini-2.5-pro';
        if (vEl) vEl.value = 'google/veo-2';
        if (iEl) iEl.value = 'imagen-3.0-generate-002';
        if (bgmEl) bgmEl.value = 'gemini-2.5-flash';
        showToast('🧪 已载入【本地 Antigravity 模型网关】预设！');
      }
    }

    // 🛠️ Antigravity 调试副驾驶逻辑 (开发态特有)
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function toggleDevCopilot() {
      const drawer = document.getElementById('devCopilotDrawer');
      if (drawer) {
        drawer.classList.toggle('hidden');
      }
    }

    async function runDevAudit() {
      const msgBox = document.getElementById('devChatMessages');
      if (!msgBox) return;

      const tempId = 'audit-' + Date.now();
      msgBox.innerHTML += \`
        <div id="\${tempId}" class="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs flex items-center gap-2">
          <span class="animate-spin">⏳</span>
          <span>正在执行分镜视听节奏与多模态自动化体检...</span>
        </div>
      \`;
      msgBox.scrollTop = msgBox.scrollHeight;

      try {
        const res = await fetch('/api/dev/audit?project=' + activeProjectId);
        const data = await res.json();
        const tempEl = document.getElementById(tempId);

        if (data.ok && data.report) {
          const r = data.report;
          const issuesHtml = r.issues.length > 0
            ? r.issues.map(i => \`<li class="text-amber-300">⚠️ \${escapeHtml(i)}</li>\`).join('')
            : '<li class="text-emerald-300">✅ 未发现明显节奏或结构问题</li>';
          const suggHtml = r.suggestions.map(s => \`<li class="text-cyan-200">💡 \${escapeHtml(s)}</li>\`).join('');

          const resultHtml = \`
            <div class="p-3.5 rounded-xl bg-gray-900 border border-cyan-500/40 space-y-2.5 shadow-lg">
              <div class="flex items-center justify-between border-b border-gray-800 pb-2">
                <span class="font-black text-cyan-300 text-xs">🩺 分镜体检报告</span>
                <span class="px-2 py-0.5 rounded font-black text-xs \${r.score >= 80 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}">
                  综合评分: \${r.score}分
                </span>
              </div>
              <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-300">
                <div>镜头总数：<b>\${r.totalScenes} 镜</b></div>
                <div>全片预估时长：<b>\${r.totalDurationSec} 秒</b></div>
              </div>
              <div class="text-[11px] space-y-1">
                <div class="font-bold text-gray-300">检测发现：</div>
                <ul class="list-disc list-inside space-y-0.5 pl-1">\${issuesHtml}</ul>
              </div>
              <div class="text-[11px] space-y-1 pt-1 border-t border-gray-800">
                <div class="font-bold text-cyan-400">导演调优建议：</div>
                <ul class="list-disc list-inside space-y-0.5 pl-1">\${suggHtml}</ul>
              </div>
            </div>
          \`;
          if (tempEl) tempEl.outerHTML = resultHtml;
        } else {
          if (tempEl) tempEl.innerHTML = \`<span class="text-red-400">体检失败: \${escapeHtml(data.error || '未知错误')}</span>\`;
        }
      } catch (e) {
        const tempEl = document.getElementById(tempId);
        if (tempEl) tempEl.innerHTML = \`<span class="text-red-400">请求异常: \${escapeHtml(e.message)}</span>\`;
      }
      msgBox.scrollTop = msgBox.scrollHeight;
    }

    async function sendDevChat() {
      const input = document.getElementById('devChatInput');
      const msgBox = document.getElementById('devChatMessages');
      const btn = document.getElementById('btnSendDevChat');
      if (!input || !msgBox) return;

      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      msgBox.innerHTML += \`
        <div class="flex justify-end">
          <div class="max-w-[85%] px-3 py-2 rounded-xl bg-cyan-600 text-white text-xs font-medium shadow">
            \${escapeHtml(text)}
          </div>
        </div>
      \`;
      msgBox.scrollTop = msgBox.scrollHeight;

      const tempId = 'reply-' + Date.now();
      msgBox.innerHTML += \`
        <div id="\${tempId}" class="flex items-center gap-2 p-2.5 rounded-xl bg-gray-900 border border-gray-800 text-gray-400 text-xs">
          <span class="animate-spin">⏳</span>
          <span>Gemini 调试助手正在深度思考...</span>
        </div>
      \`;
      msgBox.scrollTop = msgBox.scrollHeight;
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/dev/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            prompt: text
          })
        });
        const data = await res.json();
        const tempEl = document.getElementById(tempId);

        if (data.ok) {
          let patchBtnHtml = '';
          if (data.patchAction && data.patchAction.scene_id) {
            const patchJsonStr = encodeURIComponent(JSON.stringify(data.patchAction));
            patchBtnHtml = \`
              <div class="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between">
                <span class="text-[11px] text-cyan-300 font-bold">🎯 包含镜头 Patch 方案 (\${escapeHtml(data.patchAction.scene_id)})</span>
                <button type="button" onclick="applyDevPatch('\${patchJsonStr}')" class="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-gray-950 font-black text-[11px] transition">
                  ⚡ 一键应用至工程
                </button>
              </div>
            \`;
          }

          const formattedReply = escapeHtml(data.reply).replace(/\\n/g, '<br/>');
          const botHtml = \`
            <div class="p-3 rounded-xl bg-gray-900 border border-gray-800 text-gray-200 text-xs space-y-1">
              <div class="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                <span class="text-cyan-400 font-bold">🤖 Gemini 调试建议</span>
                <span>模型: \${data.usedModel ? escapeHtml(data.usedModel.split('/').pop()) : 'Gemini'}</span>
              </div>
              <div>\${formattedReply}</div>
              \${patchBtnHtml}
            </div>
          \`;
          if (tempEl) tempEl.outerHTML = botHtml;
        } else {
          if (tempEl) tempEl.outerHTML = \`<div class="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs">❌ 错误: \${escapeHtml(data.error || '请求失败')}</div>\`;
        }
      } catch (e) {
        const tempEl = document.getElementById(tempId);
        if (tempEl) tempEl.outerHTML = \`<div class="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs">❌ 连接异常: \${escapeHtml(e.message)}</div>\`;
      } finally {
        if (btn) btn.disabled = false;
        msgBox.scrollTop = msgBox.scrollHeight;
      }
    }

    async function applyDevPatch(patchJsonStr) {
      try {
        const actionObj = JSON.parse(decodeURIComponent(patchJsonStr));
        const res = await fetch('/api/dev/apply-patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            sceneId: actionObj.scene_id,
            patch: actionObj.patch
          })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('⚡ 已成功将 Gemini 调试建议 Patch 应用到镜头：' + actionObj.scene_id);
          loadWorkflow();
        } else {
          alert('应用 Patch 失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        alert('解析或应用 Patch 异常: ' + e.message);
      }
    }

    function sendDevQuickPrompt(promptText) {
      const input = document.getElementById('devChatInput');
      if (input) {
        input.value = promptText;
        sendDevChat();
      }
    }

    loadProjects().then(() => {
      loadWorkflow();
      if (currentWorkspaceTab === 'writer') {
        switchWorkspaceTab('writer');
      }
    });
  </script>

  <!-- 🛠️ Antigravity 调试副驾驶 (Gemini 生态 / Dev Mode) 浮动抽屉与气泡 -->
  <div id="devCopilotContainer" class="fixed bottom-6 right-6 z-40 flex flex-col items-end pointer-events-none">
    <!-- 展开后的对话抽屉窗 -->
    <div id="devCopilotDrawer" class="hidden pointer-events-auto mb-3 w-[450px] max-w-[calc(100vw-32px)] h-[560px] max-h-[82vh] bg-gray-950/95 backdrop-blur-xl border border-cyan-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200">
      <!-- 窗口顶部标题栏 -->
      <div class="px-4 py-3 bg-gradient-to-r from-gray-900 via-cyan-950/40 to-gray-900 border-b border-cyan-500/30 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">🤖</span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-white">Antigravity 调试副驾驶</span>
              <span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">Gemini Dev</span>
            </div>
            <p class="text-[10px] text-gray-400">调试期实时诊断、提示词润色与分镜 Patch</p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="toggleDevCopilot()" class="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white text-xs">✕</button>
        </div>
      </div>

      <!-- 快捷动作工具栏 -->
      <div class="px-3 py-2 bg-gray-900/60 border-b border-gray-800/80 flex items-center gap-1.5 overflow-x-auto text-[11px]">
        <button type="button" onclick="runDevAudit()" class="shrink-0 px-2.5 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30 font-bold transition flex items-center gap-1">
          🩺 诊断分镜节奏
        </button>
        <button type="button" onclick="sendDevQuickPrompt('请分析当前分镜的视觉形式分布，并建议如何搭配卡片模板与实景生图')" class="shrink-0 px-2.5 py-1 rounded-lg bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-500/30 font-bold transition">
          📐 卡片搭配建议
        </button>
        <button type="button" onclick="sendDevQuickPrompt('请检查所有镜头的生图提示词，帮我润色更有画面感、更符合16:9纪录片的视觉描述')" class="shrink-0 px-2.5 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border border-purple-500/30 font-bold transition">
          ✨ 润色提示词
        </button>
      </div>

      <!-- 消息列表与体检卡片区域 -->
      <div id="devChatMessages" class="flex-1 p-4 overflow-y-auto space-y-3 text-xs leading-relaxed">
        <div class="p-3 rounded-xl bg-gray-900/90 border border-gray-800 text-gray-300 space-y-1.5">
          <div class="flex items-center gap-1.5 text-cyan-400 font-bold text-[11px]">
            <span>💡 调试副驾驶已挂载</span>
          </div>
          <p class="text-[11px] text-gray-300">
            我是为 WhyVideo 打造的 Gemini 调试副驾驶。在调试期，我可以实时读取当前工程的解说词、分镜清单与卡片结构。您可以直接在此提问、审查镜头或让我调优分镜！
          </p>
          <div class="text-[10px] text-gray-400 pt-1 border-t border-gray-800/80">
            🛠️ <b>剥离说明</b>：调试完成后，移除 <code class="text-cyan-300">packages/qc-tools/dev-bridge.mjs</code> 即可完全回到纯 API 生产版。
          </div>
        </div>
      </div>

      <!-- 底部输入栏 -->
      <div class="p-2.5 bg-gray-900 border-t border-gray-800 space-y-2">
        <div class="flex items-center gap-2">
          <input type="text" id="devChatInput" placeholder="输入调试需求，例如：帮我把第3镜改为数据对比卡片..."
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-gray-950 border border-gray-700 text-white focus:outline-none focus:border-cyan-400 placeholder:text-gray-500"
            onkeydown="if(event.key === 'Enter' && !event.shiftKey) sendDevChat();" />
          <button id="btnSendDevChat" onclick="sendDevChat()" class="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition flex items-center gap-1 shadow-lg shadow-cyan-600/30">
            <span>发送</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 浮动胶囊入口按钮 -->
    <button onclick="toggleDevCopilot()" id="devCopilotFloatingBtn"
      class="pointer-events-auto px-4 py-2.5 rounded-full bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 text-white font-bold text-xs shadow-2xl hover:scale-105 active:scale-95 transition flex items-center gap-2 border border-cyan-400/40">
      <span class="animate-pulse">🤖</span>
      <span>Antigravity 调试副驾驶</span>
      <span class="px-1.5 py-0.2 rounded-full text-[9px] bg-black/40 text-cyan-200">Gemini</span>
    </button>
  </div>
</body>
</html>`;
}
