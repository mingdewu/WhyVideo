import fs from "node:fs";
import path from "node:path";
import { resolveProject } from "./scan-assets.mjs";

const { projectId, dataDir, publicDir } = resolveProject();

const projectConfigPath = path.join(dataDir, "project-config.json");
const projectConfig = fs.existsSync(projectConfigPath)
  ? JSON.parse(fs.readFileSync(projectConfigPath, "utf8"))
  : {};

const FPS = projectConfig.video_spec?.fps ?? 30;
const WIDTH = projectConfig.video_spec?.width ?? 1920;
const HEIGHT = projectConfig.video_spec?.height ?? 1080;
const SAFE_BOTTOM_MARGIN_PX =
  projectConfig.video_spec?.safe_bottom_margin_px ?? 96;
const MAX_CHARS_PER_LINE = projectConfig.video_spec?.max_chars_per_line ?? 22;

const ALLOWED_LICENSES = new Set(["approved", "internal_placeholder"]);

const sceneManifest = JSON.parse(
  fs.readFileSync(path.join(dataDir, "scene-manifest.json"), "utf8")
);
const assetIndex = JSON.parse(
  fs.readFileSync(path.join(dataDir, "asset-index.json"), "utf8")
);
const srtRaw = fs.readFileSync(
  path.join(publicDir, sceneManifest.captions_file || "captions/captions.srt"),
  "utf8"
);

const assetMap = new Map();
for (const asset of assetIndex.assets) {
  assetMap.set(asset.asset_id, asset);
}

function parseSrtTimeToMs(timeStr) {
  const [hms, msStr] = timeStr.trim().split(",");
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + Number(msStr);
}

function parseSrt(srtText) {
  const blocks = srtText.trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.trim().split("\n");
      if (lines.length < 3) return null;
      const index = Number(lines[0]);
      const [startStr, endStr] = lines[1].split("-->");
      const text = lines.slice(2).join("\n");
      const start_ms = parseSrtTimeToMs(startStr);
      const end_ms = parseSrtTimeToMs(endStr);
      return {
        index,
        start_ms,
        end_ms,
        from_frame: Math.round((start_ms / 1000) * FPS),
        duration_in_frames: Math.round(((end_ms - start_ms) / 1000) * FPS),
        text,
        char_count: text.length,
      };
    })
    .filter(Boolean);
}

const captions = parseSrt(srtRaw);

const blockingReasons = [];
const timelineTracks = sceneManifest.scenes.map((scene) => {
  const from_frame = Math.round((scene.start_ms / 1000) * FPS);
  const end_frame = Math.round((scene.end_ms / 1000) * FPS);
  const duration_in_frames = end_frame - from_frame;

  let resolvedAsset = null;
  let render_mode = "procedural_component";

  if (
    scene.status === "NEEDS_HUMAN_ASSET" ||
    scene.asset_status === "NEEDS_HUMAN_ASSET"
  ) {
    render_mode = "placeholder_awaiting_human_asset";
    blockingReasons.push(
      `${scene.scene_id}: Missing high-confidence asset (status=NEEDS_HUMAN_ASSET). Reason: ${scene.review_reason}`
    );
  } else if (scene.final_asset_id) {
    const assetEntry = assetMap.get(scene.final_asset_id);
    if (!assetEntry) {
      throw new Error(
        `Scene ${scene.scene_id} references non-existent asset_id: ${scene.final_asset_id}`
      );
    }
    if (!ALLOWED_LICENSES.has(assetEntry.license_status)) {
      throw new Error(
        `Scene ${scene.scene_id} references disallowed license_status '${assetEntry.license_status}' on ${scene.final_asset_id}`
      );
    }
    render_mode =
      assetEntry.license_status === "approved"
        ? "approved_media_asset"
        : "internal_placeholder_media_asset";

    resolvedAsset = {
      asset_id: assetEntry.asset_id,
      src: assetEntry.path,
      type: assetEntry.type,
      resolution: assetEntry.resolution,
      duration_seconds: assetEntry.duration_seconds,
      license_status: assetEntry.license_status,
      crop_mode: scene.crop_and_usage?.crop_mode || "full_frame_slow_push",
      confidence_score: scene.confidence_score ?? 1.0,
    };
  }

  if (scene.confidence_score > 0 && scene.confidence_score < 0.7) {
    blockingReasons.push(
      `${scene.scene_id}: Low-confidence asset (${scene.final_asset_id}, score=${scene.confidence_score}) requires human verification.`
    );
  }

  if (scene.human_review_required) {
    blockingReasons.push(
      `${scene.scene_id}: Human review required (${scene.review_status}). ${scene.review_reason}`
    );
  }

  const manifestProcedural = scene.procedural_props || {};
  const pptSpec = scene.ppt_slide_spec || {};
  const proceduralProps = {
    badge_label:
      manifestProcedural.badge_label ||
      `${(scene.visual_type || scene.scene_type || "DATA_CARD").toUpperCase()} · ${
        scene.chapter_ref || scene.scene_id
      }`,
    headline:
      manifestProcedural.headline ||
      pptSpec.theme_title ||
      scene.fallback?.component_spec ||
      scene.narration_text,
    subheadline:
      manifestProcedural.subheadline ||
      pptSpec.subtitle ||
      scene.visual_purpose,
    fallback_scene_type:
      scene.fallback?.fallback_scene_type || "data_card",
    component_spec: scene.fallback?.component_spec || "",
    items:
      Array.isArray(manifestProcedural.items) && manifestProcedural.items.length > 0
        ? manifestProcedural.items
        : Array.isArray(pptSpec.bullet_points) && pptSpec.bullet_points.length > 0
        ? pptSpec.bullet_points
        : scene.must_show || [],
    nodes: Array.isArray(manifestProcedural.nodes)
      ? manifestProcedural.nodes
      : [],
  };

  return {
    scene_id: scene.scene_id,
    chapter_ref: scene.chapter_ref || "section",
    is_final_ending: Boolean(scene.is_final_ending),
    start_ms: scene.start_ms,
    end_ms: scene.end_ms,
    from_frame,
    duration_in_frames,
    visual_type: scene.visual_type || scene.scene_type,
    scene_type: scene.scene_type || scene.visual_type,
    status: scene.status,
    render_mode,
    narration_text: scene.narration_text,
    visual_purpose: scene.visual_purpose || scene.visual_intent,
    human_review_required: Boolean(scene.human_review_required),
    review_status: scene.review_status || "pending_human_review",
    review_reason: scene.review_reason || "",
    confidence_score: scene.confidence_score ?? 1.0,
    search_queries_zh: scene.search_queries_zh || [],
    search_queries_en: scene.search_queries_en || [],
    must_show: scene.must_show || [],
    must_not_show: scene.must_not_show || [],
    fallback: scene.fallback,
    approved_asset: resolvedAsset,
    procedural_props: proceduralProps,
    transition: scene.transition || {
      in: "cut",
      out: "cut",
      duration_frames: 10,
    },
  };
});

const totalDurationFrames = Math.round(
  (sceneManifest.total_duration_ms / 1000) * FPS
);

const renderProps = {
  composition_id: "WhyExplainerMVP",
  project_id: sceneManifest.project_id,
  domain_category:
    sceneManifest.domain_category ||
    projectConfig.domain_category ||
    "general_explainer",
  title: sceneManifest.title,
  ready_for_final_render: blockingReasons.length === 0,
  blocking_reasons: blockingReasons,
  video_config: {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    duration_in_frames: totalDurationFrames,
    duration_ms: sceneManifest.total_duration_ms,
    duration_sec: sceneManifest.total_duration_sec,
    safe_margin_px: {
      top: 72,
      bottom: SAFE_BOTTOM_MARGIN_PX,
      left: 96,
      right: 96,
    },
    theme_palette: {
      background: "#0F1419",
      primary_text: "#F3F4F6",
      accent: "#F59E0B",
      muted_text: "#9CA3AF",
      danger: "#EF4444",
      warning: "#F97316",
    },
  },
  audio_track: {
    src: sceneManifest.audio_file,
    start_from_frame: 0,
    end_at_frame: totalDurationFrames,
    duration_ms: sceneManifest.total_duration_ms,
    volume: 1.0,
    unauthorized_bgm_present: false,
  },
  caption_track: {
    srt_src: sceneManifest.captions_file,
    safe_bottom_margin_px: SAFE_BOTTOM_MARGIN_PX,
    max_chars_per_line: MAX_CHARS_PER_LINE,
    captions,
  },
  timeline_tracks: timelineTracks,
};

const dataOutPath = path.join(dataDir, "render-props.json");
const publicOutPath = path.join(publicDir, "render-props.json");
const serialized = JSON.stringify(renderProps, null, 2);
fs.writeFileSync(dataOutPath, serialized, "utf8");
fs.writeFileSync(publicOutPath, serialized, "utf8");

console.log(
  `[generate-render-props] Project=${projectId} -> ${dataOutPath} & ${publicOutPath} (${timelineTracks.length} scenes, ${totalDurationFrames} frames @ ${FPS}fps)`
);
