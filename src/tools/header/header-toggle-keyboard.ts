/**
 * Keyboard handlers for toggle headings.
 *
 * Mirrors the toggle list keyboard behaviour (toggle-keyboard.ts) but operates
 * on header blocks: splits produce new toggle headings at the same level, and
 * Backspace on an empty heading removes the toggle state rather than converting
 * to a paragraph.
 */

import type { API } from '../../../types';

import { isCaretAtStartOfInput } from '../../components/utils/caret';
import { splitContentAtRange } from '../toggle/toggle-keyboard';

export interface HeaderToggleKeyboardContext {
  api: API;
  blockId: string | undefined;
  /** Current innerHTML of the heading element */
  getText: () => string;
  getContentElement: () => HTMLElement | null;
  syncContentFromDOM: () => void;
  isOpen: boolean;
  currentLevel: number;
}

/**
 * Handle Enter in a toggle heading.
 *
 * - Open + caret at end → create a child paragraph inside the toggle.
 * - Otherwise (closed, or caret mid-text) → split into two toggle headings at
 *   the same level.
 */
export const handleHeaderToggleEnter = async (
  context: HeaderToggleKeyboardContext
): Promise<void> => {
  const { api, blockId, getContentElement, syncContentFromDOM, isOpen, currentLevel } = context;

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

  if (isOpen && afterContent === '') {
    // Caret at end of an open toggle heading → insert child paragraph
    const newBlock = api.blocks.insert('paragraph', { text: '' }, {}, currentBlockIndex + 1, true);

    api.blocks.setBlockParent(newBlock.id, blockId);
    api.caret.setToBlock(newBlock.id, 'start');

    return;
  }

  // Split into two toggle headings at the same level
  api.blocks.splitBlock(
    blockId,
    { text: beforeContent, level: currentLevel, isToggleable: true },
    'header',
    { text: afterContent, level: currentLevel, isToggleable: true },
    currentBlockIndex + 1
  );
};

/**
 * Handle Backspace in a toggle heading.
 *
 * When the heading is empty and the caret is at the very start, removes the
 * toggle state (converts to a regular heading at the same level) instead of
 * letting the editor merge it with the block above.
 */
export const handleHeaderToggleBackspace = async (
  context: HeaderToggleKeyboardContext,
  event: KeyboardEvent
): Promise<void> => {
  const { api, blockId, getText, getContentElement, syncContentFromDOM, currentLevel } = context;

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

  const text = getText();

  if (text !== '') {
    return;
  }

  event.preventDefault();

  await api.blocks.convert(blockId, 'header', { text, level: currentLevel });
};
