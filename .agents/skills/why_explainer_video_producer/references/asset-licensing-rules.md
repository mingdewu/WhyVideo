# 素材版权与合规准入规范 (Asset Licensing Rules)

本规范定义了 `why_explainer_video_producer` 在检索、匹配和导出视觉素材时必须严格遵守的版权红线与复用规则。

---

## 1. 严禁未授权视频抓取铁律 (Zero Unauthorized Video Scraping)

1. **严禁使用未经授权的 YouTube 或流媒体视频**：
   - **绝对禁止**下载、录屏、抓取、剪取或复用任何未经版权方书面授权的 YouTube 视频、Bilibili 视频、纪录片成片片段、影视剧切片或新闻电视台带有台标的广播画面。
   - 即使旁白中提到了某历史事件或海外现象，也不得用“合理使用（Fair Use）”为借口擅自将未授权网络视频列入 `asset-index.json` 或 `scene-manifest.json`。
2. **缺失实拍素材时的唯一合规路径**：
   - 如果没有合法授权的实拍视频或历史图片，**必须诚实标记 `NEEDS_HUMAN_ASSET`**，或改用 Remotion 自研生成的 `map`、`timeline`、`data_card`、`kinetic_text` 图形组件来可视化呈现事实。

---

## 2. 合法素材来源与授权协议白名单

允许收录进 `asset-index.json` 的素材来源（`source_platform`）仅限以下 7 类：
1. `Wikimedia_Commons`：维基共享资源中明确标注为公有领域（Public Domain）或允许商用的 CC 协议（CC0, CC BY, CC BY-SA）的档案图片/音视频。
2. `Public_Domain_Archive`：各国国家档案馆、国会图书馆（Library of Congress）、专利局公开图纸（USPTO / JPO / CNIPA）、博物馆开放馆藏（Open Access）。
3. `Pexels` / `Pixabay`：免版税商用图库/视频库（须记录具体 URL 与创作者）。
4. `Licensed_Stock`：团队已付费购买正式商业授权的图库素材（如 Artgrid、Storyblocks、Getty/Shutterstock 商用授权单号备案）。
5. `Original_Capture`：项目团队自行实拍的视频或照片。
6. `In_House_Graphic`：项目团队自行绘制的矢量工程图、示意图或图表。

---

## 3. 授权状态机与 `render-props.json` 准入门禁

在 `asset-index.json` 中，每个素材的 `license_status` 分为四种状态：

| `license_status` | 含义说明 | 是否可列入 `candidate_assets` | 是否可填入 `final_asset_id` | 是否可进入 `render-props.json` |
| :--- | :--- | :---: | :---: | :---: |
| **`approved`** | 已完成来源核验、协议合规且可商用 | ✅ 允许 | ✅ **唯一允许** | ✅ **唯一允许** |
| **`pending`** | 已找到候选文件，但版权状态或署名要求尚待人工核实 | ✅ 允许（须注明待审） | ❌ **严禁**（须置为 `null`） | ❌ **严禁** |
| **`rejected`** | 经核查存在版权风险、水印或禁止商用限制 | ❌ 严禁 | ❌ 严禁 | ❌ 严禁 |
| **`unknown`** | 来源链接缺失或权利人不明 | ❌ 严禁 | ❌ 严禁 | ❌ 严禁 |

---

## 4. 署名义务规范 (`attribution_required`)

- 对于采用 `CC_BY_4.0` 或 `CC_BY_SA_4.0` 协议的已获批（`approved`）素材：
  - `asset-index.json` 中必须将 `attribution_required` 设为 `true`，并填写完整的 `attribution_text`（包含原作者姓名、作品名及协议简称）；
  - 导出到 `render-props.json` 时，必须将该文本透传至 `approved_asset.attribution_overlay` 字段，由 Remotion 渲染层自动在画面角落叠加规范署名。

---

## 5. 同一素材 60 秒防重复冷却规则

1. **60 秒冷却窗口**：
   - 同一 `asset_id` 在时间轴上两次出现的时间间隔（$\Delta t = \text{start\_sec}_{\text{next}} - \text{end\_sec}_{\text{prev}}$）**必须 $\ge 60.0$ 秒**。
2. **唯一合规例外（全景与局部细节拆解）**：
   - 仅当两处镜头需要对同一份高信息密度文献（如历史地图、专利全文图纸、统计总表）进行“先整体建立、后局部放大考证”时，才允许在 60 秒内二次使用，且**必须同时满足**：
     - 两镜头的 `crop_and_usage.crop_mode` 完全不同（例如 `full_frame_overview` vs. `macro_crop_section_b`）；
     - 两镜头的 `crop_and_usage.usage_purpose` 明确区分各自阐述的视觉焦点；
     - 在 `video-qc-report.json` 中留痕备查。
