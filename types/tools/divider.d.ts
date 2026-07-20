import { PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * Divider Tool's input and output data format.
 * Empty — dividers have no configurable properties.
 */
export interface DividerData extends BlockToolData {}

/**
 * Divider Tool constructor options
 */
export type DividerConstructorOptions = BlockToolConstructorOptions<DividerData>;

/**
 * Divider Tool for the Blok Editor
 * Provides a horizontal rule block
 */
export declare class Divider implements BlockTool {
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
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: DividerConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Divider block data
   */
  validate(data: DividerData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): DividerData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Divider Tool constructor
 * @deprecated Use `typeof Divider` and {@link DividerConstructorOptions} instead
 */
export interface DividerConstructable extends BlockToolConstructable {
  new(options: DividerConstructorOptions): Divider;
}
