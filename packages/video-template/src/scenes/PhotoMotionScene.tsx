import { mediaFilterStyle } from "../media-filters";
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TimelineTrackProp } from "../types";
import { MissingAssetScene } from "./MissingAssetScene";

export const PhotoMotionScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!track.approved_asset) {
    return <MissingAssetScene track={track} />;
  }

  const modifiers = track.media_modifiers;

  // 1. 动态运镜配置计算 (默认或 AI 指定的动效)
  const motion = modifiers?.motion;
  const motionFrames = motion?.duration_sec
    ? Math.round(motion.duration_sec * fps)
    : track.duration_in_frames;

  const scaleFrom = motion?.scale_from ?? 1.0;
  const scaleTo = motion?.scale_to ?? 1.15;
  const scale = interpolate(
    frame,
    [0, motionFrames],
    [scaleFrom, scaleTo],
    { extrapolateRight: "clamp" }
  );

  const targetTranslateX = motion?.translate_x_px ?? -28;
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

  // 2. 滤镜
  const filterStr = mediaFilterStyle(modifiers?.filters);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F1419", overflow: "hidden" }}>
      <Img
        src={staticFile(track.approved_asset.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          filter: filterStr,
        }}
      />

      {/* 顶层动效艺术字贴层 */}
    </AbsoluteFill>
  );
};

