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

## 📦 项目实战案例：`why_ryokan_small_dishes_001`
* **视频题目**：《为什么日本温泉旅馆的晚餐常常是一小碟一小碟？》
* **制作时长**：64.0 秒预览版（8 个镜头单元，含黑幕动态文字与数据卡片降级处理）
* **当前进度**：85%（720p 预览片已完整生成并打通音画同步）
