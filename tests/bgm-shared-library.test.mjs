import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  compileBgmRenderProp,
  deleteBgmTrackAnalysis,
  findDuplicateSharedBgmFile,
  legacyTrackAnalysisKey,
  loadBgmConfig,
  saveBgmConfig,
  syncExistingProjectsToSharedBgm,
  trackAnalysisKey,
} from '../packages/qc-tools/bgm-manager.mjs';
import { generateAiBgmPlan } from '../packages/qc-tools/bgm-ai.mjs';
import { saveProjectProducerPromptPreset } from '../packages/qc-tools/producer-prompts.mjs';

function makeSilentMp3(destPath, durationSec = 5) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${durationSec}`,
    '-y',
    destPath,
  ]);
}

test('shared BGM library is visible across separate projects via loadBgmConfig', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-shared-vis-'));
  try {
    const sharedDir = path.join(root, 'shared-bgm');
    makeSilentMp3(path.join(sharedDir, 'bgm_1000_alpha_BPM100.mp3'));
    makeSilentMp3(path.join(sharedDir, 'bgm_1001_beta_BPM120.mp3'));

    const projADir = path.join(root, 'projA');
    const projAPub = path.join(projADir, 'public');
    const projBDir = path.join(root, 'projB');
    const projBPub = path.join(projBDir, 'public');
    fs.mkdirSync(projAPub, { recursive: true });
    fs.mkdirSync(projBPub, { recursive: true });

    const cfgA = loadBgmConfig(projADir, projAPub, { sharedBgmDir: sharedDir });
    const cfgB = loadBgmConfig(projBDir, projBPub, { sharedBgmDir: sharedDir });

    assert.equal(cfgA.tracks.length, 2);
    assert.equal(cfgB.tracks.length, 2);
    assert.deepEqual(cfgA.tracks.map((t) => t.title), ['alpha_BPM100', 'beta_BPM120']);
    assert.deepEqual(cfgB.tracks.map((t) => t.title), ['alpha_BPM100', 'beta_BPM120']);
    assert.ok(cfgA.tracks.every((t) => t.scope === 'shared'));
    assert.equal(cfgB.enabled, false, 'new project should not auto-enable BGM until user configures it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compileBgmRenderProp materializes single-track and multi-track playlist files into project public/audio/bgm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-compile-'));
  try {
    const sharedDir = path.join(root, 'shared-bgm');
    makeSilentMp3(path.join(sharedDir, 'bgm_1000_track_one_BPM100.mp3'), 5);
    makeSilentMp3(path.join(sharedDir, 'bgm_1001_track_two_BPM120.mp3'), 5);

    const projDir = path.join(root, 'proj');
    const pubDir = path.join(projDir, 'public');
    fs.mkdirSync(pubDir, { recursive: true });

    const initial = loadBgmConfig(projDir, pubDir, { sharedBgmDir: sharedDir });
    assert.equal(initial.tracks.length, 2);

    // Single-track compile
    initial.enabled = true;
    initial.multi_track = false;
    initial.selected_track_id = initial.tracks[0].track_id;
    saveBgmConfig(projDir, initial);

    const manifest = { total_duration_ms: 9000, scenes: [{ start_ms: 0, end_ms: 9000 }] };
    const singleProp = compileBgmRenderProp(projDir, pubDir, manifest, [], 30, { sharedBgmDir: sharedDir });
    assert.ok(singleProp);
    assert.equal(singleProp.src, initial.tracks[0].src);
    assert.ok(fs.existsSync(path.join(pubDir, initial.tracks[0].src)));
    assert.equal(fs.existsSync(path.join(pubDir, initial.tracks[1].src)), false);

    // Multi-track playlist compile materializes all playlist tracks
    initial.multi_track = true;
    saveBgmConfig(projDir, initial);
    const multiProp = compileBgmRenderProp(projDir, pubDir, manifest, [], 30, { sharedBgmDir: sharedDir });
    assert.ok(multiProp);
    assert.ok(Array.isArray(multiProp.playlist) && multiProp.playlist.length >= 2);
    for (const clip of multiProp.playlist) {
      assert.ok(fs.existsSync(path.join(pubDir, clip.src)), `Expected ${clip.src} to be materialized`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncExistingProjectsToSharedBgm migrates legacy BGM files and analysis caches idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-migrate-'));
  try {
    const projectsRoot = path.join(root, 'projects');
    const sharedDir = path.join(root, 'public', 'audio', 'bgm');

    const legacyProj = path.join(projectsRoot, 'legacy_proj');
    makeSilentMp3(path.join(legacyProj, 'public', 'audio', 'bgm', 'bgm_2000_legacy.mp3'));
    fs.mkdirSync(path.join(legacyProj, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyProj, 'data', 'bgm-audio-analysis.json'),
      JSON.stringify({ hash_1: { mood: '沉静', energy: 'low' } }),
      'utf8'
    );

    const first = syncExistingProjectsToSharedBgm(projectsRoot, sharedDir);
    assert.equal(first.linkedFiles, 1);
    assert.equal(first.mergedAnalyses, 1);
    assert.ok(fs.existsSync(path.join(sharedDir, 'bgm_2000_legacy.mp3')));

    const sharedCachePath = path.join(sharedDir, '.bgm-audio-analysis.json');
    assert.ok(fs.existsSync(sharedCachePath));
    const sharedCache = JSON.parse(fs.readFileSync(sharedCachePath, 'utf8'));
    assert.deepEqual(sharedCache.hash_1, { mood: '沉静', energy: 'low' });

    // Pre-existing shared cache key must not be overwritten, and second run must be idempotent
    sharedCache.hash_1 = { mood: '已保留', energy: 'medium' };
    fs.writeFileSync(sharedCachePath, JSON.stringify(sharedCache, null, 2), 'utf8');

    const second = syncExistingProjectsToSharedBgm(projectsRoot, sharedDir);
    assert.equal(second.linkedFiles, 0);
    assert.equal(second.mergedAnalyses, 0);
    const afterCache = JSON.parse(fs.readFileSync(sharedCachePath, 'utf8'));
    assert.deepEqual(afterCache.hash_1, { mood: '已保留', energy: 'medium' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateAiBgmPlan with sharedBgmDir resolves shared audio and reuses cache across projects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-ai-shared-'));
  const previousFetch = globalThis.fetch;
  try {
    const sharedDir = path.join(root, 'shared-bgm');
    makeSilentMp3(path.join(sharedDir, 'bgm_3000_one.mp3'), 5);
    makeSilentMp3(path.join(sharedDir, 'bgm_3001_two.mp3'), 5);

    const proj1Dir = path.join(root, 'proj1');
    const proj1Pub = path.join(proj1Dir, 'public');
    const proj2Dir = path.join(root, 'proj2');
    const proj2Pub = path.join(proj2Dir, 'public');
    fs.mkdirSync(proj1Pub, { recursive: true });
    fs.mkdirSync(proj2Pub, { recursive: true });

    saveProjectProducerPromptPreset(proj1Dir, 'proj1', {
      templates: { P6_bgm_director: { raw_template: '请输出 JSON 选曲方案。' } },
    });
    saveProjectProducerPromptPreset(proj2Dir, 'proj2', {
      templates: { P6_bgm_director: { raw_template: '请输出 JSON 选曲方案。' } },
    });

    const cfg1 = loadBgmConfig(proj1Dir, proj1Pub, { sharedBgmDir: sharedDir });
    const cfg2 = loadBgmConfig(proj2Dir, proj2Pub, { sharedBgmDir: sharedDir });
    assert.equal(cfg1.tracks.length, 2);
    assert.equal(cfg2.tracks.length, 2);

    let audioCalls = 0;
    let directorCalls = 0;
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      const isAudio = Array.isArray(request.messages[1].content);
      if (isAudio) {
        audioCalls++;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mood: '克制', energy: 'low' }) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      directorCalls++;
      const ids = cfg1.tracks.map((t) => t.track_id);
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                track_order: [ids[1], ids[0]],
                segments: [{ start_ms: 0, end_ms: 12000, target_db: -18 }],
                summary: '共享缓存测试方案',
              }),
            },
          }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const manifest = {
      title: '共享测试',
      total_duration_ms: 12000,
      scenes: [{ start_ms: 0, end_ms: 12000, narration_text: '旁白内容' }],
    };

    const firstPlan = await generateAiBgmPlan({
      projectDir: proj1Dir,
      publicDir: proj1Pub,
      config: cfg1,
      manifest,
      model: 'mock-audio',
      baseUrl: 'https://example.test',
      apiKey: 'test',
      sharedBgmDir: sharedDir,
    });
    assert.equal(audioCalls, 2);
    assert.equal(directorCalls, 1);
    assert.equal(firstPlan.analyzed_count, 2);
    assert.equal(firstPlan.cached_count, 0);
    assert.ok(fs.existsSync(path.join(sharedDir, '.bgm-audio-analysis.json')));

    // Second project uses a different model and baseUrl, yet reuses cached tags (0 extra audio calls)
    const secondPlan = await generateAiBgmPlan({
      projectDir: proj2Dir,
      publicDir: proj2Pub,
      config: cfg2,
      manifest,
      model: 'deepseek/deepseek-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test',
      sharedBgmDir: sharedDir,
    });
    assert.equal(audioCalls, 2, 'changing model/baseUrl should reuse model-independent track tags');
    assert.equal(directorCalls, 2);
    assert.equal(secondPlan.analyzed_count, 0);
    assert.equal(secondPlan.cached_count, 2);

    // Clearing a single track's analysis invalidates only that track
    const cleared = deleteBgmTrackAnalysis(cfg2.tracks[0], proj2Dir, sharedDir);
    assert.equal(cleared, true);
    const thirdPlan = await generateAiBgmPlan({
      projectDir: proj2Dir,
      publicDir: proj2Pub,
      config: cfg2,
      manifest,
      model: 'mock-audio-2',
      baseUrl: 'https://another-gateway.test',
      apiKey: 'test',
      sharedBgmDir: sharedDir,
    });
    assert.equal(audioCalls, 3, 'only the cleared track should be re-listened to');
    assert.equal(directorCalls, 3);
    assert.equal(thirdPlan.analyzed_count, 1);
    assert.equal(thirdPlan.cached_count, 1);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncExistingProjectsToSharedBgm promotes legacy hash entries to canonical fileName::size keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-legacy-promote-'));
  try {
    const projectsRoot = path.join(root, 'projects');
    const sharedDir = path.join(root, 'public', 'audio', 'bgm');
    const legacyProj = path.join(projectsRoot, 'legacy_proj');
    const audioPath = path.join(legacyProj, 'public', 'audio', 'bgm', 'bgm_4000_promo.mp3');
    makeSilentMp3(audioPath, 5);
    const stat = fs.statSync(audioPath);

    const legacyHash = legacyTrackAnalysisKey(
      'audio/bgm/bgm_4000_promo.mp3',
      stat.size,
      stat.mtimeMs,
      'google/gemini-2.5-flash',
      'https://openrouter.ai/api/v1'
    );
    fs.mkdirSync(path.join(legacyProj, 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyProj, 'data', 'bgm-audio-analysis.json'),
      JSON.stringify({
        [legacyHash]: { mood: '沉稳', energy: 'low', suitable: '铺垫', instruments: '钢琴' },
      }),
      'utf8'
    );

    const res = syncExistingProjectsToSharedBgm(projectsRoot, sharedDir);
    assert.equal(res.linkedFiles, 1);
    assert.ok(res.mergedAnalyses >= 2);

    const sharedCache = JSON.parse(fs.readFileSync(path.join(sharedDir, '.bgm-audio-analysis.json'), 'utf8'));
    const canonical = trackAnalysisKey('bgm_4000_promo.mp3', stat.size);
    assert.deepEqual(sharedCache[canonical], {
      mood: '沉稳',
      energy: 'low',
      suitable: '铺垫',
      instruments: '钢琴',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncExistingProjectsToSharedBgm does not resurrect deleted files or duplicate identical legacy tracks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-no-resurrect-'));
  try {
    const projectsRoot = path.join(root, 'projects');
    const sharedDir = path.join(root, 'public', 'audio', 'bgm');
    const projA = path.join(projectsRoot, 'proj_a');
    const projB = path.join(projectsRoot, 'proj_b');

    const fileA = path.join(projA, 'public', 'audio', 'bgm', 'bgm_1000_same.mp3');
    makeSilentMp3(fileA, 5);
    fs.mkdirSync(path.join(projB, 'public', 'audio', 'bgm'), { recursive: true });
    fs.copyFileSync(fileA, path.join(projB, 'public', 'audio', 'bgm', 'bgm_2000_same.mp3'));

    const first = syncExistingProjectsToSharedBgm(projectsRoot, sharedDir);
    assert.equal(first.linkedFiles, 1, 'identical normalized title+size should only be migrated once');
    const sharedFiles = fs.readdirSync(sharedDir).filter((f) => f.endsWith('.mp3'));
    assert.equal(sharedFiles.length, 1);

    // Delete the migrated file from sharedDir and run sync again
    fs.unlinkSync(path.join(sharedDir, sharedFiles[0]));
    const second = syncExistingProjectsToSharedBgm(projectsRoot, sharedDir);
    assert.equal(second.linkedFiles, 0);
    assert.equal(fs.readdirSync(sharedDir).filter((f) => f.endsWith('.mp3')).length, 0, 'deleted shared file must not be resurrected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findDuplicateSharedBgmFile detects identical audio bytes in sharedDir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-dedup-'));
  try {
    const sharedDir = path.join(root, 'shared-bgm');
    const existingPath = path.join(sharedDir, 'bgm_1000_song.mp3');
    makeSilentMp3(existingPath, 5);
    const sameBytes = fs.readFileSync(existingPath);

    assert.equal(findDuplicateSharedBgmFile(sharedDir, sameBytes), 'bgm_1000_song.mp3');

    const otherPath = path.join(root, 'other.mp3');
    makeSilentMp3(otherPath, 6);
    const otherBytes = fs.readFileSync(otherPath);
    assert.equal(findDuplicateSharedBgmFile(sharedDir, otherBytes), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
