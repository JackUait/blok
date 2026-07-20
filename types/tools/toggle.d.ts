import { ConversionConfig, PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { MenuConfig } from './menu-config';
import { ToolboxConfig } from './tool-settings';

/**
 * Toggle Tool's input and output data format
 */
export interface ToggleData extends BlockToolData {
  /** Toggle item text content (can include HTML) */
  text: string;
  /** Whether the toggle is open (expanded). Persisted on save so state is restored on reload. */
  isOpen?: boolean;
}

/**
 * Toggle Tool's configuration
 */
export interface ToggleConfig {
  /** Custom placeholder text for empty toggle items */
  placeholder?: string;
}

/**
 * Toggle Tool constructor options
 */
export type ToggleConstructorOptions = BlockToolConstructorOptions<ToggleData, ToggleConfig>;

/**
 * Toggle Tool for the Blok Editor
 * Provides a collapsible block that nests child blocks
 */
export declare class Toggle implements BlockTool {
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

  constructor(options: ToggleConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Returns toggle block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Method that specified how to merge two Toggle blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: ToggleData): void;

  /**
   * Validate Toggle block data
   */
  validate(blockData: ToggleData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): ToggleData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Toggle Tool constructor
 * @deprecated Use `typeof Toggle` and {@link ToggleConstructorOptions} instead
 */
export interface ToggleConstructable extends BlockToolConstructable {
  new(options: ToggleConstructorOptions): Toggle;
}
