import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const PROJECTS_ROOT = path.join(ROOT_DIR, "projects");
const PORT = Number(process.env.WORKFLOW_PORT || 3200);

function listProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function getProjectPaths(projectId) {
  const projectDir = path.join(PROJECTS_ROOT, projectId);
  return {
    projectDir,
    dataDir: path.join(projectDir, "data"),
    publicDir: path.join(projectDir, "public"),
    outputDir: path.join(projectDir, "output"),
    sceneManifestPath: path.join(projectDir, "data/scene-manifest.json"),
    assetIndexPath: path.join(projectDir, "data/asset-index.json"),
    renderPropsPath: path.join(projectDir, "data/render-props.json"),
    qcReportPath: path.join(projectDir, "output/video-qc-report.json"),
    promptConfigPath: path.join(projectDir, "data/prompt-config.json"),
  };
}

function ensureSceneTableFields(sceneManifest) {
  let modified = false;
  for (const scene of sceneManifest.scenes) {
    // Default source_mode: if it's kinetic_text / data_card / timeline / map, default to 'ai_ppt_slide';
    // if it's broll_video / photo_motion, default to 'manual_upload'
    if (!scene.source_mode) {
      scene.source_mode = ["broll_video", "photo_motion"].includes(
        scene.visual_type
      )
        ? "manual_upload"
        : "ai_ppt_slide";
      modified = true;
    }
    if (!Array.isArray(scene.content_keywords)) {
      scene.content_keywords =
        scene.search_queries_zh && scene.search_queries_zh.length > 0
          ? scene.search_queries_zh.slice(0, 3)
          : ["核心概念", "机制拆解"];
      modified = true;
    }
    if (!scene.ppt_slide_spec) {
      scene.ppt_slide_spec = {
        theme_title:
          scene.procedural_props?.headline || scene.narration_text.slice(0, 20),
        subtitle:
          scene.procedural_props?.subheadline || scene.visual_purpose || "",
        bullet_points:
          scene.procedural_props?.items &&
          scene.procedural_props.items.length > 0
            ? scene.procedural_props.items
            : scene.must_show || [],
        custom_prompt: "",
      };
      modified = true;
    }
  }
  return modified;
}

function syncSceneTableToManifest(sceneManifest) {
  let needsHumanAssetCount = 0;
  let humanReviewCount = 0;

  for (const scene of sceneManifest.scenes) {
    const keywords = Array.isArray(scene.content_keywords)
      ? scene.content_keywords
      : [];
    const ppt = scene.ppt_slide_spec || {};

    if (scene.source_mode === "ai_ppt_slide") {
      // Map AI PPT Slide mode to data_card or kinetic_text procedural rendering
      if (["broll_video", "photo_motion"].includes(scene.visual_type)) {
        scene.visual_type = "data_card";
        scene.scene_type = "data_card";
      }
      scene.final_asset_id = null;
      scene.asset_status = "PROCEDURAL_GRAPHIC_COMPONENT";
      scene.status = "READY_PROCEDURAL";
      scene.procedural_props = {
        badge_label: `PPT 主题页 · ${keywords.join(" / ") || scene.scene_id}`,
        headline: ppt.theme_title || scene.narration_text,
        subheadline: ppt.subtitle || scene.visual_purpose,
        items:
          Array.isArray(ppt.bullet_points) && ppt.bullet_points.length > 0
            ? ppt.bullet_points
            : keywords.map((k) => `核心关键词：${k}`),
      };
    } else {
      // Manual upload mode
      if (!["broll_video", "photo_motion"].includes(scene.visual_type)) {
        scene.visual_type = "photo_motion";
        scene.scene_type = "photo_motion";
      }
      if (scene.final_asset_id) {
        scene.asset_status = "MATCHED_APPROVED_ASSET";
        if (scene.status === "NEEDS_HUMAN_ASSET" || scene.status === "READY_PROCEDURAL") {
          scene.status = "READY_APPROVED";
        }
      } else {
        scene.asset_status = "NEEDS_HUMAN_ASSET";
        scene.status = "NEEDS_HUMAN_ASSET";
        scene.human_review_required = true;
      }
    }

    if (scene.status === "NEEDS_HUMAN_ASSET") needsHumanAssetCount++;
    if (scene.human_review_required) humanReviewCount++;
  }

  sceneManifest.needs_human_asset_count = needsHumanAssetCount;
  sceneManifest.human_review_required_count = humanReviewCount;
  sceneManifest.total_scenes_count = sceneManifest.scenes.length;
}

function runCompileAndQc(projectId) {
  spawnSync(
    "node",
    ["packages/qc-tools/generate-render-props.mjs", "--project", projectId],
    { cwd: ROOT_DIR, stdio: "inherit" }
  );
  spawnSync(
    "node",
    ["packages/qc-tools/run-qc.mjs", "--project", projectId],
    { cwd: ROOT_DIR, stdio: "inherit" }
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && pathname === "/") {
      const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "GET" && pathname === "/api/projects") {
      const projects = listProjects();
      return sendJson(res, 200, { projects, defaultProject: projects[0] || null });
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "GET" && projectMatch) {
      const projectId = projectMatch[1];
      const paths = getProjectPaths(projectId);
      if (!fs.existsSync(paths.sceneManifestPath)) {
        return sendJson(res, 404, { error: "Project not found" });
      }
      const sceneManifest = JSON.parse(
        fs.readFileSync(paths.sceneManifestPath, "utf8")
      );
      if (ensureSceneTableFields(sceneManifest)) {
        fs.writeFileSync(
          paths.sceneManifestPath,
          JSON.stringify(sceneManifest, null, 2),
          "utf8"
        );
      }
      const assetIndex = JSON.parse(
        fs.readFileSync(paths.assetIndexPath, "utf8")
      );
      const qcReport = fs.existsSync(paths.qcReportPath)
        ? JSON.parse(fs.readFileSync(paths.qcReportPath, "utf8"))
        : null;
      const promptConfig = fs.existsSync(paths.promptConfigPath)
        ? JSON.parse(fs.readFileSync(paths.promptConfigPath, "utf8"))
        : {
            global_ppt_prompt:
              "将当前镜头的【旁白原文】与【核心关键词】提炼为一页极简知识型 PPT 画面：生成 1 个直击核心机制的主标题（不超过 18 字），以及 2-3 条结构化要点。",
            updated_at: new Date().toISOString(),
          };

      return sendJson(res, 200, {
        projectId,
        sceneManifest,
        assetIndex,
        qcReport,
        promptConfig,
      });
    }

    const saveMatch = pathname.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/save$/
    );
    if (req.method === "POST" && saveMatch) {
      const projectId = saveMatch[1];
      const paths = getProjectPaths(projectId);
      const body = await readJsonBody(req);

      if (body.promptConfig) {
        fs.writeFileSync(
          paths.promptConfigPath,
          JSON.stringify(body.promptConfig, null, 2),
          "utf8"
        );
      }

      if (body.sceneManifest) {
        syncSceneTableToManifest(body.sceneManifest);
        fs.writeFileSync(
          paths.sceneManifestPath,
          JSON.stringify(body.sceneManifest, null, 2),
          "utf8"
        );
      }

      runCompileAndQc(projectId);

      const updatedManifest = JSON.parse(
        fs.readFileSync(paths.sceneManifestPath, "utf8")
      );
      const updatedAssetIndex = JSON.parse(
        fs.readFileSync(paths.assetIndexPath, "utf8")
      );
      const updatedQc = JSON.parse(fs.readFileSync(paths.qcReportPath, "utf8"));

      return sendJson(res, 200, {
        ok: true,
        sceneManifest: updatedManifest,
        assetIndex: updatedAssetIndex,
        qcReport: updatedQc,
      });
    }

    const generatePptMatch = pathname.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/generate-ppt$/
    );
    if (req.method === "POST" && generatePptMatch) {
      const projectId = generatePptMatch[1];
      const paths = getProjectPaths(projectId);
      const body = await readJsonBody(req);
      const { sceneId, globalPrompt, sceneManifest } = body;

      if (globalPrompt) {
        fs.writeFileSync(
          paths.promptConfigPath,
          JSON.stringify(
            {
              global_ppt_prompt: globalPrompt,
              updated_at: new Date().toISOString(),
            },
            null,
            2
          ),
          "utf8"
        );
      }

      const manifest =
        sceneManifest ||
        JSON.parse(fs.readFileSync(paths.sceneManifestPath, "utf8"));

      for (const scene of manifest.scenes) {
        if (sceneId && scene.scene_id !== sceneId) continue;
        if (!sceneId && scene.source_mode !== "ai_ppt_slide") continue;

        scene.source_mode = "ai_ppt_slide";
        const kws =
          Array.isArray(scene.content_keywords) &&
          scene.content_keywords.length > 0
            ? scene.content_keywords
            : ["核心概念"];
        const customPrompt = scene.ppt_slide_spec?.custom_prompt || "";
        const cleanNarration = scene.narration_text.replace(/[：。，！？]/g, " ").trim();

        // Generate structured PPT title & bullets from keywords + narration + prompt hint
        const mainKeyword = kws[0];
        const secondKeyword = kws[1] || "核心机制";
        const generatedTitle =
          kws.length >= 2
            ? `${mainKeyword} × ${secondKeyword}：${cleanNarration.slice(0, 12)}`
            : `${mainKeyword}：${cleanNarration.slice(0, 15)}`;

        const bullets = [
          `核心关键词：${kws.join(" · ")}`,
          `画面重点：${scene.visual_purpose.slice(0, 34)}`,
        ];
        if (customPrompt) {
          bullets.push(`Prompt 定向强调：${customPrompt}`);
        } else if (globalPrompt) {
          bullets.push(`按全局 PPT 规则提炼：${cleanNarration}`);
        }

        scene.ppt_slide_spec = {
          theme_title: generatedTitle,
          subtitle: scene.visual_purpose,
          bullet_points: bullets,
          custom_prompt: customPrompt,
        };
      }

      syncSceneTableToManifest(manifest);
      fs.writeFileSync(
        paths.sceneManifestPath,
        JSON.stringify(manifest, null, 2),
        "utf8"
      );
      runCompileAndQc(projectId);

      const updatedQc = JSON.parse(fs.readFileSync(paths.qcReportPath, "utf8"));
      return sendJson(res, 200, {
        ok: true,
        sceneManifest: manifest,
        qcReport: updatedQc,
      });
    }

    const uploadMatch = pathname.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/upload$/
    );
    if (req.method === "POST" && uploadMatch) {
      const projectId = uploadMatch[1];
      const paths = getProjectPaths(projectId);
      const body = await readJsonBody(req);
      const { sceneId, fileName, fileType, dataUrl } = body;

      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return sendJson(res, 400, { error: "Invalid dataUrl format" });
      }
      const buffer = Buffer.from(matches[2], "base64");
      const isVideo =
        fileType.startsWith("video/") ||
        fileName.toLowerCase().endsWith(".mp4") ||
        fileName.toLowerCase().endsWith(".mov") ||
        fileName.toLowerCase().endsWith(".webm");

      const subFolder = isVideo ? "assets/video" : "assets/images";
      const safeName = `${sceneId.toLowerCase()}_${Date.now()}_${fileName.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      )}`;
      const relAssetPath = `${subFolder}/${safeName}`;
      const fullDiskPath = path.join(paths.publicDir, relAssetPath);

      fs.mkdirSync(path.dirname(fullDiskPath), { recursive: true });
      fs.writeFileSync(fullDiskPath, buffer);

      const assetIndex = JSON.parse(
        fs.readFileSync(paths.assetIndexPath, "utf8")
      );
      const prefix = isVideo ? "AST-VID-" : "AST-IMG-";
      const nextNum = String(assetIndex.assets.length + 1).padStart(3, "0");
      const newAssetId = `${prefix}${nextNum}`;

      const newAsset = {
        asset_id: newAssetId,
        path: relAssetPath,
        file_path: `projects/${projectId}/public/${relAssetPath}`,
        type: isVideo ? "video" : "image",
        media_type: isVideo ? "video" : "image",
        duration_seconds: isVideo ? 8.0 : null,
        duration_sec: isVideo ? 8.0 : null,
        resolution: "1920x1080",
        license_status: "approved",
        source_url: `user_uploaded://${safeName}`,
        tags: ["人工上传", sceneId, fileName],
      };

      assetIndex.assets.push(newAsset);
      fs.writeFileSync(
        paths.assetIndexPath,
        JSON.stringify(assetIndex, null, 2),
        "utf8"
      );

      const sceneManifest = JSON.parse(
        fs.readFileSync(paths.sceneManifestPath, "utf8")
      );
      const targetScene = sceneManifest.scenes.find(
        (s) => s.scene_id === sceneId
      );
      if (targetScene) {
        targetScene.source_mode = "manual_upload";
        targetScene.visual_type = isVideo ? "broll_video" : "photo_motion";
        targetScene.scene_type = targetScene.visual_type;
        targetScene.final_asset_id = newAssetId;
        targetScene.confidence_score = 1.0;
        targetScene.status = "READY_APPROVED";
        targetScene.asset_status = "MATCHED_APPROVED_ASSET";
        targetScene.review_status = "approved_by_human";
      }

      syncSceneTableToManifest(sceneManifest);
      fs.writeFileSync(
        paths.sceneManifestPath,
        JSON.stringify(sceneManifest, null, 2),
        "utf8"
      );
      runCompileAndQc(projectId);

      const updatedQc = JSON.parse(fs.readFileSync(paths.qcReportPath, "utf8"));
      return sendJson(res, 200, {
        ok: true,
        uploadedAsset: newAsset,
        sceneManifest,
        assetIndex,
        qcReport: updatedQc,
      });
    }

    // Serve static project media files for inline preview
    const mediaMatch = pathname.match(
      /^\/media\/([a-zA-Z0-9_-]+)\/(.+)$/
    );
    if (req.method === "GET" && mediaMatch) {
      const projectId = mediaMatch[1];
      const relPath = mediaMatch[2];
      const fullPath = path.join(PROJECTS_ROOT, projectId, "public", relPath);
      if (!fs.existsSync(fullPath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const ext = path.extname(fullPath).toLowerCase();
      const mime =
        ext === ".mp4"
          ? "video/mp4"
          : ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".wav"
          ? "audio/wav"
          : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      return fs.createReadStream(fullPath).pipe(res);
    }

    sendJson(res, 404, { error: "Route not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(
    `WhyVideo Workflow Studio UI running at: http://localhost:${PORT}`
  );
});
