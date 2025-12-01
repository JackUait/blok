/**
 * CSS class names to be used in popover item class
 *
 * Architecture:
 * - BEM classes (blok-popover-item*): Required for CSS variable scoping, complex state selectors,
 *   and nested element styling in popover.css (e.g., confirmation state color overrides)
 * - Tailwind utilities: Used for simple, static styles that don't require CSS file definitions
 *
 * Note: Some styles must remain in popover.css due to:
 * - CSS variable usage (--color-*, --icon-size, etc.)
 * - Complex selectors (&--confirmation .blok-popover-item__title)
 * - Media query hover states (@media (hover: hover))
 * - Pseudo-selectors with state combinations
 */
export const css = {
  /**
   * Container - BEM class required for:
   * - CSS variable scoping (--border-radius, --item-padding)
   * - Complex state selectors in popover.css
   * - External references (tests, other components)
   */
  container: 'blok-popover-item',

  /**
   * Active state - is-* class required for:
   * - CSS variable color (--color-background-icon-active, --color-text-icon-active)
   * - External selectors (inline-tool-bold.ts, tests)
   */
  active: 'is-active',

  /**
   * Disabled state - is-* class for CSS variable color (--color-text-secondary)
   * Combined with Tailwind utilities for cursor and pointer-events
   */
  disabled: 'is-disabled',
  disabledCursor: 'cursor-default',
  disabledPointerEvents: 'pointer-events-none',

  /**
   * Focused state - is-* class required for:
   * - Complex CSS selectors with no-focus modifier
   * - CSS variable background (--color-background-item-focus)
   */
  focused: 'is-focused',

  /** Hidden state - Tailwind utility with important modifier */
  hidden: '!hidden',

  /**
   * Confirmation state - is-* class required for:
   * - CSS variable backgrounds (--color-background-item-confirm*)
   * - Nested element color overrides (.blok-popover-item__title, .blok-popover-item__icon)
   */
  confirmationState: 'is-confirmation',

  /**
   * No hover/focus behavior - BEM classes required for:
   * - CSS hover media query selectors (@media (hover: hover))
   * - Complex :not() selectors in popover.css
   */
  noHover: 'blok-popover-item--no-hover',
  noFocus: 'blok-popover-item--no-focus',

  /**
   * Title - BEM class required for:
   * - Confirmation state color override in popover.css
   * - CSS variable usage for responsive sizing
   */
  title: 'blok-popover-item__title',

  /**
   * Secondary title - BEM class required for:
   * - CSS variable color (--color-text-secondary)
   * - Responsive hiding (mobile:hidden)
   */
  secondaryTitle: 'blok-popover-item__secondary-title',

  /**
   * Icon - BEM class required for:
   * - Confirmation state color override in popover.css
   * - CSS variable sizing (--icon-size)
   * - Responsive sizing (mobile:w-9 mobile:h-9)
   */
  icon: 'blok-popover-item__icon',

  /** Icon tool margin - Tailwind utility for spacing between icon and title */
  iconToolMargin: 'mr-2',

  /** Icon chevron right - BEM class for potential future styling */
  iconChevronRight: 'blok-popover-item__icon--chevron-right',

  /** Wobble animation - defined in tailwind.config.js keyframes */
  wobbleAnimation: 'animate-wobble',
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
