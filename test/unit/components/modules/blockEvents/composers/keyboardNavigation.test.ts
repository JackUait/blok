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
      setBlockParent: vi.fn(),
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
      markCaretBeforeChange: vi.fn(),
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

    it('always prevents default Tab behavior even when navigation fails', () => {
      const navigateNext = vi.fn(() => false);
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

    it('always prevents default Shift+Tab behavior even when navigation fails', () => {
      const navigatePrevious = vi.fn(() => false);
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
          transactForTool: vi.fn((fn: () => void) => fn()),
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
          markCaretBeforeChange: vi.fn(),
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

    it('creates a new child inside the toggle when Enter is pressed on an empty last child', () => {
      const toggleParentId = 'toggle-parent';
      const childBlockId = 'child-block';

      const toggleHolder = document.createElement('div');
      const toggleWrapper = document.createElement('div');
      toggleWrapper.setAttribute('data-blok-toggle-open', 'true');
      toggleHolder.appendChild(toggleWrapper);

      const toggleParent = createBlock({
        id: toggleParentId,
        contentIds: [childBlockId],
        holder: toggleHolder,
      });

      const emptyChildBlock = createBlock({
        id: childBlockId,
        isEmpty: true,
        parentId: toggleParentId,
        currentInput: (() => {
          const input = document.createElement('div');
          input.contentEditable = 'true';
          return input;
        })(),
      });

      const newBlock = createBlock({ id: 'new-block' });
      const setBlockParent = vi.fn();
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);
      const getBlockById = vi.fn((id: string) => {
        if (id === toggleParentId) return toggleParent;
        if (id === childBlockId) return emptyChildBlock;
        return undefined;
      });
      const setToBlock = vi.fn();
      const moveAndOpen = vi.fn();

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyChildBlock,
          currentBlockIndex: 1,
          insertDefaultBlockAtIndex,
          split: vi.fn(),
          setBlockParent,
          move: vi.fn(),
          getBlockIndex: vi.fn(),
          getBlockById,
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          stopCapturing: vi.fn(),
          markCaretBeforeChange: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // The block should NOT be promoted out — it should stay inside the toggle.
      // setBlockParent should NOT be called with null (no un-parenting).
      expect(setBlockParent).not.toHaveBeenCalledWith(emptyChildBlock, null);
      // A new block should be created inside the toggle at currentBlockIndex + 1
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(2);
      // The new block should inherit the toggle parent
      expect(setBlockParent).toHaveBeenCalledWith(newBlock, toggleParentId);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('exits empty callout on Enter by inserting a block after it, preserving the callout', () => {
      const calloutParentId = 'callout-parent';
      const childBlockId = 'child-block';

      const calloutHolder = document.createElement('div');
      const childContainer = document.createElement('div');
      childContainer.setAttribute('data-blok-toggle-children', '');
      calloutHolder.appendChild(childContainer);

      const calloutParent = createBlock({
        id: calloutParentId,
        contentIds: [childBlockId],
        holder: calloutHolder,
      });

      const emptyChildBlock = createBlock({
        id: childBlockId,
        isEmpty: true,
        parentId: calloutParentId,
        currentInput: (() => {
          const input = document.createElement('div');
          input.contentEditable = 'true';
          return input;
        })(),
      });

      const newBlock = createBlock({ id: 'new-block' });
      const setBlockParent = vi.fn();
      const move = vi.fn();
      const removeBlock = vi.fn();
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);
      const getBlockIndex = vi.fn((block: Block) => {
        if (block === calloutParent) return 0;
        if (block === emptyChildBlock) return 1;
        return -1;
      });
      const getBlockById = vi.fn((id: string) => {
        if (id === calloutParentId) return calloutParent;
        if (id === childBlockId) return emptyChildBlock;
        return undefined;
      });
      const setToBlock = vi.fn();

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyChildBlock,
          currentBlockIndex: 1,
          insertDefaultBlockAtIndex,
          split: vi.fn(),
          setBlockParent,
          move,
          removeBlock,
          getBlockIndex,
          getBlockById,
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          stopCapturing: vi.fn(),
          markCaretBeforeChange: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // Should NOT promote the child or remove the callout
      expect(setBlockParent).not.toHaveBeenCalledWith(emptyChildBlock, null);
      expect(move).not.toHaveBeenCalled();
      expect(removeBlock).not.toHaveBeenCalled();
      // Should insert a new block after the callout (index 0 + 1 = 1)
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(1);
      // New block should NOT be parented to the callout
      expect(setBlockParent).not.toHaveBeenCalled();
      // Focus should move to the new block
      expect(setToBlock).toHaveBeenCalledWith(newBlock);

      isCaretAtStartOfInputSpy.mockRestore();
      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('does not promote when callout has multiple children (last child empty)', () => {
      const calloutParentId = 'callout-parent';
      const firstChildId = 'first-child';
      const lastChildId = 'last-child';

      const calloutHolder = document.createElement('div');
      const childContainer = document.createElement('div');
      childContainer.setAttribute('data-blok-toggle-children', '');
      calloutHolder.appendChild(childContainer);

      const calloutParent = createBlock({
        id: calloutParentId,
        contentIds: [firstChildId, lastChildId],
        holder: calloutHolder,
      });

      const emptyLastChild = createBlock({
        id: lastChildId,
        isEmpty: true,
        parentId: calloutParentId,
        currentInput: (() => {
          const input = document.createElement('div');
          input.contentEditable = 'true';
          return input;
        })(),
      });

      const newBlock = createBlock({ id: 'new-block' });
      const setBlockParent = vi.fn();
      const move = vi.fn();
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);
      const getBlockIndex = vi.fn((block: Block) => {
        if (block === calloutParent) return 0;
        if (block === emptyLastChild) return 2;
        return -1;
      });
      const getBlockById = vi.fn((id: string) => {
        if (id === calloutParentId) return calloutParent;
        if (id === lastChildId) return emptyLastChild;
        return undefined;
      });

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyLastChild,
          currentBlockIndex: 2,
          insertDefaultBlockAtIndex,
          split: vi.fn(),
          setBlockParent,
          move,
          getBlockIndex,
          getBlockById,
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          stopCapturing: vi.fn(),
          markCaretBeforeChange: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // Should NOT promote — callout has content (multiple children)
      expect(setBlockParent).not.toHaveBeenCalledWith(emptyLastChild, null);
      expect(move).not.toHaveBeenCalled();
      // Should insert a new block inside the callout
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(3);
      expect(setBlockParent).toHaveBeenCalledWith(newBlock, calloutParentId);

      isCaretAtStartOfInputSpy.mockRestore();
      isCaretAtEndOfInputSpy.mockRestore();
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
          transactForTool: vi.fn((fn: () => void) => fn()),
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
          markCaretBeforeChange: vi.fn(),
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

    it('skips redundant setBlockParent when new block already has the correct parentId (table cell)', () => {
      const tableBlockId = 'table-block';

      const currentBlock = createBlock({
        id: 'cell-block',
        parentId: tableBlockId,
      });

      // The new block returned by insertDefaultBlockAtIndex already has parentId set
      // because handleBlockMutation -> claimBlockForCell sets it during the insert
      const newBlock = createBlock({
        id: 'new-cell-block',
        parentId: tableBlockId,
      });

      const setBlockParent = vi.fn();
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);

      const blok = createBlokModules({
        BlockManager: {
          currentBlock,
          currentBlockIndex: 1,
          insertDefaultBlockAtIndex,
          split: vi.fn(() => newBlock),
          setBlockParent,
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          markCaretBeforeChange: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // insertDefaultBlockAtIndex should be called (block inserted below)
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(2);

      // setBlockParent should NOT be called because newBlock.parentId already matches currentBlock.parentId
      expect(setBlockParent).not.toHaveBeenCalled();
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

    it('returns early when at first block with no previous block', () => {
      const mockBlock = createBlock();
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Toolbar is closed (observable side effect)
      expect(close).toHaveBeenCalled();
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
      const close = vi.fn();
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock: emptyPreviousBlock,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(close).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyPreviousBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('removes current empty block and sets caret to end of previous block', () => {
      const previousBlock = createBlock({ id: 'previous-block', isEmpty: false });
      const emptyCurrentBlock = createBlock({ id: 'empty-current', isEmpty: true });
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(close).toHaveBeenCalled();
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
      const close = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(close).toHaveBeenCalled();
      expect(mergeBlocks).toHaveBeenCalledWith(previousBlock, mockBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('does nothing when Backspace is pressed at start of a toggle child with no previous sibling in same parent', () => {
      // Previously this test verified that the block was promoted (un-nested) out of the toggle.
      // The behaviour was changed: pressing Backspace at the start of a toggle child with no
      // previous sibling in the same parent should do nothing (keep the block inside the toggle).
      const toggleParentId = 'toggle-parent';
      const childBlockId = 'child-block';

      const toggleParent = createBlock({
        id: toggleParentId,
        contentIds: [childBlockId],
      });

      const childBlock = createBlock({
        id: childBlockId,
        isEmpty: false,
        parentId: toggleParentId,
      });

      const setBlockParent = vi.fn();
      const move = vi.fn();
      const getBlockIndex = vi.fn((block: Block) => {
        if (block === toggleParent) return 0;
        if (block === childBlock) return 1;
        return -1;
      });
      const getBlockById = vi.fn((id: string) => {
        if (id === toggleParentId) return toggleParent;
        if (id === childBlockId) return childBlock;
        return undefined;
      });
      const close = vi.fn();
      const setToBlock = vi.fn();

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: childBlock,
          // previousBlock is the toggle parent (different parentId) — no sibling in same parent
          previousBlock: toggleParent,
          currentBlockIndex: 1,
          setBlockParent,
          move,
          getBlockIndex,
          getBlockById,
          removeBlock: vi.fn(),
          mergeBlocks: vi.fn(() => Promise.resolve()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          navigatePrevious: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Block must NOT be un-nested — setBlockParent and move must not be called
      expect(setBlockParent).not.toHaveBeenCalled();
      expect(move).not.toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      // Observable state: block remains nested inside toggle parent
      expect(childBlock.parentId).toBe(toggleParentId);
      expect(toggleParent.contentIds).toContain(childBlockId);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('removes empty first toggle child and focuses next sibling when next sibling exists in same parent', () => {
      const toggleParentId = 'toggle-parent';
      const childBlockId = 'child-block';
      const nextChildId = 'next-child';

      const toggleParent = createBlock({
        id: toggleParentId,
        contentIds: [childBlockId, nextChildId],
      });

      const childBlock = createBlock({
        id: childBlockId,
        isEmpty: true,
        parentId: toggleParentId,
      });

      const nextChild = createBlock({
        id: nextChildId,
        isEmpty: false,
        parentId: toggleParentId,
      });

      const removeBlock = vi.fn();
      const setToBlock = vi.fn();
      const getBlockIndex = vi.fn((block: Block) => {
        if (block === toggleParent) return 0;
        if (block === childBlock) return 1;
        if (block === nextChild) return 2;
        return -1;
      });
      const getBlockById = vi.fn((id: string) => {
        if (id === toggleParentId) return toggleParent;
        if (id === childBlockId) return childBlock;
        if (id === nextChildId) return nextChild;
        return undefined;
      });

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: childBlock,
          previousBlock: toggleParent,
          nextBlock: nextChild,
          currentBlockIndex: 1,
          removeBlock,
          setBlockParent: vi.fn(),
          move: vi.fn(),
          getBlockIndex,
          getBlockById,
          mergeBlocks: vi.fn(() => Promise.resolve()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          navigatePrevious: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          close: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Empty first child must be removed and focus set to next sibling
      expect(removeBlock).toHaveBeenCalledWith(childBlock);
      expect(setToBlock).toHaveBeenCalledWith(nextChild, 'start');

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('merges with previous sibling when Backspace is pressed at start of a toggle child that has a previous sibling in same parent', () => {
      const toggleParentId = 'toggle-parent';
      const prevChildId = 'prev-child';
      const currentChildId = 'current-child';

      const toggleParent = createBlock({
        id: toggleParentId,
        contentIds: [prevChildId, currentChildId],
      });

      const prevChild = createBlock({
        id: prevChildId,
        isEmpty: false,
        parentId: toggleParentId,
        mergeable: true,
      });

      const currentChild = createBlock({
        id: currentChildId,
        isEmpty: false,
        parentId: toggleParentId,
        mergeable: true,
      });

      const mergeBlocks = vi.fn(() => Promise.resolve());
      const setBlockParent = vi.fn();
      const move = vi.fn();

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: currentChild,
          // previousBlock is prevChild — same parentId as currentChild
          previousBlock: prevChild,
          currentBlockIndex: 2,
          setBlockParent,
          move,
          getBlockIndex: vi.fn(),
          getBlockById: vi.fn((id: string) => {
            if (id === toggleParentId) return toggleParent;
            return undefined;
          }),
          removeBlock: vi.fn(),
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock: vi.fn(),
          navigatePrevious: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          close: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Block must NOT be un-nested from the toggle
      expect(setBlockParent).not.toHaveBeenCalled();
      expect(move).not.toHaveBeenCalled();
      // Instead, mergeBlocks should be called (merge with previous sibling inside toggle)
      expect(mergeBlocks).toHaveBeenCalledWith(prevChild, currentChild);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('navigates to previous block when blocks are not mergeable', () => {
      const previousBlock = createBlock({ id: 'previous-block', isEmpty: false, mergeable: false });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false });
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(close).toHaveBeenCalled();
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
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(close).toHaveBeenCalled();
      expect(navigationOccurred).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(removeBlock).not.toHaveBeenCalled();
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).not.toHaveBeenCalled();

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('returns early when at last block with no next block', () => {
      const mockBlock = createBlock();
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      // Toolbar is closed (observable side effect)
      expect(close).toHaveBeenCalled();
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
      const close = vi.fn();
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock: emptyNextBlock,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(close).toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyNextBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('removes current empty block and sets caret to start of next block', () => {
      const nextBlock = createBlock({ id: 'next-block', isEmpty: false });
      const emptyCurrentBlock = createBlock({ id: 'empty-current', isEmpty: true });
      const close = vi.fn();
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
          close,
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

      expect(close).toHaveBeenCalled();
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
      const close = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(close).toHaveBeenCalled();
      expect(mergeBlocks).toHaveBeenCalledWith(mockBlock, nextBlock);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);

      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('navigates to next block when blocks are not mergeable', () => {
      const nextBlock = createBlock({ id: 'next-block', isEmpty: false, name: 'other-tool' });
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: false });
      const close = vi.fn();
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
          close,
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      expect(close).toHaveBeenCalled();
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

    it('does not merge blocks when Backspace is pressed inside a table cell', () => {
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

      // Table cell boundary must not merge blocks across cells
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('does not merge blocks when Delete is pressed at end of last input inside a table cell', () => {
      const mockBlock = createBlock({ id: 'current-block', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlockInTableCell(mockBlock);

      const nextBlock = createBlock({ id: 'next-block', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          nextBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
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

      // Table cell boundary must not merge blocks across cells
      expect(mergeBlocks).not.toHaveBeenCalled();
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
