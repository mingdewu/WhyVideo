import fs from 'fs';
import path from 'path';
import { getPaths } from './config.mjs';
import { getProjectTiming, recalculateTimelines, syncTableToManifest, recompileProject } from './project-store.mjs';
import { buildVirtualChapterSections, getFinalScriptRawText, parseMarkdownToScriptSegments, createProjectFromScript } from './script-parser.mjs';
import { extractJsonFromText, searchWriterTavily, fetchWriterTavilyResults, researchFactMaterials, callOpenRouterText } from './llm-gateway.mjs';
import { renderWriterPrompt } from '../../writer-prompts.mjs';
import { buildTimeLookup, scenesText } from '../../narration-timing.mjs';
import {
  regroupScenesByKeywords,
  planCuts,
  resliceSceneTexts,
  splitAtSpokenIndex,
  mergeEligibleScenesPass,
  bridgeThreeSentencesToTwoShotsPass,
  refreshSceneKeywordMetadata,
} from '../../cut-planner.mjs';

export function getWriterData(projectId) {
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


export function getWriterProjectData(projectId) {
  const paths = getPaths(projectId);
  let brief = null;
  let evidenceCards = [];
  let outline = null;
  let chapters = [];
  let finalScript = null;
  let materials = '';
  let manifest = null;

  if (fs.existsSync(paths.briefPath)) {
    try { brief = JSON.parse(fs.readFileSync(paths.briefPath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.evidencePath)) {
    try { evidenceCards = JSON.parse(fs.readFileSync(paths.evidencePath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.outlinePath)) {
    try { outline = JSON.parse(fs.readFileSync(paths.outlinePath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.materialsPath)) {
    try { materials = fs.readFileSync(paths.materialsPath, 'utf8'); } catch (e) {}
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
    chapters.sort((a, b) => (Number(a.chapter_number) || 0) - (Number(b.chapter_number) || 0));
  }
  if (fs.existsSync(paths.finalScriptPath)) {
    try { finalScript = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(paths.manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')); } catch (e) {}
  }

  // 兜底补齐：若没有 finalScript 且非用户主动清零重写的空白草稿，从 scene-manifest.json 反向聚合定稿文案
  const manifestMatchesBrief = !brief?.title || !manifest?.project_title || manifest.project_title === brief.title;
  if (!finalScript && !brief?._blank_draft && manifestMatchesBrief && manifest && Array.isArray(manifest.scenes) && manifest.scenes.length > 0) {
    const chapterMap = new Map();
    for (const sc of manifest.scenes) {
      const ref = sc.chapter_ref || '正文';
      if (!chapterMap.has(ref)) chapterMap.set(ref, []);
      if (sc.narration_text) chapterMap.get(ref).push(sc.narration_text.trim());
    }
    const segChapters = Array.from(chapterMap.entries()).map(([chTitle, lines], idx) => ({
      chapter_number: idx + 1,
      chapter_title: chTitle,
      narration_text: lines.join('\n'),
    }));
    const rawText = segChapters.map((c) => c.narration_text).join('\n\n');
    finalScript = {
      project_id: projectId,
      title: manifest.project_title || projectId,
      total_word_count: rawText.length,
      estimated_duration_minutes: Number(((manifest.total_duration_sec || rawText.length / 4) / 60).toFixed(1)),
      revision_count: 0,
      script_segments: { chapters: segChapters },
      _hydrated_from_manifest: true,
    };
  }

  // 标准化 finalScript（兼容 full_narration_text / approved_narration_sentences / content 格式）
  if (finalScript) {
    if (!finalScript.script_segments) {
      const fallbackText =
        finalScript.full_narration_text ||
        (Array.isArray(finalScript.approved_narration_sentences)
          ? finalScript.approved_narration_sentences.join('\n')
          : '') ||
        finalScript.content ||
        '';
      if (fallbackText) {
        finalScript.script_segments = {
          chapters: [
            {
              chapter_number: 1,
              chapter_title: finalScript.title || '完整正文',
              narration_text: fallbackText,
            },
          ],
        };
      } else {
        const mdCandidates = [
          finalScript.final_script_markdown_path,
          path.join(paths.dataDir, 'narration-script.md'),
        ].filter(Boolean);
        for (const mdPath of mdCandidates) {
          if (fs.existsSync(mdPath)) {
            try {
              const mdText = fs.readFileSync(mdPath, 'utf8');
              if (mdText.trim()) {
                finalScript.script_segments = parseMarkdownToScriptSegments(
                  mdText,
                  finalScript.title || '完整正文'
                );
                break;
              }
            } catch (e) {}
          }
        }
      }
    }
    // 清洗旧格式：若 script_segments.chapters 首尾把「开篇导引」或「单片终局结尾」当作普通章且无独立 opening/ending，自动剥离并重新编号，同时消除重复的 "第2章: 第1章:" 前缀
    if (finalScript.script_segments && Array.isArray(finalScript.script_segments.chapters)) {
      const seg = finalScript.script_segments;
      const chList = [...seg.chapters];
      if (!seg.opening && chList.length > 2) {
        const firstClean = String(chList[0]?.chapter_title || '').replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '').trim();
        if (/^(?:开篇|开场|导引|导读|引言)/.test(firstClean)) {
          seg.opening = String(chList.shift()?.narration_text || '').trim();
        }
      }
      if (!seg.ending && chList.length > 1) {
        const lastClean = String(chList[chList.length - 1]?.chapter_title || '').replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '').trim();
        if (/^(?:单片终局|全片终局|全片唯一|终局|结尾|收尾|结局)/.test(lastClean)) {
          seg.ending = String(chList.pop()?.narration_text || '').trim();
        }
      }
      seg.chapters = chList.map((ch, idx) => {
        const cleanTitle = String(ch?.chapter_title || '')
          .replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '')
          .trim();
        return {
          ...ch,
          chapter_number: idx + 1,
          chapter_title: cleanTitle ? `第${idx + 1}章: ${cleanTitle}` : `第${idx + 1}章`,
        };
      });
    }
    const rawText = getFinalScriptRawText(finalScript);
    if (!finalScript.total_word_count || finalScript.total_word_count === 0) {
      finalScript.total_word_count = rawText.replace(/\s+/g, '').length;
    }
    if (!finalScript.estimated_duration_minutes) {
      if (finalScript.total_duration_sec) {
        finalScript.estimated_duration_minutes = Number((finalScript.total_duration_sec / 60).toFixed(1));
      } else {
        finalScript.estimated_duration_minutes = Number((finalScript.total_word_count / 240).toFixed(1));
      }
    }
  }

  // 标准化 materials
  if (!materials && brief && brief.reference_materials) {
    materials = Array.isArray(brief.reference_materials)
      ? brief.reference_materials.join('\n\n')
      : String(brief.reference_materials || '');
  }

  // 兜底补齐：若工程缺少 brief，则根据已有成片/定稿信息生成准确 Brief
  if (!brief) {
    let defaultTitle = projectId.replace(/^why_/, '').replace(/_\d+$/, '').replace(/_/g, ' ');
    if (finalScript && finalScript.title) defaultTitle = finalScript.title;
    else if (manifest && manifest.project_title) defaultTitle = manifest.project_title;

    const realChaptersCount =
      (finalScript?.script_segments?.chapters && finalScript.script_segments.chapters.length) ||
      (outline && Array.isArray(outline.chapters) && outline.chapters.length) ||
      6;
    const realDurationMin =
      (finalScript && finalScript.estimated_duration_minutes) ||
      (manifest && manifest.total_duration_sec ? Number((manifest.total_duration_sec / 60).toFixed(1)) : 25);

    brief = {
      project_id: projectId,
      title: defaultTitle || '为什么……？',
      core_question: `为什么${defaultTitle}？背后的地理、历史与经济机制是什么？`,
      short_answer: finalScript?.script_segments?.opening?.slice(0, 180) || '核心因果脉络与底层机制拆解。',
      target_duration_minutes: realDurationMin || 25,
      estimated_word_count: finalScript?.total_word_count || 6500,
      planned_chapter_count: realChaptersCount,
      scope: {
        time_range: '历史演进与现代机理',
      },
      taboos_and_exclusions: ['零编造', '严禁模仿特定博主口吻', '确保客观中立事实论证'],
      reference_materials: [],
    };
  } else {
    if (!brief.short_answer && brief.tentative_conclusion) {
      brief.short_answer = brief.tentative_conclusion;
    }
    if (!brief.taboos_and_exclusions && brief.forbidden_claims) {
      brief.taboos_and_exclusions = brief.forbidden_claims;
    }
  }

  // 兜底补齐：若无 outline 但有 finalScript，提取结构化大纲（字段严格对齐前端 renderOutlineView）
  if (!outline && finalScript && finalScript.script_segments && Array.isArray(finalScript.script_segments.chapters)) {
    outline = {
      project_id: projectId,
      title: finalScript.title || brief.title,
      approval_status: 'approved',
      human_review_notes: '已由定稿文案自动提取大纲映射',
      opening_hook: {
        opening_question: brief.core_question || `关于《${finalScript.title || brief.title}》的核心疑问`,
        immediate_short_answer: (finalScript.script_segments.opening || brief.short_answer || '').slice(0, 220),
        supporting_evidence_ids: [],
      },
      chapters: finalScript.script_segments.chapters.map((ch, idx) => {
        const text = ch.narration_text || '';
        const firstSentence = text.split(/[。！？!?\n]/)[0] || '';
        return {
          chapter_number: ch.chapter_number || idx + 1,
          chapter_title: ch.chapter_title || `第${idx + 1}章`,
          sub_question: firstSentence ? `${firstSentence.slice(0, 48)}${firstSentence.length > 48 ? '...' : ''}` : `第${idx + 1}章核心问题探讨`,
          direct_reason_to_title: ch.direct_reason_to_title || text.slice(0, 80) + (text.length > 80 ? '...' : ''),
          mechanism_or_background_summary: text.slice(0, 120) + (text.length > 120 ? '...' : ''),
          supporting_evidence_ids: [],
          transition_to_next: '',
        };
      }),
      single_ending_plan: {
        revisit_core_question: brief.core_question || '',
        final_takeaway: (finalScript.script_segments.ending || '').slice(0, 160),
      },
      _hydrated_from_script: true,
    };
  } else if (outline && Array.isArray(outline.chapters)) {
    // 兼容旧字段名映射
    outline.chapters = outline.chapters.map((ch, idx) => ({
      ...ch,
      chapter_number: ch.chapter_number || idx + 1,
      sub_question: ch.sub_question || ch.core_question || `第${idx + 1}章核心探讨`,
      direct_reason_to_title: ch.direct_reason_to_title || ch.direct_answer_to_title || ch.mechanism_or_background_summary || ch.mechanism || '',
      mechanism_or_background_summary: ch.mechanism_or_background_summary || ch.mechanism || '',
      supporting_evidence_ids: getWriterEvidenceIds(ch),
    }));
  }

  // 兜底补齐：若分章文件缺失，从 finalScript.script_segments.chapters 自动反填各章内容，确保逐章查看绝不空白
  if (finalScript && finalScript.script_segments && Array.isArray(finalScript.script_segments.chapters)) {
    const existingByNum = new Map(chapters.map((c) => [Number(c.chapter_number), c]));
    const hydratedChapters = [];
    finalScript.script_segments.chapters.forEach((scCh, idx) => {
      const chNum = Number(scCh.chapter_number || idx + 1);
      if (existingByNum.has(chNum)) {
        hydratedChapters.push(existingByNum.get(chNum));
      } else {
        const text = scCh.narration_text || '';
        const outlineCh = outline?.chapters?.find((oc) => Number(oc.chapter_number) === chNum);
        hydratedChapters.push({
          project_id: projectId,
          chapter_number: chNum,
          chapter_title: scCh.chapter_title || outlineCh?.chapter_title || `第${chNum}章`,
          sub_question: outlineCh?.sub_question || '',
          revision_count: 0,
          sections: buildVirtualChapterSections(text),
          full_chapter_narration: text,
          word_count: text.length,
          _hydrated_from_script: true,
        });
      }
    });
    // 保留超出 finalScript 范围的已存草稿章
    for (const c of chapters) {
      if (!hydratedChapters.some((hc) => Number(hc.chapter_number) === Number(c.chapter_number))) {
        hydratedChapters.push(c);
      }
    }
    chapters = hydratedChapters.sort((a, b) => (Number(a.chapter_number) || 0) - (Number(b.chapter_number) || 0));
  }

  const normalizedEvidence = Array.isArray(evidenceCards)
    ? evidenceCards.map((card) => {
        const normalized = markWriterEvidencePending(card);
        return normalized?.claim_type === 'unverified_fact' && normalized.verification_checked_at && !normalized.verification_status
          ? { ...normalized, verification_status: 'failed', verification_reason: '未找到支持整张卡主张的原文' }
          : normalized;
      })
    : [];
  const hasFinalWords = Boolean(finalScript && (finalScript.total_word_count > 0 || getFinalScriptRawText(finalScript).length > 0));
  const hasExistingContent = Boolean(
    hasFinalWords ||
    chapters.length > 0 ||
    (outline && Array.isArray(outline.chapters) && outline.chapters.length > 0) ||
    normalizedEvidence.length > 0
  );

  let activeStep = 1;
  if (hasFinalWords) {
    activeStep = 5;
  } else if (chapters.length > 0) {
    activeStep = 4;
  } else if (outline && Array.isArray(outline.chapters) && outline.chapters.length > 0) {
    activeStep = 3;
  } else if (normalizedEvidence.length > 0) {
    activeStep = 2;
  }

  return {
    projectId,
    brief,
    materials,
    evidenceCards: normalizedEvidence,
    outline,
    chapters,
    finalScript,
    activeStep,
    hasExistingContent,
  };
}

export function getWriterEvidenceIds(section) {
  const ids = Array.isArray(section?.supporting_evidence_ids)
    ? section.supporting_evidence_ids
    : section?.bound_evidence_ids;
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
    : [];
}

export async function extractWriterEvidence(projectId, stored, brief, materials, modelOptions) {
  const { projectDir } = getPaths(projectId);
  const { title } = brief;
  const tavilyResults = await searchWriterTavily(brief.core_question || title, projectDir);
  let researchedMaterials = null;
  if (!materials) {
    const scriptText = getFinalScriptRawText(stored.finalScript);
    if (scriptText.length > 50) {
      materials = `【工程现有文案正文事实源】\n${scriptText.slice(0, 4000)}`;
    } else {
      materials = await researchFactMaterials(title, { ...modelOptions, projectDir, tavilyResults });
      researchedMaterials = materials;
      saveWriterProjectData(projectId, 'materials', materials);
    }
  }

  const briefJson = JSON.stringify(brief, null, 2);
  const sys = renderWriterPrompt(projectDir, 'W3_evidence', { title, materials, brief_json: briefJson });
  const user = `【视频题目】${title}\n【立项 Brief】\n${briefJson}\n\n【已有资料】\n${materials}\n\n【本次 Tavily 检索结果（摘要仍需原文核查）】\n${tavilyResults}\n\n只为可定位来源且输入内容直接支持的主张建卡。`;
  // Keep the response bounded and repeat the format contract even for custom prompts.
  const outputContract = '\n\n【输出格式】仅输出完整 JSON 数组，最多 12 张卡，每张 evidence_summary 不超过 120 字。每项必须包含 evidence_id、claim_type、evidence_summary、source_title、source_url、reliability。不要添加说明文字或外层对象；资料不足时返回 []，不得编造。';
  let aiText;
  let parsedCards = [];
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryInstruction = attempt ? '\n上一次返回未能解析为有效证据卡，请重新从输入资料提取，最多输出 6 张卡，确保数组和字符串完整闭合。' : '';
    aiText = await callOpenRouterText(sys, user + outputContract + retryInstruction, { ...modelOptions, maxTokens: 6000 });
    const llmError = globalThis.__lastWriterLlmError;
    // Network/authentication failures must not be disguised as JSON errors.
    if (aiText === null) {
      error = llmError || '证据卡模型请求失败，请重试';
      break;
    }
    const parsed = extractJsonFromText(aiText);
    const cards = Array.isArray(parsed) ? parsed
      : [parsed?.evidenceCards, parsed?.evidence_cards, parsed?.cards].find(Array.isArray);
    parsedCards = (cards || []).filter((card) => card && typeof card === 'object' && !Array.isArray(card)
      && typeof card.evidence_summary === 'string' && card.evidence_summary.trim());
    if (parsedCards.length) break;
    if (Array.isArray(cards) && cards.length === 0) {
      error = '模型未从当前资料中提取到证据卡，请补充支持具体事实的来源资料后重试';
      break;
    }
    error = llmError || '模型返回的证据卡格式无效，自动重试后仍无法解析，请重试或更换模型';
  }
  if (!parsedCards.length) return { evidenceCards: [], researchedMaterials, aiText, pendingEvidenceCount: 0, error };
  const suppliedText = `${briefJson}\n${materials}\n${tavilyResults}`;
  let pendingEvidenceCount = 0;
  const evidenceCards = parsedCards.map((card, index) => {
    const normalized = markWriterEvidencePending(card, suppliedText);
    if (normalized.claim_type === 'unverified_fact') pendingEvidenceCount++;
    return { ...normalized, evidence_id: `EV-${String(index + 1).padStart(3, '0')}` };
  });
  return { evidenceCards, researchedMaterials, aiText, pendingEvidenceCount };
}

export function markWriterEvidencePending(card, suppliedText = null) {
  if (!card || card.claim_type !== 'verified_fact') return card;
  if (card.verification_status === 'human_approved') return card;
  const sourceUrl = String(card.source_url || '').trim();
  let validUrl = false;
  try {
    const url = new URL(sourceUrl);
    validUrl = ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch (e) {}
  if (validUrl && (suppliedText === null || suppliedText.includes(sourceUrl))) return card;
  return { ...card, claim_type: 'unverified_fact', reliability: 'low' };
}

export async function verifyWriterEvidenceCard(card, projectDir, modelOptions = {}) {
  const claim = String(card?.evidence_summary || card?.claim || '').trim();
  const checkedAt = new Date().toISOString();
  if (!claim) return { ...card, claim_type: 'unverified_fact', verification_status: 'failed', verification_reason: '主张为空，无法核查', verification_checked_at: checkedAt };
  const searchQuery = claim.slice(0, 300);
  let sources;
  try {
    sources = await fetchWriterTavilyResults(searchQuery, projectDir);
  } catch (error) {
    if (error.message.includes('未返回带来源链接的检索结果')) {
      return { ...card, claim_type: 'unverified_fact', reliability: 'low', verification_status: 'failed', verification_reason: 'Tavily 未找到带来源链接的结果', verification_checked_at: checkedAt };
    }
    throw error;
  }
  const sourceText = sources.map((source, index) =>
    `${index + 1}. 标题：${source.title}\n链接：${source.url}\n检索摘要：${source.content}\n网页正文摘录：${source.rawContent || '无'}`
  ).join('\n\n');
  const system = '你是严格的资料核验员。只根据给出的搜索结果判断完整主张是否得到某一来源直接支持。不能用模型记忆、标题相似或部分数字吻合代替证据。输出且仅输出 JSON 对象：{"supported":true或false,"source_index":1起始整数或0,"supporting_quote":"来源文字中连续出现的原文短句"}。若找不到直接支持完整主张的原文，supported 必须为 false。';
  const user = `待核查主张：${claim}\n\nTavily 找到的来源：\n${sourceText}\n\n引用必须逐字复制上述来源的检索摘要或网页正文摘录，且足以支持主张中的对象、年份、数字、范围与因果表述。`;
  const answer = await callOpenRouterText(system, user, { ...modelOptions, maxTokens: 500 });
  if (!answer) throw new Error(globalThis.__lastWriterLlmError || '自动核验模型未返回结果');
  const decision = extractJsonFromText(answer);
  const index = Number(decision?.source_index) - 1;
  const source = Number.isInteger(index) ? sources[index] : null;
  const quote = String(decision?.supporting_quote || '').trim();
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const sourceBody = normalize(`${source?.content || ''}\n${source?.rawContent || ''}`);
  const claimNumbers = normalize(claim).match(/\d+(?:[.,]\d+)*/g) || [];
  const fullSourceText = normalize(`${source?.title || ''}\n${source?.content || ''}\n${source?.rawContent || ''}`);
  const quoteMatches = quote.length >= 8 && sourceBody.includes(normalize(quote));
  const numbersMatch = claimNumbers.every((number) => fullSourceText.includes(number));
  if (decision?.supported === true && source && quoteMatches && numbersMatch) {
    return {
      ...card,
      claim_type: 'verified_fact',
      source_title: source.title || card.source_title || '',
      source_url: source.url,
      source_excerpt: quote,
      reliability: source.rawContent && normalize(source.rawContent).includes(normalize(quote)) ? 'medium' : 'low',
      verification_method: 'tavily_ai_source_quote',
      verification_status: 'passed',
      verification_reason: '',
      verification_checked_at: checkedAt,
    };
  }
  const reason = !decision?.supported ? '搜索结果未直接支持完整主张'
    : !source ? '模型未给出可定位的来源'
      : !quoteMatches ? '模型引文未在搜索结果中找到'
        : '主张中的数字未全部出现在来源中';
  return { ...card, claim_type: 'unverified_fact', reliability: 'low', verification_status: 'failed', verification_reason: reason, verification_checked_at: checkedAt };
}

export function getWriterChapterNarration(chapter) {
  const directText = [chapter?.full_chapter_narration, chapter?.narration_text]
    .find((text) => typeof text === 'string' && text.trim());
  return directText?.trim() || Object.values(chapter?.sections || {})
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => text.trim())
    .join('\n\n');
}

function normalizeForDedup(sentence) {
  return String(sentence || '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

function getBigrams(str) {
  const s = normalizeForDedup(str);
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function calcBigramSimilarity(a, b) {
  const setA = getBigrams(a);
  const setB = getBigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const bg of setA) {
    if (setB.has(bg)) inter++;
  }
  return (2 * inter) / (setA.size + setB.size);
}

function splitIntoSentencesWithSeparators(text) {
  const raw = String(text || '');
  const tokens = [];
  const regex = /([^。！？!?\n]+[。！？!?”"’']*|\n+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    const part = m[1];
    if (/^\n+$/.test(part)) {
      tokens.push({ type: 'newline', text: part });
    } else {
      tokens.push({ type: 'sentence', text: part });
    }
  }
  return tokens;
}

const EDITORIAL_META_COMMENTARY_PATTERNS = [
  /(?:正式制作[前后时]|正式使用.{0,12}前|制作前必须补充)/,
  /(?:现有(?:证据)?卡库|现有证据卡|本(?:次)?证据卡|(?:这|那)张证据卡|证据卡(?:中|里)?(?:没有|缺少|未提供)|补充(?:统计)?卡)/,
  /(?:待核验原文|尚待核验原文|仍需核对原文|尚未依据原文|待补证|须补证|需补证|\[需要人工核查\]|\[需要人工决策\])/,
  /(?:等这些资料补上|把这些资料补齐后|补齐这些原始证据后)/,
];

/**
 * 剥离泄露进旁白正文中的内部制作/考证元话语，仅移除明确面向创作者或审稿流程的句子。
 */
export function stripEditorialMetaCommentary(text) {
  const raw = String(text || '');
  if (!raw.trim()) {
    return { text: '', removed: [] };
  }

  const tokens = splitIntoSentencesWithSeparators(raw);
  const removed = [];
  const keptTokens = [];

  for (const tok of tokens) {
    if (tok.type !== 'sentence') {
      keptTokens.push(tok);
      continue;
    }
    const trimmed = tok.text.trim();
    if (trimmed && EDITORIAL_META_COMMENTARY_PATTERNS.some((re) => re.test(trimmed))) {
      removed.push(trimmed);
      continue;
    }
    keptTokens.push(tok);
  }

  const cleaned = keptTokens
    .map((t) => t.text)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: cleaned, removed };
}

/**
 * 确定性跨章节去重与去伪结尾清洗器（Deterministic Cross-Segment Deduplicator）
 * 1. 自动剥离并合并把「开篇导引」「单片终局结尾」混入 chapters 数组导致的双倍开篇/结尾；
 * 2. 自动检测跨章节完全重复或高相似度（>= 0.78，长度 >= 14 字）的复读句与抢写句；
 *    - 若开篇末尾抢写了下一章开头，优先保留正文章节里的句子，从开篇末尾剔除；
 *    - 若后续章节重复了前文已讲过的句子或高频车轱辘伪结尾，从后续章节中剔除；
 * 3. 记录清理明细到 editorial_changes_log，确保每次统稿真正去重、绝不增加重复。
 */
export function deduplicateAndCleanScriptSegments(finalScript) {
  if (!finalScript || !finalScript.script_segments) return finalScript;
  const seg = finalScript.script_segments;
  const removedDuplicates = [];
  let removedFalseEndingsCount = Number(finalScript.editorial_changes_log?.removed_false_endings_count) || 0;

  let opening = String(seg.opening || '').trim();
  let ending = String(seg.ending || '').trim();
  const rawChapters = Array.isArray(seg.chapters) ? seg.chapters.map((c) => ({ ...c })) : [];

  // 1. 防止 opening / ending 与 chapters 首尾章节重复
  if (rawChapters.length > 1) {
    const firstTitleClean = String(rawChapters[0]?.chapter_title || '').replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '').trim();
    const firstText = String(rawChapters[0]?.narration_text || '').trim();
    if (/^(?:开篇|开场|导引|导读|引言)/.test(firstTitleClean)) {
      if (!opening) {
        opening = firstText;
        rawChapters.shift();
      } else if (calcBigramSimilarity(opening, firstText) >= 0.55 || firstText.includes(opening.slice(0, 30)) || opening.includes(firstText.slice(0, 30))) {
        // 保留更完整的一版作为 opening，移除重复的首章
        if (firstText.length > opening.length) opening = firstText;
        rawChapters.shift();
        removedDuplicates.push('合并了与开篇导引重复的首章内容');
      }
    }
  }
  if (rawChapters.length > 1) {
    const lastIdx = rawChapters.length - 1;
    const lastTitleClean = String(rawChapters[lastIdx]?.chapter_title || '').replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '').trim();
    const lastText = String(rawChapters[lastIdx]?.narration_text || '').trim();
    if (/^(?:单片终局|全片终局|全片唯一|终局|结尾|收尾|结局)/.test(lastTitleClean)) {
      if (!ending) {
        ending = lastText;
        rawChapters.pop();
      } else if (calcBigramSimilarity(ending, lastText) >= 0.55 || lastText.includes(ending.slice(0, 30)) || ending.includes(lastText.slice(0, 30))) {
        if (lastText.length > ending.length) ending = lastText;
        rawChapters.pop();
        removedDuplicates.push('合并了与终局结尾重复的末章内容');
      }
    }
  }

  // 构建有序段落列表：[opening, ...chapters, ending]
  const orderedBlocks = [];
  if (opening) {
    orderedBlocks.push({ kind: 'opening', label: '开篇导引', text: opening });
  }
  rawChapters.forEach((ch, idx) => {
    const cleanTitle = String(ch.chapter_title || '')
      .replace(/^(?:第\s*\d+\s*章\s*[:：]?\s*)+/, '')
      .trim();
    orderedBlocks.push({
      kind: 'chapter',
      chapterIndex: idx,
      chapter_number: idx + 1,
      chapter_title: cleanTitle ? `第${idx + 1}章: ${cleanTitle}` : `第${idx + 1}章`,
      label: `第${idx + 1}章`,
      text: String(ch.narration_text || '').trim(),
    });
  });
  if (ending) {
    orderedBlocks.push({ kind: 'ending', label: '全片终局结尾', text: ending });
  }

  // 1.5 剥离混入正文的制作/考证元话语（如“正式制作前需补充”“现有证据卡”“待核验原文”等）
  const removedMetaCommentary = [];
  for (const block of orderedBlocks) {
    const metaCleaned = stripEditorialMetaCommentary(block.text);
    if (metaCleaned.removed.length > 0) {
      block.text = metaCleaned.text;
      for (const sent of metaCleaned.removed) {
        const preview = sent.slice(0, 26);
        removedMetaCommentary.push(preview);
        removedDuplicates.push(`移除「${block.label}」中泄露的制作/考证元话语：“${preview}…”`);
      }
    }
  }

  // 2. 检查相邻章节是否存在“上一章末尾抢写下一章开头”的整段/多句重复
  //    注意：严格保护开篇（opening）中的全片核心原因结论句（総纲），若开篇总论点与第1章开头重复，绝不删开篇总论点！
  const isOpeningThesisSentence = (rawText) =>
    /(?:核心原因|根本原因|深层原因|并不是因为|并非因为|从来不是因为|而是因为|而是由|共同决定|共同作用|层原因|个原因|底层逻辑|唯一数学解法|归根结底)/.test(
      String(rawText || '')
    );

  for (let i = 0; i < orderedBlocks.length - 1; i++) {
    const curBlock = orderedBlocks[i];
    const nextBlock = orderedBlocks[i + 1];
    const curTokens = splitIntoSentencesWithSeparators(curBlock.text);
    const nextTokens = splitIntoSentencesWithSeparators(nextBlock.text);
    const nextSentences = nextTokens.filter((t) => t.type === 'sentence').slice(0, 10);
    if (nextSentences.length === 0) continue;

    let leakRemoved = 0;
    const filteredCur = curTokens.filter((tok) => {
      if (tok.type !== 'sentence') return true;
      const normCur = normalizeForDedup(tok.text);
      if (normCur.length < 4) return true;
      // 保护开篇的核心原因结论句，不被当成“抢写第1章”误删
      if (curBlock.kind === 'opening' && isOpeningThesisSentence(tok.text)) {
        return true;
      }
      const matchedNext = nextSentences.find((ns) => {
        const normNext = normalizeForDedup(ns.text);
        if (normCur === normNext) return true;
        return normCur.length >= 12 && normNext.length >= 12 && calcBigramSimilarity(normCur, normNext) >= 0.84;
      });
      if (matchedNext) {
        leakRemoved++;
        return false;
      }
      return true;
    });

    if (leakRemoved > 0) {
      curBlock.text = filteredCur.map((t) => t.text).join('').replace(/\n{3,}/g, '\n\n').trim();
      removedDuplicates.push(`清理了「${curBlock.label}」末尾抢写「${nextBlock.label}」开头的 ${leakRemoved} 句重复内容`);
    }
  }

  // 3. 全局跨章去重与高频车轱辘伪结尾拦截
  // 先扫描各章末尾（最后 6 句）高频复读的引子锚点（如《XXX》或“随着……的发布”在 >=3 个章节末尾重复出现）
  const tailHookCounts = new Map();
  for (let i = 0; i < orderedBlocks.length; i++) {
    const block = orderedBlocks[i];
    if (block.kind !== 'chapter') continue;
    const sents = splitIntoSentencesWithSeparators(block.text).filter((t) => t.type === 'sentence');
    const tailText = sents.slice(-6).map((s) => s.text).join('');
    const bookMatches = tailText.match(/《[^》]{2,20}》/g) || [];
    const uniqueBooks = new Set(bookMatches);
    for (const bk of uniqueBooks) {
      tailHookCounts.set(bk, (tailHookCounts.get(bk) || 0) + 1);
    }
    if (/随着.{1,18}的发布/.test(tailText)) {
      tailHookCounts.set('__RELEASE_HOOK__', (tailHookCounts.get('__RELEASE_HOOK__') || 0) + 1);
    }
  }
  const overusedTailHooks = new Set(
    [...tailHookCounts.entries()].filter(([, count]) => count >= 3).map(([k]) => k)
  );

  const seenSentences = []; // { norm, raw, blockIdx, isTailZone }
  for (let i = 0; i < orderedBlocks.length; i++) {
    const block = orderedBlocks[i];
    const tokens = splitIntoSentencesWithSeparators(block.text);
    const sentenceIndices = tokens
      .map((t, idx) => (t.type === 'sentence' ? idx : -1))
      .filter((idx) => idx !== -1);
    const totalSents = sentenceIndices.length;

    const keptTokens = [];
    for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
      const tok = tokens[tIdx];
      if (tok.type !== 'sentence') {
        keptTokens.push(tok);
        continue;
      }
      const rawSent = tok.text.trim();
      const norm = normalizeForDedup(rawSent);
      if (norm.length < 10) {
        keptTokens.push(tok);
        continue;
      }
      const sentRank = sentenceIndices.indexOf(tIdx);
      const isTailZone = totalSents > 3 && sentRank >= totalSents - 6;
      const isQuestionTransition = /[？?][”"’']*$/.test(rawSent);

      // 精准剔除中间章节末尾机械塞入的高频车轱辘伪结尾单句（严禁使用连坐标记把后续正常的本章原因收束句和过渡桥一刀切掉！）
      if (block.kind === 'chapter' && isTailZone && !isQuestionTransition && overusedTailHooks.size > 0) {
        const hasOverusedBook = [...overusedTailHooks].some((hk) => hk !== '__RELEASE_HOOK__' && rawSent.includes(hk));
        const hasReleasePattern = overusedTailHooks.has('__RELEASE_HOOK__') && /随着.{1,18}的发布/.test(rawSent);
        if (hasOverusedBook || hasReleasePattern) {
          removedFalseEndingsCount++;
          const preview = rawSent.slice(0, 26);
          removedDuplicates.push(`移除「${block.label}」末尾重复伪结尾：“${preview}…”`);
          continue;
        }
      }

      if (norm.length < 14) {
        keptTokens.push(tok);
        continue;
      }

      const dupEntry = seenSentences.find((prev) => {
        if (prev.blockIdx === i) {
          // 同一章内部：完全相同或极高相似（>= 0.88）才算重复
          return prev.norm === norm || calcBigramSimilarity(prev.norm, norm) >= 0.88;
        }
        // 跨章节：完全相同、子串包含（>=16字）或高相似度（>= 0.78，绝不用过低阈值误杀章末因果扣题句）
        if (prev.norm === norm) return true;
        if (norm.length >= 16 && prev.norm.length >= 16 && (prev.norm.includes(norm) || norm.includes(prev.norm))) {
          return true;
        }
        const sim = calcBigramSimilarity(prev.norm, norm);
        return sim >= 0.78;
      });

      if (dupEntry) {
        if (isTailZone && block.kind === 'chapter') {
          removedFalseEndingsCount++;
        }
        const preview = rawSent.slice(0, 26);
        removedDuplicates.push(`移除「${block.label}」中与前文重复的表述：“${preview}…”`);
        continue;
      }

      seenSentences.push({ norm, raw: rawSent, blockIdx: i, isTailZone });
      keptTokens.push(tok);
    }

    block.text = keptTokens.map((t) => t.text).join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 重组 script_segments
  const nextOpeningBlock = orderedBlocks.find((b) => b.kind === 'opening');
  const nextEndingBlock = orderedBlocks.find((b) => b.kind === 'ending');
  const nextChapterBlocks = orderedBlocks.filter((b) => b.kind === 'chapter');

  finalScript.script_segments = {
    ...(nextOpeningBlock?.text ? { opening: nextOpeningBlock.text } : {}),
    chapters: nextChapterBlocks.map((b, idx) => ({
      chapter_number: idx + 1,
      chapter_title: b.chapter_title,
      narration_text: b.text,
    })),
    ...(nextEndingBlock?.text ? { ending: nextEndingBlock.text } : {}),
  };

  const fullRaw = getFinalScriptRawText(finalScript);
  const wordCount = fullRaw.replace(/\s+/g, '').length;
  finalScript.total_word_count = wordCount;
  finalScript.estimated_duration_minutes = Number((wordCount / 240).toFixed(1));

  const existingLog = finalScript.editorial_changes_log || {};
  const prevRemovedArgs = Array.isArray(existingLog.removed_duplicate_arguments)
    ? existingLog.removed_duplicate_arguments
    : [];
  const prevRemovedMeta = Array.isArray(existingLog.removed_meta_commentary)
    ? existingLog.removed_meta_commentary
    : [];
  finalScript.editorial_changes_log = {
    ...existingLog,
    removed_duplicate_arguments: [...new Set([...prevRemovedArgs, ...removedDuplicates])].slice(0, 20),
    removed_meta_commentary: [...new Set([...prevRemovedMeta, ...removedMetaCommentary])].slice(0, 20),
    removed_duplicate_examples: Array.isArray(existingLog.removed_duplicate_examples)
      ? existingLog.removed_duplicate_examples
      : [],
    unified_terms_and_names: Array.isArray(existingLog.unified_terms_and_names)
      ? existingLog.unified_terms_and_names
      : [],
    removed_false_endings_count: removedFalseEndingsCount,
  };

  return finalScript;
}

export function saveWriterProjectData(projectId, part, payload) {
  const paths = getPaths(projectId);
  if (!fs.existsSync(paths.dataDir)) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  if (part === 'brief') {
    const toSaveBrief = { ...payload };
    if (!fs.existsSync(paths.finalScriptPath) && fs.existsSync(paths.briefPath)) {
      try {
        const prevBrief = JSON.parse(fs.readFileSync(paths.briefPath, 'utf8'));
        if (prevBrief?._blank_draft && toSaveBrief._blank_draft === undefined) {
          toSaveBrief._blank_draft = true;
        }
      } catch (e) {}
    }
    fs.writeFileSync(paths.briefPath, JSON.stringify(toSaveBrief, null, 2), 'utf8');
    // 同步标题到 project-config.json 与尚未编排的占位 scene-manifest.json，避免界面显示旧模板标题
    const newTitle = (toSaveBrief.title || '').trim();
    if (newTitle) {
      const projConfigPath = path.join(paths.dataDir, 'project-config.json');
      if (fs.existsSync(projConfigPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(projConfigPath, 'utf8'));
          if (cfg.title !== newTitle) {
            cfg.title = newTitle;
            fs.writeFileSync(projConfigPath, JSON.stringify(cfg, null, 2), 'utf8');
          }
        } catch (e) {}
      }
      if (fs.existsSync(paths.manifestPath)) {
        try {
          const mf = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
          const isSinglePlaceholder =
            Array.isArray(mf.scenes) &&
            mf.scenes.length === 1 &&
            typeof mf.scenes[0]?.narration_text === 'string' &&
            mf.scenes[0].narration_text.includes('点击修改文案');
          if (isSinglePlaceholder) {
            mf.project_title = newTitle;
            mf.title = newTitle;
            mf.scenes[0].narration_text = `${newTitle}（请在文案创作台完成定稿并同步，或点击修改文案）`;
            if (mf.scenes[0].ppt_slide_spec) mf.scenes[0].ppt_slide_spec.theme_title = newTitle;
            if (mf.scenes[0].procedural_props) mf.scenes[0].procedural_props.headline = newTitle;
            fs.writeFileSync(paths.manifestPath, JSON.stringify(mf, null, 2), 'utf8');
          }
        } catch (e) {}
      }
    }
    return { ok: true, message: '立项 Brief 已保存' };
  }
  if (part === 'materials') {
    const text = typeof payload === 'string' ? payload : (payload?.materials || '');
    fs.writeFileSync(paths.materialsPath, text, 'utf8');
    return { ok: true, message: '参考研究资料已保存' };
  }
  if (part === 'evidence' || part === 'evidenceCards') {
    fs.writeFileSync(paths.evidencePath, JSON.stringify(payload || [], null, 2), 'utf8');
    return { ok: true, message: '证据卡库已保存' };
  }
  if (part === 'outline') {
    fs.writeFileSync(paths.outlinePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, message: '结构大纲已保存' };
  }
  if (part === 'chapter') {
    const chNum = Number(payload.chapter_number || 1);
    const chPath = path.join(paths.dataDir, `chapter_${chNum}.json`);
    fs.writeFileSync(chPath, JSON.stringify(payload, null, 2), 'utf8');

    // 若已存在 final-script.json 且有对应章节，同步更新该章文本以保持一致
    if (fs.existsSync(paths.finalScriptPath)) {
      try {
        const fsObj = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8'));
        if (fsObj?.script_segments && Array.isArray(fsObj.script_segments.chapters)) {
          const target = fsObj.script_segments.chapters.find((c) => Number(c.chapter_number) === chNum);
          if (target) {
            target.narration_text = payload.full_chapter_narration || target.narration_text;
            if (payload.chapter_title) target.chapter_title = payload.chapter_title;
            const rawText = getFinalScriptRawText(fsObj);
            fsObj.total_word_count = rawText.replace(/\s+/g, '').length;
            fsObj.estimated_duration_minutes = Number((fsObj.total_word_count / 240).toFixed(1));
            fs.writeFileSync(paths.finalScriptPath, JSON.stringify(fsObj, null, 2), 'utf8');
          }
        }
      } catch (e) {}
    }

    return { ok: true, message: `第 ${chNum} 章已保存` };
  }
  if (part === 'finalScript') {
    let toSave = payload;
    // 若是从 Step 5 文本框手动保存 { title, content }，保留或解析结构化数据
    if (payload && typeof payload.content === 'string' && !payload.script_segments) {
      let existing = {};
      if (fs.existsSync(paths.finalScriptPath)) {
        try { existing = JSON.parse(fs.readFileSync(paths.finalScriptPath, 'utf8')); } catch (e) {}
      }
      const rawContent = payload.content.trim();
      const rawBlocks = rawContent.split(/\n+={10,}\n+/).map((b) => b.trim()).filter(Boolean);
      const blocks = [];
      for (const rb of rawBlocks) {
        if ((rb.match(/^【[^】\n]+】/gm) || []).length > 1) {
          rb.split(/\n+(?=【[^】\n]+】)/).map((s) => s.trim()).filter(Boolean).forEach((s) => blocks.push(s));
        } else {
          blocks.push(rb);
        }
      }
      let parsedSegments = null;
      if (blocks.length > 0 && blocks.some((b) => b.startsWith('【'))) {
        let opening = '';
        let ending = '';
        const chs = [];
        for (const blk of blocks) {
          const m = blk.match(/^【([^】]+)】\n?([\s\S]*)$/);
          if (!m) {
            chs.push({ chapter_number: chs.length + 1, chapter_title: `第${chs.length + 1}章`, narration_text: blk });
            continue;
          }
          const header = m[1].trim();
          const body = (m[2] || '').trim();
          if (header.includes('风格定位') || header.startsWith('待修复')) {
            continue;
          }
          if (header.includes('开篇')) {
            opening = body;
          } else if (header.includes('终局') || header.includes('结尾') || header.includes('收尾')) {
            ending = body;
          } else {
            const chMatch = header.match(/第\s*(\d+)\s*章[：:\s]*(.*)/);
            chs.push({
              chapter_number: chMatch ? Number(chMatch[1]) : chs.length + 1,
              chapter_title: chMatch ? (chMatch[2] || header).trim() : header,
              narration_text: body,
            });
          }
        }
        parsedSegments = {
          ...(opening ? { opening } : {}),
          chapters: chs,
          ...(ending ? { ending } : {}),
        };
      }
      if (!parsedSegments && existing?.script_segments) {
        const refSegs = [];
        if (existing.script_segments.opening) {
          refSegs.push({ type: 'opening', text: existing.script_segments.opening });
        }
        if (Array.isArray(existing.script_segments.chapters)) {
          for (const ch of existing.script_segments.chapters) {
            refSegs.push({
              type: 'chapter',
              chapter_number: ch.chapter_number,
              chapter_title: ch.chapter_title,
              text: ch.narration_text || '',
            });
          }
        }
        if (existing.script_segments.ending) {
          refSegs.push({ type: 'ending', text: existing.script_segments.ending });
        }

        if (refSegs.length > 1 || (refSegs.length === 1 && refSegs[0].chapter_title && refSegs[0].chapter_title !== '完整正文')) {
          if (refSegs.length === 1) {
            parsedSegments = {
              chapters: [{ chapter_number: refSegs[0].chapter_number || 1, chapter_title: refSegs[0].chapter_title, narration_text: rawContent }],
            };
          } else {
            let units = rawContent.split(/\n{2,}/).map((u) => u.trim()).filter(Boolean);
            let joiner = '\n\n';
            if (units.length < refSegs.length) {
              units = rawContent.split(/(?<=[。！？!?])\s*/).map((u) => u.trim()).filter(Boolean);
              joiner = '';
            }
            if (units.length >= refSegs.length) {
              const refLens = refSegs.map((s) => Math.max(1, (s.text || '').replace(/\s+/g, '').length));
              const refTotal = refLens.reduce((a, b) => a + b, 0);
              const refCumRatios = [];
              let rAcc = 0;
              for (const rl of refLens) {
                rAcc += rl;
                refCumRatios.push(rAcc / refTotal);
              }

              const unitCumLens = [];
              let uAcc = 0;
              for (const u of units) {
                uAcc += Math.max(1, u.replace(/\s+/g, '').length);
                unitCumLens.push(uAcc);
              }
              const unitTotal = unitCumLens[unitCumLens.length - 1] || 1;

              const assignedTexts = [];
              let startIdx = 0;
              for (let sIdx = 0; sIdx < refSegs.length - 1; sIdx++) {
                const targetLen = refCumRatios[sIdx] * unitTotal;
                const maxEndIdx = units.length - (refSegs.length - sIdx);
                let bestIdx = startIdx;
                let bestDiff = Infinity;
                for (let uIdx = startIdx; uIdx <= maxEndIdx; uIdx++) {
                  const diff = Math.abs(unitCumLens[uIdx] - targetLen);
                  if (diff < bestDiff) {
                    bestDiff = diff;
                    bestIdx = uIdx;
                  }
                }
                assignedTexts.push(units.slice(startIdx, bestIdx + 1).join(joiner));
                startIdx = bestIdx + 1;
              }
              assignedTexts.push(units.slice(startIdx).join(joiner));

              let newOpening = '';
              let newEnding = '';
              const newChapters = [];
              refSegs.forEach((seg, idx) => {
                const txt = (assignedTexts[idx] || '').trim();
                if (seg.type === 'opening') newOpening = txt;
                else if (seg.type === 'ending') newEnding = txt;
                else {
                  newChapters.push({
                    chapter_number: seg.chapter_number || newChapters.length + 1,
                    chapter_title: seg.chapter_title || `第${newChapters.length + 1}章`,
                    narration_text: txt,
                  });
                }
              });
              parsedSegments = {
                ...(newOpening ? { opening: newOpening } : {}),
                chapters: newChapters,
                ...(newEnding ? { ending: newEnding } : {}),
              };
            }
          }
        }
      }
      const wordCount = rawContent.replace(/【[^】]+】|={10,}|\s+/g, '').length;
      toSave = {
        ...existing,
        project_id: projectId,
        title: payload.title || existing.title || projectId,
        total_word_count: wordCount,
        estimated_duration_minutes: Number((wordCount / 240).toFixed(1)),
        revision_count: (existing.revision_count || 0) + 1,
        ...(payload.humanizeMeta ? { humanize_meta: payload.humanizeMeta } : {}),
        ...(parsedSegments
          ? { script_segments: parsedSegments }
          : {
              full_narration_text: rawContent,
              script_segments: {
                chapters: [
                  {
                    chapter_number: 1,
                    chapter_title: payload.title || existing.title || '完整正文',
                    narration_text: rawContent,
                  },
                ],
              },
            }),
      };
    }
    fs.writeFileSync(paths.finalScriptPath, JSON.stringify(toSave, null, 2), 'utf8');
    return { ok: true, message: '全文文案与终稿已保存', finalScript: toSave };
  }
  return { ok: false, error: '未知数据分区类型: ' + part };
}

export function syncWriterToProducer(projectId, { finalScript, content, title, preserveAssets = true } = {}) {
  const curPaths = getPaths(projectId);
  let oldScenes = [];
  if (preserveAssets && fs.existsSync(curPaths.manifestPath)) {
    try {
      const oldMf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      if (Array.isArray(oldMf.scenes)) oldScenes = oldMf.scenes;
    } catch (e) {}
  }

  let resolvedTitle = (title || finalScript?.title || '').trim();
  if (!resolvedTitle && fs.existsSync(curPaths.briefPath)) {
    try {
      const br = JSON.parse(fs.readFileSync(curPaths.briefPath, 'utf8'));
      if (br.title) resolvedTitle = br.title;
    } catch (e) {}
  }

  // 优先采用用户当前编辑器中实时修改的文本 content，先保存更新 final-script.json
  let scriptInput = '';
  if (typeof content === 'string' && content.trim()) {
    const saved = saveWriterProjectData(projectId, 'finalScript', {
      title: resolvedTitle || projectId,
      content: content.trim(),
    });
    if (saved?.finalScript) {
      resolvedTitle = saved.finalScript.title || resolvedTitle;
      scriptInput = JSON.stringify(saved.finalScript, null, 2);
    } else {
      scriptInput = content.trim();
    }
  } else if (finalScript && typeof finalScript === 'object') {
    scriptInput = JSON.stringify(finalScript, null, 2);
  } else {
    return { ok: false, error: '文案内容不能为空' };
  }

  const result = createProjectFromScript({
    projectId,
    title: resolvedTitle,
    content: scriptInput,
    targetSeconds: 5.5,
    forceProjectId: true,
  });

  if (!result.ok) return result;

  // 自动保留制作台已有镜头的素材绑定、手传模式与自定义动效参数
  let preservedAssetsCount = 0;
  if (preserveAssets && oldScenes.length > 0 && fs.existsSync(curPaths.manifestPath)) {
    try {
      const newMf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const norm = (str) => String(str || '').replace(/[\s，。！？!?、；：“”"‘'（）()]/g, '');
      const oldByNormText = new Map();
      for (const os of oldScenes) {
        const key = norm(os.narration_text);
        if (key && !oldByNormText.has(key)) oldByNormText.set(key, os);
      }

      let changed = false;
      for (const ns of newMf.scenes || []) {
        const key = norm(ns.narration_text);
        let matched = oldByNormText.get(key);
        if (!matched && key.length >= 6) {
          for (const [okKey, os] of oldByNormText.entries()) {
            if (okKey.includes(key) || key.includes(okKey)) {
              matched = os;
              break;
            }
          }
        }
        if (matched && (matched.final_asset_id || matched.source_mode === 'manual_upload' || matched.media_modifiers)) {
          ns.source_mode = matched.source_mode || ns.source_mode;
          if (matched.final_asset_id) ns.final_asset_id = matched.final_asset_id;
          if (matched.visual_type) ns.visual_type = matched.visual_type;
          if (matched.scene_type) ns.scene_type = matched.scene_type;
          if (matched.media_modifiers) ns.media_modifiers = matched.media_modifiers;
          if (Array.isArray(matched.content_keywords) && matched.content_keywords.length > 0) {
            ns.content_keywords = matched.content_keywords;
          }
          if (matched.ppt_slide_spec) ns.ppt_slide_spec = matched.ppt_slide_spec;
          if (matched.status) ns.status = matched.status;
          preservedAssetsCount++;
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(newMf, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn('保留制作台素材映射时跳过异常:', e.message);
    }
  }

  // 如果当前工程已有配音逐字时间轴且文案一致，同步后自动执行关键词/停顿智能排切点（避免退回一句一镜）
  try {
    const timing = getProjectTiming(projectId);
    if (timing && fs.existsSync(curPaths.manifestPath)) {
      const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scenes = mf.scenes || [];
      if (scenes.length >= 2 && !buildTimeLookup(timing, scenesText(scenes)).stale) {
        regroupScenesByKeywords(mf, timing);
        const plan = planCuts(mf, timing);
        resliceSceneTexts(scenes, plan.newRanges);
        for (const sp of [...plan.splitSuggestions].sort((a, b) => b.split_char - a.split_char)) {
          splitAtSpokenIndex(scenes, sp.split_char);
        }
        mergeEligibleScenesPass(scenes, timing);
        bridgeThreeSentencesToTwoShotsPass(scenes, timing);
        scenes.forEach((s) => refreshSceneKeywordMetadata(s, s.visual_keywords || []));
        recalculateTimelines(mf, projectId);
        syncTableToManifest(mf);
        fs.writeFileSync(curPaths.manifestPath, JSON.stringify(mf, null, 2), 'utf8');
        recompileProject(projectId);
        result.totalScenes = scenes.length;
        result.totalDurationSec = mf.total_duration_sec;
      } else if (preservedAssetsCount > 0) {
        recompileProject(projectId);
      }
    } else if (preservedAssetsCount > 0) {
      recompileProject(projectId);
    }
  } catch (e) {
    console.warn('同步制作台后自动排切点跳过:', e.message);
  }

  return { ...result, preservedAssetsCount };
}
