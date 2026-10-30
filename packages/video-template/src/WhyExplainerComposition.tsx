import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { CaptionLayer } from "./CaptionLayer";
import { ReviewHud } from "./ReviewHud";
import { BrollScene } from "./scenes/BrollScene";
import { DataCardScene } from "./scenes/DataCardScene";
import { KineticTextScene } from "./scenes/KineticTextScene";
import { MissingAssetScene } from "./scenes/MissingAssetScene";
import { PhotoMotionScene } from "./scenes/PhotoMotionScene";
import { TimelineScene } from "./scenes/TimelineScene";
import { VersusDualScene } from "./scenes/VersusDualScene";
import { DocumentHighlightScene } from "./scenes/DocumentHighlightScene";
import { RenderPropsType, TimelineTrackProp } from "./types";

const SceneDispatcher: React.FC<{ track: TimelineTrackProp; isFinalRender?: boolean }> = ({ track, isFinalRender }) => {
  const isMissing =
    track.status === "NEEDS_HUMAN_ASSET" ||
    track.render_mode === "placeholder_awaiting_human_asset";

  return (
    <AbsoluteFill>
      {isMissing ? (
        <MissingAssetScene track={track} />
      ) : track.visual_type === "broll_video" ? (
        <BrollScene track={track} />
      ) : track.visual_type === "photo_motion" ? (
        <PhotoMotionScene track={track} />
      ) : track.visual_type === "kinetic_text" ? (
        <KineticTextScene track={track} />
      ) : track.visual_type === "timeline" ? (
        <TimelineScene track={track} />
      ) : track.visual_type === "versus_dual" ? (
        <VersusDualScene track={track} />
      ) : track.visual_type === "document_highlight" ? (
        <DocumentHighlightScene track={track} />
      ) : (
        <DataCardScene track={track} />
      )}
      {!isFinalRender && <ReviewHud track={track} />}
    </AbsoluteFill>
  );
};

export const WhyExplainerComposition: React.FC<RenderPropsType & { isFinalRender?: boolean }> = (props) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: props.video_config.theme_palette.background,
      }}
    >
      {props.audio_track?.src && (
        <Audio
          src={staticFile(props.audio_track.src)}
          volume={props.audio_track.volume ?? 1}
        />
      )}

      {props.timeline_tracks.map((track) => (
        <Sequence
          key={track.scene_id}
          from={track.from_frame}
          durationInFrames={track.duration_in_frames}
          name={`${track.scene_id} (${track.visual_type})`}
        >
          <SceneDispatcher track={track} isFinalRender={props.isFinalRender} />
        </Sequence>
      ))}

      <CaptionLayer
        captions={props.caption_track.captions}
        safeBottomMarginPx={props.caption_track.safe_bottom_margin_px}
      />
    </AbsoluteFill>
  );
};

export type { RenderPropsType } from "./types";
