import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

/**
 * 是否启用开发态 Antigravity 调试副驾驶
 * 生产发布时只需将环境变量 DEV_MODE 设为 "false" 或直接移除此文件。
 */
export const IS_DEV_MODE = process.env.DEV_MODE !== 'false';

/**
 * 读取当前工程的完整上下文（供 Agent 认知和推理）
 */
export function getProjectDevContext(projectId) {
  const projectDir = path.join(rootDir, 'projects', projectId);
  const dataDir = path.join(projectDir, 'data');

  const context = {
    projectId,
    projectDir,
    exists: fs.existsSync(projectDir),
    brief: null,
    finalScript: null,
    sceneManifest: null,
    assetIndex: null,
    scenesSummary: []
  };

  if (!context.exists) return context;

  const readJson = (file) => {
    const p = path.join(dataDir, file);
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  };

  context.brief = readJson('brief.json');
  context.finalScript = readJson('final-script.json');
  context.sceneManifest = readJson('scene-manifest.json');
  context.assetIndex = readJson('asset-index.json');

  if (context.sceneManifest && Array.isArray(context.sceneManifest.scenes)) {
    context.scenesSummary = context.sceneManifest.scenes.map((s, idx) => ({
      index: idx + 1,
      scene_id: s.scene_id,
      scene_type: s.scene_type,
      visual_type: s.visual_type,
      card_template: s.card_template || 'data_card',
      duration_frames: s.duration_frames,
      duration_sec: ((s.duration_frames || 0) / (s.fps || 30)).toFixed(1),
      title: s.title || '',
      narration: (s.narration_text || '').slice(0, 60),
      ai_prompt: (s.ai_visual_prompt || '').slice(0, 60),
      has_asset: Boolean(s.final_asset_id)
    }));
  }

  return context;
}

/**
 * 分镜节奏与多模态自动化体检 (Audit)
 */
export function auditScenes(manifest) {
  if (!manifest || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    return {
      score: 0,
      issues: ['当前工程尚未生成分镜清单 (scene-manifest.json 为空)'],
      suggestions: ['请先通过分镜导演生成初步分镜'],
      stats: { totalScenes: 0, totalDurationSec: 0 }
    };
  }

  const fps = manifest.fps || 30;
  const scenes = manifest.scenes;
  const totalFrames = scenes.reduce((acc, s) => acc + (s.duration_frames || 0), 0);
  const totalDurationSec = (totalFrames / fps).toFixed(1);

  const issues = [];
  const suggestions = [];
  const typeCounts = {};
  const cardTemplateCounts = {};

  let shortShots = 0;
  let longShots = 0;
  let missingPrompts = 0;

  scenes.forEach((s, idx) => {
    const sec = (s.duration_frames || 0) / fps;
    typeCounts[s.visual_type] = (typeCounts[s.visual_type] || 0) + 1;
    if (s.card_template) {
      cardTemplateCounts[s.card_template] = (cardTemplateCounts[s.card_template] || 0) + 1;
    }

    if (sec < 2.8) {
      shortShots++;
      issues.push(`镜头 #${idx + 1} (${s.scene_id}) 时长仅 ${sec.toFixed(1)}s，低于 3s 视听下限`);
    } else if (sec > 9.0) {
      longShots++;
      issues.push(`镜头 #${idx + 1} (${s.scene_id}) 时长达到 ${sec.toFixed(1)}s，超过 9s 易造成视觉疲劳，建议拆镜`);
    }

    if (!s.ai_visual_prompt && !s.title) {
      missingPrompts++;
      issues.push(`镜头 #${idx + 1} (${s.scene_id}) 缺少视觉提示词和标题`);
    }
  });

  if (shortShots > 0) {
    suggestions.push(`有 ${shortShots} 个过短镜头，建议与相邻镜头合并或补充解说词。`);
  }
  if (longShots > 0) {
    suggestions.push(`有 ${longShots} 个长镜头，建议利用【✂️ 拆分镜头】功能拆为 4~6s 的双景别。`);
  }
  if (missingPrompts > 0) {
    suggestions.push(`有 ${missingPrompts} 个镜头缺少生图描述，可点击【✨ 提取生图提示词】一键补全。`);
  }

  // 视觉形式多样性评估
  const visualTypesUsed = Object.keys(typeCounts).length;
  if (visualTypesUsed <= 1 && scenes.length > 5) {
    suggestions.push('全片视觉形式较为单一，建议合理穿插数据卡片、对比图、高亮文献及实景摄影。');
  }

  let score = 100 - (shortShots * 4) - (longShots * 4) - (missingPrompts * 5);
  if (score < 40) score = 40;

  return {
    score,
    totalScenes: scenes.length,
    totalDurationSec,
    typeCounts,
    cardTemplateCounts,
    issues: issues.slice(0, 10),
    suggestions: suggestions.length > 0 ? suggestions : ['分镜节奏与结构非常均衡，符合 4~8s 黄金视听节奏！']
  };
}

/**
 * 免费本地 Antigravity 开发协同引擎（零 API 费用、离线智能分析）
 */
export function executeLocalAntigravityAnalysis({ projectId, prompt, context }) {
  const pLower = prompt.toLowerCase();
  const scenes = context.sceneManifest?.scenes || [];

  // 1. 检测是否针对具体镜头的修改意图 (如 "第3镜", "镜头3", "Shot-003", "把第2镜改为...")
  let targetScene = null;
  const shotNumMatch = prompt.match(/(?:第|镜头|shot[-_\s]?)(\d+)(?:镜|个镜头)?/i);
  if (shotNumMatch) {
    const idx = parseInt(shotNumMatch[1], 10);
    if (idx >= 1 && idx <= scenes.length) {
      targetScene = scenes[idx - 1];
    } else {
      targetScene = scenes.find(s => s.scene_id.includes(String(idx)));
    }
  }

  // 如果识别出具体镜头修改
  if (targetScene) {
    let newTemplate = targetScene.card_template || 'data_card';
    if (/对比|双栏|versus|两方/i.test(prompt)) newTemplate = 'versus_dual';
    else if (/数据|指标|图表|百分比|数字|data/i.test(prompt)) newTemplate = 'data_card';
    else if (/文献|古籍|引用|台词|史料|文书|document/i.test(prompt)) newTemplate = 'document_highlight';
    else if (/时间|发展|历程|timeline|节点/i.test(prompt)) newTemplate = 'timeline';
    else if (/大字|金句|标语|冲击|kinetic/i.test(prompt)) newTemplate = 'kinetic_text';

    // 提炼标题
    let newTitle = targetScene.title || '';
    const titleMatch = prompt.match(/(?:标题为|改成|命名为|大字为|“|”|「|」)([^，。！？\n“”「」]{2,16})/);
    if (titleMatch) {
      newTitle = titleMatch[1].trim();
    } else if (!newTitle) {
      const kws = targetScene.content_keywords || [];
      newTitle = kws[0] || (targetScene.narration_text ? targetScene.narration_text.slice(0, 10) : '核心论据');
    }

    const narration = targetScene.narration_text || '';
    const polishedPrompt = `【16:9纪录片视觉】定格「${newTitle}」，围绕台词阐述「${narration.slice(0, 30)}」，暗调现代微光磨砂排版，电影级光晕漫反射，8k超清细节`;

    const patchAction = {
      action: "update_scene",
      scene_id: targetScene.scene_id,
      patch: {
        title: newTitle,
        card_template: newTemplate,
        ai_visual_prompt: polishedPrompt
      }
    };

    const reply = `🎯 **Antigravity 本地调试引擎已为您规划镜头 [${targetScene.scene_id}] 的优化方案**：

- **排版模版**：\`${newTemplate}\`
- **核心标题**：\`${newTitle}\`
- **视觉提示词**：${polishedPrompt}

💡 您可以直接点击下方的 **【⚡ 一键应用至工程】** 按钮，系统将直接免 API 费用将修改写入当前工程！`;

    return {
      reply,
      patchAction,
      usedModel: 'Antigravity Local Engine (免 Key 开发模式)'
    };
  }

  // 2. 检测是否为诊断/体检请求
  if (/体检|诊断|节奏|时长|评分|audit/i.test(prompt)) {
    const report = auditScenes(context.sceneManifest);
    const reply = `🩺 **Antigravity 分镜健康度诊断报告（本地实时分析）**：

- **综合评分**：**${report.score} 分**
- **镜头统计**：共 ${report.totalScenes} 镜，全片时长 ${report.totalDurationSec} 秒
- **关键发现**：
${report.issues.map(i => `  • ⚠️ ${i}`).join('\n') || '  • ✅ 未发现明显节奏问题'}

- **导演调优建议**：
${report.suggestions.map(s => `  • 💡 ${s}`).join('\n')}

💡 **提示**：如需具体调整某个镜头（如“把第 2 镜改为双栏对比”），可直接在下方打字告诉我！`;

    return {
      reply,
      patchAction: null,
      usedModel: 'Antigravity Local Engine (免 Key 开发模式)'
    };
  }

  // 3. 检测是否为提示词润色请求
  if (/提示词|生图|画面描述|润色|prompt/i.test(prompt)) {
    const reply = `✨ **Antigravity 纪录片视觉提示词润色指引（免 Key 模式）**：

我们为 16:9 商业科普视频预置了高规格的视觉表达规范：
1. **真实摄影景别**：特写（微距材质光泽）、中景（文献与古籍翻阅）、全景（宏大自然地貌推镜头）。
2. **光影基调**：冷峻暗调底色，点缀琥珀金与科技蓝高光光晕，规避廉价杂乱文字。
3. **动态视频运镜**：结合台词动词，配置“正前推慢镜头”、“低角度俯仰摇镜”或“连续环绕航拍”。

💡 **免 API 付费生图指引**：
- 如果您需要在开发期**真正生成实景照片**，可直接在 **Antigravity 侧边栏/主对话框** 中对我说：
  *“请帮我为当前工程的第 X 镜生成一张 16:9 的视觉图片”*
  Antigravity 会启动内置的 \`image-generator\` 直接生图并写入工程，开发期全程零 API 费用！`;

    return {
      reply,
      patchAction: null,
      usedModel: 'Antigravity Local Engine (免 Key 开发模式)'
    };
  }

  // 4. 内容自适应动态语义分析（绝不返回死板固定文字）
  // 提取用户提问的核心词并在工程上下文（剧本、解说词、分镜）中进行全文检索
  const cleanTokens = prompt
    .replace(/[，。！？、\s\n“”?]+/g, ' ')
    .split(' ')
    .filter(t => t.length >= 2 && !['这个', '那个', '什么', '怎么', '如何', '可以', '一下', '请问', '我想', '是否'].includes(t));

  const matchedScenes = [];
  scenes.forEach((s, idx) => {
    const textToSearch = `${s.scene_id} ${s.title || ''} ${s.narration_text || ''} ${(s.content_keywords || []).join(' ')}`;
    const matchCount = cleanTokens.filter(tok => textToSearch.includes(tok)).length;
    if (matchCount > 0) {
      matchedScenes.push({ index: idx + 1, scene: s, matches: matchCount });
    }
  });

  // 如果命中了工程中具体镜头或解说词
  if (matchedScenes.length > 0) {
    matchedScenes.sort((a, b) => b.matches - a.matches);
    const topMatch = matchedScenes[0].scene;
    const topIdx = matchedScenes[0].index;

    let visualAdvice = '建议使用 16:9 暗色高阶科技演说信息图卡片 (data_card)，突出核心数据点与工艺细节。';
    if (/对比|差异|不同|相比/.test(prompt)) {
      visualAdvice = '适合采用左右双栏对比模版 (versus_dual)，左侧呈现传统历史风貌，右侧呈现现代工艺演变。';
    } else if (/历史|古籍|文献|记录|台词/.test(prompt)) {
      visualAdvice = '适合采用文献高亮模版 (document_highlight)，配合和纸暗纹与金色印章微动效。';
    } else if (/摄影|实景|风景|画面|风景/.test(prompt)) {
      visualAdvice = '适合采用实景摄影微动效 (photo_motion)，施加 Ken Burns 缓慢推进运镜与自然漫反射光影。';
    }

    const reply = `🎬 **针对您的问题：「${prompt}」，已为您检索并关联到镜头 #${topIdx} [${topMatch.scene_id}]**：

- **镜头覆盖台词**：「${topMatch.narration_text || '无'}」
- **核心关键词**：${(topMatch.content_keywords || ['暂未提炼']).join('、')}
- **当前排版形式**：\`${topMatch.visual_type || '未指定'}\` (${topMatch.card_template || '默认卡片'})
- **视听建议**：${visualAdvice}

💡 **快捷操作建议**：
若需将镜头 #${topIdx} 按照此方案重构，可直接打字告诉我：*“帮我把第 ${topIdx} 镜改为${visualAdvice.slice(4, 12)}”*。`;

    return {
      reply,
      patchAction: null,
      usedModel: 'Antigravity Local Engine (动态上下文检索)'
    };
  }

  // 风格、色彩、调色或基调咨询
  if (/色彩|风格|色调|调色|视觉|背景|质感|画风/.test(prompt)) {
    const reply = `🎨 **关于当前工程 [${context.projectId}] 的视觉色彩与风格建议**：

1. **色调体系**：
   - **底色**：85% 深蓝灰与冷黑背景 (\`#090d16\` / \`#05080f\`)，确保长视频沉浸感与眼部舒适度；
   - **高光点缀**：琥珀金 (\`#f59e0b\`) 与荧光科技青 (\`#06b6d4\`)，用于核心数据、重要结论与标志大字；
2. **排版容器**：
   - 采用 16:9 微光磨砂玻璃容器（Glassmorphism），搭配 1px 细微发光边框；
3. **摄影质感**：
   - 写实场景严格遵照真实自然漫反射光线，避免高饱和度塑料感，营造纪录片级别的高级质感。

💡 您可在左侧表格直接调整各镜头的【画面方式】，选择实景或特定卡片排版。`;

    return {
      reply,
      patchAction: null,
      usedModel: 'Antigravity Local Engine (视觉风格引擎)'
    };
  }

  // 音乐、情绪、配音咨询
  if (/音乐|配乐|bgm|声音|配音|情绪|节奏|调子/.test(prompt)) {
    const reply = `🎵 **关于当前工程的配乐节奏与情绪调度建议**：

1. **节奏分段**：
   - **开篇 (Hook)**：低频神秘环境音，第 1~3 镜快速抛出认知反差，BGM 宜克制微弱；
   - **展开 (Explain)**：第 4 镜后引入规律轻快的科技感或人文轻打击乐，推动认知展开；
   - **高潮 (Climax)**：在核心论据揭晓时加入重音顿音，随后恢复平静深沉；
2. **免付费配音**：
   - 本地已内置离线语音合成工具 (\`packages/qc-tools/synthesize-voicebox.mjs\`)，无需消耗云端配音额度即可合成高拟真旁白！`;

    return {
      reply,
      patchAction: null,
      usedModel: 'Antigravity Local Engine (音乐情绪引擎)'
    };
  }

  // 动态通用回答：列举当前工程的篇章结构与下一步
  const scriptTitles = (context.finalScript?.sections || []).map((sec, i) => `第 ${i + 1} 部分: ${sec.title || sec.section_title || '未命名'}`).slice(0, 4);
  const reply = `💡 **针对您的提问：「${prompt}」**

当前工程包含 **${scenes.length} 个视觉镜头**${scriptTitles.length > 0 ? `，涵盖：\n${scriptTitles.map(t => '• ' + t).join('\n')}` : ''}。

在当前开发调试阶段：
- **如需调整排版**：可输入例如 *“把第 2 镜改成双栏对比卡片”* 或 *“把第 5 镜大字改成核心结论”*；
- **如需视觉体检**：可点击上方 **【🩺 诊断分镜节奏】** 查看全片时长分布；
- **如需真机生图**：可在 Antigravity 主窗口直接告诉我让内置生图器生成！

💡 **获取 100% 动态大模型思考能力**：
Google 官方在 [Google AI Studio](https://aistudio.google.com/app/apikey) 提供了**完全免费**的 Gemini API Key（无需信用卡、每天免费 1500 次）。您只需领一个 Key 填到右上角，此抽屉就会立刻升级为 Gemini 实时大模型深度思考！`;

  return {
    reply,
    patchAction: null,
    usedModel: 'Antigravity Local Engine (自适应回答)'
  };
}

/**
 * 调试副驾驶 AI 对话 (优先支持本地免 Key 驱动，若配置了有效 Key 则调用云端模型)
 */
export async function executeDevChat({ projectId, prompt, visualConfig }) {
  const context = getProjectDevContext(projectId);
  const apiKey = (visualConfig?.apiKey || process.env.GEMINI_API_KEY || '').trim();
  const baseUrl = (visualConfig?.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (visualConfig?.textModel || 'google/gemini-2.5-pro').trim();

  // 若未配置外部 API Key 或指定为本地开发模式，直接使用免费的本地 Antigravity 协同分析引擎！
  if (!apiKey || apiKey === 'antigravity-local-dev' || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    return executeLocalAntigravityAnalysis({ projectId, prompt, context });
  }

  const systemPrompt = `你是一名专业硬核纪录片视频导演兼 Remotion 前端动效专家，正服务于 WhyVideo Studio 自动化视频管线。
当前正在调试的工程: "${projectId}"
项目标题: "${context.sceneManifest?.project_title || context.brief?.title || projectId}"
当前镜头总数: ${context.scenesSummary.length}
当前所有镜头的概要列表:
${JSON.stringify(context.scenesSummary.slice(0, 30), null, 2)}

【你的职责】
1. 分析并回答用户关于当前工程的视觉排版、卡片模板、分镜节奏、提示词润色的疑问。
2. 如果用户提出修改或调优某个镜头的要求（例如修改第X镜的标题、旁白、生图提示词、卡片模版或排版文案），你可以在回复末尾附带一个标准的 JSON 代码块，格式如下：
\`\`\`json
{
  "action": "update_scene",
  "scene_id": "具体镜头的scene_id",
  "patch": {
    "title": "新的大字标题",
    "card_template": "data_card 或 versus_dual 或 document_highlight",
    "ai_visual_prompt": "优化后的高质感画面描述"
  }
}
\`\`\`
3. 保持回答清晰、专业、聚焦视听呈现效果，避免无意义的客套套话。`;

  try {
    let cleanModel = model;
    if (baseUrl.includes('googleapis.com')) {
      cleanModel = cleanModel.replace(/^google\//, '');
      if (cleanModel.includes('2.5')) {
        cleanModel = cleanModel.replace('2.5', '1.5');
      }
    }

    let endpoint = `${baseUrl}/chat/completions`;
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Dev Assistant'
    };

    let body = {
      model: cleanModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    };

    let resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok && resp.status === 404 && baseUrl.includes('googleapis.com')) {
      body.model = 'gemini-1.5-flash';
      resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
    }

    if (!resp.ok) {
      console.warn(`[DevChat Warning] 云端网关异常 (HTTP ${resp.status})，自动回退到 Antigravity 本地引擎`);
      return executeLocalAntigravityAnalysis({ projectId, prompt, context });
    }

    const data = await resp.json();
    const replyText = data.choices?.[0]?.message?.content || '未能获取有效回复';

    let patchAction = null;
    const match = replyText.match(/```json\s*(\{[\s\S]*?"action":\s*"update_scene"[\s\S]*?\})\s*```/);
    if (match) {
      try {
        patchAction = JSON.parse(match[1]);
      } catch (e) {
        console.warn('解析 Patch Action 失败:', e);
      }
    }

    return {
      reply: replyText,
      patchAction,
      usedModel: model
    };
  } catch (err) {
    console.warn(`[DevChat Exception] ${err.message}，自动回退到 Antigravity 本地引擎`);
    return executeLocalAntigravityAnalysis({ projectId, prompt, context });
  }
}

/**
 * 应用分镜 Patch 修改到本地 scene-manifest.json
 */
export function applyScenePatch(projectId, sceneId, patch) {
  const projectDir = path.join(rootDir, 'projects', projectId);
  const manifestPath = path.join(projectDir, 'data', 'scene-manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`未找到工程 ${projectId} 的 scene-manifest.json`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const scenes = manifest.scenes || [];
  const target = scenes.find(s => s.scene_id === sceneId);

  if (!target) {
    throw new Error(`未找到镜头 ${sceneId}`);
  }

  // 安全打补丁
  if (patch.title !== undefined) target.title = patch.title;
  if (patch.ai_visual_prompt !== undefined) target.ai_visual_prompt = patch.ai_visual_prompt;
  if (patch.card_template !== undefined) target.card_template = patch.card_template;
  if (patch.visual_type !== undefined) target.visual_type = patch.visual_type;
  if (patch.narration_text !== undefined) target.narration_text = patch.narration_text;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    ok: true,
    updatedScene: target
  };
}
