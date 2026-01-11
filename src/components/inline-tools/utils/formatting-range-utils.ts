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
