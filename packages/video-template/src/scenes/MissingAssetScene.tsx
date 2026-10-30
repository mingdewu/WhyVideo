import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT_STACK, TimelineTrackProp } from "../types";

export const MissingAssetScene: React.FC<{ track: TimelineTrackProp }> = ({
  track,
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1A1016",
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(220, 38, 38, 0.12) 0px, rgba(220, 38, 38, 0.12) 24px, transparent 24px, transparent 48px)",
        fontFamily: FONT_STACK,
        padding: "110px 96px 160px 96px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          border: "3px dashed #EF4444",
          borderRadius: 16,
          backgroundColor: "rgba(15, 20, 25, 0.92)",
          padding: "36px 44px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 42,
              fontWeight: 900,
              color: "#F87171",
              letterSpacing: 1,
            }}
          >
            【待补素材 / MISSING HIGH-CONFIDENCE ASSET】
          </div>
          <div
            style={{
              fontSize: 24,
              color: "#FBBF24",
              fontWeight: 700,
            }}
          >
            目标类型: {track.visual_type} → 降级预览:{" "}
            {track.fallback.fallback_scene_type}
          </div>
        </div>

        <div style={{ fontSize: 26, color: "#F3F4F6", lineHeight: 1.5 }}>
          <strong style={{ color: "#F59E0B" }}>画面意图 (Visual Purpose)：</strong>
          {track.visual_purpose}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            marginTop: 4,
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(31, 41, 55, 0.85)",
              padding: "18px 22px",
              borderRadius: 10,
              borderLeft: "4px solid #38BDF8",
            }}
          >
            <div style={{ fontSize: 20, color: "#7DD3FC", fontWeight: 700 }}>
              🔍 中文/英文检索词 (Search Queries)
            </div>
            <div style={{ fontSize: 20, color: "#E5E7EB", marginTop: 8 }}>
              ZH: {track.search_queries_zh.join(" / ")}
            </div>
            <div style={{ fontSize: 18, color: "#9CA3AF", marginTop: 6 }}>
              EN: {track.search_queries_en.join(" / ")}
            </div>
          </div>

          <div
            style={{
              backgroundColor: "rgba(31, 41, 55, 0.85)",
              padding: "18px 22px",
              borderRadius: 10,
              borderLeft: "4px solid #10B981",
            }}
          >
            <div style={{ fontSize: 20, color: "#6EE7B7", fontWeight: 700 }}>
              ✅ 必现 / ❌ 禁现约束 (Must / Must Not Show)
            </div>
            <div style={{ fontSize: 19, color: "#E5E7EB", marginTop: 8 }}>
              必现: {track.must_show.join("；")}
            </div>
            <div style={{ fontSize: 19, color: "#FCA5A5", marginTop: 6 }}>
              禁现: {track.must_not_show.join("；")}
            </div>
          </div>
        </div>

        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.14)",
            border: "1px solid rgba(245, 158, 11, 0.5)",
            padding: "16px 22px",
            borderRadius: 10,
            fontSize: 22,
            color: "#FDE68A",
          }}
        >
          <strong>Fallback 替代组件方案：</strong>
          {track.fallback.component_spec}
        </div>
      </div>
    </AbsoluteFill>
  );
};
