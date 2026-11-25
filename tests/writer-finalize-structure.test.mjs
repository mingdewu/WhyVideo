import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { getPaths } from '../packages/qc-tools/ui-server/lib/config.mjs';
import { WRITER_PROMPT_REGISTRY, validateWriterPromptTemplate } from '../packages/qc-tools/writer-prompts.mjs';
import { handleWriterRoutes } from '../packages/qc-tools/ui-server/routes/writer-routes.mjs';

const options = { model: 'mock', apiKey: 'test', baseUrl: 'https://llm.example.test/v1' };

function makeSampleProjectData() {
  const brief = {
    project_id: 'why_test_structure',
    title: '为什么某些城市地铁能保持低故障率？',
    core_question: '这背后有哪些内外部原因？',
    short_answer: '这并非偶然，而是预防性检修体系与信号冗余设计共同作用的结果。',
  };
  const evidenceCards = [
    {
      evidence_id: 'EV-001',
      claim_type: 'verified_fact',
      evidence_summary: '定期夜间检修制度降低了车辆晚点率。',
      source_title: '测试报告',
      source_url: 'https://example.test/ev1',
      reliability: 'high',
    },
  ];
  const outline = {
    project_id: 'why_test_structure',
    title: brief.title,
    approval_status: 'approved',
    opening_hook: {
      opening_question: '为什么同样高密度的地铁网络，有的常年准点，有的却频频晚点？',
      immediate_short_answer: brief.short_answer,
      supporting_evidence_ids: ['EV-001'],
    },
    chapters: [
      {
        chapter_number: 1,
        chapter_title: '夜间窗口期的预防性检修机制',
        sub_question: '夜间停运后到底做了什么？',
        direct_reason_to_title: '因为严格的预防性检修在故障发生前就替换了老化部件。',
        supporting_evidence_ids: ['EV-001'],
      },
      {
        chapter_number: 2,
        chapter_title: '双套信号系统与调度冗余',
        sub_question: '单点故障为什么不会瘫痪全线？',
        direct_reason_to_title: '因为信号冗余和分级降级策略锁住了局部故障的扩散边界。',
        supporting_evidence_ids: ['EV-001'],
      },
    ],
    single_ending_plan: {
      revisit_core_question: '夜间预防性检修压低了故障概率，信号冗余挡住了连锁崩溃。',
      final_takeaway: '高准点率靠的不是运气，而是把维修成本做在前面。',
    },
  };
  const chapters = [
    {
      chapter_number: 1,
      chapter_title: outline.chapters[0].chapter_title,
      full_chapter_narration: '很多乘客以为地铁准点全靠司机开得稳。其实真正决定故障率的，是凌晨停运后的几小时。检修团队会按里程周期提前更换易损部件，而不是等部件彻底坏在正线上才抢修。',
    },
    {
      chapter_number: 2,
      chapter_title: outline.chapters[1].chapter_title,
      full_chapter_narration: '即便提前检修，高强度运营下依然可能遇到传感器报错。这时候，主备两套信号系统会自动切换，调度中心也可以启用折返线隔离受影响区段，避免局部延误演变成全线停摆。',
    },
  ];
  return { brief, evidenceCards, outline, chapters };
}

async function withMockFinalizeProject(replies, run) {
  const projectId = `why_test_finalize_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const paths = getPaths(projectId);
  const previousFetch = globalThis.fetch;
  const sample = makeSampleProjectData();
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.briefPath, JSON.stringify(sample.brief));
  fs.writeFileSync(paths.evidencePath, JSON.stringify(sample.evidenceCards));
  fs.writeFileSync(paths.outlinePath, JSON.stringify(sample.outline));
  for (const ch of sample.chapters) {
    fs.writeFileSync(`${paths.dataDir}/chapter_${ch.chapter_number}.json`, JSON.stringify(ch));
  }

  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, `${options.baseUrl}/chat/completions`);
      requests.push(JSON.parse(init.body));
      assert.ok(replies.length > 0, 'unexpected model call');
      const reply = replies.shift();
      return Response.json({
        choices: [{ message: { content: reply.content }, finish_reason: reply.finish_reason || 'stop' }],
      });
    };
    await run({ projectId, paths, requests, sample });
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(paths.projectDir, { recursive: true, force: true });
    globalThis.__lastWriterLlmError = '';
  }
}

async function callFinalizeRoute(projectId, paths, bodyPayload) {
  const req = Readable.from([Buffer.from(JSON.stringify({ ...options, ...bodyPayload }))]);
  req.method = 'POST';
  let result;
  const res = {
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      result = JSON.parse(body);
    },
  };
  await handleWriterRoutes(req, res, {
    url: new URL('http://localhost/api/writer/ai/finalize-script'),
    pathname: '/api/writer/ai/finalize-script',
    queryProject: projectId,
    paths,
  });
  return { status: res.status, body: result };
}

test('WRITER_PROMPT_REGISTRY enforces 总—分—总 structure and prevents standalone disclaimer ending chapters', () => {
  for (const [id, spec] of Object.entries(WRITER_PROMPT_REGISTRY)) {
    const check = validateWriterPromptTemplate(id, spec.raw_template);
    assert.equal(check.ok, true, `${id} should pass template validation: ${check.error || ''}`);
  }
  assert.match(WRITER_PROMPT_REGISTRY.W2_brief.raw_template, /总—分—总/);
  assert.match(WRITER_PROMPT_REGISTRY.W4_outline.raw_template, /总—分—总/);
  assert.match(WRITER_PROMPT_REGISTRY.W4_outline.raw_template, /严禁把最后一章单独水成一整章/);
  assert.match(WRITER_PROMPT_REGISTRY.W5_chapter.raw_template, /总—分—总/);
  assert.match(WRITER_PROMPT_REGISTRY.W5_chapter.raw_template, /克制边界，严禁防御性免责反客为主/);
  assert.match(WRITER_PROMPT_REGISTRY.W6_finalize.raw_template, /总—分—总/);
  assert.match(WRITER_PROMPT_REGISTRY.W6_finalize.raw_template, /300~500/);
});

test('finalize-script happy path uses 16384 max_tokens, does not feed outline blurb as existing ending, and keeps complete opening/ending', async () => {
  const fullOpening =
    '每天早高峰，几百万人挤进地铁车厢，很多人都在心里问过同一个问题：为什么同样高密度的地铁网络，有的城市常年准点，有的却动不动就全线晚点？有人觉得全靠线路新、车厢贵，但事实并不是这样。真正决定地铁稳不稳的，是隐藏在幕后的两道防线：一道是凌晨停运后的预防性检修制度，把故障消灭在发车前；另一道是双套信号与调度冗余，哪怕真遇到突发报错也能把影响锁在局部。下面我们就顺着这两条线索，看看高准点率到底是怎么炼成的。';
  const fullEnding =
    '回头再看开头的问题，高密度地铁为什么能长期保持低故障率，答案其实非常清晰。一方面，它靠凌晨窗口期的预防性检修，按照里程和周期提前换掉老化零件，把故障概率压在日常运营之前；另一方面，当突发报错真的发生时，主备双套信号和分段折返调度又构成了第二道保险，防止单点故障拖垮整条线路。换句话说，稳定的准点率从来不是运气好，也不是只靠某一台新设备，而是把维护成本做在平时、把冗余边界留给意外的系统结果。';

  await withMockFinalizeProject(
    [
      {
        content: JSON.stringify({
          project_id: 'why_test_structure',
          title: '为什么某些城市地铁能保持低故障率？',
          script_segments: {
            opening: fullOpening,
            chapters: [
              { chapter_number: 1, chapter_title: '夜间窗口期的预防性检修机制', narration_text: '第1章正文内容。' },
              { chapter_number: 2, chapter_title: '双套信号系统与调度冗余', narration_text: '第2章正文内容。' },
            ],
            ending: fullEnding,
          },
        }),
      },
    ],
    async ({ projectId, paths, requests, sample }) => {
      const res = await callFinalizeRoute(projectId, paths, {
        outline: sample.outline,
        chapters: sample.chapters,
        evidenceCards: sample.evidenceCards,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.usedFallback, false);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].max_tokens, 16384);
      assert.doesNotMatch(requests[0].messages[1].content, /【现有终局结尾/);
      assert.match(requests[0].messages[1].content, /【结尾提纲参考/);
      assert.equal(res.body.finalScript.script_segments.opening, fullOpening);
      assert.equal(res.body.finalScript.script_segments.ending, fullEnding);
    }
  );
});

test('finalize-script repairs truncated main output via lightweight synthesis call (max_tokens 2500)', async () => {
  const synthOpening =
    '每天早高峰，几百万人涌入地铁站台，大家最怕听到的就是“前方信号故障”。可为什么同样承载巨量客流，有些地铁网络却能多年维持极低故障率？原因并不神秘，而是两套机制共同作用的结果：第一，在每天夜间停运后用预防性检修提前排查替换老化部件；第二，用主备信号冗余和分段调度机制守住故障扩散的边界。接下来，我们就把这两道防线拆开讲清楚。';
  const synthEnding =
    '把全片的两条核心线索合在一起，就能回答为什么有些地铁系统能把故障率压到极低。首先，夜间预防性检修把大量隐患解决在发车之前，从源头上减少了零部件临场罢工的概率；其次，即便高强度运行中难免出现个别报错，双套信号冗余和分区隔离调度也能第一时间兜底，不让局部故障演变成全线瘫痪。可以说，高准点率的本质不是零故障神话，而是事前抢修加事后隔离的双重系统工程。';

  await withMockFinalizeProject(
    [
      { content: '{"script_segments":{"chapters":[{"chapter_number":1', finish_reason: 'length' },
      { content: JSON.stringify({ opening: synthOpening, ending: synthEnding }) },
    ],
    async ({ projectId, paths, requests, sample }) => {
      const res = await callFinalizeRoute(projectId, paths, {
        outline: sample.outline,
        chapters: sample.chapters,
        evidenceCards: sample.evidenceCards,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.usedFallback, true);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].max_tokens, 16384);
      assert.equal(requests[1].max_tokens, 2500);
      assert.equal(res.body.finalScript.script_segments.opening, synthOpening);
      assert.equal(res.body.finalScript.script_segments.ending, synthEnding);
      assert.equal(res.body.finalScript.script_segments.chapters.length, 2);
    }
  );
});

test('finalize-script repairs hollow short ending while preserving valid opening', async () => {
  const validOpening =
    '每天早高峰，几百万人挤进地铁车厢，很多人都在心里问过同一个问题：为什么同样高密度的地铁网络，有的城市常年准点，有的却动不动就全线晚点？其实答案不在新旧车厢，而在于两套底层机制：第一是凌晨停运后的预防性检修，第二是双套信号冗余与分区调度。接下来我们逐层拆解这两道防线。';
  const repairedEnding =
    '把全篇两条原因串起来看，高密度地铁之所以能长期保持低故障率，靠的是事前预防和事中兜底两步配合。第一，夜间窗口期的预防性检修提前换掉老化零件，把大部分隐患挡在发车前；第二，双套信号系统和分段折返调度机制，能在局部传感器出错时迅速隔离风险，防止全线瘫痪。可见，真正撑起高准点率的，是一整套把风险拆散并提前消化的运行体系。';

  await withMockFinalizeProject(
    [
      {
        content: JSON.stringify({
          project_id: 'why_test_structure',
          title: '为什么某些城市地铁能保持低故障率？',
          script_segments: {
            opening: validOpening,
            chapters: [
              { chapter_number: 1, chapter_title: '夜间窗口期的预防性检修机制', narration_text: '第1章正文内容。' },
              { chapter_number: 2, chapter_title: '双套信号系统与调度冗余', narration_text: '第2章正文内容。' },
            ],
            ending: '所以高准点率靠的不是运气，而是把维修做在前面。',
          },
        }),
      },
      {
        content: JSON.stringify({
          opening: '这一段开篇不应该覆盖原本合格的开篇内容，用来验证只替换空虚结尾。',
          ending: repairedEnding,
        }),
      },
    ],
    async ({ projectId, paths, requests, sample }) => {
      const res = await callFinalizeRoute(projectId, paths, {
        outline: sample.outline,
        chapters: sample.chapters,
        evidenceCards: sample.evidenceCards,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.usedFallback, false);
      assert.equal(requests.length, 2);
      assert.equal(requests[1].max_tokens, 2500);
      assert.equal(res.body.finalScript.script_segments.opening, validOpening);
      assert.equal(res.body.finalScript.script_segments.ending, repairedEnding);
    }
  );
});
