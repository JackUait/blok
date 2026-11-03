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
   * Keep image/svg+xml. Only for a short-lived URL nobody can open in a tab:
   * an off-screen `<img>` for rasterizing, or a programmatic download click.
   * Never a stored or on-screen URL: "Open image in new tab" runs the SVG as
   * the host. Use localImageUrl for those.
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

/**
 * Largest SVG kept as a data: URL. Its base64 (4/3 larger) stays well under
 * the 1 MiB default collab message limit, with room for the rest of the update.
 */
export const SVG_DATA_URL_CAP_BYTES = 256 * 1024;

/** Base64 in slices: one String.fromCharCode call over a large array overflows the stack. */
const toBase64 = (bytes: Uint8Array): string => {
  const SLICE = 0x8000;
  const parts = Array.from({ length: Math.ceil(bytes.length / SLICE) }, (_, index) => (
    String.fromCharCode(...bytes.subarray(index * SLICE, (index + 1) * SLICE))
  ));

  return btoa(parts.join(''));
};

/**
 * The URL for an image file when no uploader stores it. An SVG becomes a
 * data: URL: <img> draws it, and opened in a tab it runs in an opaque origin
 * (or does not open), never as the host the way an SVG blob does. An SVG over
 * {@link SVG_DATA_URL_CAP_BYTES} gets a text/plain blob instead, which runs no
 * script and which <img> does not draw. Any other image gets a safe blob.
 */
export async function localImageUrl(file: Blob): Promise<string> {
  if (file.type.split(';')[0].trim().toLowerCase() !== SVG) {
    return createSafeObjectUrl(file);
  }

  if (file.size > SVG_DATA_URL_CAP_BYTES) {
    return createSafeObjectUrl(file);
  }

  return `data:${SVG};base64,${toBase64(new Uint8Array(await file.arrayBuffer()))}`;
}
