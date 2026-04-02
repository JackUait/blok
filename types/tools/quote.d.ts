import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Quote Tool's input and output data format.
 */
export interface QuoteData extends BlockToolData {
  text: string;
  size: 'default' | 'large';
}

export interface QuoteConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<QuoteData>): BlockTool;
}
