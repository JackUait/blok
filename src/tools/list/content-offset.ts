/**
 * Content Offset - Utilities for calculating horizontal offset of nested list items.
 *
 * Used by the toolbar to position itself closer to nested list items.
 */

import { INDENT_PER_LEVEL } from './constants';

/**
 * Reads the inline-start margin the list tool writes on a nested item.
 *
 * @param element - The list item element
 * @returns Offset from the inline-start edge in px, or undefined when not indented
 */
export const getInlineStartMarginFromElement = (element: Element | null): { left: number } | undefined => {
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }

  const margin = parseFloat(element.style.marginInlineStart);

  return margin > 0 ? { left: margin } : undefined;
}

/**
 * Gets the offset from the data-list-depth attribute
 *
 * @param hoveredElement - The element to start searching from
 * @returns Object with left offset based on depth, undefined if depth is 0 or not found
 */
export const getOffsetFromDepthAttribute = (hoveredElement: Element): { left: number } | undefined => {
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
 * @returns Offset from the inline-start edge in px (`left` is the field name, not
 *   the side), based on the list item's depth
 */
export const getContentOffset = (hoveredElement: Element): { left: number } | undefined => {
  // First try: find listitem in ancestors (when hovering content)
  // Second try: find listitem in descendants (when hovering wrapper)
  const listItemEl = hoveredElement.closest('[role="listitem"]') ||
    hoveredElement.querySelector('[role="listitem"]');

  const marginOffset = getInlineStartMarginFromElement(listItemEl);

  if (marginOffset !== undefined) {
    return marginOffset;
  }

  // Fallback: use data-list-depth from wrapper
  return getOffsetFromDepthAttribute(hoveredElement);
}
