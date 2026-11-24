import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchKeyword, callSearchKeywordExtractor } from '../packages/qc-tools/ui-server/lib/media-gateway.mjs';

test('search keywords read values from complete JSON and plain Chinese responses', () => {
  for (const raw of ['{"keyword":"游戏战斗实机"}', '```json\n{"keyword":"游戏战斗实机"}\n```',
    '推荐：{"keyword":"游戏战斗实机"}', '["游戏战斗实机"]', '{"keywords":["游戏战斗实机"]}', '游戏战斗实机']) {
    assert.equal(parseSearchKeyword(raw), '游戏战斗实机');
  }
});

test('malformed responses never turn JSON keys or placeholders into search terms', () => {
  for (const raw of ['{"keyword":', 'keyword', 'keyword":', '{"keyword":"游戏战斗',
    '{"keyword":\n"游戏战斗"', '{"keyword":null}', '{"keyword":"keyword"}',
    '{"keyword":"唯一最佳中文搜索词"}', '[{"keyword":"游戏战斗"}]', '']) {
    assert.throws(() => parseSearchKeyword(raw), /有效中文搜索词/);
  }
});

test('truncated model output fails instead of returning a keyword', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    choices: [{ finish_reason: 'length', message: { content: '{"keyword":' } }],
  }) });
  try {
    await assert.rejects(callSearchKeywordExtractor({ apiKey: 'test' }, '游戏中的战斗'), /截断/);
  } finally { globalThis.fetch = originalFetch; }
});
