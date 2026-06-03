import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * ColumnList Tool's input and output data format.
 * The structure (which columns it holds) lives in the block's contentIds;
 * `columnCount` is a transient seed used only by toolbox presets and is
 * never persisted.
 */
export interface ColumnListData extends BlockToolData {
  columnCount?: number;
}

export interface ColumnListConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<ColumnListData>): BlockTool;
}
