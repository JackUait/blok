/**
 * Types a demo blob: URL may keep. A blob: URL has this page's origin, so an
 * HTML, SVG or XML file opened from it runs script as the page. Copy of the
 * list in Blok's src/shared/safe-object-url.ts; safe-object-url.test.ts
 * fails if they drift.
 */
const SAFE_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/css',
  'text/javascript',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
]);

/** A blob: URL for an uploaded file. Any other type becomes text/plain; the bytes stay the same. */
export const safeObjectUrl = (file: Blob): string => {
  const type = file.type.split(';')[0].trim();

  return URL.createObjectURL(SAFE_TYPES.has(type) ? file : new Blob([file], { type: 'text/plain' }));
};
