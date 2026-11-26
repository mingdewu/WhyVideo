# WhyVideo Studio (知识型长视频全流程自动化生产工坊 · v2.0.0)

WhyVideo 是一个基于 **Antigravity Agent Skills**、**Web 交互式创作与分镜工作台** 与 **Remotion** 构建的主题无关（Topic-Agnostic）中文“为什么”知识型长视频生产工作流，将长视频文案研究与核验、提示词定制、去 AI 味润色、视觉镜头策划、素材授权审核、音画对齐与云端工程管理打通为一体。

---

## 🚀 核心架构与 Agent Skills

项目将通用流水线能力与具体视频项目数据彻底分离（`projects/<project_id>/`）：

```text
WhyVideo/
├── .agents/skills/                     # 文案与制作 Agent Skills、提示词和模板
├── packages/
│   ├── qc-tools/
│   │   ├── ui-server.mjs               # 主工作台 HTTP 入口（默认 4000）
│   │   ├── project-paths.mjs           # Web / CLI / Remotion 共用工程选择和路径
│   │   ├── ui-server/
│   │   │   ├── lib/                   # 文案、素材、下载、配音、工程存储等服务
│   │   │   ├── routes/                # 文案 / 制作 / 模型 / 素材 / 配音渲染接口
│   │   │   └── public/
│   │   │       ├── index.html         # 页面外壳与脚本加载顺序
│   │   │       ├── partials/          # 制作台、文案台、模型、配音、BGM 等 HTML
│   │   │       ├── js/                # 按表格、素材、时间线、语音、文案阶段拆分
│   │   │       │   └── shared/        # 浏览器和 Node 共用的纯提示词规则
│   │   │       └── styles.css
│   │   ├── writer-prompts.mjs         # 文案提示词与审核契约
│   │   ├── producer-prompts.mjs       # 分镜提示词与风格预设
│   │   ├── cut-planner.mjs            # 智能切点与镜头节奏
│   │   ├── narration-timing.mjs        # 旁白对齐与时间轴
│   │   ├── align_whisper.py           # 完整旁白逐字对齐
│   │   ├── transcribe_voice_worker.py # 短语音剪辑指令转写
│   │   ├── bgm-manager.mjs            # 背景音乐与混音配置
│   │   ├── media-continuity.mjs       # 连用素材的续播、速度及滤镜继承
│   │   ├── generate-render-props.mjs   # 编译 Remotion 参数
│   │   ├── render-project.mjs         # 工程渲染入口
│   │   ├── scan-assets.mjs            # 素材扫描
│   │   ├── run-qc.mjs                 # 视频质量检查
│   │   ├── project-status.mjs         # 工程状态 CLI
│   │   ├── sync-airtable.mjs          # Airtable 同步
│   │   ├── synthesize-elevenlabs.mjs
│   │   └── synthesize-voicebox.mjs
│   ├── video-template/                # Remotion 组件、类型及 JSON Schema
│   │   ├── schemas/
│   │   └── src/scenes/
│   ├── workflow-studio/               # 保留的旧工作室（3200），复用工程路径及剪辑编译器
│   └── legacy-tools/                  # 归档的一次性工程导入脚本
├── tests/system-refactor.test.mjs      # 连用、共享规则、页面装配和入口回归检查
├── public/render-props.json            # 无本地工程时的预览回退参数
├── exports/                            # 本地文稿，不纳入 Git
└── projects/                           # 本地工程，不纳入 Git（保留 .gitkeep）
    ├── <project_id>/
    │   ├── data/                      # brief / outline / final-script / scene-manifest
    │   ├── public/                    # 配音、字幕、素材、render-props.json
    │   └── output/                    # 预览和成片
    └── .archive/root-drafts/           # 从根目录归档的历史文稿，不参与工程扫描
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

### 2. 多用户账号、工程权限与协同编辑

工作台支持本地账号登录。首次在运行服务的服务器本机访问 `http://localhost:4000`，按页面提示创建超级用户（密码至少 12 位）；超级用户可在「账号管理」中创建、停用普通账号、重设密码，并把未分配工程分配给账号。普通账号只会看到获分配的工程。

- 工程支持编辑权申请、交接和释放；保存请求携带工程版本号，内容已被其他会话更新时会拒绝覆盖并提示刷新核对。
- 每个工程的 Remotion 预览可按需独立启动，通过工作台代理访问，闲置后自动回收。
- 超级用户可在「共享服务设置」集中配置模型、Tavily、素材、ElevenLabs 服务 Key 和模型选项，普通账号使用共享配置。
- 账号库和共享配置保存在项目根目录的 `.whyvideo-auth/`，目录已加入 `.gitignore`，不会提交到 Git。

启动命令仍为 `npm run ui`。服务部署后请限制对工作台的网络访问，并通过服务器本机完成首次超级用户初始化。

### 3. 旧版工作流工作室（Port 3200，兼容保留）

新工程使用上面的 4000 主入口。旧工作室保留原有界面与接口，工程路径和自然语言剪辑编译器复用主工作台实现。
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

> AI 文案与在线素材生成需要配置相应 Key；离线剪辑指令和画面提示词使用本地规则降级。

---

## 本地维护与检查

```bash
node --test tests/system-refactor.test.mjs
npx tsc --noEmit
```

工程选择统一遵循显式 `--project <id>`、`PROJECT_ID` 环境变量、按名称排序的首个本地工程。Web 可以通过 `?project=<id>` 和工程选择器指定；浏览器沿用此前选择。Remotion 通过 `PROJECT_ID` 指定工程。

根目录历史文稿已归档到 `projects/.archive/root-drafts/`，本地内容保留。`exports/`、根目录 `why_*_script.md` 与 `final-script.json` 不再纳入 Git。`packages/legacy-tools/import-project-ymyp.mjs` 是写死来源与目标的旧迁移脚本，仅供历史查阅，不作为通用导入入口；请使用工作台文案导入功能。

拆分后的前端仍使用 classic script 和现有全局按钮入口；`index.html` 中 `prompt-modals.js` 最后加载并执行初始化。新增模块需在初始化前加载。`partials/` 由服务端装配，直接双击 HTML 不会装配页面。

## 🌟 更新日志

### 👥 多用户协作、工程访问控制与独立视频预览（最新）
1. **账号与工程权限**：新增首次超级用户初始化、登录会话、普通账号创建/停用/密码重设，以及工程分配和按账号过滤工程列表；工程媒体和 API 请求按读写权限检查。
2. **协同编辑保护**：新增工程编辑会话申请、授权、交接与释放机制；通过工程数据版本校验避免旧页面覆盖新保存，并在渲染、配音等耗时任务期间锁定交接。
3. **共享服务配置**：超级用户可集中管理模型服务、Tavily、素材下载及 ElevenLabs 配置；密钥保存在本机认证数据目录，不进入工程或 Git。
4. **按工程隔离的 Remotion 预览**：每个工程在可用端口启动独立 Studio 子进程，通过工作台代理打开；闲置预览自动关闭，避免不同工程争用单个预览进程。
5. **服务端拆分与请求隔离**：加入 YouTube OAuth 路由、共享服务路由、账户与编辑服务模块；请求体加入大小限制，下载进度按工程和任务区分，媒体与 BGM 路径按工程归属解析。

### 🎵 AI 自适应 BGM 工作台、Whisper 旁白逐字对齐与视觉分镜全套调优（最新）
1. **AI 自适应智能背景音乐（BGM）工作台与动态闪避（Ducking）引擎**：
   - 新增 `bgm-manager.mjs` 模块及配套 Schema / Remotion 渲染属性（`BgmTrackProp` / `render-props.schema.json`）。
   - 支持多音轨管理、分段情绪与目标音量调节（`segments`）、AI 风格推荐分析（`parseBgmAnalysisJson`）。
   - 实现毫秒级平滑过渡曲线与人声动态闪避（`ducking_db` / `attack_ms` / `release_ms` / `fade_in` / `fade_out`），在 Remotion `WhyExplainerComposition.tsx` 中实时基于音频帧精细衰减。
2. **旁白逐字时间轴与智能切点规划（Cut Planner）**：
   - 新增 `narration-timing.mjs` 与基于 Apple Silicon MLX 的 `align_whisper.py` 本地 Whisper 逐词时间戳对齐，未安装时自动平滑回退至 ffmpeg 停顿对齐。
   - 新增 `cut-planner.mjs` 智能镜头切点规划器：支持关键词提前切入画面、句中换画面、停顿与转折词捕捉、长镜头智能切分建议及节奏统计（`rhythmStats`）。
   - UI 增加一键切分镜头（`Split Shot`）、镜头合并、手动挪动切点（`moveCutTo`）与字幕独立于画面切点的精细对齐。
3. **视觉分镜台提示词模板与视觉风格预设（`producer-prompts.mjs`）**：
   - 提取分镜制作台专用的提示词注册表（`P1_keywords`、`P2_video_prompt` 等），支持当前工程独立定制、保存与重置。
   - 内置 4 套经典视觉预设（纪录片写实考证风、电影级大片质感、现代极简信息图风、快节奏网感搜素材）。
4. **配音链路与视频音轨控制增强**：
   - **Voicebox 配音**：支持任务实时取消（`AbortController` / `/api/voicebox/cancel`）与模型加载超时防护（`loading_model` 状态看门狗）。
   - **ElevenLabs 配音**：默认升级推荐模型为 `eleven_v4`，新增音色列表拉取与 `buildElevenlabsTtsPayload` 动态参数组装，支持精细稳定性与相似度调节。
   - **B-Roll 视频原生音轨**：在 `BrollScene.tsx` 中支持单独保留素材原视频音频轨（`keep_original_audio`）与音量微调（`original_audio_volume`）。

### ✍️ 文案创作工坊全量提示词定制、去 AI 味 Diff 审阅与单屏紧凑布局
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

## 阿里云百炼配音

在「配音引擎配置」选择「阿里云百炼」，使用北京地域、与自定义音色相同账号的 API Key。管理员可在弹窗中保存密钥及可选业务空间 ID，或在服务端配置 `DASHSCOPE_API_KEY` / `DASHSCOPE_WORKSPACE_ID`。密钥保存在已被 Git 忽略的 `.whyvideo-auth/shared-services.json` 中，管理员输入的百炼密钥也会按输入自动记住在当前浏览器的 localStorage 中，刷新或重新打开配置后自动恢复；浏览器缓存按访问地址分别保存。

当前内置「我的中文音色」，绑定 `qwen-audio-3.1-tts-flash`。保存提供商后，可先用「试听测试配音」生成短句，再在主界面点击「生成音频」制作全片旁白。长文本分段合成并拼接为 WAV，沿用字幕时间轴对齐流程，支持查看进度及取消。合成按百炼用量计费。

接口参考：[百炼音色复刻与合成](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)。
