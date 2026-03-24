/**
 * Constants for the List tool
 */

/**
 * Indentation padding per depth level in pixels (unordered/checklist)
 * Matches Notion's bullet indent: 1.7em × 16px = 27.2px
 */
export const INDENT_PER_LEVEL = 27;

/**
 * Indentation padding per depth level in pixels (ordered lists)
 * Matches Notion's number indent: 1.6em × 16px = 25.6px
 */
export const ORDERED_INDENT_PER_LEVEL = 26;

/**
 * Base styles for list wrapper
 *
 * Matches paragraph spacing: py-[7px] from blok-block + mt-[2px] mb-px
 */
export const BASE_STYLES = 'outline-hidden py-[7px] mt-[2px] mb-px';

/**
 * Styles for standard list items (unordered, ordered)
 */
export const ITEM_STYLES = 'outline-hidden pl-0.5 leading-[1.5] items-start';

/**
 * Styles for checklist items
 */
export const CHECKLIST_ITEM_STYLES = 'flex items-start pl-0.5';

/**
 * Styles for checkbox input
 */
export const CHECKBOX_STYLES = 'mt-0.5 w-5 mr-2 h-5 cursor-pointer accent-current';

/**
 * Placeholder translation key
 */
export const PLACEHOLDER_KEY = 'tools.list.placeholder';

/**
 * Tool name used when registering this tool with Blok
 */
export const TOOL_NAME = 'list';
