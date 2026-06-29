/**
 * List Keyboard - Handles keyboard interactions for list items.
 *
 * Extracted from ListItem to reduce file size.
 */

import type { API } from '../../../types';

import { setCaretToBlockContent } from './caret-manager';
import { TOOL_NAME } from './constants';
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
export const handleEnter = async (
  context: KeyboardContext,
  depthValidator?: ListDepthValidator
): Promise<void> => {
  const { api, blockId, data, element, getContentElement } = context;

  const selection = window.getSelection();
  if (!selection || !element) return;

  const contentEl = getContentElement();
  if (!contentEl) return;

  const currentContent = contentEl.innerHTML.trim();

  // If current item is empty, handle based on depth
  if (currentContent === '' || currentContent === '<br>') {
    await exitListOrOutdent(context, depthValidator);
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
      ...(data.style === 'checklist' ? { checked: Boolean(data.checked) } : {}),
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
      ...(data.style === 'checklist' ? { checked: Boolean(data.checked) } : {}),
      depth: data.depth,
    },
    currentBlockIndex + 1
  );

  // Update internal state to match the DOM
  data.text = beforeContent;

  // Set caret to the start of the new block's content element
  setCaretToBlockContent(api, newBlock, 'start');
};

/**
 * The id of this list item's structural parent when that parent is itself a
 * list item — i.e. the item is nested via parentId/contentIds (keyboard Tab).
 * Returns null when the item is not structurally nested under another list.
 */
const getStructuralListParentId = (api: API, blockId: string | undefined): string | null => {
  if (blockId === undefined) {
    return null;
  }

  const block = api.blocks.getById(blockId);
  const parentId = block?.parentId ?? null;

  if (parentId === null) {
    return null;
  }

  const parent = api.blocks.getById(parentId);

  return parent !== null && parent.name === TOOL_NAME ? parentId : null;
};

/**
 * Exit list or outdent when pressing Enter on empty item
 */
const exitListOrOutdent = async (
  context: KeyboardContext,
  depthValidator?: ListDepthValidator
): Promise<void> => {
  const { api, blockId, getDepth } = context;

  // Structurally nested (keyboard Tab) items outdent one level by reparenting to
  // the grandparent — keeping nesting in the block tree rather than a flat depth.
  const structuralParentId = getStructuralListParentId(api, blockId);

  if (structuralParentId !== null && blockId !== undefined) {
    const grandparentId = api.blocks.getById(structuralParentId)?.parentId ?? null;

    api.blocks.setBlockParent(blockId, grandparentId);

    const outdentedBlock = api.blocks.getById(blockId);

    if (outdentedBlock !== null) {
      setCaretToBlockContent(api, outdentedBlock);
    }

    return;
  }

  const currentDepth = getDepth();

  // Drag-nested (flat depth) items still outdent via the flat carrier.
  if (currentDepth > 0) {
    await handleOutdent(context, depthValidator);
    return;
  }

  // At root level, convert to paragraph using convert API for proper undo/redo support
  if (blockId === undefined) {
    return;
  }
  const newBlock = await api.blocks.convert(blockId, 'paragraph', { text: '' });
  setCaretToBlockContent(api, newBlock, 'start');
};

/**
 * Handle Backspace key - convert to paragraph or clear content
 */
export const handleBackspace = async(
  context: KeyboardContext,
  event: KeyboardEvent,
  depthValidator?: ListDepthValidator
): Promise<void> => {
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

  // Notion: Backspace at the START of a NESTED list item outdents it one level
  // instead of converting it to a paragraph — mirroring the Enter-on-empty path.
  // Only a top-level item converts to a paragraph.
  const structuralParentId = getStructuralListParentId(api, blockId);

  if (structuralParentId !== null) {
    // Structurally nested (keyboard Tab): reparent to the grandparent, keeping
    // nesting in the block tree rather than a flat depth.
    const grandparentId = api.blocks.getById(structuralParentId)?.parentId ?? null;

    api.blocks.setBlockParent(blockId, grandparentId);

    const outdentedBlock = api.blocks.getById(blockId);

    if (outdentedBlock !== null) {
      setCaretToBlockContent(api, outdentedBlock, 'start');
    }

    return;
  }

  // Drag-nested (flat depth) items still outdent via the flat carrier.
  if (currentDepth > 0) {
    await handleOutdent(context, depthValidator);

    return;
  }

  // At top level, convert to paragraph using convert API for proper undo/redo support.
  const newBlock = await api.blocks.convert(blockId, 'paragraph', { text: currentContent });

  setCaretToBlockContent(api, newBlock, 'start');
};

/**
 * Reduce depth by 1 for all descendant list items following the given block.
 * Stops at non-list blocks or blocks with depth <= the parent's original depth.
 */
const cascadeDepthReduction = async (
  api: API,
  blockId: string | undefined,
  parentOriginalDepth: number,
  depthValidator: ListDepthValidator
): Promise<void> => {
  const startIndex = blockId
    ? api.blocks.getBlockIndex(blockId) ?? api.blocks.getCurrentBlockIndex()
    : api.blocks.getCurrentBlockIndex();
  const blocksCount = api.blocks.getBlocksCount();

  const processDescendant = async (index: number): Promise<void> => {
    if (index >= blocksCount) return;

    const block = api.blocks.getBlockByIndex(index);

    if (!block || block.name !== TOOL_NAME) return;

    const blockDepth = depthValidator.getBlockDepth(block);

    if (blockDepth <= parentOriginalDepth) return;

    await api.blocks.update(block.id, { depth: blockDepth - 1 });
    await processDescendant(index + 1);
  };

  await processDescendant(startIndex + 1);
};

/**
 * Handle Shift+Tab key - outdent the list item and cascade to descendants
 */
export const handleOutdent = async(
  context: KeyboardContext,
  depthValidator?: ListDepthValidator
): Promise<void> => {
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

  // Cascade depth reduction to descendant list items
  if (depthValidator) {
    await cascadeDepthReduction(api, blockId, currentDepth, depthValidator);
  }

  // Restore focus to the updated block after DOM has been updated
  setCaretToBlockContent(api, updatedBlock);
};
