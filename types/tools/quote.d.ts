import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { RichText } from '../rich-text';
import { MenuConfig } from './menu-config';
import { ToolboxConfig } from './tool-settings';

/**
 * A saved quote, as the editor hands it to the host.
 */
export interface QuoteData extends BlockToolData {
  text: RichText;
  size: 'default' | 'large';
}

/**
 * The data the Quote tool class reads and writes (constructor, `merge`,
 * `validate`, `save`). The editor converts it to {@link QuoteData} on output.
 */
export interface QuoteToolData extends BlockToolData {
  /** Inline HTML. */
  text: string;
  size: 'default' | 'large';
}

/**
 * Quote Tool constructor options
 */
export type QuoteConstructorOptions = BlockToolConstructorOptions<QuoteToolData>;

/**
 * Quote Tool for the Blok Editor
 * Provides a blockquote block
 */
export declare class Quote implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Sanitizer rules description
   */
  static sanitize?: SanitizerConfig;

  /**
   * Paste substitutions configuration
   */
  static pasteConfig?: PasteConfig | false;

  /**
   * Rules that specified how this Tool can be converted into/from another Tool
   */
  static conversionConfig?: ConversionConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: QuoteConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLQuoteElement;

  /**
   * Returns quote block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Method that specified how to merge two Quote blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: QuoteToolData): void;

  /**
   * Validate Quote block data
   */
  validate(savedData: QuoteToolData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(blockContent: HTMLQuoteElement): QuoteToolData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Quote Tool constructor
 * @deprecated Use `typeof Quote` and {@link QuoteConstructorOptions} instead
 */
export interface QuoteConstructable extends BlockToolConstructable {
  new(options: QuoteConstructorOptions): Quote;
}
