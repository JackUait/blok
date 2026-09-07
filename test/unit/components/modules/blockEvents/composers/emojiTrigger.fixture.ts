import { vi } from 'vitest';
import type { Block } from '../../../../../../src/components/block';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Builds a minimal Block-shaped object with a single text node, matching the
 * markdownShortcuts.test.ts fixture shape. `toolOverrides` lets a test flip
 * `isDefault`/`isLineBreaksEnabled` to exercise the text-like-block gate.
 */
export const createBlock = (text: string, toolOverrides: Record<string, unknown> = {}): Block => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = text;

  const holder = document.createElement('div');

  holder.appendChild(input);

  return {
    id: 'test-block',
    name: 'paragraph',
    holder,
    currentInput: input,
    inputs: [input],
    isEmpty: text.length === 0,
    tool: { isDefault: true, isLineBreaksEnabled: false, name: 'paragraph', ...toolOverrides },
    // A composer that mutates the DOM directly (not via a Tool re-render) must
    // call this to flush the change to Yjs — see markdownShortcuts' same call.
    dispatchChange: vi.fn(),
  } as unknown as Block;
};

/**
 * Minimal BlokModules stub for EmojiTrigger. Includes I18n (`t`/`getLocale`)
 * because the composer resolves the popover's search/nothingFound messages
 * and warms the dataset via the current locale — markdownShortcuts.test.ts's
 * fixture omits I18n only because that composer never reads it.
 */
export const createBlokModules = (block: Block): BlokModules => ({
  BlockManager: {
    currentBlock: block,
    setCurrentBlockByChildNode: vi.fn(),
  } as unknown as BlokModules['BlockManager'],
  YjsManager: { stopCapturing: vi.fn() } as unknown as BlokModules['YjsManager'],
  I18n: {
    t: (key: string): string => key,
    getLocale: (): string => 'en',
  } as unknown as BlokModules['I18n'],
} as unknown as BlokModules);

/** Put the caret at `offset` inside the block's single text node. */
export const setCaret = (block: Block, offset: number): void => {
  const input = block.currentInput;
  const textNode = input?.firstChild;

  if (textNode === null || textNode === undefined) {
    throw new Error('block has no text node');
  }

  const range = document.createRange();

  range.setStart(textNode, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};
