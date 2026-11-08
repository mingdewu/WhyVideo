import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";
import { MissingAssetScene } from "./MissingAssetScene";
import { TextOverlayLayer } from "./TextOverlayLayer";

export const BrollScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!track.approved_asset) {
    return <MissingAssetScene track={track} />;
  }

  const modifiers = track.media_modifiers;

  // 1. 视频起止裁剪 (非破坏性代码裁剪)
  const trimStartSec = modifiers?.trim_start_sec ?? 0;
  const trimEndSec = modifiers?.trim_end_sec;
  const startFrom = Math.round(trimStartSec * fps);
  const endAt = trimEndSec ? Math.round(trimEndSec * fps) : undefined;

  // 2. 视频滤镜 (亮度、对比度等)
  const filters = modifiers?.filters;
  const filterList: string[] = [];
  if (filters?.brightness && filters.brightness !== 1.0) {
    filterList.push(`brightness(${filters.brightness})`);
  }
  if (filters?.contrast && filters.contrast !== 1.0) {
    filterList.push(`contrast(${filters.contrast})`);
  }
  if (filters?.saturate && filters.saturate !== 1.0) {
    filterList.push(`saturate(${filters.saturate})`);
  }
  if (filters?.sepia) {
    filterList.push(`sepia(${filters.sepia})`);
  }
  if (filters?.grayscale) {
    filterList.push(`grayscale(${filters.grayscale})`);
  }
  if (filters?.blur_px) {
    filterList.push(`blur(${filters.blur_px}px)`);
  }
  if (filters?.hue_rotate_deg) {
    filterList.push(`hue-rotate(${filters.hue_rotate_deg}deg)`);
  }
  if (filters?.invert) {
    filterList.push(`invert(${filters.invert})`);
  }
  if (filters?.custom_css_filter) {
    filterList.push(filters.custom_css_filter);
  }
  const filterStr = filterList.length > 0 ? filterList.join(" ") : undefined;

  // 3. 运镜缩放与动力学
  const motion = modifiers?.motion;
  const motionFrames = motion?.duration_sec
    ? Math.round(motion.duration_sec * fps)
    : track.duration_in_frames;

  const scaleFrom = motion?.scale_from ?? 1.0;
  const scaleTo = motion?.scale_to ?? (motion?.motion_type === "zoom_out" ? 1.0 : motion?.motion_type === "zoom_in" ? 1.15 : 1.05);
  const scale = interpolate(
    frame,
    [0, motionFrames],
    [scaleFrom, scaleTo],
    { extrapolateRight: "clamp" }
  );

  const targetTranslateX = motion?.translate_x_px ?? 0;
  const translateX = interpolate(
    frame,
    [0, motionFrames],
    [0, targetTranslateX],
    { extrapolateRight: "clamp" }
  );

  const targetTranslateY = motion?.translate_y_px ?? 0;
  const translateY = interpolate(
    frame,
    [0, motionFrames],
    [0, targetTranslateY],
    { extrapolateRight: "clamp" }
  );

  const shakeOffset = motion?.motion_type === "shake" ? Math.sin(frame * 0.8) * 6 : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F1419", overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(track.approved_asset.src)}
        startFrom={startFrom}
        endAt={endAt}
        playbackRate={modifiers?.playback_rate ?? 1.0}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${translateX + shakeOffset}px, ${translateY}px)`,
          filter: filterStr,
        }}
        muted
      />

      {/* 顶层动效艺术字贴层 */}
      <TextOverlayLayer track={track} />

      <div
        style={{
          position: "absolute",
          top: 230,
          left: 160,
          right: 160,
          backgroundColor: "rgba(15, 20, 25, 0.86)",
          border: "2px solid #F59E0B",
          borderRadius: 14,
          padding: "28px 36px",
          fontFamily: FONT_STACK,
        }}
      >
        <div style={{ fontSize: 22, color: "#38BDF8", fontWeight: 700 }}>
          🎬 B-ROLL VIDEO · {track.approved_asset.asset_id} (
          {track.approved_asset.license_status})
          {trimStartSec > 0 || trimEndSec ? (
            <span style={{ marginLeft: 12, color: "#34D399" }}>
              ⏱️ 剪裁区间: {trimStartSec}s ~ {trimEndSec ?? "末尾"}s
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#F3F4F6",
            fontWeight: 800,
            marginTop: 10,
            lineHeight: 1.4,
          }}
        >
          {track.visual_purpose}
        </div>
        <div style={{ fontSize: 20, color: "#9CA3AF", marginTop: 12 }}>
          Must Show: {track.must_show.join(" | ")}
        </div>
      </div>
    </AbsoluteFill>
  );
};

