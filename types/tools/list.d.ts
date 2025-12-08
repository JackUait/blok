import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';
import { MenuConfig } from './menu-config';

/**
 * List styles enum
 */
export type ListStyle = 'unordered' | 'ordered' | 'checklist';

/**
 * Single list item data
 */
export interface ListItem {
  /** Item content (can include HTML) */
  content: string;
  /** Checked state for checklist items */
  checked?: boolean;
}

/**
 * List Tool's input and output data format
 */
export interface ListData extends BlockToolData {
  /** List style: unordered, ordered, or checklist */
  style: ListStyle;
  /** Array of list items */
  items: ListItem[];
}

/**
 * List Tool's configuration
 */
export interface ListConfig {
  /** Default list style */
  defaultStyle?: ListStyle;
  /** Available list styles */
  styles?: ListStyle[];
}

/**
 * List Tool for the Blok Editor
 * Provides Ordered, Unordered, and Checklist Blocks
 */
export interface List extends BlockTool {
  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Returns list block tunes config
   */
  renderSettings(): MenuConfig;

  /**
   * Method that specified how to merge two List blocks.
   * Called by Editor by backspace at the beginning of the Block
   */
  merge(data: ListData): void;

  /**
   * Validate List block data
   */
  validate(blockData: ListData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): ListData;
}

/**
 * List Tool constructor
 */
export interface ListConstructable extends BlockToolConstructable {
  new(config: BlockToolConstructorOptions<ListData, ListConfig>): List;
}
