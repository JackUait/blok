import { BlockToolData } from './block-tool-data';

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
 * Tool configuration shape. Pass via Blok config:
 *   tools: { image: { class: Image, config: ImageConfig } }
 */
export interface ImageConfig {
  uploader?: ImageUploader;
  /** Accepted MIME types. Default: image/jpeg, image/png, image/gif, image/webp, image/svg+xml */
  types?: string[];
  /** Max file size in bytes. Default 10 MiB. */
  maxSize?: number;
  /** Caption placeholder. Default "Write a caption…" */
  captionPlaceholder?: string;
}
