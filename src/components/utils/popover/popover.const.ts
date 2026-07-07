/**
 * Tailwind CSS class names for popover component
 *
 * Classes are applied directly in components using twMerge for conflict resolution.
 */
export const css = {
  // Popover container - base styles
  popoverContainer: 'absolute flex flex-col overflow-hidden box-border opacity-0 pointer-events-none p-0 border-none z-[var(--blok-z-popover)] max-h-0 min-w-(--width) w-(--width) rounded-xl text-sm left-(--popover-left) top-(--popover-top) bg-popover-bg',

  // Popover container - mobile styles (applied conditionally)
  // Reset left/top from base class since inset shorthand may not properly override them in twMerge
  popoverContainerMobile: 'fixed max-w-none rounded-[10px] min-w-[calc(100%-var(--offset)*2)] left-auto top-auto inset-[auto_var(--offset)_calc(var(--offset)+env(safe-area-inset-bottom))_var(--offset)]',

  // Popover container - opened state
  popoverContainerOpened: 'opacity-100 pointer-events-auto px-1.5 pt-1.5 pb-0 max-h-(--max-height) border-none',

  // Popover overlay
  popoverOverlay: 'hidden bg-dark',

  // `relative` makes the container the offsetParent of its items so the reel
  // distortion can read item offsetTop values in container coordinates
  items: 'relative flex-1 min-h-0 overflow-y-auto overscroll-contain pb-1.5',
};

/**
 * Reel-like edge distortion applied to popover items as they scroll past the
 * viewport edges (instead of a gradient haze). Values are the maximum effect
 * reached when an item is fully clipped past an edge.
 */
export const REEL_DISTORTION = {
  /** Maximum vertical squash (scaleY shrinks to 1 - maxSquashY) */
  maxSquashY: 0.6,

  /** Maximum horizontal pinch (scaleX shrinks to 1 - maxSquashX) */
  maxSquashX: 0.15,

  /** Maximum opacity dim (opacity falls to 1 - maxDim) */
  maxDim: 0.5,
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

  // Opened state for inline popover - symmetric padding (no scroll area, so pb matches pt)
  popoverContainerOpened: 'pb-1.5',
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
