/**
 * Toggle Keyboard - Handles keyboard interactions for toggle items.
 *
 * Extracted from ToggleItem to reduce file size.
 */

import type { API } from '../../../types';

import { isCaretAtStartOfInput } from '../../components/utils/caret';
import { announceToolConversion } from '../../components/utils/conversion-announcement';
import { runConvert } from '../../components/utils/convert-refusal';

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

  if (insertEmptyBlockAboveOnEnterAtStart(api, currentBlockIndex, beforeContent, afterContent)) {
    return;
  }

  /**
   * Open toggle, caret at the end: the new block becomes the FIRST child, above
   * the others (Notion U134). insertInsideParent() is one undo entry.
   */
  if (isOpen && afterContent === '') {
    const newBlock = api.blocks.insertInsideParent(blockId, currentBlockIndex + 1);

    api.caret.setToBlock(newBlock.id, 'start');

    return;
  }

  const newBlock = api.blocks.splitBlock(
    blockId,
    { text: beforeContent },
    TOOL_NAME,
    { text: afterContent },
    currentBlockIndex + 1
  );

  data.text = beforeContent;

  // splitBlock rewrites this title's HTML and does not focus the new block,
  // so without this the caret falls to the start of the old title.
  api.caret.setToBlock(newBlock.id, 'start');
};

/**
 * Enter at the start of a title that has text adds an empty block above the
 * toggle, at its level, and leaves the caret in the title (Notion). A split
 * here would put the new block between the toggle and its children.
 * @param api - Blok API
 * @param toggleIndex - flat index of the toggle
 * @param beforeContent - title HTML before the caret
 * @param afterContent - title HTML after the caret
 * @returns true when it handled the key
 */
export const insertEmptyBlockAboveOnEnterAtStart = (
  api: Pick<API, 'blocks'>,
  toggleIndex: number,
  beforeContent: string,
  afterContent: string
): boolean => {
  if (beforeContent !== '' || afterContent === '') {
    return false;
  }

  api.blocks.insert(undefined, undefined, undefined, toggleIndex, false);

  return true;
};

/**
 * Handle Backspace key - at the start of the title, convert the toggle to a
 * paragraph in place. Its text and children stay; nothing merges into the
 * block above (Notion U137). If the caret is NOT at start, lets the browser
 * handle it (does nothing).
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

  event.preventDefault();

  const newBlock = await runConvert(api, () => api.blocks.convert(blockId, 'paragraph', { text }));

  if (newBlock !== null) {
    // convert() re-renders the block and drops the caret; Notion keeps it at 0.
    api.caret.setToBlock(newBlock.id, 'start');
    announceToolConversion(api, 'paragraph', { text });
  }
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
