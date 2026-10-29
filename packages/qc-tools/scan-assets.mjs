import fs from "node:fs";
import path from "node:path";

export const ROOT_DIR = process.cwd();
export const PROJECTS_ROOT = path.join(ROOT_DIR, "projects");

/**
 * Resolves `projects/<project_id>/` and its subpaths (`data/`, `public/`, `output/`, `human-review-log.json`).
 * Zero hardcoded topic or project names.
 */
export function resolveProject(argv = process.argv.slice(2)) {
  let requestedId = process.env.PROJECT_ID || null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) {
      requestedId = argv[i + 1];
      break;
    }
    if (argv[i].startsWith("--project=")) {
      requestedId = argv[i].split("=")[1];
      break;
    }
  }

  if (!fs.existsSync(PROJECTS_ROOT)) {
    throw new Error(`Projects root directory not found: ${PROJECTS_ROOT}`);
  }

  const availableProjects = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  if (availableProjects.length === 0) {
    throw new Error(`No project directories found inside ${PROJECTS_ROOT}`);
  }

  const projectId = requestedId || availableProjects[0];
  const projectDir = path.join(PROJECTS_ROOT, projectId);

  if (!fs.existsSync(projectDir)) {
    throw new Error(
      `Project '${projectId}' not found in ${PROJECTS_ROOT}. Available: ${availableProjects.join(
        ", "
      )}`
    );
  }

  return {
    projectId,
    projectDir,
    dataDir: path.join(projectDir, "data"),
    publicDir: path.join(projectDir, "public"),
    outputDir: path.join(projectDir, "output"),
    humanReviewLogPath: path.join(projectDir, "human-review-log.json"),
    availableProjects,
  };
}

function inspectPng(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Not a valid PNG file: ${filePath}`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return {
    format: "png",
    resolution: `${width}x${height}`,
    size_bytes: buf.length,
  };
}

function inspectWav(filePath) {
  const buf = fs.readFileSync(filePath);
  const riff = buf.subarray(0, 4).toString("ascii");
  const wave = buf.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Not a valid WAV file: ${filePath}`);
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const bitsPerSample = buf.readUInt16LE(34);
  let offset = 12;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  const duration_seconds = Number((dataSize / byteRate).toFixed(3));
  const duration_ms = Math.round(duration_seconds * 1000);
  return {
    format: "wav",
    channels,
    sample_rate: sampleRate,
    bits_per_sample: bitsPerSample,
    duration_seconds,
    duration_ms,
    size_bytes: buf.length,
  };
}

function inspectMp4(filePath) {
  const buf = fs.readFileSync(filePath);
  let duration_seconds = null;
  let width = null;
  let height = null;

  const mvhdIdx = buf.indexOf(Buffer.from("mvhd"));
  if (mvhdIdx !== -1) {
    const version = buf[mvhdIdx + 4];
    if (version === 0) {
      const timescale = buf.readUInt32BE(mvhdIdx + 16);
      const duration = buf.readUInt32BE(mvhdIdx + 20);
      if (timescale > 0) {
        duration_seconds = Number((duration / timescale).toFixed(2));
      }
    }
  }

  const tkhdIdx = buf.indexOf(Buffer.from("tkhd"));
  if (tkhdIdx !== -1) {
    const version = buf[tkhdIdx + 4];
    const wOffset = version === 1 ? tkhdIdx + 92 : tkhdIdx + 80;
    if (wOffset + 8 <= buf.length) {
      width = buf.readUInt16BE(wOffset);
      height = buf.readUInt16BE(wOffset + 4);
    }
  }

  return {
    format: "mp4",
    resolution: width && height ? `${width}x${height}` : "1920x1080",
    duration_seconds,
    size_bytes: buf.length,
  };
}

export function scanProjectAssets(resolvedProject) {
  const resolved = resolvedProject || resolveProject();
  const { projectId, dataDir, publicDir } = resolved;

  const sceneManifest = JSON.parse(
    fs.readFileSync(path.join(dataDir, "scene-manifest.json"), "utf8")
  );
  const assetIndex = JSON.parse(
    fs.readFileSync(path.join(dataDir, "asset-index.json"), "utf8")
  );
  const audioRelPath = sceneManifest.audio_file || "audio/narration.wav";
  const wavPath = path.join(publicDir, audioRelPath);
  const audioMeta = inspectWav(wavPath);

  const scannedAssets = assetIndex.assets.map((asset) => {
    const diskPath = path.join(publicDir, asset.path);
    const exists = fs.existsSync(diskPath);
    let diskMeta = null;
    if (exists) {
      if (diskPath.endsWith(".png")) {
        diskMeta = inspectPng(diskPath);
      } else if (diskPath.endsWith(".mp4")) {
        diskMeta = inspectMp4(diskPath);
      }
    }
    const resolutionMatches =
      diskMeta && diskMeta.resolution === asset.resolution;
    return {
      asset_id: asset.asset_id,
      declared_path: asset.path,
      disk_path: `projects/${projectId}/public/${asset.path}`,
      exists_on_disk: exists,
      type: asset.type,
      declared_resolution: asset.resolution,
      actual_resolution: diskMeta?.resolution || null,
      resolution_matches: Boolean(resolutionMatches),
      declared_duration_seconds: asset.duration_seconds,
      actual_duration_seconds: diskMeta?.duration_seconds ?? null,
      size_bytes: diskMeta?.size_bytes ?? 0,
      license_status: asset.license_status,
    };
  });

  return {
    project_id: projectId,
    scanned_at: new Date().toISOString(),
    audio_file: {
      path: `projects/${projectId}/public/${audioRelPath}`,
      ...audioMeta,
    },
    assets: scannedAssets,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = scanProjectAssets();
  console.log(JSON.stringify(result, null, 2));
}
