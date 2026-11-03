/**
 * Types a blob: URL may keep. A blob: URL has the page's origin, so a
 * text/html, SVG or XML blob opened in a tab or a frame runs script as the
 * host. Each type here ran no script when opened top-level in Chrome, Firefox
 * and WebKit. WebKit sniffs most other types (octet-stream, zip, Office,
 * video/ogg, untyped) and runs them as HTML, so add a type only after
 * measuring it in all three.
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

const SVG = 'image/svg+xml';

export interface SafeObjectUrlOptions {
  /**
   * Keep image/svg+xml. Only for a URL that reaches `<img>`, CSS or a plain
   * programmatic download click: an SVG opened as a page runs its script.
   */
  svgImage?: boolean;
}

/**
 * The only way Blok makes a blob: URL. A type outside the safe list becomes
 * text/plain: the bytes stay the same and opening the URL shows text. `<img>`
 * and `<video>` sniff the bytes, so a re-typed PNG or WebM still shows in all
 * three browsers, and a download keeps its bytes.
 */
export function createSafeObjectUrl(blob: Blob, options: SafeObjectUrlOptions = {}): string {
  const type = blob.type.split(';')[0].trim();
  const keep = SAFE_TYPES.has(type) || (options.svgImage === true && type === SVG);

  return URL.createObjectURL(keep ? blob : new Blob([blob], { type: 'text/plain' }));
}
