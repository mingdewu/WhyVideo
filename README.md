# why-video-studio (Version 2 Monorepo Structure)

本仓库采用**多项目工作区架构**，将通用 Agent Skills、通用 Remotion 视频模板组件、通用扫描/QC 工具与具体单期视频项目（`projects/<project_id>/`）彻底分离。

---

## 1. 标准目录结构

```text
why-video-studio/
├── .agents/
│   └── skills/
│       ├── why_explainer_video_writer/
│       └── why_explainer_video_producer/
│
├── packages/
│   ├── video-template/              # 通用 Remotion 组件与 Schema
│   │   ├── src/
│   │   │   ├── scenes/
│   │   │   │   ├── BrollScene.tsx
│   │   │   │   ├── PhotoMotionScene.tsx
│   │   │   │   ├── KineticTextScene.tsx
│   │   │   │   ├── DataCardScene.tsx
│   │   │   │   ├── TimelineScene.tsx
│   │   │   │   └── MissingAssetScene.tsx
│   │   │   ├── CaptionLayer.tsx
│   │   │   ├── ReviewHud.tsx
│   │   │   ├── WhyExplainerComposition.tsx
│   │   │   ├── Root.tsx
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   └── schemas/
│   │       ├── scene-manifest.schema.json
│   │       ├── asset-index.schema.json
│   │       └── render-props.schema.json
│   │
│   └── qc-tools/                    # 通用扫描与QC脚本
│       ├── scan-assets.mjs
│       ├── generate-render-props.mjs
│       └── run-qc.mjs
│
└── projects/
    └── why_ryokan_small_dishes_001/ # 本次验收测试项目 (Fixture)
        ├── data/                    # scene-manifest.json / asset-index.json / render-props.json
        ├── public/                  # audio/narration.wav, captions/captions.srt, assets/
        ├── output/                  # preview.mp4, video-qc-report.json
        └── human-review-log.json    # 人工审核状态与问题追踪日志
```

---

## 2. 常用命令

所有通用工具均支持通过 `--project <project_id>` 或环境变量 `PROJECT_ID=<project_id>` 切换任意项目（默认自动定位 `projects/` 下第一个项目）：

### 2.1 编译 `render-props.json`
```bash
npm run compile:props -- --project why_ryokan_small_dishes_001
```

### 2.2 扫描项目素材元数据
```bash
npm run scan:assets -- --project why_ryokan_small_dishes_001
```

### 2.3 运行自动化 QC 检查
```bash
npm run qc -- --project why_ryokan_small_dishes_001
```
质检报告输出至 `projects/<project_id>/output/video-qc-report.json`。

### 2.4 启动 Remotion Studio 预览
```bash
PROJECT_ID=why_ryokan_small_dishes_001 npm run studio
```

### 2.5 渲染低分辨率预览视频
```bash
PROJECT_ID=why_ryokan_small_dishes_001 npx remotion render packages/video-template/src/index.ts WhyExplainerMVP projects/why_ryokan_small_dishes_001/output/preview.mp4 --scale=0.5
```
