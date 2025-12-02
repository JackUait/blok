/**
 * Tailwind CSS class names for popover component
 *
 * Classes are applied directly in components using twMerge for conflict resolution.
 */
export const css = {
  // Popover root element
  popover: '',

  // Popover container - base styles
  popoverContainer: 'absolute flex flex-col overflow-hidden box-border opacity-0 pointer-events-none p-0 border-none z-[4] max-h-0 min-w-[var(--width)] w-[var(--width)] rounded-lg shadow-[0_3px_15px_-3px_theme(colors.popover-shadow)] left-[var(--popover-left)] top-[var(--popover-top)] bg-popover-bg',

  // Popover container - mobile styles (applied conditionally)
  popoverContainerMobile: 'fixed max-w-none rounded-[10px] min-w-[calc(100%-var(--offset)*2)] inset-[auto_var(--offset)_calc(var(--offset)+env(safe-area-inset-bottom))_var(--offset)]',

  // Popover container - opened state
  popoverContainerOpened: 'opacity-100 pointer-events-auto p-1 max-h-[var(--max-height)] border border-popover-border animate-[panelShowing_100ms_ease]',

  // Popover container - opened state on mobile
  popoverContainerOpenedMobile: 'animate-[panelShowingMobile_250ms_ease]',

  // Popover overlay
  popoverOverlay: 'hidden bg-dark',

  // Popover overlay - mobile visible state
  popoverOverlayMobile: 'fixed inset-0 block visible z-[3] opacity-50 transition-opacity duration-[120ms] ease-in will-change-[opacity]',

  // Utility classes
  search: 'mb-1.5',
  items: 'overflow-y-auto overscroll-contain',
  nothingFoundMessage: 'hidden cursor-default text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis text-gray-text p-[3px]',
  nothingFoundMessageDisplayed: '!block',
  popoverHeader: 'flex items-center mb-2 mt-1',
};

/**
 * Tailwind CSS class names for inline popover
 * These classes override base popover styles when used in inline context
 */
export const cssInline = {
  // Popover root element for inline
  popover: 'relative',

  // Popover root when opened (inline)
  popoverOpened: 'inline-block',

  // Items container in inline context
  items: 'flex',

  // Custom content in inline context
  customContent: '!mb-0',

  // Container for inline popover
  popoverContainer: 'flex-row top-0 min-w-max w-max p-1 mobile:absolute',

  // Container opened state for inline (overrides animation)
  popoverContainerOpened: 'animate-none',

  // Item in inline context
  item: 'rounded p-1',

  // Icon in inline context
  icon: 'w-auto h-auto',

  // Icon with tool attribute in inline context
  iconTool: 'shadow-none bg-transparent !mr-0',

  // Item separator in inline context
  separator: 'px-1 py-0',

  // Separator line in inline context
  separatorLine: 'h-full w-px',

  // Item HTML wrapper in inline context
  itemHtml: 'flex items-center',

  // Chevron icon rotation in inline context
  chevronRight: 'rotate-90',

  // Nested popover container positioned below trigger (level-1)
  nestedLevel1Container: 'left-0',

  // Nested popover container (looks like regular desktop popover)
  nestedContainer: 'h-fit p-1.5 flex-col',

  // Nested items container
  nestedItems: 'block w-full',

  // Nested item
  nestedItem: 'rounded-md p-[3px] mobile:p-1',

  // Nested icon with tool
  nestedIconTool: '!mr-2',

  // Nested icon size
  nestedIcon: 'w-toolbox-btn h-toolbox-btn',

  // Nested separator
  nestedSeparator: 'py-1 px-[3px]',

  // Nested separator line
  nestedSeparatorLine: 'w-full h-px',
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
