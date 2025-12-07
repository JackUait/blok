import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Paragraph Tool's input and output data format
 */
export interface ParagraphData extends BlockToolData {
  /** Paragraph's content. Can include HTML tags: <a><b><i> */
  text: string;
}

/**
 * Style overrides for paragraph customization
 */
export interface ParagraphStyleConfig {
  /** Custom font size (e.g., '16px', '1rem') */
  size?: string;
  /** Custom line height (e.g., '1.6', '24px') */
  lineHeight?: string;
  /** Custom margin top (e.g., '10px', '0.5rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
}

/**
 * Paragraph Tool's configuration
 */
export interface ParagraphConfig {
  /** Placeholder for the empty paragraph */
  placeholder?: string;
  /** Whether or not to keep blank paragraphs when saving editor data */
  preserveBlank?: boolean;
  /** Style overrides for paragraph customization */
  styles?: ParagraphStyleConfig;
  /** Custom icon SVG string for the toolbox */
  icon?: string;
}

/**
 * Paragraph Tool for the Blok Editor
 * Provides Text Block
 */
export interface Paragraph extends BlockTool {
  /**
   * Return Tool's view
   */
  render(): HTMLDivElement;

  /**
   * Method that specified how to merge two Paragraph blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: ParagraphData): void;

  /**
   * Validate Paragraph block data
   */
  validate(savedData: ParagraphData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(toolsContent: HTMLDivElement): ParagraphData;
}

/**
 * Paragraph Tool constructor
 */
export interface ParagraphConstructable extends BlockToolConstructable {
  new(config: BlockToolConstructorOptions<ParagraphData, ParagraphConfig>): Paragraph;
}
