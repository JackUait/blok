/**
 * Tailwind CSS class names for popover component
 *
 * Classes are applied directly in components using twMerge for conflict resolution.
 */
export const css = {
  // Popover container - base styles
  popoverContainer: 'absolute flex flex-col overflow-hidden box-border opacity-0 pointer-events-none p-0 border-none z-[4] max-h-0 min-w-[var(--width)] w-[var(--width)] rounded-lg shadow-[0_3px_15px_-3px_theme(colors.popover-shadow)] left-[var(--popover-left)] top-[var(--popover-top)] bg-popover-bg',

  // Popover container - mobile styles (applied conditionally)
  popoverContainerMobile: 'fixed max-w-none rounded-[10px] min-w-[calc(100%-var(--offset)*2)] inset-[auto_var(--offset)_calc(var(--offset)+env(safe-area-inset-bottom))_var(--offset)]',

  // Popover container - opened state
  popoverContainerOpened: 'opacity-100 pointer-events-auto p-1 max-h-[var(--max-height)] border border-popover-border animate-[panelShowing_100ms_ease]',

  // Popover overlay
  popoverOverlay: 'hidden bg-dark',

  items: 'overflow-y-auto overscroll-contain',
};

/**
 * Tailwind CSS class names for inline popover
 * These classes override base popover styles when used in inline context
 */
export const cssInline = {
  // Popover root element for inline
  popover: 'relative',

  // Container for inline popover
  popoverContainer: 'flex-row top-0 min-w-max w-max p-1 mobile:absolute',
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
   * Top position of the popover container
   */
  PopoverTop = '--popover-top',

  /**
   * Left position of the popover container
   */
  PopoverLeft = '--popover-left',

  /**
   * Offset from left of the inline popover item click on which triggers the nested popover opening
   */
  TriggerItemLeft = '--trigger-item-left',

  /**
   * Offset from top of the desktop popover item click on which triggers the nested popover opening
   */
  TriggerItemTop = '--trigger-item-top',
}
