import { PasteConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';
import { MediaSource } from './media-source';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

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
 * When `types` is omitted all MIME types are accepted; `maxSize` defaults to
 * 30 MiB. Pass `maxSize: Infinity` to allow files of any size.
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
  /**
   * Max upload size. A number caps every type (bytes); an object caps per MIME
   * type with `'*'` as the fallback. Default 30 MiB; pass `Infinity` for
   * unlimited. See {@link MaxSizeConfig}.
   */
  maxSize?: MaxSizeConfig;
  /**
   * Restrict how a file may be added. Default `'both'` (Upload + Link).
   * Use `'upload'` for file-only or `'url'` for link-only. See {@link MediaSource}.
   */
  sources?: MediaSource;
  /** Caption placeholder. */
  captionPlaceholder?: string;
}

/**
 * File Tool constructor options
 */
export type FileConstructorOptions = BlockToolConstructorOptions<FileData, FileConfig>;

/**
 * File Tool for the Blok Editor
 * Provides file attachment Blocks with upload and preview.
 *
 * Declared under a local name (`FileTool`) and exported as `File` so that the
 * DOM `File` type used by {@link FileUploader} keeps resolving to the global
 * inside this module.
 */
declare class FileTool implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Paste substitutions configuration
   */
  static pasteConfig?: PasteConfig | false;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: FileConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(): FileData;

  /**
   * Validate File block data
   */
  validate(data: FileData): boolean;

  /**
   * Handle pasted files
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Returns file block tunes config
   */
  renderSettings(): MenuConfig;
}

export { FileTool as File };
