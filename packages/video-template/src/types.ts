export type VisualSceneType =
  | "broll_video"
  | "photo_motion"
  | "map"
  | "timeline"
  | "data_card"
  | "document_highlight"
  | "versus_dual"
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
  // AI 智能指令驱动的特效与裁剪修饰 (Media & Animation Modifiers)
  media_modifiers?: {
    trim_start_sec?: number;
    trim_end_sec?: number;
    filters?: {
      brightness?: number; // 默认 1.0, 如 1.25
      contrast?: number;   // 默认 1.0, 如 1.1
      saturate?: number;   // 默认 1.0
      sepia?: number;      // 0 ~ 1
      grayscale?: number;  // 0 ~ 1
      blur_px?: number;    // 模糊像素
    };
    motion?: {
      motion_type?: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "static";
      duration_sec?: number;
      scale_from?: number;
      scale_to?: number;
      translate_x_px?: number;
      translate_y_px?: number;
    };
    text_overlays?: Array<{
      text: string;
      style?: "dramatic_shock" | "warning_badge" | "neon_glow" | "minimal_clean";
      animation?: "slide_from_left" | "pop_bounce" | "fade_in" | "shock_shake";
      start_frame?: number;
      duration_frames?: number;
      position?: "center" | "top_left" | "bottom_center" | "center_left";
    }>;
  };
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
