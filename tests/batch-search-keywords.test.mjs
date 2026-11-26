import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../packages/qc-tools/ui-server/public/js/producer-keywords.js', import.meta.url), 'utf8');

function setup({ count = 8, failAt = -1, stopAt = -1 } = {}) {
  const scenes = Array.from({ length: count }, (_, i) => ({ scene_id: 'Shot-' + i, narration_text: '旁白' + i }));
  const saved = new Map();
  const modal = [];
  let busy = false;
  let rejected = 0;
  let context;
  context = vm.createContext({
    manifestData: { scenes }, activeProjectId: 'fixture', visualConfig: {},
    encodeURIComponent, console,
    document: { getElementById: () => null },
    showToast() {}, showCompletionModal: data => modal.push(data),
    fetch: async (_url, options) => {
      if (busy) {
        rejected++;
        return { json: async () => ({ ok: false, error: '工程内容已经更新或操作仍在执行' }) };
      }
      busy = true;
      const { sceneId } = JSON.parse(options.body);
      const idx = Number(sceneId.split('-')[1]);
      // Keep the simulated project lock held across an async turn.
      await new Promise(resolve => setImmediate(resolve));
      if (idx === stopAt) await context.batchExtractAllSearchKeywords();
      busy = false;
      if (idx === failAt) return { json: async () => ({ ok: false, error: '模型输出被截断' }) };
      const keyword = '画面搜索词' + idx;
      saved.set(sceneId, keyword);
      return { json: async () => ({ ok: true, keyword }) };
    },
  });
  vm.runInContext(source, context);
  return { context, scenes, saved, modal, rejected: () => rejected };
}

test('batch persists all 135 scenes with the exclusive project write lock', async () => {
  const state = setup({ count: 135 });
  await state.context.batchExtractAllSearchKeywords();
  assert.equal(state.rejected(), 0);
  assert.equal(state.saved.size, 135);
  for (const scene of state.scenes) assert.equal(scene.selected_search_keyword, state.saved.get(scene.scene_id));
  assert.match(state.modal[0].message, /135\/135/);
});

test('batch continues after a failure and reports its actual cause', async () => {
  const state = setup({ failAt: 2 });
  await state.context.batchExtractAllSearchKeywords();
  assert.equal(state.saved.size, 7);
  assert.match(state.modal[0].detail, /Shot-2：模型输出被截断/);
  assert.match(state.modal[0].title, /部分镜头失败/);
});

test('stop finishes the current scene without dispatching the remaining scenes', async () => {
  const state = setup({ stopAt: 1 });
  await state.context.batchExtractAllSearchKeywords();
  assert.equal(state.saved.size, 2);
  assert.equal(state.modal.length, 0);
  assert.equal(vm.runInContext('_batchKeywordRunning', state.context), false);
});
