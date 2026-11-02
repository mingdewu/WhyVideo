import fs from 'node:fs';
import path from 'node:path';

// 优先从环境变量或 .env 读取
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach((line) => {
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

export const DEFAULT_VOICEBOX_URL = process.env.VOICEBOX_API_URL || 'http://127.0.0.1:17493';

/**
 * 检查 Voicebox 服务健康状态
 */
export async function getVoiceboxHealth(baseUrl = DEFAULT_VOICEBOX_URL) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${normalizedUrl}/health`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Voicebox health 响应异常 (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

/**
 * 获取 Voicebox 声音配置列表 (Voice Profiles)
 */
export async function getVoiceboxProfiles(baseUrl = DEFAULT_VOICEBOX_URL) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${normalizedUrl}/profiles`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`获取 Voicebox 声音列表失败 (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

/**
 * 调用 Voicebox 本地模型生成高质量语音 (WAV)
 */
export async function synthesizeWithVoicebox({
  baseUrl = DEFAULT_VOICEBOX_URL,
  text,
  profileId,
  language = 'zh',
  engine,
  modelSize,
  instruct,
  outputPath,
  maxWaitMs = 180000,
  pollIntervalMs = 1000,
  onProgress,
}) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');

  if (!text || !text.trim()) {
    throw new Error('合成文本不能为空');
  }

  // 1. 若未指定 profileId，自动获取第一个可用的 profile
  let targetProfile = null;
  const profiles = await getVoiceboxProfiles(normalizedUrl);
  if (!profiles || profiles.length === 0) {
    throw new Error('Voicebox 中尚未创建任何音色配置 (Voice Profile)，请先在 Voicebox 中添加音色。');
  }

  if (profileId) {
    targetProfile = profiles.find((p) => p.id === profileId);
    if (!targetProfile) {
      console.warn(`⚠️ 未找到指定的 Profile ID [${profileId}]，将回退至第一个可用配置。`);
      targetProfile = profiles[0];
    }
  } else {
    // 优先选同语言
    targetProfile = profiles.find((p) => p.language === language) || profiles[0];
  }

  const effectiveProfileId = targetProfile.id;
  // 推理引擎选择：若传入则使用传入的，否则如果该 profile 是预设或指定了 default_engine，则使用对应的引擎
  let effectiveEngine = engine;
  if (!effectiveEngine || effectiveEngine === 'auto') {
    effectiveEngine = targetProfile.preset_engine || targetProfile.default_engine || 'qwen';
  }

  console.log(`🎙️ 正在向 Voicebox 本地模型 (${normalizedUrl}) 发起生成请求:`);
  console.log(`   - Profile: ${targetProfile.name} (${effectiveProfileId})`);
  console.log(`   - Engine: ${effectiveEngine}, Language: ${language}`);
  console.log(`   - Text preview: ${text.slice(0, 50)}...`);

  // 2. 发起 POST /generate
  const reqBody = {
    profile_id: effectiveProfileId,
    text: text.trim(),
    language,
    normalize: true,
  };
  if (effectiveEngine) reqBody.engine = effectiveEngine;
  if (modelSize) reqBody.model_size = modelSize;
  if (instruct) reqBody.instruct = instruct;

  const genRes = await fetch(`${normalizedUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });

  if (!genRes.ok) {
    const errText = await genRes.text();
    throw new Error(`Voicebox 任务创建失败 (${genRes.status}): ${errText}`);
  }

  const genData = await genRes.json();
  const generationId = genData.id;
  if (!generationId) {
    throw new Error(`Voicebox 返回缺少 generation_id: ${JSON.stringify(genData)}`);
  }

  console.log(`⏳ 任务已创建 [ID: ${generationId}]，开始轮询推理状态...`);
  if (onProgress) onProgress('generating', generationId);

  // 3. 轮询 GET /history/{generationId}
  const startTime = Date.now();
  let finalStatus = null;
  let finalResult = null;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    let statusRes;
    try {
      statusRes = await fetch(`${normalizedUrl}/history/${generationId}`);
    } catch (e) {
      console.warn(`轮询请求微断: ${e.message}，稍后重试...`);
      continue;
    }

    if (!statusRes.ok) {
      const errTxt = await statusRes.text();
      throw new Error(`查询 Voicebox 任务状态失败 (${statusRes.status}): ${errTxt}`);
    }

    const histData = await statusRes.json();
    finalStatus = histData.status;

    if (finalStatus === 'completed') {
      finalResult = histData;
      break;
    } else if (finalStatus === 'failed') {
      throw new Error(`Voicebox 推理生成失败: ${histData.error || '未知错误'}`);
    } else {
      if (onProgress) onProgress(finalStatus, generationId);
    }
  }

  if (finalStatus !== 'completed') {
    throw new Error(`Voicebox 生成超时 (超过 ${Math.round(maxWaitMs / 1000)} 秒)`);
  }

  console.log(`✅ Voicebox 生成完毕，时长: ${finalResult.duration}s，开始下载音频文件...`);

  // 4. 下载音频 GET /audio/{generationId}
  const audioRes = await fetch(`${normalizedUrl}/audio/${generationId}`);
  if (!audioRes.ok) {
    const errTxt = await audioRes.text();
    throw new Error(`Voicebox 音频下载失败 (${audioRes.status}): ${errTxt}`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (outputPath) {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, buffer);
    console.log(`💾 配音音频已成功保存至: ${outputPath}`);
  }

  return {
    generationId,
    duration: finalResult.duration,
    outputPath,
    buffer,
    engine: finalResult.engine || effectiveEngine,
    profileName: targetProfile.name,
  };
}

// 命令行直接运行测试
if (process.argv[1] && process.argv[1].endsWith('synthesize-voicebox.mjs')) {
  (async () => {
    try {
      const health = await getVoiceboxHealth();
      console.log('✅ Voicebox 服务在线:', health);

      const profiles = await getVoiceboxProfiles();
      console.log(`✅ 找到 ${profiles.length} 个音色配置:`, profiles.map((p) => `${p.name} (${p.id})`));

      const sampleText = '这是来自 WhyVideo 的 Voicebox 本地模型配音模块测试。';
      const targetOut = path.resolve('projects/why_ai_renamed_to_si_001/public/audio/voicebox_test.wav');

      const result = await synthesizeWithVoicebox({
        text: sampleText,
        outputPath: targetOut,
      });
      console.log('🎉 测试完成:', result);
    } catch (err) {
      console.error('❌ 测试出错:', err);
    }
  })();
}
