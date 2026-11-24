import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { getPaths } from '../packages/qc-tools/ui-server/lib/config.mjs';
import { extractJsonFromText, callOpenRouterText } from '../packages/qc-tools/ui-server/lib/llm-gateway.mjs';
import { extractWriterEvidence } from '../packages/qc-tools/ui-server/lib/writer-service.mjs';
import { handleWriterRoutes } from '../packages/qc-tools/ui-server/routes/writer-routes.mjs';

const card = {
  evidence_id: 'old-id', claim_type: 'verified_fact', evidence_summary: '测试事实',
  source_title: '测试来源', source_url: 'https://example.test/source', reliability: 'medium',
};
const options = { model: 'mock', apiKey: 'test', baseUrl: 'https://llm.example.test/v1' };
const brief = { title: '测试选题' };

test('JSON extraction preserves outer arrays and objects with prose, fences and quoted brackets', () => {
  for (const cards of [[card], [card, { ...card, evidence_summary: '包含 [括号]、} 和 "引号" 及 \\ 转义' }]]) {
    for (const text of [JSON.stringify(cards), `提取结果：\n${JSON.stringify(cards)}\n请复核。`, `说明\n\x60\x60\x60JSON\n${JSON.stringify(cards)}\n\x60\x60\x60`]) {
      assert.deepEqual(extractJsonFromText(text), cards);
    }
  }
  assert.deepEqual(extractJsonFromText('结果：{"cards":[],"meta":{"count":0}} 完毕'), { cards: [], meta: { count: 0 } });
  assert.deepEqual(extractJsonFromText('说明 [参考] 然后 [{"a":1}] 完毕'), [{ a: 1 }]);
  assert.equal(extractJsonFromText('[{"a":1},{"a":'), null, 'must not salvage cards from truncated JSON');
  assert.equal(extractJsonFromText('没有 JSON'), null);
  assert.equal(extractJsonFromText(null), null);
});

async function withModelReplies(replies, run) {
  const projectId = `why_test_evidence_${process.pid}_${Date.now()}`;
  const paths = getPaths(projectId);
  const previousFetch = globalThis.fetch;
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(`${paths.dataDir}/prompt-config.json`, JSON.stringify({ tavilyApiKey: 'test' }));
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      if (url === 'https://api.tavily.com/search') {
        return Response.json({ results: [{ title: '测试来源', url: card.source_url, content: '测试事实' }] });
      }
      assert.equal(url, `${options.baseUrl}/chat/completions`);
      requests.push(JSON.parse(init.body));
      assert.ok(replies.length, 'unexpected model retry');
      const reply = replies.shift();
      if (reply.status) return new Response('mock gateway error', { status: reply.status });
      return Response.json({ choices: [{ message: { content: reply.content }, finish_reason: reply.finish_reason || 'stop' }] });
    };
    await run({ projectId, paths, requests });
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(paths.projectDir, { recursive: true, force: true });
    globalThis.__lastWriterLlmError = '';
  }
}

test('evidence extraction accepts prose arrays and common object wrappers', async () => {
  for (const content of [`提取完成：\n${JSON.stringify([card])}`, ...['evidenceCards', 'evidence_cards', 'cards'].map((key) => JSON.stringify({ [key]: [card] }))]) {
    await withModelReplies([{ content }], async ({ projectId, requests }) => {
      const result = await extractWriterEvidence(projectId, {}, brief, '已有资料', options);
      assert.equal(result.evidenceCards.length, 1);
      assert.equal(result.evidenceCards[0].evidence_id, 'EV-001');
      assert.equal(requests.length, 1);
    });
  }
});

test('truncated or malformed output is retried once; unsourced facts remain pending', async () => {
  for (const content of ['[{"evidence_summary":"被截断', '这不是 JSON', JSON.stringify([{ unrelated: true }]), '']) {
    await withModelReplies([{ content }, { content: JSON.stringify([{ ...card, source_url: '' }]) }], async ({ projectId, requests }) => {
      const result = await extractWriterEvidence(projectId, {}, brief, '已有资料', options);
      assert.equal(requests.length, 2);
      assert.match(requests[1].messages[1].content, /上一次返回/);
      assert.equal(result.evidenceCards[0].claim_type, 'unverified_fact');
      assert.equal(result.pendingEvidenceCount, 1);
    });
  }
});

async function extractRoute(projectId, paths) {
  const req = Readable.from([Buffer.from(JSON.stringify({ ...options, brief, materials: '已有资料' }))]);
  req.method = 'POST';
  let result;
  const res = { writeHead(status) { this.status = status; }, end(body) { result = JSON.parse(body); } };
  await handleWriterRoutes(req, res, {
    url: new URL('http://localhost/api/writer/ai/extract-evidence'),
    pathname: '/api/writer/ai/extract-evidence', queryProject: projectId, paths,
  });
  return { status: res.status, body: result };
}

test('button endpoint persists recovered cards and leaves saved cards intact on failure', async () => {
  await withModelReplies([{ content: '错误格式' }, { content: JSON.stringify({ evidence_cards: [card] }) }], async ({ projectId, paths }) => {
    const result = await extractRoute(projectId, paths);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.evidencePath, 'utf8')), result.body.evidenceCards);
  });
  for (const replies of [[{ content: '错误格式' }, { content: '仍然错误' }], [{ content: '[]' }], [{ status: 401 }]]) {
    await withModelReplies(replies, async ({ projectId, paths, requests }) => {
      const saved = JSON.stringify([card]);
      fs.writeFileSync(paths.evidencePath, saved);
      const result = await extractRoute(projectId, paths);
      assert.equal(result.body.ok, false);
      assert.equal(fs.readFileSync(paths.evidencePath, 'utf8'), saved);
      assert.match(result.body.error, requests.length === 2 ? /自动重试/ : result.body.rawAi === '[]' ? /补充/ : /HTTP 401/);
    });
  }
});

test('gateway reports truncated and empty output and reads text content blocks', async () => {
  await withModelReplies([
    { content: '[{"a":', finish_reason: 'length' },
    { content: '' },
    { content: [{ type: 'text', text: JSON.stringify([card]) }] },
  ], async () => {
    await callOpenRouterText('system', 'user', options);
    assert.match(globalThis.__lastWriterLlmError, /截断/);
    await callOpenRouterText('system', 'user', options);
    assert.match(globalThis.__lastWriterLlmError, /空内容/);
    assert.equal(await callOpenRouterText('system', 'user', options), JSON.stringify([card]));
    assert.equal(globalThis.__lastWriterLlmError, '');
  });
});
