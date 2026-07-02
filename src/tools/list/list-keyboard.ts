/**
 * List Keyboard - Handles keyboard interactions for list items.
 *
 * Extracted from ListItem to reduce file size.
 */

import type { API } from '../../../types';

import { setCaretToBlockContent, setCaretToBlockContentOffset, getCaretOffsetWithin } from './caret-manager';
import { TOOL_NAME } from './constants';
import {
  splitContentAtCursor,
  isAtStart,
  isEntireContentSelected,
} from './content-operations';
import { applyCheckboxState } from './dom-builder';
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
      // Notion parity (m-9): a new to-do is always UNCHECKED, even when split
      // from a checked item — only text/depth carry over.
      ...(data.style === 'checklist' ? { checked: false } : {}),
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
      // Notion parity (m-9): a new to-do is always UNCHECKED, even when split
      // from a checked item — only text/depth carry over.
      ...(data.style === 'checklist' ? { checked: false } : {}),
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
 * Handle Backspace key - outdent a nested item, or convert to paragraph
 */
export const handleBackspace = async(
  context: KeyboardContext,
  event: KeyboardEvent,
  depthValidator?: ListDepthValidator
): Promise<void> => {
  const { blockId, data, element, getContentElement, syncContentFromDOM, getDepth, api } = context;

  const selection = window.getSelection();
  if (!selection || !element) return;

  const range = selection.getRangeAt(0);
  const contentEl = getContentElement();
  if (!contentEl) return;

  // Sync current content from DOM before any deletion happens
  syncContentFromDOM();

  const currentContent = data.text;

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

  // A non-collapsed PARTIAL selection (e.g. "hello" out of "hello world",
  // anchored at offset 0) must delete natively — never convert. The isAtStart
  // check below is true for any selection anchored at 0, so without this guard
  // the convert-to-paragraph path fired on the FULL text and swallowed the
  // delete. Only a COLLAPSED caret at offset 0 converts.
  if (!selection.isCollapsed) return;

  // Only handle at start of content for non-selection cases
  if (!isAtStart(contentEl, range)) return;

  // Notion parity (m-10): a modifier-held Backspace is a word/line delete, not a
  // list operation. At offset 0 native word/line delete is a no-op, so the marker
  // and content stay intact. preventDefault also stops the shared block handler
  // from merging this item into the previous block.
  if (event.metaKey || event.ctrlKey || event.altKey) {
    event.preventDefault();

    return;
  }

  event.preventDefault();

  if (blockId === undefined) {
    return;
  }

  // Notion parity (BUG #11): Backspace at the START of a NESTED list item OUTDENTS
  // it one level while keeping its list type — mirroring the empty-item Enter path
  // (exitListOrOutdent). A structurally nested (keyboard-Tab) item reparents to its
  // grandparent; a flat drag-nested item drops one flat depth. Only a truly
  // top-level item (no structural parent AND depth 0) converts to a paragraph.
  const structuralParentId = getStructuralListParentId(api, blockId);

  if (structuralParentId !== null) {
    const grandparentId = api.blocks.getById(structuralParentId)?.parentId ?? null;

    api.blocks.setBlockParent(blockId, grandparentId);

    const outdentedBlock = api.blocks.getById(blockId);

    if (outdentedBlock !== null) {
      setCaretToBlockContent(api, outdentedBlock, 'start');
    }

    return;
  }

  if (getDepth() > 0) {
    await handleOutdent(context, depthValidator);

    return;
  }

  // Top-level item: convert to a plain PARAGRAPH in place, preserving content.
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
 * Increase depth by 1 for all descendant list items following the given block.
 * Symmetric to {@link cascadeDepthReduction}: stops at non-list blocks or blocks
 * whose depth is <= the parent's original depth (siblings, not descendants). Used
 * so a flat-carrier indent carries its nested descendants' depth/glyph along.
 */
const cascadeDepthIncrease = async (
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

    await api.blocks.update(block.id, { depth: blockDepth + 1 });
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
  const { api, blockId, data, syncContentFromDOM, getDepth, getContentElement } = context;

  const currentDepth = getDepth();

  // Can't outdent if already at root level
  if (currentDepth === 0) return;

  // Snapshot the caret offset BEFORE the re-render so it can be restored — the
  // flat path re-renders via api.blocks.update, and the default 'end' caret would
  // otherwise jump the caret to the end of the item.
  const caretOffset = getCaretOffsetWithin(getContentElement());

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

  // Restore focus + caret to the updated block after DOM has been updated
  if (caretOffset !== null) {
    setCaretToBlockContentOffset(api, updatedBlock, caretOffset);
  } else {
    setCaretToBlockContent(api, updatedBlock);
  }
};

/**
 * Toggle a checklist item's `checked` state IN PLACE — Notion's Cmd/Ctrl+Enter on
 * a to-do. Flips `data.checked`, syncs the checkbox input and the strike-through
 * styling, and persists via the blocks API. No split / new item is created.
 *
 * @param context - keyboard context for the current list item
 * @returns true when the item is a checklist (and was toggled); false otherwise,
 *   so the caller can fall back to the normal Enter behaviour.
 */
export const toggleChecklistChecked = async (
  context: KeyboardContext
): Promise<boolean> => {
  const { api, blockId, data, element, getContentElement } = context;

  if (data.style !== 'checklist') {
    return false;
  }

  const newChecked = !data.checked;
  data.checked = newChecked;

  const checkbox = element?.querySelector('input[type="checkbox"]');
  if (checkbox instanceof HTMLInputElement) {
    applyCheckboxState(checkbox, newChecked);
  }

  const contentEl = getContentElement();
  if (contentEl) {
    contentEl.classList.toggle('line-through', newChecked);
    contentEl.classList.toggle('opacity-60', newChecked);
  }

  if (blockId !== undefined) {
    await api.blocks.update(blockId, { ...data, checked: newChecked });
  }

  return true;
};

/**
 * Handle Tab — indent a FLAT-carrier list item one level via `data.depth`.
 * Symmetric to {@link handleOutdent}. Used for authored / drag-nested items that
 * have no structural list parent for the shared module handler to nest under:
 * the first item (no preceding sibling) would otherwise no-op, and others would
 * derive the wrong depth from the parentId chain. Caps at the depth-validator's
 * max-allowed depth (first-in-group = 1, otherwise previous item depth + 1).
 * @param context - keyboard context for the current list item
 * @param depthValidator - validator providing the per-index max-allowed depth
 */
export const handleIndent = async(
  context: KeyboardContext,
  depthValidator: ListDepthValidator
): Promise<void> => {
  const { api, blockId, data, syncContentFromDOM, getDepth, getContentElement } = context;

  const currentBlockIndex = blockId !== undefined
    ? api.blocks.getBlockIndex(blockId) ?? api.blocks.getCurrentBlockIndex()
    : api.blocks.getCurrentBlockIndex();
  const currentDepth = getDepth();

  /**
   * Notion parity: a list item can only be indented when there is a preceding
   * LIST sibling for it to nest under — the same precondition the structural Tab
   * path enforces (getPrecedingSibling). A FIRST-in-group item (the first block,
   * or a list item whose previous block is not a list) has nothing to nest under,
   * so Tab is a strict no-op.
   *
   * Without this guard the flat path derives its cap from getMaxAllowedDepth,
   * which returns 1 for first-in-group items (a deliberate rule for DRAG via
   * resolveTargetDepth, but wrong for keyboard Tab), so the first bullet of every
   * list could be wrongly indented to an orphaned depth 1.
   */
  const previousBlock = currentBlockIndex > 0
    ? api.blocks.getBlockByIndex(currentBlockIndex - 1)
    : undefined;

  if (previousBlock === undefined || previousBlock.name !== TOOL_NAME) {
    return;
  }

  const maxAllowedDepth = depthValidator.getMaxAllowedDepth(currentBlockIndex);

  // Already at the deepest allowed level — nothing to do.
  if (currentDepth >= maxAllowedDepth) {
    return;
  }

  // Snapshot the caret offset BEFORE the re-render so it can be restored (the
  // default 'end' caret would otherwise jump the caret to the end of the item).
  const caretOffset = getCaretOffsetWithin(getContentElement());

  // Sync current content before updating
  syncContentFromDOM();

  const newDepth = currentDepth + 1;
  data.depth = newDepth;

  const updatedBlock = await api.blocks.update(blockId || '', {
    ...data,
    depth: newDepth,
  });

  // Cascade the depth INCREASE to descendant list items so their depth/glyph
  // stays in sync — symmetric with handleOutdent's cascadeDepthReduction.
  await cascadeDepthIncrease(api, blockId, currentDepth, depthValidator);

  // Restore focus + caret to the updated block after DOM has been updated
  if (caretOffset !== null) {
    setCaretToBlockContentOffset(api, updatedBlock, caretOffset);
  } else {
    setCaretToBlockContent(api, updatedBlock);
  }
};
