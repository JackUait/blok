import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Callout Tool's input and output data format.
 */
export interface CalloutData extends BlockToolData {
  emoji: string;
  textColor: string | null;
  backgroundColor: string | null;
}

export interface CalloutConfig {}

export interface CalloutConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<CalloutData, CalloutConfig>): BlockTool;
}
