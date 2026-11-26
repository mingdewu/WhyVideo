import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../packages/qc-tools/ui-server/public/js/publish-studio.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function buildYoutubeDescription('), source.indexOf('function refreshYoutubeBundleSummary('));
const context = vm.createContext({ TextEncoder });
vm.runInContext(helper, context);
const build = context.buildYoutubeDescription;

test('generated multilingual keywords become visible hashtags without altering the description', () => {
  assert.equal(build('原简介', '京都, 寺庙，文化遗产\n#京都'), '原简介\n\n#京都 #寺庙 #文化遗产');
  assert.equal(build('English description', 'cultural heritage, Kinkaku-ji'), 'English description\n\n#culturalheritage #Kinkakuji');
  assert.equal(build('日本語', '金閣寺, 木造建築'), '日本語\n\n#金閣寺 #木造建築');
});
test('existing hashtags remain intact and repeated updates are idempotent', () => {
  const text = 'Description #Kyoto';
  const once = build(text, 'kyoto, Japan, Japan');
  assert.equal(once, 'Description #Kyoto\n\n#Japan');
  assert.equal(build(once, 'kyoto, Japan, Japan'), once);
});
test('hashtag count and byte limits preserve the original description', () => {
  assert.equal((build('', Array.from({length: 25}, (_, i) => 'tag' + i)).match(/#/g) || []).length, 15);
  const original = '京'.repeat(1666);
  assert.equal(build(original, 'Japan'), original);
});
