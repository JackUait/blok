/**
 * Toggle Keyboard - Handles keyboard interactions for toggle items.
 *
 * Extracted from ToggleItem to reduce file size.
 */

import type { API } from '../../../types';

import { isCaretAtStartOfInput } from '../../components/utils/caret';

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
  const { api, blockId, syncContentFromDOM } = context;

  syncContentFromDOM();

  if (blockId === undefined) {
    return;
  }

  api.blocks.splitBlock(blockId);
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
