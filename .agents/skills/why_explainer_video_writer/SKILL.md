---
name: why_explainer_video_writer
description: Use this skill when the user wants to research, outline, write, revise, fact-check, or produce a long-form Chinese “why” explainer video script about history, geography, food, culture, tourism, society, or technology.
---

# Why Explainer Video Writer (中文“为什么”知识型长视频文案生产 Skill)

## 1. 目标与核心定位

本 Skill 用于将**经过人工收集或审核的资料**，逐步转化为一篇约 **20至30分钟**（约 6000–9000 中文字）的中文“为什么”知识型视频旁白稿。

### 重要原则
1. **原创纪录片文风**：不要模仿、复刻或引用任何具体博主、频道或现有作品的独特措辞、口头禅或标志性句式。
2. **通用知识型纪录片结构**：开头提出问题、先给简短答案、分模块层层拆解、结合有来源的具体例子和对比、语言口语化且有画面感、全片仅保留一个回扣主题的结尾。
3. **分阶段受控生产**：将长视频文案拆解为有限、可审核的阶段，**绝对不要一次性生成全部 20–30 分钟的完整长文**。

---

## 2. 固定执行流程 (Step-by-Step Workflow)

执行本 Skill 时，必须严格按照以下 10 个步骤推进：

### 阶段一：立项与资料校验（Step 1 - Step 2）
1. **接收输入**：接收题目、目标受众、目标时长、语言、已审核资料或 URL。
   - **缺资料拦截规则**：如果用户只给出一个标题而没有提供实质资料，**必须先停下来**要求用户提供资料，或先输出《待研究问题清单与建议资料来源》，**严禁直接假装完成历史或事实研究**。
2. **生成 Brief**：明确核心问题、解释范围、暂定核心结论、目标受众、内容禁区和规划章节数量（5–7章）。数据结构须符合 [`templates/brief.json`](./templates/brief.json)。

### 阶段二：证据提取与分型（Step 3 - Step 4）
3. **提取 Evidence Cards**：调用 [`prompts/01_extract_evidence.md`](./prompts/01_extract_evidence.md) 的规则，将资料拆解为独立的证据卡（数据结构见 [`templates/evidence-card.json`](./templates/evidence-card.json)）。
   - **单一主张原则**：每张卡片只能包含**一个**具体事实主张。
   - **必填字段**：必须记录 `evidence_id`、`source_url`、`source_type`、`reliability`、`evidence_summary`、`claim_type`。
4. **严格限定 `claim_type`**：每张证据卡的 `claim_type` 必须且只能为以下四者之一：
   - `verified_fact`（已核实的客观事实）
   - `disputed_claim`（学界或业界存在争议的说法）
   - `legend_or_anecdote`（民间传说、轶事或未证实故事）
   - `author_interpretation`（原作者或资料整理者的主观看法/推论）

### 阶段三：构建大纲与人工审核门禁（Step 5 - Step 6）
5. **生成 5–7 章大纲**：调用 [`prompts/02_build_outline.md`](./prompts/02_build_outline.md)，基于已提取的 Evidence Cards 生成 5 到 7 章结构化大纲（数据结构见 [`templates/outline.json`](./templates/outline.json)）。
   - **单章单问**：每一章只回答一个明确的子问题，并绑定对应的 `evidence_ids`。
6. **强制人工审核门禁（STOP & REVIEW）**：
   - 在开始写任何章节正文之前，**必须停下来要求用户审核 Brief、Evidence Cards 和 Outline**。
   - **未经用户明确确认，绝对不得开始长文写作。**

### 阶段四：逐章撰写（Step 7 - Step 8）
7. **单章推进**：用户确认大纲后，调用 [`prompts/03_write_chapter.md`](./prompts/03_write_chapter.md)，**一次只写一个章节**（数据结构见 [`templates/chapter.json`](./templates/chapter.json)）。
8. **单章固定四段结构**：每一章必须遵循以下内部结构：
   1. **章节问题或矛盾**（承接上文，抛出本章要解决的具体反差或疑问）
   2. **形成机制或背景**（解释背后的地理、历史、经济、技术或社会运转逻辑）
   3. **有来源的具体例子**（必须绑定 `evidence_id`，呈现具体场景、物件、动作或对比，严禁无来源编造）
   4. **小结和自然过渡**（简短收束本章子问题，并引出下一章的疑问；非最终章严禁写总结性陈词）

### 阶段五：全文统稿与事实风险扫描（Step 9 - Step 10）
9. **执行全文编辑（Full Script Editing）**：所有章节完成后，调用 [`prompts/04_edit_full_script.md`](./prompts/04_edit_full_script.md) 对全稿进行整合与清洗（数据结构见 [`templates/final-script.json`](./templates/final-script.json)）：
   - 删除跨章节的重复论点、重复例子、重复对比；
   - 统一术语、人名、地名、年代格式和叙述语气；
   - 识别并删除各章节末尾残留的“伪结尾 / 多次结尾”；
   - 全片**只保留一个正式结尾**，结尾回扣视频标题的核心问题；
   - **严禁在结尾加入任何前文未出现的新事实或新证据。**
10. **执行事实风险审核（Fact & Risk Check）**：调用 [`prompts/05_fact_risk_check.md`](./prompts/05_fact_risk_check.md)，对照 [`references/quality-checklist.md`](./references/quality-checklist.md) 与 [`references/forbidden-claims.md`](./references/forbidden-claims.md)，输出结构化的**事实与表述风险清单**，供人工最终拍板，而不是偷偷编造或擅自改写存疑事实。

---

## 3. 真实性与安全红线 (Truthfulness & Safety Rules)

1. **零编造原则**：不得编造具体数字、年代、人名、引语、机构评价、法律条文、统计数据或历史事件。
2. **事实与传说隔离**：不得把 `legend_or_anecdote`（传说/轶事）、推测或影视化想象写成 `verified_fact`（已证实的历史）。若引用传说作为文化背景说明，必须在旁白中明确标注“民间相传”“有一种未经证实的说法认为”。
3. **无证据强制标记**：任何没有 `evidence_id` 支持的具体事实主张，必须在文稿和审核清单中显式标记为 `[需要人工核查]`。
4. **禁用绝对化表达**：不使用“全世界只有”“所有外国人”“必然”“唯一原因”“自古以来无一例外”等绝对化表达，除非有明确且权威的证据直接支持（详见 [`references/forbidden-claims.md`](./references/forbidden-claims.md)）。
5. **严密的时空与程度区分**：在论述起源与发展时，必须明确区分以下四个完全不同的概念，不得混为一谈：
   - **某地最早出现**（考古或自然起源）
   - **某地最早有文字记录**（文献记载留存）
   - **某地最早规模化/商业化生产**（产业化节点）
   - **某地最为流行或成为文化代表**（传播与认知度）
6. **无资料不硬写**：若输入仅有标题或模糊想法，必须先输出“待研究问题和建议资料来源”，请求用户补充。
7. **防死循环熔断机制（最多重写两次）**：在任何修订或润色阶段（大纲修改、单章重写、全文统稿），每个阶段**最多重写两次**。如果经过两次重写仍无法满足质量清单或存在证据缺口，必须停止自动重写并输出 `[需要人工决策]`，说明卡点原因与可选方案，不得无限循环。

---

## 4. 文风与旁白规范 (Style Rules)

详细规范见 [`references/style-guide.md`](./references/style-guide.md)，核心要求如下：
- **中文口语化，适配 TTS 朗读**：多用自然短句，避免多层套嵌的长定语、文言虚词、书面公文腔及括号注释；数字与年份写法需便于语音合成自然断句。
- **短段落、单焦点**：每个自然段聚焦一个明确观点或一个具体画面，段落之间逻辑递进清晰。
- **具象但克制的画面感**：可以描写具体画面、器物、动作和日常生活场景，但**不得伪造历史人物的内心独白、微表情或未经记载的历史现场对话**。
- **平实理性的比喻与对照**：可使用适度的生活化比喻和跨地域/跨时代对照来降低理解门槛，但**绝不煽动民族对立、地域歧视，不贬低其他文化或群体**。
- **清晰优先**：优先保证逻辑清楚、事实准确、一听就懂，而不是堆砌华丽形容词或空洞的煽情口号。
- **单一结尾控制**：全片只设置一个结尾；结尾干净利落地回扣标题核心问题，不重复总结多次，不强行升华说教。

---

## 5. 目录文件导航

- **数据结构模板 (`templates/`)**
  - [`templates/brief.json`](./templates/brief.json)：项目立项与范围定义模板
  - [`templates/evidence-card.json`](./templates/evidence-card.json)：单一事实主张证据卡模板
  - [`templates/outline.json`](./templates/outline.json)：5–7 章结构化大纲与人工审核门禁模板
  - [`templates/chapter.json`](./templates/chapter.json)：单章四段式旁白文稿模板
  - [`templates/final-script.json`](./templates/final-script.json)：统稿后完整视频脚本与审核报告模板
- **分阶段执行提示词 (`prompts/`)**
  - [`prompts/01_extract_evidence.md`](./prompts/01_extract_evidence.md)：资料转证据卡提示词
  - [`prompts/02_build_outline.md`](./prompts/02_build_outline.md)：证据卡转大纲提示词
  - [`prompts/03_write_chapter.md`](./prompts/03_write_chapter.md)：单章写作提示词
  - [`prompts/04_edit_full_script.md`](./prompts/04_edit_full_script.md)：全局去重、统一与收尾控制提示词
  - [`prompts/05_fact_risk_check.md`](./prompts/05_fact_risk_check.md)：事实风险扫描提示词
- **参考规范与检查表 (`references/`)**
  - [`references/style-guide.md`](./references/style-guide.md)：知识型纪录片旁白风格与段落规则
  - [`references/quality-checklist.md`](./references/quality-checklist.md)：大纲、章节、全文、事实审核四份检查清单
  - [`references/forbidden-claims.md`](./references/forbidden-claims.md)：禁用夸张/排外/无证据表达及安全替换写法
