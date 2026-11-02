import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const DocumentHighlightScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const docEntrance = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90 },
  });

  const props = track.procedural_props || {};
  const items = Array.isArray(props.items) && props.items.length > 0 ? props.items : [];
  const badge = props.badge_label || track.chapter_ref || track.scene_id;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#080C16",
        backgroundImage: `
          radial-gradient(circle at 75% 20%, rgba(56, 189, 248, 0.16), transparent 50%),
          radial-gradient(circle at 25% 80%, rgba(245, 158, 11, 0.14), transparent 50%),
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
          position: "relative",
          backgroundColor: "rgba(15, 23, 42, 0.88)",
          backdropFilter: "blur(24px)",
          border: "1.5px solid rgba(148, 163, 184, 0.3)",
          boxShadow:
            "0 30px 80px -15px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
          borderRadius: 24,
          padding: "44px 54px",
          transform: `scale(${0.96 + 0.04 * docEntrance}) translateY(${(1 - docEntrance) * 16}px)`,
          opacity: docEntrance,
          overflow: "hidden",
        }}
      >
        {/* 顶部青蓝流光边线 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background:
              "linear-gradient(90deg, rgba(56, 189, 248, 0.9) 0%, rgba(245, 158, 11, 0.8) 70%, transparent 100%)",
          }}
        />

        {/* 顶部条带 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                backgroundColor: "rgba(56, 189, 248, 0.15)",
                border: "1px solid rgba(56, 189, 248, 0.4)",
                color: "#38BDF8",
                fontWeight: 800,
                fontSize: 16,
                padding: "4px 14px",
                borderRadius: 9999,
                letterSpacing: 1,
              }}
            >
              📜 典籍考据 · {badge}
            </span>
          </div>

          <span
            style={{
              color: "#94A3B8",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "monospace",
              letterSpacing: 1.5,
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            HISTORICAL RECORD
          </span>
        </div>

        {/* 核心标题 */}
        <div
          style={{
            fontSize: 50,
            fontWeight: 900,
            color: "#F8FAFC",
            marginBottom: 12,
            letterSpacing: 0.5,
          }}
        >
          {props.headline || "历史文献要点"}
        </div>

        {props.subheadline && (
          <div
            style={{
              fontSize: 23,
              color: "#CBD5E1",
              marginBottom: 26,
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            “{props.subheadline}”
          </div>
        )}

        {/* 要点列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                backgroundColor: "rgba(30, 41, 59, 0.7)",
                borderLeft: "4px solid #38BDF8",
                borderRadius: "0 12px 12px 0",
                padding: "16px 20px",
                fontSize: 25,
                color: "#F1F5F9",
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              <span
                style={{
                  color: "#38BDF8",
                  fontWeight: 900,
                  fontSize: 18,
                }}
              >
                ◆
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
