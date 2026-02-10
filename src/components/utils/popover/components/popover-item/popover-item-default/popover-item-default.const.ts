/**
 * Tailwind CSS class names for popover item
 */
export const css = {
  /**
   * Base item styles with hover, focus, and active support
   * Hover is applied via can-hover:hover: for real hover and data-blok-force-hover for tests
   * Focus is applied via data-blok-focused attribute (set by DomIterator during keyboard navigation)
   * Active is applied via data-blok-popover-item-active attribute
   * Note: noHover state is handled via [data-blok-popover-item-no-hover] which disables hover
   * Priority order: active < hover < focus (focus wins when navigating with keyboard)
   */
  item: 'flex items-center select-none border-none bg-transparent rounded-md pl-2 pr-8 py-[var(--item-padding)] text-text-primary mb-px [&[data-blok-popover-item-active]]:bg-icon-active-bg [&[data-blok-popover-item-active]]:text-icon-active-text can-hover:hover:cursor-pointer can-hover:hover:bg-item-hover-bg [&[data-blok-force-hover]]:cursor-pointer [&[data-blok-force-hover]]:bg-item-hover-bg [&[data-blok-focused="true"]]:bg-item-focus-bg [&[data-blok-popover-item-no-hover]]:hover:bg-transparent [&[data-blok-popover-item-no-hover]]:cursor-default can-hover:[&[data-blok-popover-item-destructive]]:hover:text-item-destructive-text can-hover:[&[data-blok-popover-item-destructive]]:hover:bg-item-destructive-hover-bg [&[data-blok-popover-item-destructive][data-blok-force-hover]]:text-item-destructive-text [&[data-blok-popover-item-destructive][data-blok-force-hover]]:bg-item-destructive-hover-bg [&[data-blok-popover-item-destructive][data-blok-focused="true"]]:text-item-destructive-text [&[data-blok-popover-item-destructive][data-blok-focused="true"]]:bg-item-destructive-hover-bg',

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
