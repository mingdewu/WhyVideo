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
      <div
        style={{
          position: "absolute",
          top: 195,
          left: 140,
          right: 140,
          backgroundColor: "rgba(15, 20, 25, 0.88)",
          border: `2px solid ${isLowConf ? "#EF4444" : "#38BDF8"}`,
          borderRadius: 14,
          padding: "28px 36px",
          fontFamily: FONT_STACK,
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: isLowConf ? "#F87171" : "#7DD3FC",
            fontWeight: 800,
          }}
        >
          🖼️ PHOTO_MOTION (Ken Burns) · {track.approved_asset.asset_id} ·
          Confidence: {Math.round(track.confidence_score * 100)}%
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#F3F4F6",
            fontWeight: 700,
            marginTop: 10,
            lineHeight: 1.4,
          }}
        >
          {track.visual_purpose}
        </div>
        {isLowConf && (
          <div
            style={{
              marginTop: 14,
              padding: "12px 18px",
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              borderLeft: "4px solid #EF4444",
              fontSize: 20,
              color: "#FECACA",
            }}
          >
            <strong>人工审核提示：</strong>
            {track.review_reason}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
