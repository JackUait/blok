// Accept any audio type by default; consumers restrict via the `types` config.
export const DEFAULT_MIME_TYPES = ['audio/*'] as const;

export const DEFAULT_MAX_SIZE = 30 * 1024 * 1024; // 30 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';

export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;

/** Hard pixel floor for the player so inline controls don't crush together. */
export const MIN_WIDTH_PX = 360;

/** Number of amplitude buckets in the cached waveform. */
export const WAVEFORM_BUCKETS = 300;

/** Skip embedding an ID3 cover as a data: URL above this size (re-upload or drop). */
export const COVER_DATA_URL_CAP_BYTES = 150 * 1024;

/** Direct links to a playable audio file. */
export const URL_PATTERN = /^https?:\/\/\S+\.(mp3|wav|ogg|oga|m4a|aac|flac|weba)(\?\S*)?$/i;
