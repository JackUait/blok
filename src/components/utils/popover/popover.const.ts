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
