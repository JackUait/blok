/**
 * List Keyboard - Handles keyboard interactions for list items.
 *
 * Extracted from ListItem to reduce file size.
 */

import type { API } from '../../../types';

import { setCaretToBlockContent } from './caret-manager';
import { INDENT_PER_LEVEL, TOOL_NAME } from './constants';
import {
  splitContentAtCursor,
  isAtStart,
  isEntireContentSelected,
} from './content-operations';
import type { ListDepthValidator } from './depth-validator';
import type { ListItemData } from './types';

/**
 * Context for keyboard operations
 */
export interface KeyboardContext {
  api: API;
  blockId: string | undefined;
  data: ListItemData;
  element: HTMLElement | null;
  getContentElement: () => HTMLElement | null;
  syncContentFromDOM: () => void;
  getDepth: () => number;
}

/**
 * Handle Enter key - split content or exit list
 */
export async function handleEnter(context: KeyboardContext): Promise<void> {
  const { api, blockId, data, element, getContentElement } = context;

  const selection = window.getSelection();
  if (!selection || !element) return;

  const contentEl = getContentElement();
  if (!contentEl) return;

  const currentContent = contentEl.innerHTML.trim();

  // If current item is empty, handle based on depth
  if (currentContent === '' || currentContent === '<br>') {
    await exitListOrOutdent(context);
    return;
  }

  // Split content at cursor position
  const range = selection.getRangeAt(0);
  const { beforeContent, afterContent } = splitContentAtCursor(contentEl, range);

  // Get the current block's index using blockId for reliability
  const currentBlockIndex = blockId
    ? api.blocks.getBlockIndex(blockId) ?? api.blocks.getCurrentBlockIndex()
    : api.blocks.getCurrentBlockIndex();

  // Guard: blockId is always provided by Blok when instantiating tools
  if (!blockId) {
    contentEl.innerHTML = beforeContent;
    data.text = beforeContent;

    const newBlock = api.blocks.insert(TOOL_NAME, {
      text: afterContent,
      style: data.style,
      checked: false,
      depth: data.depth,
    }, undefined, currentBlockIndex + 1, true);

    setCaretToBlockContent(api, newBlock, 'start');
    return;
  }

  // Use atomic splitBlock API to ensure undo works correctly
  const newBlock = api.blocks.splitBlock(
    blockId,
    { text: beforeContent },
    TOOL_NAME,
    {
      text: afterContent,
      style: data.style,
      checked: false,
      depth: data.depth,
    },
    currentBlockIndex + 1
  );

  // Update internal state to match the DOM
  data.text = beforeContent;

  // Set caret to the start of the new block's content element
  setCaretToBlockContent(api, newBlock, 'start');
}

/**
 * Exit list or outdent when pressing Enter on empty item
 */
async function exitListOrOutdent(context: KeyboardContext): Promise<void> {
  const { api, blockId, getDepth } = context;
  const currentDepth = getDepth();

  // If nested, outdent instead of exiting
  if (currentDepth > 0) {
    await handleOutdent(context);
    return;
  }

  // At root level, convert to paragraph using convert API for proper undo/redo support
  if (blockId === undefined) {
    return;
  }
  const newBlock = await api.blocks.convert(blockId, 'paragraph', { text: '' });
  setCaretToBlockContent(api, newBlock, 'start');
}

/**
 * Handle Backspace key - convert to paragraph or clear content
 */
export async function handleBackspace(
  context: KeyboardContext,
  event: KeyboardEvent
): Promise<void> {
  const { api, blockId, data, element, getContentElement, getDepth, syncContentFromDOM } = context;

  const selection = window.getSelection();
  if (!selection || !element) return;

  const range = selection.getRangeAt(0);
  const contentEl = getContentElement();
  if (!contentEl) return;

  // Sync current content from DOM before any deletion happens
  syncContentFromDOM();

  const currentContent = data.text;
  const currentDepth = getDepth();

  // Check if entire content is selected
  const entireContentSelected = isEntireContentSelected(contentEl, range);

  // Handle case when entire content is selected and deleted
  if (entireContentSelected && !selection.isCollapsed) {
    event.preventDefault();

    contentEl.innerHTML = '';
    data.text = '';

    const newRange = document.createRange();
    newRange.setStart(contentEl, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    return;
  }

  // Only handle at start of content for non-selection cases
  if (!isAtStart(contentEl, range)) return;

  event.preventDefault();

  if (blockId === undefined) {
    return;
  }

  // Convert to paragraph using convert API for proper undo/redo support
  const newBlock = await api.blocks.convert(blockId, 'paragraph', { text: currentContent });

  // Apply indentation to the new paragraph if the list item was nested
  if (currentDepth > 0) {
    requestAnimationFrame(() => {
      const holder = newBlock.holder;
      if (holder) {
        holder.style.marginLeft = `${currentDepth * INDENT_PER_LEVEL}px`;
        holder.setAttribute('data-blok-depth', String(currentDepth));
      }
    });
  }

  setCaretToBlockContent(api, newBlock, 'start');
}

/**
 * Handle Tab key - indent the list item
 */
export async function handleIndent(
  context: KeyboardContext,
  depthValidator: ListDepthValidator
): Promise<void> {
  const { api, blockId, data, syncContentFromDOM, getDepth } = context;

  const currentBlockIndex = api.blocks.getCurrentBlockIndex();
  if (currentBlockIndex === 0) return;

  const previousBlock = api.blocks.getBlockByIndex(currentBlockIndex - 1);
  if (!previousBlock || previousBlock.name !== TOOL_NAME) return;

  const currentDepth = getDepth();
  const previousBlockDepth = depthValidator.getBlockDepth(previousBlock);

  // Can only indent to at most one level deeper than the previous item
  if (currentDepth > previousBlockDepth) return;

  // Sync current content before updating
  syncContentFromDOM();

  // Increase depth by 1
  const newDepth = currentDepth + 1;
  data.depth = newDepth;

  // Update the block data and re-render
  const updatedBlock = await api.blocks.update(blockId || '', {
    ...data,
    depth: newDepth,
  });

  // Restore focus to the updated block after DOM has been updated
  setCaretToBlockContent(api, updatedBlock);
}

/**
 * Handle Shift+Tab key - outdent the list item
 */
export async function handleOutdent(context: KeyboardContext): Promise<void> {
  const { api, blockId, data, syncContentFromDOM, getDepth } = context;

  const currentDepth = getDepth();

  // Can't outdent if already at root level
  if (currentDepth === 0) return;

  // Sync current content before updating
  syncContentFromDOM();

  // Decrease depth by 1
  const newDepth = currentDepth - 1;
  data.depth = newDepth;

  // Update the block data and re-render
  const updatedBlock = await api.blocks.update(blockId || '', {
    ...data,
    depth: newDepth,
  });

  // Restore focus to the updated block after DOM has been updated
  setCaretToBlockContent(api, updatedBlock);
}
