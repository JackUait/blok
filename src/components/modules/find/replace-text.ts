/**
 * Replaces the text a Range covers by editing text nodes in place.
 *
 * Text-node edits are what typing does, so the block's own MutationObserver path
 * saves the change and inline marks survive: the replacement takes the marks of
 * the text where the match starts.
 */

const EDITABLE_HOST = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

/**
 * The editable host both ends of `range` sit in, or null when the range is not
 * inside one editable host (read-only content, or a range across two hosts).
 * @param range - a find match
 */
export const editableHostOf = (range: Range): HTMLElement | null => {
  const host = (node: Node): HTMLElement | null =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(EDITABLE_HOST) ?? null;
  const start = host(range.startContainer);

  return start !== null && start === host(range.endContainer) ? start : null;
};

/**
 * Replace the text under `range` with `replacement`.
 * @param range - a match whose start is inside a text node
 * @param replacement - the new text
 * @returns a collapsed range just after the inserted text
 */
export const replaceRangeText = (range: Range, replacement: string): Range => {
  const start = range.startContainer;
  const offset = range.startOffset;

  // deleteContents keeps a partially selected start text node, so the
  // replacement can go into it and inherit its marks.
  range.deleteContents();

  const after = document.createRange();

  if (start instanceof Text) {
    start.insertData(offset, replacement);
    after.setStart(start, offset + replacement.length);
  } else {
    const text = document.createTextNode(replacement);

    range.insertNode(text);
    after.setStartAfter(text);
  }
  after.collapse(true);

  return after;
};
