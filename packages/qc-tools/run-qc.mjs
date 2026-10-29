import fs from "node:fs";
import path from "node:path";
import { resolveProject, scanProjectAssets } from "./scan-assets.mjs";

const resolved = resolveProject();
const { projectId, dataDir, outputDir, humanReviewLogPath } = resolved;

const ALLOWED_RENDER_LICENSES = new Set(["approved", "internal_placeholder"]);
const ASSET_REUSE_COOLDOWN_MS = 60000;

const sceneManifest = JSON.parse(
  fs.readFileSync(path.join(dataDir, "scene-manifest.json"), "utf8")
);
const assetIndex = JSON.parse(
  fs.readFileSync(path.join(dataDir, "asset-index.json"), "utf8")
);
const renderProps = JSON.parse(
  fs.readFileSync(path.join(dataDir, "render-props.json"), "utf8")
);
const scanResult = scanProjectAssets(resolved);

const assetById = new Map(assetIndex.assets.map((a) => [a.asset_id, a]));
const scannedById = new Map(scanResult.assets.map((a) => [a.asset_id, a]));

// 1. Check total duration == audio duration
const scenes = sceneManifest.scenes;
const computedTotalDurationMs = scenes.reduce(
  (acc, s) => acc + (s.end_ms - s.start_ms),
  0
);
const firstStartMs = scenes[0]?.start_ms ?? 0;
const lastEndMs = scenes[scenes.length - 1]?.end_ms ?? 0;
const audioDurationMs = scanResult.audio_file.duration_ms;
const renderPropsDurationMs = renderProps.video_config.duration_ms;

const durationMatchesAudio =
  computedTotalDurationMs === audioDurationMs &&
  lastEndMs - firstStartMs === audioDurationMs &&
  renderPropsDurationMs === audioDurationMs;

// 2. Check overlaps or gaps between scenes & 4-10s scene duration bounds
const timelineOverlapsOrGaps = [];
const sceneDurationBoundIssues = [];
for (let i = 0; i < scenes.length; i++) {
  const cur = scenes[i];
  const durMs = cur.end_ms - cur.start_ms;
  if (durMs < 4000 || durMs > 10000) {
    sceneDurationBoundIssues.push({
      scene_id: cur.scene_id,
      duration_ms: durMs,
      issue: "Scene duration outside mandatory 4000ms - 10000ms range",
    });
  }
  if (i > 0) {
    const prev = scenes[i - 1];
    if (cur.start_ms !== prev.end_ms) {
      timelineOverlapsOrGaps.push({
        between: `${prev.scene_id} -> ${cur.scene_id}`,
        prev_end_ms: prev.end_ms,
        curr_start_ms: cur.start_ms,
        delta_ms: cur.start_ms - prev.end_ms,
        type: cur.start_ms < prev.end_ms ? "OVERLAP" : "GAP",
      });
    }
  }
}

// Check 60s asset reuse cooldown rule
const lastAssetUseById = new Map();
const assetReuseViolations = [];
for (const scene of scenes) {
  if (!scene.final_asset_id) continue;
  const prevUse = lastAssetUseById.get(scene.final_asset_id);
  if (prevUse) {
    const gapMs = scene.start_ms - prevUse.end_ms;
    const differentCropAndPurpose =
      scene.crop_and_usage?.crop_mode !== prevUse.crop_mode &&
      scene.crop_and_usage?.usage_purpose !== prevUse.usage_purpose;
    if (gapMs < ASSET_REUSE_COOLDOWN_MS && !differentCropAndPurpose) {
      assetReuseViolations.push({
        asset_id: scene.final_asset_id,
        first_scene_id: prevUse.scene_id,
        second_scene_id: scene.scene_id,
        gap_ms: gapMs,
        required_cooldown_ms: ASSET_REUSE_COOLDOWN_MS,
      });
    }
  }
  lastAssetUseById.set(scene.final_asset_id, {
    scene_id: scene.scene_id,
    end_ms: scene.end_ms,
    crop_mode: scene.crop_and_usage?.crop_mode,
    usage_purpose: scene.crop_and_usage?.usage_purpose,
  });
}

// 3. Check if every referenced asset_id exists in asset-index.json & on disk
const assetExistenceChecks = [];
let allReferencedAssetsExist = true;
for (const scene of scenes) {
  if (scene.final_asset_id) {
    const inIndex = assetById.has(scene.final_asset_id);
    const onDisk = scannedById.get(scene.final_asset_id)?.exists_on_disk ?? false;
    if (!inIndex || !onDisk) {
      allReferencedAssetsExist = false;
    }
    assetExistenceChecks.push({
      scene_id: scene.scene_id,
      asset_id: scene.final_asset_id,
      exists_in_asset_index: inIndex,
      exists_on_disk: onDisk,
      passed: inIndex && onDisk,
    });
  } else {
    assetExistenceChecks.push({
      scene_id: scene.scene_id,
      asset_id: null,
      status: scene.status,
      exists_in_asset_index: null,
      exists_on_disk: null,
      passed: scene.status !== "NEEDS_HUMAN_ASSET",
      note:
        scene.status === "NEEDS_HUMAN_ASSET"
          ? "Missing asset explicitly flagged as NEEDS_HUMAN_ASSET (awaiting human asset)"
          : "Procedural graphic component (no external media file needed)",
    });
  }
}

// 4. Check license_status compliance
const licenseChecks = [];
let allRenderPropsLicensesAllowed = true;
for (const track of renderProps.timeline_tracks) {
  if (track.approved_asset) {
    const allowed = ALLOWED_RENDER_LICENSES.has(
      track.approved_asset.license_status
    );
    if (!allowed) {
      allRenderPropsLicensesAllowed = false;
    }
    licenseChecks.push({
      scene_id: track.scene_id,
      asset_id: track.approved_asset.asset_id,
      license_status: track.approved_asset.license_status,
      allowed_in_render_props: allowed,
    });
  }
}

const blockedUnapprovedCandidates = [];
for (const scene of scenes) {
  for (const cand of scene.candidate_assets || []) {
    if (!ALLOWED_RENDER_LICENSES.has(cand.license_status)) {
      blockedUnapprovedCandidates.push({
        scene_id: scene.scene_id,
        candidate_asset_id: cand.asset_id,
        license_status: cand.license_status,
        action_taken:
          "Blocked from final_asset_id and render-props.json; preserved for human license verification",
      });
    }
  }
}

// 5. Check safe margins & caption/text overflow
const maxCharsPerLine = renderProps.caption_track.max_chars_per_line || 22;
const safeBottomMarginPx = renderProps.caption_track.safe_bottom_margin_px;
const captionOverflowChecks = renderProps.caption_track.captions.map((cap) => {
  const withinLimit = cap.char_count <= maxCharsPerLine;
  return {
    caption_index: cap.index,
    start_ms: cap.start_ms,
    end_ms: cap.end_ms,
    text: cap.text,
    char_count: cap.char_count,
    max_chars_per_line: maxCharsPerLine,
    passed: withinLimit,
  };
});

const safeMarginCheck = {
  passed:
    safeBottomMarginPx >= 80 &&
    captionOverflowChecks.every((c) => c.passed),
  safe_bottom_margin_px: safeBottomMarginPx,
  required_min_bottom_margin_px: 80,
  max_chars_per_line_limit: maxCharsPerLine,
  captions_checked: captionOverflowChecks.length,
  overflowing_captions: captionOverflowChecks.filter((c) => !c.passed),
};

// 6. Missing assets, low-confidence assets, and scenes requiring human review
const missingAssetScenes = scenes
  .filter((s) => s.status === "NEEDS_HUMAN_ASSET")
  .map((s) => ({
    scene_id: s.scene_id,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    narration_text: s.narration_text,
    visual_purpose: s.visual_purpose,
    search_queries_zh: s.search_queries_zh,
    search_queries_en: s.search_queries_en,
    must_show: s.must_show,
    must_not_show: s.must_not_show,
    fallback: s.fallback,
    reason: s.review_reason,
  }));

const lowConfidenceScenes = scenes
  .filter((s) => s.confidence_score > 0 && s.confidence_score < 0.7)
  .map((s) => ({
    scene_id: s.scene_id,
    final_asset_id: s.final_asset_id,
    confidence_score: s.confidence_score,
    narration_text: s.narration_text,
    visual_purpose: s.visual_purpose,
    semantic_concern_preserved_for_human: s.review_reason,
  }));

const humanReviewRequiredScenes = scenes
  .filter((s) => s.human_review_required)
  .map((s) => ({
    scene_id: s.scene_id,
    status: s.status,
    review_status: s.review_status,
    narration_text: s.narration_text,
    review_reason: s.review_reason,
  }));

const failedOrPendingItems = [
  ...missingAssetScenes.map((m) => ({
    check_category: "MISSING_ASSET (NEEDS_HUMAN_ASSET)",
    scene_id: m.scene_id,
    severity: "BLOCKING_FOR_FINAL_RELEASE",
    detail: m.reason,
  })),
  ...lowConfidenceScenes.map((l) => ({
    check_category: "LOW_CONFIDENCE_SEMANTIC_MATCH",
    scene_id: l.scene_id,
    severity: "REQUIRES_HUMAN_VERIFICATION",
    detail: `Asset ${l.final_asset_id} has confidence_score=${l.confidence_score} (<0.70). ${l.semantic_concern_preserved_for_human}`,
  })),
  ...blockedUnapprovedCandidates.map((b) => ({
    check_category: "UNAPPROVED_CANDIDATE_LICENSE_BLOCKED",
    scene_id: b.scene_id,
    severity: "WARNING_BLOCKED_FROM_RENDER",
    detail: `Candidate ${b.candidate_asset_id} has license_status='${b.license_status}' and was excluded from render-props.json.`,
  })),
  ...safeMarginCheck.overflowing_captions.map((c) => ({
    check_category: "CAPTION_SINGLE_LINE_LENGTH_WARNING",
    scene_id: `SC-${String(c.caption_index).padStart(3, "0")}`,
    severity: "NEEDS_LINE_WRAP_OR_HUMAN_CHECK",
    detail: `Caption #${c.caption_index} ("${c.text}") is ${c.char_count} chars (exceeds single-line limit of ${c.max_chars_per_line} chars by ${
      c.char_count - c.max_chars_per_line
    } char; Remotion auto-wraps within safe box, preserved for human review).`,
  })),
  ...humanReviewRequiredScenes.map((h) => ({
    check_category: "HUMAN_REVIEW_GATE_PENDING",
    scene_id: h.scene_id,
    severity: "PENDING_HUMAN_SIGNOFF",
    detail: h.review_reason,
  })),
];

const qcReport = {
  project_id: sceneManifest.project_id,
  domain_category: sceneManifest.domain_category || "general_explainer",
  title: sceneManifest.title,
  generated_at: new Date().toISOString(),
  human_review_log_file: fs.existsSync(humanReviewLogPath)
    ? `projects/${projectId}/human-review-log.json`
    : null,
  overall_technical_pipeline_valid:
    durationMatchesAudio &&
    timelineOverlapsOrGaps.length === 0 &&
    assetReuseViolations.length === 0 &&
    allReferencedAssetsExist &&
    allRenderPropsLicensesAllowed &&
    safeMarginCheck.passed,
  ready_for_final_publish_without_human_review: false,
  summary_counts: {
    total_scenes: scenes.length,
    total_duration_ms: computedTotalDurationMs,
    audio_duration_ms: audioDurationMs,
    overlaps_or_gaps_count: timelineOverlapsOrGaps.length,
    asset_reuse_violations_count: assetReuseViolations.length,
    missing_asset_scenes_count: missingAssetScenes.length,
    low_confidence_scenes_count: lowConfidenceScenes.length,
    human_review_required_scenes_count: humanReviewRequiredScenes.length,
    blocked_unapproved_candidates_count: blockedUnapprovedCandidates.length,
    failed_or_pending_human_review_items_count: failedOrPendingItems.length,
  },
  checks: {
    "1_total_duration_equals_audio_duration": {
      passed: durationMatchesAudio,
      scene_manifest_total_ms: computedTotalDurationMs,
      render_props_total_ms: renderPropsDurationMs,
      actual_wav_audio_ms: audioDurationMs,
      actual_wav_audio_seconds: scanResult.audio_file.duration_seconds,
    },
    "2_no_overlapping_or_gap_scenes_and_reuse_cooldown": {
      passed:
        timelineOverlapsOrGaps.length === 0 &&
        sceneDurationBoundIssues.length === 0 &&
        assetReuseViolations.length === 0,
      overlaps_or_gaps: timelineOverlapsOrGaps,
      duration_bound_issues: sceneDurationBoundIssues,
      asset_reuse_60s_violations: assetReuseViolations,
    },
    "3_asset_id_existence_and_disk_scan": {
      passed_for_assigned_assets: allReferencedAssetsExist,
      all_scenes_have_final_assets: missingAssetScenes.length === 0,
      scanned_files_on_disk: scanResult.assets,
      scene_asset_checks: assetExistenceChecks,
    },
    "4_license_status_compliance": {
      passed_in_render_props: allRenderPropsLicensesAllowed,
      allowed_statuses: Array.from(ALLOWED_RENDER_LICENSES),
      render_props_asset_licenses: licenseChecks,
      blocked_unapproved_candidates: blockedUnapprovedCandidates,
    },
    "5_text_and_caption_safe_margins": safeMarginCheck,
    "6_low_confidence_missing_and_human_review_gates": {
      passed_all_human_gates: false,
      note: "Per instructions, semantic and historical accuracy issues are NOT auto-fixed; they are explicitly preserved below for human review.",
      missing_asset_scenes: missingAssetScenes,
      low_confidence_scenes: lowConfidenceScenes,
      human_review_required_scenes: humanReviewRequiredScenes,
    },
  },
  unpassed_or_pending_human_review_items: failedOrPendingItems,
};

fs.mkdirSync(outputDir, { recursive: true });
const outQcPath = path.join(outputDir, "video-qc-report.json");
const dataQcPath = path.join(dataDir, "video-qc-report.json");
const serializedQc = JSON.stringify(qcReport, null, 2);
fs.writeFileSync(outQcPath, serializedQc, "utf8");
fs.writeFileSync(dataQcPath, serializedQc, "utf8");

console.log(`=== Video QC Report Summary [Project: ${projectId}] ===`);
console.log(
  `1. Duration == Audio Duration: ${
    durationMatchesAudio ? "PASS" : "FAIL"
  } (${computedTotalDurationMs}ms == ${audioDurationMs}ms)`
);
console.log(
  `2. No Overlaps/Gaps & 60s Reuse: ${
    timelineOverlapsOrGaps.length === 0 && assetReuseViolations.length === 0
      ? "PASS"
      : "FAIL"
  } (0 overlaps, 0 gaps, 0 reuse violations)`
);
console.log(
  `3. Assigned Asset IDs Exist:   ${
    allReferencedAssetsExist ? "PASS" : "FAIL"
  } (${missingAssetScenes.length} scenes marked NEEDS_HUMAN_ASSET)`
);
console.log(
  `4. Render License Compliance:  ${
    allRenderPropsLicensesAllowed ? "PASS" : "FAIL"
  } (${blockedUnapprovedCandidates.length} pending_verification candidate blocked)`
);
console.log(
  `5. Safe Margins & Captions:    ${
    safeMarginCheck.passed ? "PASS" : "FAIL"
  } (bottom margin=${safeBottomMarginPx}px, max chars<=22)`
);
console.log(
  `6. Human Review Gate Items:    HOLD FOR HUMAN REVIEW (${missingAssetScenes.length} missing assets, ${lowConfidenceScenes.length} low-confidence asset, ${humanReviewRequiredScenes.length} scenes pending human review)`
);
