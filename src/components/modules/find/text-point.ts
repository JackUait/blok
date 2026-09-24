/**
 * A position in the editor's text that survives a re-render.
 *
 * A live Range collapses when a tool swaps the text nodes it points into (the
 * code block re-highlights by replacing its innerHTML). A text offset inside
 * the nearest editable host or block holder does not.
 */

const HOST_SELECTOR = '[contenteditable], [data-blok-element]';

export interface TextPoint {
  host: Element;
  offset: number;
}

const hostOf = (node: Node, root: Element): Element =>
  (node instanceof Element ? node : node.parentElement)?.closest(HOST_SELECTOR) ?? root;

const textOffset = (host: Element, node: Node, offset: number): number => {
  const range = document.createRange();

  range.setStart(host, 0);
  range.setEnd(node, offset);

  return range.toString().length;
};

/**
 * The point where `range` starts.
 * @param range - a match or a caret
 * @param root - the element searched, used when no host encloses the range
 */
export const pointOf = (range: Range, root: Element): TextPoint => {
  const host = hostOf(range.startContainer, root);

  return { host, offset: textOffset(host, range.startContainer, range.startOffset) };
};

/**
 * Whether `range` starts at or after `point` in reading order.
 * @param range - a match
 * @param point - the anchor
 * @param root - the element searched
 */
export const startsAtOrAfter = (range: Range, point: TextPoint, root: Element): boolean => {
  const host = hostOf(range.startContainer, root);

  // The anchor's block is gone: start over from the top.
  if (!point.host.isConnected) {
    return true;
  }

  if (host === point.host) {
    return textOffset(host, range.startContainer, range.startOffset) >= point.offset;
  }

  return (point.host.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
};
