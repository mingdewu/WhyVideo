import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

export const DEFAULT_RENDER_CONCURRENCY = 4;
export const DEFAULT_CHUNK_FRAMES = 3600; // 30fps 下每段 2 分钟（3600 帧）
export const DEFAULT_PARALLEL_CHUNKS = 2; // 8GB 内存下默认 2 路分段并行 × 每路 2 并发标签页

export function projectRenderPaths(projectId) {
  const paths = getProjectPaths(projectId);
  const { projectDir } = paths;
  if (!fs.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`工程不存在：${projectId}`);
  }
  return paths;
}

/**
 * 将总帧数切分为连续的帧区间；若末尾尾段过短则并入前一段，避免为极短尾段单独起进程
 */
export function planRenderFrameChunks(totalFrames, chunkFrames = DEFAULT_CHUNK_FRAMES) {
  const total = Math.max(0, Math.floor(Number(totalFrames) || 0));
  const size = Math.floor(Number(chunkFrames) || 0);
  if (total <= 0 || size <= 0 || total <= size) {
    return [{ index: 0, startFrame: 0, endFrame: Math.max(0, total - 1) }];
  }

  const rawRanges = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(total - 1, start + size - 1);
    rawRanges.push({ startFrame: start, endFrame: end });
  }

  const minTailFrames = Math.min(450, Math.floor(size * 0.25));
  if (rawRanges.length >= 2) {
    const last = rawRanges[rawRanges.length - 1];
    const lastLen = last.endFrame - last.startFrame + 1;
    if (lastLen < minTailFrames) {
      rawRanges[rawRanges.length - 2].endFrame = last.endFrame;
      rawRanges.pop();
    }
  }

  return rawRanges.map((r, index) => ({
    index,
    startFrame: r.startFrame,
    endFrame: r.endFrame,
  }));
}

export function makeConcatFfmpegArgs(chunkFileNames, outputPath) {
  const listContent = chunkFileNames
    .map((name) => `file '${String(name).replace(/'/g, "'\\''")}'`)
    .join('\n') + '\n';
  return {
    listContent,
    args: [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat_list.txt',
      '-c', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ],
  };
}

export function makeRenderCommand(projectId, {
  preview = false,
  concurrency = DEFAULT_RENDER_CONCURRENCY,
  outputPath,
  bundleEntryPoint,
  frameRange = null,
  seamlessConcat = false,
  offthreadCacheBytes = 1024 * 1024 * 1024,
} = {}) {
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
  const finalPath = preview ? path.join(paths.outputDir, 'preview.mp4') : paths.videoPath;
  const targetPath = outputPath || finalPath;
  const effectiveEntry = bundleEntryPoint || entryPoint;

  const args = [
    'render',
    effectiveEntry,
    preview ? 'WhyExplainerMVP' : 'WhyExplainerFinal',
    targetPath,
    `--props=${paths.propsPath}`,
    `--public-dir=${paths.publicDir}`,
    `--concurrency=${concurrency}`,
    `--scale=${preview ? 0.5 : 1}`,
    '--image-format=jpeg',
    '--jpeg-quality=85',
    '--hardware-acceleration=if-possible',
    '--gl=angle',
    '--x264-preset=veryfast',
    `--offthreadvideo-cache-size-in-bytes=${Math.max(64 * 1024 * 1024, Number(offthreadCacheBytes) || 1024 * 1024 * 1024)}`,
  ];

  if (frameRange !== null && frameRange !== undefined) {
    const rangeStr = Array.isArray(frameRange)
      ? `${frameRange[0]}-${frameRange[1]}`
      : String(frameRange).trim();
    if (rangeStr) {
      args.push(`--frames=${rangeStr}`);
    }
  }
  if (seamlessConcat) {
    args.push('--for-seamless-aac-concatenation');
  }

  return {
    command: remotionBin,
    args,
    paths,
    finalPath,
    props,
  };
}

function runChildCommand(command, args, { cwd = rootDir, onStart, onOutput, retryOutputPath = null, maxAttempts = 2 } = {}) {
  return (async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let diagnostics = '';
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
          });
          activeChildren.add(child);
          onStart?.(child);
          const onData = (chunk) => {
            const text = chunk.toString();
            diagnostics = (diagnostics + text).slice(-12000);
            onOutput?.(text);
          };
          child.stdout.on('data', onData);
          child.stderr.on('data', onData);
          child.on('error', (error) => {
            activeChildren.delete(child);
            reject(error);
          });
          child.on('close', (code) => {
            activeChildren.delete(child);
            code === 0 ? resolve() : reject(new Error(`Remotion 渲染失败，退出码 ${code}`));
          });
        });
        return;
      } catch (error) {
        if (attempt + 1 >= maxAttempts || !/Visited .+ but got no response/.test(diagnostics)) {
          throw error;
        }
        if (retryOutputPath && fs.existsSync(retryOutputPath)) {
          try { fs.unlinkSync(retryOutputPath); } catch {}
        }
        onOutput?.('本地渲染页面连接失败，正在重试一次。\n');
      }
    }
  })();
}

export async function renderProject(projectId, options = {}) {
  const paths = projectRenderPaths(projectId);
  const preview = Boolean(options.preview);
  const finalPath = preview ? path.join(paths.outputDir, 'preview.mp4') : paths.videoPath;
  fs.mkdirSync(paths.outputDir, { recursive: true });
  const runId = randomUUID().slice(0, 8);
  const temporaryPath = path.join(paths.outputDir, `.${preview ? 'preview' : projectId}.${runId}.mp4`);

  const totalConcurrency = Number.isInteger(options.concurrency) && options.concurrency >= 1
    ? options.concurrency
    : DEFAULT_RENDER_CONCURRENCY;
  const initialCmd = makeRenderCommand(projectId, {
    ...options,
    preview,
    concurrency: totalConcurrency,
    outputPath: temporaryPath,
  });

  const totalFrames = Number(initialCmd.props?.video_config?.duration_in_frames) || 0;
  const chunkFrames = options.chunkFrames !== undefined ? Number(options.chunkFrames) : DEFAULT_CHUNK_FRAMES;
  const chunks = planRenderFrameChunks(totalFrames, chunkFrames);

  if (chunks.length <= 1) {
    try {
      await runChildCommand(initialCmd.command, initialCmd.args, {
        onStart: options.onStart,
        onOutput: options.onOutput,
        retryOutputPath: temporaryPath,
      });
      fs.renameSync(temporaryPath, finalPath);
      return finalPath;
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      throw error;
    }
  }

  // 多分段并行渲染 + ffmpeg concat 无损拼接
  const parallelChunks = Math.min(
    chunks.length,
    Math.max(1, Number(options.parallelChunks) || DEFAULT_PARALLEL_CHUNKS)
  );
  const perWorkerConcurrency = Math.max(1, Math.floor(totalConcurrency / parallelChunks));
  const perWorkerCacheBytes = Math.floor((1024 * 1024 * 1024) / parallelChunks);

  const bundleDir = path.join(paths.outputDir, `.bundle-${preview ? 'preview' : projectId}-${runId}`);
  const chunkDir = path.join(paths.outputDir, `.chunks-${preview ? 'preview' : projectId}-${runId}`);
  fs.mkdirSync(chunkDir, { recursive: true });

  const chunkChildren = new Set();
  const registerChild = (child) => {
    chunkChildren.add(child);
    child.once('close', () => chunkChildren.delete(child));
    options.onStart?.(child);
  };

  try {
    options.onOutput?.(
      `\n🚀 [并行分段渲染] 全片共 ${totalFrames} 帧，已切分为 ${chunks.length} 段（${parallelChunks} 路并行 × 每路 ${perWorkerConcurrency} 核，JPEG + Apple 硬件加速）\n`
    );
    options.onOutput?.(`📦 [1/3] 正在预打包 Remotion 工程（所有并行分段共享同一 Bundle，避免重复编译）...\n`);
    await runChildCommand(
      remotionBin,
      ['bundle', entryPoint, `--out-dir=${bundleDir}`, `--public-dir=${paths.publicDir}`],
      { onStart: registerChild, onOutput: options.onOutput, maxAttempts: 1 }
    );

    options.onOutput?.(`🎬 [2/3] 开始并行渲染 ${chunks.length} 个视频分段...\n`);
    const chunkFileNames = new Array(chunks.length);
    let nextChunkIdx = 0;
    let completedCount = 0;

    const runWorker = async () => {
      while (nextChunkIdx < chunks.length) {
        const current = chunks[nextChunkIdx++];
        const chunkFileName = `chunk_${String(current.index).padStart(3, '0')}_${current.startFrame}-${current.endFrame}.mp4`;
        const chunkFilePath = path.join(chunkDir, chunkFileName);
        chunkFileNames[current.index] = chunkFileName;

        options.onOutput?.(
          `▶ [分段 ${current.index + 1}/${chunks.length}] 开始渲染帧 ${current.startFrame}–${current.endFrame}...\n`
        );
        const { command, args } = makeRenderCommand(projectId, {
          ...options,
          preview,
          concurrency: perWorkerConcurrency,
          outputPath: chunkFilePath,
          bundleEntryPoint: bundleDir,
          frameRange: [current.startFrame, current.endFrame],
          seamlessConcat: true,
          offthreadCacheBytes: perWorkerCacheBytes,
        });
        await runChildCommand(command, args, {
          onStart: registerChild,
          onOutput: options.onOutput,
          retryOutputPath: chunkFilePath,
        });
        completedCount++;
        options.onOutput?.(
          `✅ [分段 ${current.index + 1}/${chunks.length}] 渲染完成（已完成 ${completedCount}/${chunks.length} 段）\n`
        );
      }
    };

    const workers = Array.from({ length: parallelChunks }, () => runWorker());
    await Promise.all(workers);

    options.onOutput?.(`🔗 [3/3] 正在用 ffmpeg 无损拼接 ${chunks.length} 个分段...\n`);
    const { listContent, args: ffArgs } = makeConcatFfmpegArgs(chunkFileNames, temporaryPath);
    fs.writeFileSync(path.join(chunkDir, 'concat_list.txt'), listContent, 'utf8');
    const ff = spawnSync('ffmpeg', ffArgs, { cwd: chunkDir, encoding: 'utf8' });
    if (ff.status !== 0 || !fs.existsSync(temporaryPath)) {
      throw new Error(`ffmpeg 分段无损拼接失败: ${(ff.stderr || '').slice(-400)}`);
    }

    fs.renameSync(temporaryPath, finalPath);
    options.onOutput?.(`🎉 [并行分段渲染完成] 成片已输出至：${finalPath}\n`);
    return finalPath;
  } catch (error) {
    for (const child of chunkChildren) {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {}
    }
    if (fs.existsSync(temporaryPath)) {
      try { fs.unlinkSync(temporaryPath); } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(bundleDir)) {
      try { fs.rmSync(bundleDir, { recursive: true, force: true }); } catch {}
    }
    if (fs.existsSync(chunkDir)) {
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
  const concurrencyArg = process.argv.find((arg) => arg.startsWith('--concurrency='));
  const chunkFramesArg = process.argv.find((arg) => arg.startsWith('--chunk-frames='));
  const parallelChunksArg = process.argv.find((arg) => arg.startsWith('--parallel-chunks='));
  if (!projectArg) {
    console.error('用法：node packages/qc-tools/render-project.mjs --project=工程ID [--preview] [--concurrency=4] [--chunk-frames=3600] [--parallel-chunks=2]');
    process.exitCode = 2;
  } else {
    const projectId = projectArg.slice('--project='.length);
    const compile = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        'packages/qc-tools/generate-render-props.mjs', '--project', projectId,
      ], { cwd: rootDir, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`生成渲染参数失败，退出码 ${code}`))));
    });
    Promise.resolve().then(() => projectRenderPaths(projectId)).then(compile).then(() => renderProject(projectId, {
      preview: process.argv.includes('--preview'),
      concurrency: concurrencyArg ? Number(concurrencyArg.slice('--concurrency='.length)) : DEFAULT_RENDER_CONCURRENCY,
      chunkFrames: chunkFramesArg ? Number(chunkFramesArg.slice('--chunk-frames='.length)) : DEFAULT_CHUNK_FRAMES,
      parallelChunks: parallelChunksArg ? Number(parallelChunksArg.slice('--parallel-chunks='.length)) : DEFAULT_PARALLEL_CHUNKS,
      onOutput: (chunk) => process.stdout.write(chunk),
    })).then((output) => console.log(`已完成：${output}`)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
