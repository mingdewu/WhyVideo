import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getProjectPaths } from './project-paths.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const remotionBin = path.join(rootDir, 'node_modules/.bin/remotion');
const entryPoint = path.join(rootDir, 'packages/video-template/src/index.ts');
const activeChildren = new Set();
process.once('exit', () => {
  for (const child of activeChildren) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {}
  }
});

export function projectRenderPaths(projectId) {
  const paths = getProjectPaths(projectId);
  const { projectDir } = paths;
  if (!fs.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`工程不存在：${projectId}`);
  }
  return paths;
}

export function makeRenderCommand(projectId, { preview = false, concurrency = 2, outputPath } = {}) {
  const paths = projectRenderPaths(projectId);
  if (!fs.existsSync(remotionBin)) throw new Error('未安装 Remotion，请先运行 npm install');
  if (!fs.existsSync(paths.propsPath)) throw new Error(`缺少渲染参数：${paths.propsPath}`);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('并发帧数必须是正整数');
  const props = JSON.parse(fs.readFileSync(paths.propsPath, 'utf8'));
  if (props.project_id !== projectId) throw new Error(`渲染参数属于其他工程：${props.project_id}`);
  const audioSrc = props.audio_track?.src;
  if (!preview && !audioSrc) throw new Error('工程未配置旁白音频；请先将完整旁白保存为 public/audio/narration.wav 或 narration.mp3');
  if (audioSrc && !fs.existsSync(path.join(paths.publicDir, audioSrc))) {
    throw new Error(`工程音频不存在：${audioSrc}`);
  }
  const finalPath = path.join(paths.outputDir, preview ? 'preview.mp4' : 'final_video_1080p.mp4');
  const targetPath = outputPath || finalPath;
  return {
    command: remotionBin,
    args: [
      'render', entryPoint, preview ? 'WhyExplainerMVP' : 'WhyExplainerFinal', targetPath,
      `--props=${paths.propsPath}`,
      `--public-dir=${paths.publicDir}`,
      `--concurrency=${concurrency}`,
      `--scale=${preview ? 0.5 : 1}`,
    ],
    paths,
    finalPath,
  };
}

export async function renderProject(projectId, options = {}) {
  const paths = projectRenderPaths(projectId);
  const preview = Boolean(options.preview);
  const finalPath = path.join(paths.outputDir, preview ? 'preview.mp4' : 'final_video_1080p.mp4');
  fs.mkdirSync(paths.outputDir, { recursive: true });
  const temporaryPath = path.join(paths.outputDir, `.${preview ? 'preview' : 'final_video_1080p'}.${randomUUID()}.mp4`);
  const { command, args } = makeRenderCommand(projectId, { ...options, preview, outputPath: temporaryPath });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let diagnostics = '';
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(command, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
          activeChildren.add(child);
          options.onStart?.(child);
          const output = chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-12000); options.onOutput?.(chunk.toString()); };
          child.stdout.on('data', output);
          child.stderr.on('data', output);
          child.on('error', error => { activeChildren.delete(child); reject(error); });
          child.on('close', code => { activeChildren.delete(child); code === 0 ? resolve() : reject(new Error(`Remotion 渲染失败，退出码 ${code}`)); });
        });
        break;
      } catch (error) {
        if (attempt || !/Visited .+ but got no response/.test(diagnostics)) throw error;
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        options.onOutput?.('本地渲染页面连接失败，正在重试一次。\n');
      }
    }
    fs.renameSync(temporaryPath, finalPath);
    return finalPath;
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
  const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
  if (!projectArg) {
    console.error('用法：node packages/qc-tools/render-project.mjs --project=工程ID [--preview] [--concurrency=2]');
    process.exitCode = 2;
  } else {
    const projectId = projectArg.slice('--project='.length);
    const compile = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        'packages/qc-tools/generate-render-props.mjs', '--project', projectId,
      ], { cwd: rootDir, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`生成渲染参数失败，退出码 ${code}`)));
    });
    Promise.resolve().then(() => projectRenderPaths(projectId)).then(compile).then(() => renderProject(projectId, {
      preview: process.argv.includes('--preview'),
      concurrency: concurrencyArg ? Number(concurrencyArg.slice('--concurrency='.length)) : 2,
      onOutput: (chunk) => process.stdout.write(chunk),
    })).then((output) => console.log(`已完成：${output}`)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
