/**
 * Content Offset - Utilities for calculating horizontal offset of nested list items.
 *
 * Used by the toolbar to position itself closer to nested list items.
 */

import { INDENT_PER_LEVEL } from './constants';

/**
 * Extracts the margin-left value from an element's inline style
 *
 * @param element - The element to extract margin-left from
 * @returns Object with left offset if valid margin-left found, undefined otherwise
 */
export function getMarginLeftFromElement(element: Element | null): { left: number } | undefined {
  if (!element) {
    return undefined;
  }

  const style = element.getAttribute('style') || '';
  const marginMatch = style.match(/margin-left:\s*(\d+)px/);

  if (!marginMatch) {
    return undefined;
  }

  const marginLeft = parseInt(marginMatch[1], 10);

  return marginLeft > 0 ? { left: marginLeft } : undefined;
}

/**
 * Gets the offset from the data-list-depth attribute
 *
 * @param hoveredElement - The element to start searching from
 * @returns Object with left offset based on depth, undefined if depth is 0 or not found
 */
export function getOffsetFromDepthAttribute(hoveredElement: Element): { left: number } | undefined {
  const wrapper = hoveredElement.closest('[data-list-depth]');

  if (!wrapper) {
    return undefined;
  }

  const depthAttr = wrapper.getAttribute('data-list-depth');

  if (depthAttr === null) {
    return undefined;
  }

  const depth = parseInt(depthAttr, 10);

  return depth > 0 ? { left: depth * INDENT_PER_LEVEL } : undefined;
}

/**
 * Returns the horizontal offset of the content at the hovered element.
 * Used by the toolbar to position itself closer to nested list items.
 *
 * @param hoveredElement - The element that is currently being hovered
 * @returns Object with left offset in pixels based on the list item's depth
 */
export function getContentOffset(hoveredElement: Element): { left: number } | undefined {
  // First try: find listitem in ancestors (when hovering content)
  // Second try: find listitem in descendants (when hovering wrapper)
  const listItemEl = hoveredElement.closest('[role="listitem"]')
    ?? hoveredElement.querySelector('[role="listitem"]');

  const marginLeftOffset = getMarginLeftFromElement(listItemEl);

  if (marginLeftOffset !== undefined) {
    return marginLeftOffset;
  }

  // Fallback: use data-list-depth from wrapper
  return getOffsetFromDepthAttribute(hoveredElement);
}
