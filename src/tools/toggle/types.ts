/**
 * Type definitions for the Toggle tool
 */

import type { BlockToolData } from '../../../types';

/**
 * Tool's input and output data format
 */
export interface ToggleItemData extends BlockToolData {
  /** Toggle item text content (can include HTML) */
  text: string;
}

/**
 * Tool's config from Editor
 */
export interface ToggleItemConfig {
  /** Custom placeholder text for empty toggle items */
  placeholder?: string;
}
