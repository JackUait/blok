/**
 * Constants for the List tool
 */

/**
 * Indentation padding per depth level in pixels
 */
export const INDENT_PER_LEVEL = 24;

/**
 * Base styles for list wrapper
 *
 * Matches paragraph spacing: py-[3px] from blok-block + mt-[2px] mb-px
 */
export const BASE_STYLES = 'outline-none py-[3px] mt-[2px] mb-px';

/**
 * Styles for standard list items (unordered, ordered)
 */
export const ITEM_STYLES = 'outline-none pl-0.5 leading-[1.6em]';

/**
 * Styles for checklist items
 */
export const CHECKLIST_ITEM_STYLES = 'flex items-start pl-0.5';

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
