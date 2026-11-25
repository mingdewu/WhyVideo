import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getPaths } from './config.mjs';
import { syncTableToManifest, recompileProject } from './project-store.mjs';
import { parseTimeRangeFromText, formatSecToMMSS, formatSecToFileTag } from './scene-compiler.mjs';
import { syncLocalProjectAssets, registerProjectAsset } from './media-gateway.mjs';

const downloadProgressMap = new Map();
export function getDownloadProgress(jobId, projectId = '') {
 return downloadProgressMap.get(`${projectId}:${jobId}`) || { percent: 0, text: '准备中...', done: false, error: null };
}

export async function downloadUrlAsset(body, queryProject) {
  let responseStatus = 200;
    const { sceneId, url: rawInputUrl, projectId, clipStartSec: reqStartSec, clipEndSec: reqEndSec, rawPrompt, jobId } = body;
    const targetProject = projectId || queryProject;
    const curPaths = getPaths(targetProject);
    const updateDlProgress = (percent, text, extra = {}) => {
      if (!jobId) return;
      downloadProgressMap.set(`${targetProject}:${jobId}`, {
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        text: text || '',
        done: Boolean(extra.done),
        error: extra.error || null,
        updatedAt: Date.now(),
      });
    };
    updateDlProgress(2, '正在校验视频链接...');

    const normalizeDownloadUrl = (raw) => {
      let s = String(raw || '')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
        .trim();
      if (!s) return '';

      // 修正全角冒号或单斜杠等常见粘贴格式问题
      s = s
        .replace(/^https?\s*：\s*\/\//i, (m) => (m.toLowerCase().startsWith('https') ? 'https://' : 'http://'))
        .replace(/^(https?):\/([^/])/i, '$1://$2');

      if (s.startsWith('//')) {
        s = `https:${s}`;
      }

      // 优先提取标准 RFC3986 URL（遇到中文、空格、全角标点自动截断，避免把分享文案拼进 URL）
      const rfcMatch = s.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
      let candidate = rfcMatch ? rfcMatch[0] : '';

      // 若无协议头，兼容 www.bilibili.com/... / b23.tv/... / youtu.be/... 等裸域名链接
      if (!candidate) {
        const bareMatch = s.match(/(?:^|\s)((?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?)/);
        if (bareMatch) {
          candidate = `https://${bareMatch[1]}`;
        }
      }

      // 清理尾部多余的非转义 % 或孤立标点（如 "100%好评" 截断后残留的 "%"）
      candidate = candidate.replace(/[.,;:!?'"`~)\]}>]+$/g, (m) => (m === '/' ? '/' : ''));
      candidate = candidate.replace(/%(?![0-9A-Fa-f]{2}).*$/, '');

      if (!candidate) return '';
      try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
        return parsed.toString();
      } catch (e) {
        return '';
      }
    };

    const targetUrl = normalizeDownloadUrl(rawInputUrl);
    if (!targetUrl) {
      updateDlProgress(0, '链接无效', { done: true, error: '请输入有效的网络视频或帖子链接' });
      responseStatus = 400;
      return { status: responseStatus, body: { ok: false, error: '请输入有效的网络视频或帖子链接（支持 YouTube、B站、抖音、TikTok、小红书等，请勿仅输入纯文字）' } };
    }

    const resolveMeowloadCli = () => {
      const candidates = ['/usr/local/bin/meowload', '/opt/homebrew/bin/meowload'];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      const whichRes = spawnSync('which', ['meowload'], { encoding: 'utf8' });
      if (whichRes.status === 0 && whichRes.stdout.trim()) return whichRes.stdout.trim();
      return '';
    };

    const meowloadCli = resolveMeowloadCli();

    if (!meowloadCli) {
      updateDlProgress(0, '未检测到本机哼哼猫客户端', { done: true, error: '未检测到本机哼哼猫客户端 CLI (meowload)' });
      responseStatus = 400;
      return { status: responseStatus, body: {
        ok: false,
        error: '未检测到本机哼哼猫客户端 CLI (meowload)。请确认已安装并登录本机哼哼猫桌面端。'
      } };
    }

    try {
      const manifestPre = fs.existsSync(curPaths.manifestPath)
        ? JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'))
        : { scenes: [] };
      const sceneIdx = (manifestPre.scenes || []).findIndex((s) => s.scene_id === sceneId);
      const scenePre = sceneIdx >= 0 ? manifestPre.scenes[sceneIdx] : null;
      const seqNumStr = String(sceneIdx >= 0 ? sceneIdx + 1 : 1).padStart(2, '0');
      const seqLabel = `序列${seqNumStr}`;
      const safeProject = String(targetProject || 'proj').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');

      // 解析用户指定的片段截取区间（优先级：请求显式传入 > 口令实时解析 > 镜头已编译的 download_clip_*）
      let clipStart = (reqStartSec !== undefined && reqStartSec !== null && reqStartSec !== '') ? Number(reqStartSec) : null;
      let clipEnd = (reqEndSec !== undefined && reqEndSec !== null && reqEndSec !== '') ? Number(reqEndSec) : null;
      if (clipStart === null || clipEnd === null || Number.isNaN(clipStart) || Number.isNaN(clipEnd) || clipEnd <= clipStart) {
        const parsedFromPrompt = parseTimeRangeFromText(rawPrompt || '');
        if (parsedFromPrompt) {
          clipStart = parsedFromPrompt.startSec;
          clipEnd = parsedFromPrompt.endSec;
        } else if (
          scenePre &&
          scenePre.download_clip_start_sec !== undefined &&
          scenePre.download_clip_end_sec !== undefined &&
          Number(scenePre.download_clip_end_sec) > Number(scenePre.download_clip_start_sec)
        ) {
          clipStart = Number(scenePre.download_clip_start_sec);
          clipEnd = Number(scenePre.download_clip_end_sec);
        }
      }

      const hasClipRange = clipStart !== null && clipEnd !== null && !Number.isNaN(clipStart) && !Number.isNaN(clipEnd) && clipEnd > clipStart;
      const startSec = hasClipRange ? Math.max(0, Number(clipStart.toFixed(1))) : 0;
      const endSec = hasClipRange ? Number(clipEnd.toFixed(1)) : 0;
      const rangeFileTag = hasClipRange ? `_${formatSecToFileTag(startSec)}-${formatSecToFileTag(endSec)}` : '';
      const rangeDisplayTag = hasClipRange ? `${formatSecToMMSS(startSec)}~${formatSecToMMSS(endSec)}` : '';

      let isVideo = true;
      let folder = 'assets/video';
      let siteName = 'web';
      let postTitle = '';
      let relPath = '';
      let diskPath = '';
      let detectedDuration = null;
      let detectedResolution = '1920x1080';
      let detectedHasAudio = false;
      let downloadSourceMode = 'desktop_app';

      try {
        const u = new URL(targetUrl);
        siteName = u.hostname.replace(/^www\./, '').split('.')[0] || 'web';
      } catch (e) {}

      // 仅使用本机已登录会员的哼哼猫桌面端 CLI，将临时目录放在 public/ 之外，避免 Remotion Studio 监听 public/ 时因删除临时目录触发 ENOENT 崩溃
      const tmpDir = path.join(path.dirname(curPaths.publicDir), '.tmp_downloads', `meow_tmp_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      updateDlProgress(8, hasClipRange ? `正在连接本机哼哼猫解析直链 (${rangeDisplayTag})...` : '正在连接本机哼哼猫桌面端解析并下载...');

      const killProcTree = (proc) => {
        if (!proc || !proc.pid) return;
        try {
          if (process.platform !== 'win32') {
            process.kill(-proc.pid, 'SIGKILL');
          } else {
            proc.kill('SIGKILL');
          }
        } catch (e) {
          try { proc.kill('SIGKILL'); } catch (_) {}
        }
      };

      const runAsyncCmd = (cmd, args, timeoutMs = 120000) => new Promise((resolve) => {
        const proc = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
        let outLog = '';
        let errLog = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killProcTree(proc);
        }, timeoutMs);
        proc.stdout.on('data', (d) => { outLog += d.toString(); });
        proc.stderr.on('data', (d) => { errLog += d.toString(); });
        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ status: -1, stdout: outLog, stderr: err.message || errLog, timedOut });
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ status: code ?? -1, stdout: outLog, stderr: errLog, timedOut });
        });
      });

      const rewriteMcdnHost = (rawU, mirrorHost) => {
        if (!rawU) return '';
        try {
          const u = new URL(rawU);
          const isMcdn = (/upgcxcode/i.test(u.pathname) || /bilivideo|mountaintoys|mcdn/i.test(u.hostname))
            && (Boolean(u.port) || /mountaintoys|mcdn/i.test(u.hostname) || /[?&](?:os|sche)=mcdn/i.test(rawU));
          if (isMcdn && mirrorHost) {
            u.hostname = mirrorHost;
            u.port = '';
            return u.toString();
          }
          return rawU;
        } catch (e) {
          return rawU;
        }
      };

      const fetchMeowloadInfo = async () => {
        const infoRes = await runAsyncCmd(meowloadCli, ['info', targetUrl], 30000);
        if (infoRes.status !== 0 || !infoRes.stdout) return null;
        try {
          const infoJson = JSON.parse(infoRes.stdout);
          const mediaItem = Array.isArray(infoJson?.medias) ? infoJson.medias[0] : null;
          if (!mediaItem) return null;
          const hdrs = mediaItem.headers || {};
          const ua = hdrs['User-Agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
          const referer = hdrs['Referer'] || targetUrl;
          const rawTitle = String(infoJson.text || siteName || 'media')
            .replace(/[\\/:*?"<>|\r\n]+/g, '_')
            .trim()
            .slice(0, 60) || 'media';
          return { infoJson, mediaItem, ua, referer, rawTitle };
        } catch (e) {
          return null;
        }
      };

      const tryFfmpegDirect = async ({ vUrl, aUrl, ua, referer, outPath, clipRange }) => {
        if (!vUrl) return false;
        const args = ['-y'];
        const headerStr = `Referer: ${referer}\r\n`;
        const clipDur = clipRange ? Math.max(0.1, Number((endSec - startSec).toFixed(2))) : 0;
        const pushInput = (url) => {
          args.push('-user_agent', ua, '-headers', headerStr);
          if (clipRange) {
            args.push('-ss', String(startSec), '-t', String(clipDur));
          }
          args.push('-i', url);
        };
        pushInput(vUrl);
        if (aUrl) pushInput(aUrl);
        if (clipRange) {
          args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', outPath);
        } else {
          args.push('-c', 'copy', '-movflags', '+faststart', outPath);
        }
        const ff = await runAsyncCmd('ffmpeg', args, clipRange ? 90000 : 180000);
        return ff.status === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
      };

      const tryDirectMediaDownload = async (clipRange) => {
        const info = await fetchMeowloadInfo();
        if (!info) return { files: [], trimmed: false };
        const { mediaItem, ua, referer, rawTitle } = info;
        if (clipRange && mediaItem.media_type === 'image') return { files: [], trimmed: false };

        const outFiles = [];
        const fallbackOut = path.join(tmpDir, `${rawTitle}.mp4`);
        const formats = Array.isArray(mediaItem.formats)
          ? [...mediaItem.formats].sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))
          : [];

        let downloaded = false;
        if (formats.length > 0 && formats[0].video_url) {
          const triedPairs = new Set();
          for (const mirrorHost of ['upos-sz-mirrorcos.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com', '']) {
            const vUrl = rewriteMcdnHost(formats[0].video_url, mirrorHost);
            const aUrl = formats[0].audio_url ? rewriteMcdnHost(formats[0].audio_url, mirrorHost) : '';
            const pairKey = `${vUrl}||${aUrl}`;
            if (triedPairs.has(pairKey)) continue;
            triedPairs.add(pairKey);
            if (await tryFfmpegDirect({ vUrl, aUrl, ua, referer, outPath: fallbackOut, clipRange })) {
              downloaded = true;
              break;
            }
          }
        }

        if (!downloaded && mediaItem.resource_url) {
          if (mediaItem.media_type === 'image') {
            const imgOut = path.join(tmpDir, `${rawTitle}.jpg`);
            const curlRes = await runAsyncCmd('curl', ['-fsSL', '-A', ua, '-e', referer, '-o', imgOut, mediaItem.resource_url], 60000);
            if (curlRes.status === 0 && fs.existsSync(imgOut) && fs.statSync(imgOut).size > 0) {
              outFiles.push({ name: path.basename(imgOut), fullPath: imgOut, stat: fs.statSync(imgOut) });
              downloaded = true;
            }
          } else {
            const triedUrls = new Set();
            for (const cand of [rewriteMcdnHost(mediaItem.resource_url, 'upos-sz-mirrorcos.bilivideo.com'), mediaItem.resource_url]) {
              if (!cand || triedUrls.has(cand)) continue;
              triedUrls.add(cand);
              if (await tryFfmpegDirect({ vUrl: cand, aUrl: '', ua, referer, outPath: fallbackOut, clipRange })) {
                downloaded = true;
                break;
              }
            }
          }
        }

        if (downloaded && fs.existsSync(fallbackOut) && fs.statSync(fallbackOut).size > 0 && outFiles.length === 0) {
          outFiles.push({ name: path.basename(fallbackOut), fullPath: fallbackOut, stat: fs.statSync(fallbackOut) });
        }
        return { files: outFiles, trimmed: Boolean(clipRange && downloaded && outFiles.length > 0) };
      };

      const runCliDownload = () => new Promise((resolve, reject) => {
        const proc = spawn(meowloadCli, ['download', targetUrl, '--media_type', 'video,image', '--output-dir', tmpDir], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
        let outLog = '';
        let errLog = '';
        let simPct = 10;
        const simTimer = setInterval(() => {
          if (simPct < 70) {
            simPct += 3;
            updateDlProgress(simPct, `本机哼哼猫下载中 (${simPct}%)...`);
          }
        }, 800);

        const handleChunk = (chunkStr) => {
          const pctMatches = [...chunkStr.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
          if (pctMatches.length > 0) {
            const rawPct = parseFloat(pctMatches[pctMatches.length - 1][1]);
            if (!Number.isNaN(rawPct) && rawPct >= 0 && rawPct <= 100) {
              const mapped = 10 + Math.round(rawPct * 0.65);
              if (mapped > simPct) simPct = mapped;
              updateDlProgress(simPct, `本机哼哼猫下载中 (${Math.round(rawPct)}%)...`);
            }
          }
        };

        proc.stdout.on('data', (d) => {
          const s = d.toString();
          outLog += s;
          handleChunk(s);
        });
        proc.stderr.on('data', (d) => {
          const s = d.toString();
          errLog += s;
          handleChunk(s);
        });

        const timer = setTimeout(() => {
          clearInterval(simTimer);
          killProcTree(proc);
          reject(new Error('本机哼哼猫下载超时（超过 5 分钟）'));
        }, 300000);

        proc.on('error', (err) => {
          clearInterval(simTimer);
          clearTimeout(timer);
          reject(err);
        });
        proc.on('close', (code) => {
          clearInterval(simTimer);
          clearTimeout(timer);
          if (code === 0) {
            resolve({ outLog, errLog });
          } else {
            const cleanLines = `${errLog || ''}\n${outLog || ''}`
              .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
              .split(/[\r\n]+/)
              .map((l) => l.trim())
              .filter(Boolean);
            const msg = cleanLines.pop() || `退出码 ${code}`;
            const isUrlErr = /URL is empty or invalid|Invalid link format/i.test(msg);
            const hint = isUrlErr
              ? `（请检查链接格式是否完整，当前解析目标: ${targetUrl}）`
              : '（请确认桌面端已启动并登录会员账号）';
            reject(new Error(`本机哼哼猫客户端下载失败: ${msg}${hint}`));
          }
        });
      });

      const collectMediaFiles = (dir) => {
        const results = [];
        const walk = (curDir) => {
          let entries = [];
          try {
            entries = fs.readdirSync(curDir, { withFileTypes: true });
          } catch (e) {
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(curDir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.isFile()) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size > 0) {
                  results.push({ name: entry.name, fullPath, stat });
                }
              } catch (e) {}
            }
          }
        };
        walk(dir);
        return results;
      };

      try {
        let files = [];
        let cliRes = null;
        let alreadyTrimmed = false;

        // 当指定了截取区间时，优先通过 meowload info 解析直链并用 ffmpeg -ss/-t 远程按段抓取（不下载整片）
        if (hasClipRange) {
          updateDlProgress(16, `正在远程截取 ${rangeDisplayTag} 片段（不下载整片）...`);
          try {
            const directRes = await tryDirectMediaDownload(true);
            if (directRes.files.length > 0) {
              files = directRes.files;
              alreadyTrimmed = directRes.trimmed;
              updateDlProgress(82, `远程片段 ${rangeDisplayTag} 截取完成，正在校验...`);
            } else {
              updateDlProgress(15, `远程直链截取未命中，回退本机哼哼猫客户端下载...`);
            }
          } catch (directErr) {
            console.warn('[download-url-asset] remote range clip failed, falling back to full download:', directErr.message);
            updateDlProgress(15, `远程直链截取失败，回退本机哼哼猫客户端下载...`);
          }
        }

        if (files.length === 0) {
          cliRes = await runCliDownload();
          updateDlProgress(78, '下载完成，正在检查媒体文件...');
          files = collectMediaFiles(tmpDir);

          // 若目录扫描为空，尝试从 meowload stdout 的 "completed -> <path>" 中兜底提取实际落盘路径
          if (files.length === 0 && cliRes && cliRes.outLog) {
            const completedMatches = [...cliRes.outLog.matchAll(/completed\s*->\s*([^\r\n]+)/gi)];
            for (const m of completedMatches) {
              const candidatePath = String(m[1] || '').trim();
              if (candidatePath && fs.existsSync(candidatePath)) {
                try {
                  const st = fs.statSync(candidatePath);
                  if (st.isFile() && st.size > 0) {
                    files.push({ name: path.basename(candidatePath), fullPath: candidatePath, stat: st });
                  }
                } catch (e) {}
              }
            }
          }

          // 若 meowload download 因 MCDN/P2P 节点超时等原因静默失败（退出码 0 但无文件），用 meowload info 解析直链并用 mirror CDN + ffmpeg 兜底下载
          if (files.length === 0) {
            updateDlProgress(79, '哼哼猫直连节点超时，正在切换镜像 CDN 兜底下载...');
            try {
              const fallbackRes = await tryDirectMediaDownload(false);
              files = fallbackRes.files;
            } catch (fallbackErr) {
              console.warn('[download-url-asset] meowload info fallback failed:', fallbackErr.message);
            }
          }
        }

        const videoRegex = /\.(mp4|mov|webm|mkv|m4v|flv|ts)$/i;
        const imageRegex = /\.(jpg|jpeg|png|webp|gif|heic|avif)$/i;
        const videoFile = files.find((f) => videoRegex.test(f.name));
        const imageFile = files.find((f) => imageRegex.test(f.name));
        const picked = videoFile || imageFile || files[0];

        if (!picked) {
          const rawDiag = `${cliRes?.errLog || ''}\n${cliRes?.outLog || ''}`
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .split(/[\r\n]+/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' | ');
          console.warn('[download-url-asset] meowload exited 0 but no media file found in', tmpDir, 'diag:', rawDiag);
          const diagSuffix = rawDiag ? `（CLI 输出: ${rawDiag.slice(0, 180)}）` : '';
          throw new Error(`哼哼猫桌面端未在目录中输出有效媒体文件，请检查该链接是否受限或桌面端是否已登录${diagSuffix}`);
        }

        isVideo = Boolean(videoFile) || !imageRegex.test(picked.name);
        const origExt = path.extname(picked.name).replace(/^\./, '').toLowerCase();
        const rawExt = (isVideo && hasClipRange) ? 'mp4' : (origExt || (isVideo ? 'mp4' : 'jpg'));
        const baseName = path.basename(picked.name, path.extname(picked.name));
        postTitle = baseName.slice(0, 60);

        folder = isVideo ? 'assets/video' : 'assets/images';
        const safeFile = `${safeProject}_${seqLabel}${rangeFileTag}_${siteName}_${String(Date.now()).slice(-6)}.${rawExt}`;
        relPath = `${folder}/${safeFile}`;
        diskPath = path.join(curPaths.publicDir, relPath);
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });

        if (isVideo && hasClipRange && !alreadyTrimmed) {
          updateDlProgress(84, `正在用 FFmpeg 截取 ${rangeDisplayTag} 片段...`);
          // 仅截取 startSec ~ endSec 片段写入工程专属 assets/video 目录，原完整临时文件在 finally 中立即销毁，绝不占满硬盘
          const ffTrim = await runAsyncCmd(
            'ffmpeg',
            [
              '-y',
              '-ss', String(startSec),
              '-to', String(endSec),
              '-i', picked.fullPath,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '20',
              '-c:a', 'aac',
              '-movflags', '+faststart',
              diskPath,
            ],
            120000
          );
          if (ffTrim.status !== 0 || !fs.existsSync(diskPath) || fs.statSync(diskPath).size === 0) {
            throw new Error(`视频片段截取 (${rangeDisplayTag}) 失败，请检查指定秒数是否超出原视频总长度`);
          }
        } else {
          fs.renameSync(picked.fullPath, diskPath);
        }
        updateDlProgress(94, '正在写入工程素材库并绑定镜头...');
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
      }

      // 用 ffprobe 探测本地已落盘短视频真实时长与分辨率
      if (isVideo) {
        if (detectedDuration === null) {
          detectedDuration = hasClipRange ? Number((endSec - startSec).toFixed(1)) : 15.0;
        }
        try {
          const probe = spawnSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', diskPath],
            { encoding: 'utf8' }
          );
          if (probe.status === 0 && probe.stdout) {
            const info = JSON.parse(probe.stdout);
            const dur = parseFloat(info?.format?.duration);
            if (!Number.isNaN(dur) && dur > 0) {
              detectedDuration = Number(dur.toFixed(1));
            }
            const w = info?.streams?.[0]?.width;
            const h = info?.streams?.[0]?.height;
            if (w && h) {
              detectedResolution = `${w}x${h}`;
            }
          }
          const audioProbe = spawnSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', diskPath],
            { encoding: 'utf8' }
          );
          detectedHasAudio = audioProbe.status === 0 && String(audioProbe.stdout || '').trim().length > 0;
        } catch (e) {}
      }

      const assetIndex = fs.existsSync(curPaths.assetIndexPath)
        ? JSON.parse(fs.readFileSync(curPaths.assetIndexPath, 'utf8'))
        : { project_id: targetProject, assets: [] };
      const newAssetId = `${isVideo ? 'AST-VID-' : 'AST-IMG-'}${String(assetIndex.assets.length + 1).padStart(3, '0')}`;
      const ext = path.extname(relPath).replace(/^\./, '') || (isVideo ? 'mp4' : 'jpg');
      const cleanTitle = (postTitle || siteName || '素材').replace(/[\r\n]+/g, ' ').slice(0, 22);
      const displayFileName = `[${targetProject}·${seqLabel}]${hasClipRange ? ` (${rangeDisplayTag})` : ''} ${cleanTitle}.${ext}`;

      const newAsset = {
        asset_id: newAssetId,
        path: relPath,
        file_path: `projects/${targetProject}/public/${relPath}`,
        file_name: displayFileName,
        sequence_label: `${targetProject}·${seqLabel}`,
        clip_range: hasClipRange ? { start_sec: startSec, end_sec: endSec, label: rangeDisplayTag } : null,
        type: isVideo ? 'video' : 'image',
        media_type: isVideo ? 'video' : 'image',
        duration_seconds: detectedDuration,
        duration_sec: detectedDuration,
        resolution: detectedResolution,
        has_audio: isVideo ? detectedHasAudio : false,
        license_status: 'approved',
        source_url: targetUrl,
        tags: [
          '网络链接下载',
          hasClipRange ? `片段:${rangeDisplayTag}` : '完整下载',
          `${targetProject}·${seqLabel}`,
          siteName,
          sceneId,
        ],
      };
      registerProjectAsset(curPaths, newAsset);
      const syncedAssetIndex = syncLocalProjectAssets(targetProject);

      const manifest = JSON.parse(fs.readFileSync(curPaths.manifestPath, 'utf8'));
      const scene = manifest.scenes.find((s) => s.scene_id === sceneId);
      if (scene) {
        scene.source_mode = 'manual_upload';
        scene.visual_type = isVideo ? 'broll_video' : 'photo_motion';
        scene.scene_type = scene.visual_type;
        scene.final_asset_id = newAssetId;
        scene.status = 'READY_APPROVED';
        if (isVideo) {
          const reqSec = Number((scene.duration_ms / 1000).toFixed(1));
          const playEndSec = detectedDuration ? Math.min(reqSec, detectedDuration) : reqSec;
          // 本地文件本身已经是截取后的短视频，因此本地播放从 0.0s 开始，作为后续加字幕/动效的基准
          scene.trim_start_sec = 0.0;
          scene.trim_end_sec = playEndSec;
          if (scene.media_modifiers) {
            delete scene.media_modifiers.trim_start_sec;
            delete scene.media_modifiers.trim_end_sec;
          }
          if (hasClipRange) {
            scene.downloaded_clip_info = {
              source_start_sec: startSec,
              source_end_sec: endSec,
              label: rangeDisplayTag,
              local_duration_sec: detectedDuration,
              sequence_label: `${targetProject}·${seqLabel}`,
            };
            delete scene.download_clip_start_sec;
            delete scene.download_clip_end_sec;
            scene.trim_prompt = `已截取原片 ${rangeDisplayTag} (本地长 ${detectedDuration}s)`;
            scene.ai_speech_reply = `✅ 已为你从原视频只截取并下载了 ${rangeDisplayTag} 片段（共 ${detectedDuration}s），命名为「${displayFileName}」并存入本工程专属目录 projects/${targetProject}/public/${folder}/！现在可以在上方口令框针对这段短视频继续加字幕、滤镜或运镜动效。`;
          } else {
            scene.downloaded_clip_info = null;
            scene.trim_prompt = `默认前 ${playEndSec} 秒`;
          }
        }
      }
      syncTableToManifest(manifest);
      fs.writeFileSync(curPaths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      recompileProject(targetProject);
      updateDlProgress(100, '下载并绑定完成 (100%)', { done: true });

      responseStatus = 200;
      return { status: responseStatus, body: {
        ok: true,
        uploadedAsset: newAsset,
        manifest,
        assetIndex: syncedAssetIndex,
        message: hasClipRange
          ? `✅ 已精准截取原视频 ${rangeDisplayTag} 片段 (${detectedDuration}s) 存入 projects/${targetProject}/public/assets/video/ 并绑定至 ${seqLabel}！`
          : `✅ 已下载到本地 projects/${targetProject}/public/assets/ (${detectedResolution}${detectedDuration ? `, ${detectedDuration}s` : ''}) 并绑定至 ${seqLabel}！`
      } };
    } catch (err) {
      updateDlProgress(0, err.message, { done: true, error: err.message });
      responseStatus = 500;
      return { status: responseStatus, body: {
        ok: false,
        error: `链接解析下载失败: ${err.message}`
      } };
    }
}
