/**
 * Check if an element is a bold tag (STRONG or B)
 * @param node - The element to check
 */
export function isBoldTag(node: Element): boolean {
  const tag = node.tagName;

  return tag === 'B' || tag === 'STRONG';
}

/**
 * Type guard to check if a node is a bold element (STRONG or B)
 * @param node - Node to inspect
 */
export function isBoldElement(node: Node | null): node is Element {
  return Boolean(node && node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element));
}

/**
 * Check if an element has no text content
 * @param element - The element to check
 */
export function isElementEmpty(element: HTMLElement): boolean {
  return (element.textContent ?? '').length === 0;
}

/**
 * Recursively check if a node or any of its parents is a bold tag
 * @param node - The node to check
 */
export function hasBoldParent(node: Node | null): boolean {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return true;
  }

  return hasBoldParent(node.parentNode);
}

/**
 * Recursively find a bold element in the parent chain
 * @param node - The node to start searching from
 */
export function findBoldElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element)) {
    return ensureStrongElement(node as HTMLElement);
  }

  return findBoldElement(node.parentNode);
}

/**
 * Ensure an element is a STRONG tag, converting from B if needed
 * @param element - The element to ensure is a strong tag
 */
export function ensureStrongElement(element: HTMLElement): HTMLElement {
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
}
