import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * Column Tool's input and output data format.
 * `widthRatio` is applied as flex-grow; omitted means equal width.
 */
export interface ColumnData extends BlockToolData {
  widthRatio?: number;
}

/**
 * Column Tool constructor options
 */
export type ColumnConstructorOptions = BlockToolConstructorOptions<ColumnData>;

/**
 * Column Tool for the Blok Editor
 * Provides a single column inside a ColumnList block
 */
export declare class Column implements BlockTool {
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

  constructor(options: ColumnConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Column block data
   */
  validate(data: ColumnData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): ColumnData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * Column Tool constructor
 * @deprecated Use `typeof Column` and {@link ColumnConstructorOptions} instead
 */
export interface ColumnConstructable extends BlockToolConstructable {
  new(options: ColumnConstructorOptions): Column;
}
