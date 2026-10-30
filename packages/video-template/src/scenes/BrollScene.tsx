import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";
import { MissingAssetScene } from "./MissingAssetScene";

export const BrollScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  if (!track.approved_asset) {
    return <MissingAssetScene track={track} />;
  }
  const scale = interpolate(
    frame,
    [0, track.duration_in_frames],
    [1.0, 1.05],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F1419" }}>
      <OffthreadVideo
        src={staticFile(track.approved_asset.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
        muted
      />
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
