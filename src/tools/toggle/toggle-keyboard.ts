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
 * @param context - The toggle keyboard context
 */
export const handleToggleEnter = async (context: ToggleKeyboardContext): Promise<void> => {
  const { api, blockId, data, getContentElement, syncContentFromDOM } = context;

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
  const { api, blockId, data, getContentElement } = context;

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
 * Split content element's HTML at the given range position.
 *
 * @param contentEl - The contenteditable element containing text
 * @param range - The current selection range
 * @returns Object with before/after HTML content
 */
const splitContentAtRange = (
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
