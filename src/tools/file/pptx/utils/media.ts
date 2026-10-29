// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
/**
 * Media utilities — MIME type detection, path resolution, and blob URL management.
 */

export interface ResolvedMedia {
  mediaPath: string;
  data: Uint8Array;
}

/**
 * Determine MIME type from file extension.
 * Covers images, video, and audio formats used in PPTX files.
 */
export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
    webp: 'image/webp',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
  };
  // Own keys only: a deck can name a file "image.constructor".
  return Object.prototype.hasOwnProperty.call(mimeMap, ext) ? mimeMap[ext] : 'application/octet-stream';
}

function stripUriSuffix(target: string): string {
  const suffixIndex = target.search(/[?#]/);
  return suffixIndex >= 0 ? target.slice(0, suffixIndex) : target;
}

function normalizePathSegments(path: string): string[] {
  const normalized: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized;
}

function decodeUriPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function mediaRelativePath(target: string): string {
  const parts = normalizePathSegments(stripUriSuffix(target));
  const mediaIndex = parts.lastIndexOf('media');
  const mediaParts =
    mediaIndex >= 0 && mediaIndex < parts.length - 1
      ? parts.slice(mediaIndex + 1)
      : parts.slice(-1);
  return mediaParts.join('/');
}

/**
 * Resolve a relative media path (from rels) to its canonical path in PptxFiles.media.
 * Rels targets are relative like "../media/image1.png".
 * Media paths in PptxFiles are like "ppt/media/image1.png".
 */
export function resolveMediaPath(target: string): string {
  const decodedPath = mediaRelativePath(target).split('/').map(decodeUriPathSegment).join('/');
  return `ppt/media/${decodedPath}`;
}

/**
 * Return canonical media-path candidates for a relationship target.
 *
 * OOXML relationship targets are URI references, so `%20` normally means a
 * literal space in the part name. Some producers/tests, however, keep the
 * percent-encoded bytes in the ZIP entry name. Prefer the decoded OPC form but
 * keep the raw basename as a compatibility fallback.
 */
export function resolveMediaPathCandidates(target: string): string[] {
  const rawRelativePath = mediaRelativePath(target);
  const decodedPath = resolveMediaPath(target);
  const rawPath = `ppt/media/${rawRelativePath}`;
  return decodedPath === rawPath ? [decodedPath] : [decodedPath, rawPath];
}

export function findMediaByTarget(
  target: string,
  media: Map<string, Uint8Array>,
): ResolvedMedia | undefined {
  for (const mediaPath of resolveMediaPathCandidates(target)) {
    const data = media.get(mediaPath);
    if (data) return { mediaPath, data };
  }
  return undefined;
}

/**
 * Get or create a blob URL for a media file, using a cache to avoid duplicates.
 *
 * @param mediaPath - Canonical path (e.g. "ppt/media/image1.png")
 * @param data - Raw media data (Uint8Array or ArrayBuffer)
 * @param cache - Map to store/retrieve cached blob URLs
 * @returns The blob URL string
 */
export function getOrCreateBlobUrl(
  mediaPath: string,
  data: Uint8Array | ArrayBuffer,
  cache: Map<string, string>,
): string {
  let url = cache.get(mediaPath);
  if (!url) {
    const mime = getMimeType(mediaPath);
    // A blob: URL has the page's origin, and an SVG opened in its own tab runs
    // its scripts. A data: URL gets an opaque origin instead.
    url = mime === 'image/svg+xml'
      ? `data:${mime};base64,${toBase64(data instanceof Uint8Array ? data : new Uint8Array(data))}`
      : URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: mime }));
    cache.set(mediaPath, url);
  }
  return url;
}

function toBase64(bytes: Uint8Array): string {
  // Spreading a whole large file into one call overflows the stack.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
