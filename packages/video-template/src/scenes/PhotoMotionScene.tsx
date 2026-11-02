import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";
import { MissingAssetScene } from "./MissingAssetScene";

export const PhotoMotionScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  if (!track.approved_asset) {
    return <MissingAssetScene track={track} />;
  }

  const isLowConf =
    track.confidence_score > 0 && track.confidence_score < 0.7;
  const scale = interpolate(
    frame,
    [0, track.duration_in_frames],
    [1.0, 1.1],
    { extrapolateRight: "clamp" }
  );
  const translateX = interpolate(
    frame,
    [0, track.duration_in_frames],
    [0, -28],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F1419", overflow: "hidden" }}>
      <Img
        src={staticFile(track.approved_asset.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${translateX}px)`,
        }}
      />
      {isLowConf && (
        <div
          style={{
            position: "absolute",
            top: 195,
            left: 140,
            right: 140,
            backgroundColor: "rgba(15, 20, 25, 0.88)",
            border: "2px solid #EF4444",
            borderRadius: 14,
            padding: "24px 32px",
            fontFamily: FONT_STACK,
          }}
        >
          <div
            style={{
              fontSize: 22,
              color: "#F87171",
              fontWeight: 800,
            }}
          >
            ⚠️ PHOTO_MOTION · 低置信度素材需确认
          </div>
          <div style={{ marginTop: 10, fontSize: 18, color: "#FECACA" }}>
            <strong>提示：</strong>
            {track.review_reason || "该镜头画面建议核验"}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
