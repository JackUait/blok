import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import { keyCodes } from '../../../../../../src/components/utils';
import * as caretUtils from '../../../../../../src/components/utils/caret/index';
import { SelectionUtils } from '../../../../../../src/components/selection';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  let defaultPrevented = false;
  const preventDefaultFn = vi.fn(() => {
    defaultPrevented = true;
  });

  const mockEvent = {
    keyCode: options.keyCode ?? 0,
    key: options.key ?? '',
    code: options.code ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    target: options.target ?? null,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: preventDefaultFn,
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  };

  return mockEvent as unknown as KeyboardEvent;
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
    mergeable: true, // Blocks are mergeable by default in tests
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
      hideBlockActions: vi.fn(),
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
      (mergedState as unknown as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = {
        ...(defaultModule as unknown as Record<string, unknown>),
        ...(moduleOverrides as Record<string, unknown>),
      } as unknown as BlokModules[typeof moduleName];
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

    it('inserts block below (not above) when the current block is empty', () => {
      const emptyBlock = createBlock({ isEmpty: true });
      const insertedBlock = createBlock({ id: 'inserted-block' });
      const insertDefaultBlockAtIndex = vi.fn(() => insertedBlock);
      const split = vi.fn(() => insertedBlock);
      const setToBlock = vi.fn();
      const moveAndOpen = vi.fn();
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyBlock,
          split,
          insertDefaultBlockAtIndex,
          currentBlockIndex: 1,
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

      // When a block is empty, both isCaretAtStartOfInput and isCaretAtEndOfInput return true.
      // The isEmpty guard should prevent the "insert above" branch and fall through to "insert below".
      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // Block should be inserted below (currentBlockIndex + 1), not above (currentBlockIndex)
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(2);
      expect(split).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(insertedBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
      isCaretAtEndOfInputSpy.mockRestore();
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

    it('returns early when selection is not collapsed', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

      const mockBlock = createBlock();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: createBlock({ id: 'previous-block' }),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(event.preventDefault).not.toHaveBeenCalled();

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('returns early when caret is not at start of input', () => {
      const mockBlock = createBlock();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: createBlock({ id: 'previous-block' }),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      keyboardNavigation.handleBackspace(event);

      expect(event.preventDefault).not.toHaveBeenCalled();

      isCaretAtStartOfInputSpy.mockRestore();
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
      const hideBlockActions = vi.fn();
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
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      // Mock isCaretAtStartOfInput to simulate caret at start of input
      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Verify toolbar block actions were hidden (observable side effect)
      expect(hideBlockActions).toHaveBeenCalled();
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

    it('returns early when at first block with no previous block', () => {
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const setToBlock = vi.fn();
      const navigatePrevious = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: null,
          removeBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          navigatePrevious,
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Toolbar block actions are hidden (observable side effect)
      expect(hideBlockActions).toHaveBeenCalled();
      // Default behavior is prevented - verify observable DOM event state
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      // No block state changes occur when at first block (observable: no mutations)
      expect(removeBlock).not.toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).not.toHaveBeenCalled();
      expect(navigatePrevious).not.toHaveBeenCalled();

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('removes previous empty block', () => {
      const emptyPreviousBlock = createBlock({ id: 'empty-previous', isEmpty: true });
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: emptyPreviousBlock,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyPreviousBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('removes current empty block and sets caret to end of previous block', () => {
      const previousBlock = createBlock({ id: 'previous-block', isEmpty: false });
      const emptyCurrentBlock = createBlock({ id: 'empty-current', isEmpty: true });
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyCurrentBlock,
          previousBlock,
          removeBlock,
          currentBlockIndex: 1,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyCurrentBlock);
      expect(setToBlock).toHaveBeenCalled();
      const setToBlockCall = setToBlock.mock.calls[0] as [Block, string];
      expect(setToBlockCall[1]).toBe('end');
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('merges blocks when both are mergeable', () => {
      const previousBlock = createBlock({ id: 'previous-block', isEmpty: false, mergeable: true });
      Object.defineProperty(previousBlock, 'lastInput', {
        value: document.createElement('div'),
        writable: false,
      });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: true });
      const hideBlockActions = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(mergeBlocks).toHaveBeenCalledWith(previousBlock, mockBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('navigates to previous block when blocks are not mergeable', () => {
      const previousBlock = createBlock({ id: 'previous-block', isEmpty: false, mergeable: false });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false });
      const hideBlockActions = vi.fn();
      const setToBlock = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(previousBlock, 'end');
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

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

    it('returns early when selection is not collapsed', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

      const mockBlock = createBlock();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: createBlock({ id: 'next-block' }),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(event.preventDefault).not.toHaveBeenCalled();

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('returns early when caret is not at end of input', () => {
      const mockBlock = createBlock();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: createBlock({ id: 'next-block' }),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      keyboardNavigation.handleDelete(event);

      expect(event.preventDefault).not.toHaveBeenCalled();

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('navigates to next input when not at last input', () => {
      const firstInput = document.createElement('div');
      firstInput.contentEditable = 'true';
      const secondInput = document.createElement('div');
      secondInput.contentEditable = 'true';

      const mockBlock = createBlock({
        inputs: [firstInput, secondInput],
        firstInput,
        lastInput: secondInput,
        currentInput: firstInput,
      });

      let navigationOccurred = false;
      const navigateNext = vi.fn(() => {
        navigationOccurred = true;
        return true;
      });
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const mergeBlocks = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: createBlock({ id: 'next-block' }),
          removeBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          navigateNext,
          setToBlock,
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(navigationOccurred).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(removeBlock).not.toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).not.toHaveBeenCalled();

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('returns early when at last block with no next block', () => {
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const setToBlock = vi.fn();
      const navigateNext = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: null,
          removeBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          navigateNext,
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      // Toolbar block actions are hidden (observable side effect)
      expect(hideBlockActions).toHaveBeenCalled();
      // Default behavior is prevented - verify observable DOM event state
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      // No block state changes occur when at last block (observable: no mutations)
      expect(removeBlock).not.toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).not.toHaveBeenCalled();
      expect(navigateNext).not.toHaveBeenCalled();

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('removes next empty block', () => {
      const emptyNextBlock = createBlock({ id: 'empty-next', isEmpty: true });
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: emptyNextBlock,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyNextBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('removes current empty block and sets caret to start of next block', () => {
      const nextBlock = createBlock({ id: 'next-block', isEmpty: false });
      const emptyCurrentBlock = createBlock({ id: 'empty-current', isEmpty: true });
      const hideBlockActions = vi.fn();
      const setToBlock = vi.fn();
      let currentBlockValue = emptyCurrentBlock;
      const removeBlock = vi.fn((block: Block) => {
        if (block === emptyCurrentBlock) {
          currentBlockValue = nextBlock;
        }
      });
      const blok = createBlokModules({
        BlockManager: {
          nextBlock,
          removeBlock,
          currentBlockIndex: 0,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });

      // Define getter after merge to override the static property
      Object.defineProperty(blok.BlockManager, 'currentBlock', {
        get() {
          return currentBlockValue;
        },
        configurable: true,
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyCurrentBlock);
      expect(setToBlock).toHaveBeenCalledWith(nextBlock, 'start');
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('merges blocks when both are mergeable', () => {
      const nextBlock = createBlock({ id: 'next-block', isEmpty: false, mergeable: true });
      Object.defineProperty(nextBlock, 'lastInput', {
        value: document.createElement('div'),
        writable: false,
      });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: true });
      const hideBlockActions = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(mergeBlocks).toHaveBeenCalledWith(mockBlock, nextBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('navigates to next block when blocks are not mergeable', () => {
      const nextBlock = createBlock({ id: 'next-block', isEmpty: false, name: 'other-tool' });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: false });
      const hideBlockActions = vi.fn();
      const setToBlock = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(nextBlock, 'start');
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
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

  describe('table cell toolbar preservation', () => {
    /**
     * Wraps a block's holder inside a table cell DOM structure,
     * simulating a paragraph block rendered inside a table cell.
     */
    const wrapBlockInTableCell = (block: Block): void => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.appendChild(cellBlocks);
      cellBlocks.appendChild(block.holder);
    };

    it('does not close toolbar on ArrowRight inside table cell', () => {
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      const mockBlock = createBlock({ parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.RIGHT,
        key: 'ArrowRight',
        code: 'ArrowRight',
      });

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not close toolbar on ArrowLeft inside table cell', () => {
      const mockBlock = createBlock({ parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.LEFT,
        key: 'ArrowLeft',
        code: 'ArrowLeft',
      });

      keyboardNavigation.handleArrowLeftAndUp(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not close all toolbars on ArrowLeft inside table cell when toolbar is open', () => {
      const mockBlock = createBlock({ parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const closeAllToolbars = vi.fn();
      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        UI: {
          someToolbarOpened: true,
          closeAllToolbars,
        } as unknown as BlokModules['UI'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.LEFT,
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        shiftKey: true,
      });

      keyboardNavigation.handleArrowLeftAndUp(event);

      expect(closeAllToolbars).not.toHaveBeenCalled();
    });

    it('does not close toolbar on Backspace at boundary inside table cell', () => {
      const mockBlock = createBlock({ parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: createBlock({ id: 'prev-block' }),
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.BACKSPACE,
        key: 'Backspace',
        code: 'Backspace',
      });

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not close toolbar on Delete at boundary inside table cell', () => {
      const mockBlock = createBlock({ parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: createBlock({ id: 'next-block' }),
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.DELETE,
        key: 'Delete',
        code: 'Delete',
      });

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not close toolbar after merge inside table cell', () => {
      const previousBlock = createBlock({ id: 'prev-block', isEmpty: false, mergeable: true });
      Object.defineProperty(previousBlock, 'lastInput', {
        value: document.createElement('div'),
        writable: false,
      });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const hideBlockActions = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.BACKSPACE,
        key: 'Backspace',
        code: 'Backspace',
      });

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(mergeBlocks).toHaveBeenCalledWith(previousBlock, mockBlock);
      // The merge .then() callback should also not close toolbar for table cell blocks
      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not hide block actions on ArrowRight for regular block', () => {
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.RIGHT,
        key: 'ArrowRight',
        code: 'ArrowRight',
      });

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
      expect(mockBlock.holder.closest('[data-blok-table-cell-blocks]')).toBeNull();
    });

    it('does not hide block actions on ArrowLeft for regular block', () => {
      const mockBlock = createBlock();
      const hideBlockActions = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          hideBlockActions,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({
        keyCode: keyCodes.LEFT,
        key: 'ArrowLeft',
        code: 'ArrowLeft',
      });

      keyboardNavigation.handleArrowLeftAndUp(event);

      expect(hideBlockActions).not.toHaveBeenCalled();
      expect(mockBlock.holder.closest('[data-blok-table-cell-blocks]')).toBeNull();
    });
  });
});
