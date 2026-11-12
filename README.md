# WhyVideo Studio (知识型长视频全流程自动化生产工坊 · v2.0.0)

WhyVideo 是一个基于 **Antigravity Agent Skills**、**Web 交互式创作与分镜工作台** 与 **Remotion** 构建的主题无关（Topic-Agnostic）中文“为什么”知识型长视频生产工作流，将长视频文案研究与核验、提示词定制、去 AI 味润色、视觉镜头策划、素材授权审核、音画对齐与云端工程管理打通为一体。

---

## 🚀 核心架构与 Agent Skills

项目将通用流水线能力与具体视频项目数据彻底分离（`projects/<project_id>/`）：

```text
WhyVideo/
├── .agents/skills/
│   ├── why_explainer_video_writer/      # 文案创作 Skill：资料提取、证据卡、5~7 章大纲与四段式撰写
│   └── why_explainer_video_producer/    # 视觉制作 Skill：镜头切分、画面意图、素材匹配与 QC 质检
│
├── packages/
│   ├── video-template/                  # 通用 Remotion 渲染模板、视觉 Schema 与场景组件库
│   │   ├── schemas/                     # asset-index / scene-manifest / render-props JSON Schema
│   │   └── src/scenes/                  # BrollScene / PhotoMotionScene / TextOverlayLayer 等 9 类场景层
│   │
│   ├── qc-tools/                        # 一体化创作/分镜 Web 工作台与 CLI 工具集
│   │   ├── ui-server.mjs                # 双标签一体化 Web 工作台 (Port 4000, npm run ui)
│   │   ├── writer-prompts.mjs           # 文案 7 阶段提示词注册表、风格预设与工程级校验引擎
│   │   ├── project-status.mjs           # 本地五阶段进度看板 CLI (npm run status)
│   │   ├── sync-airtable.mjs            # Airtable 云端数据双向同步 (npm run airtable:sync)
│   │   ├── generate-render-props.mjs    # 渲染参数编译器 (npm run compile:props)
│   │   ├── scan-assets.mjs              # 本地资产存在性与分辨率扫描 (npm run scan:assets)
│   │   ├── run-qc.mjs                   # 多维自动化质量检测 (npm run qc)
│   │   ├── import-project-ymyp.mjs      # 文案/分镜工程导入脚本
│   │   ├── dev-bridge.mjs               # 开发辅助桥接工具
│   │   ├── synthesize-elevenlabs.mjs    # ElevenLabs 语音合成脚本
│   │   └── synthesize-voicebox.mjs      # Voicebox 语音合成脚本
│   │
│   └── workflow-studio/                 # 独立长视频台本策划工作室 (Port 3200)
│       ├── server.mjs
│       └── index.html
│
└── projects/                            # 独立隔离的视频工程目录（数据 / 素材 / 成品输出）
    ├── why_ryokan_small_dishes_001/     # 实战案例：日本温泉旅馆小碟子晚餐之谜
    ├── why_ai_renamed_to_si_001/        # 扩展案例工程
    └── why_preview/                     # 预览工程
        ├── data/                        # brief / outline / final-script / scene-manifest / writer-prompts 等
        ├── public/                      # narration.wav / captions.srt / assets
        └── output/                      # preview.mp4 / final_video_1080p.mp4
```

---

## 🎨 一体化 Web 工作台

### 1. 文案创作 + 视觉分镜双模式工作台（Port 4000，推荐主入口）
启动后支持在顶栏无缝切换 **「✍️ 文案创作工坊」**（`?tab=writer`）与 **「🎬 视觉分镜台」**（`?tab=producer`），所有改动实时落盘到 `projects/<projectId>/data/`：

```bash
npm run ui
# 等价于: node packages/qc-tools/ui-server.mjs
# 访问: http://localhost:4000
```

- **文案创作工坊 (`?tab=writer`)**：覆盖立项与资料调研 / `exports/` 一键切镜导入 → 原子化证据卡提取核验 → 5~7 章大纲审核门禁 → 四段式逐章撰写 → 全文统稿、De-AI 真人化修复与一键同步制作台。
- **视觉分镜台 (`?tab=producer`)**：集分镜排版调优、本地素材拖拽即时检验、自然语言 AI 剪辑导演与模型指令调度于一体。

### 2. 长视频台本策划与工作流工作室（Port 3200）
```bash
node packages/workflow-studio/server.mjs
# 访问: http://localhost:3200
```

---

## 🛠️ 常用 CLI 与 Remotion 渲染命令

以下命令定义于 [package.json](package.json)：

```bash
npm run ui              # 启动 Port 4000 一体化创作与分镜工作台
npm run status          # 查看本地工程五阶段进度与产物就绪看板
npm run scan:assets     # 扫描项目本地资产存在性与分辨率
npm run qc              # 运行自动化质量检测 (QC)
npm run compile:props   # 根据 scene-manifest 与资产库编译 render-props.json
npm run airtable:sync   # 将项目阶段与分镜数据双向同步到 Airtable
npm run studio          # 打开 Remotion Studio 实时调试模板 (同 npm run preview)
npm run render:preview  # 渲染 720p 预览视频 (output/preview.mp4)
npm run render:final    # 渲染 1080p 成片视频 (output/final_video_1080p.mp4)
```

---

## 🔐 环境变量配置 (`.env`)

可在项目根目录下创建 `.env` 文件（已被 `.gitignore` 保护，不会提交至 GitHub）：

```env
# 大模型 API（文案创作 / AI 剪辑导演 / 视觉调优，支持页面设置或环境变量注入）
OPENROUTER_API_KEY=your_openrouter_api_key
GEMINI_API_KEY=your_gemini_api_key

# 语音合成（可选）
ELEVENLABS_API_KEY=your_elevenlabs_api_key

# Airtable 云端同步（可选）
AIRTABLE_API_KEY=your_personal_access_token_here
AIRTABLE_BASE_ID=your_base_id_here

# 工作台服务端口（默认 4000）
PORT=4000
```

> 本地未配置在线大模型 Key 时，文案创作台内置 `mockStage` 免 Key Mock 链路，可用于调试全流程界面与本地持久化交互。

---

## 🌟 更新日志

### ✍️ 文案创作工坊全量提示词定制、去 AI 味 Diff 审阅与单屏紧凑布局（最新）
1. **工程级全量提示词定制与注册表（[writer-prompts.mjs](packages/qc-tools/writer-prompts.mjs)）**：
   - 将文案创作台 7 个 AI 阶段（`W1_research` 事实考证 → `W7_humanize` 去 AI 味润色）与 4 套风格预设（`WRITER_STYLE_PRESETS`）抽离至集中注册表，内置允许变量白名单与 JSON/审计契约校验（`validateWriterPromptTemplate`）。
   - 支持通过顶栏 **「⚙️ 提示词设置」** 弹窗（`#writerPromptsModal`）全量编辑各阶段系统提示词、点击插入变量芯片与一键追加风格预设；改动仅保存至当前工程的 `data/writer-prompts.json`，新建或未修改工程自动沿用出厂默认基线。
2. **全篇去 AI 味修复器 GitHub 风格 Diff 审阅工作流**：
   - 阶段 5 修复完成后先进入带审计统计的对比区（`#wHumanizeAuditBox`），支持 **红绿混合 (Unified) / 左右并排 (Split)** 视图与 **仅看改动** 过滤，需人工点击「✅ 确认采纳并保存」后才正式写入工程文件，同时支持「↩️ 放弃并还原原稿」与版本徽章追踪（`humanize_meta`）。
3. **工程管理与顶部同排存盘体验优化**：
   - 新增「✨ 新建空白工程」与「🔄 清零重做文案」接口（`/api/writer/create-blank-project`、`/api/writer/reset-project`）及左侧工程实况概览卡（`#wInspectorCard`）。
   - 将阶段 1–5 的手动保存按钮全部上移至各阶段顶部标题操作栏（与对应 AI 按钮同排，修复卡片旁增设「💾 先存原稿」），并新增实时「已同步本地 / 未保存」状态徽章（`#writerPersistenceStatusBadge`）。
4. **桌面端单屏紧凑布局（`>=1024px`）**：
   - 新增仅在文案创作台激活的 `body.writer-compact-mode`（`100vh` 视口锁定，不影响视觉分镜台滚动）；左栏与阶段 1–3 列表改为内部弹性滚动，阶段 4 四段式改为 **2×2 网格**并排，阶段 5 统稿日志可折叠、定稿文本框自适应拉伸，消除外层页面大段上下滚动。

### 🎬 自然语言 AI 剪辑导演与 Remotion 动效引擎（`2599b86`）
1. **常驻永久指令输入框 (第 6 列素材检验区)**：无论静态图片、动态视频或未配图状态均常驻接收口语剪辑指令。
2. **“先说人话，再调视频”双重执行机制**：大模型先以专业剪辑师口吻解释意图（`ai_speech_reply`），再编译结构化 Remotion 参数（`media_modifiers`）并同步至 `scene-manifest.json` 与 `render-props.json`。
3. **Remotion 视听修饰与动效扩充**：支持 `BrollScene` / `PhotoMotionScene` 滤镜组合、运镜动力学（`zoom_in` / `zoom_out` / `translateX` / `translateY` / `shake`）、`playbackRate` 变速播放及 `TextOverlayLayer.tsx` 动态艺术字层。
4. **视觉排版纯化与大模型智能调优**：移除固化规则标签与硬编码预设，接入 Google Gemini API 与本地网关自适应调优。

---

## 📦 实战案例工程
- `projects/why_ryokan_small_dishes_001`：《为什么日本温泉旅馆的晚餐常常是一小碟一小碟？》（64.0 秒预览版，8 个镜头单元，包含 `data/` 全套结构化清单、`public/` 音视频资产与 `output/` 预览输出）。
- `projects/why_ai_renamed_to_si_001`、`projects/why_preview`：多选题拓展与预览工程目录。
