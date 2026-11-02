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

  const props = track.procedural_props || {};
  const badge = props.badge_label || track.chapter_ref || track.scene_id;
  const items = Array.isArray(props.items) && props.items.length > 0 ? props.items : [];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#070B14",
        backgroundImage: `
          radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.22), transparent 55%),
          radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.18), transparent 55%),
          radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 100% 100%, 36px 36px",
        fontFamily: FONT_STACK,
        padding: "100px 110px 150px 110px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          transform: `translateY(${(1 - entrance) * 25}px)`,
          opacity: entrance,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "#FBBF24",
              fontSize: 17,
              fontWeight: 800,
              padding: "5px 16px",
              borderRadius: 9999,
              letterSpacing: 1,
            }}
          >
            ⚡ 核心概念聚焦 · {badge}
          </span>
        </div>

        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: "#FFFFFF",
            lineHeight: 1.25,
            marginBottom: 28,
            letterSpacing: 1,
            textShadow: "0 4px 16px rgba(0, 0, 0, 0.6)",
          }}
        >
          {props.headline || "核心概念"}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {items.map((item, idx) => {
            const itemProgress = spring({
              frame: Math.max(0, frame - (idx + 1) * 6),
              fps,
              config: { damping: 18 },
            });
            return (
              <div
                key={idx}
                style={{
                  opacity: itemProgress,
                  transform: `translateX(${(1 - itemProgress) * 30}px)`,
                  backgroundColor: "rgba(15, 23, 42, 0.85)",
                  backdropFilter: "blur(20px)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderLeft: "6px solid #F59E0B",
                  padding: "18px 24px",
                  borderRadius: "0 14px 14px 0",
                  fontSize: 26,
                  color: "#F1F5F9",
                  fontWeight: 600,
                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
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
