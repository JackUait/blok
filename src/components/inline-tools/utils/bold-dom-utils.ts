/**
 * Check if an element is a bold tag (STRONG or B)
 * @param node - The element to check
 */
const isBoldTag = (node: Element): boolean => {
  const tag = node.tagName;

  return tag === 'B' || tag === 'STRONG';
};

/**
 * Type guard to check if a node is a bold element (STRONG or B)
 * @param node - Node to inspect
 */
export const isBoldElement = (node: Node | null): node is Element => {
  return Boolean(node && node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element));
};

/**
 * Ensure an element is a STRONG tag, converting from B if needed
 * @param element - The element to ensure is a strong tag
 */
export const ensureStrongElement = (element: HTMLElement): HTMLElement => {
  if (element.tagName === 'STRONG') {
    return element;
  }

  const strong = document.createElement('strong');

  if (element.hasAttributes()) {
    Array.from(element.attributes).forEach((attr) => {
      strong.setAttribute(attr.name, attr.value);
    });
  }

  while (element.firstChild) {
    strong.appendChild(element.firstChild);
  }

  element.replaceWith(strong);

  return strong;
};

/**
 * Check if a node is within the provided container
 * @param target - Node to test
 * @param container - Potential ancestor container
 */
export const isNodeWithin = (target: Node | null, container: Node): boolean => {
  if (!target) {
    return false;
  }

  return target === container || container.contains(target);
};
