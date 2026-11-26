import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../packages/qc-tools/ui-server/public/js/audio-render.js', import.meta.url), 'utf8');
function page(storage = new Map(), fetchImpl) {
  const ids = ['bailianKeyInput','bailianWorkspaceInput','bailianConfigStatus','bailianVoiceSelect','bailianModelSelect','sampleAudioText','audioModal','audioProviderHeaderBadge'];
  const elements = Object.fromEntries(ids.map(id => [id, {value:'',classList:{add(){}}}]));
  elements.bailianModelSelect.value='qwen-audio-3.1-tts-flash';elements.bailianVoiceSelect.value='my-voice';
  const context=vm.createContext({document:{getElementById:id=>elements[id],querySelector:()=>({value:'bailian'})},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},activeProjectId:'fixture',fetch:fetchImpl|| (async()=>({ok:true,json:async()=>({apiKeyConfigured:true,canManage:true,workspaceId:'server-workspace'})})),showToast(){},alert(message){throw Error(message);}});
  context.window=context;vm.runInContext(source,context);
  return {elements,context,run:code=>vm.runInContext(code,context)};
}

test('entered Bailian key survives a page reload and is reused for synthesis',async()=>{
  const storage=new Map();let current=page(storage);
  current.elements.bailianKeyInput.value='fixture-browser-key';current.elements.bailianWorkspaceInput.value='my-workspace';
  current.run('onBailianInputChange()');
  current=page(storage);await current.run('loadBailianConfig()');
  assert.equal(current.elements.bailianKeyInput.value,'fixture-browser-key');
  assert.equal(current.elements.bailianWorkspaceInput.value,'my-workspace');
  const payload=current.run('collectVoiceParamsFromModal()');assert.equal(payload.apiKey,'fixture-browser-key');assert.equal(payload.workspaceId,'my-workspace');
  await current.run('confirmSaveAudioConfig()');
  assert.equal(current.elements.bailianKeyInput.value,'fixture-browser-key');
  assert.equal(storage.get('whyvideo_audio_provider'),'bailian');
});

test('a delayed server configuration does not overwrite an edited workspace',async()=>{
  let finish;const current=page(new Map(),()=>new Promise(resolve=>{finish=resolve;}));
  const pending=current.run('loadBailianConfig()');
  current.elements.bailianWorkspaceInput.value='edited-workspace';current.run('onBailianInputChange()');
  finish({ok:true,json:async()=>({apiKeyConfigured:true,canManage:true,workspaceId:'server-workspace'})});await pending;
  assert.equal(current.elements.bailianWorkspaceInput.value,'edited-workspace');
});

test('server-only credentials remain usable without filling the password field',async()=>{
  const current=page();await current.run('loadBailianConfig()');
  assert.equal(current.elements.bailianKeyInput.value,'');
  assert.match(current.elements.bailianConfigStatus.textContent,/无需重复输入/);
});
