import type { ImageCompressionConfig, ImageCompressionFormat } from '../../../types/tools/image';
import { encodeAvifWithVideoEncoder } from './avif-webcodecs';

const DEFAULT_QUALITY = 0.92;
const DEFAULT_MIN_SIZE = 100 * 1024;
const DEFAULT_MIN_SAVINGS = 0.1;

/** Formats a canvas cannot compress meaningfully, or would destroy. */
const SKIPPED_TYPES = new Set(['image/gif', 'image/svg+xml']);

const MIME_BY_FORMAT: Record<Exclude<ImageCompressionFormat, 'original' | 'auto'>, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

interface Resolved {
  format: ImageCompressionFormat;
  fallbackFormat: ImageCompressionFormat;
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
  minSize: number;
  minSavings: number;
  transform?: (file: File) => Promise<File | Blob | null>;
}

function resolveConfig(config: boolean | ImageCompressionConfig | undefined): Resolved | null {
  if (config === false) return null;
  const raw = typeof config === 'object' ? config : {};

  return {
    format: raw.format ?? 'original',
    fallbackFormat: raw.fallbackFormat ?? 'original',
    quality: raw.quality ?? DEFAULT_QUALITY,
    maxWidth: raw.maxWidth,
    maxHeight: raw.maxHeight,
    minSize: raw.minSize ?? DEFAULT_MIN_SIZE,
    minSavings: raw.minSavings ?? DEFAULT_MIN_SAVINGS,
    transform: raw.transform,
  };
}

/**
 * Encode targets to try, in order: the preferred format, then the user's
 * fallback, then the source format. A browser that cannot encode a type
 * silently returns a PNG instead of failing, so each candidate is verified
 * after encoding and the next one is tried on a mismatch — the source format
 * is always last.
 */
function encodeTargets(cfg: Resolved, sourceType: string): string[] {
  const preferred = [...preferredTargets(cfg.format), ...preferredTargets(cfg.fallbackFormat)];
  const deduped = preferred.filter((mime, index) => preferred.indexOf(mime) === index);

  return [...deduped.filter((mime) => mime !== sourceType), sourceType];
}

function preferredTargets(format: ImageCompressionFormat): string[] {
  if (format === 'auto') return ['image/avif', 'image/webp'];
  if (format === 'original') return [];

  return [MIME_BY_FORMAT[format]];
}

/** Fit within the configured cap, preserving aspect ratio. Never upscales. */
function targetSize(width: number, height: number, cfg: Resolved): { width: number; height: number } {
  const scale = Math.min(
    cfg.maxWidth ? cfg.maxWidth / width : 1,
    cfg.maxHeight ? cfg.maxHeight / height : 1,
    1,
  );

  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeCanvas(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  type: string,
  quality: number,
): Promise<Blob | null> {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  const blob = await canvas.convertToBlob({ type, quality });

  // The browser hands back a PNG when it cannot encode `type` — that's a miss.
  return blob.type === type ? blob : null;
}

function rename(name: string, mime: string): string {
  const ext = EXTENSION_BY_MIME[mime];

  if (!ext) return name;
  const dot = name.lastIndexOf('.');

  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

function toFile(blob: Blob, original: File): File {
  const type = blob.type || original.type;

  return new File([blob], rename(original.name, type), { type, lastModified: original.lastModified });
}

async function runTransform(file: File, transform: Resolved['transform']): Promise<File | null> {
  try {
    const result = await transform?.(file);

    if (!result) return null;

    return result instanceof File ? result : toFile(result, file);
  } catch {
    return null;
  }
}

function canDecode(): boolean {
  const g = globalThis as Record<string, unknown>;

  return typeof g.createImageBitmap === 'function' && typeof g.OffscreenCanvas === 'function';
}

/**
 * Re-encode an image file to a smaller one.
 *
 * Returns null whenever the caller should upload the original bytes: compression
 * disabled, a vector/animated/non-image file, a file below `minSize`, no encoder
 * in this browser, a result that isn't meaningfully smaller, or any error.
 */
export async function compressImage(
  file: File,
  config: boolean | ImageCompressionConfig | undefined,
): Promise<File | null> {
  const cfg = resolveConfig(config);

  if (!cfg) return null;
  if (cfg.transform) return runTransform(file, cfg.transform);

  if (!file.type.startsWith('image/') || SKIPPED_TYPES.has(file.type)) return null;
  if (file.size < cfg.minSize) return null;
  if (!canDecode()) return null;

  const bitmap = await decode(file);

  if (!bitmap) return null;

  try {
    const size = targetSize(bitmap.width, bitmap.height, cfg);
    const resized = size.width !== bitmap.width || size.height !== bitmap.height;
    const blob = await encodeFirstSupported(bitmap, size, file.type, cfg);

    if (!blob || !isWorthIt(blob, file, resized, cfg)) return null;

    return toFile(blob, file);
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** First target the browser actually encodes — see the silent-PNG note above. */
async function encodeFirstSupported(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  sourceType: string,
  cfg: Resolved,
): Promise<Blob | null> {
  for (const type of encodeTargets(cfg, sourceType)) {
    const blob = (await encodeCanvas(bitmap, size, type, cfg.quality))
      // No browser's canvas can encode AVIF, but WebCodecs' AV1 encoder can
      // produce a real one where available — try it before giving up on AVIF.
      ?? (type === 'image/avif' ? await encodeAvifWithVideoEncoder(bitmap, size, cfg.quality) : null);

    if (blob) return blob;
  }

  return null;
}

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

/**
 * A downscaled image is kept whenever it is smaller at all — the caller asked for
 * the cap. Otherwise the result must clear the savings threshold to be worth the
 * re-encode.
 */
function isWorthIt(blob: Blob, file: File, resized: boolean, cfg: Resolved): boolean {
  if (blob.size >= file.size) return false;

  return resized || blob.size < file.size * (1 - cfg.minSavings);
}
