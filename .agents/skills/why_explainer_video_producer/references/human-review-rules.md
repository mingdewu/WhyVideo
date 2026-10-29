# 跨领域人工审核门禁与触发规则 V2 (Human Review Rules)

为防止 AI 在不同领域的“为什么”知识型视频生产中出现“时代穿帮、地域张冠李戴、人物肖像错配、地图边界错误、公共财政口径失真或版权瑕疵”，`why_explainer_video_producer` 实行严格的**主题无关强制人工审核门禁（Mandatory Human Review Gate）**。

---

## 1. 强制触发 `human_review_required = true` 的七大通用场景

凡是镜头内容、旁白语境或视觉素材涉及以下**任意一类**，无论属于哪个领域分类（旅行文化、历史地理、饮食文化、社会议题、公共财政与大型赛事），都**必须**将该镜头的 `human_review_required` 设为 `true`，并将 `review_status` 初始化为 `"pending_human_review"`：

### 1.1 历史与文献场景 (Historical & Archival Scenes)
- 涉及具体历史时期、朝代、年份或历史制度演变；
- 使用历史老照片、历史版画、古籍书影、历史专利图纸、考古文物照片；
- **人工审核重点**：核对图片反映的真实年代与地域是否与旁白一致，防止跨朝代、跨国别穿帮。

### 1.2 地理、疆域与地图场景 (Geographic & Map Scenes)
- 所有 `visual_type === "map"` 或 fallback 为 `map` 的镜头；
- 涉及国家疆域、地区边界、行政区划、争议领土、历史地名变迁、交通走廊或特定城市地标实拍；
- **人工审核重点**：核对地图底图规范性、国界线标准、历史地名与现代地名的对应关系。

### 1.3 具体人物与机构场景 (Named Individuals & Institutions)
- 旁白或画面中出现具体历史人物、学者、决策者、运动员或公众人物的姓名与肖像；
- **人工审核重点**：核对人物肖像是否为本人，核对肖像权与公有领域状态。

### 1.4 公共财政、统计数据与大型赛事账本 (Public Finance, Statistics & Mega-Events)
- 涉及政府预算公报、税收分配、基建债务、大型赛事（奥运会、世界杯、世博会等）场馆建设成本与赛后运营亏损数据；
- **人工审核重点**：核对图表货币单位、名义值与通胀调整后实际值口径、统计年份范围是否与定稿旁白一致。

### 1.5 社会议题与敏感场景 (Social Issues & Sensitive Topics)
- 涉及医疗卫生、食品安全、人口老龄化、灾害事故、宗教民俗、民族文化或司法案件；
- **人工审核重点**：确保画面克制、客观、尊重，无猎奇煽情、无刻板印象或群体冒犯。

### 1.6 缺素材、低置信度或版权待确认镜头 (Missing, Low-Confidence, or Unapproved Assets)
- 所有 `status === "NEEDS_HUMAN_ASSET"`（缺高置信度素材）的镜头；
- 所有 `confidence_score < 0.70`（`status === "LOW_CONFIDENCE_NEEDS_REVIEW"`）的低置信度匹配镜头；
- 候选素材列表中存在 `license_status` 非 `approved` 的镜头；
- **重要原则**：**系统严禁自动掩盖或擅自改写语义争议**，必须将低置信度和缺素材项原样保留在 `video-qc-report.json` 中交由人工拍板。

### 1.7 全片正式结尾镜头 (Final Ending Scene)
- 所有 `is_final_ending === true` 的镜头；
- **人工审核重点**：确认结尾画面切实回扣全片核心问题，未混入无关煽情通用素材。
