import React from "react";
import { Composition, staticFile } from "remotion";
import {
  WhyExplainerComposition,
  RenderPropsType,
} from "./WhyExplainerComposition";

const GENERIC_DEFAULT_PROPS: RenderPropsType = {
  composition_id: "WhyExplainerMVP",
  project_id: "generic_project",
  domain_category: "general_explainer",
  title: "Why Explainer Video",
  ready_for_final_render: false,
  blocking_reasons: [],
  video_config: {
    fps: 30,
    width: 1920,
    height: 1080,
    duration_in_frames: 1800,
    duration_ms: 60000,
    duration_sec: 60,
    safe_margin_px: {
      top: 72,
      bottom: 96,
      left: 96,
      right: 96,
    },
    theme_palette: {
      background: "#0F1419",
      primary_text: "#F3F4F6",
      accent: "#F59E0B",
      muted_text: "#9CA3AF",
      danger: "#EF4444",
      warning: "#F97316",
    },
  },
  audio_track: {
    src: "audio/narration.wav",
    start_from_frame: 0,
    end_at_frame: 1800,
    duration_ms: 60000,
    volume: 1.0,
  },
  caption_track: {
    srt_src: "captions/captions.srt",
    safe_bottom_margin_px: 96,
    max_chars_per_line: 22,
    captions: [],
  },
  timeline_tracks: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WhyExplainerMVP"
        component={WhyExplainerComposition}
        durationInFrames={GENERIC_DEFAULT_PROPS.video_config.duration_in_frames}
        fps={GENERIC_DEFAULT_PROPS.video_config.fps}
        width={GENERIC_DEFAULT_PROPS.video_config.width}
        height={GENERIC_DEFAULT_PROPS.video_config.height}
        defaultProps={GENERIC_DEFAULT_PROPS}
        calculateMetadata={async ({ props }) => {
          if (
            props &&
            props.timeline_tracks &&
            props.timeline_tracks.length > 0
          ) {
            return {
              durationInFrames: props.video_config.duration_in_frames,
              fps: props.video_config.fps,
              width: props.video_config.width,
              height: props.video_config.height,
              props,
            };
          }
          const response = await fetch(staticFile("render-props.json"));
          const loadedProps = (await response.json()) as RenderPropsType;
          return {
            durationInFrames: loadedProps.video_config.duration_in_frames,
            fps: loadedProps.video_config.fps,
            width: loadedProps.video_config.width,
            height: loadedProps.video_config.height,
            props: loadedProps,
          };
        }}
      />
    </>
  );
};
