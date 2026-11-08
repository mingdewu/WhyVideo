import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const PROJECTS_ROOT = path.join(ROOT_DIR, "projects");
const PORT = Number(process.env.WORKFLOW_PORT || 3200);

// 获取已配置的 LLM API Key (优先 prompt-config.json, 其次系统环境变量)
function getEffectiveLlmConfig(projectId) {
  let apiKey = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  let baseUrl = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim().replace(/\/+$/, "");
  let model = (process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat").trim();

  try {
    const paths = getProjectPaths(projectId);
    if (fs.existsSync(paths.promptConfigPath)) {
      const cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, "utf8"));
      if (cfg.apiKey) apiKey = cfg.apiKey.trim();
      if (cfg.baseUrl) baseUrl = cfg.baseUrl.trim().replace(/\/+$/, "");
      if (cfg.textModel) model = cfg.textModel.trim();
    }
  } catch (e) {}

  return { apiKey, baseUrl, model };
}

// 纯文本规则解析降级引擎 (免 Key 或离线时 100% 极速稳定命中)
function parsePromptWithRules(prompt, hasAsset, assetType) {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  // 1. 判断是否需要切换为程序化场景（表格/图表/流程图/对比）
  const isTableOrData = /数据|表格|分析|占比|指标|统计|金额|增长/.test(p);
  const isFlowOrTimeline = /流程|步骤|时间线|演进|脉络|先.*后|第一.*第二/.test(p);
  const isVersus = /对比|对决|pk|差异|优缺点|双方/.test(p);
  const isKinetic = /大字|震撼|快闪|冲击|标语|口号/.test(p);

  // 如果没有素材，或者明确要求制作图表/流程
  if (!hasAsset || (!p.includes("剪") && !p.includes("秒") && !p.includes("放") && !p.includes("亮") && (isTableOrData || isFlowOrTimeline || isVersus || isKinetic))) {
    if (isFlowOrTimeline) {
      return {
        action: "switch_procedural",
        scene_type: "timeline",
        procedural_props: {
          badge_label: "流程演进",
          headline: p.slice(0, 18),
          subheadline: "系统自动化关键环节解析",
          items: ["初始阶段：约束建立", "推进阶段：机制执行", "闭环阶段：成果沉淀"],
        },
      };
    }
    if (isVersus) {
      return {
        action: "switch_procedural",
        scene_type: "versus_dual",
        procedural_props: {
          badge_label: "维度对比",
          headline: p.slice(0, 18),
          subheadline: "核心指标对决",
          items: ["方案 A / 传统惯性模式", "方案 B / 现代自适应范式"],
        },
      };
    }
    if (isTableOrData) {
      return {
        action: "switch_procedural",
        scene_type: "data_card",
        procedural_props: {
          badge_label: "数据看板",
          headline: p.slice(0, 18),
          subheadline: "关键指标量化统计",
          items: ["核心指标 01：大幅提升", "核心指标 02：降本增效", "综合评级：深度达标"],
        },
      };
    }
    return {
      action: "switch_procedural",
      scene_type: "kinetic_text",
      procedural_props: {
        badge_label: "重点强调",
        headline: p.slice(0, 16),
        subheadline: "核心逻辑透传",
        items: [p.slice(0, 20)],
      },
    };
  }

  // 2. 有素材场景：提取视频裁剪 (如 "8-15秒", "7到12秒", "从第5秒开始剪3秒")
  let trim_start_sec = 0;
  let trim_end_sec = undefined;

  const rangeMatch = p.match(/(\d+(?:\.\d+)?)\s*(?:-|至|到)\s*(\d+(?:\.\d+)?)\s*秒?/);
  if (rangeMatch) {
    trim_start_sec = parseFloat(rangeMatch[1]);
    trim_end_sec = parseFloat(rangeMatch[2]);
  } else {
    const singleMatch = p.match(/(\d+(?:\.\d+)?)\s*秒/);
    if (singleMatch && (p.includes("前") || p.includes("截取") || p.includes("持续"))) {
      trim_end_sec = parseFloat(singleMatch[1]);
    }
  }

  // 3. 滤镜提取 (如 "亮一点", "对比度高", "复古", "黑白")
  const filters = {};
  if (p.includes("亮") || p.includes("明亮") || p.includes("曝光")) {
    filters.brightness = 1.25;
  } else if (p.includes("暗") || p.includes("压暗")) {
    filters.brightness = 0.85;
  }
  if (p.includes("对比")) {
    filters.contrast = 1.2;
  }
  if (p.includes("复古") || p.includes("胶片")) {
    filters.sepia = 0.35;
    filters.contrast = 1.1;
  }
  if (p.includes("黑白")) {
    filters.grayscale = 1.0;
  }

  // 4. 图片运镜提取 (如 "缓慢放大", "持续3秒", "向左平移")
  let motion = undefined;
  if (assetType === "image" || p.includes("放大") || p.includes("缩小") || p.includes("平移") || p.includes("推")) {
    let duration_sec = 3.0;
    const durMatch = p.match(/持续\s*(\d+(?:\.\d+)?)\s*秒/);
    if (durMatch) duration_sec = parseFloat(durMatch[1]);

    if (p.includes("缩小") || p.includes("拉远")) {
      motion = { motion_type: "zoom_out", duration_sec, scale_from: 1.15, scale_to: 1.0 };
    } else if (p.includes("左")) {
      motion = { motion_type: "pan_left", duration_sec, translate_x_px: -50 };
    } else if (p.includes("右")) {
      motion = { motion_type: "pan_right", duration_sec, translate_x_px: 50 };
    } else {
      // 默认缓慢放大
      motion = { motion_type: "zoom_in", duration_sec, scale_from: 1.0, scale_to: 1.18 };
    }
  }

  // 5. 艺术字/弹跳文字提取 (如 “为什么会这样呢” 从左边弹出震惊效果)
  const text_overlays = [];
  const quoteMatch = p.match(/["“'‘]([^"”'’]+)["”'’]/);
  const shockMatch = /震惊|惊讶|弹|突出|标语|警告/.test(p);
  if (quoteMatch || shockMatch) {
    const textContent = quoteMatch ? quoteMatch[1] : p.split(/[,，！!]/)[0].slice(0, 14);
    let animation = "pop_bounce";
    if (p.includes("左") || p.includes("滑入")) animation = "slide_from_left";
    if (p.includes("震") || p.includes("惊")) animation = "shock_shake";

    text_overlays.push({
      text: textContent,
      style: shockMatch ? "dramatic_shock" : "neon_glow",
      animation,
      position: animation === "slide_from_left" ? "center_left" : "center",
      start_frame: 10,
      duration_frames: 90,
    });
  }

  return {
    action: "media_modifiers",
    media_modifiers: {
      trim_start_sec: trim_start_sec || undefined,
      trim_end_sec: trim_end_sec || undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      motion,
      text_overlays: text_overlays.length > 0 ? text_overlays : undefined,
    },
  };
}

// 调度 LLM（若可用）或自动降级为精准规则引擎
async function parsePromptWithAiOrRules(prompt, hasAsset, assetType, projectId) {
  const { apiKey, baseUrl, model } = getEffectiveLlmConfig(projectId);

  if (apiKey && apiKey !== "antigravity-local-dev" && !baseUrl.includes("localhost")) {
    try {
      const systemPrompt = `你是一个专业的 Remotion 视频代码与动效参数编译器。
用户拖入了素材或输入了自然语言剪辑/排版意向。
请务必返回且仅返回一个合法的 JSON 对象，不要添加任何 markdown 代码块标记，不要额外废话。
JSON 格式规范：
{
  "action": "media_modifiers" | "switch_procedural",
  "scene_type": "data_card" | "timeline" | "versus_dual" | "kinetic_text" (仅在 switch_procedural 时有效),
  "media_modifiers": {
    "trim_start_sec": number,
    "trim_end_sec": number,
    "filters": { "brightness": 1.25, "contrast": 1.1, "sepia": 0.3, "grayscale": 1.0 },
    "motion": { "motion_type": "zoom_in", "duration_sec": 3.0, "scale_from": 1.0, "scale_to": 1.15, "translate_x_px": -30 },
    "text_overlays": [
      {
        "text": "文字内容",
        "style": "dramatic_shock" | "warning_badge" | "neon_glow" | "minimal_clean",
        "animation": "slide_from_left" | "pop_bounce" | "shock_shake" | "fade_in",
        "position": "center" | "center_left" | "top_left"
      }
    ]
  },
  "procedural_props": {
    "badge_label": "标签",
    "headline": "主标题",
    "subheadline": "副标题",
    "items": ["要点1", "要点2", "要点3"]
  }
}`;

      const userPrompt = `用户指令: "${prompt}"\n当前素材状态: ${hasAsset ? `已绑定${assetType === 'video' ? '视频' : '图片'}` : '无素材 (纯文字排版)'}`;

      const fetchUrl = `${baseUrl}/chat/completions`;
      const response = await fetch(fetchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content?.trim();
        if (rawContent) {
          const cleanJson = rawContent.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
          const parsed = JSON.parse(cleanJson);
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[AI Parser] LLM API 发生波动，已平滑无感切回本地高保真语义编译器:", err.message);
    }
  }

  // 默认极速高可靠语义规则编译器
  return parsePromptWithRules(prompt, hasAsset, assetType);
}

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

    // AI 智能指令解析与动态特效应用接口 (支持拖拽素材提示 / 纯文本数据生成)
    const aiParseMatch = pathname.match(
      /^\/api\/projects\/([a-zA-Z0-9_-]+)\/ai-intent$/
    );
    if (req.method === "POST" && aiParseMatch) {
      const projectId = aiParseMatch[1];
      const paths = getProjectPaths(projectId);
      const body = await readJsonBody(req);
      const { sceneId, prompt, hasAsset, assetType } = body;

      if (!prompt || !prompt.trim()) {
        return sendJson(res, 400, { error: "Prompt is required" });
      }

      // 解析自然语言意图为 Remotion 执行结构
      const parsedIntent = await parsePromptWithAiOrRules(
        prompt,
        Boolean(hasAsset),
        assetType || "video",
        projectId
      );

      const sceneManifest = JSON.parse(
        fs.readFileSync(paths.sceneManifestPath, "utf8")
      );
      const targetScene = sceneManifest.scenes.find(
        (s) => s.scene_id === sceneId
      );

      if (!targetScene) {
        return sendJson(res, 404, { error: "Scene not found" });
      }

      // 根据 AI 意图修改 targetScene
      if (parsedIntent.action === "switch_procedural") {
        targetScene.source_mode = "ai_ppt_slide";
        targetScene.visual_type = parsedIntent.scene_type || "data_card";
        targetScene.scene_type = targetScene.visual_type;
        targetScene.final_asset_id = null;
        targetScene.status = "READY_PROCEDURAL";
        targetScene.asset_status = "PROCEDURAL_GRAPHIC_COMPONENT";
        targetScene.procedural_props = {
          badge_label: parsedIntent.procedural_props?.badge_label || "AI 智能排版",
          headline: parsedIntent.procedural_props?.headline || prompt.slice(0, 18),
          subheadline: parsedIntent.procedural_props?.subheadline || targetScene.visual_purpose,
          items: parsedIntent.procedural_props?.items || [prompt],
        };
        targetScene.ppt_slide_spec = {
          theme_title: targetScene.procedural_props.headline,
          subtitle: targetScene.procedural_props.subheadline,
          bullet_points: targetScene.procedural_props.items,
          custom_prompt: prompt,
        };
      } else {
        // media_modifiers
        targetScene.media_modifiers = parsedIntent.media_modifiers || {};
        if (targetScene.ppt_slide_spec) {
          targetScene.ppt_slide_spec.custom_prompt = prompt;
        }
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
        parsedIntent,
        sceneManifest,
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
