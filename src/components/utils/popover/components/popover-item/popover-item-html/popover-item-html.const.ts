/**
 * Tailwind CSS classes for popover item HTML component
 */
export const css = {
  root: '',
  rootHidden: 'hidden',
  /**
   * Pinned at the list's very top edge. The items list pads its top with
   * --blok-space-1 (popover.const.ts css.items); pinning at 0 would leave
   * that strip for rows to show through above the sticky item.
   */
  rootSticky: 'sticky -top-(--blok-space-1) z-1',
};

/**
 * Tailwind CSS classes for inline popover item HTML
 */
export const cssInline = {
  root: 'flex items-center',
};
