import { BlockToolData } from './block-tool-data';

/** Persisted data shape for the File block tool. */
export interface FileData extends BlockToolData {
  /** File source URL — http(s) or blob: */
  url: string;
  /** Original filename, when known. */
  fileName?: string;
  /** File size in bytes; rendered human-readable. */
  size?: number;
  /** MIME type; used to pick the type icon. */
  mimeType?: string;
  /** Plain-text caption. */
  caption?: string;
  /** Caption visible in the rendered state. Default true. */
  captionVisible?: boolean;
}

/** Context passed to consumer-supplied upload methods. */
export interface FileUploadContext {
  onProgress?(percent: number): void;
}

/** Result returned by consumer-supplied upload methods. */
export interface FileUploadResult {
  url: string;
  fileName?: string;
  size?: number;
  mimeType?: string;
}

/**
 * Consumer-supplied uploader. Both methods optional — when absent the tool
 * falls back to a blob URL (uploadByFile) or the URL itself (uploadByUrl).
 */
export interface FileUploader {
  uploadByFile?(file: File, ctx?: FileUploadContext): Promise<FileUploadResult>;
  uploadByUrl?(url: string, ctx?: FileUploadContext): Promise<FileUploadResult>;
}

/**
 * Tool configuration. Pass via Blok config:
 *   tools: { file: { class: File, config: FileConfig } }
 * No paywall: when `types`/`maxSize` are omitted, all files of any size are accepted.
 */
export interface FileConfig {
  uploader?: FileUploader;
  /**
   * Upload endpoint(s). Blok POSTs the upload itself — multipart/form-data for
   * files, JSON `{ url }` for embedded URLs — and expects a `FileUploadResult`
   * JSON body back (`{ url, fileName?, size?, mimeType? }`).
   *
   * A single string is used for both file and URL uploads. An object targets
   * each separately; a missing side falls back (blob URL for files, raw URL for
   * embeds). An explicit `uploader` method always takes precedence over this.
   */
  endpoints?: string | { byFile?: string; byUrl?: string };
  /** Form-data field name carrying the file. Default: `file`. */
  field?: string;
  /** Extra headers merged into endpoint upload requests. */
  additionalRequestHeaders?: Record<string, string>;
  /** Optional MIME allowlist. Default: accept all. */
  types?: string[];
  /** Optional max file size in bytes. Default: unlimited. */
  maxSize?: number;
  /** Caption placeholder. */
  captionPlaceholder?: string;
}
