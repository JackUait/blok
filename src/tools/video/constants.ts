// Accept any video type by default; consumers restrict via the `types` config.
export const DEFAULT_MIME_TYPES = ['video/*'] as const;

export const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';

export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;

/**
 * How small a drag on the resize handle can make the player. Whichever limit the
 * video's shape reaches first stops it (see resize-floor.ts).
 * 180px wide is the narrowest capsule that keeps the time and the mute button.
 * 124px tall is where the resize handles stop touching the ends of the capsule.
 */
export const MIN_WIDTH_PX = 180;
export const MIN_HEIGHT_PX = 124;

/** Direct links to a playable video file. */
export const URL_PATTERN = /^https?:\/\/\S+\.(mp4|webm|ogg|mov|m4v)(\?\S*)?$/i;
