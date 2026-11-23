import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import ts from 'typescript';
import { continueMediaModifiers } from '../packages/qc-tools/media-continuity.mjs';
import { ROOT_DIR, getProjectPaths, resolveProject, listProjectIds } from '../packages/qc-tools/project-paths.mjs';
import promptRules from '../packages/qc-tools/ui-server/public/js/shared/prompt-rules.cjs';
import { downloadUrlAsset, getDownloadProgress } from '../packages/qc-tools/ui-server/lib/download-service.mjs';
import { registerProjectAsset } from '../packages/qc-tools/ui-server/lib/media-gateway.mjs';

const publicDir = path.join(ROOT_DIR, 'packages/qc-tools/ui-server/public');
const assembled = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
  .replace(/  <!--PARTIAL:([a-z-]+)-->\n\n/gm, (_, name) =>
    fs.readFileSync(path.join(publicDir, 'partials', name + '.html'), 'utf8'));

test('linked media preserves speed and color, with explicit overrides and scene-local overlays', () => {
  const previous = { duration_in_frames: 90, media_modifiers: {
    playback_rate: 2, trim_start_sec: 1, trim_end_sec: 8,
    filters: { sepia: .5, brightness: 1.2 }, text_overlays: [{ text: 'previous' }],
  }};
  const result = continueMediaModifiers(previous, { media_modifiers: {
    filters: { brightness: .8 }, text_overlays: [{ text: 'current' }],
  }}, 30, 20);
  assert.equal(result.trim_start_sec, 7);
  assert.equal(result.playback_rate, 2);
  assert.deepEqual(result.filters, { sepia: .5, brightness: .8 });
  assert.deepEqual(result.text_overlays, [{ text: 'current' }]);
  assert.equal(result.trim_end_sec, undefined);
  assert.equal(continueMediaModifiers(previous, { media_modifiers: { playback_rate: .5 } }, 30, 20).playback_rate, .5);
  const next = continueMediaModifiers({ duration_in_frames: 30, media_modifiers: result }, {}, 30, 20);
  assert.equal(next.trim_start_sec, 9);
  assert.equal(next.text_overlays, undefined);
  assert.equal(continueMediaModifiers(previous, {}, 30, 6).trim_start_sec, 0);
});

test('server and offline browser use identical visual prompt rules', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(publicDir, 'js/shared/prompt-rules.cjs'), 'utf8'), context);
  for (const mode of ['image', 'video', 'card']) {
    const args = ['沿着盘山公路，游客看到古老建筑。', mode, ['山间建筑'], 'timeline'];
    assert.equal(context.WhyVideoPromptRules.extractLocalSmartPrompt(...args), promptRules.extractLocalSmartPrompt(...args));
  }
});

test('project selection shares paths and rejects traversal; archives are not projects', () => {
  const ids = listProjectIds();
  assert.ok(!ids.some(id => id.startsWith('.')));
  assert.throws(() => getProjectPaths('../outside'));
  if (ids.length) {
    const selected = resolveProject(['--project', ids[0]]);
    assert.equal(selected.propsPath, getProjectPaths(ids[0]).propsPath);
    assert.equal(selected.propsPath, path.join(selected.publicDir, 'render-props.json'));
  }
});

test('download validation returns HTTP-neutral results and progress without invoking CLI', async () => {
  const project = listProjectIds()[0] || 'why_preview';
  const result = await downloadUrlAsset({ projectId: project, url: 'just some text', jobId: 'test-invalid' }, project);
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(getDownloadProgress('test-invalid').done, true);
  assert.equal(getDownloadProgress('test-invalid').percent, 0);
});

test('generated and downloaded asset registration preserves existing records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-assets-'));
  try {
    const assetIndexPath = path.join(dir, 'asset-index.json');
    fs.writeFileSync(assetIndexPath, JSON.stringify({ project_id: 'fixture', assets: [{ asset_id: 'first' }] }));
    registerProjectAsset({ assetIndexPath }, { asset_id: 'second', source_url: 'https://example.org/video' });
    const index = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
    assert.equal(index.project_id, 'fixture');
    assert.deepEqual(index.assets.map(a => a.asset_id), ['first', 'second']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('all frontend scripts initialize in page order and inline buttons retain their functions', () => {
  assert.ok(!assembled.includes('<!--PARTIAL:'));
  for (const id of ['viewProducerContainer', 'viewWriterContainer', 'bgmModal']) {
    assert.ok(assembled.includes(`id="${id}"`), `Missing assembled panel: ${id}`);
  }
  const element = () => ({ addEventListener() {}, classList: { contains: () => true, add() {}, remove() {}, toggle() {} }, style: {}, value: '' });
  const context = vm.createContext({
    console, URL, URLSearchParams, Set, Map, Promise, Date,
    document: { getElementById: element, addEventListener() {}, querySelectorAll: () => [], body: element() },
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '', href: 'http://localhost/' },
    addEventListener() {}, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
    STUDIO_DEFAULT_PROJECT_ID: 'fixture',
    fetch() { throw new Error('Unexpected network call before bootstrap'); },
  });
  context.window = context;
  const scripts = [...assembled.matchAll(/<script src="\/studio\/([^"<>]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 5);
  for (const script of scripts) {
    // Verify initialization wiring without launching background network polling.
    if (script.endsWith('prompt-modals.js')) vm.runInContext('loadProjects = () => new Promise(() => {});', context);
    vm.runInContext(fs.readFileSync(path.join(publicDir, script), 'utf8'), context, { filename: script });
  }
  const calls = new Set();
  for (const match of assembled.matchAll(/\bon(?:click|change|input|drop|dragover|dragleave)="([^"]*)"/g)) {
    const parsed = ts.createSourceFile('handler.js', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const walk = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
      ts.forEachChild(node, walk);
    };
    walk(parsed);
  }
  for (const name of calls) assert.equal(vm.runInContext(`typeof ${name}`, context), 'function', `Missing inline handler: ${name}`);
  vm.runInContext(`manifestData = { scenes: [
    {start_ms:0,end_ms:3000}, {start_ms:3000,end_ms:7000,shared_asset_with_prev:true},
    {start_ms:7000,end_ms:9000,shared_asset_with_prev:true}, {start_ms:9000,end_ms:10000}
  ] };`, context);
  assert.equal(vm.runInContext('getSharedVisualTiming(1).durationMs', context), 9000);
  vm.runInContext('manifestData.scenes[1].shared_asset_with_prev = false;', context);
  assert.equal(vm.runInContext('getSharedVisualTiming(0).durationMs', context), 3000);
  assert.equal(vm.runInContext('getSharedVisualTiming(1).durationMs', context), 6000);
});

test('HTTP entry serves assembled panels, every script and download validation', { timeout: 15000 }, async () => {
  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['packages/qc-tools/ui-server.mjs'], {
    cwd: ROOT_DIR, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('HTTP startup timeout')), 5000);
      child.stdout.on('data', chunk => { if (chunk.toString().includes('http://localhost:')) { clearTimeout(timeout); resolve(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(Error(`HTTP exited: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base + '/?tab=writer');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(!html.includes('<!--PARTIAL:'));
    assert.ok(!html.includes('<!--SERVER_DEFAULT_PROJECT-->'));
    assert.ok(html.includes('id="viewProducerContainer"') && html.includes('id="viewWriterContainer"'));
    for (const [, script] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
      if (!script.startsWith('/studio/')) continue;
      const response = await fetch(base + script);
      assert.equal(response.status, 200, script);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    assert.equal((await fetch(base + '/api/projects')).status, 200);
    const invalid = await fetch(base + '/api/download-url-asset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: listProjectIds()[0] || 'why_preview', url: 'invalid text' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).ok, false);
  } finally {
    child.kill('SIGTERM');
    await exit;
  }
});
