import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const TextOverlayLayer: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const overlays = track.media_modifiers?.text_overlays;
  if (!overlays || overlays.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      {overlays.map((item, idx) => {
        const startFrame = item.start_frame ?? 0;
        const duration = item.duration_frames ?? (track.duration_in_frames - startFrame);

        if (frame < startFrame || frame >= startFrame + duration) {
          return null;
        }

        const localFrame = frame - startFrame;
        const entrance = spring({
          frame: localFrame,
          fps,
          config: { damping: 12, stiffness: 180 },
        });

        // 动画类型计算
        let transform = "";
        let opacity = Math.min(1, localFrame / 5);

        if (item.animation === "slide_from_left") {
          const offsetX = (1 - entrance) * -400;
          transform = `translateX(${offsetX}px)`;
          opacity = entrance;
        } else if (item.animation === "pop_bounce" || item.animation === "shock_shake") {
          const scale = entrance * 1.05;
          // 若为震颤 shock_shake，在刚弹出的前15帧有微抖动
          let shakeX = 0;
          if (item.animation === "shock_shake" && localFrame < 15) {
            shakeX = Math.sin(localFrame * 2) * 8;
          }
          transform = `scale(${scale}) translateX(${shakeX}px)`;
          opacity = entrance;
        } else {
          // 默认 fade_in
          opacity = Math.min(1, localFrame / 10);
        }

        // 样式风格预设
        let containerStyle: React.CSSProperties = {
          position: "absolute",
          fontFamily: FONT_STACK,
          transform,
          opacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        };

        // 位置布局
        if (item.position === "center_left" || item.animation === "slide_from_left") {
          containerStyle = { ...containerStyle, top: "35%", left: "10%" };
        } else if (item.position === "top_left") {
          containerStyle = { ...containerStyle, top: "12%", left: "8%" };
        } else if (item.position === "bottom_center") {
          containerStyle = { ...containerStyle, bottom: "16%", left: "50%", transform: `${transform} translateX(-50%)` };
        } else {
          // center
          containerStyle = { ...containerStyle, top: "40%", left: "15%", right: "15%" };
        }

        let badgeStyle: React.CSSProperties = {
          fontSize: 48,
          fontWeight: 900,
          color: "#FFFFFF",
          padding: "18px 38px",
          borderRadius: 18,
          lineHeight: 1.25,
          letterSpacing: 2,
        };

        if (item.style === "dramatic_shock") {
          badgeStyle = {
            ...badgeStyle,
            backgroundColor: "rgba(220, 38, 38, 0.92)",
            color: "#FEF08A",
            border: "4px solid #FACC15",
            boxShadow: "0 20px 50px rgba(220, 38, 38, 0.6), 0 0 30px rgba(250, 204, 21, 0.5)",
            textShadow: "0 4px 12px rgba(0,0,0,0.8)",
            transform: "rotate(-2deg)",
          };
        } else if (item.style === "warning_badge") {
          badgeStyle = {
            ...badgeStyle,
            backgroundColor: "rgba(245, 158, 11, 0.9)",
            color: "#0F172A",
            border: "3px solid #FDE68A",
            boxShadow: "0 15px 35px rgba(245, 158, 11, 0.5)",
          };
        } else if (item.style === "neon_glow") {
          badgeStyle = {
            ...badgeStyle,
            backgroundColor: "rgba(15, 23, 42, 0.88)",
            color: "#38BDF8",
            border: "2px solid #38BDF8",
            boxShadow: "0 0 40px rgba(56, 189, 248, 0.6)",
          };
        } else {
          // minimal_clean
          badgeStyle = {
            ...badgeStyle,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            color: "#F8FAFC",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            backdropFilter: "blur(12px)",
          };
        }

        return (
          <div key={idx} style={containerStyle}>
            <div style={badgeStyle}>{item.text}</div>
          </div>
        );
      })}
    </div>
  );
};
