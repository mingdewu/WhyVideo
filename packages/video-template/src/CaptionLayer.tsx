import React from "react";
import { useCurrentFrame } from "remotion";
import { CaptionItemProp, FONT_STACK } from "./types";

export const CaptionLayer: React.FC<{
  captions: CaptionItemProp[];
  safeBottomMarginPx: number;
}> = ({ captions, safeBottomMarginPx }) => {
  const frame = useCurrentFrame();
  const activeCaption = captions.find(
    (c) =>
      frame >= c.from_frame && frame < c.from_frame + c.duration_in_frames
  );

  if (!activeCaption) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        bottom: safeBottomMarginPx,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 50,
        fontFamily: FONT_STACK,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(10, 14, 18, 0.88)",
          border: "1px solid rgba(245, 158, 11, 0.45)",
          padding: "14px 32px",
          borderRadius: 10,
          fontSize: 36,
          fontWeight: 700,
          color: "#F9FAFB",
          textAlign: "center",
          maxWidth: 1520,
          lineHeight: 1.35,
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.55)",
        }}
      >
        {activeCaption.text}
      </div>
    </div>
  );
};
