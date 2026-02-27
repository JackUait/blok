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

/**
 * Get a specific style property value from a mark element
 * @param mark - The mark element
 * @param property - CSS property name ('color' or 'background-color')
 */
export const getMarkStyle = (mark: HTMLElement, property: 'color' | 'background-color'): string => {
  return mark.style.getPropertyValue(property);
};

/**
 * Build an inline style string for a mark element
 * @param styles - Object with optional color and backgroundColor values
 */
export const buildMarkStyleString = (styles: { color?: string; backgroundColor?: string }): string => {
  const parts: string[] = [];

  if (styles.color) {
    parts.push(`color: ${styles.color}`);
  }

  if (styles.backgroundColor) {
    parts.push(`background-color: ${styles.backgroundColor}`);
  }

  return parts.join('; ');
};
