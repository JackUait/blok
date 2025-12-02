import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';
import { MenuConfig } from './menu-config';

/**
 * Header Tool's input and output data format
 */
export interface HeaderData extends BlockToolData {
  /** Header's content */
  text: string;
  /** Header's level from 1 to 6 */
  level: number;
}

/**
 * Header Tool's configuration
 */
export interface HeaderConfig {
  /** Block's placeholder */
  placeholder?: string;
  /** Heading levels available (1-6) */
  levels?: number[];
  /** Default level */
  defaultLevel?: number;
}

/**
 * Header Tool for the Blok Editor
 * Provides Headings Blocks (H1-H6)
 */
export interface Header extends BlockTool {
  /**
   * Return Tool's view
   */
  render(): HTMLHeadingElement;

  /**
   * Returns header block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Method that specified how to merge two Header blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: HeaderData): void;

  /**
   * Validate Header block data
   */
  validate(blockData: HeaderData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(toolsContent: HTMLHeadingElement): HeaderData;

  /**
   * Get current Tool's data
   */
  data: HeaderData;
}

/**
 * Header Tool constructor
 */
export interface HeaderConstructable extends BlockToolConstructable {
  new(config: BlockToolConstructorOptions<HeaderData, HeaderConfig>): Header;
}
