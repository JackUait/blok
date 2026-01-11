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
