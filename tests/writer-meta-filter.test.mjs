import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { getPaths } from '../packages/qc-tools/ui-server/lib/config.mjs';
import {
  stripEditorialMetaCommentary,
  deduplicateAndCleanScriptSegments,
} from '../packages/qc-tools/ui-server/lib/writer-service.mjs';
import { WRITER_PROMPT_REGISTRY } from '../packages/qc-tools/writer-prompts.mjs';
import { handleWriterRoutes } from '../packages/qc-tools/ui-server/routes/writer-routes.mjs';

test('stripEditorialMetaCommentary removes leaked production/card-library memos while keeping audience caveats', () => {
  const input = [
    '死亡统计能说明什么，生活方式关联能说明什么，公共措施的证据又能说明什么，得分开看。',
    '现有研究还无法把人口长寿归结为单一食物，也不能证明观察性关联就是因果关系。',
    '同样，现有证据卡没有直接给出日本当前预期寿命水平的统计数据，正式制作时还需要补充。',
    '正式制作前，还需要补充当前日本预期寿命、分年龄死亡，以及战后公共卫生改善和医保的原始证据。',
    '等这些资料补上，咱们才能把已经看到的疾病线索、可能的生活方式机制，以及仍待核实的公共条件，放在一起，给出一个不夸大的回答。',
    '筛查能否直接延长寿命，也不能仅凭这张证据卡回答。',
    '这部分历史背景尚待核验原文，待补证。',
  ].join('\n\n');

  const { text, removed } = stripEditorialMetaCommentary(input);

  assert.equal(removed.length, 5);
  assert.match(text, /死亡统计能说明什么，生活方式关联能说明什么，公共措施的证据又能说明什么，得分开看。/);
  assert.match(text, /现有研究还无法把人口长寿归结为单一食物，也不能证明观察性关联就是因果关系。/);
  assert.doesNotMatch(text, /正式制作前|正式制作时|现有证据卡|等这些资料补上|这张证据卡|待核验原文|待补证/);
});

test('deduplicateAndCleanScriptSegments strips leaked meta-commentary across opening, chapters, and ending', () => {
  const script = {
    project_id: 'why_test_meta',
    title: '测试选题',
    script_segments: {
      opening: '人们常以为某种食物就能让人长寿。现有卡库缺少直接的统计学证据，待补证。',
      chapters: [
        {
          chapter_number: 1,
          chapter_title: '第1章: 死亡风险线索',
          narration_text: '预期寿命反映的是整个人口的死亡风险。正式使用这些比较前，还需要核验原始数据。目前研究仍需结合年龄结构来解读。',
        },
      ],
      ending: '总体而言，这并非单一食物的功劳。正式制作前，还需要补充原始证据。等这些资料补上，咱们才能得出更稳妥的结论。',
    },
  };

  const cleaned = deduplicateAndCleanScriptSegments(script);

  assert.equal(cleaned.script_segments.opening, '人们常以为某种食物就能让人长寿。');
  assert.equal(
    cleaned.script_segments.chapters[0].narration_text,
    '预期寿命反映的是整个人口的死亡风险。目前研究仍需结合年龄结构来解读。'
  );
  assert.equal(cleaned.script_segments.ending, '总体而言，这并非单一食物的功劳。');
  assert.equal(cleaned.editorial_changes_log.removed_meta_commentary.length, 4);
  assert.ok(
    cleaned.editorial_changes_log.removed_duplicate_arguments.some((entry) =>
      entry.includes('泄露的制作/考证元话语')
    )
  );
});

test('WRITER_PROMPT_REGISTRY includes anti-meta-commentary rules across brief, outline, chapter, finalize, humanize, and revision', () => {
  for (const templateId of [
    'W2_brief',
    'W4_outline',
    'W5_chapter',
    'W6_finalize',
    'W7_humanize',
    'W10_revision_execute',
  ]) {
    const raw = WRITER_PROMPT_REGISTRY[templateId]?.raw_template || '';
    assert.ok(raw.includes('正式制作前'), `${templateId} should forbid 正式制作前`);
    assert.ok(
      raw.includes('待核验') || raw.includes('待核查') || raw.includes('待补证'),
      `${templateId} should forbid 待核验/待补证 notes`
    );
  }
  assert.match(WRITER_PROMPT_REGISTRY.W7_humanize.raw_template, /等这些资料补上/);
});

test('humanize-script route strips leaked editorial meta-commentary returned by the model', async () => {
  const projectId = `why_test_humanize_meta_${process.pid}_${Date.now()}`;
  const paths = getPaths(projectId);
  const previousFetch = globalThis.fetch;
  fs.mkdirSync(paths.dataDir, { recursive: true });

  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content:
                '死亡统计能说明什么，生活方式关联能说明什么，得分开看。正式制作前，还需要补充原始证据。等这些资料补上，咱们才能给出回答。\n<<<AUDIT>>>{"removed_ai_phrases":[],"split_long_sentences_count":2,"humorous_analogies_count":0,"audit_report":"ok"}',
            },
            finish_reason: 'stop',
          },
        ],
      });

    const req = Readable.from([
      Buffer.from(
        JSON.stringify({
          content: '死亡统计能说明什么，生活方式关联能说明什么，得分开看。',
          style: 'colloquial',
          model: 'mock',
          apiKey: 'test',
          baseUrl: 'https://llm.example.test/v1',
        })
      ),
    ]);
    req.method = 'POST';
    let payload;
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    };

    await handleWriterRoutes(req, res, {
      url: new URL('http://localhost/api/writer/ai/humanize-script'),
      pathname: '/api/writer/ai/humanize-script',
      queryProject: projectId,
      paths,
    });

    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.result.humanized_text, '死亡统计能说明什么，生活方式关联能说明什么，得分开看。');
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(paths.projectDir, { recursive: true, force: true });
  }
});
