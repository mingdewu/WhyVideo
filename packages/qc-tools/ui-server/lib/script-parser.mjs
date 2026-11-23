import fs from 'fs';
import path from 'path';
import { rootDir, getPaths } from './config.mjs';
import { recompileProject } from './project-store.mjs';
import { refreshSceneKeywordMetadata } from '../../cut-planner.mjs';

export function scanLocalExportScripts() {
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

export function parseScriptToScenes(content, { projectId = 'why_project_001', title = '', targetSeconds = 5.5 } = {}) {
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
            const rawTitle = String(ch.chapter_title || '').trim();
            const prefixRegex = new RegExp(`^第\\s*${ch.chapter_number || '\\d+'}\\s*章\\s*[:：]?\\s*`);
            const cleanTitle = rawTitle.replace(prefixRegex, '').trim();
            const isSpecialTitle = /^(?:开篇|开场|导引|引言|单片终局|全片终局|全片唯一|终局|结尾|收尾)/.test(cleanTitle);
            const displayTitle = !rawTitle
              ? `第${ch.chapter_number || ''}章`
              : isSpecialTitle || /^第\s*\d+\s*章/.test(cleanTitle)
                ? cleanTitle
                : `第${ch.chapter_number || ''}章: ${cleanTitle}`;
            chapters.push({
              chapterTitle: displayTitle,
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

    const chapterHeaderRegex = /^[ \t]*(?:[#=*-]{2,}\s*)?(?:【)?\s*(开篇[^\n】]*|开场[^\n】]*|导[言读][^\n】]*|引言[^\n】]*|第\s*\d+\s*章[^\n=】]*|第\s*[一二三四五六七八九十百]+\s*章[^\n=】]*|全片终局[^\n】]*|全片唯一[^\n】]*|终局收尾[^\n】]*|结[尾局][^\n】]*|single_final_ending[^\n】]*)(?:】)?\s*(?:[#=*-]{2,})?$/i;

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

    let kw = text.replace(/^[“"‘'（(【\[\s]+/, '').split(/[，。！？!?、；：]/)[0].replace(/[“”"’'）)】\]\s]/g, '').slice(0, 6);
    if (!kw || kw.length < 2) kw = chTitle.slice(0, 6) || '核心观点';

    const newScene = {
      scene_id: `Shot-${String(idx + 1).padStart(3, '0')}`,
      scene_index: idx + 1,
      chapter_ref: chTitle,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: dur,
      visual_type: 'broll_video',
      source_mode: 'manual_upload',
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
      status: 'NEEDS_HUMAN_ASSET',
      final_asset_id: null,
      human_review_required: false,
    };
    refreshSceneKeywordMetadata(newScene);
    scenes.push(newScene);
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

  let segOpening = '';
  let segEnding = '';
  let bodyChapters = [...chapters];
  if (bodyChapters.length > 2) {
    const firstTitle = String(bodyChapters[0].chapterTitle || '').replace(/^第\s*\d+\s*章\s*[:：]?\s*/, '').trim();
    if (/^(?:开篇|开场|导引|导读|引言)/.test(firstTitle)) {
      segOpening = bodyChapters.shift().text;
    }
    const lastTitle = String(bodyChapters[bodyChapters.length - 1]?.chapterTitle || '').replace(/^第\s*\d+\s*章\s*[:：]?\s*/, '').trim();
    if (bodyChapters.length > 1 && /^(?:单片终局|全片终局|全片唯一|终局|结尾|收尾|结局)/.test(lastTitle)) {
      segEnding = bodyChapters.pop().text;
    }
  }

  const finalScript = {
    project_id: detectedProjectId,
    title: detectedTitle,
    total_word_count: totalWords,
    estimated_duration_minutes: estimatedMinutes,
    revision_count: 0,
    script_segments: {
      ...(segOpening ? { opening: segOpening } : {}),
      chapters: bodyChapters.map((c, i) => {
        const cleanTitle = String(c.chapterTitle || '')
          .replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '')
          .trim();
        return {
          chapter_number: i + 1,
          chapter_title: cleanTitle ? `第${i + 1}章: ${cleanTitle}` : `第${i + 1}章`,
          narration_text: c.text,
        };
      }),
      ...(segEnding ? { ending: segEnding } : {}),
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

export function createProjectFromScript({ projectId, title, content, targetSeconds = 5.5 }) {
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


export function buildVirtualChapterSections(text) {
  const clean = String(text || '').trim();
  if (!clean) {
    return {
      '1_question_or_contradiction': '',
      '2_mechanism_or_background': '',
      '3_sourced_concrete_examples': '',
      '4_mini_summary_and_transition': '',
    };
  }
  const paragraphs = clean.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 4) {
    const q1 = Math.max(1, Math.floor(paragraphs.length * 0.2));
    const q2 = Math.max(q1 + 1, Math.floor(paragraphs.length * 0.5));
    const q3 = Math.max(q2 + 1, Math.floor(paragraphs.length * 0.8));
    return {
      '1_question_or_contradiction': paragraphs.slice(0, q1).join('\n\n'),
      '2_mechanism_or_background': paragraphs.slice(q1, q2).join('\n\n'),
      '3_sourced_concrete_examples': paragraphs.slice(q2, q3).join('\n\n'),
      '4_mini_summary_and_transition': paragraphs.slice(q3).join('\n\n'),
    };
  }
  const sentences = clean.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 4) {
    const s1 = Math.max(1, Math.floor(sentences.length * 0.25));
    const s2 = Math.max(s1 + 1, Math.floor(sentences.length * 0.5));
    const s3 = Math.max(s2 + 1, Math.floor(sentences.length * 0.75));
    return {
      '1_question_or_contradiction': sentences.slice(0, s1).join(''),
      '2_mechanism_or_background': sentences.slice(s1, s2).join(''),
      '3_sourced_concrete_examples': sentences.slice(s2, s3).join(''),
      '4_mini_summary_and_transition': sentences.slice(s3).join(''),
    };
  }
  return {
    '1_question_or_contradiction': clean,
    '2_mechanism_or_background': '',
    '3_sourced_concrete_examples': '',
    '4_mini_summary_and_transition': '',
  };
}

export function getFinalScriptRawText(finalScript) {
  if (!finalScript) return '';
  if (typeof finalScript === 'string') return finalScript;
  if (finalScript.script_segments) {
    const parts = [];
    if (finalScript.script_segments.opening) parts.push(finalScript.script_segments.opening);
    if (Array.isArray(finalScript.script_segments.chapters)) {
      for (const ch of finalScript.script_segments.chapters) {
        if (ch.narration_text) parts.push(ch.narration_text);
      }
    }
    if (finalScript.script_segments.ending) parts.push(finalScript.script_segments.ending);
    if (parts.length > 0) return parts.join('\n\n');
  }
  if (finalScript.full_narration_text) return finalScript.full_narration_text;
  if (Array.isArray(finalScript.approved_narration_sentences)) {
    return finalScript.approved_narration_sentences.join('\n');
  }
  if (finalScript.content) return finalScript.content;
  return '';
}

export function parseMarkdownToScriptSegments(mdText, fallbackTitle = '完整正文') {
  const lines = String(mdText || '').replace(/\r\n/g, '\n').split('\n');
  let opening = '';
  let ending = '';
  const chapters = [];
  let currentType = null;
  let currentTitle = '';
  let currentNum = 0;
  let buf = [];

  const flush = () => {
    const body = buf
      .join('\n')
      .replace(/^---\s*$/gm, '')
      .trim();
    buf = [];
    if (!body) return;
    if (currentType === 'opening') {
      opening = opening ? `${opening}\n\n${body}` : body;
    } else if (currentType === 'ending') {
      ending = ending ? `${ending}\n\n${body}` : body;
    } else if (currentType === 'chapter') {
      chapters.push({
        chapter_number: currentNum || chapters.length + 1,
        chapter_title: currentTitle || `第${chapters.length + 1}章`,
        narration_text: body,
      });
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      const rawHeader = h2[1].trim();
      const cleanHeader = rawHeader.replace(/^【([^】]+)】\s*/, '$1 ').trim();
      if (/^(?:开篇|开场|导[言读]|引言)/.test(cleanHeader)) {
        currentType = 'opening';
        currentTitle = cleanHeader;
      } else if (/^(?:结[尾局]|终局|全片终局|全片唯一|终局收尾)/.test(cleanHeader)) {
        currentType = 'ending';
        currentTitle = cleanHeader;
      } else {
        currentType = 'chapter';
        currentNum = chapters.length + 1;
        const numMatch = cleanHeader.match(/第\s*(\d+)\s*章/);
        if (numMatch) currentNum = Number(numMatch[1]);
        currentTitle = rawHeader.replace(/^【[^】]+】\s*/, '').trim() || cleanHeader;
      }
      continue;
    }
    if (!currentType && /^#\s+/.test(line)) {
      continue; // skip top-level document title
    }
    if (currentType) {
      buf.push(line);
    } else if (line.trim() && !/^---\s*$/.test(line.trim())) {
      buf.push(line);
    }
  }
  flush();

  if (!opening && !ending && chapters.length === 0) {
    const trimmed = String(mdText || '').trim();
    if (trimmed) {
      chapters.push({
        chapter_number: 1,
        chapter_title: fallbackTitle,
        narration_text: trimmed,
      });
    }
  }

  return {
    ...(opening ? { opening } : {}),
    chapters,
    ...(ending ? { ending } : {}),
  };
}
