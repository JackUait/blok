export const DEFAULT_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
] as const;

export const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';

export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;

/**
 * Hard floor for the player's pixel width. Below this the inline controls
 * (volume slider, timecode, scrubber, view-mode buttons) crush together, so the
 * resize handle clamps here instead of the global 10% percent floor.
 */
export const MIN_WIDTH_PX = 440;

/** Direct links to a playable video file. */
export const URL_PATTERN = /^https?:\/\/\S+\.(mp4|webm|ogg|mov|m4v)(\?\S*)?$/i;
