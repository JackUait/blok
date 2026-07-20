/**
 * Constants for the Toggle tool
 */

import { IconChevronRightSmall } from '../../components/icons';

/**
 * Tool name used when registering this tool with Blok
 */
export const TOOL_NAME = 'toggle';

/**
 * Placeholder translation key
 */
export const PLACEHOLDER_KEY = 'tools.toggle.placeholder';

/**
 * Body placeholder translation key (shown when toggle is open and has no children)
 */
export const BODY_PLACEHOLDER_KEY = 'tools.toggle.bodyPlaceholder';

/**
 * Aria label translation keys for the toggle arrow
 */
export const ARIA_LABEL_COLLAPSE_KEY = 'tools.toggle.ariaLabelCollapse';
export const ARIA_LABEL_EXPAND_KEY = 'tools.toggle.ariaLabelExpand';

/**
 * Base styles for toggle wrapper
 *
 * Vertical padding matches blok-block (paragraph) via the public
 * --blok-block-padding-top/-bottom tokens (7px fallbacks); mt-[2px] mb-px
 * provides block margin.
 */
export const BASE_STYLES = 'outline-hidden pt-[var(--blok-block-padding-top,7px)] pb-[var(--blok-block-padding-bottom,7px)] mt-[2px] mb-px';

/**
 * Styles for toggle content area
 */
export const CONTENT_STYLES = 'outline-hidden pl-0.5 leading-[1.5] flex-1 min-w-0';

/**
 * Styles for toggle wrapper (arrow + content layout)
 *
 * items-start (not items-center) keeps the arrow pinned to the first line of the
 * title. With items-center a title that wraps to multiple lines would drag the
 * arrow down to the vertical middle of the whole block; items-start plus a
 * one-line-tall arrow box (see ARROW_STYLES h-[1.5em]) keeps it on the first line.
 */
export const TOGGLE_WRAPPER_STYLES = 'flex items-start';

/**
 * Styles for the toggle arrow button
 *
 * The pill is a FIXED 28px square (h-7 w-7) so its height never changes with the
 * block's font-size — it looks identical for a paragraph toggle and every heading
 * level. To keep it on the FIRST line of a wrapping title, its center is offset
 * onto that line rather than sized to it: with the row using items-start the pill
 * top starts at the content top, and mt-[calc(0.75em-14px)] shifts it up by
 * (half a line − half the pill) so the pill's center coincides with the first
 * line's center (0.75em = half of leading-[1.5]; 14px = half of h-7). em resolves
 * against the shared block font-size, so this stays correct if the font changes.
 * The 28px width keeps children (pl-7) aligned under the title text.
 */
export const ARROW_STYLES = 'flex-shrink-0 w-7 h-7 mt-[calc(0.75em_-_14px)] flex items-center justify-center cursor-pointer select-none rounded can-hover:hover:bg-item-hover-bg transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none in-data-[blok-toggle-empty=true]:text-gray-text';

/**
 * SVG icon for the toggle arrow
 */
export const ARROW_ICON = IconChevronRightSmall;

/**
 * Styles for the body placeholder element
 *
 * Vertical padding matches a child paragraph's layout contribution:
 *   - Paragraph element: py-[7px] (7px top, 7px bottom) + mt-px mb-px (1px margins)
 *   - Combined per side: 7px padding + 1px margin = 8px
 * Using fixed px values (not em) because py-[7px] and mt-px are also fixed.
 *
 * pl-7 (28px) aligns the placeholder with the title text start (arrow button width: 8px + 12px SVG + 8px = 28px).
 */
export const BODY_PLACEHOLDER_STYLES = 'hidden pl-7 pt-[8px] pb-[8px] text-gray-text leading-[1.5] cursor-pointer select-none';

/**
 * Styles for the children container element.
 * pl-7 (28px) aligns children with the toggle list title text start (arrow button total width).
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
  toggleEmpty: 'data-blok-toggle-empty',
} as const;
