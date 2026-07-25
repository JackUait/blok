import {
  LIST_CHECKBOX_CLASSES,
  LIST_CHECKLIST_ROW_CLASSES,
  LIST_INDENT_PER_LEVEL,
  LIST_ITEM_CLASSES,
  LIST_ITEM_ROW_CLASSES,
  ORDERED_LIST_INDENT_PER_LEVEL,
} from '../../shared/tool-classes/list';

/**
 * Constants for the List tool
 */

/**
 * Indentation padding per depth level in pixels (unordered/checklist)
 * Matches Notion's bullet indent: 1.7em × 16px = 27.2px
 */
export const INDENT_PER_LEVEL = LIST_INDENT_PER_LEVEL;

/**
 * Indentation padding per depth level in pixels (ordered lists)
 * Matches Notion's number indent: 1.6em × 16px = 25.6px
 */
export const ORDERED_INDENT_PER_LEVEL = ORDERED_LIST_INDENT_PER_LEVEL;

/**
 * Base styles for list wrapper
 *
 * Matches paragraph spacing: --blok-block-padding-top/-bottom (7px fallbacks,
 * same as blok-block) + mt-[2px] mb-px.
 * Start padding routes through the private --_blok-list-pad indirection
 * (declared in main.css) so checklists can be indented independently via
 * --blok-checklist-padding-start while ordered/unordered follow
 * --blok-list-padding-start.
 */
export const BASE_STYLES = ['outline-hidden', ...LIST_ITEM_CLASSES].join(' ');

/**
 * Styles for standard list items (unordered, ordered)
 *
 * The marker-to-content gap is a host-overridable custom property (defaults
 * to 0) so embedding apps can space markers without targeting [data-list-style].
 */
export const ITEM_STYLES = ['outline-hidden', ...LIST_ITEM_ROW_CLASSES].join(' ');

/**
 * Styles for checklist items
 */
export const CHECKLIST_ITEM_STYLES = LIST_CHECKLIST_ROW_CLASSES.join(' ');

/**
 * Styles for checkbox input
 */
export const CHECKBOX_STYLES = LIST_CHECKBOX_CLASSES.join(' ');

/**
 * Placeholder translation key
 */
export const PLACEHOLDER_KEY = 'tools.list.placeholder';

/**
 * Tool name used when registering this tool with Blok
 */
export const TOOL_NAME = 'list';
