import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateAiBgmPlan} from '../packages/qc-tools/bgm-ai.mjs';
import {buildBgmPlaylist} from '../packages/qc-tools/bgm-manager.mjs';
import {saveProjectProducerPromptPreset, renderProducerPrompt} from '../packages/qc-tools/producer-prompts.mjs';

test('AI listens to music, uses saved instructions, and its order covers the timeline', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bgm-test-'));
  const previousFetch=globalThis.fetch;
  try {
    const pub=path.join(dir,'public'); fs.mkdirSync(pub);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=5','-y',path.join(pub,'one.mp3')]);
    fs.copyFileSync(path.join(pub,'one.mp3'),path.join(pub,'two.mp3'));
    const tracks=['one','two'].map(id=>({track_id:id,title:id,src:id+'.mp3',duration_ms:5000}));
    const saved=saveProjectProducerPromptPreset(dir,'test',{templates:{P6_bgm_director:{raw_template:'自定义的配乐系统提示词必须返回 JSON，请按要求精确选择音乐。'}}});
    assert.equal(saved.ok,true); assert.match(renderProducerPrompt(dir,'P6_bgm_director'),/自定义/);
    let calls=0; let audioCalls=0;
    globalThis.fetch=async (_url,options)=>{
      const request=JSON.parse(options.body); calls++;
      const audio=Array.isArray(request.messages[1].content);
      if(audio){audioCalls++;assert.equal(request.messages[1].content[1].type,'input_audio');assert.ok(request.messages[1].content[1].input_audio.data.length>100);}
      else assert.match(request.messages[0].content,/自定义/);
      const result=audio?{mood:'克制',energy:'low'}:{track_order:['two','one'],segments:[{start_ms:0,end_ms:12000,target_db:-18}],summary:'方案'};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const args={projectDir:dir,publicDir:pub,config:{tracks},manifest:{title:'测试',total_duration_ms:12000,scenes:[{start_ms:0,end_ms:12000,narration_text:'旁白'}]},model:'mock-audio',baseUrl:'https://example.test',apiKey:'test'};
    const plan=await generateAiBgmPlan(args);
    assert.equal(audioCalls,2); assert.equal(calls,3); assert.deepEqual(plan.track_order,['two','one']);
    const clips=buildBgmPlaylist(tracks,plan.segments,12000,30,plan.track_order);
    assert.deepEqual(clips.map(c=>c.track_id),['two','one','two','one']);
    assert.equal(clips[0].start_frame,0);assert.equal(clips.at(-1).end_frame,360);
    for(let i=1;i<clips.length;i++) assert.ok(clips[i].start_frame<clips[i-1].end_frame);
    await generateAiBgmPlan(args); assert.equal(audioCalls,2,'unchanged tracks should reuse audio analysis');
  } finally {globalThis.fetch=previousFetch;fs.rmSync(dir,{recursive:true,force:true});}
});
