/**
 * CSS class names to be used in popover item class
 *
 * Uses Tailwind utility classes combined with BEM classes where needed
 * for complex CSS selectors (e.g., confirmation state styling in popover.css)
 */
export const css = {
  /** Container - BEM class needed for CSS variable scoping and complex selectors in popover.css */
  container: 'blok-popover-item',
  /** Active state - BEM class needed for external selectors (inline-tool-bold.ts, tests) */
  active: 'blok-popover-item--active',
  /** Disabled state - BEM class for CSS variable color */
  disabled: 'blok-popover-item--disabled',
  /** Disabled state cursor utility */
  disabledCursor: 'cursor-default',
  /** Disabled state pointer events utility */
  disabledPointerEvents: 'pointer-events-none',
  /** Focused state - BEM class needed for complex CSS selectors with no-focus modifier */
  focused: 'blok-popover-item--focused',
  /** Hidden state */
  hidden: '!hidden',
  /** Confirmation state - BEM class needed for nested element styling in popover.css */
  confirmationState: 'blok-popover-item--confirmation',
  /** No hover behavior - BEM class needed for CSS hover media query selectors */
  noHover: 'blok-popover-item--no-hover',
  /** No focus behavior - BEM class needed for CSS focus selectors */
  noFocus: 'blok-popover-item--no-focus',
  /** Title - BEM class needed for confirmation state color override in popover.css */
  title: 'blok-popover-item__title',
  /** Secondary title - BEM class kept for consistency, styles defined in popover.css */
  secondaryTitle: 'blok-popover-item__secondary-title',
  /** Icon - BEM class needed for confirmation state color override in popover.css */
  icon: 'blok-popover-item__icon',
  /** Icon tool modifier */
  iconTool: 'blok-popover-item__icon--tool',
  /** Icon tool margin */
  iconToolMargin: 'mr-1',
  /** Icon chevron right modifier */
  iconChevronRight: 'blok-popover-item__icon--chevron-right',
  /** Wobble animation for error feedback */
  wobbleAnimation: 'wobble',
};

/**
 * Data attribute name for active state
 */
export const DATA_ATTRIBUTE_ACTIVE = 'data-blok-popover-item-active';

/**
 * Data attribute name for hidden state
 */
export const DATA_ATTRIBUTE_HIDDEN = 'data-blok-hidden';

/**
 * Data attribute name for confirmation state
 */
export const DATA_ATTRIBUTE_CONFIRMATION = 'data-blok-popover-item-confirmation';

/**
 * Data attribute name for no-hover state
 */
export const DATA_ATTRIBUTE_NO_HOVER = 'data-blok-popover-item-no-hover';

/**
 * Data attribute name for no-focus state
 */
export const DATA_ATTRIBUTE_NO_FOCUS = 'data-blok-popover-item-no-focus';

/**
 * Data attribute name for focused state (managed by DomIterator)
 */
export const DATA_ATTRIBUTE_FOCUSED = 'data-blok-focused';

/**
 * Data attribute name for wobble animation state
 */
export const DATA_ATTRIBUTE_WOBBLE = 'data-blok-popover-item-wobble';
