import type { TextDirection } from './portal-direction';

export type { TextDirection };

/**
 * Effective direction of an element, as layout sees it.
 *
 * Read from the element itself, not the editor config: a block can carry its
 * own `dir` (mixed-direction content, a code block pinned LTR).
 */
export const getElementDirection = (element: Element | null | undefined): TextDirection => {
  if (element === null || element === undefined) {
    return 'ltr';
  }

  return window.getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr';
};

/**
 * Maps a physical horizontal arrow to reading order: `forward` moves toward the
 * inline end (right in LTR, left in RTL).
 */
export const logicalArrow = (key: string, direction: TextDirection): 'forward' | 'backward' | null => {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
    return null;
  }

  return (key === 'ArrowRight') === (direction === 'ltr') ? 'forward' : 'backward';
};

/**
 * Pointer distance from the inline-start edge of a box.
 */
export const inlineStartOffset = (
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'right'>,
  direction: TextDirection
): number => direction === 'rtl' ? rect.right - clientX : clientX - rect.left;

/**
 * Scroll distance from the inline start, always `0…max`. Browsers report RTL
 * `scrollLeft` as `0` at the start and negative toward the end.
 */
export const scrollFromInlineStart = (element: Element, direction: TextDirection): number =>
  direction === 'rtl' ? Math.abs(element.scrollLeft) : element.scrollLeft;
