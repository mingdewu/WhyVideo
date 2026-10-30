export type VisualSceneType =
  | "broll_video"
  | "photo_motion"
  | "map"
  | "timeline"
  | "data_card"
  | "kinetic_text";

export interface ApprovedAssetProp {
  asset_id: string;
  src: string;
  type: "video" | "image" | "vector";
  resolution: string;
  duration_seconds: number | null;
  license_status: "approved" | "internal_placeholder";
  crop_mode: string;
  confidence_score: number;
}

export interface ProceduralNodeProp {
  label: string;
  detail: string;
}

export interface TimelineTrackProp {
  scene_id: string;
  chapter_ref: string;
  is_final_ending: boolean;
  start_ms: number;
  end_ms: number;
  from_frame: number;
  duration_in_frames: number;
  visual_type: VisualSceneType;
  scene_type: VisualSceneType;
  status: string;
  render_mode:
    | "approved_media_asset"
    | "internal_placeholder_media_asset"
    | "procedural_component"
    | "placeholder_awaiting_human_asset";
  narration_text: string;
  visual_purpose: string;
  human_review_required: boolean;
  review_status: string;
  review_reason: string;
  confidence_score: number;
  search_queries_zh: string[];
  search_queries_en: string[];
  must_show: string[];
  must_not_show: string[];
  fallback: {
    fallback_scene_type: string;
    component_spec: string;
  };
  approved_asset: ApprovedAssetProp | null;
  procedural_props: {
    badge_label?: string;
    headline: string;
    subheadline: string;
    fallback_scene_type: string;
    component_spec: string;
    items: string[];
    nodes?: ProceduralNodeProp[];
  };
}

export interface CaptionItemProp {
  index: number;
  start_ms: number;
  end_ms: number;
  from_frame: number;
  duration_in_frames: number;
  text: string;
  char_count: number;
}

export interface RenderPropsType {
  composition_id: string;
  project_id: string;
  domain_category?: string;
  title: string;
  ready_for_final_render: boolean;
  blocking_reasons: string[];
  video_config: {
    fps: number;
    width: number;
    height: number;
    duration_in_frames: number;
    duration_ms: number;
    duration_sec: number;
    safe_margin_px: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    theme_palette: {
      background: string;
      primary_text: string;
      accent: string;
      muted_text: string;
      danger: string;
      warning: string;
    };
  };
  audio_track: {
    src: string;
    start_from_frame: number;
    end_at_frame: number;
    duration_ms: number;
    volume: number;
  };
  caption_track: {
    srt_src: string;
    safe_bottom_margin_px: number;
    max_chars_per_line: number;
    captions: CaptionItemProp[];
  };
  timeline_tracks: TimelineTrackProp[];
}

export const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
