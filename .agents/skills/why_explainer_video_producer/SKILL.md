---
name: why_explainer_video_producer
description: Use this skill when the user wants to convert an approved Chinese “why” explainer video narration script, TTS audio, word/sentence timestamps, captions, and a licensed asset index into a human-reviewable scene manifest, Remotion render props, and a video QC report.
---

# Why Explainer Video Producer V2 (通用中文“为什么”知识型视频视觉策划与镜头清单生产 Skill)

## 1. 目标、通用性与项目隔离边界 (V2 Architecture)

本 Skill 是**完全主题无关（Topic-Agnostic）**的通用视觉策划与 Remotion 渲染数据生产引擎，适用于任意领域的中文“为什么”知识型解释视频，包括但不限于：
- **日本旅行与文化** (`travel_and_culture`)
- **历史地理** (`history_and_geography`)
- **饮食文化** (`food_and_culinary`)
- **社会议题** (`social_issues`)
- **公共财政与大型赛事** (`public_finance_and_mega_events`)
- **工程技术与日常器物** (`science_and_technology`)

### 强制架构隔离原则（Generic Engine vs. Project Fixture）
1. **通用层零硬编码**：严禁将任何特定视频项目的标题、旁白句子、搜索关键词、地名、历史概念或特定主题规则写死到本 Skill、通用 JSON Schema（`templates/*.json`）、通用构建/QC 脚本（`scripts/*`）或 Remotion 通用组件（`src/*`）中。
2. **单项目自包含目录 (`projects/<project_id>/`)**：所有与特定视频主题相关的数据文件、配音、字幕、测试/正式素材及渲染输出，必须且只能存放在 `projects/<project_id>/` 目录下：
   - `projects/<project_id>/project-config.json`：项目级元数据与领域配置
   - `projects/<project_id>/final-script.json`：已审核定稿旁白
   - `projects/<project_id>/sentence-timestamps.json`（或 `word-timestamps.json`）：真实音频时间戳
   - `projects/<project_id>/audio/narration.wav`（或 `.mp3`）：配音音频
   - `projects/<project_id>/captions/captions.srt`：时间轴对齐字幕
   - `projects/<project_id>/asset-index.json`：项目合法素材与占位素材目录
   - `projects/<project_id>/scene-manifest.json`：本 Skill 生成的镜头总表（含 `procedural_props`）
   - `projects/<project_id>/render-props.json`：由通用编译器生成的 Remotion 渲染入参
   - `projects/<project_id>/video-qc-report.json`：由通用质检器生成的视觉与工程 QC 报告

### 职责边界（严禁越界）
1. **只负责视觉策划、素材需求定义、合法素材匹配与镜头时间轴编排**。
2. **不重新研究事实、不改写旁白、不自动修复内容语义争议**（所有历史、地理、人物、财政账本或社会敏感争议一律标记 `human_review_required: true`，原样保留给人工审核）。
3. **不直接生成未授权视频、不接入外部付费 API、不创建 n8n 工作流**。

---

## 2. 强制执行流程 (Mandatory 5-Step Workflow)

执行本 Skill 时，针对任意给定的 `projects/<project_id>/` 输入，必须严格按顺序执行以下 5 个阶段：

### Step 1：按真实音频时间戳切分镜头单元（调用 [`prompts/01_segment_script.md`](./prompts/01_segment_script.md)）
1. **严格控制在 4–10 秒 (`4000ms–10000ms`)**：根据真实音频停顿点将旁白切分为时长在 **4.0 秒至 10.0 秒** 之间的独立镜头单元。
2. **零重叠、零空白缝隙**：首镜头从 `0 ms` 开始，相邻镜头 `prev.end_ms === curr.start_ms`，末镜头 `end_ms` 严格等于音频文件总时长。
3. **语义完整且原文零篡改**：切分点必须落在自然分句或完整语义边界，拼接后与 `final-script.json` 原文 100% 一致。

### Step 2：策划画面意图、6类通用视觉类型与组件数据（调用 [`prompts/02_plan_scenes.md`](./prompts/02_plan_scenes.md)）
1. **输出画面意图 (`visual_purpose` / `visual_intent`)，拒绝复述旁白**：说明画面具体呈现什么视觉证据、空间关系、账本对比或机制拆解。
2. **严格限定 6 种通用镜头类型 (`visual_type` / `scene_type`)**：
   - `broll_video`（实拍动态视频素材）
   - `photo_motion`（历史档案/静物图 + Ken Burns 推拉摇移视差动效）
   - `map`（地理空间、路线走廊、区域对比动态地图组件）
   - `timeline`（历史演进、政策/赛事时间节点组件）
   - `data_card`（公共财政账本、统计对比、多维机制拆解卡片组件）
   - `kinetic_text`（核心提问、破除迷思、关键结论动态排版文字组件）
3. **数据驱动的 `procedural_props`**：当镜头类型为 `map`、`timeline`、`data_card`、`kinetic_text`（或配置 `fallback`）时，必须在 `scene-manifest.json` 的该镜头节点内直接输出结构化的 `procedural_props`（包含 `headline`、`subheadline`、`items`、`metrics` 或 `nodes`），供通用 Remotion 组件直接渲染，严禁在渲染代码中硬编码任何文案。
4. **结尾镜头强制回扣主题**：`is_final_ending: true` 的镜头必须回扣本片核心问题与前文建立的拆解维度，严禁使用与主题无关的煽情通用素材。

### Step 3：生成跨领域中英文检索词与正负向约束（调用 [`prompts/03_generate_asset_queries.md`](./prompts/03_generate_asset_queries.md)）
每个镜头必须输出：
1. `search_queries_zh`（2–3 个中文具象检索词）
2. `search_queries_en`（2–3 个英文检索词）
3. `must_show`（画面必现的视觉元素清单）
4. `must_not_show`（画面严禁出现的时代穿帮、地域错置、商业商标或无关煽情元素）
5. `fallback`（缺实拍/档案素材时的程序化替代类型 `map | timeline | data_card | kinetic_text` 及具体组件说明 `component_spec`）

### Step 4：匹配合法素材库、防重冷却与人工审核门禁（调用 [`prompts/04_match_assets.md`](./prompts/04_match_assets.md)）
1. **缺失与低置信度素材诚实标记**：
   - 无匹配素材时，必须标记 `status: "NEEDS_HUMAN_ASSET"`（`final_asset_id: null`）；
   - 匹配置信度较低（`confidence_score < 0.70`）时，必须标记 `status: "LOW_CONFIDENCE_NEEDS_REVIEW"` 并触发人工审核；
   - 严禁随机塞入不相关素材或下载/剪取未授权第三方/YouTube视频。
2. **授权状态准入门禁 (`license_status`)**：
   - 正式生产仅允许 `license_status === "approved"` 的素材进入 `render-props.json`；
   - MVP/测试验证阶段允许明确标记为 `license_status === "internal_placeholder"` 的内部合成占位素材进入预览渲染；
   - 凡 `license_status` 为 `pending`、`pending_verification`、`rejected` 或 `unknown` 的素材，一律拦截在 `render-props.json` 之外。
3. **同一素材 60 秒防重复冷却**：同一 `asset_id` 不得在 60.0 秒（`60000 ms`）内重复使用，除非其裁切区域 (`crop_mode`) 与论证用途 (`usage_purpose`) 截然不同。
4. **强制人工审核 (`human_review_required = true`)**：所有历史、地理、具体人物、公共财政账本核对、社会敏感场景、低置信度素材、缺素材镜头及正式结尾镜头，必须设置 `human_review_required: true`。

### Step 5：通用编译 `render-props.json` 与执行自动化 QC（调用 [`prompts/05_video_qc.md`](./prompts/05_video_qc.md)）
通过通用脚本读取 `projects/<project_id>/` 下的文件，导出 `render-props.json` 与 `video-qc-report.json`，自动验证时长对齐、零重叠/零空隙、素材存在性、授权合规、字幕安全边距及待人工审核项。

---

## 3. 目录文件导航

- **通用数据结构模板 (`templates/`)**
  - [`templates/scene-manifest.json`](./templates/scene-manifest.json)：通用镜头清单 Schema (V2)
  - [`templates/asset-index.json`](./templates/asset-index.json)：通用素材索引库 Schema (V2)
  - [`templates/render-props.json`](./templates/render-props.json)：通用 Remotion 渲染属性 Schema (V2)
- **分阶段执行提示词 (`prompts/`)**
  - [`prompts/01_segment_script.md`](./prompts/01_segment_script.md)：真实时间戳 4–10 秒镜头切分
  - [`prompts/02_plan_scenes.md`](./prompts/02_plan_scenes.md)：跨领域画面意图策划、6类视觉选型与 `procedural_props` 生成
  - [`prompts/03_generate_asset_queries.md`](./prompts/03_generate_asset_queries.md)：中英文搜索词、正负向约束与降级方案
  - [`prompts/04_match_assets.md`](./prompts/04_match_assets.md)：合法素材匹配、60秒防重与人工审核标记
  - [`prompts/05_video_qc.md`](./prompts/05_video_qc.md)：Remotion 渲染属性导出与 6 维工程/视觉质检
- **通用参考规范 (`references/`)**
  - [`references/visual-style-guide.md`](./references/visual-style-guide.md)：多领域知识型视频视觉风格、安全边距与结尾规范
  - [`references/asset-licensing-rules.md`](./references/asset-licensing-rules.md)：版权白名单、`internal_placeholder` 规则与 60 秒防重规范
  - [`references/scene-type-rules.md`](./references/scene-type-rules.md)：6 种标准视觉类型及 `procedural_props` 参数规范
  - [`references/human-review-rules.md`](./references/human-review-rules.md)：跨领域强制人工审核触发条件与状态流转
