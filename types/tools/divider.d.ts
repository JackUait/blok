import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Divider Tool's input and output data format.
 * Empty — dividers have no configurable properties.
 */
export interface DividerData extends BlockToolData {}

export interface DividerConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<DividerData>): BlockTool;
}
