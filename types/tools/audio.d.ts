import { PasteConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MaxSizeConfig } from './max-size';
import { MediaSource } from './media-source';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

export type AudioAlignment = 'left' | 'center' | 'right';

export interface AudioData extends BlockToolData {
  url: string;
  caption?: string;
  captionVisible?: boolean;
  title?: string;
  artist?: string;
  coverUrl?: string;
  loop?: boolean;
  width?: number;
  alignment?: AudioAlignment;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  peaks?: number[];
}

export interface AudioUploadContext {
  onProgress?(percent: number): void;
}

export interface AudioUploader {
  uploadByFile?(file: File, ctx?: AudioUploadContext): Promise<{ url: string; fileName?: string }>;
  uploadByUrl?(url: string, ctx?: AudioUploadContext): Promise<{ url: string }>;
}

export interface AudioConfig {
  uploader?: AudioUploader;
  /**
   * Accepted MIME types. Entries may be exact (`audio/mpeg`) or family wildcards
   * (`audio/*`). Default: `['audio/*']` — any audio type.
   */
  types?: string[];
  maxSize?: MaxSizeConfig;
  /**
   * Restrict how audio may be added. Default `'both'` (Upload + Link).
   * Use `'upload'` for file-only or `'url'` for link-only. See {@link MediaSource}.
   */
  sources?: MediaSource;
  captionPlaceholder?: string;
}

/**
 * Audio Tool constructor options
 */
export type AudioConstructorOptions = BlockToolConstructorOptions<AudioData, AudioConfig>;

/**
 * Audio Tool for the Blok Editor
 * Provides Audio Blocks with upload, playback controls, and share links
 */
export declare class Audio implements BlockTool {
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

  constructor(options: AudioConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(block?: HTMLElement): AudioData;

  /**
   * Validate Audio block data
   */
  validate(data: AudioData): boolean;

  /**
   * Handle pasted audio files and URLs
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Returns audio block tunes config
   */
  renderSettings(): MenuConfig;
}
