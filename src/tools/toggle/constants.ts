/**
 * Constants for the Toggle tool
 */
import { TOGGLE_CHILDREN_CLASSES, TOGGLE_CONTENT_CLASSES, TOGGLE_HEADER_ROW_CLASSES, TOGGLE_WRAPPER_CLASSES } from '../../shared/tool-classes/toggle';

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
/**
 * Static presentational classes live in `src/shared/tool-classes/toggle.ts` so
 * the view emitter stamps the exact same set. `outline-hidden` stays here: it
 * suppresses the focus ring on a contenteditable host and has no static
 * counterpart.
 */
export const BASE_STYLES = ['outline-hidden', ...TOGGLE_WRAPPER_CLASSES].join(' ');

/**
 * Styles for toggle content area
 */
/** Static classes live in src/shared/tool-classes/toggle.ts; outline-hidden is edit-only. */
export const CONTENT_STYLES = ['outline-hidden', ...TOGGLE_CONTENT_CLASSES].join(' ');

/**
 * Styles for toggle wrapper (arrow + content layout)
 *
 * items-start (not items-center) keeps the arrow pinned to the first line of the
 * title. With items-center a title that wraps to multiple lines would drag the
 * arrow down to the vertical middle of the whole block; items-start plus a
 * one-line-tall arrow box (see ARROW_STYLES h-[1.5em]) keeps it on the first line.
 */
/**
 * group/toggle-row is editor-only chrome (drives the arrow's row-hover reveal) and
 * must NOT move into the shared TOGGLE_HEADER_ROW_CLASSES — the view emitter stamps
 * those on the static <summary>, which has no arrow pill to reveal.
 */
export const TOGGLE_WRAPPER_STYLES = [...TOGGLE_HEADER_ROW_CLASSES, 'group/toggle-row'].join(' ');

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
 *
 * The chevron INSIDE the pill does scale: clamp(0.75rem, 0.75em, 1.375rem).
 * em resolves against the arrow's OWN font-size — the header copies the level's
 * text-size class onto the arrow, so a toggle heading's chevron grows with its
 * level, while a toggle list inherits the body size and lands on the 0.75rem
 * floor (the icon's historical 12px). The 1.375rem ceiling keeps the chevron
 * inside the fixed 28px pill.
 *
 * group-hover/toggle-row tints the pill as soon as the pointer is anywhere over
 * the title row (the group class is stamped on the header row by the toggle's
 * dom-builder and the header tool) — without it users read the bare chevron as
 * decoration and never discover it is clickable.
 */
export const ARROW_STYLES = 'flex-shrink-0 w-7 h-7 mt-[calc(0.75em_-_14px)] flex items-center justify-center cursor-pointer select-none rounded can-hover:hover:bg-item-hover-bg can-hover:group-hover/toggle-row:bg-item-hover-bg transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none in-data-[blok-toggle-empty=true]:text-gray-text [&>svg]:w-[clamp(0.75rem,0.75em,1.375rem)] [&>svg]:h-[clamp(0.75rem,0.75em,1.375rem)]';

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
export const TOGGLE_CHILDREN_STYLES = TOGGLE_CHILDREN_CLASSES.join(' ');

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
