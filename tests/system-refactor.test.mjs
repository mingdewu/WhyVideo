import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import ts from 'typescript';
import { continueMediaModifiers } from '../packages/qc-tools/media-continuity.mjs';
import { ROOT_DIR, getProjectPaths, resolveProject, listProjectIds, resolveProjectVideoPath } from '../packages/qc-tools/project-paths.mjs';
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
  assert.equal(getDownloadProgress('test-invalid', project).done, true);
  assert.equal(getDownloadProgress('test-invalid', project).percent, 0);
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
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-http-auth-'));
  const projectDir = fs.mkdtempSync(path.join(ROOT_DIR, 'projects', 'test_http_'));
  const projectId = path.basename(projectDir);
  const { openAccountStore } = await import('../packages/qc-tools/ui-server/lib/account-store.mjs');
  const store = openAccountStore(authDir);
  const user = await store.createUser('test-user', 'test-password-12345');
  store.assignProject(projectId, user.id);
  const cookie = 'whyvideo_session=' + store.createSession(user.id);
  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['packages/qc-tools/ui-server.mjs'], {
    cwd: ROOT_DIR, env: { ...process.env, PORT: String(port), WHYVIDEO_AUTH_DIR: authDir, PROJECT_ID: projectId }, stdio: ['ignore', 'pipe', 'pipe'],
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
    const response = await fetch(base + '/?tab=writer', { headers: { cookie } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(!html.includes('<!--PARTIAL:'));
    assert.ok(!html.includes('<!--SERVER_DEFAULT_PROJECT-->'));
    assert.ok(html.includes('id="viewProducerContainer"') && html.includes('id="viewWriterContainer"'));
    for (const [, script] of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
      if (!script.startsWith('/studio/')) continue;
      const response = await fetch(base + script, { headers: { cookie } });
      assert.equal(response.status, 200, script);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    assert.equal((await fetch(base + '/api/projects', { headers: { cookie } })).status, 200);
    const tab = 'testtab12345678901234567890123456';
    const lease = await fetch(base + '/api/edit/acquire?project=' + projectId, { method: 'POST', headers: { cookie, origin: base, 'X-Edit-Token': tab } });
    const { revision } = await lease.json();
    const invalid = await fetch(base + '/api/download-url-asset', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin: base, 'X-Edit-Token': tab, 'X-Project-Revision': revision },
      body: JSON.stringify({ projectId, url: 'invalid text' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).ok, false);
  } finally {
    child.kill('SIGTERM');
    await exit;
    store.close();
    fs.rmSync(authDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('opt-in CaptionLayer is gated by burn_in_captions and publish-studio SRT upload avoids stale fetch races', async () => {
  const templateSrcDir = path.join(ROOT_DIR, 'packages/video-template/src');
  assert.equal(fs.existsSync(path.join(templateSrcDir, 'CaptionLayer.tsx')), true);
  const compositionSrc = fs.readFileSync(path.join(templateSrcDir, 'WhyExplainerComposition.tsx'), 'utf8');
  assert.match(compositionSrc, /burn_in_captions[\s\S]*CaptionLayer/);

  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        value: '',
        textContent: '',
        src: '',
        files: [],
        dataset: {},
        listeners,
        classList: { add() {}, remove() {}, toggle() {}, contains: () => true },
        addEventListener(type, fn) { listeners[type] = fn; },
      });
    }
    return elements.get(id);
  };

  let resolveFetch;
  const fetchCalls = [];
  const toasts = [];
  const context = vm.createContext({
    console, Promise, URL, Blob, encodeURIComponent,
    activeProjectId: 'proj_a',
    document: { getElementById: getElement },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    showToast: (msg) => toasts.push(msg),
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      if (url.startsWith('/api/') && !url.includes('/api/publish/cover')) return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url.includes('/api/publish/cover')) {
        return Promise.resolve({ ok: true, json: async () => ({ coverUrl: null }) });
      }
      if (url.includes('/api/publish/video')) {
        return Promise.resolve({ ok: true, json: async () => ({ hasVideo: false, videoUrl: null, fileName: null }) });
      }
      if (url.includes('/api/publish/english-dub')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, scriptText: '', audioUrl: null, srtText: '', job: null }) });
      }
      if (url.includes('/api/voicebox/profiles')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, profiles: [] }) });
      }
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });

  vm.runInContext(fs.readFileSync(path.join(publicDir, 'js/publish-studio.js'), 'utf8'), context, {
    filename: 'js/publish-studio.js',
  });

  const captionInput = getElement('publishCaptionFile');
  const captionsArea = getElement('publishCaptions');
  captionInput.value = 'C:\\fakepath\\stale.srt';

  const loadPromise = context.loadPublishProject();
  assert.equal(captionInput.value, '');
  const srtFetch = fetchCalls.find((c) => c.url === '/public/proj_a/captions/captions.srt');
  assert.ok(srtFetch);
  assert.equal(srtFetch.opts?.cache, 'no-store');

  const localSrt = '1\n00:00:00,000 --> 00:00:02,000\n用户上传的本地字幕\n';
  captionInput.files = [{ text: async () => localSrt }];
  await captionInput.listeners.change.call(captionInput);
  assert.equal(captionsArea.value, localSrt);
  assert.ok(toasts.length >= 1);

  resolveFetch({ ok: true, text: async () => '1\n00:00:00,000 --> 00:00:02,000\n旧的工程字幕\n' });
  await loadPromise;
  assert.equal(captionsArea.value, localSrt);
});

test('publish routes and publish-studio generate, persist and resolve AI covers by keywords', async () => {
  const { Readable } = await import('node:stream');
  const { handlePublishRoutes } = await import('../packages/qc-tools/ui-server/routes/publish-routes.mjs');

  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-cover-'));
  const previousFetch = globalThis.fetch;
  try {
    const dataDir = path.join(tmpProj, 'data');
    const publicDirProj = path.join(tmpProj, 'public');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(publicDirProj, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'prompt-config.json'),
      JSON.stringify({
        apiKey: 'test-openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        imageModel: 'black-forest-labs/flux-3-image',
      })
    );

    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let imagePromptSeen = '';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/images');
      const reqBody = JSON.parse(options.body);
      imagePromptSeen = reqBody.prompt;
      assert.equal(reqBody.aspect_ratio, '16:9');
      return new Response(
        JSON.stringify({ data: [{ b64_json: pngBase64, media_type: 'image/png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const callRoute = async (method, pathname, bodyObj = null) => {
      const req = bodyObj
        ? Readable.from([Buffer.from(JSON.stringify(bodyObj))])
        : Readable.from([]);
      req.method = method;
      let resStatus = 0;
      let resBody = '';
      const res = {
        writeHead(status) { resStatus = status; },
        end(chunk) { resBody += chunk || ''; },
      };
      const handled = await handlePublishRoutes(req, res, {
        pathname,
        queryProject: 'demo_cover_proj',
        paths: {
          projectDir: tmpProj,
          dataDir,
          publicDir: publicDirProj,
          promptConfigPath: path.join(dataDir, 'prompt-config.json'),
          finalScriptPath: path.join(dataDir, 'final-script.json'),
        },
      });
      return { handled, status: resStatus, body: JSON.parse(resBody) };
    };

    const postRes = await callRoute('POST', '/api/publish/generate-cover', {
      keywords: '富士山、红叶、震撼特写',
      title: '富士山为什么如此出名',
    });
    assert.equal(postRes.handled, true);
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.ok, true);
    assert.equal(postRes.body.fileName, 'publish-cover.png');
    assert.equal(postRes.body.mimeType, 'image/png');
    assert.match(postRes.body.coverUrl, /^\/public\/demo_cover_proj\/publish-cover\.png\?t=\d+$/);
    assert.match(imagePromptSeen, /富士山、红叶、震撼特写/);
    assert.ok(fs.existsSync(path.join(publicDirProj, 'publish-cover.png')));

    const getRes = await callRoute('GET', '/api/publish/cover');
    assert.equal(getRes.handled, true);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.fileName, 'publish-cover.png');
    assert.match(getRes.body.coverUrl, /^\/public\/demo_cover_proj\/publish-cover\.png\?t=\d+$/);

    const elements = new Map();
    const getElement = (id) => {
      if (!elements.has(id)) {
        const classes = new Set(['hidden']);
        elements.set(id, {
          value: '',
          textContent: '',
          src: '',
          href: '',
          download: '',
          disabled: false,
          files: [],
          dataset: {},
          classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
            contains: (c) => classes.has(c),
          },
          removeAttribute(attr) { delete this[attr]; },
          addEventListener() {},
          focus() {},
        });
      }
      return elements.get(id);
    };

    const vmFetches = [];
    const coverBlob = new Blob([Buffer.from(pngBase64, 'base64')], { type: 'image/png' });
    const context = vm.createContext({
      console, Promise, URL, Blob, encodeURIComponent,
      activeProjectId: 'proj_a',
      document: { getElementById: getElement },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {} },
      showToast() {},
      alert(msg) { throw new Error('Unexpected alert: ' + msg); },
      fetch: async (url, opts) => {
        vmFetches.push({ url, opts });
        if (url.startsWith('/api/publish/generate-cover')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              coverUrl: '/public/proj_a/publish-cover.png?t=123',
              fileName: 'publish-cover.png',
              model: 'black-forest-labs/flux-3-image',
            }),
          };
        }
        if (url === '/public/proj_a/publish-cover.png?t=123') {
          return { ok: true, blob: async () => coverBlob };
        }
        throw new Error('Unexpected fetch: ' + url);
      },
    });

    vm.runInContext(fs.readFileSync(path.join(publicDir, 'js/publish-studio.js'), 'utf8'), context, {
      filename: 'js/publish-studio.js',
    });

    await context.generatePublishCover();
    assert.equal(vmFetches.length, 0);
    assert.match(getElement('publishCoverStatus').textContent, /请先输入封面关键词/);

    getElement('publishCoverKeywords').value = '富士山、红叶';
    getElement('publishTitle').value = '富士山为什么如此出名';
    getElement('publishCover').value = 'C:\\fakepath\\old.jpg';
    await context.generatePublishCover();

    assert.equal(vmFetches.length, 1);
    assert.equal(vmFetches[0].url, '/api/publish/generate-cover?project=proj_a');
    assert.equal(getElement('publishCover').value, '');
    assert.equal(getElement('publishCoverPreview').src, '/public/proj_a/publish-cover.png?t=123');
    assert.equal(getElement('publishCoverPreview').classList.contains('hidden'), false);
    assert.equal(getElement('publishCoverDownload').href, '/public/proj_a/publish-cover.png?t=123');

    const resolvedBlob = await context.resolveSelectedPublishCover();
    assert.equal(resolvedBlob.size, coverBlob.size);
    assert.equal(vmFetches[1].url, '/public/proj_a/publish-cover.png?t=123');
    assert.equal(vmFetches[1].opts?.cache, 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

test('project video path uses project id, resolves fallback files, and publish-studio avoids hardcoded final_video_1080p.mp4', () => {
  const demoPaths = getProjectPaths('demo_video_001');
  assert.equal(demoPaths.videoFileName, 'demo_video_001.mp4');
  assert.equal(demoPaths.videoPath, path.join(ROOT_DIR, 'projects/demo_video_001/output/demo_video_001.mp4'));

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-out-'));
  try {
    const fakePaths = {
      projectId: 'demo_video_001',
      outputDir: tmpOut,
      videoPath: path.join(tmpOut, 'demo_video_001.mp4'),
    };
    assert.equal(resolveProjectVideoPath(fakePaths), null);

    fs.writeFileSync(path.join(tmpOut, 'preview.mp4'), 'preview');
    fs.writeFileSync(path.join(tmpOut, 'demo_video_001_preview.mp4'), 'studio-preview');
    fs.writeFileSync(path.join(tmpOut, '.hidden.mp4'), 'hidden');
    assert.equal(resolveProjectVideoPath(fakePaths), null);

    const customPath = path.join(tmpOut, 'custom_render.mp4');
    fs.writeFileSync(customPath, 'custom');
    assert.equal(resolveProjectVideoPath(fakePaths), customPath);

    const legacyPath = path.join(tmpOut, 'final_video_1080p.mp4');
    fs.writeFileSync(legacyPath, 'legacy');
    assert.equal(resolveProjectVideoPath(fakePaths), legacyPath);

    fs.writeFileSync(fakePaths.videoPath, 'primary');
    assert.equal(resolveProjectVideoPath(fakePaths), fakePaths.videoPath);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  const publishJs = fs.readFileSync(path.join(publicDir, 'js/publish-studio.js'), 'utf8');
  assert.ok(!publishJs.includes('final_video_1080p.mp4'));
  assert.ok(publishJs.includes('/api/publish/video'));
});

test('english dub service splits long text, formats non-overlapping SRT, and publish routes save _en.srt', async () => {
  const { Readable } = await import('node:stream');
  const { splitEnglishTextForTts, buildEnglishSrtFromWords } = await import('../packages/qc-tools/ui-server/lib/english-dub-service.mjs');
  const { handlePublishRoutes } = await import('../packages/qc-tools/ui-server/routes/publish-routes.mjs');
  const { parseSrt } = await import('../packages/qc-tools/ui-server/lib/publish-localization.mjs');

  const longScript = [
    'Why do people in Japan live so long compared to many other countries?',
    'Researchers often look closely at diet, healthcare access, and daily walking habits.',
    'In addition, life expectancy reflects mortality risks across every single age group.',
  ].join(' ');
  const chunks = splitEnglishTextForTts(longScript, 110);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 110));
  assert.equal(chunks.join(' '), longScript);

  const srt = buildEnglishSrtFromWords([
    { w: 'Why', s: 0.0, e: 0.2 },
    { w: 'do', s: 0.21, e: 0.35 },
    { w: 'people', s: 0.36, e: 0.65 },
    { w: 'live', s: 0.66, e: 0.9 },
    { w: 'long?', s: 0.91, e: 1.25 },
    { w: 'Let', s: 1.8, e: 2.0 },
    { w: 'us', s: 2.01, e: 2.2 },
    { w: 'look', s: 2.21, e: 2.45 },
    { w: 'closely', s: 2.46, e: 2.85 },
    { w: 'at', s: 2.86, e: 3.0 },
    { w: 'the', s: 3.01, e: 3.15 },
    { w: 'real', s: 3.16, e: 3.4 },
    { w: 'evidence', s: 3.41, e: 3.85 },
    { w: 'across', s: 3.86, e: 4.2 },
    { w: 'every', s: 4.21, e: 4.5 },
    { w: 'age', s: 4.51, e: 4.8 },
    { w: 'group.', s: 4.81, e: 5.2 },
  ], { maxCharsPerLine: 28, maxLines: 2 });
  const parsed = parseSrt(srt);
  assert.equal(parsed.warnings.length, 0);
  assert.ok(parsed.cues.length >= 2);
  assert.match(parsed.cues[0].text, /Why do people live long\?/);

  const jaSrt = buildEnglishSrtFromWords([
    { w: 'なぜ', s: 0.0, e: 0.3 },
    { w: '日本人は', s: 0.31, e: 0.8 },
    { w: '長生きなのか？', s: 0.81, e: 1.4 },
    { w: 'データの', s: 2.0, e: 2.4 },
    { w: '裏側を', s: 2.41, e: 2.8 },
    { w: '見てみよう。', s: 2.81, e: 3.4 },
  ], { lang: 'ja' });
  const parsedJa = parseSrt(jaSrt);
  assert.equal(parsedJa.warnings.length, 0);
  assert.equal(parsedJa.cues[0].text, 'なぜ日本人は長生きなのか？');

  const publishHtml = fs.readFileSync(path.join(publicDir, 'partials/publish-panel.html'), 'utf8');
  assert.equal(publishHtml.includes('localizationPanel'), false);
  assert.equal(publishHtml.includes('englishDubPanel'), false);
  for (const id of ['publishLangTabZh', 'publishLangTabEn', 'publishLangTabJa', 'publishTranslateToEnBtn', 'publishTranslateToJaBtn', 'publishForeignDubBox']) {
    assert.ok(publishHtml.includes(`id="${id}"`), `Missing publish UI element: ${id}`);
  }
  assert.ok(publishHtml.indexOf('id="publishVideo"') < publishHtml.indexOf('id="youtubeUploadButton"'));
  assert.ok(publishHtml.indexOf('id="youtubeUploadButton"') < publishHtml.indexOf('id="publishCover"'));
  assert.ok(publishHtml.indexOf('id="publishCover"') < publishHtml.indexOf('id="publishTitle"'));
  assert.ok(publishHtml.indexOf('id="publishTitle"') < publishHtml.indexOf('id="publishCaptions"'));

  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-endub-'));
  try {
    const dataDir = path.join(tmpProj, 'data');
    const outputDir = path.join(tmpProj, 'output');
    const publicDirProj = path.join(tmpProj, 'public');
    fs.mkdirSync(dataDir, { recursive: true });

    const callRoute = async (method, pathname, bodyObj = null, queryStr = '') => {
      const req = bodyObj
        ? Readable.from([Buffer.from(JSON.stringify(bodyObj))])
        : Readable.from([]);
      req.method = method;
      let resStatus = 0;
      let resBody = '';
      const res = {
        writeHead(status) { resStatus = status; },
        end(chunk) { resBody += chunk || ''; },
      };
      const url = new URL('http://localhost' + pathname + (queryStr ? ('?' + queryStr) : ''));
      const handled = await handlePublishRoutes(req, res, {
        url,
        pathname,
        queryProject: 'demo_en_proj',
        paths: {
          projectDir: tmpProj,
          dataDir,
          outputDir,
          publicDir: publicDirProj,
          promptConfigPath: path.join(dataDir, 'prompt-config.json'),
          finalScriptPath: path.join(dataDir, 'final-script.json'),
        },
      });
      return { handled, status: resStatus, body: JSON.parse(resBody) };
    };

    const saveRes = await callRoute('POST', '/api/publish/english-dub/save-srt', { srt });
    assert.equal(saveRes.handled, true);
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.fileName, 'demo_en_proj_en.srt');
    assert.ok(fs.existsSync(path.join(outputDir, 'demo_en_proj_en.srt')));

    const saveJaRes = await callRoute('POST', '/api/publish/english-dub/save-srt', { lang: 'ja', srt: jaSrt });
    assert.equal(saveJaRes.status, 200);
    assert.equal(saveJaRes.body.fileName, 'demo_en_proj_ja.srt');
    assert.ok(fs.existsSync(path.join(outputDir, 'demo_en_proj_ja.srt')));

    const copyPostRes = await callRoute('POST', '/api/publish/copy', {
      lang: 'en',
      title: 'Why Do Japanese People Live So Long?',
      description: 'Deep dive into life expectancy data.',
      tags: 'Japan, Longevity, Health',
      coverKeywords: 'Japan longevity chart',
    });
    assert.equal(copyPostRes.status, 200);
    assert.equal(copyPostRes.body.copy.en.title, 'Why Do Japanese People Live So Long?');

    const getRes = await callRoute('GET', '/api/publish/english-dub');
    assert.equal(getRes.handled, true);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.srtFileName, 'demo_en_proj_en.srt');
    assert.equal(getRes.body.srtText, srt);
    assert.equal(getRes.body.copy.en.title, 'Why Do Japanese People Live So Long?');

    const getJaRes = await callRoute('GET', '/api/publish/english-dub', null, 'lang=ja');
    assert.equal(getJaRes.status, 200);
    assert.equal(getJaRes.body.srtFileName, 'demo_en_proj_ja.srt');
    assert.equal(getJaRes.body.srtText, jaSrt);
  } finally {
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }

  assert.ok(publishHtml.includes('id="youtubeMultiLangSummary"'));
  assert.ok(publishHtml.includes('id="youtubeStudioLanguagesLink"'));

  const publishJsSrc = fs.readFileSync(path.join(publicDir, 'js/publish-studio.js'), 'utf8');
  assert.ok(publishJsSrc.includes('part=localizations'));

  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'youtubeSourceLanguage' || id === 'youtubeCaptionLanguage' ? 'zh-Hans' : '',
        textContent: '',
        innerHTML: '',
        src: '',
        href: '',
        download: '',
        disabled: false,
        files: [],
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => true },
        removeAttribute(attr) { delete this[attr]; },
        addEventListener() {},
      });
    }
    return elements.get(id);
  };
  const langCtx = vm.createContext({
    console, Promise, URL, Blob, encodeURIComponent,
    activeProjectId: 'proj_multi',
    document: { getElementById: getElement },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1,
    clearInterval() {},
    showToast() {},
    fetch: async (url) => {
      if (url.includes('/api/publish/english-dub')) return { ok: true, json: async () => ({ ok: true, scriptText: '', audioUrl: null, srtText: '', job: null }) };
      if (url.includes('/api/voicebox/profiles')) return { ok: true, json: async () => ({ ok: true, profiles: [] }) };
      if (url.includes('/api/publish/cover')) return { ok: true, json: async () => ({ coverUrl: null }) };
      if (url.includes('/api/publish/video')) return { ok: true, json: async () => ({ hasVideo: false, videoUrl: null }) };
      return { ok: true, text: async () => '' };
    },
  });
  vm.runInContext(publishJsSrc, langCtx, { filename: 'js/publish-studio.js' });
  await langCtx.switchPublishLanguage('en');
  assert.equal(getElement('youtubeSourceLanguage').value, 'zh-Hans');
  assert.equal(getElement('youtubeCaptionLanguage').value, 'zh-Hans');
  await langCtx.switchPublishLanguage('ja');
  assert.equal(getElement('youtubeSourceLanguage').value, 'zh-Hans');
  assert.equal(getElement('youtubeCaptionLanguage').value, 'zh-Hans');

  const merged = langCtx.mergeMultilingualTags({
    zh: { tags: '日本长寿, 预期寿命, 公共卫生' },
    en: { tags: 'Japan longevity, life expectancy, public health, Japan longevity' },
    ja: { tags: '日本 長寿, 平均寿命, ' + 'x'.repeat(500) },
  }, 500);
  assert.ok(merged.includes('日本长寿'));
  assert.ok(merged.includes('Japan longevity'));
  assert.ok(merged.includes('日本 長寿'));
  assert.equal(merged.filter((t) => t === 'Japan longevity').length, 1);
  assert.ok(merged.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(',').length <= 500);
});

test('publish ai-settings persists translateModel, publishCoverModel, and custom coverPrompt used by cover generation', async () => {
  const { Readable } = await import('node:stream');
  const { handlePublishRoutes } = await import('../packages/qc-tools/ui-server/routes/publish-routes.mjs');

  const modelSettingsHtml = fs.readFileSync(path.join(publicDir, 'partials/model-settings.html'), 'utf8');
  assert.ok(modelSettingsHtml.includes('id="accordionHeaderModel7"'));
  assert.ok(modelSettingsHtml.includes('id="currentTranslateModelInput"'));

  const publishHtml = fs.readFileSync(path.join(publicDir, 'partials/publish-panel.html'), 'utf8');
  assert.ok(publishHtml.includes('openPublishAiSettings()'));
  assert.ok(publishHtml.includes('id="publishTranslateModelInput"'));
  assert.ok(publishHtml.includes('id="publishCoverModelInput"'));
  assert.ok(publishHtml.includes('id="publishCoverPrompt"'));

  const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-pubai-'));
  const previousFetch = globalThis.fetch;
  try {
    const dataDir = path.join(tmpProj, 'data');
    const publicDirProj = path.join(tmpProj, 'public');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(publicDirProj, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'prompt-config.json'),
      JSON.stringify({
        apiKey: 'test-openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        writerModel: 'openai/gpt-6.1-terra',
        textModel: 'openai/gpt-4o-mini',
        imageModel: 'black-forest-labs/flux-3-image',
      })
    );

    const callRoute = async (method, pathname, bodyObj = null) => {
      const req = bodyObj
        ? Readable.from([Buffer.from(JSON.stringify(bodyObj))])
        : Readable.from([]);
      req.method = method;
      let resStatus = 0;
      let resBody = '';
      const res = {
        writeHead(status) { resStatus = status; },
        end(chunk) { resBody += chunk || ''; },
      };
      const handled = await handlePublishRoutes(req, res, {
        url: new URL('http://localhost' + pathname),
        pathname,
        queryProject: 'demo_pub_ai',
        paths: {
          projectDir: tmpProj,
          dataDir,
          publicDir: publicDirProj,
          promptConfigPath: path.join(dataDir, 'prompt-config.json'),
          finalScriptPath: path.join(dataDir, 'final-script.json'),
        },
      });
      return { handled, status: resStatus, body: JSON.parse(resBody) };
    };

    const initGet = await callRoute('GET', '/api/publish/ai-settings');
    assert.equal(initGet.handled, true);
    assert.equal(initGet.status, 200);
    assert.equal(initGet.body.fallbackTranslateModel, 'openai/gpt-4o-mini');
    assert.equal(initGet.body.fallbackCoverModel, 'black-forest-labs/flux-3-image');

    const saveRes = await callRoute('POST', '/api/publish/ai-settings', {
      translateModel: 'google/gemini-2.5-flash',
      coverModel: 'qwen/qwen-image-2.1-turbo',
      prompt: '自定义发布资料提示词',
      coverPrompt: '极简科普封面风格，主体：{keywords}{titleHint}',
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.translateModel, 'google/gemini-2.5-flash');
    assert.equal(saveRes.body.coverModel, 'qwen/qwen-image-2.1-turbo');

    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let seenModel = '';
    let seenPrompt = '';
    globalThis.fetch = async (_url, options) => {
      const reqBody = JSON.parse(options.body);
      seenModel = reqBody.model;
      seenPrompt = reqBody.prompt;
      return new Response(
        JSON.stringify({ data: [{ b64_json: pngBase64, media_type: 'image/png' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const coverRes = await callRoute('POST', '/api/publish/generate-cover', {
      keywords: '长寿曲线图',
      title: '为什么日本人更长寿',
    });
    assert.equal(coverRes.status, 200);
    assert.equal(coverRes.body.model, 'qwen/qwen-image-2.1-turbo');
    assert.equal(seenModel, 'qwen/qwen-image-2.1-turbo');
    assert.match(seenPrompt, /^极简科普封面风格，主体：长寿曲线图/);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

test('render-project plans chunks cleanly, builds hardware-accelerated commands, and builds lossless concat args', async () => {
  const {
    planRenderFrameChunks,
    makeConcatFfmpegArgs,
    makeRenderCommand,
  } = await import('../packages/qc-tools/render-project.mjs');

  assert.deepEqual(planRenderFrameChunks(1800, 3600), [{ index: 0, startFrame: 0, endFrame: 1799 }]);
  assert.deepEqual(planRenderFrameChunks(7350, 3600), [
    { index: 0, startFrame: 0, endFrame: 3599 },
    { index: 1, startFrame: 3600, endFrame: 7349 },
  ]);
  assert.deepEqual(planRenderFrameChunks(8400, 3600), [
    { index: 0, startFrame: 0, endFrame: 3599 },
    { index: 1, startFrame: 3600, endFrame: 7199 },
    { index: 2, startFrame: 7200, endFrame: 8399 },
  ]);

  const { listContent, args: ffArgs } = makeConcatFfmpegArgs(['chunk_000.mp4', 'chunk_001.mp4'], '/tmp/out.mp4');
  assert.equal(listContent, "file 'chunk_000.mp4'\nfile 'chunk_001.mp4'\n");
  assert.ok(ffArgs.includes('-c') && ffArgs.includes('copy'));
  assert.ok(ffArgs.includes('+faststart'));

  const tmpId = `tmp_render_spec_${process.pid}_${Date.now()}`;
  const tmpPaths = getProjectPaths(tmpId);
  try {
    fs.mkdirSync(path.join(tmpPaths.publicDir, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(tmpPaths.publicDir, 'audio', 'narration.wav'), 'RIFF');
    fs.writeFileSync(tmpPaths.propsPath, JSON.stringify({
      project_id: tmpId,
      audio_track: { src: 'audio/narration.wav' },
      video_config: { duration_in_frames: 9000 },
    }));
    const cmd = makeRenderCommand(tmpId, {
      concurrency: 2,
      frameRange: [0, 3599],
      seamlessConcat: true,
      outputPath: path.join(tmpPaths.outputDir, 'chunk_0.mp4'),
    });
    assert.ok(cmd.args.includes('--image-format=jpeg'));
    assert.ok(cmd.args.includes('--jpeg-quality=85'));
    assert.ok(cmd.args.includes('--hardware-acceleration=if-possible'));
    assert.ok(cmd.args.includes('--x264-preset=veryfast'));
    assert.ok(cmd.args.includes('--frames=0-3599'));
    assert.ok(cmd.args.includes('--for-seamless-aac-concatenation'));
  } finally {
    fs.rmSync(tmpPaths.projectDir, { recursive: true, force: true });
  }
});

test('render confirm modal wires burnCaptions checkbox through generate-render-props', async () => {
  const { execFileSync } = await import('node:child_process');
  const confirmHtml = fs.readFileSync(path.join(publicDir, 'partials/render-confirm.html'), 'utf8');
  assert.match(confirmHtml, /id="finalRenderBurnCaptions"[^>]*type="checkbox"/);

  const controlsSrc = fs.readFileSync(path.join(publicDir, 'js/render-controls.js'), 'utf8');
  assert.match(controlsSrc, /finalRenderBurnCaptions/);
  assert.match(controlsSrc, /JSON\.stringify\(\{\s*projectId,\s*burnCaptions\s*\}\)/);

  const routesSrc = fs.readFileSync(path.join(ROOT_DIR, 'packages/qc-tools/ui-server/routes/audio-render-routes.mjs'), 'utf8');
  assert.match(routesSrc, /burnCaptions:\s*Boolean\(body\.burnCaptions\)/);

  const jobsSrc = fs.readFileSync(path.join(ROOT_DIR, 'packages/qc-tools/ui-server/lib/jobs-service.mjs'), 'utf8');
  assert.match(jobsSrc, /job\.burnCaptions\s*\?\s*'--burn-captions'\s*:\s*'--no-burn-captions'/);

  const tmpId = `tmp_burn_caps_${process.pid}_${Date.now()}`;
  const tmpPaths = getProjectPaths(tmpId);
  try {
    fs.mkdirSync(tmpPaths.dataDir, { recursive: true });
    fs.mkdirSync(path.join(tmpPaths.publicDir, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(tmpPaths.publicDir, 'captions'), { recursive: true });
    fs.writeFileSync(path.join(tmpPaths.publicDir, 'audio', 'narration.wav'), 'RIFF');
    fs.writeFileSync(
      path.join(tmpPaths.publicDir, 'captions', 'captions.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\n测试中文字幕\n'
    );
    fs.writeFileSync(
      path.join(tmpPaths.dataDir, 'asset-index.json'),
      JSON.stringify({ project_id: tmpId, assets: [] })
    );
    fs.writeFileSync(
      path.join(tmpPaths.dataDir, 'scene-manifest.json'),
      JSON.stringify({
        project_id: tmpId,
        title: 'Test Burn Captions',
        audio_file: 'audio/narration.wav',
        captions_file: 'captions/captions.srt',
        total_duration_ms: 2000,
        total_duration_sec: 2,
        scenes: [],
      })
    );

    execFileSync(process.execPath, [
      'packages/qc-tools/generate-render-props.mjs', '--project', tmpId, '--no-burn-captions',
    ], { cwd: ROOT_DIR });
    const propsOff = JSON.parse(fs.readFileSync(tmpPaths.propsPath, 'utf8'));
    assert.equal(propsOff.burn_in_captions, false);
    assert.equal(propsOff.caption_track.burn_in_captions, false);
    assert.equal(propsOff.caption_track.captions.length, 1);

    execFileSync(process.execPath, [
      'packages/qc-tools/generate-render-props.mjs', '--project', tmpId, '--burn-captions',
    ], { cwd: ROOT_DIR });
    const propsOn = JSON.parse(fs.readFileSync(tmpPaths.propsPath, 'utf8'));
    assert.equal(propsOn.burn_in_captions, true);
    assert.equal(propsOn.caption_track.burn_in_captions, true);
  } finally {
    fs.rmSync(tmpPaths.projectDir, { recursive: true, force: true });
  }
});

test('studio-out-location overrides Studio default output path to project output directory', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { getDefaultOutLocation } = require('../packages/video-template/src/studio-out-location.cjs');
  const previousProjectId = process.env.WHYVIDEO_STUDIO_PROJECT_ID;
  try {
    process.env.WHYVIDEO_STUDIO_PROJECT_ID = 'why_demo_001';
    assert.equal(
      getDefaultOutLocation({ compositionName: 'WhyExplainerFinal', defaultExtension: 'mp4', type: 'asset' }),
      'projects/why_demo_001/output/why_demo_001.mp4',
    );
    assert.equal(
      getDefaultOutLocation({ compositionName: 'WhyExplainerMVP', defaultExtension: 'mp4', type: 'asset' }),
      'projects/why_demo_001/output/why_demo_001_preview.mp4',
    );
    assert.equal(
      getDefaultOutLocation({ compositionName: 'WhyExplainerFinal', defaultExtension: 'png', type: 'still' }),
      'projects/why_demo_001/output/why_demo_001.png',
    );
    assert.equal(
      getDefaultOutLocation({ compositionName: 'WhyExplainerFinal', defaultExtension: 'mp4', type: 'sequence' }),
      'projects/why_demo_001/output/why_demo_001',
    );

    delete process.env.WHYVIDEO_STUDIO_PROJECT_ID;
    assert.equal(
      getDefaultOutLocation({ compositionName: 'WhyExplainerFinal', defaultExtension: 'mp4', type: 'asset' }),
      'out/WhyExplainerFinal.mp4',
    );
  } finally {
    if (previousProjectId === undefined) delete process.env.WHYVIDEO_STUDIO_PROJECT_ID;
    else process.env.WHYVIDEO_STUDIO_PROJECT_ID = previousProjectId;
  }
});

test('POST /api/delete-project allows superuser on unowned/default project and owner on own project, rejects non-owners', { timeout: 15000 }, async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-del-auth-'));
  const unownedDir = fs.mkdtempSync(path.join(ROOT_DIR, 'projects', 'test_del_unowned_'));
  const ownedDir = fs.mkdtempSync(path.join(ROOT_DIR, 'projects', 'test_del_owned_'));
  const otherOwnedDir = fs.mkdtempSync(path.join(ROOT_DIR, 'projects', 'test_del_other_'));
  const unownedId = path.basename(unownedDir);
  const ownedId = path.basename(ownedDir);
  const otherOwnedId = path.basename(otherOwnedDir);

  const { openAccountStore } = await import('../packages/qc-tools/ui-server/lib/account-store.mjs');
  const store = openAccountStore(authDir);
  const superuser = await store.createUser('del-super', 'test-password-12345', 'superuser');
  const owner = await store.createUser('del-owner', 'test-password-12345');
  const other = await store.createUser('del-other', 'test-password-12345');
  store.assignProject(ownedId, owner.id);
  store.assignProject(otherOwnedId, owner.id);
  const superCookie = 'whyvideo_session=' + store.createSession(superuser.id);
  const ownerCookie = 'whyvideo_session=' + store.createSession(owner.id);
  const otherCookie = 'whyvideo_session=' + store.createSession(other.id);

  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['packages/qc-tools/ui-server.mjs'], {
    cwd: ROOT_DIR, env: { ...process.env, PORT: String(port), WHYVIDEO_AUTH_DIR: authDir, PROJECT_ID: unownedId }, stdio: ['ignore', 'pipe', 'pipe'],
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
    const postDelete = (cookie, projectId) => fetch(base + '/api/delete-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, origin: base },
      body: JSON.stringify({ projectId }),
    });

    // Non-owner regular user receives 403 on another user's owned project.
    assert.equal((await postDelete(otherCookie, otherOwnedId)).status, 403);
    assert.equal(fs.existsSync(otherOwnedDir), true);

    // Superuser can delete any project, including another user's owned project.
    const superOwnedDel = await postDelete(superCookie, otherOwnedId);
    assert.equal(superOwnedDel.status, 200);
    assert.equal(fs.existsSync(otherOwnedDir), false);

    // Superuser can delete an unowned project (including PROJECT_ID / default project) without edit lease or revision header.
    const superDel = await postDelete(superCookie, unownedId);
    assert.equal(superDel.status, 200);
    const superBody = await superDel.json();
    assert.equal(superBody.ok, true);
    assert.equal(superBody.deletedProjectId, unownedId);
    assert.equal(fs.existsSync(unownedDir), false);

    // Owner can delete their own project without edit lease or revision header.
    const ownerDel = await postDelete(ownerCookie, ownedId);
    assert.equal(ownerDel.status, 200);
    const ownerBody = await ownerDel.json();
    assert.equal(ownerBody.ok, true);
    assert.equal(ownerBody.deletedProjectId, ownedId);
    assert.equal(fs.existsSync(ownedDir), false);
    assert.equal(store.getProjectOwner(ownedId), null);
  } finally {
    child.kill('SIGTERM');
    await exit;
    store.close();
    fs.rmSync(authDir, { recursive: true, force: true });
    fs.rmSync(unownedDir, { recursive: true, force: true });
    fs.rmSync(ownedDir, { recursive: true, force: true });
    fs.rmSync(otherOwnedDir, { recursive: true, force: true });
  }
});
