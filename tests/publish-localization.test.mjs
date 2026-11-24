import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, renderSrt } from '../packages/qc-tools/ui-server/lib/publish-localization.mjs';

test('subtitle parsing preserves timestamps and translated text', () => {
  const input = '1\n00:00:00,100 --> 00:00:02,500\n你好\n\n2\n00:00:02,500 --> 00:00:04,000\n世界';
  const {cues, warnings} = parseSrt(input);
  assert.deepEqual(warnings, []);
  cues[0].text = 'Hello';
  assert.match(renderSrt(cues), /1\n00:00:00,100 --> 00:00:02,500\nHello/);
  assert.equal(parseSrt(renderSrt(cues)).cues.length, 2);
});
test('subtitle checks reject invalid timing and report overlap', () => {
  assert.throws(() => parseSrt('1\n00:00:02,000 --> 00:00:01,000\nHello'), /晚于/);
  assert.throws(() => parseSrt('1\n00:00:00.000 --> 00:00:01.000\nHello'), /格式/);
  const {warnings} = parseSrt('1\n00:00:00,000 --> 00:00:02,000\nA\n\n2\n00:00:01,000 --> 00:00:03,000\nB');
  assert.ok(warnings.some(w => w.includes('重叠')));
});
