export const DEFAULT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';

export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;

export const URL_PATTERN = /^https?:\/\/\S+\.(jpe?g|png|gif|webp|svg)(\?\S*)?$/i;
