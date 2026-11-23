import fs from 'fs';
import path from 'path';

export const PRODUCER_STYLE_PRESETS = [
  {
    id: 'documentary_realistic',
    label: '🎬 纪录片写实考证风 (出厂默认)',
    snippet: '【视觉预设 · 纪录片写实考证风】：强调真实历史遗存、具象人物动作、自然光影与空气透视，严禁泛泛的空镜或过度卡通化渲染。',
  },
  {
    id: 'cinematic_epic',
    label: '🎥 电影级大片质感',
    snippet: '【视觉预设 · 电影级大片质感】：采用变形宽银幕构图、强明暗对比、浅景深焦外虚化与缓慢推进运镜，突出史诗感与情绪张力。',
  },
  {
    id: 'minimal_infographic',
    label: '📊 现代极简信息图风',
    snippet: '【视觉预设 · 现代极简信息图风】：深色磨砂玻璃质感、高对比度数据与核心大字排版，线条利落克制，适合知识类深度拆解。',
  },
  {
    id: 'fast_paced_web',
    label: '⚡ 快节奏网感搜素材',
    snippet: '【视觉预设 · 快节奏网感搜素材】：优先提炼当下视频平台（B站、抖音、YouTube）高命中率的具象热词、名场面与高反差画面实体。',
  },
];

export const PRODUCER_PROMPT_REGISTRY = {
  P7_art_director: {
    template_id: 'P7_art_director', template_version: '1.0.0',
    label: '7. AI 重点艺术字', full_label: 'P7 · 全文重点艺术字与动态设计',
    description: '用于 AI 重点艺术字生成；AI 依据全文与用户要求独立设计文字、排版、颜色和动态关键帧。保存后下次生成生效。',
    allowed_inputs: [], require_json: true,
    raw_template: `你是中文解说视频的动态文字设计师。通读完整分镜旁白，挑选少量真正值得强调的主题、转折、数据与结论，而不是重复每一句字幕。每条写简短文字并逐字引用所属镜头中的连续原文作为 anchor，不能添加原文没有的事实。遵循用户额外的创意要求。根据每条内容的情绪，自主设计不同的文字排版、颜色、位置及入场、停留、离场动作；用关键帧组合设计动画，避免整片机械套用同一效果。考虑主体和下方字幕，避免遮挡，文字清晰可读。时间随镜头旁白自然出现。严格按以下要求返回 JSON。\n输出 JSON 对象：{"items":[{"scene_id":"镜头ID","text":"短文字","anchor":"本镜头旁白中的连续原文","reason":"创意说明","duration_sec":3,"design":{"x":50,"y":40,"font_size":70,"font_weight":900,"text_color":"#ffffff","background_color":"#111827","background_opacity":0.8,"border_color":"#ffffff","border_width":2,"radius":12,"padding_x":28,"padding_y":12,"letter_spacing":2,"glow":12,"keyframes":[{"at":0,"x":-180,"y":0,"scale":0.7,"rotation":-8,"opacity":0},{"at":0.2,"x":0,"y":0,"scale":1,"rotation":0,"opacity":1},{"at":0.8,"x":0,"y":0,"scale":1,"rotation":0,"opacity":1},{"at":1,"x":80,"y":-50,"scale":0.9,"rotation":5,"opacity":0}]}}]}。design.x/y 为画面百分比；keyframes 的 at 是0到1的时间比例，x/y 是相对位置像素偏移，scale 为缩放，rotation 为角度，opacity 为透明度。必须至少提供两帧且包含 at=0 和 at=1、按时间递增。颜色必须是 #RRGGBB。每条时长为镜头内 0.5 至 6 秒，不要每个镜头都做，不要输出代码。`,
  },
  P6_bgm_director: {
    template_id: 'P6_bgm_director', template_version: '1.0.0',
    label: '6. AI 自动配乐', full_label: 'P6 · AI 纪录片配乐总监',
    description: '根据旁白时间轴和 AI 对音乐音频的分析，自动选择曲目顺序与情绪电平；保存后在下次自动配乐时生效。',
    allowed_inputs: [], require_json: true,
    raw_template: `你是一位有经验的中文知识纪录片音乐总监。你收到视频标题、逐镜旁白与时间轴，以及对每首真实音乐片段的音频分析。你的工作是直接做出完整配乐决定，不能把选曲工作交给用户。

先理解全文叙事：问题、解释、转折与结尾的关系。按实际台词的情绪与信息密度，规划连续的情绪和电平段落。再依据每首音乐的实际情绪、能量、节奏和旁白干扰风险安排曲目顺序；优先保持叙事连贯和人声清晰，而不是为了频繁切歌制造变化。不要把 BPM、文件名或推测当作听到的事实。避免连续重复；确实需要重复时可隔曲复用。曲目会从头播放至结束或影片结束，并在相邻曲目之间交叉淡化；请据此考虑每首时长和全片需要。曲库无法完全匹配时选择最接近的，不要编造不存在的音乐。

输出必须是合法 JSON，不要代码块。格式：{"summary":"简短说明配乐思路及不确定性","track_order":["输入曲库的track_id", "下一首track_id"],"segments":[{"label":"段落名","start_ms":0,"end_ms":10000,"mood":"实际叙事情绪","energy":"low|medium|high","target_db":-18,"music_style_hint":"与此段内容相符的音乐方向","reason":"结合具体旁白说明"}]}。track_order 按播放顺序填写有效 track_id，可以重复但不能相邻重复；系统在曲库顺序用尽后会继续循环。情绪段落应按时间排序、无间隙覆盖全片，target_db 在 -24 到 -14 之间。只根据提供的信息判断，不要声称听过完整成片。`,
  },
  P1_keywords: {
    template_id: 'P1_keywords',
    template_version: '2.0.0',
    label: '1. 最佳搜索词',
    full_label: 'P1 · Step 0 唯一最佳搜索词提炼',
    description: '用于第 6 列「Step 0 · 最佳搜索词」与顶部「批量提炼全部镜头关键词」。直接给出 1 个最贴合旁白画面的纯中文搜索词（JSON 格式）。',
    allowed_inputs: ['project_title', 'chapter_ref'],
    require_json: true,
    raw_template: `你是一位资深纪录片剪辑导演与素材检索专家。
任务：阅读【旁白文本】与【视频主题背景】，先替剪辑师做出唯一最优的画面导演判断（决定这个镜头最该配什么具体画面），然后只输出 **1 个** 最适合直接去 B站、抖音、YouTube 或图库搜索实拍/实机素材的**纯中文**最佳搜索词。

严格要求：
1. 只输出 **1 个** 最标准、最贴合旁白画面的答案，严禁给出多个选项让剪辑师纠结。
2. 必须全部使用**纯中文**（严禁英文单词或拼音，必要时使用中文通用译名），长度控制在 4~14 个汉字。
3. 必须高度具象、可直接搜出对应画面：优先写具体的作品名、历史事件名、真实场景、人物动作或物品，并视情况搭配高命中率素材词（如“实机画面”“纪录片”“新闻画面”“混剪”“特写”“航拍”），严禁抽象空洞词（如“社会现象”“虚拟杀戮”“深层思考”）。
4. 严禁输出任何解释或多余文字，必须且仅返回合法 JSON 对象：{"keyword": "唯一最佳中文搜索词"}。`,
  },

  P2_video_prompt: {
    template_id: 'P2_video_prompt',
    template_version: '1.0.0',
    label: '2. 实体视频词',
    full_label: 'P2 · 第 5 列实体视频画面词提炼',
    description: '用于第 5 列「🎬 实体视频」模式点击「✨ 自动提炼视频词」时的 System Prompt。',
    allowed_inputs: ['project_title', 'project_summary'],
    require_json: false,
    raw_template: `你是一位享誉全球的顶级历史文化、地理发现与科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】、【关键词】与【项目全局背景】，为该镜头提炼出与解说词语义高度咬合、具象写实、视听冲击力极强的画面指示词（Prompt）。

【项目全局背景】：
纪录片主题：《{{project_title}}》
{{project_summary}}

【实体视频提炼要求】：
必须输出为如下结构：
【镜头叙事核心】必须紧扣台词中的历史人物动作、政权军事遗存、宗教法器或地理工程实体，严禁空洞死景；
【运镜轨迹】电影摄影运镜（如：45度低角度向前推进聚焦主体、悬崖俯瞰慢速环绕拉远、浅景深焦点从前景转移至后景）；
【具象细节与动态】人物袍服随风扬起、香火薄雾流淌、微雨浸润石壁等真实物理动态；
【光影与时代质感】符合该历史时期电影级光影质感与空气透视，真实自然光。

请直接输出提炼后的最终提示词文本，字数控制在 160~240 字之间，严禁包含任何前缀客套、说明或额外 markdown 代码块：`,
  },

  P3_image_prompt: {
    template_id: 'P3_image_prompt',
    template_version: '1.0.0',
    label: '3. 超清实景图',
    full_label: 'P3 · 第 5 列超清实景图提示词提炼',
    description: '用于第 5 列「🖼️ 超写实图」模式点击「✨ 自动提炼实景词」时的 System Prompt。',
    allowed_inputs: ['project_title', 'project_summary'],
    require_json: false,
    raw_template: `你是一位享誉全球的顶级历史文化、地理发现与科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】、【关键词】与【项目全局背景】，为该镜头提炼出与解说词语义高度咬合、具象写实、视听冲击力极强的画面指示词（Prompt）。

【项目全局背景】：
纪录片主题：《{{project_title}}》
{{project_summary}}

【超写实实景图提炼要求】：
必须输出为如下结构：
【画面叙事核心】必须紧扣台词中的核心时代实体与历史隐喻，绝对严禁脱离文案仅拍摄无意义的自然死风景；
【构图与空间透视】大师级电影摄影构图与视觉纵深（如：对角线构图、前景与远景层次分明）；
【具象细节与材质】特定历史实体的真实微观质感与细节刻画；
【光影与时代氛围】符合题材氛围的自然光影、历史色调与胶片景深，无任何杂乱文字。

请直接输出提炼后的最终提示词文本，字数控制在 160~240 字之间，严禁包含任何前缀客套、说明或额外 markdown 代码块：`,
  },

  P4_card_prompt: {
    template_id: 'P4_card_prompt',
    template_version: '1.0.0',
    label: '4. 动效卡片',
    full_label: 'P4 · 第 5 列动效卡片排版词提炼',
    description: '用于第 5 列「📊 动效卡片」模式点击「✨ 自动提炼排版词」时的 System Prompt。',
    allowed_inputs: ['project_title', 'project_summary'],
    require_json: false,
    raw_template: `你是一位享誉全球的顶级历史文化、地理发现与科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】、【关键词】与【项目全局背景】，为该镜头提炼出与解说词语义高度咬合、视觉冲击力极强的 16:9 动态信息图卡片排版指示词。

【项目全局背景】：
纪录片主题：《{{project_title}}》
{{project_summary}}

【大模型视觉排版调优要求】：
请根据台词的核心认知冲突与论据类型（数据对比、史料考据、时空演变、观点重音等），由大模型自主推导最佳排版指示词：
【核心大字】从台词提炼极具视觉冲击力与认知反差的醒目标题（4~10字）；
【副级阐述】14~28 字直击要害的解说精要；
【排版与视觉重点】结构化核心论据或工艺细节，由大模型自适应规划版式构图与信息层级；
【版式视觉】16:9 现代暗色顶级信息图卡片风格，微光磨砂玻璃容器，冷蓝与渐变紫/金珀氛围辉光，极致专业排版。

请直接输出提炼后的最终提示词文本，字数控制在 160~240 字之间，严禁包含任何前缀客套、说明或额外 markdown 代码块：`,
  },

  P5_clip_compiler: {
    template_id: 'P5_clip_compiler',
    template_version: '1.0.0',
    label: '5. 口语剪辑编译',
    full_label: 'P5 · 第 6 列 Step 1 口语剪辑指令编译',
    description: '用于第 6 列「Step 1 · 口语指令」点击「✨ 编译」时的 System Prompt。必须保留 JSON 输出结构。',
    allowed_inputs: [],
    require_json: true,
    raw_template: `你是一位精通 Remotion 视频代码、FFmpeg 局部流式下载与视听美学的专业剪辑总监。
核心任务
面对用户针对当前镜头输入的任意口语化、自然语言要求，执行两项核心任务：
1. 【用人话向用户说出你的剪辑/下载构思与操作细节】（专业、亲和的剪辑师口吻，写入 ai_speech_reply）；
2. 【输出广义的视频调节与片段截取参数】（直接写入 media_modifiers，供自动化管线与 Remotion 精准执行）。

重要规则
- 时间单位强制统一：无论用户在指令中如何表达时间（如“第1分5秒到1分15秒”、“01:05~01:15”、“65秒”），必须将其全部换算为绝对秒数（浮点数），分别写入 trim_start_sec / trim_end_sec 或字幕的 start_sec / duration_sec 中。
- Action 设定：只要涉及视频调节或区间截取，action 必须设为 "media_modifiers"！
- 极度纯净输出：必须且仅返回原生 JSON 字符串。必须以 { 开头，以 } 结尾。严禁使用 \`\`\`json 这样的 Markdown 代码块标记，严禁在 JSON 结构外输出任何解释性文本。

返回参数规范 (JSON)
{
  "ai_speech_reply": "用自然口语向用户说出你所做的具体剪辑、下载片段跳转操作或音效处理",
  "action": "media_modifiers",
  "scene_type": "data_card" | "timeline" | "versus_dual" | "kinetic_text",
  "media_modifiers": {
    "trim_start_sec": "裁剪或局部下载起始绝对秒数 (数字或 null)",
    "trim_end_sec": "裁剪或局部下载结束绝对秒数 (数字或 null)",
    "playback_rate": "视频播放倍率 (正常为 1.0)",
    "audio": { "mute_original": false, "volume_level": 1.0 },
    "filters": { "brightness": 1.0, "contrast": 1.0, "saturate": 1.0, "hue_rotate_deg": 0, "sepia": 0, "grayscale": 0, "blur_px": 0 },
    "motion": { "motion_type": "zoom_in | zoom_out | pan_left | pan_right | shake | static", "easing_curve": "linear | ease_in_out | spring_bounce", "duration_sec": 5.0, "scale_from": 1.0, "scale_to": 1.15, "translate_x_px": 0, "translate_y_px": 0 },
    "text_overlays": [{ "text": "艺术字文本", "style": "dramatic_shock | warning_badge | neon_glow | minimal_clean", "animation": "slide_from_left | pop_bounce | fade_in | shock_shake", "position": "center | center_left | top_left | bottom_center", "start_sec": 0, "duration_sec": 3.0 }]
  }
}`,
  },
};

export function getProducerPromptPresetPath(projectDir) {
  return path.join(projectDir, 'data', 'producer-prompts.json');
}

export function getBuiltinProducerPromptTemplates() {
  const out = {};
  for (const [k, v] of Object.entries(PRODUCER_PROMPT_REGISTRY)) {
    out[k] = {
      template_id: v.template_id,
      template_version: v.template_version,
      label: v.label,
      full_label: v.full_label,
      description: v.description,
      allowed_inputs: [...v.allowed_inputs],
      require_json: v.require_json,
      raw_template: v.raw_template,
    };
  }
  return out;
}

export function validateProducerPromptTemplate(templateId, rawTemplate) {
  const spec = PRODUCER_PROMPT_REGISTRY[templateId];
  if (!spec) {
    return { ok: false, error: `未知的视觉提示词阶段 ID: ${templateId}` };
  }
  if (typeof rawTemplate !== 'string' || rawTemplate.trim().length < 20) {
    return { ok: false, error: `阶段「${spec.label}」提示词不能为空且长度需不少于 20 字` };
  }
  const allowedSet = new Set(spec.allowed_inputs);
  const foundVars = Array.from(rawTemplate.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]);
  const unknownVars = foundVars.filter((v) => !allowedSet.has(v));
  if (unknownVars.length > 0) {
    return {
      ok: false,
      error: `阶段「${spec.label}」包含未登记的变量占位符：${unknownVars.map((v) => `{{${v}}}`).join('、')}`,
    };
  }
  if (spec.require_json && !/json/i.test(rawTemplate)) {
    return {
      ok: false,
      error: `阶段「${spec.label}」需解析 JSON 返回，提示词中必须保留 JSON 输出格式说明`,
    };
  }
  return { ok: true };
}

function hasAnyCustomizedTemplate(templatesMap) {
  if (!templatesMap || typeof templatesMap !== 'object') return false;
  for (const [tid, spec] of Object.entries(PRODUCER_PROMPT_REGISTRY)) {
    const item = templatesMap[tid];
    if (item && typeof item.raw_template === 'string' && item.raw_template.trim() !== spec.raw_template.trim()) {
      return true;
    }
  }
  return false;
}

export function loadProjectProducerPromptPreset(projectDir) {
  if (!projectDir) return null;
  const filePath = getProducerPromptPresetPath(projectDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

export function getProducerPromptsState(projectDir, projectId) {
  const builtins = getBuiltinProducerPromptTemplates();
  const preset = loadProjectProducerPromptPreset(projectDir);
  const hasCustom = Boolean(preset && hasAnyCustomizedTemplate(preset.templates));
  return {
    ok: true,
    project_id: projectId,
    has_custom_preset: hasCustom,
    builtins,
    style_presets: PRODUCER_STYLE_PRESETS,
    preset,
  };
}

export function saveProjectProducerPromptPreset(projectDir, projectId, payload = {}) {
  const rawTemplates = payload.templates;
  if (!rawTemplates || typeof rawTemplates !== 'object') {
    return { ok: false, error: '请求缺少 templates 对象' };
  }

  const builtins = getBuiltinProducerPromptTemplates();
  const existing = loadProjectProducerPromptPreset(projectDir);
  const templatesMap = {};

  for (const tid of Object.keys(PRODUCER_PROMPT_REGISTRY)) {
    const incoming = rawTemplates[tid];
    const rawTemplate =
      incoming && typeof incoming.raw_template === 'string'
        ? incoming.raw_template
        : existing?.templates?.[tid]?.raw_template ?? builtins[tid].raw_template;

    const check = validateProducerPromptTemplate(tid, rawTemplate);
    if (!check.ok) return check;

    templatesMap[tid] = {
      template_id: tid,
      template_version: String(incoming?.template_version || builtins[tid].template_version),
      raw_template: rawTemplate,
      description: String(incoming?.description || builtins[tid].label),
    };
  }

  const hasCustom = hasAnyCustomizedTemplate(templatesMap);
  const filePath = getProducerPromptPresetPath(projectDir);
  const dataDir = path.dirname(filePath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const nextRevision = (Number(existing?.revision) || 0) + 1;
  const preset = {
    id: `producer_preset_${projectId}`,
    project_id: projectId,
    revision: nextRevision,
    name: String(payload.name || `项目视觉分镜预设_${projectId}`),
    description: String(payload.description || '在视觉分镜台提示词设置中保存（仅对当前工程生效）'),
    updated_at: new Date().toISOString(),
    has_custom_preset: hasCustom,
    templates: templatesMap,
  };

  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf8');
  return {
    ok: true,
    has_custom_preset: hasCustom,
    preset,
  };
}

export function resetProjectProducerPromptPreset(projectDir, projectId, templateId = null) {
  const builtins = getBuiltinProducerPromptTemplates();
  const filePath = getProducerPromptPresetPath(projectDir);

  if (templateId) {
    if (!PRODUCER_PROMPT_REGISTRY[templateId]) {
      return { ok: false, error: `未知的视觉提示词阶段 ID: ${templateId}` };
    }
    const existing = loadProjectProducerPromptPreset(projectDir);
    if (!existing) {
      return { ok: true, has_custom_preset: false, preset: null };
    }
    const updatedTemplates = { ...(existing.templates || {}) };
    updatedTemplates[templateId] = {
      template_id: templateId,
      template_version: builtins[templateId].template_version,
      raw_template: builtins[templateId].raw_template,
      description: `已重置为出厂默认 ${builtins[templateId].label}`,
    };

    const hasCustom = hasAnyCustomizedTemplate(updatedTemplates);
    if (!hasCustom) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return { ok: true, has_custom_preset: false, preset: null };
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
    return { ok: true, has_custom_preset: true, preset };
  }

  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
  return { ok: true, has_custom_preset: false, preset: null };
}

export function renderProducerPrompt(projectDir, templateId, vars = {}) {
  const spec = PRODUCER_PROMPT_REGISTRY[templateId];
  if (!spec) {
    throw new Error(`Unknown producer prompt template_id: ${templateId}`);
  }
  const preset = projectDir ? loadProjectProducerPromptPreset(projectDir) : null;
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
