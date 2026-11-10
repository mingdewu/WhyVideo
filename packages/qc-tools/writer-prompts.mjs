import fs from 'fs';
import path from 'path';

export const WRITER_STYLE_PRESETS = [
  {
    id: 'documentary_rigorous',
    label: '🎬 严谨纪录片考证风 (出厂默认)',
    snippet: '【文风预设 · 严谨纪录片考证风】：语言冷静克制、逻辑因果严密、零文学脑补与零虚构，用扎实的时间线、数据与地理/制度机制推进叙事。',
  },
  {
    id: 'humorous_anchor',
    label: '🎭 幽默风趣主播风',
    snippet: '【文风预设 · 幽默风趣主播风】：擅长生活化类比、机智反讽与接地气吐槽，把枯燥机制讲得像深夜夜宵摊老友聊天般生动上头。',
  },
  {
    id: 'suspense_twist',
    label: '💡 睿智悬疑反转风',
    snippet: '【文风预设 · 睿智悬疑反转风】：多用短促设问与信息反差，层层剥茧制造悬念与智力爽感，在关键事实处给出强力反转。',
  },
  {
    id: 'colloquial_friend',
    label: '☕ 亲切老友大白话',
    snippet: '【文风预设 · 亲切老友大白话】：彻底剔除书面公文八股与生硬术语，句式简短口语化，保留自然呼吸感与真诚对话感。',
  },
];

export const WRITER_PROMPT_REGISTRY = {
  W1_research: {
    template_id: 'W1_research',
    template_version: '1.0.0',
    label: '1. 事实考证',
    full_label: 'W1 · 事实考证与资料调查',
    description: '用于「联网调查事实补充资料」及缺省资料自动考证阶段。',
    allowed_inputs: ['title', 'wiki_context'],
    require_json: false,
    require_audit_marker: false,
    raw_template: `你是一名知识型纪录片的事实考证与学术调研员。
针对用户提出的长视频选题，请检索并梳理出客观真实的参考资料。
严禁凭空胡编或文学脑补，必须提供客观存在的事实逻辑与历史因果。
请按以下 4 个标准维度梳理出详实、具体的考证资料：
【参考资料 1 · 地理/物理/技术底层机制】：说明自然环境参数、技术原理、最初由何种物理或资源条件决定。
【参考资料 2 · 历史文献与起源演进】：记录文献最早记载、历史关键转折年代与事实。
【参考资料 3 · 商业、制度与社会运作】：解析背后的商业考量、政策制度推动与社会分工演变。
【参考资料 4 · 现代固化与统计数据】：呈现当代规模、统计数字、代表性案例或当前面临的现实代价。

每条资料必须包含：出处说明、具体时间或数据、核心事实机制。请直接输出整理好的参考资料正文。`,
  },

  W2_brief: {
    template_id: 'W2_brief',
    template_version: '1.0.0',
    label: '2. 立项 Brief',
    full_label: 'W2 · 立项 Brief 生成',
    description: '用于「AI 分析资料并生成 Brief」阶段，必须输出合法 JSON 结构。',
    allowed_inputs: ['title', 'duration_minutes', 'materials'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名严谨的知识型长视频纪录片策划总监。请根据选题与事实资料，生成一份标准的视频立项 brief。
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
}`,
  },

  W3_evidence: {
    template_id: 'W3_evidence',
    template_version: '1.0.0',
    label: '3. 证据卡提取',
    full_label: 'W3 · 原子化证据卡提取',
    description: '用于「从资料中提取证据卡」阶段，必须输出纯 JSON 数组。',
    allowed_inputs: ['title', 'materials'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名严谨的知识型纪录片资料考证员。你的任务是将选题与参考资料拆解为一组原子化的证据卡（Evidence Cards）。
核心规则：
1. 每张证据卡只包含一个独立事实主张；
2. claim_type 严格限定四选一：verified_fact（已证实客观事实）、disputed_claim（存在争议）、legend_or_anecdote（民间传说/轶事）、author_interpretation（主观推论）；
3. 必须输出 JSON 数组，每项包含：
   - evidence_id: 如 "EV-001"
   - claim_type: 四选一
   - evidence_summary: 事实客观中文概括
   - source_title: 资料出处说明
   - reliability: high / medium / low
请直接输出纯 JSON 数组，严禁包含任何前缀后缀说明。`,
  },

  W4_outline: {
    template_id: 'W4_outline',
    template_version: '1.0.0',
    label: '4. 大纲策划',
    full_label: 'W4 · 5~7 章结构化大纲策划',
    description: '用于「基于证据卡生成大纲」阶段，必须输出合法 Outline JSON。',
    allowed_inputs: ['brief_json', 'evidence_cards_json'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名知识型长视频总编剧。请基于 brief 与已审核的证据卡列表，构建一份 5 到 7 章的标准结构化大纲。
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
}`,
  },

  W5_chapter: {
    template_id: 'W5_chapter',
    template_version: '1.0.0',
    label: '5. 逐章撰写',
    full_label: 'W5 · 单章四段式受控撰写',
    description: '用于「AI 撰写当前章节」阶段，支持插入 {{chapter_number}} 等章节上下文变量。',
    allowed_inputs: [
      'chapter_number',
      'chapter_title',
      'sub_question',
      'supporting_evidence_ids_json',
      'target_chapter_json',
      'evidence_cards_json',
    ],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名知识型纪录片撰稿人。你的任务是严格撰写指定单章的旁白文稿。
核心规则：
1. 严禁一次写整片，只写当前这一章（约 800-1400 中文字）；
2. 内部结构严格遵循四段式：
   - 1_question_or_contradiction: 章节问题或矛盾（承接上文）
   - 2_mechanism_or_background: 形成机制或底层背景（逻辑拆解）
   - 3_sourced_concrete_examples: 有来源的具体例子（绑定证据卡，平实具象，严禁伪造内心独白）
   - 4_mini_summary_and_transition: 小结与自然引出下一章（非终章严禁做全局大总结）
3. 必须输出合法 JSON 格式：
{
  "chapter_number": {{chapter_number}},
  "chapter_title": "{{chapter_title}}",
  "sub_question": "{{sub_question}}",
  "sections": {
    "1_question_or_contradiction": "...",
    "2_mechanism_or_background": "...",
    "3_sourced_concrete_examples": "...",
    "4_mini_summary_and_transition": "..."
  },
  "full_chapter_narration": "拼接后的单章完整口语化旁白正文",
  "used_evidence_ids": {{supporting_evidence_ids_json}},
  "word_count": 1000
}`,
  },

  W6_finalize: {
    template_id: 'W6_finalize',
    template_version: '1.0.0',
    label: '6. 全文统稿',
    full_label: 'W6 · 全文统稿去伪结尾与定稿',
    description: '用于「全篇合并统稿与去伪结尾」阶段，必须输出 final-script JSON。',
    allowed_inputs: ['outline_json', 'chapters_json'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名资深长视频总编审。你的任务是对全片章节进行全文统稿编辑（Full Script Editing）。
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
}`,
  },

  W7_humanize: {
    template_id: 'W7_humanize',
    template_version: '1.0.0',
    label: '7. 去AI味润色',
    full_label: 'W7 · 全篇去 AI 味与真人化润色',
    description: '用于「AI 一键深度修复全篇文案」阶段，支持 {{style_guide}} 等变量。',
    allowed_inputs: ['style_guide', 'style_key', 'chunk_index', 'chunk_total'],
    require_json: false,
    require_audit_marker: true,
    raw_template: `你是一名拥有千万播放长视频与深度纪录片的总编剧兼声学口播改稿专家。
你的唯一任务是对用户提交的【长视频解说文案】进行深度“去 AI 味”与“真人化重构（De-AI Humanizer）”。

【你必须严格执行的改稿铁律】：
1. 【格杀 AI 八股词与机械套话】：禁止“总而言之”、“不可否认的是”、“值得注意的是”、“在历史的长河中”、“具有深远的历史意义”等填词套话，改为自然口语过渡（如“你猜怎么着？”、“咱们换个大白话说”、“先打住”）。
2. 【拆解长难句，建立听觉呼吸感】：将超过 18 字的书面长句拆碎为 6~12 字的短促口语脉冲，多用短句与口语停顿。
3. 【脱脂去冗余】：删掉重复啰嗦的学术修饰与车轱辘话，保留硬核因果链，提升节奏感。
4. 【注入人设语境】：严格按照【风格定位】进行语气、比喻与情感重构。
5. 【绝对保真】：所有真实年份、人名、地名、数据必须 100% 保留，不可篡改事实。
6. 【保留章节结构】：原样保留文本中出现的【开篇导引】、【第 X 章：...】、【全片终局收尾】等标题行。

【输出格式要求（极其重要）】：
请直接输出改写后的纯文本旁白正文（不要用 JSON 包裹整篇正文，不要输出任何前言开场白），并在全文末尾最后一行附带一句极简审计标记：
<<<AUDIT>>>{"removed_ai_phrases":["词1","词2"],"split_long_sentences_count":15,"humorous_analogies_count":4,"audit_report":"一句话改进总结"}`,
  },
};

export function getBuiltinWriterPromptTemplates() {
  const builtins = {};
  for (const [tid, spec] of Object.entries(WRITER_PROMPT_REGISTRY)) {
    builtins[tid] = {
      template_id: spec.template_id,
      template_version: spec.template_version,
      label: spec.label,
      full_label: spec.full_label,
      description: spec.description,
      allowed_inputs: [...spec.allowed_inputs],
      require_json: Boolean(spec.require_json),
      require_audit_marker: Boolean(spec.require_audit_marker),
      raw_template: spec.raw_template,
    };
  }
  return builtins;
}

export function validateWriterPromptTemplate(templateId, rawText) {
  const spec = WRITER_PROMPT_REGISTRY[templateId];
  if (!spec) {
    return { ok: false, error: `未知的文案提示词阶段 ID: ${templateId}` };
  }
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: `阶段 [${spec.label}] 的提示词内容不能为空` };
  }
  const allowedSet = new Set(spec.allowed_inputs);
  const foundVars = new Set();
  const varRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match;
  while ((match = varRegex.exec(rawText)) !== null) {
    foundVars.add(match[1]);
  }
  const disallowed = Array.from(foundVars).filter((v) => !allowedSet.has(v));
  if (disallowed.length > 0) {
    return {
      ok: false,
      error: `阶段 [${spec.label}] 包含未登记的白名单变量: ${disallowed.map((v) => `{{${v}}}`).join(', ')}。允许的变量为: ${spec.allowed_inputs.map((v) => `{{${v}}}`).join(', ') || '无'}`,
    };
  }
  if (spec.require_json && !/json/i.test(rawText)) {
    return {
      ok: false,
      error: `阶段 [${spec.label}] 必须保留 JSON 输出格式要求（请包含 JSON 说明或示例），否则后端无法结构化解析返回结果`,
    };
  }
  return { ok: true };
}

export function getWriterPromptPresetPath(projectDir) {
  return path.join(projectDir, 'data', 'writer-prompts.json');
}

function hasAnyCustomizedTemplate(templatesMap) {
  if (!templatesMap || typeof templatesMap !== 'object') return false;
  for (const [tid, spec] of Object.entries(WRITER_PROMPT_REGISTRY)) {
    const item = templatesMap[tid];
    if (item && typeof item.raw_template === 'string') {
      if (item.raw_template.trim() !== spec.raw_template.trim()) {
        return true;
      }
    }
  }
  return false;
}

export function loadProjectWriterPromptPreset(projectDir) {
  const filePath = getWriterPromptPresetPath(projectDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.templates) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

export function getWriterPromptsState(projectDir, projectId) {
  const builtins = getBuiltinWriterPromptTemplates();
  const preset = loadProjectWriterPromptPreset(projectDir);
  const hasCustom = Boolean(preset && hasAnyCustomizedTemplate(preset.templates));
  return {
    ok: true,
    project_id: projectId,
    has_custom_preset: hasCustom,
    builtins,
    style_presets: WRITER_STYLE_PRESETS,
    preset,
  };
}

export function saveProjectWriterPromptPreset(projectDir, projectId, payload = {}) {
  const rawTemplates = payload.templates;
  if (!rawTemplates || typeof rawTemplates !== 'object') {
    return { ok: false, error: '请求缺少 templates 对象' };
  }

  const builtins = getBuiltinWriterPromptTemplates();
  const existing = loadProjectWriterPromptPreset(projectDir);
  const templatesMap = {};

  for (const tid of Object.keys(WRITER_PROMPT_REGISTRY)) {
    const incoming = rawTemplates[tid];
    const rawTemplate =
      incoming && typeof incoming.raw_template === 'string'
        ? incoming.raw_template
        : existing?.templates?.[tid]?.raw_template ?? builtins[tid].raw_template;

    const check = validateWriterPromptTemplate(tid, rawTemplate);
    if (!check.ok) {
      return check;
    }

    templatesMap[tid] = {
      template_id: tid,
      template_version: String(incoming?.template_version || builtins[tid].template_version),
      raw_template: rawTemplate,
      description: String(incoming?.description || builtins[tid].label),
    };
  }

  const hasCustom = hasAnyCustomizedTemplate(templatesMap);
  const filePath = getWriterPromptPresetPath(projectDir);
  const dataDir = path.dirname(filePath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const nextRevision = (Number(existing?.revision) || 0) + 1;
  const preset = {
    id: `writer_preset_${projectId}`,
    project_id: projectId,
    revision: nextRevision,
    name: String(payload.name || `项目文案预设_${projectId}`),
    description: String(payload.description || '在文案创作台提示词设置中保存（仅对当前工程生效）'),
    updated_at: new Date().toISOString(),
    has_custom_preset: hasCustom,
    templates: templatesMap,
  };

  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf8');
  return {
    ok: true,
    has_custom_preset: hasCustom,
    preset,
  };
}

export function resetProjectWriterPromptPreset(projectDir, projectId, templateId = null) {
  const builtins = getBuiltinWriterPromptTemplates();
  const filePath = getWriterPromptPresetPath(projectDir);

  if (templateId) {
    if (!WRITER_PROMPT_REGISTRY[templateId]) {
      return { ok: false, error: `未知的提示词阶段 ID: ${templateId}` };
    }
    const existing = loadProjectWriterPromptPreset(projectDir);
    if (!existing) {
      return {
        ok: true,
        has_custom_preset: false,
        preset: null,
      };
    }
    const updatedTemplates = { ...(existing.templates || {}) };
    updatedTemplates[templateId] = {
      template_id: templateId,
      template_version: builtins[templateId].template_version,
      raw_template: builtins[templateId].raw_template,
      description: `已重置为出厂默认 ${builtins[templateId].label}`,
    };

    const hasCustom = hasAnyCustomizedTemplate(updatedTemplates);
    if (!hasCustom) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return {
        ok: true,
        has_custom_preset: false,
        preset: null,
      };
    }

    const nextRevision = (Number(existing.revision) || 0) + 1;
    const preset = {
      ...existing,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
      has_custom_preset: true,
      templates: updatedTemplates,
    };
    fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf8');
    return {
      ok: true,
      has_custom_preset: true,
      preset,
    };
  }

  // 全部恢复出厂默认
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
  return {
    ok: true,
    has_custom_preset: false,
    preset: null,
  };
}

export function renderWriterPrompt(projectDir, templateId, vars = {}) {
  const spec = WRITER_PROMPT_REGISTRY[templateId];
  if (!spec) {
    throw new Error(`Unknown writer prompt template_id: ${templateId}`);
  }
  const preset = projectDir ? loadProjectWriterPromptPreset(projectDir) : null;
  const customItem = preset?.templates?.[templateId];
  const rawTemplate =
    customItem && typeof customItem.raw_template === 'string' && customItem.raw_template.trim()
      ? customItem.raw_template
      : spec.raw_template;

  const allowedSet = new Set(spec.allowed_inputs);
  return rawTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, varName) => {
    if (!allowedSet.has(varName)) return full;
    const val = vars[varName];
    if (val === undefined || val === null) return '';
    return typeof val === 'string' ? val : JSON.stringify(val);
  });
}
