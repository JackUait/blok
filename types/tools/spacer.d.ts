import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Spacer Tool's input and output data format.
 */
export interface SpacerData extends BlockToolData {
  /**
   * Gap height in pixels. Clamped to [8, 600]; defaults to 24.
   */
  height?: number;
}

export interface SpacerConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<SpacerData>): BlockTool;
}
