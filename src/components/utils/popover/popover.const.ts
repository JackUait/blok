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
  // No top padding: item-list menus sit flush to the top edge. The search-input's top gap
  // lives on the search element (mt-1.5), and the inline toolbar re-adds pt via cssInline.
  popoverContainerOpened: 'opacity-100 pointer-events-auto px-1.5 pb-0 max-h-(--max-height) border-none',

  // Popover overlay
  popoverOverlay: 'hidden bg-dark',

  // `relative` makes the container the offsetParent of its items so the reel
  // distortion can read item offsetTop values in container coordinates.
  // pt-1.5/pb-1.5 put the before-first and after-last gaps inside the scroll area so
  // they scroll with the list and sit within the reel clip (the outer container has none).
  // flex-auto (basis auto), NOT flex-1 (basis 0%): WebKit resolves a 0% basis inside an
  // auto-height absolutely-positioned container against the containing block's definite
  // height, collapsing nested popovers (e.g. the marker color picker inside the inline
  // toolbar, whose root has an explicit ~38px height) to their padding.
  items: 'relative flex-auto min-h-0 overflow-y-auto overscroll-contain pt-1.5 pb-1.5',
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

  // Container for inline popover — a vertical card: convert row on top, then
  // the formatting button grid
  popoverContainer: 'flex-col top-0 min-w-max w-max p-1 mobile:absolute',

  // Items container for inline popover — the convert row spans all five
  // columns, formatting buttons flow below it five per row. Tracks are at
  // least 2rem so buttons get square-ish cells even when the convert row is
  // narrow; buttons stretch (no justify-items-center) so hover pills fill
  // their whole cell.
  items: 'grid grid-cols-[repeat(5,minmax(2rem,auto))] gap-x-0.5 gap-y-0.5 pt-0 pb-0',

  // Opened state for inline popover - symmetric padding (no scroll area, so pt matches pb).
  // pt is re-added here because the shared opened state drops it for flush item-list menus.
  popoverContainerOpened: 'pt-1.5 pb-1.5',
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
