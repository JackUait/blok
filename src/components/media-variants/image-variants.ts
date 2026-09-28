import type { ConvertedMedia, ImageFormat } from '../../../types/configs/media';
import { canDecode, decode, encodeCanvas, targetSize } from '../../tools/image/compress';
import { encodeAvifWithVideoEncoder } from '../../tools/image/avif-webcodecs';
import { IMAGE_FORMAT_MIME, sortBestFirst } from './rank';

/** A canvas would flatten a vector or an animation. */
const SKIPPED_TYPES = new Set(['image/gif', 'image/svg+xml']);

export interface ImageVariantOptions {
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Full-resolution scan: a downscaled check averages a tiny transparent area
 * back to 255 and would let a JPEG destroy it.
 * @param bitmap - decoded image
 */
export const hasAlpha = (bitmap: ImageBitmap): boolean => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return true;
  }
  ctx.drawImage(bitmap, 0, 0);

  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  // One read per pixel, stopping at the first see-through one. RGBA bytes read
  // as a little-endian uint32 put alpha in the top byte (every browser platform).
  const pixels = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);

  return pixels.some((pixel) => pixel >>> 24 !== 255);
};

const encodeOne = async (
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  mime: string,
  quality: number
): Promise<Blob | null> => {
  try {
    // No canvas encodes AVIF; WebCodecs' AV1 encoder can where it exists.
    return (await encodeCanvas(bitmap, size, mime, quality))
      ?? (mime === 'image/avif' ? await encodeAvifWithVideoEncoder(bitmap, size, quality) : null);
  } catch {
    return null;
  }
};

/**
 * Encode `file` into every listed format this browser can produce.
 * @param file - the picked image
 * @param formats - formats the host listed
 * @param opts - quality and optional size cap
 * @returns best-first; empty when nothing could be made
 */
export const produceImageVariants = async (
  file: File,
  formats: readonly ImageFormat[],
  opts: ImageVariantOptions
): Promise<ConvertedMedia[]> => {
  if (!file.type.startsWith('image/') || SKIPPED_TYPES.has(file.type) || !canDecode()) {
    return [];
  }

  const bitmap = await decode(file);

  if (!bitmap) {
    return [];
  }

  try {
    const size = targetSize(bitmap.width, bitmap.height, opts);
    // A JPEG has no alpha channel, so there is nothing to lose.
    const alpha = formats.includes('jpeg') && file.type !== 'image/jpeg' && hasAlpha(bitmap);
    const mimes = [...new Set(formats)]
      .map((format) => IMAGE_FORMAT_MIME[format])
      .filter((mime) => !(alpha && mime === 'image/jpeg'));
    const made: ConvertedMedia[] = [];

    // One at a time: each encode holds a full-size canvas in memory.
    for (const mime of mimes) {
      const blob = await encodeOne(bitmap, size, mime, opts.quality);

      made.push(...(blob ? [{ file: blob, mimeType: mime }] : []));
    }

    return sortBestFirst(made);
  } catch {
    return [];
  } finally {
    bitmap.close();
  }
};
