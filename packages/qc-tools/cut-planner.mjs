/**
 * 智能切点规划 (Cut Planner)
 *
 * 核心能力：
 *   1. 画面在它对应的关键词说出时出现（支持句中分句处切入，同时自动吸附前导子句，杜绝“。让”“，为什么”等断句残片）
 *   2. 打破“一句一镜”的机械 AI 感：
 *      - 同主题 / 短碎分句 / 从句续接（并被、而且、而是等） / 纯过渡反问句自动合并（两三句话共用 1~2 个镜头）
 *      - 单镜内包含多个独立具象关键词或超长镜头自动拆分（一句话/两句话切成 2~3 个镜头）
 *   3. 清理句首前10字“伪关键词”，用真正具象的画面词更新镜头标签
 */
import { isSpoken, spokenIndex, sceneSpokenRanges, scenesText, buildTimeLookup, findKeywordPositions, DEFAULT_CUT_LEAD_MS } from './narration-timing.mjs';

export const PLANNER_DEFAULTS = {
  minShotMs: 2500,
  maxShotMs: 9600,
  leadMs: DEFAULT_CUT_LEAD_MS,
  // 每个切点最多允许移动的范围（毫秒），避免偏离原分镜意图太远
  maxShiftMs: 4200,
  // 动态合镜与多关键词拆镜参数
  minHoldMergeMs: 4200,
  maxMergedShotMs: 9200,
  maxSameTopicMergeMs: 9600,
  multiKeywordSplitMinMs: 5600,
  multiKeywordHalfMinMs: 2500,
};

const TURN_WORDS = ['但是', '可是', '然而', '不过', '结果', '于是', '所以', '因此', '其实', '问题是', '直到', '后来', '同时', '另外', '首先', '其次', '最后', '比如', '例如', '换句话说', '也就是说', '可惜', '没想到', '真正', '反而'];
const STOP_SUBSTR = new Set([
  '我们', '他们', '你们', '这个', '那个', '一个', '什么', '为什么', '因为', '所以', '但是', '就是', '可以', '没有', '已经', '还是',
  '这些', '那些', '自己', '其实', '如果', '时候', '非常', '画面', '镜头', '视频', '核心', '要点', '观点', '核心观点', '章节', '归属',
  '纪录片', '素材', '实拍', '高清', '实机', '场景', '实录', '特写', '工作', '历史', '资料', '动画', '演示', '示意', '电影',
  '在现实', '现实中', '听起来', '看起来', '想象一', '想象一下', '搞明白', '这听起', '根本不', '不可能', '所有的', '几十年前',
]);

const MEDIA_BOILERPLATE_RE = /(纪录片|实机画面|场景实录|工作实录|开机画面|历史画面|资料画面|新闻画面|特写画面|电影画面|动画演示|示意图|实拍|高清|素材|视频|画面|场景|实录|特写|镜头)/g;

const RHETORICAL_OR_FILLER_RE = /^(这听起来|那根本不可能|根本不可能|没人报警|但没有人买账|没有人买账|换句话说|也就是说|说白了|简单来说|不仅如此|更重要的是|要知道|你想想|试想一下|为什么呢|原因很简单|要搞明白这个问题|这不是暴力的模拟|整个过程干脆利落)/;
const CONTINUATION_CLAUSE_RE = /^(并被|并且|而且|甚至|或者|以及|而是|从而|进而|使得|导致|反而|结果|第二天|同时|原地|就把|不需要)/;
const SETUP_LEADIN_RE = /^(在现实中|为了|但只要|想象一下|其实|不过|然而|直到|随着|当|如果|哪怕|无论|在那个|在大家|要搞明白|既然不能|在一些城市)/;
const OPENING_PUNCT_RE = /[“‘'（(《【\[]/;

/** 检查文本是否存在未闭合的引号（避免把同一句引语劈成两个镜头） */
export function hasUnclosedQuote(text) {
  const s = String(text || '');
  const openDouble = (s.match(/“/g) || []).length;
  const closeDouble = (s.match(/”/g) || []).length;
  if (openDouble > closeDouble) return true;
  const openSingle = (s.match(/‘/g) || []).length;
  const closeSingle = (s.match(/’/g) || []).length;
  return openSingle > closeSingle;
}

/** 发音字序列中，每个位置之前是否紧跟句末/逗号标点 */
export function boundaryKinds(text) {
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

/** 判断候选词是否只是 parseScriptToScenes 生成的“句首前6~10字伪关键词”或整句残片 */
export function isMechanicalPrefixKeyword(kw, narrationText = '') {
  if (!kw) return false;
  const sKw = spokenIndex(String(kw)).chars.join('');
  // 常见的非画面口语过渡/句首截断残片，无论长短都判为伪关键词
  if (/^(为什么|为了维护|为了|在现实中|在现实|这听起来|想象一下|要搞明白|老板让你|并被现代|但只要你|从几十年|到今天|那根本不|在那个连|既然不能|在所有能|玩家按下|如果撞上|整个过程|没有哪个|其实这种)/.test(sKw)) {
    return true;
  }
  if (sKw.length >= 6) {
    if (!narrationText) return true;
    const sText = spokenIndex(String(narrationText)).chars.join('');
    if (sText.startsWith(sKw) || sText.includes(sKw.slice(0, 6)) || sText.includes(sKw.slice(-6))) {
      return true;
    }
  }
  return false;
}

/** 清洗搜索关键词中的通用媒体后缀 */
export function cleanSearchKeywordTerm(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(MEDIA_BOILERPLATE_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** 从镜头的素材描述字段与正文中，找出在给定文本窗口中原样出现的具象关键词 */
export function heuristicKeywordsForScene(scene, windowText) {
  const narr = String(scene.narration_text || '');
  const rawVisualKws = (Array.isArray(scene.visual_keywords) ? scene.visual_keywords : [])
    .filter((k) => !isMechanicalPrefixKeyword(k, narr));
  const rawContentKws = (Array.isArray(scene.content_keywords) ? scene.content_keywords : [])
    .filter((k) => !isMechanicalPrefixKeyword(k, narr));
  const rawTheme = scene.ppt_slide_spec?.theme_title && !isMechanicalPrefixKeyword(scene.ppt_slide_spec.theme_title, narr)
    ? scene.ppt_slide_spec.theme_title
    : '';

  const sources = [
    ...rawVisualKws,
    cleanSearchKeywordTerm(scene.selected_search_keyword),
    ...(Array.isArray(scene.search_keyword_candidates) ? scene.search_keyword_candidates.map(cleanSearchKeywordTerm) : []),
    ...rawContentKws,
    rawTheme,
  ].filter((s) => typeof s === 'string' && s.trim());

  const hay = spokenIndex(windowText || narr).chars.join('');
  const found = new Map();

  for (const src of sources) {
    const tokens = src.split(/[\s,，、/·]+/).filter(Boolean);
    for (const tok of tokens) {
      if (isMechanicalPrefixKeyword(tok, narr)) continue;
      const s = spokenIndex(tok).chars.join('');
      if (!s) continue;
      for (let len = Math.min(6, s.length); len >= 2; len--) {
        for (let i = 0; i + len <= s.length; i++) {
          const sub = s.slice(i, i + len);
          if (STOP_SUBSTR.has(sub)) continue;
          if (hay.includes(sub)) {
            if ([...found.keys()].some((k) => k.includes(sub) || sub.includes(k))) continue;
            found.set(sub, len + 2);
          }
        }
      }
    }
  }

  // 从本镜正文中补充提取具象锚点：书名号《...》、引号“...”、年份/年代/数字、以及高频具象视觉名词
  const anchorMatches = [
    ...(narr.match(/《([^》]{2,8})》/g) || []),
    ...(narr.match(/[“‘']([^”’']{2,6})[”’']/g) || []),
    ...(narr.match(/\d{2,4}年代?|[一二三四五六七八九十]+年代|\d+(?:\.\d+)?%|\d+[万亿千百]+/g) || []),
    ...(narr.match(/电子游戏|像素时代|坦克大战|枪战游戏|游戏手柄|程序员|游戏街机|街机|处理器|国际象棋|中国象棋|死亡飞车|十字架|墓碑|听证会|国会|最高法院|第一修正案|格林童话|白磷弹|暴力等级|多巴胺|防火墙|微积分|辣椒酱|警察|法庭|监狱|电脑|代码|几何题|子弹|方块|棋子|玩家/g) || []),
  ];
  for (const m of anchorMatches) {
    const s = spokenIndex(m).chars.join('');
    if (s.length >= 2 && s.length <= 7 && !STOP_SUBSTR.has(s) && hay.includes(s)) {
      if (![...found.keys()].some((k) => k.includes(s) || s.includes(k))) {
        found.set(s, s.length + 1);
      }
    }
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 3);
}

/**
 * 前导子句/虚词吸附与句首引导词归位：
 * 1. 如果 j 在分句中间（非标点后），向前回溯最多 28 个发音字吸附到该分句开头（句号/分号/逗号后），杜绝“电子｜游戏”等词中切点；
 * 2. 如果吸附在逗号后，但该逗号距离前面的句号不足 12 个字（或属于“在现实中，”“为了维护这个底线，”等引导短语），
 *    自动归位到前面的句号处，绝不把下一句的开头留在上一镜的末尾。
 */
export function snapCutToNaturalBoundary(j, kinds, totalCount, spokenStr = '', nextEnd = -1) {
  if (j <= 0 || j >= totalCount) return j;
  let c = j;
  if (kinds[c] !== 'sentence' && kinds[c] !== 'clause') {
    for (let d = 1; d <= 28 && c - d > 0; d++) {
      if (kinds[c - d] === 'sentence' || kinds[c - d] === 'clause') {
        c = c - d;
        break;
      }
    }
  }
  if (kinds[c] === 'clause') {
    for (let d = 1; d <= 18 && c - d >= 0; d++) {
      if (kinds[c - d] === 'sentence' || c - d === 0) {
        const sPos = c - d;
        const leadClause = spokenStr ? spokenStr.slice(sPos, c) : '';
        if (d <= 11 || (leadClause && SETUP_LEADIN_RE.test(leadClause))) {
          return sPos > 0 ? sPos : c;
        }
        break;
      }
    }
    // 如果逗号后面离句末只有 <= 12 个字（例如“处理器慢得像蜗牛。”“第二天就被警察带走调查。”），且本镜在句末后还有新句子，则归位到该句末
    for (let d = 1; d <= 12 && c + d < totalCount; d++) {
      if (kinds[c + d] === 'sentence') {
        if (nextEnd < 0 || nextEnd > c + d + 2) {
          return c + d;
        }
        break;
      }
    }
  }
  return c;
}

/** 检查切点 j 是否会在相邻句首或句尾制造孤立残片或悬挂引导短语 */
function createsOrphanFragment(j, kinds, totalCount, spokenStr = '') {
  if (j <= 0 || j >= totalCount) return true;
  // 切点必须落在句末或分句标点之后，杜绝词中硬切
  if (kinds[j] !== 'sentence' && kinds[j] !== 'clause') {
    return true;
  }
  // 如果切在分句逗号处，但前面离句号太近（<= 11 字或是引导分句），会把下一句的引导头挂在上一镜句尾
  if (kinds[j] === 'clause') {
    for (let d = 1; d <= 18 && j - d >= 0; d++) {
      if (kinds[j - d] === 'sentence' || j - d === 0) {
        const sPos = j - d;
        const leadClause = spokenStr ? spokenStr.slice(sPos, j) : '';
        if (d <= 11 || (leadClause && SETUP_LEADIN_RE.test(leadClause))) {
          return true;
        }
        break;
      }
    }
    // 逗号切点到下一个句号之间如果只剩 <= 11 个字，也不允许把句尾半截劈开挂到下一镜开头
    for (let d = 1; d <= 11 && j + d < totalCount; d++) {
      if (kinds[j + d] === 'sentence') return true;
    }
  }
  return false;
}

/** 用提取到的具象关键词刷新镜头的展示标题与关键词标签（清掉句首前10字伪关键词） */
export function refreshSceneKeywordMetadata(scene, kws = []) {
  const narr = String(scene.narration_text || '').trim();
  const validKws = kws.filter((k) => k && !isMechanicalPrefixKeyword(k, narr));
  const autoKws = validKws.length ? validKws : heuristicKeywordsForScene(scene, narr);

  if (autoKws.length) {
    scene.visual_keywords = autoKws;
    scene.content_keywords = [...autoKws];
  } else {
    const cleanedSearch = cleanSearchKeywordTerm(scene.selected_search_keyword);
    const fallbackKw = cleanedSearch
      ? cleanedSearch.split(/\s+/)[0].slice(0, 6)
      : narr.replace(/^[“"‘'（(【\[\s]+/, '').split(/[，。！？!?、；：]/)[0].slice(0, 6);
    scene.visual_keywords = fallbackKw ? [fallbackKw] : [];
    scene.content_keywords = fallbackKw ? [fallbackKw] : [];
  }

  const primaryKw = scene.visual_keywords[0] || scene.content_keywords[0] || '核心画面';
  const chTitle = scene.chapter_ref || '正文';
  scene.visual_purpose = `${chTitle} · ${primaryKw}`;
  if (scene.ppt_slide_spec) {
    scene.ppt_slide_spec.theme_title = primaryKw;
    scene.ppt_slide_spec.subtitle = narr.slice(0, 32);
  }
  if (scene.procedural_props) {
    scene.procedural_props.headline = primaryKw;
    scene.procedural_props.subheadline = narr.slice(0, 32);
  }
}

/** 统计一段文本里包含多少个完整句末标点 */
function countSentencesInText(text) {
  const m = String(text || '').trim().match(/[。！？!?]+/g);
  return m ? m.length : 0;
}

/** 判断两个相邻镜头是否应该合并（打破一句一镜，支持两句一镜、三句两镜、五句三镜） */
function canMergeAdjacentScenes(sA, sB, durA, durB, cfg, singleSentenceStreak = 0) {
  if (!sA || !sB) return false;
  if ((sA.chapter_ref || '') !== (sB.chapter_ref || '')) return false;
  if (sA.final_asset_id && sB.final_asset_id && sA.final_asset_id !== sB.final_asset_id) return false;

  const combinedMs = durA + durB;
  const textA = String(sA.narration_text || '').trim();
  const textB = String(sB.narration_text || '').trim();
  const kwA = Array.from(new Set([
    ...(Array.isArray(sA.visual_keywords) ? sA.visual_keywords : []),
    ...heuristicKeywordsForScene(sA, textA),
  ])).filter((k) => !isMechanicalPrefixKeyword(k, textA));
  const kwB = Array.from(new Set([
    ...(Array.isArray(sB.visual_keywords) ? sB.visual_keywords : []),
    ...heuristicKeywordsForScene(sB, textB),
  ])).filter((k) => !isMechanicalPrefixKeyword(k, textB));
  const searchA = cleanSearchKeywordTerm(sA.selected_search_keyword);
  const searchB = cleanSearchKeywordTerm(sB.selected_search_keyword);

  // 0. 上一镜存在未闭合的引号（同一句引语被劈成两半）
  if (hasUnclosedQuote(textA) && combinedMs <= 10500) {
    return true;
  }

  // 1. 镜头过短（< 4.2 秒的碎分句）
  if ((durA < cfg.minHoldMergeMs || durB < cfg.minHoldMergeMs) && combinedMs <= cfg.maxMergedShotMs) {
    return true;
  }

  // 2. 同主题/同关键词（相邻两句都在讲同一个核心事物）
  const sharesKeyword = kwA.some((a) => kwB.some((b) => a === b || a.includes(b) || b.includes(a)))
    || (searchA && searchB && searchA === searchB);
  if (sharesKeyword && combinedMs <= cfg.maxSameTopicMergeMs) {
    return true;
  }

  // 3. 上一句尚未结束（以逗号/顿号/冒号/破折号/分号结尾）或下一句是紧接的递进/转折补足从句
  const isUnfinishedA = /[，,、：:；;——]$/.test(textA) || !/[。！？!?”"’'）)】\]]$/.test(textA);
  if ((isUnfinishedA || CONTINUATION_CLAUSE_RE.test(textB)) && combinedMs <= cfg.maxMergedShotMs && !sA._multiKwSplit && !sA._bridged3to2) {
    return true;
  }

  // 4. 后一句是纯过渡/反问/抽象评论句，或者提炼不出新的具象关键词
  const isFillerB = RHETORICAL_OR_FILLER_RE.test(textB)
    || kwB.length === 0
    || (/[？?！!]$/.test(textB) && textB.length <= 22);
  if (isFillerB && combinedMs <= cfg.maxMergedShotMs) {
    return true;
  }

  // 5. 节奏配对（打破连续单句单镜：让连续 4~5s 的单句自动配对成“两句一镜 / 三句两镜 / 五句三镜”）
  const sentA = countSentencesInText(textA);
  const sentB = countSentencesInText(textB);
  if (sentA <= 1 && sentB <= 1 && singleSentenceStreak >= 1 && combinedMs <= 8800 && !(sA.final_asset_id || sB.final_asset_id)) {
    return true;
  }

  return false;
}

/** 执行一次相邻镜头合并扫描 */
export function mergeEligibleScenesPass(scenes, timing, opts = {}) {
  const cfg = { ...PLANNER_DEFAULTS, ...opts };
  if (scenes.length < 2 || !timing) return 0;
  const fullText = scenesText(scenes);
  const { getTime, count } = buildTimeLookup(timing, fullText);
  if (!count) return 0;
  const cutTime = (j) => (j <= 0 ? 0 : j >= count ? timing.audio_duration_ms : Math.max(0, getTime(j)[0] - cfg.leadMs));

  let mergedCount = 0;
  let i = 0;
  let singleSentenceStreak = 0;
  while (i < scenes.length - 1) {
    const { ranges } = sceneSpokenRanges(scenes);
    const [a0, a1] = ranges[i];
    const [b0, b1] = ranges[i + 1];
    const durA = cutTime(a1) - cutTime(a0);
    const durB = cutTime(b1) - cutTime(b0);

    const sentA = countSentencesInText(scenes[i].narration_text);
    if (sentA <= 1 && durA <= 5600) singleSentenceStreak++;
    else singleSentenceStreak = 0;

    if (canMergeAdjacentScenes(scenes[i], scenes[i + 1], durA, durB, cfg, singleSentenceStreak)) {
      const sA = scenes[i];
      const sB = scenes[i + 1];
      sA.narration_text = `${String(sA.narration_text || '').trim()}${String(sB.narration_text || '').trim()}`;
      if (!sA.final_asset_id && sB.final_asset_id) {
        sA.final_asset_id = sB.final_asset_id;
        sA.status = sB.status;
        sA.visual_type = sB.visual_type;
        sA.scene_type = sB.scene_type;
        sA.source_mode = sB.source_mode;
      }
      const mergedKws = [
        ...(Array.isArray(sA.visual_keywords) ? sA.visual_keywords : []),
        ...(Array.isArray(sB.visual_keywords) ? sB.visual_keywords : []),
      ].filter((v, idxSelf, arr) => v && !isMechanicalPrefixKeyword(v, sA.narration_text) && arr.indexOf(v) === idxSelf).slice(0, 3);
      refreshSceneKeywordMetadata(sA, mergedKws);
      scenes.splice(i + 1, 1);
      mergedCount++;
      singleSentenceStreak = 0;
      i++;
      continue;
    }
    i++;
  }
  return mergedCount;
}

/**
 * 动态按关键词与黄金时长重组镜头（打破“一句一镜”）：
 *   0. 自动修复历史遗留的句末 1~4 字孤立悬垂切点
 *   1. 单镜内有 2 个不同具象关键词且时长 >= 5.4s -> 从第二个关键词（吸附分句边界后）拆为 2 镜
 *   2. 过短碎镜 (< 3.4s)、从句续接、无独立画面主体的过渡/反问句、或同主题相邻镜头 -> 自动合并
 */
export function regroupScenesByKeywords(manifest, timing, opts = {}) {
  const cfg = { ...PLANNER_DEFAULTS, ...opts };
  const scenes = manifest.scenes || [];
  if (scenes.length < 2 || !timing) return { mergedCount: 0, keywordSplitCount: 0 };

  const fullText = scenesText(scenes);
  const { getTime, count } = buildTimeLookup(timing, fullText);
  if (!count) return { mergedCount: 0, keywordSplitCount: 0 };

  const kinds = boundaryKinds(fullText);
  const spokenStr = spokenIndex(fullText).chars.join('');
  const cutTime = (j) => (j <= 0 ? 0 : j >= count ? timing.audio_duration_ms : Math.max(0, getTime(j)[0] - cfg.leadMs));

  // 第零阶段：自动修复历史遗留的“句尾悬挂引导短语 / 词中硬切”（如“...。在现实中，”、“...。为了维护这个底线，”、“...推出了电子｜游戏”）
  // 注意：只修复非标点处的词中硬切或句首短引导残片，保留合法的“三句转两镜”句中逗号切点
  {
    const { ranges: initRanges } = sceneSpokenRanges(scenes);
    const snappedStarts = initRanges.map((r, idx) => {
      if (idx === 0) return 0;
      if (scenes[idx]?._bridged3to2 && kinds[r[0]] === 'clause') return r[0];
      const curEnd = r[1];
      const s = snapCutToNaturalBoundary(r[0], kinds, count, spokenStr, curEnd);
      const prevStart = initRanges[idx - 1][0];
      return (s > prevStart + 2 && s < curEnd - 2) ? s : r[0];
    });
    const hasSnap = snappedStarts.some((s, idx) => s !== initRanges[idx][0]);
    if (hasSnap) {
      const fixedRanges = snappedStarts.map((s, idx) => [s, idx + 1 < snappedStarts.length ? snappedStarts[idx + 1] : count]);
      resliceSceneTexts(scenes, fixedRanges);
    }
  }

  // 先为所有当前镜头清理句首前10字伪关键词，刷新真实关键词
  scenes.forEach((s, idx) => {
    delete s._multiKwSplit;
    const presetKws = opts.keywordsByScene?.[idx];
    const kws = Array.isArray(presetKws) && presetKws.length ? presetKws : heuristicKeywordsForScene(s, s.narration_text);
    refreshSceneKeywordMetadata(s, kws);
  });

  // 第一阶段：单镜内多关键词拆镜（让含 2 个具象关键词的中长句拆成 2 个画面）
  let keywordSplitCount = 0;
  for (let idx = 0; idx < scenes.length; idx++) {
    const { ranges } = sceneSpokenRanges(scenes);
    const [a, b] = ranges[idx] || [0, 0];
    if (b - a < 10) continue;
    const t0 = cutTime(a);
    const t1 = cutTime(b);
    const durMs = t1 - t0;
    if (durMs < cfg.multiKeywordSplitMinMs) continue;

    const s = scenes[idx];
    const kws = heuristicKeywordsForScene(s, s.narration_text);
    let splitChar = -1;
    let secondKw = '';

    if (kws.length >= 2) {
      for (let kIdx = 1; kIdx < kws.length; kIdx++) {
        const kw = kws[kIdx];
        const positions = findKeywordPositions(fullText, kw).filter((p) => p > a + 4 && p < b - 4);
        for (const rawP of positions) {
          const snappedP = snapCutToNaturalBoundary(rawP, kinds, count, spokenStr);
          if (snappedP <= a + 4 || snappedP >= b - 4) continue;
          if (createsOrphanFragment(snappedP, kinds, count, spokenStr)) continue;
          const tSplit = cutTime(snappedP);
          if (tSplit - t0 >= cfg.multiKeywordHalfMinMs && t1 - tSplit >= cfg.multiKeywordHalfMinMs) {
            splitChar = snappedP;
            secondKw = kw;
            break;
          }
        }
        if (splitChar > 0) break;
      }
    }

    if (splitChar > 0) {
      const firstKw = kws[0];
      const newIdx = splitAtSpokenIndex(scenes, splitChar);
      if (newIdx >= 0) {
        scenes[idx]._multiKwSplit = true;
        scenes[newIdx]._multiKwSplit = true;
        refreshSceneKeywordMetadata(scenes[idx], firstKw ? [firstKw] : []);
        refreshSceneKeywordMetadata(scenes[newIdx], secondKw ? [secondKw] : []);
        keywordSplitCount++;
        idx++;
      }
    }
  }

  // 第二阶段：两轮智能合镜（先合碎句/未闭合引语/半句，再合连续单句节奏）
  const mergedPass1 = mergeEligibleScenesPass(scenes, timing, cfg);
  const mergedPass2 = mergeEligibleScenesPass(scenes, timing, cfg);
  // 第三阶段：三句转两镜（把无法两句合一的连续 3 个 ~5s 单句镜头，从第 2 句中间的关键词/逗号处重组为 2 个 ~7.5s 的“一句半”镜头）
  const bridged3to2 = bridgeThreeSentencesToTwoShotsPass(scenes, timing, cfg);
  const mergedCount = mergedPass1 + mergedPass2 + bridged3to2;

  return { mergedCount, keywordSplitCount, bridged3to2 };
}

/**
 * 三句转两镜 (3 Sentences -> 2 Shots)：
 * 当连续 3 个镜头都是单句（例如 5.0s + 5.5s + 4.8s = 15.3s），两句合一对单镜太长(>9.2s)，不合又变成“一句一镜”：
 * 自动从中间第 2 句的关键词或分句逗号处切开，将第 2 句前半段并入第 1 镜、后半段并入第 3 镜，
 * 生成两个 7~8.5 秒的“一句半话”镜头，同时天然实现“一句话说到一半切入下一个画面”。
 */
export function bridgeThreeSentencesToTwoShotsPass(scenes, timing, opts = {}) {
  const cfg = { ...PLANNER_DEFAULTS, ...opts };
  if (scenes.length < 3 || !timing) return 0;

  let bridgedCount = 0;
  let i = 0;
  while (i <= scenes.length - 3) {
    const s1 = scenes[i];
    const s2 = scenes[i + 1];
    const s3 = scenes[i + 2];

    if (
      (s1.chapter_ref || '') !== (s2.chapter_ref || '') ||
      (s2.chapter_ref || '') !== (s3.chapter_ref || '')
    ) {
      i++;
      continue;
    }
    // 已有独立绑定素材的镜头不强行跨镜重组
    const boundCount = [s1.final_asset_id, s2.final_asset_id, s3.final_asset_id].filter(Boolean).length;
    if (boundCount >= 2 || s2.final_asset_id) {
      i++;
      continue;
    }

    const sent1 = countSentencesInText(s1.narration_text);
    const sent2 = countSentencesInText(s2.narration_text);
    const sent3 = countSentencesInText(s3.narration_text);
    if (sent1 > 1 || sent2 > 1 || sent3 > 1) {
      i++;
      continue;
    }

    const fullText = scenesText(scenes);
    const { getTime, count } = buildTimeLookup(timing, fullText);
    if (!count) break;
    const kinds = boundaryKinds(fullText);
    const spoken = spokenIndex(fullText).chars;
    const spokenStr = spoken.join('');
    const { ranges } = sceneSpokenRanges(scenes);
    const cutTime = (j) => (j <= 0 ? 0 : j >= count ? timing.audio_duration_ms : Math.max(0, getTime(j)[0] - cfg.leadMs));

    const [a1] = ranges[i];
    const [a2, b2] = ranges[i + 1];
    const [, b3] = ranges[i + 2];
    const tStart = cutTime(a1);
    const tEnd = cutTime(b3);
    const total3Ms = tEnd - tStart;

    if (total3Ms < 10200 || total3Ms > 18800 || b2 - a2 < 8) {
      i++;
      continue;
    }

    // 在第 2 句内部寻找最佳切点（优先：后半句关键词起点/分句逗号/转折词）
    const kws2 = heuristicKeywordsForScene(s2, s2.narration_text);
    const kws3 = heuristicKeywordsForScene(s3, s3.narration_text);
    const kwTargets = new Set();
    for (const kw of [...kws2, ...kws3]) {
      for (const pos of findKeywordPositions(fullText, kw)) {
        if (pos > a2 + 2 && pos < b2 - 2) {
          kwTargets.add(pos);
          // 若关键词前 1~8 字有逗号，把该逗号也作为首选切点
          for (let d = 1; d <= 8 && pos - d > a2 + 2; d++) {
            if (kinds[pos - d] === 'clause' || kinds[pos - d] === 'sentence') {
              kwTargets.add(pos - d);
              break;
            }
          }
        }
      }
    }

    let bestJ = -1;
    let bestScore = -Infinity;
    for (let j = a2 + 4; j <= b2 - 4; j++) {
      const kind = kinds[j];
      // 必须落在自然分句标点（逗号/分号/冒号）或句号后，绝不把词语从中间劈开
      if (kind !== 'clause' && kind !== 'sentence') continue;
      const isKw = kwTargets.has(j);
      const isTurn = TURN_WORDS.some((w) => spokenStr.startsWith(w, j));

      const tMid = cutTime(j);
      const durLeft = tMid - tStart;
      const durRight = tEnd - tMid;
      if (durLeft < 4200 || durLeft > cfg.maxShotMs) continue;
      if (durRight < 4200 || durRight > cfg.maxShotMs) continue;

      let score = 4.0;
      if (isKw) score += 3.5;
      if (isTurn) score += 2.0;
      // 越接近两镜均衡越好
      score -= Math.abs(durLeft - durRight) / 1500;
      if (score > bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }

    if (bestJ > 0) {
      // 将 s1..s3 的区间重切为 [a1, bestJ) 和 [bestJ, b3)，先把 s2 文本并入 s1 再删掉 s2，确保全文总字数 100% 不丢失
      const rebuilt = [];
      ranges.forEach((r, idx) => {
        if (idx === i) rebuilt.push([a1, bestJ]);
        else if (idx === i + 1) { /* 合并入前后两镜 */ }
        else if (idx === i + 2) rebuilt.push([bestJ, b3]);
        else rebuilt.push(r);
      });
      if (!s1.final_asset_id && s2.final_asset_id) {
        s1.final_asset_id = s2.final_asset_id;
        s1.status = s2.status;
        s1.visual_type = s2.visual_type;
        s1.scene_type = s2.scene_type;
        s1.source_mode = s2.source_mode;
      }
      s1.narration_text = `${String(s1.narration_text || '')}${String(s2.narration_text || '')}`;
      scenes.splice(i + 1, 1);
      resliceSceneTexts(scenes, rebuilt);
      scenes[i]._bridged3to2 = true;
      scenes[i + 1]._bridged3to2 = true;
      refreshSceneKeywordMetadata(scenes[i], heuristicKeywordsForScene(scenes[i], scenes[i].narration_text));
      refreshSceneKeywordMetadata(scenes[i + 1], heuristicKeywordsForScene(scenes[i + 1], scenes[i + 1].narration_text));
      bridgedCount++;
      // 保留 i+1 可与后续镜头继续组合，向前推进 1 镜（使得 5 句可平滑转为 3 镜）
      i += 1;
      continue;
    }
    i++;
  }
  return bridgedCount;
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

  // 每个镜头的关键词位置（全文发音字下标），并将关键词起点自动吸附到自然分句边界
  const kwPos = scenes.map((s, i) => {
    const [a, b] = ranges[i];
    const prevA = i > 0 ? ranges[i - 1][0] : a;
    const winText = spoken.slice(prevA, b).join('');
    let kws = opts.keywordsByScene?.[i];
    if (!Array.isArray(kws) || !kws.length) kws = heuristicKeywordsForScene(s, winText);
    const pos = [];
    for (const kw of kws) {
      const len = Array.from(kw).filter(isSpoken).length;
      for (const rawP of findKeywordPositions(text, kw)) {
        if (rawP >= prevA && rawP < b) {
          const snappedP = snapCutToNaturalBoundary(rawP, kinds, count, spokenStr);
          const effectiveP = (snappedP >= prevA && snappedP < b) ? snappedP : rawP;
          pos.push({ p: effectiveP, rawP, len, kw });
        }
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
    const lo = Math.max(starts[i - 1] + 5, ranges[i - 1][0] + 5);
    const hi = b - 5;
    if (lo > hi) continue;
    const origT = cutTime(orig);
    const prevCut = i - 1 === 0 ? 0 : cutTime(starts[i - 1]);
    const nextSceneEnd = i + 1 < scenes.length && ranges[i + 1][1] > ranges[i + 1][0] ? cutTime(ranges[i + 1][0]) : timing.audio_duration_ms;
    // 上一个镜头自己的关键词位置：切点不能把它切到下一镜头去
    const prevOwnKw = kwPos[i - 1].pos.filter((k) => k.p >= ranges[i - 1][0]).map((k) => k.rawP + k.len);
    const mustAfter = prevOwnKw.length ? Math.max(...prevOwnKw.filter((e) => e <= a)) : -1;

    let best = { j: orig, score: -Infinity, reason: 'keep' };
    for (let j = lo; j <= hi; j++) {
      const t = cutTime(j);
      if (Math.abs(t - origT) > cfg.maxShiftMs) continue;
      if (t - prevCut < cfg.minShotMs) continue;
      if (nextSceneEnd - t < cfg.minShotMs) continue;
      if (mustAfter >= 0 && j < mustAfter) continue;
      if (j !== orig && createsOrphanFragment(j, kinds, count, spokenStr)) continue;

      const kind = kinds[j];
      const kwHere = kwPos[i].pos.find((k) => k.p === j);
      const pause = pauseBefore(j);
      if (!kwHere && !kind && pause < 150 && !turnAt(j) && j !== orig) continue;

      let score = 0;
      const reason = [];
      if (kwHere) {
        score += 6.5 + Math.min(3, kwHere.len * 0.6);
        reason.push(`关键词「${kwHere.kw}」`);
      }
      if (kind === 'sentence') { score += 3.2; reason.push('句末'); }
      else if (kind === 'clause') { score += 1.8; reason.push('分句切入'); }
      if (pause >= 150) { score += Math.min(2, pause / 250); if (!kind) reason.push('气口停顿'); }
      if (turnAt(j)) { score += 1.6; reason.push('转折词'); }
      if (j === orig && !createsOrphanFragment(orig, kinds, count, spokenStr)) { score += 1.2; }
      score -= Math.abs(t - origT) / 1800;
      if (kwHere && j > orig + 0.55 * (b - a)) score -= 2.0;
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
        mid_sentence: kinds[best.j] !== 'sentence',
        preview: `${spoken.slice(Math.max(0, best.j - 8), best.j).join('')}｜${spoken.slice(best.j, best.j + 10).join('')}`,
      });
    }
  }

  const newRanges = starts.map((s, i) => [s, i + 1 < starts.length ? starts[i + 1] : count]);

  // 长镜头切分建议
  const splitSuggestions = [];
  newRanges.forEach(([a, b], i) => {
    if (b - a < 10) return;
    const t0 = i === 0 ? 0 : cutTime(a);
    const t1 = i + 1 < newRanges.length ? cutTime(b) : timing.audio_duration_ms;
    if (t1 - t0 <= cfg.maxShotMs) return;
    let best = null;
    for (let j = a + 5; j < b - 5; j++) {
      const t = cutTime(j);
      if (t - t0 < 2400 || t1 - t < 2400) continue;
      if (createsOrphanFragment(j, kinds, count, spokenStr)) continue;
      const kind = kinds[j];
      const pause = pauseBefore(j);
      const kwHere = kwPos[i].pos.find((k) => k.p === j);
      if (!kwHere && !kind && pause < 150 && !turnAt(j)) continue;
      let score = (kwHere ? 4.5 : 0) + (kind === 'sentence' ? 3 : kind === 'clause' ? 2.2 : 0) + Math.min(2, pause / 250) + (turnAt(j) ? 1.5 : 0);
      score -= Math.abs((t - t0) - (t1 - t0) / 2) / 2500;
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

  return {
    newRanges,
    changes,
    splitSuggestions,
    stats: rhythmStats(newRanges, kinds, cutTime, timing.audio_duration_ms, cfg),
    keywords: kwPos.map((k) => k.kws),
  };
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
  const midCuts = cuts.filter((k) => k !== 'sentence').length;
  const warnings = [];
  const cv = mean ? sd / mean : 0;
  if (cv < 0.25 && n > 6) warnings.push(`画面长度太平均（变化系数 ${cv.toFixed(2)}），节奏单调`);
  if (cuts.length > 6 && sentenceCuts / cuts.length > 0.9) warnings.push(`${Math.round((sentenceCuts / cuts.length) * 100)}% 的换画面都卡在句号上，显得机械`);
  const tooLong = durs.filter((d) => d > cfg.maxShotMs).length;
  const tooShort = durs.filter((d) => d < cfg.minShotMs).length;
  if (tooLong) warnings.push(`${tooLong} 个画面超过 ${(cfg.maxShotMs / 1000).toFixed(1)} 秒`);
  if (tooShort) warnings.push(`${tooShort} 个画面短于 ${(cfg.minShotMs / 1000).toFixed(1)} 秒，会闪`);
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
 * 前引号/左括号（“‘(《【[）自动跟随它后面的发音字所属镜头，其他标点跟随前面的字。
 */
export function resliceSceneTexts(scenes, newRanges) {
  const text = scenesText(scenes);
  const pieces = newRanges.map(() => '');
  let j = -1;
  let owner = 0;
  let pendingLeadingPunct = '';

  for (const ch of text) {
    if (isSpoken(ch)) {
      j++;
      while (owner + 1 < newRanges.length && j >= newRanges[owner + 1][0]) owner++;
      if (pendingLeadingPunct) {
        pieces[owner] += pendingLeadingPunct;
        pendingLeadingPunct = '';
      }
      pieces[owner] += ch;
    } else if (OPENING_PUNCT_RE.test(ch)) {
      pendingLeadingPunct += ch;
    } else {
      if (pendingLeadingPunct) {
        pieces[owner] += pendingLeadingPunct;
        pendingLeadingPunct = '';
      }
      pieces[owner] += ch;
    }
  }
  if (pendingLeadingPunct && pieces.length) {
    pieces[pieces.length - 1] += pendingLeadingPunct;
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
