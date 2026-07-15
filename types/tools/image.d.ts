import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';
import { MediaSource } from './media-source';

/** Horizontal alignment of the image within its container. */
export type ImageAlignment = 'left' | 'center' | 'right';
/** Size preset. `full` matches a full-bleed layout. Custom `width` still wins when set. */
export type ImageSize = 'sm' | 'md' | 'lg' | 'full';
/** Frame treatment around the image. */
export type ImageFrame = 'none' | 'border' | 'shadow';

/** Crop mask shape. Defaults to 'rect'. */
export type ImageCropShape = 'rect' | 'circle' | 'ellipse';

/** Non-destructive crop rectangle, in percent of intrinsic image (0–100). */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional mask shape. Omit for rectangular crop. */
  shape?: ImageCropShape;
}

/**
 * Persisted data shape for the Image block tool.
 */
export interface ImageData extends BlockToolData {
  /** Image source URL — http(s) or blob: */
  url: string;
  /** Plain-text caption. Empty string when absent. */
  caption?: string;
  /** Width as percent of container, 10–100. Default 100. */
  width?: number;
  /** Horizontal alignment */
  alignment?: ImageAlignment;
  /** Discrete size preset; when present, overrides `width`. */
  size?: ImageSize;
  /** Decorative frame treatment. Default 'none'. */
  frame?: ImageFrame;
  /** Rounded corners. Default true. */
  rounded?: boolean;
  /** Caption visible in the rendered state. Default true. */
  captionVisible?: boolean;
  /** Non-destructive crop rectangle. */
  crop?: ImageCrop;
  /** Alt text for screen readers */
  alt?: string;
  /** Original filename, when known */
  fileName?: string;
  /** Intrinsic pixel width of the source image. Cached after first successful load. */
  naturalWidth?: number;
  /** Intrinsic pixel height of the source image. Cached after first successful load. */
  naturalHeight?: number;
}

/**
 * Context passed to consumer-supplied upload methods. Currently exposes
 * an `onProgress(percent)` hook so the upload bar in the editor can
 * reflect real upload progress (0–100). Optional — consumers that don't
 * report progress simply ignore it.
 */
export interface ImageUploadContext {
  onProgress?(percent: number): void;
}

/**
 * Consumer-supplied uploader. Both methods optional — when absent,
 * the tool falls back to blob URLs (uploadByFile) or direct embed (uploadByUrl).
 */
export interface ImageUploader {
  uploadByFile?(file: File, ctx?: ImageUploadContext): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string, ctx?: ImageUploadContext): Promise<{ url: string }>;
}

/**
 * Output format for compressed images.
 * - `original` — re-encode in the source format (default; safest).
 * - `auto` — best format the browser can actually encode: AVIF → WebP → original.
 *
 * AVIF is encoded through the canvas where the browser supports it, and through
 * WebCodecs' AV1 encoder otherwise (Chromium). Browsers with neither fall back
 * to the next target. The WebCodecs path skips images with transparency — they
 * fall through to a format with an alpha channel instead of losing it.
 */
export type ImageCompressionFormat = 'original' | 'jpeg' | 'webp' | 'avif' | 'auto';

/**
 * Opt-in tuning for automatic image compression. Every field has a conservative
 * default; passing `compress: true` (or omitting it) uses them all.
 *
 * Compression never breaks an upload: whenever it cannot help — an unsupported
 * format, a result that isn't meaningfully smaller, a decode error — the original
 * file is uploaded untouched.
 */
export interface ImageCompressionConfig {
  /**
   * Output format. Default `'original'`.
   *
   * Note that `'jpeg'` has no alpha channel, so a transparent PNG re-encoded as
   * JPEG loses its transparency. `'webp'`, `'avif'` and `'auto'` preserve it.
   */
  format?: ImageCompressionFormat;
  /**
   * Format to try when the browser cannot encode `format`, before giving up
   * and re-encoding in the source format. Default: none — a browser without
   * the preferred encoder goes straight to the source format.
   *
   * `{ format: 'avif', fallbackFormat: 'webp' }` uploads AVIF where the
   * browser can produce it and WebP everywhere else.
   */
  fallbackFormat?: ImageCompressionFormat;
  /** Encoder quality, 0–1. Default 0.92 (visually lossless). Ignored for PNG. */
  quality?: number;
  /** Downscale images wider than this (px). Default: no cap. */
  maxWidth?: number;
  /** Downscale images taller than this (px). Default: no cap. */
  maxHeight?: number;
  /** Skip files smaller than this (bytes). Default 100 KiB. */
  minSize?: number;
  /**
   * Discard the result unless it saves at least this fraction of the original
   * size. Default 0.1 (10%).
   */
  minSavings?: number;
  /**
   * Replace the built-in pipeline entirely — e.g. a WASM encoder. Return `null`
   * to keep the original file.
   */
  transform?(file: File): Promise<File | Blob | null>;
}

/**
 * Tool configuration shape. Pass via Blok config:
 *   tools: { image: { class: Image, config: ImageConfig } }
 */
export interface ImageConfig {
  uploader?: ImageUploader;
  /**
   * Accepted MIME types. Entries may be exact (`image/png`) or family wildcards
   * (`image/*`). Default: `['image/*']` — any image type.
   */
  types?: string[];
  /**
   * Max upload size. A number caps every type (bytes); an object caps per MIME
   * type with `'*'` as the fallback. Default 30 MiB. See {@link MaxSizeConfig}.
   */
  maxSize?: MaxSizeConfig;
  /**
   * Restrict how an image may be added. Default `'both'` (Upload + Link).
   * Use `'upload'` for file-only or `'url'` for link-only. See {@link MediaSource}.
   */
  sources?: MediaSource;
  /**
   * Auto-convert animated GIFs to a looping WebM video block on insert.
   * Default true. Set false to keep GIFs as image blocks.
   */
  convertGifToVideo?: boolean;
  /**
   * Re-encode uploaded images before they reach the uploader. Default true —
   * same format, quality 0.92, original dimensions, kept only when it saves at
   * least 10%. Pass an object to opt into a smaller format, a lower quality or a
   * dimension cap; pass false to upload the exact original bytes.
   * See {@link ImageCompressionConfig}.
   */
  compress?: boolean | ImageCompressionConfig;
  /** Caption placeholder. Default "Write a caption…" */
  captionPlaceholder?: string;
  /**
   * How many times a rendered image silently re-fetches its `src` after a load
   * error before showing the broken-image state. Default 5. Set 0 to disable
   * auto-retry (fail on the first error).
   */
  reloadAttempts?: number;
}
