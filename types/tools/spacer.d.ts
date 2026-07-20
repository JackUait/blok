import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * Spacer Tool's input and output data format.
 */
export interface SpacerData extends BlockToolData {
  /**
   * Gap height in pixels. Clamped to [8, 600]; defaults to 24.
   */
  height?: number;
}

/**
 * Spacer Tool constructor options
 */
export type SpacerConstructorOptions = BlockToolConstructorOptions<SpacerData>;

/**
 * Spacer Tool for the Blok Editor
 * Provides a resizable vertical gap block
 */
export declare class Spacer implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Sanitizer rules description
   */
  static sanitize?: SanitizerConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: SpacerConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Spacer block data
   */
  validate(data: SpacerData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): SpacerData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Spacer Tool constructor
 * @deprecated Use `typeof Spacer` and {@link SpacerConstructorOptions} instead
 */
export interface SpacerConstructable extends BlockToolConstructable {
  new(options: SpacerConstructorOptions): Spacer;
}
