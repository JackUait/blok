import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';
import { MenuConfig } from './menu-config';

/**
 * List styles enum
 */
export type ListStyle = 'unordered' | 'ordered' | 'checklist';

/**
 * List Tool's input and output data format
 */
export interface ListData extends BlockToolData {
  /** Item text content (can include HTML) */
  text: string;
  /** List style: unordered, ordered, or checklist */
  style: ListStyle;
  /** Checked state for checklist items */
  checked?: boolean;
  /** Starting number for ordered lists (only applies to root items) */
  start?: number;
  /** Nesting depth level (0 = root, 1 = first indent, etc.) */
  depth?: number;
}

/**
 * List Tool's configuration
 */
export interface ListConfig {
  /** Default list style */
  defaultStyle?: ListStyle;
  /**
   * Available list styles for the settings menu.
   * When specified, only these styles will be available in the block settings dropdown.
   */
  styles?: ListStyle[];
  /**
   * List styles to show in the toolbox.
   * When specified, only these list types will appear as separate entries in the toolbox.
   * If not specified, all list types (unordered, ordered, checklist) will be shown.
   */
  toolboxStyles?: ListStyle[];
  /**
   * Custom color for list items.
   * Accepts any valid CSS color value (hex, rgb, hsl, named colors, etc.)
   */
  itemColor?: string;
  /**
   * Custom font size for list items.
   * Accepts any valid CSS font-size value (px, rem, em, etc.)
   */
  itemSize?: string;
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
