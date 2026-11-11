/**
 * Finds the scrollable ancestor of an element for auto-scroll during drag
 * @param element - Starting element
 * @param axis - The scroll direction to look for
 * @returns The scrollable element or null if window should be used
 */

export const findScrollableAncestor = (element: HTMLElement | null, axis: 'x' | 'y' = 'y'): HTMLElement | null => {
  if (!element || element === document.body) {
    return null;
  }

  const parent = element.parentElement;

  if (!parent || parent === document.body) {
    return null;
  }

  const style = window.getComputedStyle(parent);
  const overflow = axis === 'y' ? style.overflowY : style.overflowX;
  const isScrollable = overflow === 'auto' || overflow === 'scroll';
  const canScroll = axis === 'y' ? parent.scrollHeight > parent.clientHeight : parent.scrollWidth > parent.clientWidth;

  if (isScrollable && canScroll) {
    return parent;
  }

  return findScrollableAncestor(parent, axis);
};
