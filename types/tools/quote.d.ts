import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { ToolboxConfig } from './tool-settings';

/**
 * Quote Tool's input and output data format.
 */
export interface QuoteData extends BlockToolData {
  text: string;
  size: 'default' | 'large';
}

/**
 * Quote Tool constructor options
 */
export type QuoteConstructorOptions = BlockToolConstructorOptions<QuoteData>;

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
  merge(data: QuoteData): void;

  /**
   * Validate Quote block data
   */
  validate(savedData: QuoteData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(blockContent: HTMLQuoteElement): QuoteData;

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
