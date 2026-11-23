import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { rootDir, getPaths } from './config.mjs';
import { renderProducerPrompt } from '../../producer-prompts.mjs';

export function chineseNumToInt(rawStr) {
  const s = String(rawStr || '').trim();
  if (!s) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  const digitMap = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const unitMap = { '十': 10, '百': 100 };
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (digitMap[ch] !== undefined) {
      current = digitMap[ch];
    } else if (unitMap[ch] !== undefined) {
      const unit = unitMap[ch];
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
    } else {
      return NaN;
    }
  }
  return total + current;
}

export function normalizeChineseTimeNumbers(text) {
  return String(text || '').replace(/[零〇一二两三四五六七八九十百]+(?=\s*(?:小时|时|分钟|分|秒))/g, (m) => {
    const val = chineseNumToInt(m);
    return Number.isNaN(val) ? m : String(val);
  });
}

export function parseSingleTimeTokenSec(token) {
  if (!token) return null;
  const s = normalizeChineseTimeNumbers(String(token).trim());

  // 1. 冒号格式 HH:MM:SS 或 MM:SS (如 01:05, 1:15, 00:01:05.5)
  const colonMatch = s.match(/^(?:(\d{1,2})\s*[:：]\s*)?(\d{1,2})\s*[:：]\s*(\d{1,2}(?:\.\d+)?)$/);
  if (colonMatch) {
    const h = colonMatch[1] ? parseFloat(colonMatch[1]) : 0;
    const m = parseFloat(colonMatch[2]);
    const sec = parseFloat(colonMatch[3]);
    return Number((h * 3600 + m * 60 + sec).toFixed(1));
  }

  // 2. 中文或英文单位格式 (如 1小时2分5秒, 1分5秒, 1分05秒, 1分半, 2分钟, 1m15s)
  if (/(?:小时|时|分钟|分|m)/i.test(s)) {
    const hMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:小时|时|h)/i);
    const mMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|m)(?!s)/i);
    const sMatch = s.match(/(?:分钟|分|m)\s*(?:零|0)?\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?/i) || s.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i);
    const isHalfMin = /(?:分钟|分)\s*半/.test(s);
    if (hMatch || mMatch) {
      const h = hMatch ? parseFloat(hMatch[1]) : 0;
      const m = mMatch ? parseFloat(mMatch[1]) : 0;
      const sec = isHalfMin ? 30 : (sMatch ? parseFloat(sMatch[1]) : 0);
      return Number((h * 3600 + m * 60 + sec).toFixed(1));
    }
  }

  // 3. 纯秒数 (如 65秒, 65.5s, 65)
  const secMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:秒|s)?$/i);
  if (secMatch) {
    return Number(parseFloat(secMatch[1]).toFixed(1));
  }
  return null;
}

export function parseTimeRangeFromText(promptText, defaultClipLenSec = 10) {
  const raw = String(promptText || '').trim();
  if (!raw) return null;
  const norm = normalizeChineseTimeNumbers(raw);

  // 时间表达式原子模式：匹配 01:05 / 1分05秒 / 1分半 / 1m15s / 65秒 / 65
  const timeAtom = '(?:\\d{1,2}\\s*[:：]\\s*\\d{1,2}(?:\\s*[:：]\\s*\\d{1,2}(?:\\.\\d+)?)?|\\d+(?:\\.\\d+)?\\s*(?:小时|时|h)\\s*(?:\\d+(?:\\.\\d+)?\\s*(?:分钟|分|m)\\s*)?(?:\\d+(?:\\.\\d+)?\\s*(?:秒|s)?)?|\\d+(?:\\.\\d+)?\\s*(?:分钟|分|m)\\s*(?:半|(?:零)?\\s*\\d+(?:\\.\\d+)?\\s*(?:秒|s)?)?|\\d+(?:\\.\\d+)?\\s*(?:秒|s)?)';

  // 1. 范围模式：从/第 X (开始/起) 到/至/~/- 第 Y
  const rangeRegex = new RegExp(`(?:从|取|只要|下载|截取|剪辑|剪)?\\s*(?:第)?\\s*(${timeAtom})\\s*(?:开始|起)?\\s*(?:到|至|~|～|-|—|–|到第|至第)\\s*(?:第)?\\s*(${timeAtom})`, 'i');
  const rangeMatch = norm.match(rangeRegex);
  if (rangeMatch) {
    const rawStart = rangeMatch[1].trim();
    const rawEnd = rangeMatch[2].trim();
    // 要求至少一端带有明确时间单位（分/秒/:/m/s）或上下文含时间词，避免把“16:9”误判为时间
    const isAspect = /^16\s*[:：]\s*9$|^9\s*[:：]\s*16$|^4\s*[:：]\s*3$/.test(rawStart) || /^16\s*[:：]\s*9$|^9\s*[:：]\s*16$|^4\s*[:：]\s*3$/.test(rawEnd);
    const hasTimeHint = /(?:分|秒|[:：]|m|s|下载|截取|剪|片段)/i.test(norm);
    if (!isAspect && hasTimeHint) {
      let startSec = parseSingleTimePointHelper(rawStart);
      let endSec = parseSingleTimePointHelper(rawEnd);
      // 口语习惯修正：如“1分5秒到15秒”，自动补齐同分钟 1分15秒 (75s)
      if (startSec !== null && endSec !== null) {
        const startHasMin = /(?:分钟|分|[:：]|m)/i.test(rawStart);
        const endHasMin = /(?:分钟|分|[:：]|m)/i.test(rawEnd);
        if (startHasMin && !endHasMin && startSec >= 60 && endSec < 60 && (Math.floor(startSec / 60) * 60 + endSec) > startSec) {
          endSec = Number((Math.floor(startSec / 60) * 60 + endSec).toFixed(1));
        }
        if (endSec > startSec) {
          return {
            startSec: Math.max(0, Number(startSec.toFixed(1))),
            endSec: Number(endSec.toFixed(1)),
          };
        }
      }
    }
  }

  // 2. 起点 + 持续时长模式：如“从1分5秒开始截取10秒” / “第65秒起剪8秒”（必须有分隔动作词，防止“第13秒”被拆成“第1 + 3秒”）
  const startDurRegex = new RegExp(`(?:从|第)\\s*(${timeAtom})\\s*(?:(?:开始|起)\\s*(?:截取|剪辑|剪|下载|持续|取)?|(?:截取|剪辑|剪|下载|持续|取))\\s*(\\d+(?:\\.\\d+)?)\\s*(?:秒|s)`, 'i');
  const startDurMatch = norm.match(startDurRegex);
  if (startDurMatch) {
    const startSec = parseSingleTimePointHelper(startDurMatch[1]);
    const durSec = parseFloat(startDurMatch[2]);
    if (startSec !== null && durSec > 0) {
      return {
        startSec: Math.max(0, Number(startSec.toFixed(1))),
        endSec: Number((startSec + durSec).toFixed(1)),
      };
    }
  }

  // 3. “前 X 秒” / “取前 X 秒”
  const headMatch = norm.match(/(?:取|只要|下载|截取)?\s*前\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/i);
  if (headMatch) {
    const dur = parseFloat(headMatch[1]);
    if (dur > 0) {
      return { startSec: 0, endSec: Number(dur.toFixed(1)) };
    }
  }

  return null;
}

export function parseSingleTimePointHelper(token) {
  return parseSingleTimeTokenSec(token);
}

export function formatSecToMMSS(sec) {
  const num = Math.max(0, Number(sec || 0));
  const totalInt = Math.floor(num);
  const frac = Number((num - totalInt).toFixed(1));
  const h = Math.floor(totalInt / 3600);
  const m = Math.floor((totalInt % 3600) / 60);
  const s = totalInt % 60;
  const sStr = String(s).padStart(2, '0') + (frac > 0 ? `.${Math.round(frac * 10)}` : '');
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sStr}`;
  }
  return `${String(m).padStart(2, '0')}:${sStr}`;
}

export function formatSecToFileTag(sec) {
  const num = Math.max(0, Number(sec || 0));
  const totalInt = Math.floor(num);
  const m = Math.floor(totalInt / 60);
  const s = totalInt % 60;
  return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
}

// 自动扫描并同步当前工程专属 public/assets 目录下的本地视频/图片素材到 asset-index.json

export function parsePromptWithRules(prompt, hasAsset, assetType, sourceMode = 'manual_upload') {
  const p = (prompt || '').trim();
  const parsedRange = parseTimeRangeFromText(p);

  // 1. 判断是否需要切换为程序化场景（表格/图表/流程图/对比）— 仅在非 manual_upload 模式下允许自动切换
  const isTableOrData = /数据|表格|分析|占比|指标|统计|金额|增长/.test(p);
  const isFlowOrTimeline = /流程|步骤|时间线|演进|脉络|先.*后|第一.*第二/.test(p);
  const isVersus = /对比|对决|pk|差异|优缺点|双方/.test(p);
  const isKinetic = /快闪|冲击|标语|口号/.test(p);

  if (sourceMode !== 'manual_upload' && !parsedRange && (!hasAsset || (!p.includes('剪') && !p.includes('秒') && !p.includes('分') && !p.includes('放') && !p.includes('亮') && (isTableOrData || isFlowOrTimeline || isVersus || isKinetic)))) {
    if (isFlowOrTimeline) {
      return {
        action: 'switch_procedural',
        scene_type: 'timeline',
        procedural_props: {
          badge_label: '流程演进',
          headline: p.slice(0, 18),
          subheadline: '系统自动化关键环节解析',
          items: ['初始阶段：约束建立', '推进阶段：机制执行', '闭环阶段：成果沉淀'],
        },
      };
    }
    if (isVersus) {
      return {
        action: 'switch_procedural',
        scene_type: 'versus_dual',
        procedural_props: {
          badge_label: '维度对比',
          headline: p.slice(0, 18),
          subheadline: '核心指标对决',
          items: ['方案 A / 传统惯性模式', '方案 B / 现代自适应范式'],
        },
      };
    }
    if (isTableOrData) {
      return {
        action: 'switch_procedural',
        scene_type: 'data_card',
        procedural_props: {
          badge_label: '数据看板',
          headline: p.slice(0, 18),
          subheadline: '关键指标量化统计',
          items: ['核心指标 01：大幅提升', '核心指标 02：降本增效', '综合评级：深度达标'],
        },
      };
    }
    if (isKinetic) {
      return {
        action: 'switch_procedural',
        scene_type: 'kinetic_text',
        procedural_props: {
          badge_label: '重点强调',
          headline: p.slice(0, 16),
          subheadline: '核心逻辑透传',
          items: [p.slice(0, 20)],
        },
      };
    }
  }

  // 2. 视频裁剪与远程下载片段区间 (如 "第1分5秒到1分15秒", "01:05~01:15", "8-15秒", "从第5秒开始剪3秒")
  let trim_start_sec = parsedRange ? parsedRange.startSec : undefined;
  let trim_end_sec = parsedRange ? parsedRange.endSec : undefined;

  // 3. 滤镜提取 (如 "变亮一点", "对比度高", "复古", "黑白")
  const filters = {};
  if (p.includes('亮') || p.includes('明亮') || p.includes('曝光')) {
    filters.brightness = 1.25;
  } else if (p.includes('暗') || p.includes('压暗')) {
    filters.brightness = 0.85;
  }
  if (p.includes('对比')) {
    filters.contrast = 1.2;
  }
  if (p.includes('复古') || p.includes('胶片')) {
    filters.sepia = 0.35;
    filters.contrast = 1.1;
  }
  if (p.includes('黑白')) {
    filters.grayscale = 1.0;
  }

  // 4. 图片运镜提取 (如 "缓慢放大", "持续3秒", "向左平移")
  let motion = undefined;
  if (assetType === 'image' || p.includes('放大') || p.includes('缩小') || p.includes('平移') || p.includes('推')) {
    let duration_sec = 3.0;
    const durMatch = p.match(/持续\s*(\d+(?:\.\d+)?)\s*秒/);
    if (durMatch) duration_sec = parseFloat(durMatch[1]);

    if (p.includes('缩小') || p.includes('拉远')) {
      motion = { motion_type: 'zoom_out', duration_sec, scale_from: 1.15, scale_to: 1.0 };
    } else if (p.includes('左')) {
      motion = { motion_type: 'pan_left', duration_sec, translate_x_px: -50 };
    } else if (p.includes('右')) {
      motion = { motion_type: 'pan_right', duration_sec, translate_x_px: 50 };
    } else {
      motion = { motion_type: 'zoom_in', duration_sec, scale_from: 1.0, scale_to: 1.18 };
    }
  }

  // 5. 艺术字/弹跳文字提取 (如 “为什么会这样呢” 从左面弹出 / 飘出艺术字)
  const text_overlays = [];
  const quoteMatch = p.match(/["“'‘]([^"”'’]+)["”'’]/) || p.match(/["“'‘]([^"”'’\n，,！!。]+)/);
  const shockMatch = /震惊|惊讶|弹|突出|标语|警告/.test(p);
  const hasTextIntent = quoteMatch || shockMatch || /艺术字|大字|标语|字幕|文字|弹出|飘出|滑入/.test(p);

  if (hasTextIntent) {
    let textContent = quoteMatch ? quoteMatch[1] : '';
    if (!textContent) {
      const artMatch = p.match(/(?:艺术字|大字|标语|文字)(?:“|”|"|'|「|【)?([^，,！!。\n]+?)(?:”|"|'|」|】|从|$)/);
      if (artMatch) textContent = artMatch[1];
    }
    if (!textContent) {
      textContent = p.replace(/^.*?(?:艺术字|大字|标语|弹出|飘出|滑入)/, '').split(/[,，！!]/)[0].slice(0, 20);
    }
    textContent = textContent.replace(/["“”'‘’「」【】]/g, '').trim();

    if (textContent) {
      let animation = 'pop_bounce';
      if (p.includes('左') || p.includes('滑入') || p.includes('飘出')) animation = 'slide_from_left';
      if (p.includes('震') || p.includes('惊')) animation = 'shock_shake';

      text_overlays.push({
        text: textContent,
        style: shockMatch ? 'dramatic_shock' : 'neon_glow',
        animation,
        position: animation === 'slide_from_left' ? 'center_left' : 'center',
        start_frame: 10,
        duration_frames: 90,
      });
    }
  }

  return {
    action: 'media_modifiers',
    media_modifiers: {
      trim_start_sec: trim_start_sec !== undefined ? trim_start_sec : undefined,
      trim_end_sec: trim_end_sec !== undefined ? trim_end_sec : undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      motion,
      text_overlays: text_overlays.length > 0 ? text_overlays : undefined,
    },
  };
}

// 🪐 大模型 API 智能 Remotion 动效与剪辑编译器
export async function callLlmRemotionCompiler(userPrompt, scene, hasAsset, assetType, modelConfig = {}, projectDir = '') {
  const p = (userPrompt || '').trim();
  const detRange = parseTimeRangeFromText(p);
  const apiKey = (modelConfig.apiKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  const baseUrl = (modelConfig.baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  const model = (modelConfig.textModel || modelConfig.model || 'deepseek/deepseek-chat').trim();
  const durationSec = Number((scene.duration_ms / 1000).toFixed(1));

  const systemPrompt = renderProducerPrompt(projectDir, 'P5_clip_compiler');

  const userContext = `【分镜序号】：${scene.scene_id}
【解说台词】：${scene.narration_text || ''}
【分镜时长】：${durationSec}秒
【素材状态】：${hasAsset ? (assetType === 'image' ? '当前已绑定图片（支持运镜推拉平移、滤镜调色、艺术字动效）' : '当前已绑定本地短视频（支持基于本段短视频加字幕/艺术字、变速播放、视频调色、二次微调截取，或指定新的原片下载区间）') : '尚未绑定本地视频（用户可预先指定要从网络视频下载第几分几秒到第几分几秒，以及叠加滤镜/字幕动效）'}
${detRange ? `【系统已精准识别出的时间段】：起始 ${detRange.startSec}秒 (${formatSecToMMSS(detRange.startSec)}) ~ 结束 ${detRange.endSec}秒 (${formatSecToMMSS(detRange.endSec)})` : ''}
【用户口语指令】："${p}"
请以视听导演的角度，首先用人话回答用户你将如何执行片段跳转下载或剪辑调节（写入 ai_speech_reply），然后输出广义调节参数：`;

  if (apiKey) {
    try {
      let sendModel = model;
      if (baseUrl.includes('googleapis.com')) {
        sendModel = sendModel.replace(/^google\//, '');
        if (sendModel.includes('deepseek') || sendModel.includes('2.5')) sendModel = 'gemini-flash-lite-latest';
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio',
        },
        body: JSON.stringify({
          model: sendModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContext },
          ],
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const curSourceMode = scene?.source_mode || 'manual_upload';
          if ((detRange || curSourceMode === 'manual_upload') && parsed.action !== 'media_modifiers') {
            parsed.action = 'media_modifiers';
            parsed.media_modifiers = parsed.media_modifiers || {};
          }
          if (parsed.media_modifiers) {
            const m = parsed.media_modifiers;
            if (m.timeline) {
              if (m.timeline.trim_start_sec !== undefined) m.trim_start_sec = m.timeline.trim_start_sec;
              if (m.timeline.trim_end_sec !== undefined) m.trim_end_sec = m.timeline.trim_end_sec;
              if (m.timeline.playback_rate !== undefined) m.playback_rate = m.timeline.playback_rate;
            }
            if (detRange) {
              m.trim_start_sec = detRange.startSec;
              m.trim_end_sec = detRange.endSec;
            }
            if (m.visual_tone) {
              m.filters = { ...(m.filters || {}), ...m.visual_tone };
            }
            if (m.camera_motion) {
              m.motion = { ...(m.motion || {}), ...m.camera_motion };
            }
            if (m.text_and_overlays) {
              m.text_overlays = m.text_and_overlays;
            }
            if (Array.isArray(m.text_overlays)) {
              m.text_overlays = m.text_overlays.map((ov) => ({
                ...ov,
                start_frame: ov.start_frame !== undefined ? ov.start_frame : Math.max(0, Math.round(Number(ov.start_sec || 0) * 30)),
                duration_frames: ov.duration_frames !== undefined ? ov.duration_frames : Math.max(15, Math.round(Number(ov.duration_sec || 3) * 30)),
              }));
            }
          }
          return {
            ...parsed,
            ai_speech_reply: parsed.ai_speech_reply || `已为你理解口语指令「${p.slice(0, 16)}...」并完成视听代码编译。`,
            isAi: true,
            modelUsed: sendModel,
          };
        }
      }
    } catch (e) {
      console.warn('[AI Remotion Compiler Error]:', e.message);
    }
  }

  // 本地通用降级解析（无网络/离线时的稳健保障）
  const fallback = parsePromptWithRules(p, hasAsset, assetType, scene?.source_mode || 'manual_upload');
  const fallbackReply = detRange
    ? `好的！已将你的口令「${p}」转化为片段截取指令：${formatSecToMMSS(detRange.startSec)} (${detRange.startSec}s) ~ ${formatSecToMMSS(detRange.endSec)} (${detRange.endSec}s)，共 ${(detRange.endSec - detRange.startSec).toFixed(1)} 秒。现在填入视频 URL 点击「⬇️ 下载」即可只下载该片段！`
    : `已根据你的指令「${p}」调节了视频画面与剪辑参数。`;
  return {
    ...fallback,
    ai_speech_reply: fallbackReply,
    isAi: false,
    modelUsed: '本地解析引擎',
  };
}

export function renderRemotionStill(projectId, sceneId) {
  const curPaths = getPaths(projectId);
  if (!fs.existsSync(curPaths.manifestPath)) return null;
  const mf = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
  const scene = (mf.scenes || []).find((s) => s.scene_id === sceneId);
  if (!scene) return null;

  const frame = Math.round((scene.start_ms / 1000) * 30) + 15;
  const outDir = path.join(curPaths.publicDir, 'assets', 'generated');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFileName = `${sceneId.toLowerCase()}_still.jpg`;
  const outPath = path.join(outDir, outFileName);
  const relPath = `assets/generated/${outFileName}`;

  if (fs.existsSync(outPath)) {
    try { fs.unlinkSync(outPath); } catch (e) {}
  }

  try {
    const localBin = path.join(rootDir, 'node_modules/.bin/remotion');
    const isLocal = fs.existsSync(localBin);
    const cmd = isLocal ? localBin : 'npx';
    const args = isLocal
      ? [
          'still',
          'packages/video-template/src/index.ts',
          'WhyExplainerFinal',
          outPath,
          `--frame=${frame}`,
          `--props=${curPaths.propsPath}`,
          `--public-dir=${curPaths.publicDir}`,
          '--image-format=jpeg',
          '--jpeg-quality=85',
          '--log=warn',
        ]
      : [
          'remotion',
          'still',
          'packages/video-template/src/index.ts',
          'WhyExplainerFinal',
          outPath,
          `--frame=${frame}`,
          `--props=${curPaths.propsPath}`,
          `--public-dir=${curPaths.publicDir}`,
          '--image-format=jpeg',
          '--jpeg-quality=85',
          '--log=warn',
        ];

    const res = spawnSync(cmd, args, { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
    if (res.status === 0 && fs.existsSync(outPath)) {
      return relPath;
    }
    console.error(`Remotion still failed for ${sceneId} (exitCode: ${res.status}):`, res.stderr || res.stdout);
    if (fs.existsSync(outPath)) {
      return relPath;
    }
  } catch (err) {
    console.error(`Remotion still spawn exception for ${sceneId}:`, err);
  }
  return null;
}
