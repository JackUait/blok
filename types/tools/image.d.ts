import { BlockToolData } from './block-tool-data';

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
  /** Horizontal alignment when width < 100 */
  alignment?: 'left' | 'center' | 'right';
  /** Alt text for screen readers */
  alt?: string;
  /** Original filename, when known */
  fileName?: string;
}

/**
 * Consumer-supplied uploader. Both methods optional — when absent,
 * the tool falls back to blob URLs (uploadByFile) or direct embed (uploadByUrl).
 */
export interface ImageUploader {
  uploadByFile?(file: File): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string): Promise<{ url: string }>;
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
