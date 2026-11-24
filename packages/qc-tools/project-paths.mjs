import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECTS_ROOT = path.join(ROOT_DIR, 'projects');
export const SHARED_BGM_DIR = path.join(ROOT_DIR, 'public', 'audio', 'bgm');

export function listProjectIds() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  return fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name).sort();
}

export function defaultProjectId() {
  return process.env.PROJECT_ID || listProjectIds()[0] || 'why_preview';
}

export function getProjectPaths(projectId = defaultProjectId()) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId || '')) {
    throw new Error('工程 ID 只能包含字母、数字、下划线和连字符');
  }
  const projectDir = path.join(PROJECTS_ROOT, projectId);
  const dataDir = path.join(projectDir, 'data');
  const publicDir = path.join(projectDir, 'public');
  const outputDir = path.join(projectDir, 'output');
  return {
    projectId, projectDir, dataDir, publicDir, outputDir,
    humanReviewLogPath: path.join(projectDir, 'human-review-log.json'),
    ...Object.fromEntries(Object.entries({
      briefPath: 'brief.json', evidencePath: 'evidence-cards.json',
      outlinePath: 'outline.json', manifestPath: 'scene-manifest.json',
      assetIndexPath: 'asset-index.json', statusPath: 'project-status.json',
      promptConfigPath: 'prompt-config.json', bgmConfigPath: 'bgm-config.json',
      writerPromptsPath: 'writer-prompts.json', finalScriptPath: 'final-script.json',
      materialsPath: 'materials.txt',
    }).map(([key, file]) => [key, path.join(dataDir, file)])),
    videoPath: path.join(outputDir, 'final_video_1080p.mp4'),
    audioDir: path.join(publicDir, 'audio'), bgmDir: path.join(publicDir, 'audio', 'bgm'),
    captionsPath: path.join(publicDir, 'captions', 'captions.srt'),
    propsPath: path.join(publicDir, 'render-props.json'),
  };
}

export function resolveProject(argv = process.argv.slice(2)) {
  let requestedId = process.env.PROJECT_ID || null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) { requestedId = argv[i + 1]; break; }
    if (argv[i].startsWith('--project=')) { requestedId = argv[i].slice('--project='.length); break; }
  }
  const availableProjects = listProjectIds();
  if (!availableProjects.length) throw new Error(`No project directories found inside ${PROJECTS_ROOT}`);
  const projectId = requestedId || availableProjects[0];
  const paths = getProjectPaths(projectId);
  if (!fs.statSync(paths.projectDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Project '${projectId}' not found. Available: ${availableProjects.join(', ')}`);
  }
  return { ...paths, availableProjects };
}
