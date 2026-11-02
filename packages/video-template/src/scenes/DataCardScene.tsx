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

  const props = track.procedural_props || {};
  const items = Array.isArray(props.items) && props.items.length > 0 ? props.items : [];
  const badge = props.badge_label || track.chapter_ref || track.scene_id;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#070B14",
        backgroundImage: `
          radial-gradient(circle at 82% 18%, rgba(245, 158, 11, 0.20), transparent 48%),
          radial-gradient(circle at 18% 82%, rgba(99, 102, 241, 0.18), transparent 48%),
          radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 100% 100%, 36px 36px",
        fontFamily: FONT_STACK,
        padding: "100px 110px 150px 110px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {/* 核心卡片容器 */}
      <div
        style={{
          position: "relative",
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(24px)",
          border: "1.5px solid rgba(245, 158, 11, 0.35)",
          borderRadius: 24,
          padding: "44px 54px",
          boxShadow:
            "0 30px 80px -15px rgba(0, 0, 0, 0.85), 0 0 50px -10px rgba(245, 158, 11, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
          transform: `scale(${0.96 + 0.04 * cardSpring}) translateY(${(1 - cardSpring) * 16}px)`,
          opacity: cardSpring,
          overflow: "hidden",
        }}
      >
        {/* 顶部彩色流光顶边线 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background:
              "linear-gradient(90deg, rgba(245, 158, 11, 0.9) 0%, rgba(99, 102, 241, 0.9) 60%, rgba(245, 158, 11, 0.3) 100%)",
          }}
        />

        {/* 头部元信息栏 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: "rgba(245, 158, 11, 0.15)",
                border: "1px solid rgba(245, 158, 11, 0.5)",
                color: "#FBBF24",
                fontSize: 17,
                fontWeight: 800,
                letterSpacing: 1,
                padding: "5px 16px",
                borderRadius: 9999,
              }}
            >
              ✦ 深度解析 · {badge}
            </span>
          </div>

          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#94A3B8",
              fontFamily: "monospace",
              letterSpacing: 1.5,
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            EXPLAINER CARD · 1080P
          </div>
        </div>

        {/* 核心大字标题 */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 900,
            color: "#FFFFFF",
            letterSpacing: 1,
            lineHeight: 1.25,
            marginBottom: props.subheadline ? 14 : 28,
            textShadow: "0 2px 10px rgba(0, 0, 0, 0.5)",
          }}
        >
          {props.headline || "核心主题提炼"}
        </div>

        {/* 副级阐述文字 */}
        {props.subheadline && (
          <div
            style={{
              fontSize: 23,
              fontWeight: 500,
              color: "#CBD5E1",
              marginBottom: 30,
              lineHeight: 1.5,
              borderLeft: "3px solid rgba(245, 158, 11, 0.6)",
              paddingLeft: 14,
            }}
          >
            {props.subheadline}
          </div>
        )}

        {/* 关键论点卡片列表 */}
        {items.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {items.map((item, idx) => {
              const itemSpring = spring({
                frame: Math.max(0, frame - 4 - idx * 4),
                fps,
                config: { damping: 16 },
              });

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    backgroundColor: "rgba(30, 41, 59, 0.72)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 14,
                    padding: "16px 22px",
                    transform: `translateX(${(1 - itemSpring) * 20}px)`,
                    opacity: itemSpring,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: "rgba(245, 158, 11, 0.2)",
                      border: "1px solid rgba(245, 158, 11, 0.4)",
                      color: "#F59E0B",
                      fontSize: 16,
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "monospace",
                    }}
                  >
                    0{idx + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 25,
                      color: "#F1F5F9",
                      fontWeight: 600,
                      lineHeight: 1.4,
                    }}
                  >
                    {item}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
