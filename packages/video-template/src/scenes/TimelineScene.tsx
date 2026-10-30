import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const TimelineScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const nodes =
    track.procedural_props.nodes && track.procedural_props.nodes.length > 0
      ? track.procedural_props.nodes
      : track.procedural_props.items.map((it, idx) => ({
          label: `STEP 0${idx + 1}`,
          detail: it,
        }));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0F1419",
        fontFamily: FONT_STACK,
        padding: "130px 110px 180px 110px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div style={{ fontSize: 22, color: "#F59E0B", fontWeight: 800 }}>
        ⏳ {track.procedural_props.badge_label || "TIMELINE · 演进时间轴"}
      </div>
      <div
        style={{
          fontSize: 44,
          fontWeight: 900,
          color: "#F3F4F6",
          marginTop: 10,
          marginBottom: 32,
        }}
      >
        {track.procedural_props.headline}
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        {nodes.map((node, idx) => (
          <div
            key={idx}
            style={{
              flex: 1,
              backgroundColor: "rgba(31, 41, 55, 0.9)",
              borderTop: "5px solid #F59E0B",
              borderRadius: 12,
              padding: "24px",
            }}
          >
            <div style={{ fontSize: 22, color: "#FBBF24", fontWeight: 800 }}>
              {node.label}
            </div>
            <div
              style={{
                fontSize: 24,
                color: "#E5E7EB",
                marginTop: 12,
                lineHeight: 1.4,
              }}
            >
              {node.detail}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
