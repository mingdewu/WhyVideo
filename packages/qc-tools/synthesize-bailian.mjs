import fs from 'node:fs/promises';

export const BAILIAN_MODEL = 'qwen-audio-3.1-tts-flash';
export const BAILIAN_VOICE = 'qwen-audio-3.1-tts-flash-bailian-840695ef93304c9db72783b9a4776e36';

export function bailianBaseUrl(workspaceId = '') {
  const id = String(workspaceId).trim();
  if (id && !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('百炼业务空间 ID 格式无效');
  return id ? `https://${id}.cn-beijing.maas.aliyuncs.com/api/v1` : 'https://dashscope.aliyuncs.com/api/v1';
}

export function validateBailianVoice(modelId = BAILIAN_MODEL, voiceId = BAILIAN_VOICE) {
  if (modelId !== BAILIAN_MODEL || voiceId !== BAILIAN_VOICE) throw new Error('请选择已配置的千问模型和我的中文音色；复刻音色必须与模型匹配');
}

// Official synchronous TTS API: input.text/voice/format/sample_rate -> output.audio.url.
export async function synthesizeWithBailian({text, outputPath, apiKey, workspaceId = '', modelId = BAILIAN_MODEL, voiceId = BAILIAN_VOICE, signal, fetchImpl = fetch}) {
  if (!apiKey) throw new Error('请先配置北京地域的百炼 API Key（DASHSCOPE_API_KEY）');
  validateBailianVoice(modelId, voiceId);
  if (!String(text || '').trim()) throw new Error('请输入配音文本');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  const response = await fetchImpl(bailianBaseUrl(workspaceId) + '/services/audio/tts/SpeechSynthesizer', {
    method: 'POST', headers: {'Content-Type':'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model:modelId, input:{text:String(text), voice:voiceId, format:'wav', sample_rate:24000}}), signal:requestSignal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code) {
    const code = String(data.code || response.status);
    const hint = [401,403].includes(response.status) ? '请检查北京地域密钥、账号权限及音色所属账号' : '请检查模型权限、用量及音色配置后重试';
    throw new Error(`百炼合成失败（${code}）：${hint}`);
  }
  const url = data.output?.audio?.url;
  if (!url || !/^https?:\/\//.test(url)) throw new Error('百炼未返回可下载的音频');
  // Download signed result without forwarding the API credential to the storage host.
  const audio = await fetchImpl(url, {signal:requestSignal});
  if (!audio.ok) throw new Error(`下载百炼音频失败（${audio.status}）`);
  const bytes = Buffer.from(await audio.arrayBuffer());
  if (bytes.length < 44 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE') throw new Error('百炼返回的音频不是有效 WAV');
  signal?.throwIfAborted();
  await fs.writeFile(outputPath, bytes);
  return {outputPath};
}
