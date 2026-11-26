import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthesizeWithBailian, BAILIAN_MODEL, BAILIAN_VOICE, bailianBaseUrl } from '../packages/qc-tools/synthesize-bailian.mjs';
import { runBailianJob } from '../packages/qc-tools/ui-server/lib/jobs-service.mjs';
import { getPaths, voiceJobControllers } from '../packages/qc-tools/ui-server/lib/config.mjs';
import { injectSharedServiceCredentials } from '../packages/qc-tools/ui-server/lib/request-guard.mjs';

function wav() {
  const b=Buffer.alloc(4844); b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(24000,24);
  b.writeUInt32LE(48000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(4800,40); return b;
}
const response = () => new Response(JSON.stringify({output:{audio:{url:'https://audio.example/result.wav'}}}), {headers:{'Content-Type':'application/json'}});

test('Bailian uses the matched cloned voice, Beijing endpoint and downloads without credentials', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bailian-test-')); const calls=[];
  try {
    await synthesizeWithBailian({text:'你好',apiKey:'fixture-secret',workspaceId:'workspace-test',outputPath:path.join(dir,'sample.wav'),fetchImpl:async (url,options)=>{calls.push({url,options});return calls.length===1 ? response() : new Response(wav());}});
    assert.equal(calls[0].url,'https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    assert.deepEqual(JSON.parse(calls[0].options.body),{model:BAILIAN_MODEL,input:{text:'你好',voice:BAILIAN_VOICE,format:'wav',sample_rate:24000}});
    assert.equal(calls[1].options.headers,undefined);
    assert.deepEqual(fs.readFileSync(path.join(dir,'sample.wav')),wav());
    assert.throws(()=>bailianBaseUrl('bad/id'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('invalid model and service errors fail without writing invalid audio or exposing secrets', async () => {
  await assert.rejects(synthesizeWithBailian({text:'你好',apiKey:'x',modelId:'wrong'}),/模型/);
  await assert.rejects(synthesizeWithBailian({text:'你好',apiKey:'secret',fetchImpl:async()=>new Response(JSON.stringify({code:'InvalidApiKey',message:'secret'}),{status:401})}),err=>err.message.includes('InvalidApiKey')&&!err.message.includes('secret'));
  let calls=0;
  await assert.rejects(synthesizeWithBailian({text:'你好',apiKey:'x',fetchImpl:async()=>++calls===1 ? response() : new Response('not audio')}),/有效 WAV/);
});

test('authenticated users receive Bailian credentials rather than ElevenLabs credentials', () => {
  const body={provider:'bailian',apiKey:'untrusted',workspaceId:'other'};
  injectSharedServiceCredentials({user:{role:'member'},method:'POST'},new URL('http://localhost/api/synthesize-voice'),'/api/synthesize-voice',body,{bailianApiKey:'bailian-secret',elevenlabsApiKey:'eleven-secret',bailianWorkspaceId:'workspace'},{creating:false,oauthAdmin:false});
  assert.equal(body.apiKey,'bailian-secret'); assert.equal(body.workspaceId,'workspace');
});

test('long Bailian preview segments and stitches audio, reports progress and clears controller', async () => {
  const projectId='why_bailian_test_'+Date.now(); const paths=getPaths(projectId); const originalFetch=globalThis.fetch;
  let segments=0;
  globalThis.fetch=async(url,options)=>{if(String(url).includes('SpeechSynthesizer')) {assert.ok(JSON.parse(options.body).input.text.length<=500);segments++;return response();}return new Response(wav());};
  try {
    const job={projectId,provider:'bailian',useAsNarration:false};
    await runBailianJob(job,{fullText:'这是长篇旁白测试。'.repeat(100),apiKey:'fixture'});
    assert.equal(job.status,'completed',job.error);assert.ok(segments>1);assert.equal(job.completedChunks,segments);assert.equal(job.percent,100);
    assert.ok(job.audioUrl.includes('cloud_'));assert.equal(voiceJobControllers.has(projectId),false);
    assert.equal(fs.existsSync(path.join(paths.audioDir,'narration.wav')),false);
    assert.ok(job.duration>0);
  } finally {globalThis.fetch=originalFetch;fs.rmSync(paths.projectDir,{recursive:true,force:true});}
});

test('cancellation stops cloud synthesis and cleans temporary segments', async () => {
  const projectId='why_bailian_cancel_'+Date.now(); const paths=getPaths(projectId); const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{voiceJobControllers.get(projectId).abort();throw new Error('abort');};
  try {
    const job={projectId,provider:'bailian'};
    await runBailianJob(job,{fullText:'测试',apiKey:'fixture'});
    assert.equal(job.status,'cancelled');assert.equal(voiceJobControllers.has(projectId),false);
    assert.deepEqual(fs.readdirSync(paths.audioDir),[]);
  } finally {globalThis.fetch=originalFetch;fs.rmSync(paths.projectDir,{recursive:true,force:true});}
});

test('Bailian config is server-only, survives blank saves, and rejects member writes', async () => {
  const {handleAudioRenderRoutes}=await import('../packages/qc-tools/ui-server/routes/audio-render-routes.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bailian-config-'));const previous=process.env.WHYVIDEO_AUTH_DIR;process.env.WHYVIDEO_AUTH_DIR=dir;
  const call=async(method,bodyJson,user)=>{let status,result;await handleAudioRenderRoutes({method,bodyJson,user},{writeHead(code){status=code;},end(data){result=JSON.parse(data);}},{pathname:'/api/bailian/config'});return {status,result};};
  try {
    let r=await call('POST',{apiKey:'fixture-private-key',workspaceId:'workspace-test'},{role:'superuser'});
    assert.equal(r.status,200);assert.equal(r.result.apiKeyConfigured,true);assert.ok(!JSON.stringify(r.result).includes('fixture-private-key'));
    r=await call('POST',{apiKey:'',workspaceId:'workspace-test'},{role:'superuser'});assert.equal(r.result.apiKeyConfigured,true);
    r=await call('POST',{apiKey:'other-key'},{role:'member'});assert.equal(r.status,403);
    r=await call('GET',{}, {role:'member'});assert.equal(r.result.canManage,false);assert.ok(!JSON.stringify(r.result).includes('fixture-private-key'));
  } finally {if(previous===undefined)delete process.env.WHYVIDEO_AUTH_DIR;else process.env.WHYVIDEO_AUTH_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
