import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extractJsonFromText } from './ui-server/lib/llm-gateway.mjs';
import { renderProducerPrompt } from './producer-prompts.mjs';
import { normalizeBgmSegments } from './bgm-manager.mjs';

const execFileAsync = promisify(execFile);

async function callModel({baseUrl, apiKey, model, system, text, audio}) {
  if (!apiKey) throw new Error('请先在 AI 全流程模型配置中填写 API Key。');
  const base = String(baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const google = base.includes('generativelanguage.googleapis.com');
  let url, headers, body;
  if (google) {
    const name = model.replace(/^google\//, '');
    if (!/^gemini-[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Google 网关需要选择支持音频输入的 Gemini 模型。');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`;
    headers = {'Content-Type': 'application/json', 'x-goog-api-key': apiKey};
    body = {systemInstruction:{parts:[{text:system}]}, contents:[{role:'user',parts:[{text}, ...(audio ? [{inlineData:{mimeType:'audio/mpeg',data:audio.toString('base64')}}] : [])]}], generationConfig:{temperature:0.25,maxOutputTokens:4096}};
  } else {
    url = `${base}/chat/completions`;
    headers = {'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`};
    const content = audio ? [{type:'text',text},{type:'input_audio',input_audio:{data:audio.toString('base64'),format:'mp3'}}] : text;
    body = {model,messages:[{role:'system',content:system},{role:'user',content}],temperature:0.25,max_tokens:4096};
  }
  let resp;
  try { resp = await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}); }
  catch (e) { throw new Error(`模型连接失败：${e.name === 'TimeoutError' ? '请求超时' : e.message}`); }
  if (!resp.ok) {
    let detail = ''; try { const j = await resp.json(); detail = String(j.error?.message || '').slice(0,240); } catch {}
    throw new Error(`模型请求失败（HTTP ${resp.status}）：${detail}。请确认模型和网关支持音频输入。`);
  }
  const result = await resp.json();
  const output = google ? result.candidates?.[0]?.content?.parts?.map(p=>p.text || '').join('') : result.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('模型未返回可用结果，请检查是否支持音乐音频理解。');
  return output;
}

async function makeSample(file, durationMs) {
  // Three separated excerpts give the model evidence from the opening, middle and end.
  const seconds = durationMs / 1000;
  const starts = [0, Math.max(0, seconds / 2 - 4), Math.max(0, seconds - 8)];
  const args = ['-v','error'];
  for (const start of starts) args.push('-ss',String(start),'-i',file);
  args.push('-filter_complex','[0:a]atrim=duration=8,asetpts=PTS-STARTPTS[a0];[1:a]atrim=duration=8,asetpts=PTS-STARTPTS[a1];[2:a]atrim=duration=8,asetpts=PTS-STARTPTS[a2];[a0][a1][a2]concat=n=3:v=0:a=1[out]', '-map','[out]','-ac','1','-ar','16000','-codec:a','libmp3lame','-b:a','32k','-f','mp3','pipe:1');
  const {stdout} = await execFileAsync('ffmpeg',args,{encoding:'buffer',maxBuffer:2*1024*1024,timeout:30000});
  return stdout;
}

export async function generateAiBgmPlan({projectDir, publicDir, config, manifest, model, baseUrl, apiKey, onProgress = () => {}}) {
  const tracks = config.tracks.filter(t => t.src && Number(t.duration_ms) > 4000);
  if (!tracks.length) throw new Error('请先上传至少一首可读取时长的音乐。');
  if (!manifest.scenes?.length) throw new Error('请先生成视频镜头和旁白时间轴。');
  const cachePath = path.join(projectDir,'data','bgm-audio-analysis.json');
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(cachePath,'utf8')); } catch {}
  const descriptions = [];
  for (let i=0; i<tracks.length; i++) {
    const tr=tracks[i];
    onProgress(`正在听音乐 ${i+1}/${tracks.length}：${tr.title}`);
    const file=path.resolve(publicDir,tr.src);
    const stat=fs.statSync(file);
    const key=createHash('sha256').update(JSON.stringify([tr.src,stat.size,stat.mtimeMs,model,baseUrl,'sample-v1'])).digest('hex');
    let analysis=cache[key];
    if (!analysis) {
      const audio=await makeSample(file,tr.duration_ms);
      const result=await callModel({baseUrl,apiKey,model,audio,system:'你是纪录片配乐分析师。只依据实际听到的音乐作判断，不确定则明确说明。只输出 JSON。',text:'音频由同一首曲目的开头、中间、结尾各约8秒拼接。请分析声音，而不是猜文件名。返回 JSON 对象：{"mood":"情绪","energy":"low|medium|high","instruments":"主要音色与乐器","rhythm":"节奏和密度","suitable":"适合的叙事场景","cautions":"可能干扰旁白或不确定之处"}。不要猜测曲目的具体背景。'});
      analysis=extractJsonFromText(result);
      if (!analysis || typeof analysis.mood !== 'string' || !['low','medium','high'].includes(analysis.energy)) throw new Error(`音乐《${tr.title}》分析结果无效，请重试或更换音频理解模型。`);
      cache[key]=analysis;
      fs.mkdirSync(path.dirname(cachePath),{recursive:true}); fs.writeFileSync(cachePath,JSON.stringify(cache,null,2));
    }
    descriptions.push({track_id:tr.track_id,title:tr.title,duration_ms:tr.duration_ms,...analysis});
  }
  onProgress('正在根据文案和音乐分析结果编排全片');
  const scenes=manifest.scenes.map(s=>({start_ms:s.start_ms,end_ms:s.end_ms,chapter:s.chapter_ref,narration:String(s.narration_text||'').slice(0,180)}));
  const totalMs=Math.max(Number(manifest.total_duration_ms)||0,Number(scenes.at(-1)?.end_ms)||0);
  const system=renderProducerPrompt(projectDir,'P6_bgm_director',{});
  const prompt=JSON.stringify({title:manifest.title,total_duration_ms:totalMs,scenes,tracks:descriptions});
  const response=await callModel({baseUrl,apiKey,model,system,text:prompt});
  const parsed=extractJsonFromText(response);
  const ids=Array.isArray(parsed?.track_order) ? parsed.track_order.map(x=>typeof x==='string'?x:x?.track_id) : [];
  const byId=new Map(tracks.map(t=>[t.track_id,t]));
  if (!ids.length || ids.some(id=>!byId.has(id)) || (tracks.length>1 && new Set(ids).size<2) || ids.some((id,i)=>i>0 && id===ids[i-1])) throw new Error('AI 返回的选曲顺序无效，请重试；原有配乐没有更改。');
  const segments=normalizeBgmSegments(parsed.segments,totalMs);
  if (!segments.length) throw new Error('AI 未生成有效的情绪分段，请重试；原有配乐没有更改。');
  return {track_order:ids,segments,summary:String(parsed.summary||''),model,analyzed_at:new Date().toISOString(),track_count:tracks.length};
}
