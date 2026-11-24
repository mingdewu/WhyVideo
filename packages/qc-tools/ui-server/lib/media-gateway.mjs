import promptRules from '../public/js/shared/prompt-rules.cjs';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { rootDir, getPaths } from './config.mjs';
import { callOpenRouterText, extractJsonFromText } from './llm-gateway.mjs';
import { renderProducerPrompt } from '../../producer-prompts.mjs';
import { scenesText, sceneSpokenRanges, spokenIndex } from '../../narration-timing.mjs';

/**
 * 调用大模型为每个镜头从原文中挑出 1~2 个"画面最先要表现的具体词"。
 * 未配置 API Key 或调用失败时返回空对象，自动降级为 cut-planner 启发式关键词。
 */
export async function extractVisualKeywordsMap(manifest, curPaths, onProgress) {
  const scenes = manifest?.scenes || [];
  if (!scenes.length) return { map: {}, aiUsed: false };

  let cfg = {};
  if (fs.existsSync(curPaths.promptConfigPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8'));
    } catch (e) {}
  }
  const model = cfg.keywordModel || cfg.textModel || cfg.model;
  const apiKey = cfg.apiKey;
  const baseUrl = cfg.baseUrl;

  const { chars: spoken } = spokenIndex(scenesText(scenes));
  const { ranges } = sceneSpokenRanges(scenes);
  const keywordsByScene = {};
  let aiUsed = false;

  const CHUNK_SIZE = 24;
  for (let start = 0; start < scenes.length; start += CHUNK_SIZE) {
    const chunk = scenes.slice(start, start + CHUNK_SIZE);
    if (typeof onProgress === 'function') {
      try {
        onProgress(start, scenes.length);
      } catch (e) {}
    }
    const lines = chunk.map((s, offset) => {
      const idx = start + offset;
      const [a, b] = ranges[idx];
      const prevA = idx > 0 ? ranges[idx - 1][0] : a;
      // 带上上一镜后半段，让 AI 能发现"在上一句后半段就提到本镜核心物体"的情况
      const prevTail = idx > 0 ? spoken.slice(Math.max(prevA, a - 18), a).join('') : '';
      const curBody = spoken.slice(a, b).join('');
      const hint = s.selected_search_keyword || (s.content_keywords || []).slice(0, 2).join('、') || '';
      return `#${idx} [画面意图:${hint || '无'}] 参考文:${prevTail ? prevTail + ' / ' : ''}${curBody}`;
    });

    const sys = [
      '你是纪录片剪辑师。下面每个镜头有一段【参考文】（斜杠前是上一镜结尾，斜杠后是本镜正文）。',
      '请为每个镜头挑出 1~2 个「画面最先要表现的具体事物/人物/地点/动作/数字」关键词，用来决定什么时候把画面切到这一镜。',
      '要求：',
      '1. 关键词必须是该镜头【参考文】里连续原样出现的词（2~6个字，忽略斜杠和标点），绝对不要改写或自己造词；',
      '2. 优先选名词、地名、人名、具体物品或核心数字，不要选「我们」「因为」「画面」「镜头」之类虚词；',
      '3. 严格只输出 JSON 数组，不要其他文字：[{"i": 镜头序号数字, "kw": ["词1", "词2"]}, ...]。',
    ].join('\n');

    const reply = await callOpenRouterText(sys, lines.join('\n'), {
      model,
      apiKey,
      baseUrl,
      maxTokens: 2000,
    });
    if (!reply) {
      // 未配置 API Key 或接口异常时直接终止剩余批次，退化为启发式关键词
      break;
    }

    try {
      const jsonMatch = reply.replace(/```json\s*|```/gi, '').match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          aiUsed = true;
          for (const item of parsed) {
            const idx = Number(item?.i);
            if (!Number.isInteger(idx) || idx < start || idx >= start + chunk.length) continue;
            const [a, b] = ranges[idx];
            const prevA = idx > 0 ? ranges[idx - 1][0] : a;
            const winStr = spoken.slice(prevA, b).join('');
            const validKws = (Array.isArray(item.kw) ? item.kw : [])
              .map((k) => spokenIndex(String(k || '')).chars.join(''))
              .filter((k) => k.length >= 2 && k.length <= 8 && winStr.includes(k))
              .slice(0, 2);
            if (validKws.length) {
              keywordsByScene[idx] = validKws;
              scenes[idx].visual_keywords = validKws;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[auto-plan-cuts] AI 关键词解析跳过:', e.message);
    }
    if (typeof onProgress === 'function') {
      try {
        onProgress(Math.min(start + chunk.length, scenes.length), scenes.length);
      } catch (e) {}
    }
  }

  return { map: keywordsByScene, aiUsed };
}

export function syncLocalProjectAssets(projectId) {
  const curPaths = getPaths(projectId);
  const videoDir = path.join(curPaths.publicDir, 'assets', 'video');
  const imageDir = path.join(curPaths.publicDir, 'assets', 'images');
  try {
    fs.mkdirSync(videoDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });
  } catch (e) {}

  const assetIndex = fs.existsSync(curPaths.assetIndexPath)
    ? JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'))
    : { project_id: projectId, assets: [] };
  if (!Array.isArray(assetIndex.assets)) assetIndex.assets = [];

  const knownPaths = new Set(assetIndex.assets.map((a) => a.path));
  let mutated = false;

  const scanFolder = (dirPath, relPrefix, mediaType) => {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath).filter((f) => !f.startsWith('.'));
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (mediaType === 'video' && !['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) continue;
      if (mediaType === 'image' && !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      const relPath = `${relPrefix}/${f}`;
      if (knownPaths.has(relPath)) continue;
      const fullPath = path.join(dirPath, f);
      try {
        const st = fs.statSync(fullPath);
        if (!st.isFile() || st.size === 0) continue;
      } catch (e) {
        continue;
      }
      const newAssetId = `${mediaType === 'video' ? 'AST-VID-' : 'AST-IMG-'}${String(assetIndex.assets.length + 1).padStart(3, '0')}`;
      assetIndex.assets.push({
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${projectId}/public/${relPath}`,
        file_name: f,
        type: mediaType,
        media_type: mediaType,
        duration_seconds: mediaType === 'video' ? 10.0 : null,
        duration_sec: mediaType === 'video' ? 10.0 : null,
        resolution: '1920x1080',
        license_status: 'approved',
        source_url: `local_asset://${f}`,
        tags: ['本工程本地素材', projectId],
      });
      knownPaths.add(relPath);
      mutated = true;
    }
  };

  scanFolder(videoDir, 'assets/video', 'video');
  scanFolder(imageDir, 'assets/images', 'image');

  if (mutated) {
    try {
      fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');
    } catch (e) {}
  }

  let audioProbed = false;
  for (const a of assetIndex.assets) {
    const fullDiskPath = a.path ? path.join(curPaths.publicDir, a.path) : '';
    a.exists_on_disk = Boolean(fullDiskPath && fs.existsSync(fullDiskPath));
    const isVid = a.type === 'video' || a.media_type === 'video' || /\.(mp4|mov|webm|mkv)$/i.test(a.path || '');
    if (isVid && a.exists_on_disk && typeof a.has_audio !== 'boolean') {
      try {
        const probeAudio = spawnSync(
          'ffprobe',
          ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', fullDiskPath],
          { encoding: 'utf8' }
        );
        a.has_audio = probeAudio.status === 0 && String(probeAudio.stdout || '').trim().length > 0;
      } catch (e) {
        a.has_audio = false;
      }
      audioProbed = true;
    }
  }
  if (audioProbed) {
    try {
      fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');
    } catch (e) {}
  }
  return assetIndex;
}

// 纯文本规则解析引擎 (支持视频裁剪、远程片段下载跳转、画面滤镜、文字弹幕/艺术字、图片运镜及程序化场景切换)

export async function callOpenRouterDirector(cfg, scene, customPrompt, templateStyle) {
  const apiKey = (cfg.apiKey || '').trim();
  if (!apiKey) {
    const kws = scene.content_keywords || [];
    const narration = scene.narration_text || '';
    return {
      theme_title: kws[0] || (narration ? narration.slice(0, 10) : '核心要点'),
      subtitle: narration.slice(0, 24),
      bullet_points: [
        narration.slice(0, 18),
        kws[1] ? `关注焦点：${kws[1]}` : '关键事实依据'
      ],
      recommended_template: templateStyle || 'data_card'
    };
  }

  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (cfg.model || 'anthropic/claude-3.5-sonnet').trim();

  const url = `${baseUrl}/chat/completions`;
  const systemPrompt = `你是一位顶尖的 YouTube 科技深度纪录片视觉分镜总监。
任务：根据给定的【旁白台词】与【用户视觉 Prompt】，为 16:9 画幅视频提炼具有极强认知冲击力与视听节奏感的核心画面信息。

必须且仅返回纯净 JSON 格式，严禁返回任何额外文字、markdown标记或问候：
{
  "theme_title": "核心大字醒目标题（4~14字，具颠覆性或总结性）",
  "subtitle": "副级精炼阐释说明（12~30字）",
  "bullet_points": [
    "提炼论点一（12~24字）",
    "提炼论点二（12~24字）"
  ],
  "recommended_template": "data_card 或 versus_dual 或 document_highlight 或 timeline"
}`;

  const userMessage = `【镜头序号】：${scene.scene_id}
【章节分类】：${scene.chapter_ref || '核心解析'}
【本镜台词】：${scene.narration_text}
【用户指示词/Prompt】：${customPrompt || '冷峻科技风、概念颠覆、强化视觉记忆'}
【指定模板样式】：${templateStyle || '自动分析决定'}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.5,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API 状态码 ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('无法从模型返回中提取 JSON 数据');
  return JSON.parse(match[0]);
}

export const { extractLocalSmartPrompt } = promptRules;

export async function callOpenRouterPromptExtractor(cfg, narrationText, targetMode, keywords = [], templateStyle = 'data_card', projectContext = {}, projectDir = '') {
  const apiKey = (cfg.apiKey || '').trim();
  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (cfg.textModel || cfg.model || 'deepseek/deepseek-chat').trim();

  if (!apiKey) {
    return {
      prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords, templateStyle),
      usedModel: '本地语义解析 (未配置 API Key)',
      isAi: false
    };
  }

  const projTitle = projectContext.title || '历史文化与地理深度纪录片';
  const projSummary = projectContext.short_answer || projectContext.subtitle || '';

  let modeName = '🎬 真实实体视频 (Text-to-Video MP4)';
  let templateId = 'P2_video_prompt';
  if (targetMode === 'image') {
    modeName = '🖼️ 超写实实景图 (FLUX / Midjourney HD)';
    templateId = 'P3_image_prompt';
  } else if (targetMode === 'card') {
    modeName = '📊 大模型视觉排版调优 (AI Smart Layout)';
    templateId = 'P4_card_prompt';
  }

  const systemPrompt = renderProducerPrompt(projectDir, templateId, {
    project_title: projTitle,
    project_summary: projSummary ? `核心叙事概要：${projSummary}` : '',
  });

  const userMessage = `【镜头旁白台词】：${narrationText}
【关键词参考】：${keywords.length ? keywords.join('、') : '无'}
【指定视觉形态】：${modeName}

请立即提炼：`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.4,
        max_tokens: 350
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[OpenRouter Prompt Warning] Status ${response.status}: ${errText.slice(0, 100)}，回退至本地实体解析。`);
      return {
        prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
        usedModel: `本地语义解析 (${model.split('/').pop()} 网关异常)`,
        isAi: false
      };
    }

    const resJson = await response.json();
    const rawContent = resJson.choices?.[0]?.message?.content?.trim() || '';
    if (!rawContent) {
      return {
        prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
        usedModel: '本地语义解析 (AI返回为空)',
        isAi: false
      };
    }

    const cleanPrompt = rawContent.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return {
      prompt: cleanPrompt,
      usedModel: `AI 分镜总监 (${model.split('/').pop()})`,
      isAi: true
    };
  } catch (err) {
    console.warn(`[OpenRouter Prompt Exception] ${err.message}，回退至本地实体解析。`);
    return {
      prompt: extractLocalSmartPrompt(narrationText, targetMode, keywords),
      usedModel: '本地语义解析 (网络回退)',
      isAi: false
    };
  }
}

/** Register a complete asset record for generated, uploaded or downloaded media. */
export function registerProjectAsset(curPaths, assetRecord) {
  const index = fs.existsSync(curPaths.assetIndexPath)
    ? JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'))
    : { assets: [] };
  index.assets = index.assets || [];
  index.assets.push(assetRecord);
  fs.writeFileSync(curPaths.assetIndexPath, JSON.stringify(index, null, 2), 'utf8');
  return assetRecord;
}

export function registerGeneratedAsset(curPaths, projectId, sceneId, relPath, type = 'video', durationSec = 6.0) {
  let assetIdx = { assets: [] };
  if (fs.existsSync(curPaths.assetIndexPath)) {
    try { assetIdx = JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8')); } catch (e) {}
  }
  const assetId = `AST-${type.toUpperCase()}-${sceneId.toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const assetRecord = {
    asset_id: assetId,
    path: relPath,
    file_path: `projects/${projectId}/public/${relPath}`,
    type: type,
    media_type: type,
    resolution: '1920x1080',
    duration_seconds: durationSec,
    duration_sec: durationSec,
    license_status: 'approved',
    source: 'ai_visual_video_generator',
    tags: ['ai_generated', type, sceneId]
  };
  registerProjectAsset(curPaths, assetRecord);
  return assetId;
}

export async function callSearchKeywordExtractor(cfg, narrationText, projectContext = {}, chapterRef = '', projectDir = '', excludeKeyword = '') {
  const apiKey = (cfg.apiKey || '').trim();
  const baseUrl = (cfg.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const model = (cfg.keywordModel || cfg.textModel || cfg.model || 'deepseek/deepseek-chat').trim();

  if (!apiKey) {
    throw new Error('未配置统一 API Key，请先在「AI 全流程模型调度中心」中填写 API Key');
  }

  const projTitle = projectContext.title || '深度知识纪录片';
  const systemPrompt = renderProducerPrompt(projectDir, 'P1_keywords', {
    project_title: projTitle,
    chapter_ref: chapterRef || '',
  });

  const excludeLine = excludeKeyword
    ? `\n【避开已用词】：请不要重复“${excludeKeyword}”，换一个同样贴合本句旁白的具体画面搜索词。`
    : '';
  const userMessage = `【视频主题】：${projTitle}${chapterRef ? `\n【所属章节】：${chapterRef}` : ''}
【本镜头旁白】：${narrationText}${excludeLine}

请直接输出 1 个唯一最佳纯中文搜索词（JSON 对象 {"keyword": "..."}）：`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: excludeKeyword ? 0.55 : 0.25,
      max_tokens: 512,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`关键词提炼模型请求失败 (HTTP ${response.status}): ${errText.slice(0, 160)}`);
  }

  const resJson = await response.json();
  if (resJson.choices?.[0]?.finish_reason === 'length') {
    throw new Error('模型输出被截断，未生成完整搜索词，请重试或更换关键词模型');
  }
  const raw = resJson.choices?.[0]?.message?.content?.trim() || '';
  if (!raw) {
    throw new Error('模型未返回有效关键词内容');
  }

  const keyword = parseSearchKeyword(raw);
  return { keyword, keywords: [keyword], usedModel: model };
}

export function parseSearchKeyword(raw) {
  let candidates = [];
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const jsonVal = extractJsonFromText(cleaned);
  if (jsonVal !== null) {
    if (typeof jsonVal === 'string') {
      candidates = [jsonVal];
    } else if (jsonVal && typeof jsonVal.keyword === 'string') {
      candidates = [jsonVal.keyword];
    } else if (Array.isArray(jsonVal)) {
      candidates = jsonVal;
    } else if (Array.isArray(jsonVal?.keywords)) {
      candidates = jsonVal.keywords;
    }
  } else if (!/[{}\[\]:：`]/.test(cleaned)) {
    candidates = cleaned.split(/[\n,，、；;]+/);
  }

  const cleanList = Array.from(
    new Set(
      candidates
        .filter((item) => typeof item === 'string')
        .map((item) => item.replace(/^[\s\-*•\d.、"'「」【】]+|[\s"'「」【】\[\]{}，。！？,.!?]+$/g, '').trim())
        .filter((kw) => kw.length >= 2 && kw.length <= 24
          && /\p{Script=Han}/u.test(kw) && !/[a-zA-Z{}\[\]:：`]/.test(kw)
          && !['唯一最佳中文搜索词', '唯一最佳纯中文搜索词', '中文搜索词', '搜索词', '关键词'].includes(kw))
    )
  );

  const keyword = cleanList[0] || '';
  if (!keyword) {
    throw new Error('未能从模型输出中解析出有效中文搜索词');
  }

  return keyword;
}


export async function downloadRemoteMedia(remoteUrl, localDestPath, apiKey = '') {
  const dir = path.dirname(localDestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (remoteUrl.startsWith('data:')) {
    const base64Data = remoteUrl.split(',')[1];
    fs.writeFileSync(localDestPath, Buffer.from(base64Data, 'base64'));
    return;
  }
  const headers = {};
  if (apiKey && remoteUrl.includes('openrouter.ai')) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    headers['HTTP-Referer'] = 'https://github.com/mingdewu/WhyVideo';
    headers['X-Title'] = 'WhyVideo Studio';
  }
  const resp = await fetch(remoteUrl, { headers });
  if (!resp.ok) throw new Error(`下载媒体文件失败 (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(localDestPath, buf);
}

// 统一 AI 实体视频生成器 (支持 OpenRouter 原生视频端点、各类多模态代理网关、SiliconFlow、Runway 等任意模型 Slug)
export async function callGatewayVideoGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', videoModel = 'minimax/hailuo-3' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key，请先在右上角【🎬 AI 画面/视频模型指定】中填入您的 API Key 并保存');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = videoModel.trim();

  // 0. 原生 OpenRouter 官方视频生成端点 (POST https://openrouter.ai/api/v1/videos)
  if (base.includes('openrouter.ai')) {
    // 智能映射：MiniMax 视频在 OpenRouter 上的标准模型 ID
    if (model === 'minimax/video-01' || model === 'minimax/hailuo' || model === 'minimax-01' || model === 'video-01') {
      console.log(`[OpenRouter Video] 自动将 ${model} 映射为 OpenRouter 标准模型: minimax/hailuo-3-max`);
      model = 'minimax/hailuo-3-max';
    }

    // 针对各模型官方支持的 resolution / duration 动态适配
    let resolution = '720p';
    let duration = 5;
    if (model === 'minimax/hailuo-3') {
      resolution = '2K';
      duration = 5;
    } else if (model === 'minimax/hailuo-3-max') {
      resolution = '768p';
      duration = 5;
    } else if (model === 'minimax/hailuo-2.3') {
      resolution = '1080p';
      duration = 6;
    } else if (model.includes('veo')) {
      resolution = '720p';
      duration = 4;
    }

    console.log(`[OpenRouter Video] 正在提交任务至 ${base}/videos，模型: ${model} (分辨率: ${resolution}, 时长: ${duration}s)...`);
    const submitResp = await fetch(`${base}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9',
        duration: duration,
        resolution: resolution
      })
    });

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 视频生成请求未通过 (HTTP ${submitResp.status}): ${errMsg}`);
    }

    const jobData = await submitResp.json();
    console.log('[OpenRouter Video Job Created]', jobData);

    if (Array.isArray(jobData.urls) && jobData.urls.length > 0) {
      return jobData.urls[0];
    }
    if (Array.isArray(jobData.unsigned_urls) && jobData.unsigned_urls.length > 0) {
      return jobData.unsigned_urls[0];
    }

    const jobId = jobData.id;
    if (!jobId) throw new Error('OpenRouter 已受理但未返回任务 ID');

    const pollUrl = jobData.polling_url || `${base}/videos/${jobId}`;

    // 轮询生成结果 (最长约 4 分钟，每 4 秒轮询一次)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const pollResp = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        }
      });
      if (!pollResp.ok) continue;
      const pollData = await pollResp.json();
      const status = (pollData.status || '').toLowerCase();
      console.log(`[OpenRouter Video Polling] Job ${jobId} 状态: ${status} (${(i + 1) * 4}s)`);

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        const videoUrl = pollData.urls?.[0] || pollData.unsigned_urls?.[0] || pollData.url || pollData.video_url;
        if (videoUrl) return videoUrl;
      }

      if (status === 'failed' || status === 'error') {
        const failMsg = pollData.error?.message || pollData.error || '视频生成任务失败';
        throw new Error(`OpenRouter 视频生成失败: ${failMsg}`);
      }
    }

    throw new Error(`OpenRouter 视频生成超时 (任务 ID: ${jobId})，请稍后检查网关或重试`);
  }

  // 1. 如果是原生 SiliconFlow 网关
  if (base.includes('siliconflow')) {
    const submitResp = await fetch(`${base}/video/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model, prompt: prompt, image_size: '1280x720' })
    });
    if (!submitResp.ok) throw new Error(`SiliconFlow 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { requestId } = await submitResp.json();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const sResp = await fetch(`${base}/video/status?requestId=${requestId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      const st = (sData.status || '').toLowerCase();
      if (st === 'succeed' || st === 'succeeded') {
        const vUrl = sData.results?.videos?.[0]?.url || sData.results?.url;
        if (vUrl) return vUrl;
      }
      if (st === 'failed') throw new Error(`SiliconFlow 视频生成失败: ${sData.reason || '未知错误'}`);
    }
    throw new Error('SiliconFlow 视频生成超时');
  }

  // 2. 如果是 MiniMax 官方网关
  if (base.includes('minimax')) {
    const submitResp = await fetch(`${base}/video_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({ model: model === 'minimax/video-01' ? 'video-01' : model, prompt: prompt })
    });
    if (!submitResp.ok) throw new Error(`MiniMax 视频提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { task_id } = await submitResp.json();
    if (!task_id) throw new Error('MiniMax 未返回 task_id');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const qResp = await fetch(`${base}/query/video_generation?task_id=${task_id}`, {
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
      });
      if (!qResp.ok) continue;
      const qData = await qResp.json();
      const st = (qData.status || '').toLowerCase();
      if (st === 'success' || st === 'succeeded' || qData.file_id) {
        if (qData.file_id) {
          const dlResp = await fetch(`${base}/files/retrieve?file_id=${qData.file_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
          });
          if (dlResp.ok) {
            const dlData = await dlResp.json();
            if (dlData.file?.download_url) return dlData.file.download_url;
          }
        }
        if (qData.download_url) return qData.download_url;
      }
      if (st === 'failed' || st === 'error') throw new Error(`MiniMax 视频生成失败: ${qData.error_message || '未知错误'}`);
    }
    throw new Error('MiniMax 视频生成超时');
  }

  // 3. 如果是原生 Runway 网关
  if (base.includes('runwayml')) {
    const submitResp = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' },
      body: JSON.stringify({ taskType: model, promptText: prompt, duration: 5, ratio: '16:9' })
    });
    if (!submitResp.ok) throw new Error(`Runway 提交失败 (${submitResp.status}): ${(await submitResp.text()).slice(0, 200)}`);
    const { id: taskId } = await submitResp.json();
    for (let i = 0; i < 35; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const sResp = await fetch(`${base}/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'X-Runway-Version': '2024-09-13' } });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      if (sData.status === 'SUCCEEDED') return sData.output?.[0] || sData.output?.url;
      if (sData.status === 'FAILED') throw new Error(`Runway 视频生成失败: ${sData.failure || '未知原因'}`);
    }
    throw new Error('Runway 视频生成超时');
  }

  // 4. 通用 OpenAI 兼容 / 第三方中转聚合网关：依次尝试端点
  const candidateEndpoints = [
    `${base}/videos`,
    `${base}/video/generations`,
    `${base}/videos/generations`,
    `${base}/video_generation`,
    `${base}/video/submit`,
    `${base}/tasks`
  ];

  let submitResp = null;
  let lastErrorDetail = '';
  for (const ep of candidateEndpoints) {
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          promptText: prompt,
          ratio: '16:9',
          aspect_ratio: '16:9',
          image_size: '1280x720',
          duration: 5
        })
      });
      if (resp.status !== 404) {
        submitResp = resp;
        break;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  // 若标准端点未命中，尝试 /chat/completions (针对通过 Chat 路由视频模型的第三方代理)
  if (!submitResp || submitResp.status === 404) {
    try {
      const chatResp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: `请生成 16:9 动态 MP4 实体视频：${prompt}` }]
        })
      });
      if (chatResp.ok) {
        const cData = await chatResp.json();
        const text = cData.choices?.[0]?.message?.content || '';
        const m = text.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/i);
        if (m) return m[0];
        if (cData.url) return cData.url;
        if (cData.data?.[0]?.url) return cData.data[0].url;
      } else {
        lastErrorDetail = `HTTP ${chatResp.status}: ${(await chatResp.text()).slice(0, 160)}`;
      }
    } catch (e) {
      lastErrorDetail = e.message;
    }
  }

  if (!submitResp || !submitResp.ok) {
    const errText = submitResp ? await submitResp.text() : (lastErrorDetail || '未能连接到任何有效的视频生成端点 (/videos, /video/generations, /video_generation, /video/submit)');
    throw new Error(`视频模型 ${model} 生成请求未通过 (HTTP ${submitResp ? submitResp.status : 500}): ${errText.slice(0, 260)}`);
  }

  const sData = await submitResp.json();
  if (sData.urls?.[0]) return sData.urls[0];
  if (sData.url) return sData.url;
  if (sData.data?.[0]?.url) return sData.data[0].url;
  if (sData.results?.videos?.[0]?.url) return sData.results.videos[0].url;
  if (sData.output?.[0]) return sData.output[0];
  if (Array.isArray(sData.unsigned_urls) && sData.unsigned_urls.length > 0) return sData.unsigned_urls[0];

  const taskId = sData.id || sData.taskId || sData.requestId || sData.task_id;
  if (!taskId) throw new Error('网关已响应但未返回视频 URL 或任务 ID');

  // 轮询任务
  const pollPaths = [
    `${base}/videos/${taskId}`,
    `${base}/video/generations/${taskId}`,
    `${base}/video/status?requestId=${taskId}`,
    `${base}/tasks/${taskId}`
  ];

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    for (const pUrl of pollPaths) {
      try {
        const pollResp = await fetch(pUrl, { headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
        if (!pollResp.ok) continue;
        const pData = await pollResp.json();
        const st = (pData.status || '').toLowerCase();
        if (st === 'succeed' || st === 'succeeded' || st === 'success' || st === 'completed') {
          return pData.urls?.[0] || pData.unsigned_urls?.[0] || pData.results?.videos?.[0]?.url || pData.data?.[0]?.url || pData.output?.[0] || pData.url;
        }
        if (st === 'failed' || st === 'failure' || st === 'error') {
          throw new Error(`视频生成任务失败: ${pData.reason || pData.error?.message || pData.error || '未知原因'}`);
        }
      } catch (err) {
        if (err.message.includes('视频生成任务失败')) throw err;
      }
    }
  }

  throw new Error(`视频生成超时 (任务 ID: ${taskId})，请稍后刷新或检查网关`);
}

// 统一 AI 超清实景生图器 (支持 OpenRouter 原生 /api/v1/images、FLUX 3、FLUX.2、Recraft、Gemini Image 等)
export async function callGatewayImageGeneration({ apiKey, baseUrl = 'https://openrouter.ai/api/v1', imageModel = 'black-forest-labs/flux-3-image' }, prompt) {
  if (!apiKey) throw new Error('未配置 API Key');
  const base = baseUrl.trim().replace(/\/+$/, '');
  let model = imageModel.trim();

  // 智能映射：将用户输入的 FLUX.1 (如 black-forest-labs/flux-1-schnell) 自动映射为 OpenRouter 官方的 FLUX 3
  if (
    model === 'black-forest-labs/flux-1-schnell' ||
    model === 'black-forest-labs/flux-1-dev' ||
    model.includes('flux-1') ||
    model === 'flux-schnell' ||
    model === 'flux'
  ) {
    console.log(`[OpenRouter Image] 自动将旧版 ${model} 映射为 OpenRouter 官方标准模型: black-forest-labs/flux-3-image`);
    model = 'black-forest-labs/flux-3-image';
  } else if (model === 'recraft-v3') {
    model = 'recraft/recraft-v3';
  }

  // 1. 如果是 OpenRouter 官方网关，直接调用官方统一生图 API: POST https://openrouter.ai/api/v1/images
  if (base.includes('openrouter.ai')) {
    console.log(`[OpenRouter Image] 正在向 ${base}/images 提交生图请求，模型: ${model}...`);
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
      } catch (e) {}
      throw new Error(`OpenRouter 生图请求未通过 (HTTP ${resp.status}): ${errMsg}`);
    }

    const data = await resp.json();
    const firstItem = data.data?.[0];
    if (firstItem?.b64_json) {
      const mediaType = firstItem.media_type || 'image/png';
      return `data:${mediaType};base64,${firstItem.b64_json}`;
    }
    if (firstItem?.url) return firstItem.url;
    if (data.url) return data.url;
    throw new Error('OpenRouter 已受理但未返回图片数据');
  }

  // 2. 其他 OpenAI 兼容代理网关：依次尝试 /images、/images/generations
  try {
    const resp = await fetch(`${base}/images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        aspect_ratio: '16:9'
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const firstItem = data.data?.[0];
      if (firstItem?.b64_json) return `data:${firstItem.media_type || 'image/png'};base64,${firstItem.b64_json}`;
      if (firstItem?.url) return firstItem.url;
    }
  } catch (e) {}

  try {
    const resp = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        size: '1024x576',
        num_inference_steps: 4
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const imgUrl = data.data?.[0]?.url || data.images?.[0]?.url || data.url;
      if (imgUrl) return imgUrl;
    }
  } catch (e) {}

  // 3. 尝试 Chat 接口兼容生图
  const chatResp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`,
      'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
      'X-Title': 'WhyVideo Studio'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: `Generate a high quality 16:9 realistic photo: ${prompt}` }]
    })
  });

  if (!chatResp.ok) {
    throw new Error(`生图请求未通过 (HTTP ${chatResp.status}): ${(await chatResp.text()).slice(0, 200)}`);
  }
  const chatData = await chatResp.json();
  const content = chatData.choices?.[0]?.message?.content || '';
  const m = content.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  if (m) return m[0];
  if (chatData.data?.[0]?.url) return chatData.data[0].url;

  throw new Error('未能从模型返回中提取图片 URL');
}

