/**
 * Caret Manager - Handles caret positioning for list items.
 *
 * Extracted from ListItem for better organization.
 */

import type { API } from '../../../types';

/**
 * Sets caret to the content element of a block.
 * Operates synchronously so subsequent keystrokes land in the correct block
 * (deferring via requestAnimationFrame causes a race where characters typed
 * between the block split and the next animation frame go to the wrong element).
 * Falls back to requestAnimationFrame only when the content element is not yet
 * available (e.g. async rendering).
 *
 * @param api - The API instance
 * @param block - BlockAPI to set caret to
 * @param position - 'start' or 'end' position (defaults to 'end')
 */
export const setCaretToBlockContent = (
  api: API,
  block: ReturnType<API['blocks']['insert']>,
  position: 'start' | 'end' = 'end'
): void => {
  const applyFocus = (): void => {
    const holder = block.holder;
    if (!holder) return;

    // Find the contenteditable element within the new block
    const contentEl = holder.querySelector('[contenteditable="true"]');
    if (!(contentEl instanceof HTMLElement)) {
      // Fallback to setToBlock if no content element found
      api.caret.setToBlock(block, position);
      api.caret.updateLastCaretAfterPosition();

      return;
    }

    // Focus the content element and set caret position
    contentEl.focus();

    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();

    if (position === 'start') {
      range.setStart(contentEl, 0);
      range.collapse(true);
    } else {
      // Set to end of content
      range.selectNodeContents(contentEl);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);

    // Update the "after" caret position for undo/redo.
    // Yjs stack-item-added fires inside splitBlock() before control returns to
    // handleEnter, so the snapshot captured at that point is stale (pointing to
    // the first block). We must update it after focus has moved to the new block.
    api.caret.updateLastCaretAfterPosition();
  };

  // Try synchronous focus first — the block is already in the DOM after insert()
  const holder = block.holder;
  const contentEl = holder?.querySelector('[contenteditable="true"]');

  if (contentEl instanceof HTMLElement) {
    applyFocus();
  } else {
    // Content element not available yet — fall back to next frame
    requestAnimationFrame(() => applyFocus());
  }
}

/**
 * Reads the caret's character offset within a content element from the live
 * selection, or null when there is no collapsed/anchored caret inside it.
 * Used to snapshot the caret before a re-render so it can be restored.
 *
 * @param contentEl - the content (contenteditable) element to measure against
 * @returns the character offset of the caret, or null when unavailable
 */
export const getCaretOffsetWithin = (contentEl: HTMLElement | null): number | null => {
  if (!contentEl) return null;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!contentEl.contains(range.endContainer)) return null;

  const preRange = document.createRange();
  preRange.selectNodeContents(contentEl);
  preRange.setEnd(range.endContainer, range.endOffset);

  return preRange.toString().length;
};

/**
 * Collects an element's descendant text nodes in document order.
 */
const collectTextNodes = (node: Node): Text[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    return [node as Text];
  }

  return Array.from(node.childNodes).flatMap(collectTextNodes);
};

/**
 * Resolves a character offset within an element to a concrete text node + node
 * offset, walking its text nodes in document order. Clamps to the end of the
 * last text node when the offset exceeds the content length.
 */
const resolveOffsetToNode = (
  root: HTMLElement,
  offset: number
): { node: Node; nodeOffset: number } => {
  const textNodes = collectTextNodes(root);

  const walk = (index: number, remaining: number): { node: Node; nodeOffset: number } => {
    if (index >= textNodes.length) {
      const lastText = textNodes[textNodes.length - 1];

      return lastText !== undefined
        ? { node: lastText, nodeOffset: lastText.textContent?.length ?? 0 }
        : { node: root, nodeOffset: 0 };
    }

    const current = textNodes[index];
    const length = current.textContent?.length ?? 0;

    if (remaining <= length) {
      return { node: current, nodeOffset: remaining };
    }

    return walk(index + 1, remaining - length);
  };

  return walk(0, offset);
};

/**
 * Sets the caret to a specific character OFFSET within a block's content
 * element. Mirrors {@link setCaretToBlockContent} but restores a MID-text caret
 * so a re-render (e.g. flat-carrier indent/outdent) does not jump the caret to
 * the end. Falls back to end-positioning when no content element is available.
 *
 * @param api - The API instance
 * @param block - BlockAPI whose content element receives the caret
 * @param offset - character offset to place the collapsed caret at
 */
export const setCaretToBlockContentOffset = (
  api: API,
  block: ReturnType<API['blocks']['insert']>,
  offset: number
): void => {
  const applyFocus = (): void => {
    const holder = block.holder;
    if (!holder) return;

    const contentEl = holder.querySelector('[contenteditable="true"]');
    if (!(contentEl instanceof HTMLElement)) {
      api.caret.setToBlock(block, 'end');
      api.caret.updateLastCaretAfterPosition();

      return;
    }

    contentEl.focus();

    const selection = window.getSelection();
    if (!selection) return;

    const { node, nodeOffset } = resolveOffsetToNode(contentEl, offset);
    const range = document.createRange();
    range.setStart(node, nodeOffset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    api.caret.updateLastCaretAfterPosition();
  };

  const holder = block.holder;
  const contentEl = holder?.querySelector('[contenteditable="true"]');

  if (contentEl instanceof HTMLElement) {
    applyFocus();
  } else {
    requestAnimationFrame(() => applyFocus());
  }
}
