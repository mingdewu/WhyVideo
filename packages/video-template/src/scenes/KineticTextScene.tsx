import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const KineticTextScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 120 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0F1419",
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.14), transparent 55%)",
        fontFamily: FONT_STACK,
        padding: "130px 120px 180px 120px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `translateY(${(1 - entrance) * 35}px)`,
          opacity: entrance,
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: "#F59E0B",
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 14,
          }}
        >
          {track.procedural_props.badge_label || "KINETIC TEXT · 核心概念动态拆解"}
        </div>
        <div
          style={{
            fontSize: 54,
            fontWeight: 900,
            color: "#F3F4F6",
            lineHeight: 1.25,
            marginBottom: 28,
          }}
        >
          {track.procedural_props.headline}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {track.procedural_props.items.map((item, idx) => {
            const itemProgress = spring({
              frame: Math.max(0, frame - (idx + 1) * 8),
              fps,
              config: { damping: 18 },
            });
            return (
              <div
                key={idx}
                style={{
                  opacity: itemProgress,
                  transform: `translateX(${(1 - itemProgress) * 40}px)`,
                  backgroundColor: "rgba(31, 41, 55, 0.9)",
                  borderLeft: "6px solid #F59E0B",
                  padding: "20px 28px",
                  borderRadius: 10,
                  fontSize: 28,
                  color: "#E5E7EB",
                  fontWeight: 600,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
