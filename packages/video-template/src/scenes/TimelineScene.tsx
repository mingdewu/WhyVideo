import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const TimelineScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const props = track.procedural_props || {};
  const badge = props.badge_label || track.chapter_ref || track.scene_id;
  const nodes =
    props.nodes && props.nodes.length > 0
      ? props.nodes
      : (props.items || []).map((it, idx) => ({
          label: `阶段 0${idx + 1}`,
          detail: it,
        }));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#070B14",
        backgroundImage: `
          radial-gradient(circle at 80% 20%, rgba(245, 158, 11, 0.18), transparent 50%),
          radial-gradient(circle at 20% 80%, rgba(16, 185, 129, 0.15), transparent 50%),
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
          ⏳ 演进脉络 · {badge}
        </span>
      </div>

      <div
        style={{
          fontSize: 50,
          fontWeight: 900,
          color: "#F3F4F6",
          marginBottom: 32,
          lineHeight: 1.25,
        }}
      >
        {props.headline || "时空演进推进"}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {nodes.map((node, idx) => {
          const nodeSpring = spring({
            frame: Math.max(0, frame - idx * 6),
            fps,
            config: { damping: 16 },
          });

          return (
            <div
              key={idx}
              style={{
                flex: 1,
                backgroundColor: "rgba(15, 23, 42, 0.85)",
                backdropFilter: "blur(20px)",
                border: "1.5px solid rgba(245, 158, 11, 0.4)",
                borderTop: "5px solid #F59E0B",
                borderRadius: 18,
                padding: "26px 28px",
                boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.7)",
                transform: `scale(${0.95 + 0.05 * nodeSpring})`,
                opacity: nodeSpring,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  color: "#FBBF24",
                  fontWeight: 900,
                  letterSpacing: 1,
                  fontFamily: "monospace",
                }}
              >
                {node.label}
              </div>
              <div
                style={{
                  fontSize: 23,
                  color: "#E2E8F0",
                  marginTop: 14,
                  lineHeight: 1.45,
                  fontWeight: 600,
                }}
              >
                {node.detail}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
