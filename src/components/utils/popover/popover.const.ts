/**
 * Tailwind CSS class names for popover component
 *
 * All styling is now handled via data attributes in CSS.
 * Classes here are pure Tailwind utilities for non-state-based styles.
 */
export const css = {
  // Utility classes - pure Tailwind
  search: 'mb-1.5',
  items: 'overflow-y-auto overscroll-contain',
  nothingFoundMessage: 'hidden cursor-default text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-text p-[3px]',
  nothingFoundMessageDisplayed: '!block',
  popoverHeader: 'flex items-center mb-2 mt-1',
};

/**
 * Data attributes for popover component
 *
 * Used for:
 * 1. CSS selectors in stylesheets (e.g., [data-blok-popover])
 * 2. State management via setAttribute/removeAttribute
 * 3. Test selectors via data-blok-testid
 */
export const DATA_ATTR = {
  // Core popover elements
  popover: 'data-blok-popover',
  popoverContainer: 'data-blok-popover-container',
  popoverItems: 'data-blok-popover-items',
  popoverOverlay: 'data-blok-popover-overlay',
  popoverCustomContent: 'data-blok-popover-custom-content',

  // Popover variants
  popoverInline: 'data-blok-popover-inline',
  nested: 'data-blok-nested',
  nestedLevel: 'data-blok-nested-level',

  // Popover state
  opened: 'data-blok-popover-opened',
  openTop: 'data-blok-popover-open-top',
  openLeft: 'data-blok-popover-open-left',
  overlayHidden: 'data-blok-overlay-hidden',
  nothingFoundDisplayed: 'data-blok-nothing-found-displayed',
  hidden: 'data-blok-hidden',
} as const;

/**
 * @deprecated Use DATA_ATTR.opened instead
 */
export const DATA_ATTRIBUTE_OPENED = DATA_ATTR.opened;

/**
 * @deprecated Use DATA_ATTR.nested instead
 */
export const DATA_ATTRIBUTE_NESTED = DATA_ATTR.nested;

/**
 * @deprecated Use DATA_ATTR.openTop instead
 */
export const DATA_ATTRIBUTE_OPEN_TOP = DATA_ATTR.openTop;

/**
 * @deprecated Use DATA_ATTR.openLeft instead
 */
export const DATA_ATTRIBUTE_OPEN_LEFT = DATA_ATTR.openLeft;

/**
 * @deprecated Use DATA_ATTR.nothingFoundDisplayed instead
 */
export const DATA_ATTRIBUTE_NOTHING_FOUND_DISPLAYED = DATA_ATTR.nothingFoundDisplayed;

/**
 * Helper to get nested level attribute value
 * @param level - nesting level
 */
export const getNestedLevelAttrValue = (level: number): string => {
  return `level-${level}`;
};

/**
 * CSS variables names to be used in popover
 */
export enum CSSVariables {
  /**
   * Stores nesting level of the popover
   */
  NestingLevel = '--nesting-level',

  /**
   * Stores actual popover height. Used for desktop popovers
   */
  PopoverHeight = '--popover-height',

  /**
   * Width of the inline popover
   */
  InlinePopoverWidth = '--inline-popover-width',

  /**
   * Offset from left of the inline popover item click on which triggers the nested popover opening
   */
  TriggerItemLeft = '--trigger-item-left',

  /**
   * Offset from top of the desktop popover item click on which triggers the nested popover opening
   */
  TriggerItemTop = '--trigger-item-top',
}
