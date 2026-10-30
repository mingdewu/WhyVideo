import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const VersusDualScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  const items = track.procedural_props.items || [];
  const leftItem = items[0] || "传统概念 · AI 人工智能";
  const rightItem = items[1] || "演进定义 · SI 合成智能";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#090D16",
        fontFamily: FONT_STACK,
        padding: "110px 100px 160px 100px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontSize: 22,
            color: "#818CF8",
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ⚖️ {track.procedural_props.badge_label || "VERSUS · 核心概念双栏对比"}
        </span>
      </div>

      <div
        style={{
          fontSize: 42,
          fontWeight: 900,
          color: "#F9FAFB",
          marginBottom: 12,
        }}
      >
        {track.procedural_props.headline}
      </div>

      {track.procedural_props.subheadline && (
        <div
          style={{
            fontSize: 20,
            color: "#9CA3AF",
            marginBottom: 28,
          }}
        >
          {track.procedural_props.subheadline}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          transform: `scale(${0.96 + 0.04 * anim})`,
          opacity: anim,
        }}
      >
        {/* 左栏 */}
        <div
          style={{
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            border: "2px solid rgba(59, 130, 246, 0.6)",
            borderRadius: 16,
            padding: "32px 36px",
            boxShadow: "0 10px 25px -5px rgba(59, 130, 246, 0.2)",
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#60A5FA",
              marginBottom: 14,
            }}
          >
            🔵 原有定义 / 传统认知
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "#F3F4F6",
              lineHeight: 1.45,
            }}
          >
            {leftItem}
          </div>
        </div>

        {/* 右栏 */}
        <div
          style={{
            backgroundColor: "rgba(24, 17, 39, 0.95)",
            border: "2px solid rgba(168, 85, 247, 0.7)",
            borderRadius: 16,
            padding: "32px 36px",
            boxShadow: "0 10px 25px -5px rgba(168, 85, 247, 0.25)",
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#C084FC",
              marginBottom: 14,
            }}
          >
            🟣 战略重塑 / SI 新范式
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "#F3F4F6",
              lineHeight: 1.45,
            }}
          >
            {rightItem}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
