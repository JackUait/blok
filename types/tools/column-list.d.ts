import { SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * ColumnList Tool's input and output data format.
 * The structure (which columns it holds) lives in the block's contentIds;
 * `columnCount` is a transient seed used only by toolbox presets and is
 * never persisted.
 */
export interface ColumnListData extends BlockToolData {
  columnCount?: number;
}

/**
 * ColumnList Tool constructor options
 */
export type ColumnListConstructorOptions = BlockToolConstructorOptions<ColumnListData>;

/**
 * ColumnList Tool for the Blok Editor
 * Provides the side-by-side columns container block
 */
export declare class ColumnList implements BlockTool {
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

  /**
   * The column list exclusively manages its own child (column) blocks
   */
  static ownsChildren?: boolean;

  constructor(options: ColumnListConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate ColumnList block data
   */
  validate(data: ColumnListData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): ColumnListData;

  /**
   * Toggle read-only mode in place
   */
  setReadOnly(state: boolean): void;
}

/**
 * ColumnList Tool constructor
 * @deprecated Use `typeof ColumnList` and {@link ColumnListConstructorOptions} instead
 */
export interface ColumnListConstructable extends BlockToolConstructable {
  new(options: ColumnListConstructorOptions): ColumnList;
}
