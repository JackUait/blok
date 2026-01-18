/**
 * Finds the scrollable ancestor of an element for auto-scroll during drag
 * @param element - Starting element
 * @returns The scrollable element or null if window should be used
 */

export const findScrollableAncestor = (element: HTMLElement | null): HTMLElement | null => {
  if (!element || element === document.body) {
    return null;
  }

  const parent = element.parentElement;

  if (!parent || parent === document.body) {
    return null;
  }

  const style = window.getComputedStyle(parent);
  const overflowY = style.overflowY;
  const isScrollable = overflowY === 'auto' || overflowY === 'scroll';
  const canScroll = parent.scrollHeight > parent.clientHeight;

  if (isScrollable && canScroll) {
    return parent;
  }

  return findScrollableAncestor(parent);
};
