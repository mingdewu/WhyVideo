import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { rootDir } from './config.mjs';

export const STUDIO_PORT = 3100;

let currentStudioProjectId = null;
let currentStudioChild = null;
let pendingSwitchPromise = null;

function probeUrl(host, port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/', timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function isPortListening(port) {
  if (await probeUrl('127.0.0.1', port)) return true;
  if (await probeUrl('::1', port)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateExistingStudio() {
  if (currentStudioChild && !currentStudioChild.killed) {
    try {
      currentStudioChild.kill('SIGTERM');
    } catch (e) {}
  }
  currentStudioChild = null;

  try {
    const out = execFileSync('lsof', ['-ti', `:${STUDIO_PORT}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).trim();
    if (out) {
      for (const line of out.split(/\s+/)) {
        const pid = Number(line);
        if (pid > 0 && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    // No process listening or lsof unavailable
  }
}

async function switchRemotionStudioInternal(projectId) {
  if (!projectId) {
    throw new Error('缺少 projectId，无法启动 Remotion Studio');
  }

  if (currentStudioProjectId === projectId && (await isPortListening(STUDIO_PORT))) {
    return {
      ok: true,
      projectId,
      url: `http://localhost:${STUDIO_PORT}`,
      restarted: false,
    };
  }

  terminateExistingStudio();
  await sleep(400);

  // Force-kill if port is still bound after SIGTERM
  if (await isPortListening(STUDIO_PORT)) {
    try {
      const out = execFileSync('lsof', ['-ti', `:${STUDIO_PORT}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
      }).trim();
      if (out) {
        for (const line of out.split(/\s+/)) {
          const pid = Number(line);
          if (pid > 0 && pid !== process.pid) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    await sleep(300);
  }

  const remotionBin = path.join(rootDir, 'node_modules/.bin/remotion');
  if (!fs.existsSync(remotionBin)) {
    throw new Error(`未找到 Remotion CLI: ${remotionBin}`);
  }

  const child = spawn(
    remotionBin,
    ['studio', 'packages/video-template/src/index.ts', '--port', String(STUDIO_PORT)],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        PROJECT_ID: projectId,
      },
      stdio: 'ignore',
      detached: true,
    }
  );
  child.unref();

  let exitError = null;
  child.once('exit', (code, signal) => {
    if (currentStudioChild === child) {
      currentStudioChild = null;
      currentStudioProjectId = null;
    }
    if (code !== null && code !== 0) {
      exitError = new Error(`Remotion Studio 异常退出 (code=${code}, signal=${signal || 'none'})`);
    }
  });
  child.once('error', (err) => {
    exitError = err;
  });

  currentStudioChild = child;

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitError) throw exitError;
    if (await isPortListening(STUDIO_PORT)) {
      currentStudioProjectId = projectId;
      return {
        ok: true,
        projectId,
        url: `http://localhost:${STUDIO_PORT}`,
        restarted: true,
      };
    }
    await sleep(300);
  }

  throw new Error(`Remotion Studio 启动超时（端口 ${STUDIO_PORT} 未在 20 秒内就绪）`);
}

export async function ensureRemotionStudio(projectId) {
  const run = async () => switchRemotionStudioInternal(projectId);
  const next = pendingSwitchPromise ? pendingSwitchPromise.then(run, run) : run();
  const settled = next.catch(() => {}).finally(() => {
    if (pendingSwitchPromise === settled) {
      pendingSwitchPromise = null;
    }
  });
  pendingSwitchPromise = settled;
  return next;
}
