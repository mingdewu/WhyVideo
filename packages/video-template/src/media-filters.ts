import type { TimelineTrackProp } from "./types";

type MediaFilters = NonNullable<TimelineTrackProp["media_modifiers"]>["filters"];

/** Shared color/filter styling for both still photos and video footage. */
export function mediaFilterStyle(filters: MediaFilters): string | undefined {
  const filterList: string[] = [];
  if (filters?.brightness && filters.brightness !== 1.0) {
    filterList.push(`brightness(${filters.brightness})`);
  }
  if (filters?.contrast && filters.contrast !== 1.0) {
    filterList.push(`contrast(${filters.contrast})`);
  }
  if (filters?.saturate && filters.saturate !== 1.0) {
    filterList.push(`saturate(${filters.saturate})`);
  }
  if (filters?.sepia) {
    filterList.push(`sepia(${filters.sepia})`);
  }
  if (filters?.grayscale) {
    filterList.push(`grayscale(${filters.grayscale})`);
  }
  if (filters?.blur_px) {
    filterList.push(`blur(${filters.blur_px}px)`);
  }
  if (filters?.hue_rotate_deg) {
    filterList.push(`hue-rotate(${filters.hue_rotate_deg}deg)`);
  }
  if (filters?.invert) {
    filterList.push(`invert(${filters.invert})`);
  }
  if (filters?.custom_css_filter) {
    filterList.push(filters.custom_css_filter);
  }
  return filterList.length > 0 ? filterList.join(" ") : undefined;
}
