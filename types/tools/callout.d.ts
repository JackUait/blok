import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { ToolboxConfig } from './tool-settings';

/**
 * Callout Tool's input and output data format.
 */
export interface CalloutData extends BlockToolData {
  emoji: string;
  textColor: string | null;
  backgroundColor: string | null;
}

/**
 * Callout Tool's configuration
 */
export interface CalloutConfig {
  /**
   * Custom emoji picker opener. Called with an `onSelect` callback that
   * applies the chosen emoji to the callout. When omitted, the built-in
   * picker is used.
   */
  emojiPicker?: (onSelect: (emoji: string) => void) => void;
}

/**
 * Callout Tool constructor options
 */
export type CalloutConstructorOptions = BlockToolConstructorOptions<CalloutData, CalloutConfig>;

/**
 * Callout Tool for the Blok Editor
 * Provides an emphasized container block with an emoji and child blocks
 */
export declare class Callout implements BlockTool {
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

  constructor(options: CalloutConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Returns callout block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Validate Callout block data
   */
  validate(data: CalloutData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): CalloutData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Callout Tool constructor
 * @deprecated Use `typeof Callout` and {@link CalloutConstructorOptions} instead
 */
export interface CalloutConstructable extends BlockToolConstructable {
  new(options: CalloutConstructorOptions): Callout;
}
