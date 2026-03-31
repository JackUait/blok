/**
 * Toggle Keyboard - Handles keyboard interactions for toggle items.
 *
 * Extracted from ToggleItem to reduce file size.
 */

import type { API } from '../../../types';

import { isCaretAtStartOfInput } from '../../components/utils/caret';

import { TOOL_NAME } from './constants';
import type { ToggleItemData } from './types';

/**
 * Context for toggle keyboard operations
 */
export interface ToggleKeyboardContext {
  api: API;
  blockId: string | undefined;
  data: ToggleItemData;
  element: HTMLElement | null;
  getContentElement: () => HTMLElement | null;
  syncContentFromDOM: () => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Handle Enter key - sync content from DOM and split the block at the caret position.
 *
 * When the toggle is open and the caret is at the end of the content,
 * creates a child paragraph inside the toggle instead of splitting.
 *
 * @param context - The toggle keyboard context
 */
export const handleToggleEnter = async (context: ToggleKeyboardContext): Promise<void> => {
  const { api, blockId, data, getContentElement, syncContentFromDOM, isOpen } = context;

  syncContentFromDOM();

  if (blockId === undefined) {
    return;
  }

  const contentEl = getContentElement();
  const selection = window.getSelection();

  if (!contentEl || !selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const { beforeContent, afterContent } = splitContentAtRange(contentEl, range);

  const currentBlockIndex = api.blocks.getBlockIndex(blockId) ?? api.blocks.getCurrentBlockIndex();

  /**
   * When toggle is open and caret is at the end (no content after caret),
   * create a child paragraph inside the toggle rather than a sibling toggle.
   * insertInsideParent() groups both block creation and parent assignment into
   * a single Yjs undo entry, so one CMD+Z removes the new block completely.
   */
  if (isOpen && afterContent === '') {
    const insertIndex = getInsertAfterLastDescendantIndex(api, blockId, currentBlockIndex);
    const newBlock = api.blocks.insertInsideParent(blockId, insertIndex);

    api.caret.setToBlock(newBlock.id, 'start');

    return;
  }

  api.blocks.splitBlock(
    blockId,
    { text: beforeContent },
    TOOL_NAME,
    { text: afterContent },
    currentBlockIndex + 1
  );

  data.text = beforeContent;
};

/**
 * Handle Backspace key - convert to paragraph when content is empty and caret is at start.
 *
 * When the caret is at the very start of the content element AND the content is empty,
 * converts the toggle to a paragraph block. If the caret is NOT at start, lets the
 * browser handle it (does nothing).
 *
 * @param context - The toggle keyboard context
 * @param event - The keyboard event
 */
export const handleToggleBackspace = async (
  context: ToggleKeyboardContext,
  event: KeyboardEvent
): Promise<void> => {
  const { api, blockId, data, getContentElement, syncContentFromDOM } = context;

  syncContentFromDOM();

  if (blockId === undefined) {
    return;
  }

  const contentEl = getContentElement();

  if (!contentEl) {
    return;
  }

  if (!isCaretAtStartOfInput(contentEl)) {
    return;
  }

  const text = data.text;

  if (text !== '') {
    return;
  }

  event.preventDefault();

  await api.blocks.convert(blockId, 'paragraph', { text });
};

/**
 * Returns the flat-array index at which a new child should be inserted so that
 * it appears as the **last** child of `parentId`. Walks descendants recursively
 * so nested toggles are accounted for.
 *
 * @param api - Blocks API
 * @param parentId - ID of the parent block
 * @param parentIndex - Flat-array index of the parent block
 * @returns The insertion index (one past the last descendant)
 */
export const getInsertAfterLastDescendantIndex = (
  api: Pick<API, 'blocks'>,
  parentId: string,
  parentIndex: number
): number => {
  const children = api.blocks.getChildren(parentId);

  if (children.length === 0) {
    return parentIndex + 1;
  }

  const lastChild = children[children.length - 1];
  const lastChildIndex = api.blocks.getBlockIndex(lastChild.id) ?? parentIndex;

  return getInsertAfterLastDescendantIndex(api, lastChild.id, lastChildIndex);
};

/**
 * Split content element's HTML at the given range position.
 *
 * @param contentEl - The contenteditable element containing text
 * @param range - The current selection range
 * @returns Object with before/after HTML content
 */
export const splitContentAtRange = (
  contentEl: HTMLElement,
  range: Range
): { beforeContent: string; afterContent: string } => {
  if (!contentEl.lastChild) {
    return { beforeContent: '', afterContent: '' };
  }

  const beforeRange = document.createRange();
  beforeRange.setStart(contentEl, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEndAfter(contentEl.lastChild);

  const beforeDiv = document.createElement('div');
  beforeDiv.appendChild(beforeRange.cloneContents());

  const afterDiv = document.createElement('div');
  afterDiv.appendChild(afterRange.cloneContents());

  return {
    beforeContent: beforeDiv.innerHTML,
    afterContent: afterDiv.innerHTML,
  };
};
