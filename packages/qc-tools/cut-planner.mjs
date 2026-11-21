/**
 * 智能切点规划 (Cut Planner)
 *
 * 不改镜头顺序、不丢素材，只移动"换画面的点"：
 *   1. 画面在它对应的关键词说出时出现（关键词可能在上一句的后半句 —— 这就是"一句话没说完就换画面"）
 *   2. 没有关键词时，切在停顿 / 转折词处
 *   3. 两次换画面至少间隔 minShotMs（关键词扎堆时自动只换一次）
 *   4. 超过 maxShotMs 的长镜头给出"建议切分点"（可选自动切分）
 *   5. 统计节奏，提示"太机械"的问题
 */
import { isSpoken, spokenIndex, sceneSpokenRanges, scenesText, buildTimeLookup, findKeywordPositions, DEFAULT_CUT_LEAD_MS } from './narration-timing.mjs';

export const PLANNER_DEFAULTS = {
  minShotMs: 1500,
  maxShotMs: 8000,
  leadMs: DEFAULT_CUT_LEAD_MS,
  // 每个切点最多允许移动的范围（毫秒），避免偏离原分镜意图太远
  maxShiftMs: 4500,
};

const TURN_WORDS = ['但是', '可是', '然而', '不过', '结果', '于是', '所以', '因此', '其实', '问题是', '直到', '后来', '同时', '另外', '首先', '其次', '最后', '比如', '例如', '换句话说', '也就是说', '可惜', '没想到', '真正'];
const STOP_SUBSTR = new Set(['我们', '他们', '这个', '那个', '一个', '什么', '为什么', '因为', '所以', '但是', '就是', '可以', '没有', '已经', '还是', '这些', '那些', '自己', '其实', '如果', '时候', '非常', '画面', '镜头', '视频', '核心', '要点', '观点', '核心观点', '章节', '归属', '纪录片', '素材', '实拍', '高清']);

/** 发音字序列中，每个位置之前是否紧跟句末/逗号标点 */
function boundaryKinds(text) {
  const kinds = []; // kinds[j] = 'sentence' | 'clause' | null  —— 第 j 个发音字之前的标点类型
  let pending = null;
  for (const ch of text) {
    if (isSpoken(ch)) {
      kinds.push(pending);
      pending = null;
    } else if (/[。！？!?；;…\n]/.test(ch)) {
      pending = 'sentence';
    } else if (/[，,、：:]/.test(ch) && pending !== 'sentence') {
      pending = 'clause';
    }
  }
  return kinds;
}

/** 从镜头的素材描述字段里，找出在给定文本窗口中原样出现的词（无 AI 时的兜底关键词） */
export function heuristicKeywordsForScene(scene, windowText) {
  const sources = [
    ...(Array.isArray(scene.visual_keywords) ? scene.visual_keywords : []),
    ...(Array.isArray(scene.content_keywords) ? scene.content_keywords : []),
    scene.selected_search_keyword,
    ...(Array.isArray(scene.search_keyword_candidates) ? scene.search_keyword_candidates : []),
    scene.ppt_slide_spec?.theme_title,
    scene.visual_purpose,
  ].filter((s) => typeof s === 'string' && s.trim());
  const hay = spokenIndex(windowText).chars.join('');
  const found = new Map();
  for (const src of sources) {
    const s = spokenIndex(src).chars.join('');
    // 枚举 src 的子串（长度 2~8），找在窗口里出现的
    for (let len = Math.min(8, s.length); len >= 2; len--) {
      for (let i = 0; i + len <= s.length; i++) {
        const sub = s.slice(i, i + len);
        if (STOP_SUBSTR.has(sub)) continue;
        if (hay.includes(sub)) {
          // 已有更长的包含它，就跳过
          if ([...found.keys()].some((k) => k.includes(sub))) continue;
          found.set(sub, len);
        }
      }
    }
  }
  return [...found.keys()].sort((a, b) => b.length - a.length).slice(0, 4);
}

/**
 * 规划切点
 * @param {object} manifest
 * @param {object} timing   narration-timing.json
 * @param {object} opts
 * @param {Record<number,string[]>} [opts.keywordsByScene] 每个镜头(下标)的"画面关键词"（AI 提供；缺省用启发式）
 * @returns {{ newRanges, changes, splitSuggestions, stats }}
 */
export function planCuts(manifest, timing, opts = {}) {
  const cfg = { ...PLANNER_DEFAULTS, ...opts };
  const scenes = manifest.scenes || [];
  const text = scenesText(scenes);
  const { getTime, count } = buildTimeLookup(timing, text);
  if (!count) throw new Error('当前镜头文案和配音对不上（文案可能改动过），请先重新生成配音或重新对齐时间轴');
  const { ranges } = sceneSpokenRanges(scenes);
  const kinds = boundaryKinds(text);
  const spoken = spokenIndex(text).chars;
  const spokenStr = spoken.join('');
  const pauses = timing.pauses || [];

  const pauseBefore = (j) => {
    if (j <= 0) return 0;
    const prevEnd = getTime(j - 1)[1];
    const curStart = getTime(j)[0];
    let gap = Math.max(0, curStart - prevEnd);
    for (const [s, e] of pauses) {
      if (e >= prevEnd - 30 && s <= curStart + 30) gap = Math.max(gap, Math.min(e, curStart) - Math.max(s, prevEnd));
    }
    return gap;
  };
  const turnAt = (j) => TURN_WORDS.some((w) => spokenStr.startsWith(w, j));
  const cutTime = (j) => Math.max(0, getTime(j)[0] - cfg.leadMs);

  // 每个镜头的关键词位置（全文发音字下标）
  const kwPos = scenes.map((s, i) => {
    const [a, b] = ranges[i];
    const prevA = i > 0 ? ranges[i - 1][0] : a;
    const winText = spoken.slice(prevA, b).join('');
    let kws = opts.keywordsByScene?.[i];
    if (!Array.isArray(kws) || !kws.length) kws = heuristicKeywordsForScene(s, winText);
    const pos = [];
    for (const kw of kws) {
      const len = Array.from(kw).filter(isSpoken).length;
      for (const p of findKeywordPositions(text, kw)) {
        if (p >= prevA && p < b) pos.push({ p, len, kw });
      }
    }
    return { kws, pos };
  });

  // 逐个切点选择最佳位置（从前往后，保证单调）
  const starts = ranges.map((r) => r[0]);
  const changes = [];
  for (let i = 1; i < scenes.length; i++) {
    const [a, b] = ranges[i];
    if (b <= a) continue;
    const orig = a;
    const lo = Math.max(starts[i - 1] + 1, ranges[i - 1][0] + 1);
    const hi = b - 1;
    const origT = cutTime(orig);
    const prevCut = i - 1 === 0 ? 0 : cutTime(starts[i - 1]);
    const nextSceneEnd = i + 1 < scenes.length && ranges[i + 1][1] > ranges[i + 1][0] ? cutTime(ranges[i + 1][0]) : timing.audio_duration_ms;
    // 上一个镜头自己的关键词位置：切点不能把它切到下一镜头去
    const prevOwnKw = kwPos[i - 1].pos.filter((k) => k.p >= ranges[i - 1][0]).map((k) => k.p + k.len);
    const mustAfter = prevOwnKw.length ? Math.max(...prevOwnKw.filter((e) => e <= a)) : -1;

    let best = { j: orig, score: -Infinity, reason: 'keep' };
    for (let j = lo; j <= hi; j++) {
      const t = cutTime(j);
      if (Math.abs(t - origT) > cfg.maxShiftMs) continue;
      if (t - prevCut < cfg.minShotMs) continue;
      if (nextSceneEnd - t < cfg.minShotMs) continue;
      if (mustAfter >= 0 && j < mustAfter) continue;

      const kind = kinds[j];
      const kwHere = kwPos[i].pos.find((k) => k.p === j);
      const pause = pauseBefore(j);
      // 只允许在：关键词开头 / 标点后 / 明显停顿后 / 转折词开头 / 原切点
      if (!kwHere && !kind && pause < 120 && !turnAt(j) && j !== orig) continue;

      let score = 0;
      let reason = [];
      if (kwHere) { score += 6 + Math.min(3, kwHere.len * 0.6); reason.push(`关键词「${kwHere.kw}」`); }
      if (kind === 'sentence') { score += 2.2; reason.push('句末'); }
      else if (kind === 'clause') { score += 1.4; reason.push('逗号停顿'); }
      if (pause >= 120) { score += Math.min(2, pause / 250); if (!kind) reason.push('停顿'); }
      if (turnAt(j)) { score += 1.5; reason.push('转折词'); }
      if (j === orig) { score += 1.0; }
      // 离原切点越远扣分越多（尊重原分镜）
      score -= Math.abs(t - origT) / 1500;
      // 关键词在本镜头文字中很靠后：画面会很晚才"对上"，略扣分
      if (kwHere && j > orig + 0.6 * (b - a)) score -= 1.5;
      if (score > best.score) best = { j, score, reason: reason.join(' + ') || '保持原切点' };
    }
    starts[i] = best.j;
    if (best.j !== orig) {
      changes.push({
        scene_index: i,
        scene_id: scenes[i].scene_id,
        from_char: orig,
        to_char: best.j,
        from_ms: origT,
        to_ms: cutTime(best.j),
        reason: best.reason,
        mid_sentence: !kinds[best.j],
        preview: `${spoken.slice(Math.max(0, best.j - 8), best.j).join('')}｜${spoken.slice(best.j, best.j + 10).join('')}`,
      });
    }
  }

  const newRanges = starts.map((s, i) => [s, i + 1 < starts.length ? starts[i + 1] : count]);

  // 长镜头切分建议
  const splitSuggestions = [];
  newRanges.forEach(([a, b], i) => {
    if (b - a < 4) return;
    const t0 = i === 0 ? 0 : cutTime(a);
    const t1 = i + 1 < newRanges.length ? cutTime(b) : timing.audio_duration_ms;
    if (t1 - t0 <= cfg.maxShotMs) return;
    let best = null;
    for (let j = a + 2; j < b - 1; j++) {
      const t = cutTime(j);
      if (t - t0 < 2000 || t1 - t < 2000) continue;
      const kind = kinds[j];
      const pause = pauseBefore(j);
      if (!kind && pause < 150 && !turnAt(j)) continue;
      let score = (kind === 'sentence' ? 3 : kind === 'clause' ? 1.8 : 0) + Math.min(2, pause / 250) + (turnAt(j) ? 1.5 : 0);
      score -= Math.abs((t - t0) - (t1 - t0) / 2) / 2500; // 越接近中间越好
      if (!best || score > best.score) best = { j, score, kind };
    }
    if (best) {
      splitSuggestions.push({
        scene_index: i,
        scene_id: scenes[i].scene_id,
        duration_ms: t1 - t0,
        split_char: best.j,
        split_ms: cutTime(best.j),
        preview: `${spoken.slice(Math.max(0, best.j - 8), best.j).join('')}｜${spoken.slice(best.j, best.j + 10).join('')}`,
      });
    }
  });

  return { newRanges, changes, splitSuggestions, stats: rhythmStats(newRanges, kinds, cutTime, timing.audio_duration_ms, cfg), keywords: kwPos.map((k) => k.kws) };
}

/** 节奏统计：用来发现"太像 AI"的规律感 */
export function rhythmStats(ranges, kinds, cutTime, totalMs, cfg = PLANNER_DEFAULTS) {
  const durs = ranges.map(([a, b], i) => {
    const t0 = i === 0 ? 0 : cutTime(a);
    const t1 = i + 1 < ranges.length ? cutTime(ranges[i + 1][0]) : totalMs;
    return Math.max(0, t1 - t0);
  });
  const n = durs.length || 1;
  const mean = durs.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(durs.reduce((x, y) => x + (y - mean) ** 2, 0) / n);
  const cuts = ranges.slice(1).map(([a]) => kinds[a]);
  const sentenceCuts = cuts.filter((k) => k === 'sentence').length;
  const midCuts = cuts.filter((k) => !k).length;
  const warnings = [];
  const cv = mean ? sd / mean : 0;
  if (cv < 0.25 && n > 6) warnings.push(`画面长度太平均（变化系数 ${cv.toFixed(2)}），节奏单调`);
  if (cuts.length > 6 && sentenceCuts / cuts.length > 0.9) warnings.push(`${Math.round((sentenceCuts / cuts.length) * 100)}% 的换画面都卡在句号上，显得机械`);
  const tooLong = durs.filter((d) => d > cfg.maxShotMs).length;
  const tooShort = durs.filter((d) => d < cfg.minShotMs).length;
  if (tooLong) warnings.push(`${tooLong} 个画面超过 ${cfg.maxShotMs / 1000} 秒`);
  if (tooShort) warnings.push(`${tooShort} 个画面短于 ${cfg.minShotMs / 1000} 秒，会闪`);
  return {
    shots: durs.length,
    avg_ms: Math.round(mean),
    sd_ms: Math.round(sd),
    variation: Number(cv.toFixed(2)),
    sentence_end_cut_ratio: cuts.length ? Number((sentenceCuts / cuts.length).toFixed(2)) : 0,
    mid_sentence_cut_ratio: cuts.length ? Number((midCuts / cuts.length).toFixed(2)) : 0,
    too_long: tooLong,
    too_short: tooShort,
    warnings,
  };
}

/**
 * 按新的发音字区间重切镜头文案（保留每个镜头原有的素材/画面字段）。
 * 原文中的标点跟随在它前面的字所属的镜头。
 */
export function resliceSceneTexts(scenes, newRanges) {
  const text = scenesText(scenes);
  const pieces = newRanges.map(() => '');
  let j = -1;
  let owner = 0;
  for (const ch of text) {
    if (isSpoken(ch)) {
      j++;
      while (owner + 1 < newRanges.length && j >= newRanges[owner + 1][0]) owner++;
    }
    pieces[owner] += ch;
  }
  scenes.forEach((s, i) => {
    s.narration_text = pieces[i].trim();
  });
}

/** 在全文第 j 个发音字处插入新切点：把所在镜头一分为二（新镜头复制原镜头字段） */
export function splitAtSpokenIndex(scenes, j) {
  const { ranges } = sceneSpokenRanges(scenes);
  const idx = ranges.findIndex(([a, b]) => j > a && j < b);
  if (idx < 0) return -1;
  const clone = JSON.parse(JSON.stringify(scenes[idx]));
  clone.narration_text = ''; // 先清空，避免全文重复
  delete clone.cut_offset_ms;
  scenes.splice(idx + 1, 0, clone);
  // 重新构建区间：idx 镜头 [a, j)，clone [j, b)，其余不变
  const [a, b] = ranges[idx];
  const rebuilt = [];
  ranges.forEach((r, i) => {
    if (i === idx) { rebuilt.push([a, j]); rebuilt.push([j, b]); }
    else rebuilt.push(r);
  });
  resliceSceneTexts(scenes, rebuilt);
  return idx + 1;
}

/** 移动镜头 i 的起点到全文第 j 个发音字（在相邻两个镜头间重新分配文字） */
export function moveCutTo(scenes, i, j) {
  if (i <= 0 || i >= scenes.length) return false;
  const { ranges } = sceneSpokenRanges(scenes);
  const lo = ranges[i - 1][0] + 1;
  const hi = ranges[i][1] - 1;
  if (j < lo || j > hi) return false;
  const rebuilt = ranges.map((r) => [...r]);
  rebuilt[i - 1][1] = j;
  rebuilt[i][0] = j;
  resliceSceneTexts(scenes, rebuilt);
  return true;
}
