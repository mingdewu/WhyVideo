import fs from 'node:fs';
import path from 'node:path';
import { probeDurationMs } from './narration-timing.mjs';

export const BGM_CONFIG_FILENAME = 'bgm-config.json';
export const BGM_PUBLIC_SUBDIR = 'audio/bgm';
export const ALLOWED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac']);

export function dbToGain(db) {
  const num = Number(db);
  if (!Number.isFinite(num)) return 0.15;
  if (num <= -60) return 0;
  return Math.min(1, Math.max(0, Math.pow(10, num / 20)));
}

export function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function defaultBgmConfig() {
  return {
    enabled: false,
    selected_track_id: null,
    tracks: [],
    settings: {
      base_volume_db: -16,
      ducking_enabled: true,
      ducking_db: -8,
      attack_ms: 180,
      release_ms: 420,
      fade_in_ms: 1200,
      fade_out_ms: 2000,
      loop: true,
    },
    segments: [],
    style_recommendations: [],
    audit: null,
    updated_at: null,
  };
}

export function normalizeBgmSettings(raw = {}) {
  const def = defaultBgmConfig().settings;
  return {
    base_volume_db: clampNumber(raw.base_volume_db, -36, 0, def.base_volume_db),
    ducking_enabled: raw.ducking_enabled !== undefined ? Boolean(raw.ducking_enabled) : def.ducking_enabled,
    ducking_db: clampNumber(raw.ducking_db, -24, 0, def.ducking_db),
    attack_ms: Math.round(clampNumber(raw.attack_ms, 20, 2000, def.attack_ms)),
    release_ms: Math.round(clampNumber(raw.release_ms, 50, 3000, def.release_ms)),
    fade_in_ms: Math.round(clampNumber(raw.fade_in_ms, 0, 10000, def.fade_in_ms)),
    fade_out_ms: Math.round(clampNumber(raw.fade_out_ms, 0, 10000, def.fade_out_ms)),
    loop: raw.loop !== undefined ? Boolean(raw.loop) : def.loop,
  };
}

export function normalizeBgmSegments(segments = [], totalDurationMs = 0) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const maxMs = Math.max(0, Math.round(Number(totalDurationMs) || 0));
  const cleaned = segments
    .map((seg, idx) => {
      const startMs = Math.max(0, Math.round(Number(seg?.start_ms) || 0));
      let endMs = Math.max(startMs, Math.round(Number(seg?.end_ms) || startMs));
      if (maxMs > 0) {
        endMs = Math.min(maxMs, endMs);
      }
      const energyRaw = String(seg?.energy || 'medium').toLowerCase();
      const energy = ['low', 'medium', 'high'].includes(energyRaw) ? energyRaw : 'medium';
      const defaultDb = energy === 'high' ? -14 : energy === 'low' ? -19 : -16;
      return {
        segment_id: String(seg?.segment_id || `seg_${String(idx + 1).padStart(2, '0')}`),
        label: String(seg?.label || `章节 ${idx + 1}`).trim() || `章节 ${idx + 1}`,
        start_ms: startMs,
        end_ms: endMs,
        mood: String(seg?.mood || '沉稳叙事').trim() || '沉稳叙事',
        energy,
        target_db: clampNumber(seg?.target_db, -36, 0, defaultDb),
        music_style_hint: String(seg?.music_style_hint || '').trim(),
        reason: String(seg?.reason || '').trim(),
      };
    })
    .filter((s) => s.end_ms > s.start_ms || maxMs === 0)
    .sort((a, b) => a.start_ms - b.start_ms);

  if (cleaned.length > 0 && maxMs > 0) {
    cleaned[0].start_ms = 0;
    for (let i = 1; i < cleaned.length; i++) {
      cleaned[i].start_ms = cleaned[i - 1].end_ms;
      if (cleaned[i].end_ms <= cleaned[i].start_ms) {
        cleaned[i].end_ms = Math.min(maxMs, cleaned[i].start_ms + 1000);
      }
    }
    cleaned[cleaned.length - 1].end_ms = maxMs;
  }
  return cleaned;
}

function getBgmConfigPath(projectDir) {
  return path.join(projectDir, 'data', BGM_CONFIG_FILENAME);
}

function getBgmPublicDir(publicDir) {
  return path.join(publicDir, BGM_PUBLIC_SUBDIR);
}

function safeAudioTrackFromFile(publicDir, fileName, existingTrack = null) {
  const relPath = `${BGM_PUBLIC_SUBDIR}/${fileName}`;
  const diskPath = path.join(publicDir, relPath);
  const stat = fs.statSync(diskPath);
  let durationMs = existingTrack?.duration_ms ?? null;
  if (!durationMs || durationMs <= 0) {
    const probed = probeDurationMs(diskPath);
    durationMs = probed > 0 ? probed : null;
  }
  return {
    track_id: existingTrack?.track_id || `bgm_${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    title: existingTrack?.title || fileName.replace(/\.[^.]+$/, '').replace(/^bgm_\d+_/, ''),
    file_name: fileName,
    src: relPath,
    duration_ms: durationMs,
    size_bytes: stat.size,
    source_type: existingTrack?.source_type || 'local_file',
    license_status: 'approved',
    added_at: existingTrack?.added_at || stat.mtime.toISOString(),
  };
}

export function loadBgmConfig(projectDir, publicDir) {
  const defaults = defaultBgmConfig();
  const cfgPath = getBgmConfigPath(projectDir);
  let raw = {};
  if (fs.existsSync(cfgPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    } catch (e) {
      raw = {};
    }
  }

  const bgmDir = getBgmPublicDir(publicDir);
  const existingBySrc = new Map();
  if (Array.isArray(raw.tracks)) {
    for (const tr of raw.tracks) {
      if (tr?.src) existingBySrc.set(tr.src, tr);
    }
  }

  const syncedTracks = [];
  const seenSrc = new Set();

  // Preserve order of existing tracks that still exist on disk
  if (Array.isArray(raw.tracks)) {
    for (const tr of raw.tracks) {
      if (!tr?.src) continue;
      const resolved = path.resolve(publicDir, tr.src);
      if (!resolved.startsWith(path.resolve(bgmDir) + path.sep)) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
      const ext = path.extname(resolved).toLowerCase();
      if (!ALLOWED_AUDIO_EXTS.has(ext)) continue;
      const fileName = path.basename(resolved);
      syncedTracks.push(safeAudioTrackFromFile(publicDir, fileName, tr));
      seenSrc.add(tr.src);
    }
  }

  // Auto-register any audio files dropped directly into public/audio/bgm/
  if (fs.existsSync(bgmDir) && fs.statSync(bgmDir).isDirectory()) {
    const entries = fs.readdirSync(bgmDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || ent.name.startsWith('.')) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!ALLOWED_AUDIO_EXTS.has(ext)) continue;
      const rel = `${BGM_PUBLIC_SUBDIR}/${ent.name}`;
      if (seenSrc.has(rel)) continue;
      syncedTracks.push(safeAudioTrackFromFile(publicDir, ent.name, existingBySrc.get(rel) || null));
      seenSrc.add(rel);
    }
  }

  let selectedTrackId = raw.selected_track_id || null;
  if (selectedTrackId && !syncedTracks.some((t) => t.track_id === selectedTrackId)) {
    selectedTrackId = syncedTracks[0]?.track_id || null;
  } else if (!selectedTrackId && syncedTracks.length > 0) {
    selectedTrackId = syncedTracks[0].track_id;
  }

  const enabled = Boolean(raw.enabled) && Boolean(selectedTrackId);

  return {
    ...defaults,
    enabled,
    selected_track_id: selectedTrackId,
    tracks: syncedTracks,
    settings: normalizeBgmSettings(raw.settings || {}),
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    style_recommendations: Array.isArray(raw.style_recommendations) ? raw.style_recommendations : [],
    audit: raw.audit || null,
    updated_at: raw.updated_at || null,
  };
}

export function saveBgmConfig(projectDir, config) {
  const cfgPath = getBgmConfigPath(projectDir);
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const toWrite = {
    ...defaultBgmConfig(),
    ...config,
    settings: normalizeBgmSettings(config?.settings || {}),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(toWrite, null, 2), 'utf8');
  return toWrite;
}

export function buildDeterministicSegments(manifest = {}) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) return [];

  const lastEnd = scenes[scenes.length - 1]?.end_ms || 0;
  const totalMs = Math.max(lastEnd, Number(manifest?.total_duration_ms) || 0);
  if (totalMs <= 0) return [];

  // Group contiguous scenes by chapter_ref
  const groups = [];
  for (const scene of scenes) {
    const ref = String(scene.chapter_ref || 'section').trim() || 'section';
    const prev = groups[groups.length - 1];
    if (prev && prev.chapterRef === ref) {
      prev.scenes.push(scene);
      prev.end_ms = Math.max(prev.end_ms, Number(scene.end_ms) || prev.end_ms);
    } else {
      groups.push({
        chapterRef: ref,
        start_ms: Number(scene.start_ms) || 0,
        end_ms: Number(scene.end_ms) || Number(scene.start_ms) || 0,
        scenes: [scene],
      });
    }
  }

  // If only a single chapter exists and there are enough scenes, split chronologically into 3-4 pacing sections
  let finalGroups = groups;
  if (groups.length === 1 && scenes.length >= 3) {
    const bucketCount = scenes.length >= 8 ? 4 : 3;
    finalGroups = [];
    for (let b = 0; b < bucketCount; b++) {
      const startIdx = Math.floor((b * scenes.length) / bucketCount);
      const endIdx = Math.floor(((b + 1) * scenes.length) / bucketCount);
      const slice = scenes.slice(startIdx, endIdx);
      if (slice.length === 0) continue;
      finalGroups.push({
        chapterRef: `${groups[0].chapterRef}_part_${b + 1}`,
        start_ms: Number(slice[0].start_ms) || 0,
        end_ms: Number(slice[slice.length - 1].end_ms) || 0,
        scenes: slice,
      });
    }
  }

  const n = finalGroups.length;
  const rawSegments = finalGroups.map((grp, idx) => {
    const isOpening = idx === 0;
    const isClosing = idx === n - 1 && n > 1;
    const isPeak = !isOpening && !isClosing && idx >= Math.floor(n / 2);

    let mood = '推进叙述 · 稳定节奏';
    let energy = 'medium';
    let targetDb = -16;
    let styleHint = '轻打击乐与环境弦乐铺底，保持稳健推进感';
    let roleLabel = `第 ${idx + 1} 段 · 展开剖析`;

    if (isOpening) {
      mood = '悬念引入 · 克制铺垫';
      energy = 'low';
      targetDb = -18;
      styleHint = '低频环境音垫或稀疏钢琴，给开篇提问留足呼吸空间';
      roleLabel = `01 序幕引入 (${grp.chapterRef})`;
    } else if (isPeak) {
      mood = '核心拆解 · 张力上扬';
      energy = 'high';
      targetDb = -14;
      styleHint = '加入中频弦乐脉冲或清晰节拍，增强论据推进张力';
      roleLabel = `${String(idx + 1).padStart(2, '0')} 深入/高潮 (${grp.chapterRef})`;
    } else if (isClosing) {
      mood = '总结回扣 · 沉静余韵';
      energy = 'low';
      targetDb = -20;
      styleHint = '柔和弦乐长音自然收尾，避免结尾情绪突兀';
      roleLabel = `${String(idx + 1).padStart(2, '0')} 结语收束 (${grp.chapterRef})`;
    } else {
      roleLabel = `${String(idx + 1).padStart(2, '0')} 叙事展开 (${grp.chapterRef})`;
    }

    const firstNarration = String(grp.scenes[0]?.narration_text || '').replace(/\s+/g, ' ').trim();
    const previewText = firstNarration.length > 26 ? `${firstNarration.slice(0, 26)}…` : firstNarration;

    return {
      segment_id: `seg_${String(idx + 1).padStart(2, '0')}`,
      label: roleLabel,
      start_ms: grp.start_ms,
      end_ms: grp.end_ms,
      mood,
      energy,
      target_db: targetDb,
      music_style_hint: styleHint,
      reason: `包含 ${grp.scenes.length} 个镜头${previewText ? `（起始台词：“${previewText}”）` : ''}`,
    };
  });

  return normalizeBgmSegments(rawSegments, totalMs);
}

export function buildBgmAudit(config, manifest = {}, { modelUsed = 'deterministic' } = {}) {
  const settings = normalizeBgmSettings(config?.settings || {});
  const tracks = Array.isArray(config?.tracks) ? config.tracks : [];
  const selectedTrack = tracks.find((t) => t.track_id === config?.selected_track_id) || null;
  const segments = Array.isArray(config?.segments) ? config.segments : [];
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const totalMs = Math.max(
    Number(manifest?.total_duration_ms) || 0,
    scenes.length > 0 ? Number(scenes[scenes.length - 1]?.end_ms) || 0 : 0
  );

  const warnings = [];
  let score = 100;

  if (!config?.enabled) {
    warnings.push('当前尚未启用 BGM 音轨（Remotion 仅输出纯旁白，无背景音乐）。');
    score -= 25;
  }

  if (!selectedTrack) {
    warnings.push('尚未选择或上传本地授权 BGM 音频文件。');
    score -= 35;
  } else if (totalMs > 0 && selectedTrack.duration_ms && selectedTrack.duration_ms < totalMs && !settings.loop) {
    warnings.push(`所选 BGM 时长（${(selectedTrack.duration_ms / 1000).toFixed(1)}s）短于成片（${(totalMs / 1000).toFixed(1)}s），且未开启循环播放，后半段将静音。`);
    score -= 20;
  }

  if (settings.base_volume_db > -12) {
    warnings.push(`基准电平 ${settings.base_volume_db} dB 偏高，建议调低至 -24 dB ~ -12 dB 以免喧宾夺主。`);
    score -= 15;
  } else if (settings.base_volume_db < -26) {
    warnings.push(`基准电平 ${settings.base_volume_db} dB 偏低，成片中音乐存在感可能过弱。`);
    score -= 8;
  }

  if (!settings.ducking_enabled) {
    warnings.push('已关闭自动人声避让 (Ducking)，旁白密集段落可能与配乐打架。');
    score -= 20;
  } else if (settings.ducking_db > -4) {
    warnings.push(`人声避让衰减幅度（${settings.ducking_db} dB）较浅，建议至少设为 -6 dB ~ -12 dB。`);
    score -= 10;
  }

  if (settings.fade_in_ms === 0 || settings.fade_out_ms === 0) {
    warnings.push('建议保留片头淡入与片尾淡出（>0 ms），避免起止切音生硬。');
    score -= 5;
  }

  if (segments.length === 0) {
    warnings.push('尚未生成情绪起伏分段，当前全片将使用统一基准电平。');
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  let grade = 'A+';
  if (!selectedTrack || !config?.enabled) {
    grade = '待配置';
  } else if (score >= 92) {
    grade = 'A+';
  } else if (score >= 82) {
    grade = 'A';
  } else if (score >= 70) {
    grade = 'B';
  } else {
    grade = 'C';
  }

  const duckingNote = settings.ducking_enabled
    ? `开启（旁白时自动下潜 ${settings.ducking_db} dB，起音 ${settings.attack_ms}ms / 释放 ${settings.release_ms}ms）`
    : '已关闭（建议开启以保护人声清晰度）';

  const pacingNote = segments.length > 0
    ? `已按全片 ${segments.length} 个情绪段落自适应调节电平`
    : '使用全局固定基准电平（可点击 AI 分析生成情绪曲线）';

  const fatigueNote = settings.base_volume_db <= -14 && settings.fade_in_ms >= 500 && settings.fade_out_ms >= 800
    ? `优良（基准 ${settings.base_volume_db} dB，淡入 ${(settings.fade_in_ms / 1000).toFixed(1)}s / 淡出 ${(settings.fade_out_ms / 1000).toFixed(1)}s）`
    : `需微调（基准 ${settings.base_volume_db} dB，淡入 ${settings.fade_in_ms}ms / 淡出 ${settings.fade_out_ms}ms）`;

  const summary = !selectedTrack
    ? '请先上传或选择本地合法 BGM 音频，再同步至 Remotion。'
    : !config?.enabled
    ? `已选中《${selectedTrack.title}》，当前开关处于关闭状态，开启并保存后将挂载至 Remotion。`
    : warnings.length === 0
    ? `《${selectedTrack.title}》配置通过 4 项混音审查，可直接用于 Remotion 渲染。`
    : `《${selectedTrack.title}》已就绪，发现 ${warnings.length} 条可优化项。`;

  return {
    grade,
    score,
    summary,
    ducking_note: duckingNote,
    pacing_note: pacingNote,
    fatigue_note: fatigueNote,
    warnings,
    analyzed_at: new Date().toISOString(),
    model_used: modelUsed || config?.audit?.model_used || 'deterministic',
  };
}

export function mergeSpeechWindows(captions = [], fps = 30, mergeGapMs = 250) {
  if (!Array.isArray(captions) || captions.length === 0) return [];
  const valid = captions
    .map((c) => ({
      start_ms: Math.max(0, Number(c?.start_ms) || 0),
      end_ms: Math.max(0, Number(c?.end_ms) || 0),
    }))
    .filter((c) => c.end_ms > c.start_ms)
    .sort((a, b) => a.start_ms - b.start_ms);

  if (valid.length === 0) return [];

  const merged = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i];
    const prev = merged[merged.length - 1];
    if (cur.start_ms - prev.end_ms <= mergeGapMs) {
      prev.end_ms = Math.max(prev.end_ms, cur.end_ms);
    } else {
      merged.push({ ...cur });
    }
  }

  return merged.map((w) => {
    const start_frame = Math.max(0, Math.round((w.start_ms / 1000) * fps));
    const end_frame = Math.max(start_frame + 1, Math.round((w.end_ms / 1000) * fps));
    return { start_frame, end_frame };
  });
}

export function compileBgmRenderProp(projectDir, publicDir, manifest = {}, captions = [], fps = 30) {
  const config = loadBgmConfig(projectDir, publicDir);
  if (!config.enabled || !config.selected_track_id) return null;

  const track = config.tracks.find((t) => t.track_id === config.selected_track_id);
  if (!track || !track.src) return null;

  const diskPath = path.join(publicDir, track.src);
  if (!fs.existsSync(diskPath)) return null;

  const settings = normalizeBgmSettings(config.settings);
  const totalMs = Math.max(
    Number(manifest?.total_duration_ms) || 0,
    Array.isArray(manifest?.scenes) && manifest.scenes.length > 0
      ? Number(manifest.scenes[manifest.scenes.length - 1]?.end_ms) || 0
      : 0
  );
  const normalizedSegments = normalizeBgmSegments(config.segments, totalMs);

  const segments = normalizedSegments.map((seg) => {
    const start_frame = Math.max(0, Math.round((seg.start_ms / 1000) * fps));
    const end_frame = Math.max(start_frame + 1, Math.round((seg.end_ms / 1000) * fps));
    return {
      start_frame,
      end_frame,
      target_db: seg.target_db,
      mood: seg.mood,
    };
  });

  const speech_windows = mergeSpeechWindows(captions, fps, 250);

  return {
    src: track.src,
    enabled: true,
    loop: settings.loop,
    base_volume_db: settings.base_volume_db,
    ducking_enabled: settings.ducking_enabled,
    ducking_db: settings.ducking_db,
    attack_ms: settings.attack_ms,
    release_ms: settings.release_ms,
    fade_in_ms: settings.fade_in_ms,
    fade_out_ms: settings.fade_out_ms,
    segments,
    speech_windows,
  };
}

export function computeBgmVolumeAtFrame(bgm, frame, totalFrames, fps = 30) {
  if (!bgm || !bgm.enabled) return 0;

  const safeFps = Math.max(1, Number(fps) || 30);
  const baseDb = Number.isFinite(Number(bgm.base_volume_db)) ? Number(bgm.base_volume_db) : -16;
  let segmentDb = baseDb;

  const segs = Array.isArray(bgm.segments) ? bgm.segments : [];
  if (segs.length > 0) {
    const transitionFrames = Math.max(1, Math.round(0.6 * safeFps));
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (frame >= seg.start_frame && (frame < seg.end_frame || i === segs.length - 1)) {
        const curDb = Number.isFinite(Number(seg.target_db)) ? Number(seg.target_db) : baseDb;
        if (i > 0) {
          const prevDb = Number.isFinite(Number(segs[i - 1].target_db)) ? Number(segs[i - 1].target_db) : baseDb;
          const elapsed = frame - seg.start_frame;
          if (elapsed >= 0 && elapsed < transitionFrames) {
            const t = elapsed / transitionFrames;
            segmentDb = prevDb + (curDb - prevDb) * t;
          } else {
            segmentDb = curDb;
          }
        } else {
          segmentDb = curDb;
        }
        break;
      }
    }
  }

  let duckFactor = 0;
  if (bgm.ducking_enabled && Array.isArray(bgm.speech_windows) && bgm.speech_windows.length > 0) {
    const duckDepth = Number.isFinite(Number(bgm.ducking_db)) ? Number(bgm.ducking_db) : -8;
    if (duckDepth < 0) {
      const attackFrames = Math.max(1, Math.round(((Number(bgm.attack_ms) || 180) / 1000) * safeFps));
      const releaseFrames = Math.max(1, Math.round(((Number(bgm.release_ms) || 420) / 1000) * safeFps));

      for (const win of bgm.speech_windows) {
        const start = Number(win.start_frame) || 0;
        const end = Number(win.end_frame) || 0;
        if (frame < start - attackFrames || frame > end + releaseFrames) continue;

        let localDuck = 0;
        if (frame >= start && frame <= end) {
          localDuck = 1;
        } else if (frame >= start - attackFrames && frame < start) {
          localDuck = Math.max(0, Math.min(1, (frame - (start - attackFrames)) / attackFrames));
        } else if (frame > end && frame <= end + releaseFrames) {
          localDuck = Math.max(0, Math.min(1, 1 - (frame - end) / releaseFrames));
        }
        if (localDuck > duckFactor) duckFactor = localDuck;
        if (duckFactor >= 1) break;
      }
      segmentDb += duckFactor * duckDepth;
    }
  }

  let gain = dbToGain(segmentDb);

  const fadeInFrames = Math.max(0, Math.round(((Number(bgm.fade_in_ms) || 0) / 1000) * safeFps));
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    gain *= Math.max(0, frame / fadeInFrames);
  }

  const fadeOutFrames = Math.max(0, Math.round(((Number(bgm.fade_out_ms) || 0) / 1000) * safeFps));
  const safeTotal = Math.max(1, Number(totalFrames) || 1);
  if (fadeOutFrames > 0) {
    const framesFromEnd = Math.max(0, safeTotal - 1 - frame);
    if (framesFromEnd < fadeOutFrames) {
      gain *= Math.max(0, framesFromEnd / fadeOutFrames);
    }
  }

  return Math.min(1, Math.max(0, gain));
}

export function parseBgmAnalysisJson(rawText, manifest = {}) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('模型未返回有效 JSON 对象');
  }
  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const totalMs = Math.max(
    Number(manifest?.total_duration_ms) || 0,
    scenes.length > 0 ? Number(scenes[scenes.length - 1]?.end_ms) || 0 : 0
  );
  const segments = normalizeBgmSegments(parsed?.segments || [], totalMs);
  if (segments.length === 0) {
    throw new Error('模型返回的情绪分段为空');
  }

  const recs = Array.isArray(parsed?.style_recommendations)
    ? parsed.style_recommendations
        .slice(0, 4)
        .map((r, i) => ({
          id: String(r?.id || `rec_${i + 1}`),
          title: String(r?.title || `推荐配乐方向 ${i + 1}`).trim(),
          bpm_range: String(r?.bpm_range || '90-115 BPM').trim(),
          instrumentation: String(r?.instrumentation || '').trim(),
          fit_reason: String(r?.fit_reason || '').trim(),
        }))
        .filter((r) => r.title)
    : [];

  return {
    segments,
    style_recommendations: recs,
    audit_note: String(parsed?.audit_summary || '').trim(),
  };
}
