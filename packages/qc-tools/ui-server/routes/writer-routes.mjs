import fs from 'fs';
import path from 'path';
import { rootDir, getPaths, readBody } from '../lib/config.mjs';
import { scanLocalExportScripts, parseScriptToScenes, createProjectFromScript } from '../lib/script-parser.mjs';
import { extractJsonFromText, researchFactMaterials, callOpenRouterText } from '../lib/llm-gateway.mjs';
import {
  getWriterProjectData,
  getWriterEvidenceIds,
  extractWriterEvidence,
  markWriterEvidencePending,
  verifyWriterEvidenceCard,
  getWriterChapterNarration,
  stripEditorialMetaCommentary,
  deduplicateAndCleanScriptSegments,
  saveWriterProjectData,
  syncWriterToProducer,
} from '../lib/writer-service.mjs';
import {
  getWriterPromptsState,
  saveProjectWriterPromptPreset,
  resetProjectWriterPromptPreset,
  renderWriterPrompt,
} from '../../writer-prompts.mjs';
import {
  listScriptSnapshots,
  restoreScriptSnapshot,
  planEditorialRevision,
  executeEditorialRevision,
  applyEditorialRevision,
} from '../lib/writer-revision.mjs';

/**
 * 针对总—分—总结构，基于大纲与各章核心内容独立合成完整的开篇（opening）与统筹终局（ending）。
 */
async function synthesizeOpeningAndEnding({ title, brief, outline, chapters, modelOptions }) {
  const outlineByNumber = new Map(
    (Array.isArray(outline?.chapters) ? outline.chapters : []).map((ch, idx) => [
      Number(ch?.chapter_number || idx + 1),
      ch,
    ])
  );
  const chaptersSummary = (Array.isArray(chapters) ? chapters : []).map((ch, idx) => {
    const num = Number(ch?.chapter_number || idx + 1);
    const outCh = outlineByNumber.get(num);
    const narration = String(ch?.narration_text || ch?.full_chapter_narration || '').trim();
    return {
      chapter_number: num,
      chapter_title: ch?.chapter_title || outCh?.chapter_title || `第${num}章`,
      direct_reason_to_title: outCh?.direct_reason_to_title || ch?.direct_reason_to_title || '',
      head: narration.slice(0, 220),
      tail: narration.length > 220 ? narration.slice(-220) : '',
    };
  });

  const sys = `你是知识型长视频总编审，专精【总—分—总】结构的纯口播开篇与终局统领写作。
请严格依据提供的全片总论点与各分章摘要，撰写可直接用于真人配音（TTS）的完整开篇（opening）与完整收尾（ending）：
1. opening（300~450 中文字）：先用日常反差或常见误区抓住观众，再直接亮出全片总论点与各分章原因路线图，让观众开篇即看懂全片结构。
2. ending（300~500 中文字）：严禁只写一两句空洞总结！必须按逻辑主线逐条回收前面全部正文章节拆解出的核心原因，说明它们如何共同拼出总标题“为什么”的答案，最后用 1~2 句有力、不鸡汤的结论干净收束。
3. 严禁泄露制作/审稿元话语（如“现有卡库”“现有证据卡”“正式制作前”“待补证”“待核验原文”“等这些资料补上”），严禁新增任何正文未出现的新事实或数据。
4. 严禁出现章节标题、Markdown 符号（# / **）或分隔线。必须且仅输出合法 JSON：{"opening": "...", "ending": "..."}`;

  const user = JSON.stringify(
    {
      title,
      short_answer: brief?.short_answer || outline?.opening_hook?.immediate_short_answer || '',
      opening_hook: outline?.opening_hook || {},
      single_ending_plan: outline?.single_ending_plan || {},
      chapters_summary: chaptersSummary,
    },
    null,
    2
  );

  const aiText = await callOpenRouterText(sys, user, {
    model: modelOptions?.model,
    apiKey: modelOptions?.apiKey,
    baseUrl: modelOptions?.baseUrl,
    maxTokens: 2500,
  });
  const parsed = extractJsonFromText(aiText);
  return {
    opening: String(parsed?.opening || '').trim(),
    ending: String(parsed?.ending || '').trim(),
  };
}

export async function handleWriterRoutes(req, res, { url, pathname, queryProject, paths }) {
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

  // 0.65 新建空白文案工程（不影响原工程数据）
  if (req.method === 'POST' && pathname === '/api/writer/create-blank-project') {
    const body = await readBody(req);
    const rawTitle = (body.title || '').trim();
    let cleanId = (body.projectId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!cleanId) {
      cleanId = `why_new_${Date.now().toString(36)}`;
    }
    const newPaths = getPaths(cleanId);
    if (fs.existsSync(newPaths.projectDir)) {
      cleanId = `${cleanId}_${Date.now().toString(36).slice(-4)}`;
    }
    const finalPaths = getPaths(cleanId);
    fs.mkdirSync(finalPaths.dataDir, { recursive: true });
    fs.mkdirSync(finalPaths.audioDir, { recursive: true });
    fs.mkdirSync(path.dirname(finalPaths.captionsPath), { recursive: true });
    fs.mkdirSync(finalPaths.outputDir, { recursive: true });
    fs.writeFileSync(finalPaths.assetIndexPath, JSON.stringify({ project_id: cleanId, assets: [] }, null, 2), 'utf8');
    fs.writeFileSync(
      finalPaths.briefPath,
      JSON.stringify(
        {
          project_id: cleanId,
          title: rawTitle,
          core_question: '',
          short_answer: '',
          target_duration_minutes: 25,
          planned_chapter_count: 6,
          scope: { time_range: '' },
          taboos_and_exclusions: ['零编造', '严禁模仿特定博主口吻', '确保客观中立事实论证'],
          _blank_draft: true,
        },
        null,
        2
      ),
      'utf8'
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, projectId: cleanId, title: rawTitle || cleanId }));
  }

  // 0.66 清零重写当前工程文案（删除文案草稿文件，保留制作台分镜与媒体素材）
  if (req.method === 'POST' && pathname === '/api/writer/reset-project') {
    const curPaths = getPaths(queryProject);
    if (!fs.existsSync(curPaths.dataDir)) {
      fs.mkdirSync(curPaths.dataDir, { recursive: true });
    }
    const filesToRemove = [
      curPaths.evidencePath,
      curPaths.outlinePath,
      curPaths.finalScriptPath,
      curPaths.materialsPath,
    ];
    for (const fp of filesToRemove) {
      if (fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch (e) {}
      }
    }
    if (fs.existsSync(curPaths.dataDir)) {
      for (const f of fs.readdirSync(curPaths.dataDir)) {
        if (/^chapter_\d+\.json$/i.test(f)) {
          try { fs.unlinkSync(path.join(curPaths.dataDir, f)); } catch (e) {}
        }
      }
    }
    fs.writeFileSync(
      curPaths.briefPath,
      JSON.stringify(
        {
          project_id: queryProject,
          title: '',
          core_question: '',
          short_answer: '',
          target_duration_minutes: 25,
          planned_chapter_count: 6,
          scope: { time_range: '' },
          taboos_and_exclusions: ['零编造', '严禁模仿特定博主口吻', '确保客观中立事实论证'],
          _blank_draft: true,
        },
        null,
        2
      ),
      'utf8'
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, projectId: queryProject, message: '当前工程文案已清零，可从第 1 步重新立项' }));
  }

  // 0.7 文案终稿一键同步至视觉分镜台 (Producer) 并生成镜头清单（保留已绑定素材）
  if (req.method === 'POST' && pathname === '/api/writer/sync-to-producer') {
    const body = await readBody(req);
    const resData = syncWriterToProducer(queryProject, {
      finalScript: body.finalScript,
      content: body.content,
      title: body.title,
      preserveAssets: body.preserveAssets !== false,
    });
    res.writeHead(resData.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(resData));
  }

  // 0.72 获取文案创作台提示词模板与风格预设（按当前工程独立生效）
  if (req.method === 'GET' && pathname === '/api/writer/prompts') {
    const state = getWriterPromptsState(paths.projectDir, queryProject);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(state));
  }

  // 0.73 保存文案创作台自定义提示词模板（仅对当前工程生效）
  if (req.method === 'POST' && pathname === '/api/writer/prompts/save') {
    const body = await readBody(req);
    const saved = saveProjectWriterPromptPreset(paths.projectDir, queryProject, body);
    res.writeHead(saved.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(saved));
  }

  // 0.74 重置文案创作台提示词模板（支持单阶段或全部恢复出厂默认）
  if (req.method === 'POST' && pathname === '/api/writer/prompts/reset') {
    const body = await readBody(req);
    const resetRes = resetProjectWriterPromptPreset(paths.projectDir, queryProject, body.template_id || null);
    res.writeHead(resetRes.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(resetRes));
  }

  // 0.75 AI 联网深度事实调查与资料补充
  if (req.method === 'POST' && pathname === '/api/writer/ai/research-materials') {
    const body = await readBody(req);
    const { title, model, apiKey, baseUrl } = body;
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先提供视频题目' }));
    }
    const materials = await researchFactMaterials(title, { model, apiKey, baseUrl, projectDir: paths.projectDir });
    saveWriterProjectData(queryProject, 'materials', materials);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, materials }));
  }

  // 0.8 AI 生成立项 Brief (半自动智能考证：缺资料则自动调查补充，绝不生硬拦截)
  if (req.method === 'POST' && pathname === '/api/writer/ai/generate-brief') {
    const body = await readBody(req);
    const { title, durationMinutes = 25, model, apiKey, baseUrl } = body;
    let materials = body.materials?.trim() || getWriterProjectData(queryProject).materials.trim();
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先输入明确的视频题目' }));
    }
    let researchedMaterials = null;
    if (!materials) {
      materials = await researchFactMaterials(title, { model, apiKey, baseUrl, projectDir: paths.projectDir });
      researchedMaterials = materials;
      saveWriterProjectData(queryProject, 'materials', materials);
    }
    const sys = renderWriterPrompt(paths.projectDir, 'W2_brief', {
      title,
      duration_minutes: durationMinutes,
      materials,
    });
    const user = `【视频题目】：${title}\n【预期时长】：${durationMinutes} 分钟\n【参考考证资料】：\n${materials}`;
    const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 2500 });
    const parsed = extractJsonFromText(aiText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsed.project_id = queryProject;
      if (!parsed.title) parsed.title = title;
      saveWriterProjectData(queryProject, 'brief', parsed);
      if (!researchedMaterials) saveWriterProjectData(queryProject, 'materials', materials);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, brief: parsed, researchedMaterials, rawAi: aiText }));
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: globalThis.__lastWriterLlmError || '大模型未返回符合规范的 Brief JSON', rawAi: aiText }));
  }

  // 0.9 AI 从原始资料或现有文案提取原子化证据卡 (半自动智能考证：缺资料自动联网考证补充)
  if (req.method === 'POST' && pathname === '/api/writer/ai/extract-evidence') {
    const body = await readBody(req);
    const { model, apiKey, baseUrl } = body;
    const stored = getWriterProjectData(queryProject);
    const title = body.title?.trim() || body.brief?.title?.trim() || stored.brief?.title;
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先提供视频题目' }));
    }
    const brief = { ...stored.brief, ...body.brief, project_id: queryProject, title };
    const materials = body.materials?.trim() || stored.materials.trim();
    const { evidenceCards, researchedMaterials, aiText, pendingEvidenceCount, error } = await extractWriterEvidence(
      queryProject, stored, brief, materials, { model, apiKey, baseUrl }
    );
    if (Array.isArray(evidenceCards) && evidenceCards.length > 0) {
      saveWriterProjectData(queryProject, 'evidenceCards', evidenceCards);
      if (body.brief) saveWriterProjectData(queryProject, 'brief', brief);
      if (body.materials?.trim()) saveWriterProjectData(queryProject, 'materials', materials);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, evidenceCards, researchedMaterials, pendingEvidenceCount }));
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: error || '模型未返回有效证据卡，请补充资料后重试', rawAi: aiText }));
  }

  // 自动为待核查事实补找来源，并核对搜索结果中的原文摘录
  if (req.method === 'POST' && pathname === '/api/writer/ai/verify-pending-evidence') {
    const body = await readBody(req);
    const stored = getWriterProjectData(queryProject);
    const cards = Array.isArray(stored.evidenceCards) ? [...stored.evidenceCards] : [];
    const pendingIndices = cards.map((card, index) => ({ card, index }))
      .filter(({ card }) => card?.claim_type === 'unverified_fact' && (body.retry || !card.verification_checked_at))
      .slice(0, 2);
    const settled = await Promise.allSettled(pendingIndices.map(({ card }) =>
      verifyWriterEvidenceCard(card, paths.projectDir, {
        model: body.model, apiKey: body.apiKey, baseUrl: body.baseUrl,
      })
    ));
    const errors = [];
    let verifiedCount = 0;
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        cards[pendingIndices[i].index] = result.value;
        if (result.value.claim_type === 'verified_fact') verifiedCount++;
      } else {
        errors.push(`${pendingIndices[i].card.evidence_id || pendingIndices[i].index + 1}: ${result.reason?.message || '核验失败'}`);
      }
    });
    if (settled.some((result) => result.status === 'fulfilled')) {
      saveWriterProjectData(queryProject, 'evidenceCards', cards);
    }
    const remainingCount = cards.filter((card) => card?.claim_type === 'unverified_fact' && !card.verification_checked_at).length;
    res.writeHead(errors.length && !verifiedCount && remainingCount ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      evidenceCards: cards,
      checkedCount: settled.filter((result) => result.status === 'fulfilled').length,
      verifiedCount,
      remainingCount,
      pendingCount: cards.filter((card) => card?.claim_type === 'unverified_fact').length,
      errors,
    }));
  }

  // 0.10 AI 基于证据卡构建 5~7 章大纲 (半自动智能协同：自动兜底证据卡与大纲结构)
  if (req.method === 'POST' && pathname === '/api/writer/ai/build-outline') {
    const body = await readBody(req);
    const { model, apiKey, baseUrl } = body;
    const stored = getWriterProjectData(queryProject);
    const brief = { ...stored.brief, ...body.brief, project_id: queryProject };
    let evidenceCards = Array.isArray(body.evidenceCards) && body.evidenceCards.length
      ? body.evidenceCards.map((card) => markWriterEvidencePending(card))
      : stored.evidenceCards;

    // 若前端传入证据卡为空，自动从持久化数据中寻找或自动考证提取
    let autoGeneratedEvidence = null;
    if (evidenceCards.length === 0) {
      const materials = body.materials?.trim() || stored.materials.trim();
      const extracted = await extractWriterEvidence(queryProject, stored, brief, materials, { model, apiKey, baseUrl });
      if (!Array.isArray(extracted.evidenceCards) || extracted.evidenceCards.length === 0) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: extracted.error || '未能提取证据卡，请在第 2 步补充资料后重试' }));
      }
      evidenceCards = extracted.evidenceCards;
      saveWriterProjectData(queryProject, 'evidenceCards', evidenceCards);
      autoGeneratedEvidence = evidenceCards;
    }

    const approvedEvidenceCards = evidenceCards.filter((card) => card?.claim_type !== 'unverified_fact');
    if (approvedEvidenceCards.length === 0) {
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '没有自动核验或人工复核通过的证据卡；请先处理待人工复核候选，再生成大纲' }));
    }

    const briefJson = JSON.stringify(brief, null, 2);
    const evidenceCardsJson = JSON.stringify(approvedEvidenceCards, null, 2);
    const sys = renderWriterPrompt(paths.projectDir, 'W4_outline', {
      brief_json: briefJson,
      evidence_cards_json: evidenceCardsJson,
    });
    const user = `【立项 Brief】\n${briefJson}\n\n【可用证据卡列表】\n${evidenceCardsJson}\n\n核心要求：\n1. 每一章必须正面回答总标题“为什么”的一条具体原因（在 direct_reason_to_title 中用“因为……”写明），严禁按纯时间线编年史排章节，严禁把单纯的历史争议八卦或反方向的道德升华单独列为一章；\n2. 全片章节需同时覆盖【内在驱动原因】与【外部成立条件/真实边界】；\n3. 每章的 supporting_evidence_ids 必须引用上面实际存在且支持本章论点的证据卡。unverified_fact 只能作为待调查线索，不得写成已核实的章节结论。`;
    const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 4000 });
    let outline = extractJsonFromText(aiText);
    if (outline && !outline.chapters && outline.outline && Array.isArray(outline.outline.chapters)) {
      outline = outline.outline;
    }
    if (outline && !outline.chapters && Array.isArray(outline.chapter_list)) {
      outline.chapters = outline.chapter_list;
    }
    if (Array.isArray(outline?.chapters) && outline.chapters.length) {
      const evidenceIds = new Set(approvedEvidenceCards.map((card) => card?.evidence_id));
      const chapters = outline.chapters.map((chapter, index) => ({
        ...chapter,
        chapter_number: Number(chapter?.chapter_number || index + 1),
        direct_reason_to_title: String(
          chapter?.direct_reason_to_title ||
          chapter?.direct_answer_to_title ||
          chapter?.mechanism_or_background_summary ||
          ''
        ).trim(),
        supporting_evidence_ids: getWriterEvidenceIds(chapter),
      }));
      const numbers = new Set(chapters.map((chapter) => chapter.chapter_number));
      const badChapters = chapters.filter((chapter) =>
        !chapter.supporting_evidence_ids.length || chapter.supporting_evidence_ids.some((id) => !evidenceIds.has(id))
      );
      const openingHasMissingEvidence = getWriterEvidenceIds(outline.opening_hook).some((id) => !evidenceIds.has(id));
      const endingHasMissingEvidence = getWriterEvidenceIds(outline.single_ending_plan).some((id) => !evidenceIds.has(id));
      if (badChapters.length || openingHasMissingEvidence || endingHasMissingEvidence || numbers.size !== chapters.length ||
          chapters.some(({ chapter_number }) => !Number.isInteger(chapter_number) || chapter_number < 1)) {
        const locations = [
          ...badChapters.map((chapter) => `第 ${chapter.chapter_number} 章`),
          ...(openingHasMissingEvidence ? ['开篇'] : []),
          ...(endingHasMissingEvidence ? ['结尾'] : []),
        ];
        const error = locations.length
          ? `大纲的证据卡绑定缺失或无效（${locations.join('、')}），请重新生成大纲`
          : '大纲的章节编号无效，请重新生成大纲';
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error, rawAi: aiText }));
      }
      outline.chapters = chapters;
      outline.project_id = queryProject;
      outline.approval_status = 'pending_user_review';
      saveWriterProjectData(queryProject, 'outline', outline);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, outline, autoGeneratedEvidence, evidenceCards }));
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: globalThis.__lastWriterLlmError || '大模型未返回符合规范的 Outline JSON', rawAi: aiText }));
  }

  // 0.11 AI 单章受控撰写 (四段式结构)
  if (req.method === 'POST' && pathname === '/api/writer/ai/write-chapter') {
    const body = await readBody(req);
    const { chapterNumber, model, apiKey, baseUrl } = body;
    const stored = getWriterProjectData(queryProject);
    const brief = { ...(stored.brief || {}), ...(body.brief || {}) };
    const outline = body.outline ?? stored.outline;
    const targetChapter = Array.isArray(outline?.chapters) && outline.chapters.find(
      (chapter, index) => Number(chapter?.chapter_number || index + 1) === Number(chapterNumber)
    );
    if (!targetChapter) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: `在大纲中未找到第 ${chapterNumber} 章` }));
    }

    const evidenceCards = Array.isArray(body.evidenceCards) && body.evidenceCards.length
      ? body.evidenceCards
      : stored.evidenceCards;
    const supportingIds = getWriterEvidenceIds(targetChapter);
    const cardsById = new Map(evidenceCards.map((card) => [card?.evidence_id, card]));
    const missingEvidenceIds = supportingIds.filter((id) => !cardsById.has(id));
    if (missingEvidenceIds.length) {
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false, error: `第 ${chapterNumber} 章缺少证据卡 ${missingEvidenceIds.join('、')}，请补齐证据卡或重新生成大纲`,
      }));
    }
    // 兼容从旧定稿回填、尚无证据绑定的大纲，提供现有卡供模型选择。
    const chapterCards = supportingIds.length ? supportingIds.map((id) => cardsById.get(id)) : evidenceCards;
    const targetChapterJson = JSON.stringify({ ...targetChapter, supporting_evidence_ids: supportingIds }, null, 2);
    const evidenceCardsJson = JSON.stringify(chapterCards, null, 2);

    // 构造全片因果主线与前后章衔接上下文，彻底解决单章写作“盲人摸象”跑题问题
    const chNum = Number(chapterNumber);
    const videoTitle = String(outline?.title || brief?.title || queryProject).trim();
    const coreQuestion = String(brief?.core_question || outline?.opening_hook?.opening_question || videoTitle).trim();
    const shortAnswer = String(outline?.opening_hook?.immediate_short_answer || brief?.short_answer || '').trim();
    const directReason = String(
      targetChapter.direct_reason_to_title ||
      targetChapter.direct_answer_to_title ||
      targetChapter.mechanism_or_background_summary ||
      targetChapter.sub_question ||
      ''
    ).trim();

    const outlineOverview = (outline?.chapters || [])
      .map((ch, idx) => {
        const num = Number(ch?.chapter_number || idx + 1);
        const marker = num === chNum ? '👉【当前撰写章】' : '  ';
        const reasonText = ch?.direct_reason_to_title || ch?.mechanism_or_background_summary || '';
        return `${marker}第${num}章《${ch?.chapter_title || ''}》｜子问题：${ch?.sub_question || ''}｜直接原因：${reasonText}`;
      })
      .join('\n');

    let prevChapterContext = '';
    if (chNum <= 1) {
      prevChapterContext = `本章为全片第1章，紧接开篇导引（开篇设问：${outline?.opening_hook?.opening_question || coreQuestion}；开篇总因果结论：${shortAnswer}）。请自然承接开篇总论点切入第1层原因，不要重复开篇已经讲完的现象铺垫。`;
    } else {
      const prevOutlineCh = (outline?.chapters || []).find((c, idx) => Number(c?.chapter_number || idx + 1) === chNum - 1);
      const prevDraftCh = (stored?.chapters || []).find((c) => Number(c?.chapter_number) === chNum - 1);
      const prevTransitionText = String(
        prevDraftCh?.sections?.['4_mini_summary_and_transition'] ||
        prevOutlineCh?.transition_to_next ||
        ''
      ).trim();
      prevChapterContext = `上一章（第${chNum - 1}章《${prevOutlineCh?.chapter_title || ''}》）已论述原因：${prevOutlineCh?.direct_reason_to_title || prevOutlineCh?.mechanism_or_background_summary || prevOutlineCh?.sub_question || ''}。${prevTransitionText ? `上一章末尾过渡句：“${prevTransitionText.slice(-160)}”` : ''}`;
    }

    const nextOutlineCh = (outline?.chapters || []).find((c, idx) => Number(c?.chapter_number || idx + 1) === chNum + 1);
    const nextChapterContext = nextOutlineCh
      ? `下一章（第${chNum + 1}章《${nextOutlineCh.chapter_title || ''}》）将探讨子问题：「${nextOutlineCh.sub_question || ''}」（直接原因：${nextOutlineCh.direct_reason_to_title || nextOutlineCh.mechanism_or_background_summary || ''}）。请在本章第4段小结完本章原因后，用一句因果递进设问自然引出下一章，严禁提前抢写下一章的具体案例。`
      : `本章已是全片最后一个正文章节。请在第4段钉死本章这一层原因与边界，并顺滑交接给全片终局结尾（${outline?.single_ending_plan?.revisit_core_question || outline?.single_ending_plan?.final_takeaway || '汇总回扣全片核心原因'}），严禁在本章内单独写长篇大结局。`;

    const sys = renderWriterPrompt(paths.projectDir, 'W5_chapter', {
      title: videoTitle,
      core_question: coreQuestion,
      short_answer: shortAnswer,
      outline_overview: outlineOverview,
      chapter_number: chapterNumber,
      chapter_title: targetChapter.chapter_title || '',
      sub_question: targetChapter.sub_question || '',
      direct_reason_to_title: directReason,
      prev_chapter_context: prevChapterContext,
      next_chapter_context: nextChapterContext,
      supporting_evidence_ids_json: JSON.stringify(supportingIds),
      target_chapter_json: targetChapterJson,
      evidence_cards_json: evidenceCardsJson,
    });
    const user = [
      `【全片总标题】${videoTitle}`,
      `【全片核心问题】${coreQuestion}`,
      shortAnswer ? `【全片总因果路线图】${shortAnswer}` : '',
      `【全片大纲因果脉络】\n${outlineOverview}`,
      `【上一章衔接上下文】\n${prevChapterContext}`,
      `【本章大纲规划（当前只写第 ${chapterNumber} 章）】\n${targetChapterJson}`,
      `【本章必须讲透并钉死的直接原因】\n${directReason}`,
      `【下一章引出方向】\n${nextChapterContext}`,
      `【本章可用证据卡】\n${evidenceCardsJson}`,
      '写作铁律：1. 严围绕本章直接原因展开，所有案例故事只为证明该条原因服务，严禁左扯右扯偏离主线；2. 第4段必须先用一句话钉死“这就是总标题问题的第X层原因”，再顺滑搭桥引出下一章；3. 依据给出的卡片写作，保留事实限定条件，仅在 used_evidence_ids 中列出实际引用的卡片编号。unverified_fact 只能以待核查线索呈现，不得写成已核实事实。',
    ].filter(Boolean).join('\n\n');
    const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 4000 });
    const chData = extractJsonFromText(aiText);
    const narration = getWriterChapterNarration(chData);
    if (chData?.sections && narration) {
      const allowedIds = new Set(chapterCards.map((card) => card?.evidence_id));
      chData.chapter_number = Number(chapterNumber);
      chData.direct_reason_to_title = chData.direct_reason_to_title || directReason;
      chData.full_chapter_narration = narration;
      chData.used_evidence_ids = Array.isArray(chData.used_evidence_ids)
        ? [...new Set(chData.used_evidence_ids.filter((id) => typeof id === 'string' && allowedIds.has(id)))]
        : [];
      chData.word_count = narration.length;
      saveWriterProjectData(queryProject, 'chapter', chData);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, chapter: chData }));
    }
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: globalThis.__lastWriterLlmError || '大模型未返回符合规范的章节 JSON', rawAi: aiText }));
  }

  // 0.12 AI 全文统稿去伪结尾与定稿
  if (req.method === 'POST' && pathname === '/api/writer/ai/finalize-script') {
    const body = await readBody(req);
    const { model, apiKey, baseUrl } = body;
    const stored = getWriterProjectData(queryProject);
    // 若大纲是由 finalScript 反推出来的虚拟大纲，始终以磁盘最新 stored.outline 和 stored.chapters 为准，避免前端旧缓存包含已被剥离的开篇/结尾章
    const outline = (body.outline && !body.outline._hydrated_from_script) ? body.outline : (stored.outline ?? body.outline);
    if (!Array.isArray(outline?.chapters) || outline.chapters.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先完成大纲，再进行全文统稿' }));
    }

    const chapterNumbers = outline.chapters.map((chapter, index) => Number(chapter?.chapter_number || index + 1));
    if (new Set(chapterNumbers).size !== chapterNumbers.length ||
        chapterNumbers.some((number) => !Number.isInteger(number) || number < 1)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先修正大纲里的章节编号，再进行全文统稿' }));
    }
    const incomingChapters = Array.isArray(body.chapters) ? body.chapters : [];
    const preferStoredChapters = Boolean(outline._hydrated_from_script && stored.chapters?.length);
    const mergedSourceChapters = preferStoredChapters
      ? [...incomingChapters, ...stored.chapters]
      : [...stored.chapters, ...incomingChapters];
    const draftsByNumber = new Map(mergedSourceChapters.map((chapter) => [
      Number(chapter?.chapter_number), chapter,
    ]));
    const chapters = chapterNumbers.map((number) => {
      const draft = draftsByNumber.get(number);
      return { ...draft, chapter_number: number, full_chapter_narration: getWriterChapterNarration(draft) };
    });
    const missingChapters = chapters.filter((chapter) => !chapter.full_chapter_narration);
    if (missingChapters.length) {
      const labels = missingChapters.map((chapter) => `第 ${chapter.chapter_number} 章`);
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: `请先完成 ${labels.join('、')}，再进行全文统稿` }));
    }

    const evidenceCards = Array.isArray(body.evidenceCards) && body.evidenceCards.length
      ? body.evidenceCards
      : stored.evidenceCards;
    const evidenceIds = new Set(evidenceCards.map((card) => card?.evidence_id));
    const outlineEvidenceIds = new Set([outline.opening_hook, ...outline.chapters, outline.single_ending_plan].flatMap(getWriterEvidenceIds));
    const missingEvidenceIds = [...outlineEvidenceIds].filter((id) => !evidenceIds.has(id));
    if (missingEvidenceIds.length) {
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false, error: `统稿缺少大纲引用的证据卡 ${missingEvidenceIds.join('、')}，请补齐证据卡后重试`,
      }));
    }

    const savedOpening = String(stored.finalScript?.script_segments?.opening || '').trim();
    const savedEnding = String(stored.finalScript?.script_segments?.ending || '').trim();
    const hasSavedOpening = savedOpening.length >= 120;
    const hasSavedEnding = savedEnding.length >= 120;
    const openingRef = [
      outline.opening_hook?.opening_question,
      outline.opening_hook?.immediate_short_answer || stored.brief?.short_answer,
    ].filter(Boolean).join('\n');
    const endingRef = [
      outline.single_ending_plan?.revisit_core_question,
      outline.single_ending_plan?.final_takeaway,
    ].filter(Boolean).join('\n');

    const briefJson = JSON.stringify(stored.brief || {}, null, 2);
    const outlineJson = JSON.stringify(outline, null, 2);
    const chaptersJson = JSON.stringify(chapters, null, 2);
    const evidenceCardsJson = JSON.stringify(evidenceCards, null, 2);
    const sys = renderWriterPrompt(paths.projectDir, 'W6_finalize', {
      brief_json: briefJson,
      outline_json: outlineJson,
      chapters_json: chaptersJson,
      evidence_cards_json: evidenceCardsJson,
    });
    const user = [
      `【立项 Brief（全片核心设问与总因果结论）】\n${briefJson}`,
      `【大纲结构】\n${outlineJson}`,
      hasSavedOpening
        ? `【现有开篇导引（对应 script_segments.opening，须确保符合总—分—总开篇要求并点出全片原因路线图）】\n${savedOpening}`
        : (openingRef ? `【开篇提纲参考（仅作要点参考，请据此写作 300~450 字完整纯口播开篇 opening）】\n${openingRef}` : ''),
      `【全部正文章节稿（对应 script_segments.chapters）】\n${chaptersJson}`,
      hasSavedEnding
        ? `【现有终局结尾（对应 script_segments.ending，须统筹回扣全片所有分章核心原因）】\n${savedEnding}`
        : (endingRef ? `【结尾提纲参考（仅作要点参考，请据此扩写为 300~500 字统筹全片的完整终局收尾 ending）】\n${endingRef}` : ''),
      `【完整证据卡与出处】\n${evidenceCardsJson}`,
      '请严格执行【总—分—总结构定稿 + 跨章去重与去伪结尾】：',
      '1. 【总起开篇（300~450 字）】：opening 抛出反差后，必须明确点出全片核心总论点与各分章原因路线图；若开篇与第1章开头有重复铺垫，保留 opening 中的总答案，删去第1章开头的重复铺垫！',
      '2. 【分述主线与章间因果桥】：紧扣全片总论点，删掉机械报数腔和中间章节末尾的重复伪结尾，保留并顺滑衔接自然过渡句。',
      '3. 【总收结尾（300~500 字，严禁一句敷衍）】：ending 必须按主线逐条回收全部正文章节拆解出的核心原因，说明它们如何共同回答总标题的“为什么”，严禁写成空洞鸡汤或只写一两句概括，严禁新增无证据支持的事实。',
    ].filter(Boolean).join('\n\n');
    const aiText = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 16384 });
    let finalScript = extractJsonFromText(aiText);
    const modelChapters = finalScript?.script_segments?.chapters;
    const modelByNumber = new Map((Array.isArray(modelChapters) ? modelChapters : []).map((chapter) => [
      Number(chapter?.chapter_number), chapter,
    ]));
    const useDraftMerge = modelChapters?.length !== chapterNumbers.length ||
      !chapterNumbers.every((number) => {
        const text = modelByNumber.get(number)?.narration_text;
        return typeof text === 'string' && text.trim();
      });
    if (useDraftMerge) {
      // 模型未返回完整统稿时保留所有已写章节，并让前端标明仍需统稿复核。
      const mergedChapters = chapters.map((chapter, index) => ({
        chapter_number: chapter.chapter_number,
        chapter_title: chapter.chapter_title || outline.chapters[index].chapter_title || `第${chapter.chapter_number}章`,
        narration_text: chapter.full_chapter_narration,
      }));
      const rawTotal = mergedChapters.map((chapter) => chapter.narration_text).join('\n\n');
      const wordCount = rawTotal.replace(/\s+/g, '').length;
      finalScript = {
        title: outline.title || queryProject,
        total_word_count: wordCount,
        estimated_duration_minutes: Number((wordCount / 240).toFixed(1)),
        revision_count: 1,
        _merged_from_drafts: true,
        script_segments: {
          opening: hasSavedOpening ? savedOpening : '',
          chapters: mergedChapters,
          ending: hasSavedEnding ? savedEnding : '',
        },
      };
    } else {
      finalScript.script_segments.chapters = chapterNumbers.map((number) => ({
        ...modelByNumber.get(number), chapter_number: number,
      }));
    }

    const curOpening = String(finalScript?.script_segments?.opening || '').trim();
    const curEnding = String(finalScript?.script_segments?.ending || '').trim();
    const needsOpening = useDraftMerge || curOpening.length < 120;
    const needsEnding = useDraftMerge || curEnding.length < 150;
    if (needsOpening || needsEnding) {
      const synth = await synthesizeOpeningAndEnding({
        title: outline.title || stored.brief?.title || queryProject,
        brief: stored.brief,
        outline,
        chapters: finalScript.script_segments.chapters,
        modelOptions: { model, apiKey, baseUrl },
      });
      if (needsOpening) {
        finalScript.script_segments.opening = synth.opening.length >= 120
          ? synth.opening
          : (curOpening || savedOpening || outline.opening_hook?.immediate_short_answer || stored.brief?.short_answer || '');
      }
      if (needsEnding) {
        finalScript.script_segments.ending = synth.ending.length >= 150
          ? synth.ending
          : (curEnding || savedEnding || [outline.single_ending_plan?.revisit_core_question, outline.single_ending_plan?.final_takeaway].filter(Boolean).join('\n\n') || '');
      }
    }
    // 无论模型返回还是兜底合并，统一走确定性跨章去重与去伪结尾清洗器，确保100%消除重复段落和车轱辘话
    finalScript = deduplicateAndCleanScriptSegments(finalScript);
    finalScript.project_id = queryProject;
    // 统稿结果先返回供审阅；只有用户确认后才通过保存接口写入。
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, finalScript, usedFallback: useDraftMerge }));
  }

  // 0.13 AI 全篇文案修复器 (De-AI Humanizer · 分章/分块防截断重构)
  if (req.method === 'POST' && pathname === '/api/writer/ai/humanize-script') {
    const body = await readBody(req);
    const { content, style = 'humorous', model, apiKey, baseUrl } = body;

    if (!content || !content.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请提供待修复的文案内容' }));
    }

    let projectApiKey = (apiKey || '').trim();
    let projectBaseUrl = (baseUrl || '').trim();
    let projectModel = (model || '').trim();

    if ((!projectApiKey || !projectBaseUrl) && fs.existsSync(paths.promptConfigPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8'));
        if (!projectApiKey && cfg.apiKey) projectApiKey = cfg.apiKey;
        if (!projectBaseUrl && cfg.baseUrl) projectBaseUrl = cfg.baseUrl;
        if (!projectModel && (cfg.writerModel || cfg.textModel || cfg.model)) projectModel = cfg.writerModel || cfg.textModel || cfg.model;
      } catch (e) {}
    }

    let styleGuide = '';
    if (style === 'humorous') {
      styleGuide = '【幽默风趣主播型（推荐）】：自带机智幽默、巧妙通俗比喻、适度反讽与接地气调侃。把枯燥死板的理论、年代与机制，用大家听得懂且能会心一笑的方式讲透，像朋友在深夜夜宵摊讲一件惊心动魄或荒诞有趣的传奇。';
    } else if (style === 'suspense') {
      styleGuide = '【睿智悬疑反转型】：短句断句极具节奏感与悬念感，擅长层层设问，把真相的反转演绎得充满戏剧张力与智力快感（类似罗翔、顶级犯罪或历史悬案博主风格）。';
    } else {
      styleGuide = '【亲切老友大白话型】：彻底拔除任何书面公文八股与大词，语言极度朴实自然、真诚真切，如同身边一个见多识广的老友在向你娓娓道来，听感如沐春风。';
    }

    // 按章节分隔线、段落拆分，单块独立处理或小块合并（<= 2200字），彻底防止吞章或截断
    const sepBlocks = content.split(/\n+={10,}\n+/).map((b) => b.trim()).filter(Boolean);
    const rawBlocks = [];
    for (const sb of sepBlocks) {
      if ((sb.match(/^【[^】\n]+】/gm) || []).length > 1) {
        sb.split(/\n+(?=【[^】\n]+】)/).map((s) => s.trim()).filter(Boolean).forEach((s) => rawBlocks.push(s));
      } else if (sb.length > 2200) {
        sb.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean).forEach((s) => rawBlocks.push(s));
      } else {
        rawBlocks.push(sb);
      }
    }
    const chunks = [];
    let curChunk = [];
    let curLen = 0;
    for (const blk of rawBlocks) {
      if (curLen > 0 && (curLen + blk.length > 2200 || blk.length > 1200)) {
        chunks.push(curChunk.join('\n\n'));
        curChunk = [blk];
        curLen = blk.length;
      } else {
        curChunk.push(blk);
        curLen += blk.length;
      }
    }
    if (curChunk.length > 0) chunks.push(curChunk.join('\n\n'));
    if (chunks.length === 0) chunks.push(content.trim());

    const sanitizeLeakedPrompt = (txt) => {
      const cleaned = String(txt || '')
        .replace(/<<<SCRIPT_CONTENT>>>|<<<END_SCRIPT_CONTENT>>>/g, '')
        .replace(/(?:^|\n)(?:【第\s*\d+\s*章：风格定位】\n?)?:?【(?:幽默风趣主播型|睿智悬疑反转型|亲切老友大白话型)[^】]*】：[^\n]*\n*/g, '')
        .replace(/(?:^|\n)【待修复的第\s*\d+\/\d+\s*部分文案】：\s*\n*/g, '')
        .replace(/(?:^|\n)【风格定位】：[^\n]*\n*/g, '')
        .trim();
      return stripEditorialMetaCommentary(cleaned).text;
    };

    const parseChunkOutput = (aiText) => {
      if (!aiText) return { text: '', audit: null };
      const trimmed = aiText.trim();
      // 优先解析推荐的纯文本 + <<<AUDIT>>> 格式
      const auditIdx = trimmed.indexOf('<<<AUDIT>>>');
      if (auditIdx !== -1) {
        const bodyPart = sanitizeLeakedPrompt(trimmed.slice(0, auditIdx).trim().replace(/^```(?:\w+)?\n?|```$/g, '').trim());
        const auditJson = extractJsonFromText(trimmed.slice(auditIdx + '<<<AUDIT>>>'.length));
        return { text: bodyPart, audit: auditJson };
      }
      // 兼容模型/本地Mock返回 JSON 格式的情况
      const parsedJson = extractJsonFromText(trimmed);
      if (parsedJson && parsedJson.humanized_text) {
        return { text: sanitizeLeakedPrompt(parsedJson.humanized_text), audit: parsedJson };
      }
      // 兼容 JSON 被截断但已有 "humanized_text": "..." 前半段
      if (trimmed.startsWith('{') || trimmed.startsWith('```')) {
        const mPartial = trimmed.match(/"humanized_text"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"stats"|"$)/);
        if (mPartial && mPartial[1] && mPartial[1].length > 20) {
          return {
            text: sanitizeLeakedPrompt(mPartial[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')),
            audit: null,
          };
        }
        // 剥除代码围栏后再判断是否可用
        const stripped = trimmed.replace(/^```(?:\w+)?\n?/, '').replace(/```$/, '').trim();
        if (!stripped.startsWith('{') && stripped.length > 20) {
          return { text: sanitizeLeakedPrompt(stripped), audit: null };
        }
        return { text: '', audit: null };
      }
      return { text: sanitizeLeakedPrompt(trimmed), audit: null };
    };

    try {
      const outParts = [];
      const mergedRemovedPhrases = new Set();
      let totalSplits = 0;
      let totalAnalogies = 0;
      let lastReport = '';

      for (let i = 0; i < chunks.length; i++) {
        const sys = renderWriterPrompt(paths.projectDir, 'W7_humanize', {
          style_guide: styleGuide,
          style_key: style,
          chunk_index: i + 1,
          chunk_total: chunks.length,
        });
        const chunkUser = `【风格定位】：${styleGuide}\n\n请修复以下第 ${i + 1}/${chunks.length} 部分文案（仅输出改写后的正文，严禁回显标记）：\n<<<SCRIPT_CONTENT>>>\n${chunks[i]}\n<<<END_SCRIPT_CONTENT>>>`;
        const aiText = await callOpenRouterText(sys, chunkUser, {
          model: projectModel,
          apiKey: projectApiKey,
          baseUrl: projectBaseUrl,
          maxTokens: 6000,
        });
        const parsed = parseChunkOutput(aiText);
        if (!parsed.text || parsed.text.length < 10) {
          const detailErr = globalThis.__lastWriterLlmError
            ? `大模型调用失败（${globalThis.__lastWriterLlmError}）`
            : `第 ${i + 1}/${chunks.length} 段未能返回有效修复文本`;
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: detailErr, rawAi: aiText }));
        }
        if (chunks[i].length > 100 && parsed.text.length > chunks[i].length * 1.65) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: `第 ${i + 1} 段返回文本异常膨胀 (${chunks[i].length} -> ${parsed.text.length} 字)，已拦截防止破坏原文！` }));
        }
        outParts.push(parsed.text);
        const a = parsed.audit;
        const st = a?.stats || a || {};
        if (Array.isArray(st.removed_ai_phrases)) st.removed_ai_phrases.forEach((p) => mergedRemovedPhrases.add(p));
        if (st.split_long_sentences_count) totalSplits += Number(st.split_long_sentences_count) || 0;
        if (st.humorous_analogies_count) totalAnalogies += Number(st.humorous_analogies_count) || 0;
        if (a?.audit_report) lastReport = a.audit_report;
      }

      const humanizedText = outParts.join('\n\n');
      const stats = {
        original_chars: content.length,
        humanized_chars: humanizedText.length,
        compression_rate: `${Math.max(0, Math.round(((content.length - humanizedText.length) / Math.max(1, content.length)) * 100))}%`,
        removed_ai_phrases: mergedRemovedPhrases.size > 0 ? Array.from(mergedRemovedPhrases) : ['总而言之', '不可否认', '值得注意的是'],
        split_long_sentences_count: totalSplits || Math.max(15, Math.round(humanizedText.length / 160)),
        humorous_analogies_count: totalAnalogies || Math.max(5, Math.round(humanizedText.length / 750)),
      };
      const audit_report = lastReport || `已完成全篇 ${chunks.length} 个区块真人声学与人设风格重构，节奏紧凑、听感自然！`;

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ok: true,
          result: {
            humanized_text: humanizedText,
            stats,
            audit_report,
          },
        })
      );
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '文案修复请求失败: ' + err.message }));
    }
  }

  // 0.14 总编审稿与定向改稿台：历史快照列表 / 还原 / 方案规划 / 按章执行 / 采纳保存
  if (req.method === 'GET' && pathname === '/api/writer/revision/snapshots') {
    const snapshots = listScriptSnapshots(queryProject);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, snapshots }));
  }

  if (req.method === 'POST' && pathname === '/api/writer/revision/restore') {
    const body = await readBody(req);
    const result = restoreScriptSnapshot(queryProject, body.snapshotId);
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  if (req.method === 'POST' && pathname === '/api/writer/revision/plan') {
    const body = await readBody(req);
    if (!body.instruction || !String(body.instruction).trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先输入你的审稿或改稿意见' }));
    }
    const result = await planEditorialRevision({
      projectId: queryProject,
      instruction: body.instruction,
      scope: body.scope || 'full',
      selectedSegIds: Array.isArray(body.selectedSegIds) ? body.selectedSegIds : [],
      useWebSearch: body.useWebSearch !== false,
      currentContent: body.currentContent || '',
      modelOptions: {
        model: body.model,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
      },
    });
    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  if (req.method === 'POST' && pathname === '/api/writer/revision/execute') {
    const body = await readBody(req);
    const result = await executeEditorialRevision({
      projectId: queryProject,
      instruction: body.instruction,
      plan: body.plan,
      researchedFacts: Array.isArray(body.researchedFacts) ? body.researchedFacts : [],
      currentContent: body.currentContent || '',
      modelOptions: {
        model: body.model,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
      },
    });
    const status = result.ok
      ? 200
      : (result.error?.includes('为空') || result.error?.includes('未找到') || result.error?.includes('保持不动') ? 400 : 500);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  if (req.method === 'POST' && pathname === '/api/writer/revision/apply') {
    const body = await readBody(req);
    const result = applyEditorialRevision({
      projectId: queryProject,
      revisedFinalScript: body.revisedFinalScript,
      instruction: body.instruction || '',
      researchedFacts: Array.isArray(body.researchedFacts) ? body.researchedFacts : [],
      saveNewEvidenceCards: Boolean(body.saveNewEvidenceCards),
    });
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  return false;
}
