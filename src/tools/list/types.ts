/**
 * Type definitions for the List tool
 */

import type { BlockToolData } from '../../../types';

/**
 * List item styles
 */
export type ListItemStyle = 'unordered' | 'ordered' | 'checklist';

/**
 * Tool's input and output data format
 */
export interface ListItemData extends BlockToolData {
  /** Item text content (can include HTML) */
  text: string;
  /** List style: unordered, ordered, or checklist */
  style: ListItemStyle;
  /** Checked state for checklist items */
  checked?: boolean;
  /** Starting number for ordered lists (only applies to root items) */
  start?: number;
  /** Nesting depth level (0 = root, 1 = first indent, etc.) */
  depth?: number;
}

/**
 * Tool's config from Editor
 */
export interface ListItemConfig {
  /** Default list style */
  defaultStyle?: ListItemStyle;
  /**
   * Available list styles for the settings menu.
   * When specified, only these styles will be available in the block settings dropdown.
   */
  styles?: ListItemStyle[];
  /**
   * List styles to show in the toolbox.
   * When specified, only these list types will appear as separate entries in the toolbox.
   * If not specified, all list types (unordered, ordered, checklist) will be shown.
   *
   * @example
   * // Show only bulleted and numbered lists in toolbox
   * toolboxStyles: ['unordered', 'ordered']
   *
   * @example
   * // Show only checklist in toolbox
   * toolboxStyles: ['checklist']
   */
  toolboxStyles?: ListItemStyle[];
  /**
   * Custom color for list items.
   * Accepts any valid CSS color value (hex, rgb, hsl, named colors, etc.)
   *
   * @example
   * // Set list items to a hex color
   * itemColor: '#3b82f6'
   *
   * @example
   * // Set list items to an rgb color
   * itemColor: 'rgb(59, 130, 246)'
   */
  itemColor?: string;
  /**
   * Custom font size for list items.
   * Accepts any valid CSS font-size value (px, rem, em, etc.)
   *
   * @example
   * // Set list items to 18px
   * itemSize: '18px'
   *
   * @example
   * // Set list items to 1.25rem
   * itemSize: '1.25rem'
   */
  itemSize?: string;
}

/**
 * Style configuration
 */
export interface StyleConfig {
  style: ListItemStyle;
  name: string;
  icon: string;
}
