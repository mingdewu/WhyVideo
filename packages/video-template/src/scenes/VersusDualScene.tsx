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

  const props = track.procedural_props || {};
  const items = Array.isArray(props.items) && props.items.length > 0 ? props.items : [];
  const badge = props.badge_label || track.chapter_ref || track.scene_id;
  const leftItem = items[0] || "原有观点与传统认知";
  const rightItem = items[1] || "深度洞察与核心范式演进";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#080C16",
        backgroundImage: `
          radial-gradient(circle at 25% 20%, rgba(59, 130, 246, 0.16), transparent 50%),
          radial-gradient(circle at 75% 80%, rgba(168, 85, 247, 0.16), transparent 50%),
          radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 100% 100%, 36px 36px",
        fontFamily: FONT_STACK,
        padding: "100px 100px 150px 100px",
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
          marginBottom: 16,
        }}
      >
        <span
          style={{
            backgroundColor: "rgba(129, 140, 248, 0.15)",
            border: "1px solid rgba(129, 140, 248, 0.4)",
            color: "#818CF8",
            fontSize: 17,
            fontWeight: 800,
            padding: "5px 16px",
            borderRadius: 9999,
            letterSpacing: 1,
          }}
        >
          ⚖️ 对比辨析 · {badge}
        </span>
      </div>

      <div
        style={{
          fontSize: 50,
          fontWeight: 900,
          color: "#F9FAFB",
          marginBottom: 12,
          lineHeight: 1.25,
        }}
      >
        {props.headline || "核心对比分析"}
      </div>

      {props.subheadline && (
        <div
          style={{
            fontSize: 22,
            color: "#94A3B8",
            marginBottom: 28,
            lineHeight: 1.5,
          }}
        >
          {props.subheadline}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          transform: `scale(${0.96 + 0.04 * anim})`,
          opacity: anim,
        }}
      >
        {/* 左栏 */}
        <div
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            border: "1.5px solid rgba(59, 130, 246, 0.45)",
            borderRadius: 18,
            padding: "30px 32px",
            boxShadow: "0 15px 35px -5px rgba(0, 0, 0, 0.6)",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#60A5FA",
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>🔵</span>
            <span>传统认知 / 既往定式</span>
          </div>
          <div
            style={{
              fontSize: 25,
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
            backgroundColor: "rgba(24, 18, 40, 0.85)",
            border: "1.5px solid rgba(168, 85, 247, 0.5)",
            borderRadius: 18,
            padding: "30px 32px",
            boxShadow: "0 15px 35px -5px rgba(0, 0, 0, 0.6)",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#C084FC",
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>🟣</span>
            <span>核心突破 / 本质机理</span>
          </div>
          <div
            style={{
              fontSize: 25,
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
