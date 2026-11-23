import { mediaFilterStyle } from "../media-filters";
import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TimelineTrackProp } from "../types";
import { MissingAssetScene } from "./MissingAssetScene";

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
  const filterStr = mediaFilterStyle(modifiers?.filters);

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
        muted={!modifiers?.keep_original_audio}
        volume={modifiers?.keep_original_audio ? Math.max(0, Math.min(1, modifiers?.original_audio_volume ?? 0.3)) : 0}
      />

      {/* 顶层动效艺术字贴层 */}
    </AbsoluteFill>
  );
};

