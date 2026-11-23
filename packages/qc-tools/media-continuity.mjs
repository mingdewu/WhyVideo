/** Keep linked media speed and color consistent; captions and overlays remain scene-local. */
export function continueMediaModifiers(previousTrack, scene, fps, assetDurationSec) {
  const previous = previousTrack.media_modifiers || {};
  const current = scene.media_modifiers || {};
  const rate = Number.isFinite(previous.playback_rate) && previous.playback_rate > 0
    ? previous.playback_rate : 1;
  const start = Number.isFinite(previous.trim_start_sec) ? previous.trim_start_sec : 0;
  const nextStart = Number((start + previousTrack.duration_in_frames / fps * rate).toFixed(3));
  return {
    ...(previous.playback_rate !== undefined ? { playback_rate: previous.playback_rate } : {}),
    ...current,
    ...(previous.filters || current.filters
      ? { filters: { ...previous.filters, ...current.filters } } : {}),
    trim_start_sec: assetDurationSec && nextStart >= assetDurationSec - 0.1 ? 0 : nextStart,
    trim_end_sec: undefined,
  };
}
