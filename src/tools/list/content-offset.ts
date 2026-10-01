/**
 * Content Offset - Utilities for calculating horizontal offset of nested list items.
 *
 * Used by the toolbar to position itself closer to nested list items.
 */

import { getElementDirection } from '../../components/utils/direction';
import { INDENT_PER_LEVEL } from './constants';

/**
 * Reads the margin-inline-start the list tool writes on a nested item.
 *
 * @param element - The list item element
 * @returns Indent in px, or undefined when not indented
 */
export const getInlineStartMarginFromElement = (element: Element | null): number | undefined => {
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }

  const margin = parseFloat(element.style.marginInlineStart);

  return margin > 0 ? margin : undefined;
}

/**
 * Gets the indent from the data-list-depth attribute
 *
 * @param hoveredElement - The element to start searching from
 * @returns Indent in px based on depth, undefined if depth is 0 or not found
 */
export const getOffsetFromDepthAttribute = (hoveredElement: Element): number | undefined => {
  const wrapper = hoveredElement.closest('[data-list-depth]');

  if (!wrapper) {
    return undefined;
  }

  const depthAttr = wrapper.getAttribute('data-list-depth');

  if (depthAttr === null) {
    return undefined;
  }

  const depth = parseInt(depthAttr, 10);

  return depth > 0 ? depth * INDENT_PER_LEVEL : undefined;
}

/**
 * Returns the physical inset of the list item at the hovered element.
 * Used by the toolbar to position itself closer to nested list items.
 *
 * @param hoveredElement - The element that is currently being hovered
 * @returns The indent on the side it lies: `right` for an RTL item, `left` otherwise
 */
export const getContentOffset = (hoveredElement: Element): { left: number; right?: number } | undefined => {
  // First try: find listitem in ancestors (when hovering content)
  // Second try: find listitem in descendants (when hovering wrapper)
  const listItemEl = hoveredElement.closest('[role="listitem"]') ||
    hoveredElement.querySelector('[role="listitem"]');

  // Fallback: use data-list-depth from wrapper
  const indent = getInlineStartMarginFromElement(listItemEl) ?? getOffsetFromDepthAttribute(hoveredElement);

  if (indent === undefined) {
    return undefined;
  }

  // The item's own direction, not the editor's: an Arabic item in an LTR editor
  // indents from the right.
  return getElementDirection(listItemEl ?? hoveredElement) === 'rtl'
    ? { left: 0, right: indent }
    : { left: indent };
}
