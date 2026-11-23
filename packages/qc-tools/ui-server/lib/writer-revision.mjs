import fs from 'fs';
import path from 'path';
import { getPaths } from './config.mjs';
import { getFinalScriptRawText } from './script-parser.mjs';
import {
  extractJsonFromText,
  getWriterTavilyKey,
  fetchWriterTavilyResults,
  callOpenRouterText,
} from './llm-gateway.mjs';
import {
  getWriterProjectData,
  saveWriterProjectData,
  deduplicateAndCleanScriptSegments,
} from './writer-service.mjs';
import { renderWriterPrompt } from '../../writer-prompts.mjs';

const MAX_SNAPSHOTS = 20;

function resolveModelConfig(projectDir, modelOptions = {}) {
  let apiKey = String(modelOptions.apiKey || '').trim();
  let baseUrl = String(modelOptions.baseUrl || '').trim();
  let model = String(modelOptions.model || '').trim();

  const cfgPath = path.join(projectDir, 'data', 'prompt-config.json');
  if ((!apiKey || !baseUrl || !model) && fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (!apiKey && cfg.apiKey) apiKey = String(cfg.apiKey).trim();
      if (!baseUrl && cfg.baseUrl) baseUrl = String(cfg.baseUrl).trim();
      if (!model && (cfg.writerModel || cfg.textModel || cfg.model)) {
        model = String(cfg.writerModel || cfg.textModel || cfg.model).trim();
      }
    } catch (e) {}
  }

  return { apiKey, baseUrl, model };
}

function getRevisionsDir(projectId) {
  return path.join(getPaths(projectId).dataDir, 'script-revisions');
}

export function extractOrderedSegments(finalScript, fallbackPlainText = '') {
  const segments = [];
  const seg = finalScript?.script_segments;

  if (seg && typeof seg === 'object') {
    if (typeof seg.opening === 'string' && seg.opening.trim()) {
      segments.push({
        seg_id: 'opening',
        kind: 'opening',
        chapter_number: 0,
        title: '开篇导引',
        text: seg.opening.trim(),
      });
    }
    if (Array.isArray(seg.chapters)) {
      seg.chapters.forEach((ch, idx) => {
        const chNum = Number(ch?.chapter_number || idx + 1);
        const title = String(ch?.chapter_title || `第${chNum}章`).trim();
        const text = String(ch?.narration_text || '').trim();
        let kind = 'chapter';
        if (idx === 0 && !seg.opening && /开篇|开场|导引|引言/.test(title)) {
          kind = 'opening';
        } else if (
          idx === seg.chapters.length - 1 &&
          !seg.ending &&
          /结尾|终局|收尾/.test(title)
        ) {
          kind = 'ending';
        }
        segments.push({
          seg_id: `ch_${idx}_${chNum}`,
          kind,
          chapter_number: chNum,
          title,
          text,
        });
      });
    }
    if (typeof seg.ending === 'string' && seg.ending.trim()) {
      segments.push({
        seg_id: 'ending',
        kind: 'ending',
        chapter_number: 999,
        title: '全片终局结尾',
        text: seg.ending.trim(),
      });
    }
  }

  if (segments.length === 0) {
    const raw = String(fallbackPlainText || getFinalScriptRawText(finalScript) || '').trim();
    if (raw) {
      segments.push({
        seg_id: 'ch_0_1',
        kind: 'chapter',
        chapter_number: 1,
        title: finalScript?.title || '完整正文',
        text: raw,
      });
    }
  }

  return segments;
}

export function joinSegmentsText(segments = []) {
  return segments
    .map((s) => String(s?.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function rebuildFinalScriptFromSegments(
  baseFinalScript,
  segments,
  { projectId, title, instruction = '', overallStrategy = '' } = {}
) {
  const existing = baseFinalScript && typeof baseFinalScript === 'object' ? baseFinalScript : {};
  const hadExplicitOpening = typeof existing.script_segments?.opening === 'string';
  const hadExplicitEnding = typeof existing.script_segments?.ending === 'string';

  let opening = '';
  let ending = '';
  const chapters = [];

  for (const seg of segments) {
    const cleanText = String(seg.text || '').trim();
    if (seg.seg_id === 'opening' || (hadExplicitOpening && seg.kind === 'opening')) {
      opening = cleanText;
    } else if (seg.seg_id === 'ending' || (hadExplicitEnding && seg.kind === 'ending')) {
      ending = cleanText;
    } else {
      chapters.push({
        chapter_number: Number(seg.chapter_number || chapters.length + 1),
        chapter_title: seg.title || `第${chapters.length + 1}章`,
        narration_text: cleanText,
      });
    }
  }

  const nextSegments = {
    ...(opening ? { opening } : {}),
    chapters,
    ...(ending ? { ending } : {}),
  };

  const fullRaw = joinSegmentsText(segments);
  const wordCount = fullRaw.replace(/\s+/g, '').length;

  return {
    ...existing,
    project_id: projectId || existing.project_id,
    title: title || existing.title || projectId,
    total_word_count: wordCount,
    estimated_duration_minutes: Number((wordCount / 240).toFixed(1)),
    revision_count: (Number(existing.revision_count) || 0) + 1,
    last_editorial_revision: {
      revised_at: new Date().toISOString(),
      instruction: String(instruction || '').slice(0, 500),
      overall_strategy: String(overallStrategy || '').slice(0, 300),
    },
    script_segments: nextSegments,
  };
}

export function listScriptSnapshots(projectId) {
  const dir = getRevisionsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (parsed && parsed.id) {
        items.push({
          id: parsed.id,
          label: parsed.label || parsed.id,
          instruction: parsed.instruction || '',
          created_at: parsed.created_at || '',
          total_word_count: Number(parsed.total_word_count) || 0,
        });
      }
    } catch (e) {}
  }
  return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function saveScriptSnapshot(projectId, finalScript, { label = '', instruction = '' } = {}) {
  if (!finalScript || typeof finalScript !== 'object') return null;
  const dir = getRevisionsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  const id = `rev_${stamp}_${rand}`;
  const rawText = getFinalScriptRawText(finalScript);
  const wordCount = Number(finalScript.total_word_count) || rawText.replace(/\s+/g, '').length;
  const timeShort = now.toLocaleTimeString('zh-CN', { hour12: false });
  const cleanLabel =
    String(label || '').trim() ||
    (instruction ? `改稿前备份 (${timeShort}) · ${String(instruction).trim().slice(0, 18)}` : `手动备份 (${timeShort})`);

  const record = {
    id,
    label: cleanLabel,
    instruction: String(instruction || '').slice(0, 500),
    created_at: now.toISOString(),
    total_word_count: wordCount,
    finalScript,
  };

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');

  const all = listScriptSnapshots(projectId);
  if (all.length > MAX_SNAPSHOTS) {
    for (const stale of all.slice(MAX_SNAPSHOTS)) {
      try {
        fs.unlinkSync(path.join(dir, `${stale.id}.json`));
      } catch (e) {}
    }
  }

  return record;
}

function syncChaptersFromFinalScript(projectId, finalScript) {
  const paths = getPaths(projectId);
  const segChapters = finalScript?.script_segments?.chapters;
  if (!Array.isArray(segChapters) || !fs.existsSync(paths.dataDir)) return;

  for (const ch of segChapters) {
    const chNum = Number(ch?.chapter_number);
    if (!Number.isInteger(chNum) || chNum < 1) continue;
    const chPath = path.join(paths.dataDir, `chapter_${chNum}.json`);
    if (!fs.existsSync(chPath)) continue;
    try {
      const existingCh = JSON.parse(fs.readFileSync(chPath, 'utf8'));
      existingCh.chapter_title = ch.chapter_title || existingCh.chapter_title;
      existingCh.full_chapter_narration = ch.narration_text || '';
      existingCh.word_count = String(ch.narration_text || '').length;
      existingCh.revision_count = (Number(existingCh.revision_count) || 0) + 1;
      fs.writeFileSync(chPath, JSON.stringify(existingCh, null, 2), 'utf8');
    } catch (e) {}
  }
}

export function restoreScriptSnapshot(projectId, snapshotId) {
  const safeId = String(snapshotId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safeId)) {
    return { ok: false, error: '无效的快照 ID' };
  }
  const filePath = path.join(getRevisionsDir(projectId), `${safeId}.json`);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: '未找到指定历史版本快照' };
  }

  const snap = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!snap?.finalScript) {
    return { ok: false, error: '快照文件内容损坏' };
  }

  const stored = getWriterProjectData(projectId);
  if (stored?.finalScript) {
    saveScriptSnapshot(projectId, stored.finalScript, {
      label: `还原前自动备份 (${new Date().toLocaleTimeString('zh-CN', { hour12: false })})`,
    });
  }

  const saved = saveWriterProjectData(projectId, 'finalScript', snap.finalScript);
  if (!saved?.ok) {
    return { ok: false, error: saved?.error || '还原保存失败' };
  }
  syncChaptersFromFinalScript(projectId, snap.finalScript);

  const refreshed = getWriterProjectData(projectId);

  return {
    ok: true,
    restoredId: safeId,
    finalScript: refreshed.finalScript || saved.finalScript || snap.finalScript,
    outline: refreshed.outline,
    chapters: refreshed.chapters,
    evidenceCards: refreshed.evidenceCards,
    snapshots: listScriptSnapshots(projectId),
  };
}

async function researchNewsForInstruction(instruction, title, projectDir, modelCfg) {
  const tavilyKey = getWriterTavilyKey(projectDir);
  if (!tavilyKey) {
    return {
      facts: [],
      warning: '未配置 Tavily API Key，本次未联网检索最新新闻（可前往「模型与网关配置」填写 Tavily Key，或在意见中直接粘贴新闻原文）。',
    };
  }

  let queries = [];
  try {
    const qSys = renderWriterPrompt(projectDir, 'W8_revision_search', {
      title,
      instruction,
    });
    const qUser = `【视频题目】：${title}\n【总编改稿意见】：${instruction}`;
    const qText = await callOpenRouterText(qSys, qUser, { ...modelCfg, maxTokens: 300 });
    const parsed = extractJsonFromText(qText);
    if (parsed && parsed.need_search === false) {
      return { facts: [], warning: '' };
    }
    if (Array.isArray(parsed?.queries)) {
      queries = parsed.queries.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 2);
    }
  } catch (e) {}

  if (queries.length === 0) {
    queries = [`${title} ${instruction.slice(0, 40)}`.trim()];
  }

  const seenUrls = new Set();
  const facts = [];
  const errors = [];

  for (const q of queries) {
    try {
      const results = await fetchWriterTavilyResults(q, projectDir);
      for (const item of results.slice(0, 4)) {
        if (!item?.url || seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        facts.push({
          query: q,
          title: item.title || '未命名来源',
          url: item.url,
          snippet: String(item.content || item.rawContent || '').trim().slice(0, 500),
        });
      }
    } catch (err) {
      errors.push(`${q}: ${err.message}`);
    }
  }

  return {
    facts: facts.slice(0, 6),
    warning: facts.length === 0 && errors.length ? `联网检索未获取到结果（${errors[0]}），将仅按意见与原稿规划。` : '',
  };
}

function getScopeAllowedSegIds(segments, scope, selectedSegIds = []) {
  if (scope === 'opening') {
    const op = segments.filter((s) => s.kind === 'opening');
    return new Set((op.length ? op : segments.slice(0, 1)).map((s) => s.seg_id));
  }
  if (scope === 'ending') {
    const ed = segments.filter((s) => s.kind === 'ending');
    return new Set((ed.length ? ed : segments.slice(-1)).map((s) => s.seg_id));
  }
  if (scope === 'selected' && Array.isArray(selectedSegIds) && selectedSegIds.length > 0) {
    return new Set(selectedSegIds.map(String));
  }
  return new Set(segments.map((s) => s.seg_id));
}

export async function planEditorialRevision({
  projectId,
  instruction,
  scope = 'full',
  selectedSegIds = [],
  useWebSearch = true,
  currentContent = '',
  modelOptions = {},
}) {
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    return { ok: false, error: '请先输入你的审稿或改稿意见' };
  }

  const paths = getPaths(projectId);
  const stored = getWriterProjectData(projectId);
  const title = stored?.finalScript?.title || stored?.brief?.title || projectId;
  const coreQuestion = String(stored?.brief?.core_question || stored?.outline?.opening_hook?.opening_question || title).trim();
  const shortAnswer = String(stored?.brief?.short_answer || stored?.outline?.opening_hook?.immediate_short_answer || '').trim();
  const segments = extractOrderedSegments(stored?.finalScript, currentContent);
  if (segments.length === 0) {
    return { ok: false, error: '当前工程还没有可修改的定稿文案，请先在阶段 5 生成或粘贴文案' };
  }

  const modelCfg = resolveModelConfig(paths.projectDir, modelOptions);

  let researchedFacts = [];
  let searchWarning = '';
  if (useWebSearch) {
    const researchRes = await researchNewsForInstruction(cleanInstruction, title, paths.projectDir, modelCfg);
    researchedFacts = researchRes.facts;
    searchWarning = researchRes.warning;
  }

  const allowedIds = getScopeAllowedSegIds(segments, scope, selectedSegIds);
  const scopeLabelMap = {
    full: '全篇统筹改稿（可改开篇、受影响章节过渡与结尾，但未受影响章节务必标记 keep 以保护原稿）',
    opening: '仅修改开篇部分（其余章节必须全部标记 keep）',
    ending: '仅修改结尾部分（其余章节必须全部标记 keep）',
    selected: '仅修改用户勾选的指定章节（未勾选章节必须全部标记 keep）',
  };

  const segmentsDigest = segments.map((s, idx) => ({
    index: idx + 1,
    seg_id: s.seg_id,
    kind: s.kind,
    title: s.title,
    editable_in_scope: allowedIds.has(s.seg_id),
    char_count: s.text.length,
    head_preview: s.text.slice(0, 140),
    tail_preview: s.text.length > 180 ? s.text.slice(-100) : '',
  }));

  const factsBlock = researchedFacts.length
    ? researchedFacts
        .map((f, i) => `${i + 1}. ${f.title}\n来源：${f.url}\n摘要：${f.snippet}`)
        .join('\n\n')
    : '（本次未附带外部检索资料；若总编意见涉及新事件，请提醒在改写时保持客观克制、不编造具体数字与日期）';

  const sys = renderWriterPrompt(paths.projectDir, 'W9_revision_plan', {
    title,
    core_question: coreQuestion,
    short_answer: shortAnswer,
    scope: scopeLabelMap[scope] || scopeLabelMap.full,
    instruction: cleanInstruction,
    facts_block: factsBlock,
  });

  const user = [
    `【视频题目】：${title}`,
    `【全片核心设问】：${coreQuestion}`,
    shortAnswer ? `【全片核心原因总纲（改稿必须锁紧的主心骨）】：${shortAnswer}` : '',
    `【改稿作用范围】：${scopeLabelMap[scope] || scopeLabelMap.full}`,
    `【总编审稿与改稿意见】：\n${cleanInstruction}`,
    `【联网查证的新闻与事实参考】：\n${factsBlock}`,
    `【当前全篇章节结构摘要】：\n${JSON.stringify(segmentsDigest, null, 2)}`,
    '请为每一个 seg_id 输出对应的 action、reason 和 edit_instructions（注：若改写 opening，必须在 edit_instructions 中明确要求：用新引子切入反差后，必须在开篇后半段直接亮出全片的核心原因总纲，绝不可删丢总结论！）。',
  ].filter(Boolean).join('\n\n');

  const aiText = await callOpenRouterText(sys, user, { ...modelCfg, maxTokens: 3000 });
  const parsed = extractJsonFromText(aiText);
  if (!parsed || !Array.isArray(parsed.segment_plans)) {
    return {
      ok: false,
      error: globalThis.__lastWriterLlmError || '大模型未能生成结构化的改稿影响方案，请检查模型配置后重试',
      rawAi: aiText,
    };
  }

  const planById = new Map(parsed.segment_plans.map((p) => [String(p?.seg_id || ''), p]));
  const normalizedSegmentPlans = segments.map((s) => {
    const rawItem = planById.get(s.seg_id);
    const allowed = allowedIds.has(s.seg_id);
    let action = rawItem?.action;
    if (!['rewrite', 'light_edit', 'keep'].includes(action)) {
      action = 'keep';
    }
    if (!allowed) {
      action = 'keep';
    }
    return {
      seg_id: s.seg_id,
      kind: s.kind,
      chapter_number: s.chapter_number,
      title: s.title,
      char_count: s.text.length,
      action,
      reason: allowed
        ? String(rawItem?.reason || (action === 'keep' ? '本段不受本次改稿影响，原样保留' : '按总编意见调整'))
        : '不在本次指定作用范围内，原样保留',
      edit_instructions: action === 'keep' ? '' : String(rawItem?.edit_instructions || cleanInstruction),
    };
  });

  if (!normalizedSegmentPlans.some((p) => p.action !== 'keep')) {
    const firstAllowed = normalizedSegmentPlans.find((p) => allowedIds.has(p.seg_id));
    if (firstAllowed) {
      firstAllowed.action = 'rewrite';
      firstAllowed.reason = '按总编意见定向改写本段';
      firstAllowed.edit_instructions = cleanInstruction;
    }
  }

  return {
    ok: true,
    plan: {
      overall_strategy: String(parsed.overall_strategy || '按总编审稿意见对受影响章节进行定向改稿。'),
      new_thread_or_hook: String(parsed.new_thread_or_hook || ''),
      segment_plans: normalizedSegmentPlans,
    },
    researched_facts: researchedFacts,
    search_warning: searchWarning,
  };
}

function cleanNarrationOutput(raw) {
  return String(raw || '')
    .trim()
    .replace(/^```(?:\w+)?\n?|```$/g, '')
    .replace(/<<<SEGMENT_TEXT>>>|<<<END_SEGMENT_TEXT>>>/g, '')
    .replace(/^(?:【[^】]{1,30}】|#{1,6}\s+[^\n]+)\n+/g, '')
    .trim();
}

export async function executeEditorialRevision({
  projectId,
  instruction,
  plan,
  researchedFacts = [],
  currentContent = '',
  modelOptions = {},
}) {
  const cleanInstruction = String(instruction || '').trim();
  const segPlans = Array.isArray(plan?.segment_plans) ? plan.segment_plans : [];
  if (segPlans.length === 0) {
    return { ok: false, error: '改稿方案为空，请先生成改稿影响方案' };
  }

  const paths = getPaths(projectId);
  const stored = getWriterProjectData(projectId);
  const title = stored?.finalScript?.title || stored?.brief?.title || projectId;
  const coreQuestion = String(stored?.brief?.core_question || stored?.outline?.opening_hook?.opening_question || title).trim();
  const shortAnswer = String(stored?.brief?.short_answer || stored?.outline?.opening_hook?.immediate_short_answer || '').trim();
  const originalSegments = extractOrderedSegments(stored?.finalScript, currentContent);
  if (originalSegments.length === 0) {
    return { ok: false, error: '未找到可改写的定稿文案内容' };
  }

  const planById = new Map(segPlans.map((p) => [String(p.seg_id), p]));
  const targets = originalSegments.filter((s) => {
    const action = planById.get(s.seg_id)?.action;
    return action === 'rewrite' || action === 'light_edit';
  });
  if (targets.length === 0) {
    return { ok: false, error: '方案中所有章节均设为「保持不动」，请至少将一个章节设为重写或微调' };
  }

  const modelCfg = resolveModelConfig(paths.projectDir, modelOptions);
  const factsBlock = Array.isArray(researchedFacts) && researchedFacts.length
    ? researchedFacts
        .map((f, i) => `${i + 1}. ${f.title} (${f.url})\n摘要：${f.snippet}`)
        .join('\n\n')
    : '（无额外联网资料；严禁凭空编造未给出的具体销量、日期、数据或引语）';

  const updatedSegments = originalSegments.map((s) => ({ ...s }));
  const changedSegIds = [];

  for (let i = 0; i < updatedSegments.length; i++) {
    const seg = updatedSegments[i];
    const itemPlan = planById.get(seg.seg_id);
    if (!itemPlan || itemPlan.action === 'keep') {
      continue;
    }

    const prevTitle = i > 0 ? updatedSegments[i - 1].title : '';
    const nextTitle = i < updatedSegments.length - 1 ? updatedSegments[i + 1].title : '';

    const modeDesc =
      itemPlan.action === 'rewrite'
        ? '【重写模式 (rewrite)】：围绕总编新方向与本章改写指令重构本段内容，逻辑清晰、口语自然、开篇/论证有力。'
        : '【微调融入模式 (light_edit)】：保留本段绝大部分原有扎实事实与案例，仅按指令微调开头衔接或自然融入呼应，切勿无故删减原有核心论据，也严禁在段末强行附加重复的总结套话。';

    const sys = renderWriterPrompt(paths.projectDir, 'W10_revision_execute', {
      title,
      core_question: coreQuestion,
      short_answer: shortAnswer,
      overall_strategy: plan.overall_strategy || '',
      new_thread_or_hook: plan.new_thread_or_hook || '',
      instruction: cleanInstruction,
      segment_title: seg.title,
      action_mode: itemPlan.action,
      edit_instructions: itemPlan.edit_instructions || cleanInstruction,
    });

    const user = [
      `【视频题目】：${title}`,
      `【全片核心设问】：${coreQuestion}`,
      shortAnswer ? `【全片核心原因结论（全片主线锚点，严禁在改写中弄丢）】：${shortAnswer}` : '',
      `【全篇改稿总策略】：${plan.overall_strategy || ''}`,
      plan.new_thread_or_hook ? `【全篇新增切入点/贯穿暗线】：${plan.new_thread_or_hook}（注：仅在逻辑高度契合处点到为止，严禁在每章结尾机械复读同一句话！）` : '',
      `【总编原始审稿意见】：${cleanInstruction}`,
      `【联网查证参考资料】：\n${factsBlock}`,
      `【当前改写目标】：${seg.title}（${modeDesc}）`,
      `【本段具体改写要求】：${itemPlan.edit_instructions || cleanInstruction}`,
      prevTitle
        ? `【上一章主题】：${prevTitle}`
        : '【位置】：这是全片最开头（开篇导引）。在用新引子或反差抛出核心疑问后，必须在开篇后半段直接点明全片的核心原因总纲（参照【全片核心原因结论】，点出内在驱动原因与外部成立条件），绝不能只抛悬念不给总答案！同时点到为止，严禁提前把第1章的具体故事细节抢写完。',
      nextTitle
        ? `【下一章主题（请在本段末尾先一句话钉死本段对总标题的直接原因贡献，再用一句因果递进设问自然引出下一章，严禁抢写下一章正文）】：${nextTitle}`
        : '【位置】：这是全片最终收尾（ending）。必须清晰汇总并回扣前文拆解出的各层具体原因与真实边界，严禁写成空洞鸡汤或机械套话。',
      `【本段原稿】：\n<<<SEGMENT_TEXT>>>\n${seg.text}\n<<<END_SEGMENT_TEXT>>>`,
      '请直接输出改写后的本段纯口播正文：',
    ]
      .filter(Boolean)
      .join('\n\n');

    const aiText = await callOpenRouterText(sys, user, { ...modelCfg, maxTokens: 4000 });
    const cleaned = cleanNarrationOutput(aiText);
    if (!cleaned || cleaned.length < 20) {
      return {
        ok: false,
        error: globalThis.__lastWriterLlmError
          ? `改写「${seg.title}」时大模型调用失败（${globalThis.__lastWriterLlmError}）`
          : `改写「${seg.title}」未能返回有效正文，请重试`,
      };
    }

    updatedSegments[i].text = cleaned;
    changedSegIds.push(seg.seg_id);
  }

  const beforeText = joinSegmentsText(originalSegments);
  let revisedFinalScript = rebuildFinalScriptFromSegments(stored?.finalScript, updatedSegments, {
    projectId,
    title,
    instruction: cleanInstruction,
    overallStrategy: plan.overall_strategy,
  });
  revisedFinalScript = deduplicateAndCleanScriptSegments(revisedFinalScript);
  const afterText = getFinalScriptRawText(revisedFinalScript);

  return {
    ok: true,
    beforeText,
    afterText,
    revisedFinalScript,
    changedSegIds,
    changedSegmentsCount: changedSegIds.length,
    totalSegmentsCount: updatedSegments.length,
  };
}

export function applyEditorialRevision({
  projectId,
  revisedFinalScript,
  instruction = '',
  researchedFacts = [],
  saveNewEvidenceCards = false,
}) {
  if (!revisedFinalScript || typeof revisedFinalScript !== 'object') {
    return { ok: false, error: '缺少待保存的改稿结果' };
  }

  const stored = getWriterProjectData(projectId);
  if (stored?.finalScript) {
    saveScriptSnapshot(projectId, stored.finalScript, {
      instruction,
    });
  }

  const saved = saveWriterProjectData(projectId, 'finalScript', revisedFinalScript);
  if (!saved?.ok) {
    return { ok: false, error: saved?.error || '保存改稿定稿失败' };
  }

  syncChaptersFromFinalScript(projectId, revisedFinalScript);

  let addedEvidenceCount = 0;
  if (saveNewEvidenceCards && Array.isArray(researchedFacts) && researchedFacts.length > 0) {
    const existingCards = Array.isArray(stored?.evidenceCards) ? [...stored.evidenceCards] : [];
    const existingUrls = new Set(existingCards.map((c) => String(c?.source_url || '').trim()).filter(Boolean));
    for (const fact of researchedFacts) {
      const url = String(fact?.url || '').trim();
      if (!url || existingUrls.has(url)) continue;
      existingUrls.add(url);
      const nextNum = existingCards.length + 1;
      existingCards.push({
        evidence_id: `EV-${String(nextNum).padStart(3, '0')}`,
        claim_type: 'verified_fact',
        evidence_summary: `${fact.title}：${String(fact.snippet || '').slice(0, 180)}`,
        source_title: fact.title || 'Tavily 联网检索来源',
        source_url: url,
        source_excerpt: String(fact.snippet || '').slice(0, 260),
        reliability: 'medium',
        verification_method: 'editorial_revision_tavily',
      });
      addedEvidenceCount++;
    }
    if (addedEvidenceCount > 0) {
      saveWriterProjectData(projectId, 'evidenceCards', existingCards);
    }
  }

  const refreshed = getWriterProjectData(projectId);

  return {
    ok: true,
    finalScript: refreshed.finalScript || saved.finalScript || revisedFinalScript,
    outline: refreshed.outline,
    chapters: refreshed.chapters,
    evidenceCards: refreshed.evidenceCards,
    addedEvidenceCount,
    snapshots: listScriptSnapshots(projectId),
  };
}
