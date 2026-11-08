# WhyVideo Studio (知识型长视频全流程自动化生产工坊)

WhyVideo 是一个基于 **Antigravity Agent Skills** 与 **Remotion** 构建的主题无关（Topic-Agnostic）中文“为什么”知识型长视频生产工作流。它将长视频文案研究、视觉镜头策划、素材授权审核、音画对齐与云端工程管理彻底打通。

---

## 🚀 核心架构与 Agent Skills

项目将通用流水线能力与具体视频项目数据彻底分离：

```text
WhyVideo/
├── .agents/skills/
│   ├── why_explainer_video_writer/      # 阶段一至二：资料提取、证据卡、大纲与旁白撰写 Skill
│   └── why_explainer_video_producer/    # 阶段三至五：镜头切分、画面意图、素材匹配与 QC 质检 Skill
│
├── packages/
│   ├── video-template/                  # 通用 Remotion 渲染组件与视觉 Schema (已配置为空模板隔离)
│   └── qc-tools/                        # 自动化质检工具、工程状态看板与 Airtable 同步 CLI
│       ├── project-status.mjs           # 本地五阶段进度看板 CLI (npm run status)
│       ├── sync-airtable.mjs            # Airtable 云端数据双向同步 (npm run airtable:sync)
│       ├── generate-render-props.mjs    # 渲染参数编译器
│       ├── scan-assets.mjs              # 本地资产存在性与分辨率扫描
│       └── run-qc.mjs                   # 6 维自动化质量检测
│
└── projects/
    └── why_ryokan_small_dishes_001/     # 项目实战案例（日本温泉旅馆小碟子晚餐之谜）
        ├── data/                        # brief / scene-manifest / render-props / qc-report
        └── public/                      # narration.wav / captions.srt / assets
```

---

## 🛠️ 常用开发与工程管理命令

### 1. 本地工程进度与验收看板
无论隔多久重新打开项目，随时运行以下命令，即可一秒看清项目进度、8 大产物就绪情况及下一步行动：
```bash
npm run status
```

### 2. 同步项目状态到 Airtable
自动将本地的项目阶段、验收百分比及全部 8 个镜头的旁白、起止时间轴、视觉类型和审核状态推送到 Airtable 云端看板：
```bash
npm run airtable:sync
```

### 3. 运行视频自动化质检 (QC)
检查音画时长对齐、60 秒防重冷却、素材授权合规、字幕安全边距与人工审核门禁：
```bash
npm run qc
```

### 4. 重新编译渲染参数
根据最新的 `scene-manifest.json` 与资产库编译 Remotion 所需的 `render-props.json`：
```bash
npm run compile:props
```

### 5. 渲染 720p 预览视频
```bash
npm run render:preview
```

---

## 🔐 环境变量配置 (`.env`)

若要使用 Airtable 云端同步功能，请在项目根目录下创建 `.env` 文件（已被 `.gitignore` 保护，不会泄露至 GitHub）：

```env
AIRTABLE_API_KEY=your_personal_access_token_here
AIRTABLE_BASE_ID=your_base_id_here
```

---

## 🎨 视觉工作台与自动化质检服务

### 1. 启动全功能视觉排版与 QC 质检工作台 (Port 4000)
集分镜排版调优、素材拖拽即时检验、自然语言 AI 智能剪辑于一体的交互式工作台：
```bash
node packages/qc-tools/ui-server.mjs
# 访问: http://localhost:4000
```

### 2. 启动长视频台本策划与工作流工作室 (Port 3200)
```bash
node packages/workflow-studio/server.mjs
# 访问: http://localhost:3200
```

---

## 🌟 最新更新日志 (今日工作内容)

### 🎬 自然语言 AI 剪辑导演与 Remotion 动效引擎全面打通
针对长视频镜头中用户自主上传的实拍视频与图片素材，构建了**广义、无固定模板束缚**的自然语言智能剪辑工作流：

1. **常驻永久输入框 (第 6 列素材检验区)**：
   - 彻底打破条件限制，无论未拖入素材、拖入静态图片还是动态视频，AI 指令输入框均**永久常驻**，随时接收针对镜头的任意口语要求，支持回车一键编译。
2. **“先说人话，再调视频”的双重执行机制**：
   - **Step 1（AI 剪辑总监人话反馈）**：大模型以专业视听剪辑师口吻阐释视听意图与剪辑理由（如色调营造、节奏把控、大字出现时机），并在卡片正上方以专属气泡展示 (`ai_speech_reply`)。
   - **Step 2（Remotion 代码参数编译）**：大模型将自然语言深度解析并直接编译为底层结构化 Remotion 渲染参数 (`media_modifiers`)，实时同步至 `scene-manifest.json` 与 `render-props.json`。
3. **Remotion 视听修饰与动效系统扩充**：
   - **全面滤镜系统**：在 `BrollScene` 与 `PhotoMotionScene` 中支持亮度、对比度、饱和度、色相旋转 (`hue-rotate`)、反色 (`invert`)、复古胶片 (`sepia`) 与黑白冷调 (`grayscale`)。
   - **运镜动力学**：支持慢速推拉镜 (`zoom_in` / `zoom_out`)、平移插值 (`translateX` / `translateY`) 及画面震撼微抖动 (`shake`)。
   - **变速播放**：视频素材直接支持基于 `playbackRate` 的任意慢动作与快进。
   - **新增动态艺术字层 (`TextOverlayLayer.tsx`)**：支持弹跳入场 (`pop_bounce`)、震颤冲击 (`shock_shake`)、左侧滑入 (`slide_from_left`)，完美呈现关键转折、数字大字与警示标签。
4. **视觉排版纯化与大模型智能调优**：
   - 彻底移除了第 5 列固化、死板的规则标签与硬编码预设，换为纯净的 **大模型 API 视觉排版自适应调优**，无缝支持 Google Gemini API 与本地 Antigravity 运行网关。

---

## 📦 项目实战案例：`why_ryokan_small_dishes_001`
* **视频题目**：《为什么日本温泉旅馆的晚餐常常是一小碟一小碟？》
* **制作时长**：64.0 秒预览版（8 个镜头单元，含黑幕动态文字与数据卡片降级处理）
* **当前进度**：85%（720p 预览片已完整生成并打通音画同步）
