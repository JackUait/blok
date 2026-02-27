import { findFormattingAncestor } from './formatting-range-utils';

/**
 * Check if an element is a <mark> tag
 * @param element - The element to check
 */
export const isMarkTag = (element: Element): boolean => {
  return element.tagName === 'MARK';
};

/**
 * Find closest <mark> ancestor from a node
 * @param node - The node to start searching from
 */
export const findMarkElement = (node: Node | null): HTMLElement | null => {
  return findFormattingAncestor(node, isMarkTag);
};
