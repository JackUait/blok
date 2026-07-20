import { PasteConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

/**
 * Bookmark card metadata (OpenGraph/Twitter-card shape).
 */
export interface BookmarkMeta {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  domain?: string;
}

/**
 * Bookmark Tool's configuration.
 *
 * Blok ships no backend: the consumer supplies an `endpoint` that scrapes
 * OpenGraph metadata and returns it as JSON (browser CORS makes a
 * same-origin proxy mandatory).
 */
export interface BookmarkConfig {
  /** Consumer-supplied unfurl endpoint. Required. */
  endpoint: string;
  /** Optional headers (e.g. auth) sent with the request. */
  headers?: Record<string, string>;
}

/**
 * Bookmark Tool's input and output data format
 */
export interface BookmarkData extends BookmarkMeta, BlockToolData {}

/**
 * Bookmark Tool constructor options
 */
export type BookmarkConstructorOptions = BlockToolConstructorOptions<BookmarkData, BookmarkConfig>;

/**
 * Bookmark Tool for the Blok Editor
 * Static OpenGraph card for a pasted link
 */
export declare class Bookmark implements BlockTool {
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

  constructor(options: BookmarkConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(): BookmarkData;

  /**
   * Validate Bookmark block data
   */
  validate(data: BookmarkData): boolean;

  /**
   * Handle pasted http(s) URLs
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;
}
