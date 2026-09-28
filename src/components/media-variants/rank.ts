import type { ImageFormat } from '../../../types/configs/media';

export const IMAGE_FORMAT_MIME: Record<ImageFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Formats every browser shows. One of these must end up as `url`. */
export const UNIVERSAL_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);

/**
 * Lower is better. WebM holds both AV1 and VP9, so the codec parameter decides.
 * @param mimeType - full MIME type, codec parameters allowed
 */
export const rankOf = (mimeType: string): number => {
  const type = mimeType.toLowerCase().split(';')[0].trim();

  switch (type) {
    case 'image/avif': return 0;
    case 'image/webp': return 1;
    case 'image/jpeg':
    case 'image/png': return 2;
    case 'video/webm': return /av01/i.test(mimeType) ? 0 : 1;
    case 'video/mp4': return 2;
    default: return Infinity;
  }
};

/**
 * @param items - renditions in any order
 * @returns a copy, best format first; ties keep their order
 */
export const sortBestFirst = <T extends { mimeType: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => rankOf(a.mimeType) - rankOf(b.mimeType));
