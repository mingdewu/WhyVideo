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
// 默认推荐使用 ElevenLabs 多语言 V2 模型 (中文效果逼真自然)
const DEFAULT_MODEL = 'eleven_multilingual_v2';
// 默认推荐沉稳知性纪录片音色 (可在 ElevenLabs 声音库挑选替换)
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

/**
 * 调用 ElevenLabs API 生成高质量旁白配音
 */
export async function synthesizeWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL,
  outputPath
}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('未检测到 ELEVENLABS_API_KEY，请在 .env 中设置或通过参数传入');
  }

  console.log(`🎙️ 正在调用 ElevenLabs 语音合成接口 (Voice: ${voiceId}, Model: ${modelId})...`);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.65,
        similarity_boost: 0.80,
        style: 0.15,
        use_speaker_boost: true
      }
    })
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
