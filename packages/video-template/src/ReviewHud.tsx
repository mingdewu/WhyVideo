import React from "react";
import { FONT_STACK, TimelineTrackProp } from "./types";

export const ReviewHud: React.FC<{ track: TimelineTrackProp }> = ({ track }) => {
  const isMissing =
    track.status === "NEEDS_HUMAN_ASSET" ||
    track.render_mode === "placeholder_awaiting_human_asset";
  const isLowConf =
    track.confidence_score > 0 && track.confidence_score < 0.7;
  const isInternalPlaceholder =
    track.approved_asset?.license_status === "internal_placeholder";

  return (
    <div
      style={{
        position: "absolute",
        top: 36,
        left: 64,
        right: 64,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        pointerEvents: "none",
        fontFamily: FONT_STACK,
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span
          style={{
            backgroundColor: "rgba(15, 20, 25, 0.88)",
            border: "1px solid rgba(245, 158, 11, 0.7)",
            color: "#F59E0B",
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {track.scene_id} · {track.visual_type.toUpperCase()}
        </span>
        <span
          style={{
            backgroundColor: "rgba(15, 20, 25, 0.82)",
            color: "#9CA3AF",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 18,
          }}
        >
          {(track.start_ms / 1000).toFixed(1)}s – {(track.end_ms / 1000).toFixed(1)}s
        </span>
        {isInternalPlaceholder && (
          <span
            style={{
              backgroundColor: "rgba(56, 189, 248, 0.22)",
              border: "1px solid #38BDF8",
              color: "#7DD3FC",
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            INTERNAL PLACEHOLDER ({track.approved_asset?.asset_id})
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {isMissing && (
          <span
            style={{
              backgroundColor: "#DC2626",
              color: "#FFFFFF",
              padding: "8px 18px",
              borderRadius: 6,
              fontSize: 20,
              fontWeight: 800,
              boxShadow: "0 4px 14px rgba(220,38,38,0.5)",
            }}
          >
            ⚠️ 待补素材 · NEEDS_HUMAN_ASSET
          </span>
        )}
        {isLowConf && (
          <span
            style={{
              backgroundColor: "#EA580C",
              color: "#FFFFFF",
              padding: "8px 18px",
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            ⚠️ 低置信度素材 ({Math.round(track.confidence_score * 100)}%)
          </span>
        )}
        {track.human_review_required && (
          <span
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.92)",
              color: "#0F1419",
              padding: "8px 16px",
              borderRadius: 6,
              fontSize: 19,
              fontWeight: 800,
            }}
          >
            👁️ 需人工审核 (HUMAN REVIEW REQUIRED)
          </span>
        )}
      </div>
    </div>
  );
};
