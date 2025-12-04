/**
 * Tailwind CSS class names for popover item
 */
export const css = {
  /**
   * Base item styles with hover and focus support
   * Hover is applied via can-hover:hover: for real hover and data-blok-force-hover for tests
   * Focus is applied via data-blok-focused attribute (set by DomIterator during keyboard navigation)
   * Note: noHover state is handled via [data-blok-popover-item-no-hover] which disables hover
   */
  item: 'flex items-center select-none border-none bg-transparent rounded-md p-[var(--item-padding)] text-text-primary mb-px can-hover:hover:cursor-pointer can-hover:hover:bg-item-hover-bg [&[data-blok-force-hover]]:cursor-pointer [&[data-blok-force-hover]]:bg-item-hover-bg [&[data-blok-focused="true"]]:bg-item-focus-bg [&[data-blok-popover-item-no-hover]]:hover:bg-transparent [&[data-blok-popover-item-no-hover]]:cursor-default',

  /**
   * Item active state
   */
  itemActive: 'bg-icon-active-bg text-icon-active-text',

  /**
   * Item disabled state
   */
  itemDisabled: 'cursor-default pointer-events-none text-text-secondary',

  /**
   * Icon container styles
   */
  icon: 'flex items-center justify-center w-[26px] h-[26px] [&_svg]:w-icon [&_svg]:h-icon',

  /**
   * Focused state class for DomIterator/Flipper keyboard navigation.
   * Used alongside data-blok-focused attribute.
   */
  focused: 'is-focused',
};

/**
 * Tailwind CSS class names for inline popover item
 */
export const cssInline = {
  /**
   * Item in inline context - more compact styling
   */
  item: 'rounded p-1',
};

/**
 * Tailwind CSS class names for nested inline popover item
 */
export const cssNestedInline = {
  /**
   * Nested item - back to desktop popover styling
   */
  item: 'rounded-md p-[3px] mobile:p-1',
};

/**
 * Data attributes for popover item state management
 */
export const DATA_ATTR = {
  item: 'data-blok-popover-item',
  icon: 'data-blok-popover-item-icon',
  iconTool: 'data-blok-tool',
  iconChevronRight: 'data-blok-popover-item-icon-chevron-right',
  title: 'data-blok-popover-item-title',
  secondaryTitle: 'data-blok-popover-item-secondary-title',
  active: 'data-blok-popover-item-active',
  hidden: 'data-blok-hidden',
  confirmation: 'data-blok-popover-item-confirmation',
  noHover: 'data-blok-popover-item-no-hover',
  noFocus: 'data-blok-popover-item-no-focus',
  focused: 'data-blok-focused',
  wobble: 'data-blok-popover-item-wobble',
  disabled: 'data-blok-disabled',
  hasChildren: 'data-blok-has-children',
} as const;

/**
 * @deprecated Use DATA_ATTR.active instead
 */
export const DATA_ATTRIBUTE_ACTIVE = DATA_ATTR.active;

/**
 * @deprecated Use DATA_ATTR.hidden instead
 */
export const DATA_ATTRIBUTE_HIDDEN = DATA_ATTR.hidden;

/**
 * @deprecated Use DATA_ATTR.confirmation instead
 */
export const DATA_ATTRIBUTE_CONFIRMATION = DATA_ATTR.confirmation;

/**
 * @deprecated Use DATA_ATTR.noHover instead
 */
export const DATA_ATTRIBUTE_NO_HOVER = DATA_ATTR.noHover;

/**
 * @deprecated Use DATA_ATTR.noFocus instead
 */
export const DATA_ATTRIBUTE_NO_FOCUS = DATA_ATTR.noFocus;

/**
 * @deprecated Use DATA_ATTR.focused instead
 */
export const DATA_ATTRIBUTE_FOCUSED = DATA_ATTR.focused;

/**
 * @deprecated Use DATA_ATTR.wobble instead
 */
export const DATA_ATTRIBUTE_WOBBLE = DATA_ATTR.wobble;
