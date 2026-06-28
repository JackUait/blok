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
      updateLastCaretAfterPosition: vi.fn(),
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
    /**
     * Builds modules whose BlockManager can resolve preceding/following siblings
     * and reparent — the structural Tab nesting reads the flat blocks array and
     * the parent's contentIds.
     */
    const tabModules = (
      blocks: Block[],
      current: Block | undefined,
      caret: Partial<BlokModules['Caret']> = {}
    ): BlokModules => createBlokModules({
      BlockManager: {
        currentBlock: current,
        blocks,
        getBlockIndex: (block: Block) => blocks.indexOf(block),
        getBlockByIndex: (index: number) => blocks[index],
        getBlockById: (id: string) => blocks.find((block) => block.id === id),
        setBlockParent: vi.fn(),
      } as unknown as BlokModules['BlockManager'],
      Caret: {
        navigateNext: vi.fn(() => false),
        navigatePrevious: vi.fn(() => false),
        ...caret,
      } as unknown as BlokModules['Caret'],
    });

    it('nests the current block under its preceding sibling on Tab', () => {
      const previous = createBlock({ id: 'prev', parentId: null });
      const current = createBlock({ id: 'cur', parentId: null });
      const blok = tabModules([previous, current], current);
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const navigateNext = blok.Caret.navigateNext as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: false }));

      expect(setBlockParent).toHaveBeenCalledWith(current, 'prev');
      expect(navigateNext).not.toHaveBeenCalled();
    });

    it('nests under the preceding SIBLING, skipping a deeper block between them', () => {
      const a = createBlock({ id: 'a', parentId: null });
      const child = createBlock({ id: 'child', parentId: 'a' });
      const current = createBlock({ id: 'cur', parentId: null });
      const blok = tabModules([a, child, current], current);
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: false }));

      // The preceding sibling at the same level is `a`, not the deeper `child`.
      expect(setBlockParent).toHaveBeenCalledWith(current, 'a');
    });

    it('does not nest the first child of a parent (no preceding sibling)', () => {
      const parent = createBlock({ id: 'p', parentId: null });
      const current = createBlock({ id: 'cur', parentId: 'p' });
      const navigateNext = vi.fn(() => true);
      const blok = tabModules([parent, current], current, { navigateNext });
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: false }));

      expect(setBlockParent).not.toHaveBeenCalled();
      expect(navigateNext).toHaveBeenCalledWith(true);
    });

    it('outdents to the grandparent and adopts following siblings on Shift+Tab', () => {
      const parent = createBlock({ id: 'p', parentId: null, contentIds: ['a', 'b', 'c'] });
      const a = createBlock({ id: 'a', parentId: 'p' });
      const current = createBlock({ id: 'b', parentId: 'p' });
      const c = createBlock({ id: 'c', parentId: 'p' });
      const blok = tabModules([parent, a, current, c], current);
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const navigatePrevious = blok.Caret.navigatePrevious as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: true }));

      // The following sibling `c` is adopted under `b`, then `b` moves up to root.
      expect(setBlockParent).toHaveBeenCalledWith(c, 'b');
      expect(setBlockParent).toHaveBeenCalledWith(current, null);
      expect(navigatePrevious).not.toHaveBeenCalled();
    });

    it('does not indent list items (they manage their own depth)', () => {
      const previous = createBlock({ id: 'prev', parentId: null });
      const current = createBlock({ id: 'cur', parentId: null, name: 'list' });
      const navigateNext = vi.fn(() => true);
      const blok = tabModules([previous, current], current, { navigateNext });
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: false }));

      expect(setBlockParent).not.toHaveBeenCalled();
      expect(navigateNext).toHaveBeenCalledWith(true);
    });

    it('falls back to navigation when there is no preceding block on Tab', () => {
      const current = createBlock({ id: 'cur', parentId: null });
      const navigateNext = vi.fn(() => true);
      const blok = tabModules([current], current, { navigateNext });
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: false }));

      expect(setBlockParent).not.toHaveBeenCalled();
      expect(navigateNext).toHaveBeenCalledWith(true);
    });

    it('falls back to navigation when block is already at root on Shift+Tab', () => {
      const current = createBlock({ id: 'cur', parentId: null });
      const navigatePrevious = vi.fn(() => true);
      const blok = tabModules([current], current, { navigatePrevious });
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);

      keyboardNavigation.handleTab(createKeyboardEvent({ key: 'Tab', shiftKey: true }));

      expect(setBlockParent).not.toHaveBeenCalled();
      expect(navigatePrevious).toHaveBeenCalledWith(true);
    });

    it('does not navigate when InlineToolbar is opened', () => {
      const previous = createBlock({ id: 'prev', parentId: null });
      const current = createBlock({ id: 'cur', parentId: null });
      const navigateNext = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks: [previous, current],
          getBlockIndex: (block: Block) => [previous, current].indexOf(block),
          getBlockByIndex: (index: number) => [previous, current][index],
          getBlockById: vi.fn(),
          setBlockParent: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
        InlineToolbar: {
          opened: true,
        } as unknown as BlokModules['InlineToolbar'],
      });
      const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab' });

      keyboardNavigation.handleTab(event);

      expect(navigateNext).not.toHaveBeenCalled();
      expect(setBlockParent).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('does not prevent default Tab behavior when navigation fails (tab out of editor)', () => {
      const current = createBlock({ id: 'cur', parentId: null });
      const navigateNext = vi.fn(() => false);
      const blok = tabModules([current], current, { navigateNext });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      keyboardNavigation.handleTab(event);

      expect(navigateNext).toHaveBeenCalledWith(true);
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
          updateLastCaretAfterPosition: vi.fn(),
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

    it('replaces an empty heading with a paragraph in place on Enter and focuses it', () => {
      const setToBlock = vi.fn();
      const headingInput = document.createElement('div');
      headingInput.contentEditable = 'true';
      const headingBlock = createBlock({
        id: 'heading-block',
        name: 'header',
        isEmpty: true,
        parentId: null,
        currentInput: headingInput,
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: 'header',
        } as unknown as Block['tool'],
      });
      const paragraphBlock = createBlock({ id: 'paragraph-in-place' });
      const replace = vi.fn(() => paragraphBlock);
      const insertDefaultBlockAtIndex = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: headingBlock,
          currentBlockIndex: 1,
          replace,
          insertDefaultBlockAtIndex,
          split: vi.fn(),
          setBlockParent: vi.fn(),
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          defaultTool: { name: 'paragraph' },
        } as unknown as BlokModules['Tools'],
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
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const startSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // The heading is converted to a paragraph IN PLACE — no extra block inserted.
      expect(replace).toHaveBeenCalledWith(headingBlock, 'paragraph', { text: '' });
      expect(insertDefaultBlockAtIndex).not.toHaveBeenCalled();
      // Focus moves into the replacement paragraph.
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock);

      startSpy.mockRestore();
      endSpy.mockRestore();
    });

    it('keeps the new block at the same nesting level (inherits parent) when Enter is pressed at the end of a nested paragraph', () => {
      const nestedBlock = createBlock({ id: 'nested', parentId: 'parent-x' });
      const newBlock = createBlock({ id: 'new-block', parentId: null });
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);
      const setBlockParent = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: nestedBlock,
          currentBlockIndex: 1,
          insertDefaultBlockAtIndex,
          setBlockParent,
          split: vi.fn(),
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const startSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      expect(insertDefaultBlockAtIndex).toHaveBeenCalled();
      // The new sibling inherits the source block's parent so it stays nested at
      // the same structural level (Notion keeps the new line indented).
      expect(setBlockParent).toHaveBeenCalledWith(newBlock, 'parent-x');

      startSpy.mockRestore();
      endSpy.mockRestore();
    });

    it('keeps the block inserted above at the same nesting level when Enter is pressed at the start of a nested paragraph', () => {
      const nestedBlock = createBlock({ id: 'nested', parentId: 'parent-x', isEmpty: false });
      const newBlock = createBlock({ id: 'inserted-above', parentId: null });
      const insertDefaultBlockAtIndex = vi.fn(() => newBlock);
      const setBlockParent = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: nestedBlock,
          currentBlockIndex: 1,
          insertDefaultBlockAtIndex,
          setBlockParent,
          split: vi.fn(),
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const startSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      keyboardNavigation.handleEnter(event);

      expect(setBlockParent).toHaveBeenCalledWith(newBlock, 'parent-x');

      startSpy.mockRestore();
      endSpy.mockRestore();
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
      const insertDefaultBlockAtIndex = vi.fn((_index: number, ..._rest: boolean[]): Block => newBlock);
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
          updateLastCaretAfterPosition: vi.fn(),
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
      expect(insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(2);
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
          updateLastCaretAfterPosition: vi.fn(),
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

    it('does not promote the empty sole child of a column out to root — re-parents the new block into the same column', () => {
      const columnId = 'c1';
      const childBlockId = 'p1';

      const columnHolder = document.createElement('div');
      // A column is NOT a toggle: no data-blok-toggle-open marker.
      const column = createBlock({
        id: columnId,
        name: 'column',
        contentIds: [childBlockId],
        holder: columnHolder,
      });

      const emptyChild = createBlock({
        id: childBlockId,
        name: 'paragraph',
        isEmpty: true,
        parentId: columnId,
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
      const insertDefaultBlockAtIndex = vi.fn((_index: number, ..._rest: boolean[]): Block => newBlock);
      const getBlockIndex = vi.fn((block: Block) => {
        if (block === column) return 1;
        if (block === emptyChild) return 2;
        return -1;
      });
      const getBlockById = vi.fn((id: string) => {
        if (id === columnId) return column;
        if (id === childBlockId) return emptyChild;
        return undefined;
      });

      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyChild,
          currentBlockIndex: 2,
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
          setToBlock: vi.fn(),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          stopCapturing: vi.fn(),
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // Must NOT promote out of the column: the new block is inserted right after
      // the empty child (index 2 + 1 = 3), NOT after the column (which would be root).
      expect(insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(3);
      // New block re-parented INTO the same column — never to root (null).
      expect(setBlockParent).toHaveBeenCalledWith(newBlock, columnId);
      expect(setBlockParent).not.toHaveBeenCalledWith(newBlock, null);
      expect(move).not.toHaveBeenCalled();
      expect(removeBlock).not.toHaveBeenCalled();

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
      const insertDefaultBlockAtIndex = vi.fn((_index: number, ..._rest: boolean[]): Block => newBlock);
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
          updateLastCaretAfterPosition: vi.fn(),
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
      expect(insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(3);
      expect(setBlockParent).toHaveBeenCalledWith(newBlock, calloutParentId);

      isCaretAtStartOfInputSpy.mockRestore();
      isCaretAtEndOfInputSpy.mockRestore();
    });

    it('inserts block below (not above) when the current block is empty', () => {
      const emptyBlock = createBlock({ isEmpty: true });
      const insertedBlock = createBlock({ id: 'inserted-block' });
      const insertDefaultBlockAtIndex = vi.fn((_index: number, ..._rest: boolean[]): Block => insertedBlock);
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
          updateLastCaretAfterPosition: vi.fn(),
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
      expect(insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(2);
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
      const insertDefaultBlockAtIndex = vi.fn((_index: number, ..._rest: boolean[]): Block => newBlock);

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
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });

      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      const isCaretAtEndOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // insertDefaultBlockAtIndex should be called (block inserted below)
      expect(insertDefaultBlockAtIndex.mock.calls[0][0]).toBe(2);

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

    const createHeadingBlock = (html: string, overrides: Partial<Block> = {}): Block => {
      const headingInput = document.createElement('div');
      headingInput.contentEditable = 'true';
      headingInput.innerHTML = html;

      const holder = document.createElement('div');
      holder.appendChild(headingInput);

      return createBlock({
        id: 'heading-block',
        name: 'header',
        parentId: null,
        holder,
        currentInput: headingInput,
        firstInput: headingInput,
        lastInput: headingInput,
        inputs: [headingInput],
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: 'header',
        } as unknown as Block['tool'],
        ...overrides,
      });
    };

    it('merges a non-empty paragraph into an empty styled previous block (text adopts its type) instead of deleting it', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      const convertible = { export: 'text', import: 'text' };
      const paragraphInput = document.createElement('div');
      paragraphInput.contentEditable = 'true';
      paragraphInput.innerHTML = 'hello';
      const paragraphHolder = document.createElement('div');
      paragraphHolder.appendChild(paragraphInput);

      const currentParagraph = createBlock({
        id: 'current-paragraph',
        name: 'paragraph',
        isEmpty: false,
        mergeable: true,
        currentInput: paragraphInput,
        firstInput: paragraphInput,
        lastInput: paragraphInput,
        inputs: [paragraphInput],
        holder: paragraphHolder,
        tool: { isDefault: true, isLineBreaksEnabled: false, name: 'paragraph', conversionConfig: convertible } as unknown as Block['tool'],
      });

      const emptyHeading = createHeadingBlock('', {
        id: 'empty-heading',
        isEmpty: true,
        mergeable: true,
        tool: { isDefault: false, isLineBreaksEnabled: false, name: 'header', conversionConfig: convertible } as unknown as Block['tool'],
      });

      const mergeBlocks = vi.fn(() => Promise.resolve());
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: currentParagraph,
          previousBlock: emptyHeading,
          mergeBlocks,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const isCaretAtStartOfInputSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      // Notion: the text is absorbed into the empty heading and adopts its style.
      expect(mergeBlocks).toHaveBeenCalledWith(emptyHeading, currentParagraph);
      expect(removeBlock).not.toHaveBeenCalledWith(emptyHeading);

      isCaretAtStartOfInputSpy.mockRestore();
    });

    it('resets a non-empty heading to a paragraph instead of merging on Backspace at start', () => {
      const headingBlock = createHeadingBlock('Hello <b>world</b>', { isEmpty: false });
      const paragraphBlock = createBlock({ id: 'paragraph-block' });
      const replace = vi.fn(() => paragraphBlock);
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: headingBlock,
          previousBlock: createBlock({ id: 'prev-block', isEmpty: false }),
          replace,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Tools: {
          defaultTool: { name: 'paragraph' },
        } as unknown as BlokModules['Tools'],
        Toolbar: { close: vi.fn() } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });
      const spy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(replace).toHaveBeenCalledWith(headingBlock, 'paragraph', { text: 'Hello <b>world</b>' });
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock, 'start');

      spy.mockRestore();
    });

    it('resets a quote to a paragraph instead of merging on Backspace at start, matching Notion', () => {
      const quoteInput = document.createElement('div');
      quoteInput.contentEditable = 'true';
      quoteInput.innerHTML = 'A quote';

      const holder = document.createElement('div');
      holder.appendChild(quoteInput);

      const quoteBlock = createBlock({
        id: 'quote-block',
        name: 'quote',
        parentId: null,
        isEmpty: false,
        holder,
        currentInput: quoteInput,
        firstInput: quoteInput,
        lastInput: quoteInput,
        inputs: [quoteInput],
        tool: { isDefault: false, isLineBreaksEnabled: false, name: 'quote' } as unknown as Block['tool'],
      });
      const paragraphBlock = createBlock({ id: 'paragraph-block' });
      const replace = vi.fn(() => paragraphBlock);
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: quoteBlock,
          previousBlock: createBlock({ id: 'prev-block', isEmpty: false }),
          replace,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Tools: {
          defaultTool: { name: 'paragraph' },
        } as unknown as BlokModules['Tools'],
        Toolbar: { close: vi.fn() } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });
      const spy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(replace).toHaveBeenCalledWith(quoteBlock, 'paragraph', { text: 'A quote' });
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock, 'start');

      spy.mockRestore();
    });

    it('resets an empty heading to an empty paragraph instead of deleting it on Backspace', () => {
      const headingBlock = createHeadingBlock('', { isEmpty: true });
      const paragraphBlock = createBlock({ id: 'paragraph-block' });
      const replace = vi.fn(() => paragraphBlock);
      const removeBlock = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: headingBlock,
          previousBlock: createBlock({ id: 'prev-block', isEmpty: false }),
          replace,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Tools: {
          defaultTool: { name: 'paragraph' },
        } as unknown as BlokModules['Tools'],
        Toolbar: { close: vi.fn() } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });
      const spy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(replace).toHaveBeenCalledWith(headingBlock, 'paragraph', { text: '' });
      expect(removeBlock).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it('resets a first-in-document heading to a paragraph on Backspace instead of doing nothing', () => {
      const headingBlock = createHeadingBlock('Title', { isEmpty: false });
      const paragraphBlock = createBlock({ id: 'paragraph-block' });
      const replace = vi.fn(() => paragraphBlock);
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: headingBlock,
          previousBlock: null,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        Tools: {
          defaultTool: { name: 'paragraph' },
        } as unknown as BlokModules['Tools'],
        Toolbar: { close: vi.fn() } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });
      const spy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(replace).toHaveBeenCalledWith(headingBlock, 'paragraph', { text: 'Title' });
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock, 'start');

      spy.mockRestore();
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

    /**
     * Callout parity: the Backspace-at-start-of-nested-child guard is written
     * to be generic (parentId-based, not container-specific). This suite locks
     * that invariant for callouts so a future refactor of the guard cannot
     * silently ship an ejection regression for any nested-container tool.
     *
     * These tests mirror the toggle coverage above — the expected behaviour is
     * identical, and that is exactly the point.
     */
    describe('handleBackspace - nested container parity (callout)', () => {
      it('does nothing when Backspace is pressed at start of a callout first child with no previous sibling in same parent', () => {
        const calloutParentId = 'callout-parent';
        const childBlockId = 'callout-child';

        const calloutParent = createBlock({
          id: calloutParentId,
          name: 'callout',
          contentIds: [childBlockId],
        });

        const childBlock = createBlock({
          id: childBlockId,
          isEmpty: false,
          parentId: calloutParentId,
        });

        const setBlockParent = vi.fn();
        const move = vi.fn();
        const removeBlock = vi.fn();
        const mergeBlocks = vi.fn(() => Promise.resolve());

        const blok = createBlokModules({
          BlockManager: {
            currentBlock: childBlock,
            // previousBlock is the callout parent — no sibling in same parent
            previousBlock: calloutParent,
            currentBlockIndex: 1,
            setBlockParent,
            move,
            getBlockIndex: vi.fn(),
            getBlockById: vi.fn((id: string) => (id === calloutParentId ? calloutParent : undefined)),
            removeBlock,
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

        // Block must NOT be ejected from the callout — no reparent, no move, no merge, no remove.
        expect(setBlockParent).not.toHaveBeenCalled();
        expect(move).not.toHaveBeenCalled();
        expect(mergeBlocks).not.toHaveBeenCalled();
        expect(removeBlock).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);

        // Observable state: block remains nested inside callout parent.
        expect(childBlock.parentId).toBe(calloutParentId);
        expect(calloutParent.contentIds).toContain(childBlockId);

        isCaretAtStartOfInputSpy.mockRestore();
      });

      it('does not merge across sibling callouts when Backspace is pressed at start of the first child of a later callout', () => {
        const firstCalloutId = 'callout-first';
        const secondCalloutId = 'callout-second';
        const firstCalloutChildId = 'first-callout-child';
        const secondCalloutChildId = 'second-callout-child';

        const firstCallout = createBlock({
          id: firstCalloutId,
          name: 'callout',
          contentIds: [firstCalloutChildId],
        });

        const secondCallout = createBlock({
          id: secondCalloutId,
          name: 'callout',
          contentIds: [secondCalloutChildId],
        });

        // previousBlock belongs to a DIFFERENT callout container — this is the
        // cross-container drift scenario. We must not merge across the boundary.
        const previousChild = createBlock({
          id: firstCalloutChildId,
          isEmpty: false,
          parentId: firstCalloutId,
        });

        const currentChild = createBlock({
          id: secondCalloutChildId,
          isEmpty: false,
          parentId: secondCalloutId,
        });

        const setBlockParent = vi.fn();
        const move = vi.fn();
        const removeBlock = vi.fn();
        const mergeBlocks = vi.fn(() => Promise.resolve());

        const blok = createBlokModules({
          BlockManager: {
            currentBlock: currentChild,
            previousBlock: previousChild,
            currentBlockIndex: 3,
            setBlockParent,
            move,
            getBlockIndex: vi.fn(),
            getBlockById: vi.fn((id: string) => {
              if (id === firstCalloutId) return firstCallout;
              if (id === secondCalloutId) return secondCallout;

              return undefined;
            }),
            removeBlock,
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

        // No cross-container merge, no reparent, no ejection.
        expect(setBlockParent).not.toHaveBeenCalled();
        expect(move).not.toHaveBeenCalled();
        expect(mergeBlocks).not.toHaveBeenCalled();
        // removeBlock only happens if the current block is empty; it is not.
        expect(removeBlock).not.toHaveBeenCalled();

        // Observable state: both children remain inside their respective callouts.
        expect(currentChild.parentId).toBe(secondCalloutId);
        expect(previousChild.parentId).toBe(firstCalloutId);

        isCaretAtStartOfInputSpy.mockRestore();
      });
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

    it('hides the block-action gutter instead of popping it when arrow navigation crosses a block', () => {
      const moveAndOpen = vi.fn();
      const hideBlockActions = vi.fn();
      const navigateVerticalNext = vi.fn(() => true);
      const blok = createBlokModules({
        Caret: {
          navigateVerticalNext,
          navigateNext: vi.fn(() => false),
          navigatePrevious: vi.fn(() => false),
          navigateVerticalPrevious: vi.fn(() => false),
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          moveAndOpen,
          hideBlockActions,
          close: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'ArrowDown', keyCode: keyCodes.DOWN });

      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      keyboardNavigation.handleArrowRightAndDown(event);

      expect(navigateVerticalNext).toHaveBeenCalled();
      // Gutter (plus/settings handles) must not pop on caret navigation — Notion
      // shows it on hover only.
      expect(hideBlockActions).toHaveBeenCalled();

      endSpy.mockRestore();
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

    /**
     * Wrap two blocks inside the SAME table-cell-blocks container. Mirrors the
     * real DOM when a cell holds multiple paragraph blocks (e.g. after the user
     * pressed Enter to split text inside a cell).
     */
    const wrapBlocksInSameTableCell = (...blocks: Block[]): void => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const cell = document.createElement('div');
      cell.setAttribute('data-blok-table-cell', '');
      cell.appendChild(cellBlocks);
      blocks.forEach((b) => cellBlocks.appendChild(b.holder));
    };

    it('MERGES blocks when Backspace is pressed with previous block in the SAME table cell', () => {
      const previousBlock = createBlock({ id: 'prev-in-same-cell', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      const mockBlock = createBlock({ id: 'current-in-same-cell', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlocksInSameTableCell(previousBlock, mockBlock);

      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          previousBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
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

      // Regression: previously this returned no-op; now it must merge within the same cell.
      expect(mergeBlocks).toHaveBeenCalledWith(previousBlock, mockBlock);
    });

    it('MERGES blocks when Delete is pressed with next block in the SAME table cell', () => {
      const mockBlock = createBlock({ id: 'current-in-same-cell', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      const nextBlock = createBlock({ id: 'next-in-same-cell', isEmpty: false, mergeable: true, parentId: 'table-block-1' } as unknown as Partial<Block>);
      wrapBlocksInSameTableCell(mockBlock, nextBlock);

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

      // Regression: previously this returned no-op; now it must merge within the same cell.
      expect(mergeBlocks).toHaveBeenCalledWith(mockBlock, nextBlock);
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
