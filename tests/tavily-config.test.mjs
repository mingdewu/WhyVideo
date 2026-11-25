import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePromptConfig } from '../packages/qc-tools/ui-server/lib/config.mjs';
import { getWriterTavilyKey } from '../packages/qc-tools/ui-server/lib/llm-gateway.mjs';

function makeTempProjectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whyvideo-tavily-test-'));
}

function writeProjectConfig(projectsRoot, projectId, config) {
  const dataDir = path.join(projectsRoot, projectId, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'prompt-config.json'), JSON.stringify(config, null, 2), 'utf8');
  return path.join(projectsRoot, projectId);
}

test('normalizePromptConfig preserves tavilyApiKey and extended config fields', () => {
  const normalized = normalizePromptConfig({
    apiKey: 'or-key',
    tavilyApiKey: 'tvly-secret-123',
    meowloadApiKey: 'meow-secret-456',
    writerModel: 'anthropic/claude-sonnet-4',
    selected_visual_model: 'openrouter',
    textModel: 'deepseek/deepseek-chat',
  });
  assert.equal(normalized.tavilyApiKey, 'tvly-secret-123');
  assert.equal(normalized.meowloadApiKey, 'meow-secret-456');
  assert.equal(normalized.writerModel, 'anthropic/claude-sonnet-4');
  assert.equal(normalized.selected_visual_model, 'openrouter');
  assert.equal(normalized.provider, 'openrouter');
});

test('getWriterTavilyKey resolves explicit, project, env, and cross-project fallback in priority order', () => {
  const root = makeTempProjectsRoot();
  const prevEnv = process.env.TAVILY_API_KEY;
  try {
    delete process.env.TAVILY_API_KEY;
    const projA = writeProjectConfig(root, 'proj-a', {
      tavilyApiKey: 'tvly-older',
      updated_at: '2026-11-20T00:00:00.000Z',
    });
    const projB = writeProjectConfig(root, 'proj-b', {
      tavilyApiKey: 'tvly-newest',
      updated_at: '2026-11-24T00:00:00.000Z',
    });
    const projEmpty = writeProjectConfig(root, 'proj-empty', {});

    // 1. Explicit non-masked key wins, while masked bullets are ignored.
    assert.equal(getWriterTavilyKey(projA, 'tvly-explicit', { projectsRoot: root }), 'tvly-explicit');
    assert.equal(getWriterTavilyKey(projA, '••••••••••••', { projectsRoot: root }), 'tvly-older');

    // 2. Current project key wins over sibling projects.
    assert.equal(getWriterTavilyKey(projB, '', { projectsRoot: root }), 'tvly-newest');

    // 3. Cross-project fallback selects most recently updated key when project and env lack one.
    assert.equal(getWriterTavilyKey(projEmpty, '', { projectsRoot: root }), 'tvly-newest');

    // 4. Environment variable takes precedence over cross-project fallback.
    process.env.TAVILY_API_KEY = 'tvly-from-env';
    assert.equal(getWriterTavilyKey(projEmpty, '', { projectsRoot: root }), 'tvly-from-env');
  } finally {
    if (prevEnv === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = prevEnv;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
