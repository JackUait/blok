import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import { keyCodes } from '../../../../../../src/components/utils';
import * as caretUtils from '../../../../../../src/components/utils/caret';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  return {
    keyCode: options.keyCode ?? 0,
    key: options.key ?? '',
    code: options.code ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as KeyboardEvent;
};

const createBlock = (overrides: Partial<Block> = {}): Block => {
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.textContent = '';

  const holder = document.createElement('div');
  holder.appendChild(input);

  return {
    id: 'test-block',
    name: 'paragraph',
    holder,
    currentInput: input,
    inputs: [input],
    firstInput: input,
    lastInput: input,
    tool: {
      isDefault: true,
      isLineBreaksEnabled: false,
      name: 'paragraph',
    },
    isEmpty: false,
    hasMedia: false,
    updateCurrentInput: vi.fn(),
    save: vi.fn(() => Promise.resolve({})),
    render: vi.fn(),
    ...overrides,
  } as unknown as Block;
};

const createBlokModules = (overrides: Partial<BlokModules> = {}): BlokModules => {
  const mockBlock = createBlock();
  const mockPreviousBlock = createBlock({ id: 'prev-block' });
  const mockNextBlock = createBlock({ id: 'next-block' });

  const defaults: Partial<BlokModules> = {
    BlockManager: {
      currentBlock: mockBlock,
      previousBlock: mockPreviousBlock,
      nextBlock: mockNextBlock,
      blocks: [mockPreviousBlock, mockBlock, mockNextBlock],
      currentBlockIndex: 1,
      insertDefaultBlockAtIndex: vi.fn(() => mockBlock),
      split: vi.fn(() => mockBlock),
      removeBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      mergeBlocks: vi.fn(() => Promise.resolve()),
    } as unknown as BlokModules['BlockManager'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
      navigateNext: vi.fn(() => false),
      navigatePrevious: vi.fn(() => false),
      navigateVerticalNext: vi.fn(() => false),
      navigateVerticalPrevious: vi.fn(() => false),
    } as unknown as BlokModules['Caret'],
    Toolbar: {
      opened: false,
      close: vi.fn(),
      moveAndOpen: vi.fn(),
    } as unknown as BlokModules['Toolbar'],
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
    } as unknown as BlokModules['InlineToolbar'],
    UI: {
      someToolbarOpened: false,
      someFlipperButtonFocused: false,
      closeAllToolbars: vi.fn(),
      isRtl: false,
    } as unknown as BlokModules['UI'],
    BlockSelection: {
      anyBlockSelected: false,
      clearSelection: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    CrossBlockSelection: {
      toggleBlockSelectedState: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
    YjsManager: {
      stopCapturing: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
  };

  const mergedState: Partial<BlokModules> = { ...defaults };

  for (const [moduleName, moduleOverrides] of Object.entries(overrides) as Array<[keyof BlokModules, unknown]>) {
    const defaultModule = defaults[moduleName];

    if (
      defaultModule !== undefined &&
      defaultModule !== null &&
      typeof defaultModule === 'object' &&
      moduleOverrides !== null &&
      typeof moduleOverrides === 'object'
    ) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = {
        ...(defaultModule as object),
        ...(moduleOverrides),
      } as BlokModules[typeof moduleName];
    } else if (moduleOverrides !== undefined) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] =
        moduleOverrides as BlokModules[typeof moduleName];
    }
  }

  return mergedState as BlokModules;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KeyboardNavigation', () => {
  describe('handleTab', () => {
    it('navigates to next input when Tab is pressed', () => {
      const navigateNext = vi.fn(() => true);
      const blok = createBlokModules({
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      keyboardNavigation.handleTab(event);

      expect(navigateNext).toHaveBeenCalledWith(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('navigates to previous input when Shift+Tab is pressed', () => {
      const navigatePrevious = vi.fn(() => true);
      const blok = createBlokModules({
        Caret: {
          navigatePrevious,
        } as unknown as BlokModules['Caret'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

      keyboardNavigation.handleTab(event);

      expect(navigatePrevious).toHaveBeenCalledWith(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('does not navigate when InlineToolbar is opened', () => {
      const navigateNext = vi.fn();
      const blok = createBlokModules({
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
        InlineToolbar: {
          opened: true,
        } as unknown as BlokModules['InlineToolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab' });

      keyboardNavigation.handleTab(event);

      expect(navigateNext).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('handleEnter', () => {
    it('returns early when there is no current block', () => {
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: undefined,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      keyboardNavigation.handleEnter(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns early when tool has line breaks enabled', () => {
      const mockBlock = createBlock({
        tool: {
          isLineBreaksEnabled: true,
          isDefault: true,
          name: 'code',
        } as unknown as Block['tool'],
      });
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      keyboardNavigation.handleEnter(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns early when toolbar is open with focused button', () => {
      const blok = createBlokModules({
        UI: {
          someToolbarOpened: true,
          someFlipperButtonFocused: true,
        } as unknown as BlokModules['UI'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      keyboardNavigation.handleEnter(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns early for Shift+Enter (line break)', () => {
      const blok = createBlokModules();
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter', shiftKey: true });

      keyboardNavigation.handleEnter(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('creates new block and prevents default for regular Enter', () => {
      const moveAndOpen = vi.fn();
      const setToBlock = vi.fn();
      const stopCapturing = vi.fn();
      const mockBlock = createBlock();
      const insertedBlock = createBlock({ id: 'inserted-block' });
      const insertDefaultBlockAtIndex = vi.fn(() => insertedBlock);
      const split = vi.fn(() => insertedBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          split,
          insertDefaultBlockAtIndex,
          currentBlockIndex: 0,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      keyboardNavigation.handleEnter(event);

      // Verify that a block operation was performed (either split or insert)
      const blockOperationCalled = split.mock.calls.length > 0 || insertDefaultBlockAtIndex.mock.calls.length > 0;
      expect(blockOperationCalled).toBe(true);
      // Verify the returned block was focused
      expect(setToBlock).toHaveBeenCalled();
      expect(moveAndOpen).toHaveBeenCalled();
      // Verify default browser behavior was prevented
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleBackspace', () => {
    it('returns early when there is no current block', () => {
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: undefined,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      keyboardNavigation.handleBackspace(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('navigates to previous input when not at first input', () => {
      const firstInput = document.createElement('div');
      firstInput.contentEditable = 'true';
      const secondInput = document.createElement('div');
      secondInput.contentEditable = 'true';

      const mockBlock = createBlock({
        inputs: [firstInput, secondInput],
        firstInput,
        lastInput: secondInput,
        currentInput: secondInput,
      });

      let navigationOccurred = false;
      const navigatePrevious = vi.fn(() => {
        navigationOccurred = true;
        return true;
      });
      const close = vi.fn();
      const removeBlock = vi.fn();
      const mergeBlocks = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: createBlock({ id: 'previous-block' }),
          removeBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          navigatePrevious,
          setToBlock,
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      // Mock isCaretAtStartOfInput to simulate caret at start of input
      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Verify toolbar was closed (observable side effect)
      expect(close).toHaveBeenCalled();
      // Verify navigation occurred (caret moved to previous input)
      expect(navigationOccurred).toBe(true);
      // Verify default browser behavior was prevented (custom behavior occurred)
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      // Verify no block state changes occurred (navigation only within same block)
      expect(removeBlock).not.toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).not.toHaveBeenCalled();

      isCaretAtStartOfInputSpy.mockRestore();
    });
  });

  describe('handleDelete', () => {
    it('returns early when there is no current block', () => {
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: undefined,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      keyboardNavigation.handleDelete(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('handleArrowRightAndDown', () => {
    it('returns early when keyCode is null', () => {
      const blok = createBlokModules();
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'F1', code: 'F1' }); // Unknown key

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns early for block movement shortcut Cmd+Shift+Down', () => {
      const blok = createBlokModules();
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        key: 'ArrowDown',
        shiftKey: true,
        metaKey: true,
      });

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('does not handle when toolbar is open with flipper combination', () => {
      const blok = createBlokModules({
        UI: {
          someToolbarOpened: true,
        } as unknown as BlokModules['UI'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        key: 'ArrowDown',
        keyCode: keyCodes.DOWN,
      });

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('handleArrowLeftAndUp', () => {
    it('returns early when keyCode is null', () => {
      const blok = createBlokModules();
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'F1', code: 'F1' }); // Unknown key

      keyboardNavigation.handleArrowLeftAndUp(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('returns early for block movement shortcut Cmd+Shift+Up', () => {
      const blok = createBlokModules();
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        key: 'ArrowUp',
        shiftKey: true,
        metaKey: true,
      });

      keyboardNavigation.handleArrowLeftAndUp(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });
});
