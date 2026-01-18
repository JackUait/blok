/**
 * Check if a node intersects with a range, with Safari fallback
 * @param range - The range to check intersection with
 * @param node - The node to check
 */
const nodeIntersectsRange = (range: Range, node: Node): boolean => {
  try {
    return range.intersectsNode(node);
  } catch (_error) {
    /**
     * Safari might throw if node is detached from DOM.
     * Fall back to manual comparison by wrapping node into a range.
     */
    const nodeRange = document.createRange();

    nodeRange.selectNodeContents(node);

    const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
    const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

    return startsBeforeEnd && endsAfterStart;
  }
};

/**
 * Create a TreeWalker that iterates text nodes intersecting a range
 * @param range - The range to iterate within
 */
export const createRangeTextWalker = (range: Range): TreeWalker => {
  return document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        return nodeIntersectsRange(range, node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    }
  );
};

/**
 * Find first ancestor element matching the predicate
 * @param node - The node to start searching from
 * @param predicate - Function to test elements
 */
export const findFormattingAncestor = (
  node: Node | null,
  predicate: (element: Element) => boolean
): HTMLElement | null => {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && predicate(node as Element)) {
    return node as HTMLElement;
  }

  return findFormattingAncestor(node.parentNode, predicate);
};

/**
 * Check if any ancestor matches the predicate
 * @param node - The node to check
 * @param predicate - Function to test elements
 */
export const hasFormattingAncestor = (
  node: Node | null,
  predicate: (element: Element) => boolean
): boolean => {
  return findFormattingAncestor(node, predicate) !== null;
};

/**
 * Options for checking if a range is formatted
 */
export interface IsRangeFormattedOptions {
  /** Whether to ignore whitespace-only text nodes */
  ignoreWhitespace?: boolean;
}

/**
 * Check if all text nodes in a range have a matching formatting ancestor
 * @param range - The range to check
 * @param predicate - Function to test elements for formatting
 * @param options - Options for the check
 */
export const isRangeFormatted = (
  range: Range,
  predicate: (element: Element) => boolean,
  options: IsRangeFormattedOptions = {}
): boolean => {
  if (range.collapsed) {
    return findFormattingAncestor(range.startContainer, predicate) !== null;
  }

  const walker = createRangeTextWalker(range);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const value = textNode.textContent;

    if (options.ignoreWhitespace && value.trim().length === 0) {
      continue;
    }

    if (value.length === 0) {
      continue;
    }

    textNodes.push(textNode);
  }

  if (textNodes.length === 0) {
    return findFormattingAncestor(range.startContainer, predicate) !== null;
  }

  return textNodes.every((textNode) => hasFormattingAncestor(textNode, predicate));
};

/**
 * Collect all unique formatting ancestors within a range
 * @param range - The range to search within
 * @param predicate - Function to test elements for formatting
 */
export const collectFormattingAncestors = (
  range: Range,
  predicate: (element: Element) => boolean
): HTMLElement[] => {
  const ancestors = new Set<HTMLElement>();
  const walker = createRangeTextWalker(range);

  while (walker.nextNode()) {
    const ancestor = findFormattingAncestor(walker.currentNode, predicate);

    if (ancestor) {
      ancestors.add(ancestor);
    }
  }

  return Array.from(ancestors);
};
