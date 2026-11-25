import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { rootDir, defaultProjectId, getPaths } from './config.mjs';
import { resolveProjectVideoPath } from '../../project-paths.mjs';
import {
  applyTimingToScenes,
  buildCaptionsFromTiming,
  buildTimeLookup,
  loadTiming,
  probeDurationMs,
  scenesText,
  timingPath,
  whisperAvailable,
} from '../../narration-timing.mjs';
import { planCuts } from '../../cut-planner.mjs';

export function listProjects() {
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
    let hasVideo = Boolean(resolveProjectVideoPath(paths));
    let hasScript = fs.existsSync(paths.finalScriptPath);
    let hasManifest = fs.existsSync(paths.manifestPath);
    let isBlankDraft = false;

    if (hasScript) {
      try {
        const sc = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8'));
        if (sc.title) title = `《${sc.title}》`;
      } catch (e) {}
    }

    if (title === pId && fs.existsSync(paths.briefPath)) {
      try {
        const br = JSON.parse(fs.readFileSync(paths.briefPath, 'utf8'));
        if (br._blank_draft) isBlankDraft = true;
        if (br.title) title = `《${br.title}》`;
      } catch (e) {}
    }

    if (hasManifest) {
      try {
        const mf = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
        scenesCount = (mf.scenes || []).length;
        if (mf.project_title && title === pId && !isBlankDraft) title = `《${mf.project_title}》`;
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

export function msToSrt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

export function projectIdFromCaptionsPath(captionsPath) {
  // .../projects/<id>/public/captions/captions.srt
  const parts = path.resolve(captionsPath).split(path.sep);
  const i = parts.lastIndexOf('projects');
  return i >= 0 ? parts[i + 1] : null;
}

/** 读取工程的逐字时间轴（配音生成后对齐得到）；没有则返回 null */
export function getProjectTiming(projectId) {
  if (!projectId) return null;
  return loadTiming(getPaths(projectId).dataDir);
}

export function syncCaptions(manifest, captionsPath, projectId = null) {
  if (!manifest?.scenes || !captionsPath) return;
  const pid = projectId || manifest.project_id || projectIdFromCaptionsPath(captionsPath);
  const timing = getProjectTiming(pid);
  const srtLines = [];
  // 有真实时间轴：字幕按短句独立切分，时间来自配音，与画面切点无关
  const timedCaps = timing ? buildCaptionsFromTiming(manifest, timing) : [];
  if (timedCaps.length) {
    timedCaps.forEach((c, i) => {
      srtLines.push(String(i + 1));
      srtLines.push(`${msToSrt(c.start_ms)} --> ${msToSrt(c.end_ms)}`);
      srtLines.push(c.text);
      srtLines.push('');
    });
  } else {
    manifest.scenes.forEach((sc, i) => {
      srtLines.push(String(i + 1));
      srtLines.push(`${msToSrt(sc.start_ms)} --> ${msToSrt(sc.end_ms)}`);
      srtLines.push(sc.narration_text || '');
      srtLines.push('');
    });
  }
  fs.mkdirSync(path.dirname(captionsPath), { recursive: true });
  fs.writeFileSync(captionsPath, srtLines.join('\n'), 'utf8');
}

/**
 * 重新计算镜头时间。
 * - 有配音时间轴：镜头起点 = 该镜头第一个字被说出的时间（略提前），完全以音频为准
 * - 没有：沿用旧的按字数估算
 */
export function recalculateTimelines(manifest, projectId = null) {
  const timing = getProjectTiming(projectId || manifest?.project_id);
  if (timing && applyTimingToScenes(manifest, timing)) return;
  if (manifest) manifest.timing_source = 'estimated';
  let cur = 0;
  (manifest.scenes || []).forEach((s, idx) => {
    s.scene_index = idx + 1;
    s.scene_id = `Shot-${String(idx + 1).padStart(3, '0')}`;
    if (s.timing_source && s.timing_source.startsWith('aligned')) {
      // 时间轴失效（文案大改）后，按字数重新估算，避免沿用旧的对齐时长
      s.duration_ms = 0;
      s.timing_source = 'estimated';
    }
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

export function ensureTableFields(manifest) {
  let changed = false;
  for (const s of manifest.scenes || []) {
    if (!s.source_mode || (s.source_mode === 'ai_ppt_slide' && !s.final_asset_id && !s.preview_image_url)) {
      s.source_mode = 'manual_upload';
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

export function syncTableToManifest(manifest) {
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

export function recompileProject(projectId) {
  const curPaths = getPaths(projectId);
  if (fs.existsSync(curPaths.manifestPath)) {
    const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
    // 有配音时间轴时，渲染前始终以音频真实时间为准
    if (getProjectTiming(projectId)) {
      const before = JSON.stringify((mf.scenes || []).map((s) => [s.start_ms, s.end_ms]));
      recalculateTimelines(mf, projectId);
      if (JSON.stringify((mf.scenes || []).map((s) => [s.start_ms, s.end_ms])) !== before) {
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(mf, null, 2), 'utf8');
      }
    }
    syncCaptions(mf, curPaths.captionsPath, projectId);
  }
  spawnSync(
    'node',
    ['packages/qc-tools/generate-render-props.mjs', '--project', projectId],
    { cwd: rootDir, stdio: 'inherit' }
  );
}

/** 查找工程下可用的配音音频文件（排除空 WAV 占位文件） */
export function findProjectAudioPath(curPaths, manifest = null) {
  const isValidAudio = (p) => {
    try {
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
      if (fs.statSync(p).size <= 256) return false;
      return probeDurationMs(p) > 0;
    } catch (e) {
      return false;
    }
  };
  const candidates = [];
  if (manifest?.audio_file) {
    candidates.push(path.join(curPaths.publicDir, manifest.audio_file));
  }
  candidates.push(path.join(curPaths.audioDir, 'narration.wav'));
  candidates.push(path.join(curPaths.audioDir, 'narration.mp3'));
  for (const c of candidates) {
    if (isValidAudio(c)) return c;
  }
  if (fs.existsSync(curPaths.audioDir)) {
    const files = fs
      .readdirSync(curPaths.audioDir)
      .filter((f) => /\.(wav|mp3|m4a)$/i.test(f))
      .map((f) => {
        const full = path.join(curPaths.audioDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of files) {
      if (isValidAudio(f.full)) return f.full;
    }
  }
  return null;
}

/** 生成工程当前的时间轴与节奏状态摘要，供前端顶部控制条展示 */
export function buildProjectTimingSummary(projectId, manifest) {
  const curPaths = getPaths(projectId);
  const timing = getProjectTiming(projectId);
  const audioPath = findProjectAudioPath(curPaths, manifest);
  const hasAudioFile = Boolean(audioPath);
  const audioFileName = audioPath ? path.basename(audioPath) : null;
  let audioUrl = null;
  if (audioPath) {
    const rel = path.relative(curPaths.publicDir, audioPath).split(path.sep).join('/');
    const mtime = Math.round(fs.statSync(audioPath).mtimeMs);
    audioUrl = `/public/${projectId}/${rel}?t=${mtime}`;
  }
  let stale = false;
  let rhythm = null;
  let pendingKeywordShifts = 0;
  let pendingLongSplits = 0;

  if (timing && manifest?.scenes?.length) {
    const text = scenesText(manifest.scenes);
    const lookup = buildTimeLookup(timing, text);
    stale = Boolean(lookup.stale);
    if (!stale) {
      try {
        const plan = planCuts(manifest, timing);
        rhythm = plan.stats;
        pendingKeywordShifts = plan.changes.length;
        pendingLongSplits = plan.splitSuggestions.length;
      } catch (e) {
        // 忽略偶发诊断异常
      }
    }
  }

  return {
    available: Boolean(timing),
    stale,
    method: timing?.method || null,
    audio_duration_ms: timing?.audio_duration_ms || 0,
    created_at: timing?.created_at || null,
    warning: timing?.warning || null,
    whisper_ready: whisperAvailable(),
    has_audio_file: hasAudioFile,
    audio_file_name: audioFileName,
    audio_url: audioUrl,
    rhythm,
    pending_keyword_shifts: pendingKeywordShifts,
    pending_long_splits: pendingLongSplits,
  };
}
