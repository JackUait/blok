import { PasteConfig } from '../configs';
import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { PasteEvent } from './paste-events';
import { ToolboxConfig } from './tool-settings';

/**
 * How a matched service renders: a provider iframe or a provider widget script.
 */
export type EmbedKind = 'iframe' | 'script';

/**
 * Horizontal placement of the embed within the content column.
 */
export type EmbedAlignment = 'left' | 'center' | 'right';

/**
 * Embed Tool's input and output data format
 */
export interface EmbedData extends BlockToolData {
  /** Matched service key from the embed registry (e.g. 'youtube') */
  service: string;
  /** Original pasted URL */
  source: string;
  /** Provider-sanctioned embed URL rendered in the iframe */
  embed: string;
  /** How the service renders. Defaults to 'iframe'. */
  kind?: EmbedKind;
  width?: number;
  height?: number;
  /** Rendered width as a percent of the editor container. Defaults to full (100). */
  widthPercent?: number;
  /** Horizontal placement within the content column. Defaults to center. */
  alignment?: EmbedAlignment;
  caption?: string;
  /** Whether the caption field is shown. */
  captionVisible?: boolean;
}

/**
 * Embed Tool constructor options
 */
export type EmbedConstructorOptions = BlockToolConstructorOptions<EmbedData>;

/**
 * Embed Tool for the Blok Editor
 * Live interactive iframe for a pasted provider URL. Only registry-matched
 * URLs are ever embedded.
 */
export declare class Embed implements BlockTool {
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

  constructor(options: EmbedConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Extract Tool's data from the view
   */
  save(): EmbedData;

  /**
   * Validate Embed block data
   */
  validate(data: EmbedData): boolean;

  /**
   * Handle pasted provider URLs
   */
  onPaste(event: PasteEvent): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Returns embed block tunes config
   */
  renderSettings(): MenuConfig;
}
