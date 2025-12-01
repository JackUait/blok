/**
 * CSS class names for popover item
 *
 * Note: Most styling is now handled via data attributes in CSS.
 * Only `focused` is retained for DomIterator/Flipper keyboard navigation compatibility.
 */
export const css = {
  /**
   * Focused state class for DomIterator/Flipper keyboard navigation.
   * Used alongside data-blok-focused attribute.
   */
  focused: 'is-focused',
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
