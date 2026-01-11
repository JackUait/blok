/**
 * Check if an element is a bold tag (STRONG or B)
 * @param node - The element to check
 */
export function isBoldTag(node: Element): boolean {
  const tag = node.tagName;

  return tag === 'B' || tag === 'STRONG';
}
