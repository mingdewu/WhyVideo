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

  const items = track.procedural_props.items || [];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0F19",
        fontFamily: FONT_STACK,
        padding: "100px 120px 150px 120px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          backgroundColor: "#161D2E",
          border: "2px solid #E2E8F0",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          borderRadius: 16,
          padding: "44px 56px",
          transform: `scale(${0.95 + 0.05 * docEntrance}) translateY(${(1 - docEntrance) * 20}px)`,
          opacity: docEntrance,
          position: "relative",
        }}
      >
        {/* 顶部公文红头/正式条带 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "2px solid rgba(226, 232, 240, 0.25)",
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                backgroundColor: "#DC2626",
                color: "#FFFFFF",
                fontWeight: 900,
                fontSize: 16,
                padding: "3px 10px",
                borderRadius: 4,
                letterSpacing: 2,
              }}
            >
              OFFICIAL RECORD
            </span>
            <span style={{ fontSize: 18, color: "#94A3B8", fontWeight: 700, letterSpacing: 1 }}>
              {track.procedural_props.badge_label || "EXECUTIVE ORDER / LEGAL ACT"}
            </span>
          </div>

          <span
            style={{
              color: "#F59E0B",
              fontSize: 16,
              fontWeight: 800,
              fontFamily: "monospace",
            }}
          >
            CONFIDENTIAL ARCHIVE
          </span>
        </div>

        {/* 核心法案标题 */}
        <div
          style={{
            fontSize: 40,
            fontWeight: 900,
            color: "#F8FAFC",
            marginBottom: 12,
            letterSpacing: 0.5,
          }}
        >
          {track.procedural_props.headline}
        </div>

        {track.procedural_props.subheadline && (
          <div
            style={{
              fontSize: 22,
              color: "#CBD5E1",
              marginBottom: 24,
              fontStyle: "italic",
            }}
          >
            “{track.procedural_props.subheadline}”
          </div>
        )}

        {/* 核心公文条款高亮 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((item, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                borderLeft: "5px solid #F59E0B",
                borderRadius: 6,
                padding: "14px 20px",
                fontSize: 23,
                color: "#F1F5F9",
                fontWeight: 600,
                lineHeight: 1.45,
              }}
            >
              § {item}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
