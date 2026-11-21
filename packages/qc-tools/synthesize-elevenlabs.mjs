import fs from 'node:fs';
import path from 'node:path';

// 优先从环境变量或 .env 读取
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
}
loadEnv();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// 默认推荐使用 ElevenLabs v4 模型 (支持精细稳定度/相似度参数调节)
const DEFAULT_MODEL = 'eleven_v4';
// 默认推荐沉稳知性纪录片音色 (可在 ElevenLabs 声音库挑选替换)
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

/**
 * 组装 ElevenLabs TTS 请求体（兼容 v3 离散稳定度与 v4 连续参数）
 */
export function buildElevenlabsTtsPayload({
  text,
  modelId = DEFAULT_MODEL,
  stability,
  similarityBoost,
  languageCode,
} = {}) {
  const selectedModel = String(modelId || DEFAULT_MODEL).trim();
  const payload = {
    text: text || '',
    model_id: selectedModel,
  };

  const lang = String(languageCode || '').trim();
  if (lang) {
    payload.language_code = lang;
  }

  const voiceSettings = {};
  if (stability !== undefined && stability !== null && stability !== '') {
    const rawStab = Number(stability);
    if (Number.isFinite(rawStab)) {
      const clamped = Math.max(0, Math.min(1, rawStab));
      if (selectedModel === 'eleven_v3') {
        voiceSettings.stability = clamped < 0.25 ? 0.0 : clamped < 0.75 ? 0.5 : 1.0;
      } else {
        voiceSettings.stability = Math.round(clamped * 100) / 100;
      }
    }
  }

  if (similarityBoost !== undefined && similarityBoost !== null && similarityBoost !== '') {
    const rawSim = Number(similarityBoost);
    if (Number.isFinite(rawSim)) {
      voiceSettings.similarity_boost = Math.round(Math.max(0, Math.min(1, rawSim)) * 100) / 100;
    }
  }

  if (Object.keys(voiceSettings).length > 0) {
    payload.voice_settings = voiceSettings;
  }

  return payload;
}

/**
 * 调用 ElevenLabs API 生成高质量旁白配音
 */
export async function synthesizeWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL,
  stability,
  similarityBoost,
  languageCode,
  outputPath
}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('未检测到 ELEVENLABS_API_KEY，请在 .env 中设置或通过参数传入');
  }

  console.log(`🎙️ 正在调用 ElevenLabs 语音合成接口 (Voice: ${voiceId}, Model: ${modelId})...`);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify(buildElevenlabsTtsPayload({
      text,
      modelId,
      stability,
      similarityBoost,
      languageCode,
    }))
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API 调用失败 (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ ElevenLabs 高保真配音已成功保存至: ${outputPath}`);
  return outputPath;
}

// 命令行直接测试入口
if (process.argv[1].endsWith('synthesize-elevenlabs.mjs')) {
  const sampleText = '住进传统温泉旅馆，晚餐往往先让人吃惊：桌上摆满十几个小碗、小碟和小火锅。每一份都不多，却像把一顿饭拆成了一场小型展览。';
  const targetOut = 'projects/why_ryokan_small_dishes_001/public/audio/narration.mp3';
  synthesizeWithElevenLabs({ text: sampleText, outputPath: targetOut }).catch(console.error);
}
