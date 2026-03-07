/**
 * Constants for the Toggle tool
 */

/**
 * Tool name used when registering this tool with Blok
 */
export const TOOL_NAME = 'toggle';

/**
 * Placeholder translation key
 */
export const PLACEHOLDER_KEY = 'tools.toggle.placeholder';

/**
 * Base styles for toggle wrapper
 *
 * Matches paragraph spacing: py-[3px] from blok-block + mt-[2px] mb-px
 */
export const BASE_STYLES = 'outline-hidden py-[3px] mt-[2px] mb-px';

/**
 * Styles for toggle content area
 */
export const CONTENT_STYLES = 'outline-hidden pl-0.5 leading-[1.6em] flex-1 min-w-0';

/**
 * Styles for toggle wrapper (arrow + content layout)
 */
export const TOGGLE_WRAPPER_STYLES = 'flex items-start';

/**
 * Styles for the toggle arrow button
 */
export const ARROW_STYLES = 'flex-shrink-0 w-6 h-6 flex items-center justify-center cursor-pointer select-none rounded hover:bg-black/5 transition-colors duration-200 ease-in-out mt-px focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none';

/**
 * SVG icon for the toggle arrow
 */
export const ARROW_ICON = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 2.5L8.5 6L4.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Default body placeholder text shown when the toggle has no children
 */
export const BODY_PLACEHOLDER_TEXT = 'Empty toggle. Click or drop blocks inside.';

/**
 * Styles for the body placeholder element
 */
export const BODY_PLACEHOLDER_STYLES = 'hidden pl-7 py-1 text-gray-text text-sm cursor-pointer select-none';

/**
 * Styles for the children container element.
 * pl-7 (28px) aligns children with the toggle text (arrow is w-6=24px + gap).
 */
export const TOGGLE_CHILDREN_STYLES = 'pl-7';

/**
 * Data attributes specific to the toggle tool
 */
export const TOGGLE_ATTR = {
  toggleOpen: 'data-blok-toggle-open',
  toggleArrow: 'data-blok-toggle-arrow',
  toggleContent: 'data-blok-toggle-content',
  toggleBodyPlaceholder: 'data-blok-toggle-body-placeholder',
  toggleChildren: 'data-blok-toggle-children',
} as const;
