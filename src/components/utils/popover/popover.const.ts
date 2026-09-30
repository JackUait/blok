/**
 * Tailwind CSS class names for popover component
 *
 * Classes are applied directly in components using twMerge for conflict resolution.
 */
export const css = {
  // Popover container - base styles. The radius lives in popover-animation.css,
  // which also derives --blok-radius-inner from the padding set below.
  popoverContainer: 'absolute flex flex-col overflow-hidden box-border opacity-0 pointer-events-none p-0 border-none z-[var(--blok-z-popover)] max-h-0 min-w-(--width) w-(--width) text-sm left-(--popover-left) top-(--popover-top) bg-popover-bg',

  // Popover container - mobile styles (applied conditionally)
  // Reset left/top from base class since inset shorthand may not properly override them in twMerge
  popoverContainerMobile: 'fixed max-w-none min-w-[calc(100%-var(--offset)*2)] left-auto top-auto inset-[auto_var(--offset)_calc(var(--offset)+env(safe-area-inset-bottom))_var(--offset)]',

  // Popover container - opened state
  // No top padding: item-list menus sit flush to the top edge. The search-input's top gap
  // lives on the search element, and the inline toolbar re-adds pt via cssInline.
  // --blok-space-1 is the gap --blok-radius-inner subtracts (popover-animation.css).
  popoverContainerOpened: 'opacity-100 pointer-events-auto px-(--blok-space-1) pb-0 max-h-(--max-height) border-none',

  // Popover overlay
  popoverOverlay: 'hidden bg-dark',

  // `relative` makes the container the offsetParent of its items so the reel
  // distortion can read item offsetTop values in container coordinates.
  // pt/pb put the before-first and after-last gaps inside the scroll area so
  // they scroll with the list and sit within the reel clip (the outer container has none).
  // flex-auto (basis auto), NOT flex-1 (basis 0%): WebKit resolves a 0% basis inside an
  // auto-height absolutely-positioned container against the containing block's definite
  // height, collapsing nested popovers (e.g. the marker color picker inside the inline
  // toolbar, whose root has an explicit ~38px height) to their padding.
  items: 'relative flex-auto min-h-0 overflow-y-auto overscroll-contain pt-(--blok-space-1) pb-(--blok-space-1)',
};

/**
 * Reel-like edge distortion applied to popover items as they scroll past the
 * viewport edges (instead of a gradient haze). Values are the maximum effect
 * reached when an item is fully clipped past an edge.
 */
export const REEL_DISTORTION = {
  /** Maximum vertical squash (scaleY shrinks to 1 - maxSquashY) */
  maxSquashY: 0.4,

  /** Maximum horizontal pinch (scaleX shrinks to 1 - maxSquashX) */
  maxSquashX: 0.1,

  /** Maximum opacity dim (opacity falls to 1 - maxDim) */
  maxDim: 0.5,

  /** Maximum rotateX tilt in degrees — curls the item over the reel edge */
  maxTiltDeg: 25,

  /** Perspective depth in px applied per item for the rotateX tilt */
  perspective: 800,
};

/**
 * Tailwind CSS class names for inline popover
 * These classes override base popover styles when used in inline context
 */
export const cssInline = {
  // Popover root element for inline
  popover: 'relative',

  // Notion card: 8px padding. Width comes from the five fixed tracks.
  popoverContainer: 'flex-col top-0 min-w-0 w-max max-w-[calc(100vw-16px)] p-2 mobile:absolute',

  // Fixed tracks, so extra tools start a new row of five instead of widening the card.
  // Phones get 40px tracks: 28px-tall cells are too small to tap.
  items: 'grid grid-cols-[repeat(5,2rem)] mobile:grid-cols-[repeat(5,2.5rem)] gap-1 pt-0 pb-0',

  // The shared opened state sets px and pb-0. Per-side classes, because the
  // house twMerge does not let a later p-2 override px/pb. --blok-space-2 is
  // the gap the inline card's --blok-radius-inner subtracts.
  popoverContainerOpened: 'px-(--blok-space-2) pt-(--blok-space-2) pb-(--blok-space-2)',
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
