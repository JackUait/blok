import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import * as caretUtils from '../../../../../../src/components/utils/caret/index';
import { SelectionUtils } from '../../../../../../src/components/selection';

const createBackspaceEvent = (): KeyboardEvent => {
  let defaultPrevented = false;

  return {
    key: 'Backspace',
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: vi.fn(() => {
      defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
};

const createBlock = (text: string, contentIds: string[] = []): Block => {
  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.textContent = text;
  const holder = document.createElement('div');

  holder.appendChild(input);

  return {
    id: 'first',
    name: 'paragraph',
    parentId: null,
    contentIds,
    holder,
    currentInput: input,
    inputs: [input],
    firstInput: input,
    lastInput: input,
    tool: { isDefault: true, name: 'paragraph' },
    isEmpty: text === '',
    mergeable: true,
  } as unknown as Block;
};

const createModules = (block: Block, titleEnabled = true): BlokModules => ({
  BlockManager: {
    currentBlock: block,
    previousBlock: null,
    blocks: [block],
    removeBlock: vi.fn(() => Promise.resolve()),
  },
  Caret: {
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
    setToBlock: vi.fn(),
    navigatePrevious: vi.fn(),
  },
  Toolbar: { close: vi.fn() },
  PageTitle: { isEnabled: titleEnabled, appendAndFocus: vi.fn(), focus: vi.fn() },
}) as unknown as BlokModules;

describe('KeyboardNavigation — Backspace at the first block with a page title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);
    vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Backspace at the start of the first block joins its text into the title', () => {
    const block = createBlock('hello');
    const blok = createModules(block);

    new KeyboardNavigation(blok).handleBackspace(createBackspaceEvent());

    expect(blok.PageTitle.appendAndFocus).toHaveBeenCalledWith('hello');
    expect(blok.BlockManager.removeBlock).toHaveBeenCalledWith(block);
  });

  it('a first block with children only moves focus to the title', () => {
    const block = createBlock('hello', ['child']);
    const blok = createModules(block);

    new KeyboardNavigation(blok).handleBackspace(createBackspaceEvent());

    expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
    expect(blok.PageTitle.focus).toHaveBeenCalledWith('end');
  });

  it('a first block with more than one input only moves focus to the title', () => {
    const block = createBlock('hello');
    const second = document.createElement('div');

    second.setAttribute('contenteditable', 'true');
    block.holder.appendChild(second);
    const blok = createModules(block);

    new KeyboardNavigation(blok).handleBackspace(createBackspaceEvent());

    expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
    expect(blok.PageTitle.focus).toHaveBeenCalledWith('end');
  });

  it('without a title, Backspace at the first block still does nothing', () => {
    const block = createBlock('hello');
    const blok = createModules(block, false);

    new KeyboardNavigation(blok).handleBackspace(createBackspaceEvent());

    expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
    expect(blok.PageTitle.appendAndFocus).not.toHaveBeenCalled();
    expect(blok.PageTitle.focus).not.toHaveBeenCalled();
  });
});
