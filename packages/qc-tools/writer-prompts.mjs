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

export const WRITER_REVISION_QUICK_CHIPS = [
  {
    id: 'news_opening',
    label: '🔥 换时事/新闻开头',
    prompt: '把开头换成最新相关新闻/现实事件切入，用强反差引出全片核心问题，并在后续章节自然呼应。',
  },
  {
    id: 'global_thread',
    label: '🧵 全篇贯穿新主线',
    prompt: '新增一条贯穿全片的对比主线，只在开头、关键论证处和结尾自然嵌入，其余扎实章节保持原样。',
  },
  {
    id: 'tighten_pace',
    label: '✂️ 精简提节奏',
    prompt: '删掉拖沓铺垫和重复表达，提升开篇钩子和转场节奏，保留所有硬核事实与案例。',
  },
  {
    id: 'sharpen_contrast',
    label: '⚡ 强化观点反差',
    prompt: '强化观点反差与悬念设问，把“大家以为 vs 真实底层机制”的反差感拉满。',
  },
];

export const WRITER_PROMPT_REGISTRY = {
  W1_research: {
    template_id: 'W1_research',
    template_version: '1.1.0',
    label: '1. 事实考证',
    full_label: 'W1 · 事实考证与资料调查',
    description: '用于「联网调查事实补充资料」及缺省资料自动考证阶段。',
    allowed_inputs: ['title', 'wiki_context'],
    require_json: false,
    require_audit_marker: false,
    raw_template: `你是一名知识型纪录片的事实考证与因果调研员。
针对用户提出的长视频选题，请检索并梳理出能够直接回答标题“为什么”的客观事实资料。
严禁凭空胡编或文学脑补，严禁把“相关背景故事/历史八卦编年史”当成原因。必须围绕标题核心疑问，按以下 4 个因果维度梳理详实、具体的考证资料：
【参考资料 1 · 内在驱动原因（需求/设计/物理/技术底层机制）】：为什么它自身非要这么做或呈现这种状态？底层的技术原理、物理条件、成本效率、人性需求或商业回报是什么？
【参考资料 2 · 外部成立条件（制度/法律/经济账本/社会契约）】：外部环境为什么允许它存在，或者为什么锁死了它无法改变？背后的法律边界、政策制度、基建遗产或利益博弈是什么？
【参考资料 3 · 破除直觉误区的实证与关键历史节点】：大众最容易误解的表面原因是什么？有哪些统计数据、学术实证或决定性历史转折事件能证伪表面直觉、支撑真实因果？
【参考资料 4 · 现实运行的真实边界与代价】：这种现象在现实中并非毫无限制，它成立的硬性红线、安全边界、替代折中方案或付出的现实代价是什么？

每条资料必须包含：出处说明、具体时间或数据、以及它直接解释了标题“为什么”的哪一层原因。请直接输出整理好的参考资料正文。`,
  },

  W2_brief: {
    template_id: 'W2_brief',
    template_version: '1.1.0',
    label: '2. 立项 Brief',
    full_label: 'W2 · 立项 Brief 生成',
    description: '用于「AI 分析资料并生成 Brief」阶段，必须输出合法 JSON 结构。',
    allowed_inputs: ['title', 'duration_minutes', 'materials'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名严谨的知识型长视频纪录片策划总监。请根据选题与事实资料，生成一份直击核心因果的视频立项 brief。
核心铁律：
1. 【严格采用“总—分—总”强因果架构】：全片必须围绕标题“为什么”展开，严禁策划成“历史编年史”或“外围故事会”。其中 short_answer 是开篇的**总起**（直接给出全片总答案与核心路线图），causal_pillars 与 included_dimensions 是中间各章展开的**分论点**（3~5 条正面回答“为什么”的核心原因）；
2. 任何“为什么”都必须同时点出两层直接原因：
   - 【内在驱动原因（A面）】：主体自身为什么非要这样？（物理/技术/交互设计/人性需求/商业效率的必然性）
   - 【外部成立条件与边界（B面）】：外部环境为什么允许或锁死了它？（法理/制度/安全红线/历史基建/成本账本的约束）
   注意：边界与限定条件应精简并附着在对应原因支柱上，严禁单独拆出一条纯方法论/纯免责支柱来水一整章；
3. short_answer 必须在 2-4 句话内直接亮出这两层共 3~5 条核心原因（格式：“这并非因为【常见表面误解】，而是由【内在原因1、2】与【外部条件3、4】共同作用的结果”）；
4. included_dimensions 必须写成一条条具体的“因为……”（正面分论点支柱），严禁只写“社会恐慌史”“叙事伦理”“研究局限”这类不含因果的空泛话题词；
5. 【严格面向观众，禁写内部工作备注】：short_answer、causal_pillars 与 scope.included_dimensions 均属于面向观众的因果概括，严禁在其中写入“须核验原文”“待核查”“正式制作前需补充”“待补证”等面向创作者或审稿流程的工作备注。

必须且仅输出合法的 JSON 格式，字段包括：
{
  "project_id": "why_xxx_001",
  "title": "视频标题（为什么……）",
  "core_question": "全片核心设问（拆出内在动因与外部条件两层追问）",
  "short_answer": "开篇前1-2分钟直接给出的总因果地图答案（2-4句话，直接点明内在驱动原因与外部成立条件）",
  "causal_pillars": {
    "internal_drivers": ["内在驱动原因1：因为……", "内在驱动原因2：因为……"],
    "external_conditions_and_boundaries": ["外部成立条件1：因为……", "真实边界/红线：只有在……边界内才成立"]
  },
  "target_duration_minutes": 25,
  "estimated_word_count": 6500,
  "planned_chapter_count": 6,
  "scope": {
    "time_range": "时间跨度",
    "geographic_scope": "地理范围",
    "included_dimensions": ["原因支柱一：……", "原因支柱二：……", "原因支柱三：……", "原因支柱四与边界：……"],
    "excluded_dimensions": ["与核心因果无关的单纯历史八卦", "偏离标题方向的道德说教或反向升华"]
  },
  "taboos_and_exclusions": ["严禁模仿特定博主口吻", "零编造", "严禁写成不解释原因的历史流水账"]
}`,
  },

  W3_evidence: {
    template_id: 'W3_evidence',
    template_version: '1.1.0',
    label: '3. 证据卡提取',
    full_label: 'W3 · 原子化证据卡提取',
    description: '用于「从资料中提取证据卡」阶段，必须输出纯 JSON 数组。',
    allowed_inputs: ['title', 'materials', 'brief_json'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名严谨的知识型纪录片资料考证员。按立项 Brief 的核心问题、范围和排除项，从参考资料中提取原子化的证据卡（Evidence Cards）。参考资料支持的主张可列为事实；模型已有知识可以提出待核查的事实线索，但不能充当核实来源。
核心规则：
1. 每张证据卡只包含一个独立事实主张；
2. claim_type 严格限定五选一：verified_fact（已证实客观事实）、unverified_fact（待核查事实线索）、disputed_claim（存在争议）、legend_or_anecdote（民间传说/轶事）、author_interpretation（主观推论）；
   verified_fact 必须附上本次输入中实际出现、可直接定位该主张的 http(s) 来源链接；没有链接或只有出处名称时，不要创建 verified_fact 卡。
3. 必须输出 JSON 数组，每项包含：
   - evidence_id: 如 "EV-001"
   - claim_type: 五选一
   - evidence_summary: 事实客观中文概括
   - source_title: 资料出处说明
   - source_url: 资料中已给出的出处链接；没有则为空字符串，且不能标为 verified_fact
   - reliability: high / medium / low
请直接输出纯 JSON 数组，严禁包含任何前缀后缀说明。`,
  },

  W4_outline: {
    template_id: 'W4_outline',
    template_version: '1.1.0',
    label: '4. 大纲策划',
    full_label: 'W4 · 5~7 章结构化大纲策划',
    description: '用于「基于证据卡生成大纲」阶段，必须输出合法 Outline JSON。',
    allowed_inputs: ['brief_json', 'evidence_cards_json'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名知识型长视频总编剧。请基于 brief 与已审核的证据卡列表，构建一份采用【总—分—总】强主线架构的结构化大纲。
核心铁律（彻底杜绝散架、跑题与结尾空虚）：
1. 【严格“总—分—总”三段骨架】：
   - **总起（opening_hook）**：抛出现象反差或常见误解后，直接给出全片总论点与分章原因路线图；
   - **分述（chapters，4~6 章）**：每一章对应总论点下的一条正面核心原因，按清晰逻辑递进、彼此咬合，不做松散的平行知识点拼盘；**严禁把最后一章单独水成一整章“解释的边界 / 方法论免责声明 / 局限性盘点”**——证据限定条件和适用边界只用 1~2 句话自然嵌入对应章节内部，确保全片 80% 以上篇幅正面回答标题的“为什么”；
   - **总收（single_ending_plan）**：revisit_core_question 必须逐条串联并整合全部正文章节的核心原因，说明它们如何共同拼出完整答案；final_takeaway 必须给出完整有力的终局收束方向（严禁只写一句“现有证据无法定量回答”式的空虚敷衍）。
2. 【因果立章，拒绝编年史与双层割裂】：每一章必须正面回答总标题“为什么”的一条核心原因！严禁按纯时间线流水账排章节，也不能把“某场历史争议八卦”单独水成一章；正文章节须完整覆盖立项 Brief 中的内在驱动原因与外部成立条件。
3. 【单章强制因果锚定】：每章必须填写 direct_reason_to_title，用“因为……”一句话写死本章直接贡献了总标题的哪一条核心原因。如果某一章写不出直接的“因为……”，说明该章跑题，必须重设！
4. 【环环相扣过渡】：每章的 transition_to_next 必须写成“因果递进锁链”（如：“解决了A层面的原因，还只回答了一半；如果仅仅如此，为什么在B层面上仍然成立？”），把全片串成一条紧扣总论点的推理链。
5. 每章的 supporting_evidence_ids 必须引用现有卡库中实际支持本章论点的编号；
6. 【严格面向观众，严禁泄露卡库与补证备注】：opening_hook.immediate_short_answer、各章的 mechanism_or_background_summary 与 transition_to_next，以及 single_ending_plan 只能包含面向观众的叙事规划。严禁写入“现有卡库缺少……”“正式制作前需补充”“正式使用前须核验”“待补证”等内部制作备注，也严禁要求章节在正文中“列出制作前必须补充的证据”。若某项证据有限，应规划章节只围绕已核实事实展开，并用面向观众的客观表述一句带过局限性，绝不喧宾夺主。
7. 必须且仅输出合法的 JSON 格式：
{
  "project_id": "xxx",
  "title": "视频标题",
  "approval_status": "pending_user_review",
  "opening_hook": {
    "opening_question": "开头抛出的生活反差矛盾与直觉疑问",
    "immediate_short_answer": "前1-2分钟直接给出的总因果路线图（明确点出内在驱动原因与外部成立条件共哪几条，绝不卖关子）",
    "supporting_evidence_ids": ["EV-001"]
  },
  "chapters": [
    {
      "chapter_number": 1,
      "chapter_title": "第1章标题（直指原因本身）",
      "sub_question": "本章回答的核心子问题",
      "direct_reason_to_title": "本章对总标题的直接回答：因为……（一针见血点出本层原因）",
      "mechanism_or_background_summary": "底层因果机制阐述与案例安排",
      "supporting_evidence_ids": ["EV-001", "EV-002"],
      "transition_to_next": "收束本章原因并指出单靠这一条还不够，自然引出下一章原因的递进设问"
    }
  ],
  "single_ending_plan": {
    "revisit_core_question": "逐条回扣并汇总前文拆解出的各层核心原因（内在动因+外部条件+真实边界）",
    "final_takeaway": "全片唯一收尾结论，基于因果事实干净收束，严禁空洞鸡汤口号，严禁加入新事实"
  }
}`,
  },

  W5_chapter: {
    template_id: 'W5_chapter',
    template_version: '1.1.0',
    label: '5. 逐章撰写',
    full_label: 'W5 · 单章四段式受控撰写',
    description: '用于「AI 撰写当前章节」阶段，支持插入 {{chapter_number}} 等全局与章节上下文变量。',
    allowed_inputs: [
      'title',
      'core_question',
      'short_answer',
      'outline_overview',
      'chapter_number',
      'chapter_title',
      'sub_question',
      'direct_reason_to_title',
      'prev_chapter_context',
      'next_chapter_context',
      'supporting_evidence_ids_json',
      'target_chapter_json',
      'evidence_cards_json',
    ],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名知识型纪录片撰稿人。你的任务是围绕全片总标题的核心“为什么”，严格撰写指定单章的旁白文稿。
【全片主线锚点（写作时必须时刻对齐，严禁跑题）】：
- 视频总标题：{{title}}
- 全片核心设问：{{core_question}}
- 全片总因果答案：{{short_answer}}
- 全片章节因果脉络：
{{outline_overview}}
- 上一章衔接上下文：{{prev_chapter_context}}
- 下一章待引出方向：{{next_chapter_context}}

核心规则：
1. 严禁一次写整片，只写当前这一章（第 {{chapter_number}} 章，约 800-1400 中文字）；
2. 【定位“分论点”，死死咬住中心原因】：
   - 本章是全片【总—分—总】结构中的一个“分论点”章节，存在的唯一目的就是向观众讲透并证明这一条直接原因：{{direct_reason_to_title}}；
   - **全章 80% 以上篇幅必须正面论证并证明这条原因**，所有案例、历史事件或数据只为这条原因服务，讲完必须立刻落回全片核心问题“{{title}}”，严禁跑题发散；
   - **【克制边界，严禁防御性免责反客为主】**：保留事实限定条件或不确定性时，每处最多用 1~2 句话点到为止，严禁大段反复车轱辘“相关性不等于因果/不能量化/有待检验”冲淡中心论点！
3. 内部结构遵循紧凑的四步推演：
   - 1_question_or_contradiction: 承接上一章留下的因果缺口，直接抛出本章要解决的具体矛盾与子问题（{{sub_question}}）；
   - 2_mechanism_or_background: 亮出底层的因果齿轮（直接拆解：为什么会这样？背后的技术/法理/经济/生理或制度运转逻辑是什么）；
   - 3_sourced_concrete_examples: 基于本章给出的证据卡写具体案例与事实数据，用来实证上述机制，保留必要限定条件（点到为止），严禁伪造内心独白；
   - 4_mini_summary_and_transition: 【自然钉回主线，去掉机械报数腔】不要每章死板重复“这就是《{{title}}》的第 {{chapter_number}} 层原因”，而是用自然口语把本章结论钉回全片总论点，再顺滑引出下一章（{{next_chapter_context}}）。非终章严禁做全片大结局总结！
4. 【严禁泄露制作/审稿元话语（最高优先级）】：sections.* 与 full_chapter_narration 是直接念给观众听的口播正文，严禁出现任何面向创作者或审稿流程的内部话术，包括“现有卡库”“现有证据卡”“现有材料不足”“正式制作前”“正式使用前”“待补证”“待核验原文”“等这些资料补上”“[需要人工核查]”等。遇到证据边界或未定量问题，必须转化为面向观众的客观表述（例如“目前公开研究还不足以……”“现有流行病学观察还无法直接断定……”）。
5. 必须输出合法 JSON 格式：
{
  "chapter_number": {{chapter_number}},
  "chapter_title": "{{chapter_title}}",
  "sub_question": "{{sub_question}}",
  "direct_reason_to_title": "{{direct_reason_to_title}}",
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
    template_version: '1.2.0',
    label: '6. 全文统稿',
    full_label: 'W6 · 全文统稿去伪结尾与定稿',
    description: '用于「全篇合并统稿与去伪结尾」阶段，必须输出 final-script JSON。',
    allowed_inputs: ['brief_json', 'outline_json', 'chapters_json', 'evidence_cards_json'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是一名资深长视频总编审。你的任务是对全片章节进行全文统稿编辑（Full Script Editing），将其熔炼为一篇【总—分—总结构严密、紧扣中心论点、章与章环环相扣】、可直接用于真人配音（TTS）与分镜制作的纯口播定稿。
核心规则：
1. 【“总—分—总”定稿硬标准（最高优先级，彻底根治分散与结尾空虚）】：
   - **总起（opening，必须写满 300~450 中文字的完整开篇）**：独立完整的纯口播开篇——先抛出日常反差或常见误区，再明确亮出全片总论点与各分章原因路线图，让观众开篇即懂全片脉络；若原第 1 章开头与开篇有重复铺垫，保留 opening 中的总论点与路线图，删去第 1 章重复铺垫。
   - **分述（chapters）**：每一章紧扣全片总论点正面论证，删去跨章重复、每章末尾“这就是第X层原因”的机械报数腔，以及游离于主线之外的冗长防御性免责段落（必要限定条件只保留 1~2 句点到为止），确保章间因果递进顺滑。
   - **总收（ending，必须写满 300~500 中文字的扎实收尾，严禁只写一两句空洞概括！）**：完整、扎实、统筹全篇的终局收尾——必须按逻辑主线**逐条回收前面所有分章拆解出的核心原因**，说明它们如何共同回答总标题的“为什么”，最后用 1~2 句有力、不鸡汤的结论干净收束。严禁写“因为人类文明足够自信”“发人深省”之类空洞口号，也严禁把结尾敷衍成一句“现有研究无法定量”。
2. 【格杀跨章节重复与相邻章节抢写】：
   - 若开篇（opening）与第 1 章开头有重复铺垫，务必保留 opening 中的全片总答案，删去第 1 章开头重复的现象铺垫；
   - 删除跨章节重复解释的同一论点与重复出场的同一案例；
3. 【格杀中间章节末尾的“伪结尾”与高频车轱辘话】：
   - 若多个章节末尾都机械重复同一套升华总结或反复提及同一个热点事件（如每章结尾都复读一遍相同的道德反思或同一游戏/新闻），必须将中间各章末尾的这些伪结尾全部删除，改为钉死本章原因并引出下一章核心问题的自然口语过渡；
   - 全片只保留唯一一个正式终局结尾（ending）；
4. 对照证据卡核对事实、时间、数据和出处，保留证据的适用范围和不确定性。统一全片术语、年代读法与口语化节奏；
5. 【格杀制作/审稿元话语与 AI 对话痕迹】：主动扫描并删除或改写任何泄露出来的内部制作备注或 AI 对创作者的提醒（如“现有卡库”“现有证据卡”“正式制作前还需要补充”“正式使用前须核验”“待补证”“待核验原文”“等这些资料补上”等），确保全片 100% 为面向观众的纯口播内容；
6. 【彻底消除标题与书面壳子，转为纯口播流】：
   - 严禁在 opening、narration_text、ending 的正文中出现任何“第一章”“第二节”“Part 1”“一、”“1.”等章节标题、小标题、Markdown 标题符（# / ## / **）或分隔线（=== / ---）；
   - 章节归属名仅保留在 JSON 的 chapter_title 元数据字段中，供后台分镜分组使用，绝不可混入 narration_text 正文；
7. 按大纲保留全部正文章节及原章节编号（注意：opening 与 ending 独立存放在顶层字段，严禁再把 opening 或 ending 作为章节塞入 chapters 数组导致双倍重复！），输出标准 final-script.json 结构：
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
    "opening": "纯口播开篇旁白正文（抛出反差+直接给出全片总因果路线图，不含任何标题与符号）",
    "chapters": [
      {
        "chapter_number": 1,
        "chapter_title": "第1章标题（仅作后台分镜归属标签）",
        "narration_text": "纯口播本章正文（围绕本章直接原因展开，章末钉死本章原因并自然过渡到下一章）"
      }
    ],
    "ending": "纯口播全片唯一终局收尾正文（清晰回扣全片各层核心原因与边界，无空洞鸡汤，不含任何标题与符号）"
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

【本次指定风格定位（最高优先级，必须明显体现在全文语态、句式节奏与用词上）】：
{{style_guide}}

【你必须严格执行的改稿铁律】：
1. 【格杀 AI 八股词与机械套话】：禁止“总而言之”、“不可否认的是”、“值得注意的是”、“在历史的长河中”、“具有深远的历史意义”等填词套话，改为贴合【本次指定风格定位】的自然口语过渡。
2. 【拆解长难句，建立听觉呼吸感】：将超过 18 字的书面长句拆碎为短促有力的口语短句，留足停顿与呼吸感。
3. 【脱脂去冗余，严保因果链】：删掉重复啰嗦的学术修饰与车轱辘话，但必须 100% 保留原文的开篇总原因结论、每章的核心因果推论与章末过渡桥，严禁把回答“为什么”的硬核结论句删成纯故事！
4. 【严格落实指定人设语态】：严格按照上方【本次指定风格定位】重构全篇的语气、节奏、设问与比喻方式，确保不同人设之间呈现出截然不同的听觉气质，严禁无视风格定位千篇一律地写成同一种普通大白话。
5. 【绝对保真】：所有真实年份、人名、地名、数据必须 100% 保留，不可篡改事实。
6. 【纯口播连贯化，消除标题外壳】：彻底消除文本中残留的任何章节大标题、小标题、序号（如“第一章”“一、”）、Markdown 符号（# / **）或分隔符（=== / ---），用自然的口语过渡衔接上下文，确保整篇输出可直接送去真人配音。
7. 【严禁保留或口语化制作/审稿元话语】：严禁保留任何面向创作者的补证/核验备注，更严禁将其改写成“等这些资料补上，咱们才能……”之类像在和制作人对话的口语。若原文中混入“现有卡库”“现有证据卡”“正式制作前还需要补充”“正式使用前须核验”“待补证”“待核验原文”等句子，必须直接删除或改写为纯面向观众的客观口播表达。

【输出格式要求（极其重要）】：
请直接输出改写后的纯文本旁白正文（不要用 JSON 包裹整篇正文，不要输出任何前言开场白），并在全文末尾最后一行附带一句极简审计标记：
<<<AUDIT>>>{"removed_ai_phrases":["词1","词2"],"split_long_sentences_count":15,"humorous_analogies_count":4,"audit_report":"一句话改进总结"}`,
  },

  W8_revision_search: {
    template_id: 'W8_revision_search',
    template_version: '1.0.0',
    label: '8. 改稿联网检索',
    full_label: 'W8 · 改稿联网检索词提炼',
    description: '用于总编定向改稿开启「联网查证」时，判断并提炼 Tavily 检索词（必须保留 JSON 输出说明）。',
    allowed_inputs: ['title', 'instruction'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是新闻与事实检索词提炼助手。
根据视频题目和总编的改稿意见，判断是否需要联网查询最新新闻、事件、数据或案例。
严格只输出合法 JSON 对象：{"need_search": true/false, "queries": ["检索词1", "检索词2"]}。
要求：最多 2 条精准简短检索词（适合搜索引擎，中英文均可，涉及国际新闻或海外专有名词建议包含一条英文词）。`,
  },

  W9_revision_plan: {
    template_id: 'W9_revision_plan',
    template_version: '1.1.0',
    label: '9. 改稿方案规划',
    full_label: 'W9 · 总编改稿影响方案规划',
    description: '用于「📋 生成改稿影响方案」阶段，决定各章重写/微调/保持不动策略（必须保留 JSON 输出说明）。',
    allowed_inputs: ['title', 'core_question', 'short_answer', 'scope', 'instruction', 'facts_block'],
    require_json: true,
    require_audit_marker: false,
    raw_template: `你是知识型长视频的首席总编审（Editorial Director）。
用户（视频创作者/总编）对现有定稿文案提出了审稿与改稿意见。你现在的任务是先制定一份精准、克制、死守核心因果主线的《改稿影响方案（Revision Plan）》，而不是直接重写全文。
核心原则：
1. 【死守全片因果主线】：无论怎么改稿，全片必须始终围绕总标题（{{title}}）回答“为什么”。任何改写都必须保留并强化全片的核心原因总纲（{{short_answer}}），严禁在改写开篇或结尾时把解释“为什么”的核心因果结论弄丢！
2. 保护好内容：只把真正需要改动的章节标为 rewrite（重写）或 light_edit（微调/融入呼应/顺滑衔接），未受影响的章节必须标为 keep（保持原样不动），绝不无故推翻原有扎实论证；
3. 尊重作用范围：editable_in_scope 为 false 的章节，action 必须为 keep；
4. 全篇连贯性与克制原则（极其重要）：
   - 如果用户要求“用最新热点新闻/新案例作为开头引子”（即便附带说了“其他地方也可做合适修改”），默认只将开篇（opening）标为 rewrite（要求：用新引子切入反差后，必须在开篇末尾明确亮出全片的核心原因总答案！），并仅在终局结尾（ending）或全片最契合的最多 1 个章节标为 light_edit 进行首尾呼应；
   - 严禁把全片所有中间历史/机制章节全部标为 light_edit 并要求每章末尾都强行提及该新闻引子（这会导致全篇跑题并出现高度重复的伪结尾！）；其余未受直接影响的章节必须标为 keep；
5. 零编造：若涉及新新闻/新案例，必须严格依托提供的联网检索资料或用户原文，严禁在方案里杜撰未提供的销量、日期或数据。
必须且仅输出合法 JSON 对象：
{
  "overall_strategy": "2~3句话概括全篇改稿方向与如何锁紧总标题的核心因果主线",
  "new_thread_or_hook": "新增的核心切入点或全篇贯穿暗线（如无则留空字符串）",
  "segment_plans": [
    {
      "seg_id": "必须与输入 seg_id 完全一致",
      "action": "rewrite | light_edit | keep",
      "reason": "简短说明为什么改或为什么保留",
      "edit_instructions": "具体可执行的改写要求（keep 时为空字符串；opening 改写时必须注明保留/亮出全片核心原因结论）"
    }
  ]
}`,
  },

  W10_revision_execute: {
    template_id: 'W10_revision_execute',
    template_version: '1.1.0',
    label: '10. 按章定向改写',
    full_label: 'W10 · 按方案逐章定向改写',
    description: '用于「🚀 按此方案执行定向改稿」阶段，对受影响章节执行纯口播改写。',
    allowed_inputs: [
      'title',
      'core_question',
      'short_answer',
      'overall_strategy',
      'new_thread_or_hook',
      'instruction',
      'segment_title',
      'action_mode',
      'edit_instructions',
    ],
    require_json: false,
    require_audit_marker: false,
    raw_template: `你是知识型长视频深度解说文案总编剧，负责按总编审稿意见对指定章节进行精准改写。
必须严格遵守以下铁律：
1. 【死锁核心因果，严禁改丢主线】：
   - 全片核心标题是《{{title}}》，全片核心结论是：{{short_answer}}；
   - 如果当前改写的是【开篇导引（opening）】：在用新引子或反差切入问题后，**必须在开篇后半段直接点明全片的核心原因总纲**（即直接告诉观众这个问题背后的核心原因有哪几层），绝不能只抛问题、只讲引子却把开篇的核心结论给删了！
   - 如果当前改写的是【正文章节】：必须保留并强化本章回答总标题“为什么”的核心机制结论与章末过渡桥，严禁把因果论证改成空洞的议论或离题八卦；
   - 如果当前改写的是【终局结尾（ending）】：必须清晰汇总并回扣前文拆解出的各层具体原因，严禁写空洞的鸡汤口号或强行升华。
2. 纯口播正文：直接输出改写后的纯文本旁白，严禁输出 JSON、Markdown 标题（# / **）、章节标题（如“第一章”“开篇导引”）、分隔线或任何解释性前言后语；
3. 呼吸感与口语化：短句为主，听觉顺畅，适合直接送去 TTS / 真人配音；
4. 零编造底线：原有事实、年份、案例不可篡改；新增的新闻或外部案例必须严格依据提供的【联网查证资料】或总编原文，若资料未给出具体数字/日期，严禁自行编造，须用客观稳妥的表述；
5. 严密衔接与零抢写：自然承接上一章，并在末尾用一句简短设问顺滑引出下一章主题；严禁把下一章的开头内容提前抢写到本章末尾，也严禁在中间章节末尾加长篇大论的“伪结尾”或重复前面章节已经说过的总结套话；
6. 严禁泄露制作/审稿元话语：改写后的口播正文中严禁出现“现有卡库”“现有证据卡”“正式制作前”“正式使用前”“待补证”“待核验原文”“等这些资料补上”等面向创作者的内部工作备注。`,
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

export function getBuiltinRevisionQuickChips() {
  return WRITER_REVISION_QUICK_CHIPS.map((c) => ({ ...c }));
}

function normalizeQuickChips(list) {
  if (!Array.isArray(list)) return null;
  const cleaned = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') return null;
    const label = String(item.label || '').trim();
    const prompt = String(item.prompt || '').trim();
    if (!label || !prompt) return null;
    cleaned.push({
      id: String(item.id || `custom_${i + 1}`).trim() || `custom_${i + 1}`,
      label,
      prompt,
    });
  }
  return cleaned.length > 0 ? cleaned : null;
}

function hasCustomizedQuickChips(chips) {
  if (!Array.isArray(chips) || chips.length === 0) return false;
  if (chips.length !== WRITER_REVISION_QUICK_CHIPS.length) return true;
  for (let i = 0; i < WRITER_REVISION_QUICK_CHIPS.length; i++) {
    const cur = chips[i] || {};
    const def = WRITER_REVISION_QUICK_CHIPS[i];
    if (String(cur.label || '').trim() !== def.label || String(cur.prompt || '').trim() !== def.prompt) {
      return true;
    }
  }
  return false;
}

export function getWriterPromptsState(projectDir, projectId) {
  const builtins = getBuiltinWriterPromptTemplates();
  const builtinQuickChips = getBuiltinRevisionQuickChips();
  const preset = loadProjectWriterPromptPreset(projectDir);
  const effectiveQuickChips =
    Array.isArray(preset?.revision_quick_chips) && preset.revision_quick_chips.length > 0
      ? preset.revision_quick_chips
      : builtinQuickChips;
  const hasCustom = Boolean(
    preset && (hasAnyCustomizedTemplate(preset.templates) || hasCustomizedQuickChips(preset.revision_quick_chips))
  );
  return {
    ok: true,
    project_id: projectId,
    has_custom_preset: hasCustom,
    builtins,
    style_presets: WRITER_STYLE_PRESETS,
    builtin_revision_quick_chips: builtinQuickChips,
    revision_quick_chips: effectiveQuickChips,
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

  let quickChips =
    Array.isArray(existing?.revision_quick_chips) && existing.revision_quick_chips.length > 0
      ? existing.revision_quick_chips
      : getBuiltinRevisionQuickChips();
  if (payload.revision_quick_chips !== undefined) {
    const normalized = normalizeQuickChips(payload.revision_quick_chips);
    if (!normalized) {
      return { ok: false, error: '快捷改稿指令至少保留 1 条，且每条的按钮名称与提示词内容均不能为空' };
    }
    quickChips = normalized;
  }

  const hasCustom = hasAnyCustomizedTemplate(templatesMap) || hasCustomizedQuickChips(quickChips);
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
    revision_quick_chips: quickChips,
  };

  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf8');
  return {
    ok: true,
    has_custom_preset: hasCustom,
    preset,
    revision_quick_chips: quickChips,
  };
}

export function resetProjectWriterPromptPreset(projectDir, projectId, templateId = null) {
  const builtins = getBuiltinWriterPromptTemplates();
  const builtinQuickChips = getBuiltinRevisionQuickChips();
  const filePath = getWriterPromptPresetPath(projectDir);

  if (templateId === 'revision_quick_chips') {
    const existing = loadProjectWriterPromptPreset(projectDir);
    if (!existing) {
      return {
        ok: true,
        has_custom_preset: false,
        preset: null,
        revision_quick_chips: builtinQuickChips,
      };
    }
    const hasCustomTemplates = hasAnyCustomizedTemplate(existing.templates);
    if (!hasCustomTemplates) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return {
        ok: true,
        has_custom_preset: false,
        preset: null,
        revision_quick_chips: builtinQuickChips,
      };
    }
    const nextRevision = (Number(existing.revision) || 0) + 1;
    const preset = {
      ...existing,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
      has_custom_preset: true,
      revision_quick_chips: builtinQuickChips,
    };
    fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf8');
    return {
      ok: true,
      has_custom_preset: true,
      preset,
      revision_quick_chips: builtinQuickChips,
    };
  }

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
        revision_quick_chips: builtinQuickChips,
      };
    }
    const updatedTemplates = { ...(existing.templates || {}) };
    updatedTemplates[templateId] = {
      template_id: templateId,
      template_version: builtins[templateId].template_version,
      raw_template: builtins[templateId].raw_template,
      description: `已重置为出厂默认 ${builtins[templateId].label}`,
    };

    const hasCustom =
      hasAnyCustomizedTemplate(updatedTemplates) || hasCustomizedQuickChips(existing.revision_quick_chips);
    if (!hasCustom) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return {
        ok: true,
        has_custom_preset: false,
        preset: null,
        revision_quick_chips: builtinQuickChips,
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
      revision_quick_chips: existing.revision_quick_chips || builtinQuickChips,
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
    revision_quick_chips: builtinQuickChips,
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
