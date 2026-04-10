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
  // When commonAncestorContainer is a text node, it has no descendants —
  // the TreeWalker would find nothing. Use the parent element as root so
  // the text node itself is reachable as a child. The nodeIntersectsRange
  // filter still restricts results to nodes within the range.
  const container = range.commonAncestorContainer;
  const root = container.nodeType === Node.TEXT_NODE
    ? (container.parentNode ?? container)
    : container;

  return document.createTreeWalker(
    root,
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
 * @param boundary - Optional node that stops the upward traversal.
 *                   When reached, the search returns null instead of continuing.
 */
export const findFormattingAncestor = (
  node: Node | null,
  predicate: (element: Element) => boolean,
  boundary?: Node
): HTMLElement | null => {
  if (!node || node === boundary) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE && predicate(node as Element)) {
    return node as HTMLElement;
  }

  return findFormattingAncestor(node.parentNode, predicate, boundary);
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
 * Walk down the `lastChild` chain of `node` and return the deepest last
 * descendant that is a text node, or `null` if none exists.
 */
const findDeepestLastTextNode = (node: Node): Text | null => {
  const last = node.lastChild;

  if (last === null) {
    return node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
  }

  return findDeepestLastTextNode(last);
};

/**
 * Extend the range to include any trailing whitespace characters that browsers
 * exclude from selections (e.g. Ctrl+A on loaded text stops before trailing spaces).
 *
 * When text is loaded via innerHTML (e.g. `"hello "`), browsers keep trailing
 * regular spaces (char 32) as-is in the text node, but Ctrl+A / selectAll
 * in Chromium and WebKit places the range end *before* those trailing spaces.
 * This means `range.cloneContents()` omits them, so formatting operations
 * (bold, italic, etc.) silently drop any trailing whitespace.
 *
 * By contrast, text typed by the user is stored internally with a non-breaking
 * space (`\u00A0`) which is always included in the selection.
 *
 * This function mutates the range in place to cover those excluded trailing
 * spaces, so downstream formatting can include them.
 *
 * Two browser behaviours are handled:
 *  1. `endContainer` is a text node — the range ends mid-text, so check whether
 *     the remaining characters are all whitespace and extend if so.
 *  2. `endContainer` is an element node — Ctrl+A / selectAll in Chromium and
 *     WebKit places the range end on the element itself with `endOffset` equal
 *     to the child count (i.e. after all children). In this case the last child
 *     text node may still have trailing whitespace that was excluded; walk to
 *     the deepest last text node and extend the range to its end if it ends with
 *     only whitespace after the current offset (or fully consists of whitespace).
 *
 * @param range - The range to extend (mutated in place)
 */
export const extendRangeToTrailingWhitespace = (range: Range): void => {
  const endContainer = range.endContainer;

  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer.textContent ?? '';
    const endOffset = range.endOffset;

    if (endOffset >= text.length) {
      return;
    }

    // Check whether all characters between endOffset and end of text node are whitespace
    const trailingSlice = text.slice(endOffset);

    if (trailingSlice.length > 0 && trailingSlice.trim().length === 0) {
      range.setEnd(endContainer, text.length);
    }

    return;
  }

  // endContainer is an element node (the common case for Ctrl+A on loaded content).
  // Walk to the deepest last text node within it to find any trailing whitespace.
  const lastTextNode = findDeepestLastTextNode(endContainer);

  if (lastTextNode === null) {
    return;
  }

  const text = lastTextNode.textContent ?? '';

  if (text.length === 0) {
    return;
  }

  // Extend range if the text ends with one or more whitespace characters.
  if (/\s+$/.test(text)) {
    range.setEnd(lastTextNode, text.length);
  }
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
