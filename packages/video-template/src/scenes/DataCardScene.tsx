import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const DataCardScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardSpring = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#111827",
        fontFamily: FONT_STACK,
        padding: "125px 110px 175px 110px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(17, 24, 39, 0.95)",
          border: "2px solid rgba(245, 158, 11, 0.65)",
          borderRadius: 18,
          padding: "36px 44px",
          transform: `scale(${0.96 + 0.04 * cardSpring})`,
          opacity: cardSpring,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: "#38BDF8",
              fontWeight: 800,
              letterSpacing: 1.5,
            }}
          >
            📊 {track.procedural_props.badge_label || "DATA CARD · 结构化数据与机制卡片"}
          </span>
          {track.is_final_ending && (
            <span
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.2)",
                border: "1px solid #10B981",
                color: "#6EE7B7",
                padding: "4px 14px",
                borderRadius: 6,
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              全片正式结尾 · 主题回扣
            </span>
          )}
        </div>

        <div
          style={{
            fontSize: 44,
            fontWeight: 900,
            color: "#F9FAFB",
            marginBottom: track.procedural_props.subheadline ? 12 : 24,
          }}
        >
          {track.procedural_props.headline}
        </div>

        {track.procedural_props.subheadline && (
          <div
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#9CA3AF",
              marginBottom: 24,
              lineHeight: 1.4,
            }}
          >
            {track.procedural_props.subheadline}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
          }}
        >
          {track.procedural_props.items.map((item, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "rgba(31, 41, 55, 0.92)",
                border: "1px solid rgba(156, 163, 175, 0.25)",
                borderRadius: 12,
                padding: "18px 24px",
                fontSize: 27,
                color: "#F3F4F6",
                fontWeight: 600,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
