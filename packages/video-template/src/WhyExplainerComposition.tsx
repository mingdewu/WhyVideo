import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { TextOverlayLayer } from "./scenes/TextOverlayLayer";
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
import { BgmTrackProp, RenderPropsType, SceneTransitionProp, TimelineTrackProp } from "./types";

function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return 0.15;
  if (db <= -60) return 0;
  return Math.min(1, Math.max(0, Math.pow(10, db / 20)));
}

function computeBgmVolume(
  bgm: BgmTrackProp,
  frame: number,
  totalFrames: number,
  fps: number
): number {
  if (!bgm.enabled) return 0;
  const safeFps = Math.max(1, fps || 30);
  const baseDb = Number.isFinite(bgm.base_volume_db) ? bgm.base_volume_db : -16;
  let segmentDb = baseDb;

  const segs = bgm.segments ?? [];
  if (segs.length > 0) {
    const transitionFrames = Math.max(1, Math.round(0.6 * safeFps));
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (frame >= seg.start_frame && (frame < seg.end_frame || i === segs.length - 1)) {
        const curDb = Number.isFinite(seg.target_db) ? seg.target_db : baseDb;
        if (i > 0) {
          const prevDb = Number.isFinite(segs[i - 1].target_db)
            ? segs[i - 1].target_db
            : baseDb;
          const elapsed = frame - seg.start_frame;
          if (elapsed >= 0 && elapsed < transitionFrames) {
            segmentDb = prevDb + ((curDb - prevDb) * elapsed) / transitionFrames;
          } else {
            segmentDb = curDb;
          }
        } else {
          segmentDb = curDb;
        }
        break;
      }
    }
  }

  let duckFactor = 0;
  if (bgm.ducking_enabled && bgm.speech_windows && bgm.speech_windows.length > 0) {
    const duckDepth = Number.isFinite(bgm.ducking_db) ? bgm.ducking_db : -8;
    if (duckDepth < 0) {
      const attackFrames = Math.max(1, Math.round(((bgm.attack_ms || 180) / 1000) * safeFps));
      const releaseFrames = Math.max(1, Math.round(((bgm.release_ms || 420) / 1000) * safeFps));
      for (const win of bgm.speech_windows) {
        if (frame < win.start_frame - attackFrames || frame > win.end_frame + releaseFrames) {
          continue;
        }
        let localDuck = 0;
        if (frame >= win.start_frame && frame <= win.end_frame) {
          localDuck = 1;
        } else if (frame >= win.start_frame - attackFrames && frame < win.start_frame) {
          localDuck = Math.max(
            0,
            Math.min(1, (frame - (win.start_frame - attackFrames)) / attackFrames)
          );
        } else if (frame > win.end_frame && frame <= win.end_frame + releaseFrames) {
          localDuck = Math.max(0, Math.min(1, 1 - (frame - win.end_frame) / releaseFrames));
        }
        if (localDuck > duckFactor) duckFactor = localDuck;
        if (duckFactor >= 1) break;
      }
      segmentDb += duckFactor * duckDepth;
    }
  }

  let gain = dbToGain(segmentDb);
  const fadeInFrames = Math.max(0, Math.round(((bgm.fade_in_ms || 0) / 1000) * safeFps));
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    gain *= Math.max(0, frame / fadeInFrames);
  }
  const fadeOutFrames = Math.max(0, Math.round(((bgm.fade_out_ms || 0) / 1000) * safeFps));
  const safeTotal = Math.max(1, totalFrames || 1);
  if (fadeOutFrames > 0) {
    const framesFromEnd = Math.max(0, safeTotal - 1 - frame);
    if (framesFromEnd < fadeOutFrames) {
      gain *= Math.max(0, framesFromEnd / fadeOutFrames);
    }
  }

  return Math.min(1, Math.max(0, gain));
}

function computeSceneTransitionOpacity(
  frame: number,
  totalFrames: number,
  transition?: SceneTransitionProp
): number {
  const inType = transition?.in ?? "fade";
  const outType = transition?.out ?? "fade";
  const rawDuration = transition?.duration_frames ?? 12;

  const safeTotal = Math.max(1, totalFrames);
  const maxPerSide = Math.floor(safeTotal / 2);
  const fadeInFrames = inType === "fade" ? Math.min(Math.max(0, rawDuration), maxPerSide) : 0;
  const fadeOutFrames = outType === "fade" ? Math.min(Math.max(0, rawDuration), maxPerSide) : 0;

  const smoothstep = (t: number) => t * t * (3 - 2 * t);

  let opacity = 1;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    opacity = Math.min(opacity, smoothstep(Math.max(0, frame / fadeInFrames)));
  }
  if (fadeOutFrames > 0) {
    const framesRemaining = safeTotal - 1 - frame;
    if (framesRemaining < fadeOutFrames) {
      opacity = Math.min(opacity, smoothstep(Math.max(0, framesRemaining / fadeOutFrames)));
    }
  }

  return Math.min(1, Math.max(0, opacity));
}

const SceneDispatcher: React.FC<{ track: TimelineTrackProp; isFinalRender?: boolean }> = ({ track, isFinalRender }) => {
  const frame = useCurrentFrame();
  const isMissing =
    track.status === "NEEDS_HUMAN_ASSET" ||
    track.render_mode === "placeholder_awaiting_human_asset";
  const opacity = computeSceneTransitionOpacity(
    frame,
    track.duration_in_frames,
    track.transition
  );

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity }}>
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
        <TextOverlayLayer track={track} aiOnly={isMissing || (track.visual_type !== "broll_video" && track.visual_type !== "photo_motion")} />
      </AbsoluteFill>
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

      {props.audio_track?.bgm?.enabled && (props.audio_track.bgm.playlist?.length ?? 0) > 0 && props.audio_track.bgm.playlist!.map((clip, index, clips) => (
        <Sequence key={`${clip.track_id}-${clip.start_frame}`} from={clip.start_frame} durationInFrames={clip.end_frame - clip.start_frame}>
          <Audio src={staticFile(clip.src)} volume={(f) => {
            const length = clip.end_frame - clip.start_frame;
            const fadeIn = index === 0 ? 1 : Math.min(1, f / Math.max(1, clip.fade_frames));
            const fadeOut = index === clips.length - 1 ? 1 : Math.min(1, Math.max(0, (length - f) / Math.max(1, clip.fade_frames)));
            return computeBgmVolume(props.audio_track.bgm!, f + clip.start_frame, props.video_config.duration_in_frames, props.video_config.fps) * fadeIn * fadeOut;
          }} />
        </Sequence>
      ))}
      {props.audio_track?.bgm?.enabled && !props.audio_track.bgm.playlist?.length && props.audio_track.bgm.src && (
        <Audio
          src={staticFile(props.audio_track.bgm.src)}
          loop={props.audio_track.bgm.loop ?? true}
          volume={(f) =>
            computeBgmVolume(
              props.audio_track.bgm!,
              f,
              props.video_config.duration_in_frames,
              props.video_config.fps
            )
          }
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
      {Boolean(props.burn_in_captions ?? props.caption_track?.burn_in_captions) && (
        <CaptionLayer
          captions={props.caption_track?.captions || []}
          safeBottomMarginPx={props.caption_track?.safe_bottom_margin_px ?? 96}
        />
      )}
    </AbsoluteFill>
  );
};

export type { RenderPropsType } from "./types";
