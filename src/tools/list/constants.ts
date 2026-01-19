/**
 * Constants for the List tool
 */

import { IconListBulleted, IconListNumbered, IconListChecklist } from '../../components/icons';

import type { StyleConfig } from './types';

/**
 * Indentation padding per depth level in pixels
 */
export const INDENT_PER_LEVEL = 24;

/**
 * Base styles for list wrapper
 */
export const BASE_STYLES = 'outline-none';

/**
 * Styles for standard list items (unordered, ordered)
 */
export const ITEM_STYLES = 'outline-none py-0.5 pl-0.5 leading-[1.6em]';

/**
 * Styles for checklist items
 */
export const CHECKLIST_ITEM_STYLES = 'flex items-start py-0.5 pl-0.5';

/**
 * Styles for checkbox input
 */
export const CHECKBOX_STYLES = 'mt-1 w-4 mr-2 h-4 cursor-pointer accent-current';

/**
 * Placeholder translation key
 */
export const PLACEHOLDER_KEY = 'tools.list.placeholder';

/**
 * Tool name used when registering this tool with Blok
 */
export const TOOL_NAME = 'list';

/**
 * Style configurations for different list types
 */
export const STYLE_CONFIGS: StyleConfig[] = [
  { style: 'unordered', name: 'bulletedList', icon: IconListBulleted },
  { style: 'ordered', name: 'numberedList', icon: IconListNumbered },
  { style: 'checklist', name: 'todoList', icon: IconListChecklist },
];
