import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Column Tool's input and output data format.
 * `widthRatio` is applied as flex-grow; omitted means equal width.
 */
export interface ColumnData extends BlockToolData {
  widthRatio?: number;
}

export interface ColumnConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<ColumnData>): BlockTool;
}
