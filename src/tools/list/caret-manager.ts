/**
 * Caret Manager - Handles caret positioning for list items.
 *
 * Extracted from ListItem for better organization.
 */

import type { API } from '../../../types';

/**
 * Sets caret to the content element of a block after ensuring DOM is ready.
 * Uses requestAnimationFrame to wait for the browser to process DOM updates.
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
  // Use requestAnimationFrame to ensure DOM has been updated
  requestAnimationFrame(() => {
    const holder = block.holder;
    if (!holder) return;

    // Find the contenteditable element within the new block
    const contentEl = holder.querySelector('[contenteditable="true"]');
    if (!(contentEl instanceof HTMLElement)) {
      // Fallback to setToBlock if no content element found
      api.caret.setToBlock(block, position);
      // Update the caret "after" position for undo/redo since we're in requestAnimationFrame
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

    // Update the caret "after" position for undo/redo since we moved the caret
    // asynchronously via requestAnimationFrame after the Yjs transaction committed
    api.caret.updateLastCaretAfterPosition();
  });
}
