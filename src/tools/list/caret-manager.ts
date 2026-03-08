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
