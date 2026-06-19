import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';

/** Horizontal alignment of the video within its container. */
export type VideoAlignment = 'left' | 'center' | 'right';

/** Ambient glow intensity behind the player. Default 'minimal'. */
export type VideoGlow = 'more' | 'less' | 'minimal' | 'none';

/**
 * Persisted data shape for the Video block tool.
 */
export interface VideoData extends BlockToolData {
  /** Video source URL — http(s) or blob: */
  url: string;
  /** Plain-text caption. Empty string when absent. */
  caption?: string;
  /** Caption visible in the rendered state. Default true. */
  captionVisible?: boolean;
  /** Width as percent of container, 10–100. Default 100. */
  width?: number;
  /** Horizontal alignment */
  alignment?: VideoAlignment;
  /** Autoplay (muted) for read-only viewers — pairs with `loop` for a gif feel. */
  autoplay?: boolean;
  /** Loop playback. Applies in both edit and read-only modes. */
  loop?: boolean;
  /** Original filename, when known */
  fileName?: string;
  /** Source MIME type (e.g. video/mp4), when known */
  mimeType?: string;
  /** Intrinsic aspect ratio string (e.g. '16 / 9'), cached from loadedmetadata. */
  aspectRatio?: string;
}

/**
 * Context passed to consumer-supplied upload methods. Exposes an
 * `onProgress(percent)` hook so the upload bar reflects real progress (0–100).
 */
export interface VideoUploadContext {
  onProgress?(percent: number): void;
}

/**
 * Consumer-supplied uploader. Both methods optional — when absent, the tool
 * falls back to blob URLs (uploadByFile) or direct embed (uploadByUrl).
 */
export interface VideoUploader {
  uploadByFile?(file: File, ctx?: VideoUploadContext): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string, ctx?: VideoUploadContext): Promise<{ url: string }>;
}

/**
 * Tool configuration shape. Pass via Blok config:
 *   tools: { video: { class: Video, config: VideoConfig } }
 */
export interface VideoConfig {
  uploader?: VideoUploader;
  /** Accepted MIME types. Default: video/mp4, video/webm, video/ogg */
  types?: string[];
  /**
   * Max upload size. A number caps every type (bytes); an object caps per MIME
   * type with `'*'` as the fallback. Default 100 MiB. See {@link MaxSizeConfig}.
   */
  maxSize?: MaxSizeConfig;
  /** Caption placeholder. Default "Write a caption…" */
  captionPlaceholder?: string;
  /** Ambient glow intensity behind every player. Default 'minimal'. */
  glow?: VideoGlow;
}
