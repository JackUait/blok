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
 * Start padding routes through the private --_blok-list-pad indirection
 * (declared in main.css) so checklists can be indented independently via
 * --blok-checklist-padding-start while ordered/unordered follow
 * --blok-list-padding-start.
 */
export const BASE_STYLES = 'outline-hidden py-[7px] mt-[2px] mb-px ps-[var(--_blok-list-pad,0px)]';

/**
 * Styles for standard list items (unordered, ordered)
 *
 * The marker-to-content gap is a host-overridable custom property (defaults
 * to 0) so embedding apps can space markers without targeting [data-list-style].
 */
export const ITEM_STYLES = 'outline-hidden pl-0.5 leading-[1.5] items-start gap-[var(--blok-list-gap,0px)]';

/**
 * Styles for checklist items
 */
export const CHECKLIST_ITEM_STYLES = 'flex items-start pl-0.5 gap-[var(--blok-list-gap,0px)]';

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
