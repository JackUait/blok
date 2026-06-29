/**
 * Regression tests for Notion text/header parity keyboard bugs:
 *
 *  - BUG #5  Shift+Arrow at a block boundary EXTENDS the selection into the
 *            adjacent block (cross-block selection) instead of collapsing the caret.
 *  - BUG #6  Enter in an EMPTY quote converts it to a paragraph IN PLACE.
 *  - BUG #7  Forward-Delete is symmetric with Backspace: text in the next block
 *            pulls UP into an empty styled current block and adopts its type.
 *  - BUG #12 Backspace before a non-mergeable previous block SELECTS it.
 *  - BUG #16 Tab / Shift+Tab indentation is its OWN undo step (wraps the reparent
 *            in a single transactMoves group).
 *
 * These mirror the conventions in keyboardNavigation.test.ts (same directory).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
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
    mergeable: true,
    updateCurrentInput: vi.fn(),
    save: vi.fn(() => Promise.resolve({})),
    render: vi.fn(),
    ...overrides,
  } as unknown as Block;
};

const createBlokModules = (overrides: Partial<BlokModules> = {}): BlokModules => {
  const mockBlock = createBlock();

  const defaults: Partial<BlokModules> = {
    BlockManager: {
      currentBlock: mockBlock,
      previousBlock: createBlock({ id: 'prev-block' }),
      nextBlock: createBlock({ id: 'next-block' }),
      blocks: [mockBlock],
      currentBlockIndex: 0,
      insertDefaultBlockAtIndex: vi.fn(() => mockBlock),
      split: vi.fn(() => mockBlock),
      replace: vi.fn(() => mockBlock),
      removeBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      mergeBlocks: vi.fn(() => Promise.resolve()),
      setBlockParent: vi.fn(),
      getBlockById: vi.fn(),
      getBlockIndex: vi.fn(),
      getBlockByIndex: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
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
      tryToShow: vi.fn(() => Promise.resolve()),
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
      selectBlock: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    CrossBlockSelection: {
      toggleBlockSelectedState: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
    Tools: {
      defaultTool: { name: 'paragraph' },
    } as unknown as BlokModules['Tools'],
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

describe('KeyboardNavigation — Notion parity bugs', () => {
  describe('BUG #5 — Shift+Arrow at a block boundary extends cross-block selection', () => {
    it('Shift+ArrowRight at the END of a block extends selection into the next block (does not collapse caret)', () => {
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      const toggleBlockSelectedState = vi.fn();
      const navigateNext = vi.fn(() => false);
      const blok = createBlokModules({
        Caret: {
          navigateNext,
          navigateVerticalNext: vi.fn(() => false),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        CrossBlockSelection: {
          toggleBlockSelectedState,
        } as unknown as BlokModules['CrossBlockSelection'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });

      keyboardNavigation.handleArrowRightAndDown(event);

      // Cross-block selection extends forward — same path as Shift+ArrowDown.
      expect(toggleBlockSelectedState).toHaveBeenCalledWith();
      // The caret must NOT be collapsed into the next block.
      expect(navigateNext).not.toHaveBeenCalled();
    });

    it('Shift+ArrowRight in the MIDDLE of a block does not start cross-block selection (native extend)', () => {
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      const toggleBlockSelectedState = vi.fn();
      const navigateNext = vi.fn(() => false);
      const blok = createBlokModules({
        Caret: {
          navigateNext,
          navigateVerticalNext: vi.fn(() => false),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        CrossBlockSelection: {
          toggleBlockSelectedState,
        } as unknown as BlokModules['CrossBlockSelection'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });

      keyboardNavigation.handleArrowRightAndDown(event);

      // Not at the boundary → leave the native within-block shift-extend alone.
      expect(toggleBlockSelectedState).not.toHaveBeenCalled();
    });

    it('Shift+ArrowLeft at the START of a block extends selection into the previous block (does not collapse caret)', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      const toggleBlockSelectedState = vi.fn();
      const navigatePrevious = vi.fn(() => false);
      const blok = createBlokModules({
        Caret: {
          navigatePrevious,
          navigateVerticalPrevious: vi.fn(() => false),
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        CrossBlockSelection: {
          toggleBlockSelectedState,
        } as unknown as BlokModules['CrossBlockSelection'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true });

      keyboardNavigation.handleArrowLeftAndUp(event);

      // Cross-block selection extends backward — same path as Shift+ArrowUp.
      expect(toggleBlockSelectedState).toHaveBeenCalledWith(false);
      expect(navigatePrevious).not.toHaveBeenCalled();
    });
  });

  describe('BUG #6 — Enter in an empty quote converts it to a paragraph in place', () => {
    it('replaces an empty quote with a paragraph IN PLACE on Enter and focuses it', () => {
      const quoteInput = document.createElement('div');
      quoteInput.contentEditable = 'true';
      const holder = document.createElement('div');
      holder.appendChild(quoteInput);

      const quoteBlock = createBlock({
        id: 'quote-block',
        name: 'quote',
        isEmpty: true,
        parentId: null,
        holder,
        currentInput: quoteInput,
        firstInput: quoteInput,
        lastInput: quoteInput,
        inputs: [quoteInput],
        tool: { isDefault: false, isLineBreaksEnabled: false, name: 'quote' } as unknown as Block['tool'],
      });
      const paragraphBlock = createBlock({ id: 'paragraph-in-place' });
      const replace = vi.fn(() => paragraphBlock);
      const insertDefaultBlockAtIndex = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: quoteBlock,
          currentBlockIndex: 1,
          replace,
          insertDefaultBlockAtIndex,
          split: vi.fn(),
          setBlockParent: vi.fn(),
          transactForTool: vi.fn((fn: () => void) => fn()),
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const startSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleEnter(event);

      // The empty quote is converted to a paragraph IN PLACE — no extra block.
      expect(replace).toHaveBeenCalledWith(quoteBlock, 'paragraph', { text: '' });
      expect(insertDefaultBlockAtIndex).not.toHaveBeenCalled();
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock);

      startSpy.mockRestore();
      endSpy.mockRestore();
    });
  });

  describe('BUG #7 — Forward-Delete is symmetric with Backspace for styled blocks', () => {
    it('pulls the next block text UP into an empty styled (heading) block, which keeps its type', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      const headingInput = document.createElement('div');
      headingInput.contentEditable = 'true';
      const headingHolder = document.createElement('div');
      headingHolder.appendChild(headingInput);

      const convertible = { export: 'text', import: 'text' };
      const emptyHeading = createBlock({
        id: 'empty-heading',
        name: 'header',
        isEmpty: true,
        mergeable: true,
        holder: headingHolder,
        currentInput: headingInput,
        firstInput: headingInput,
        lastInput: headingInput,
        inputs: [headingInput],
        tool: { isDefault: false, isLineBreaksEnabled: false, name: 'header', conversionConfig: convertible } as unknown as Block['tool'],
      });

      const nextParagraph = createBlock({
        id: 'next-paragraph',
        name: 'paragraph',
        isEmpty: false,
        mergeable: true,
        tool: { isDefault: true, isLineBreaksEnabled: false, name: 'paragraph', conversionConfig: convertible } as unknown as Block['tool'],
      });

      const mergeBlocks = vi.fn(() => Promise.resolve());
      const removeBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyHeading,
          nextBlock: nextParagraph,
          mergeBlocks,
          removeBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      // The styled (empty heading) block wins: the next block's text merges UP
      // into it, exactly like the Backspace "empty styled previous wins" path.
      expect(mergeBlocks).toHaveBeenCalledWith(emptyHeading, nextParagraph);
      expect(removeBlock).not.toHaveBeenCalledWith(emptyHeading);

      endSpy.mockRestore();
    });

    it('still just removes an empty DEFAULT paragraph on forward-Delete (does not absorb the next block)', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      const emptyParagraph = createBlock({ id: 'empty-paragraph', isEmpty: true, mergeable: true });
      const nextParagraph = createBlock({ id: 'next-paragraph', isEmpty: false, mergeable: true });

      const mergeBlocks = vi.fn(() => Promise.resolve());
      const removeBlock = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: emptyParagraph,
          nextBlock: nextParagraph,
          mergeBlocks,
          removeBlock,
          currentBlockIndex: 0,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Delete' });

      const endSpy = vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      keyboardNavigation.handleDelete(event);

      // A plain default paragraph is NOT a styled block, so it falls through to
      // the line-break removal path — it must NOT absorb the next block's text.
      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(removeBlock).toHaveBeenCalledWith(emptyParagraph);

      endSpy.mockRestore();
    });
  });

  describe('BUG #12 — Backspace before a non-mergeable previous block selects it', () => {
    it('selects a non-mergeable previous block (e.g. an image) instead of parking the caret at its end', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);

      const imageBlock = createBlock({ id: 'image-block', name: 'image', isEmpty: false, mergeable: false });
      const currentParagraph = createBlock({ id: 'current-paragraph', isEmpty: false, mergeable: true });

      const selectBlock = vi.fn();
      const setToBlock = vi.fn();
      const mergeBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: currentParagraph,
          previousBlock: imageBlock,
          mergeBlocks,
        } as unknown as BlokModules['BlockManager'],
        BlockSelection: {
          anyBlockSelected: false,
          clearSelection: vi.fn(),
          selectBlock,
        } as unknown as BlokModules['BlockSelection'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const startSpy = vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      keyboardNavigation.handleBackspace(event);

      expect(mergeBlocks).not.toHaveBeenCalled();
      expect(selectBlock).toHaveBeenCalledWith(imageBlock);
      // The caret is no longer parked at the previous block's end.
      expect(setToBlock).not.toHaveBeenCalled();

      startSpy.mockRestore();
    });
  });

  describe('BUG #16 — Tab indentation is its own undo step', () => {
    it('wraps a successful Tab indent in a single transactMoves group', () => {
      const previous = createBlock({ id: 'prev', parentId: null });
      const current = createBlock({ id: 'cur', parentId: null });
      const blocks = [previous, current];
      const transactMoves = vi.fn((fn: () => void) => fn());
      const setBlockParent = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks,
          getBlockIndex: (block: Block) => blocks.indexOf(block),
          getBlockByIndex: (index: number) => blocks[index],
          getBlockById: (id: string) => blocks.find((b) => b.id === id),
          setBlockParent,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          transactMoves,
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      keyboardNavigation.handleTab(event);

      // The reparent happened…
      expect(setBlockParent).toHaveBeenCalledWith(current, 'prev');
      // …wrapped in exactly one transactMoves group so the reparent is a single
      // atomic undo entry (one Cmd+Z reverts the indent without losing prior typing).
      expect(transactMoves).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('wraps a successful Shift+Tab outdent in a single transactMoves group', () => {
      const parent = createBlock({ id: 'p', parentId: null, contentIds: ['cur'] });
      const current = createBlock({ id: 'cur', parentId: 'p' });
      const blocks = [parent, current];
      const transactMoves = vi.fn((fn: () => void) => fn());
      const setBlockParent = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks,
          getBlockIndex: (block: Block) => blocks.indexOf(block),
          getBlockByIndex: (index: number) => blocks[index],
          getBlockById: (id: string) => blocks.find((b) => b.id === id),
          setBlockParent,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          transactMoves,
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

      keyboardNavigation.handleTab(event);

      expect(setBlockParent).toHaveBeenCalledWith(current, null);
      expect(transactMoves).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('BUG #3 — Tab indent re-runs the toolbar positioner', () => {
    it('repositions the toolbar to the current block after a successful Tab indent', () => {
      const previous = createBlock({ id: 'prev', parentId: null });
      const current = createBlock({ id: 'cur', parentId: null });
      const blocks = [previous, current];
      const moveAndOpen = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks,
          getBlockIndex: (block: Block) => blocks.indexOf(block),
          getBlockByIndex: (index: number) => blocks[index],
          getBlockById: (id: string) => blocks.find((b) => b.id === id),
          setBlockParent: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          opened: false,
          close: vi.fn(),
          moveAndOpen,
          hideBlockActions: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          transactMoves: vi.fn((fn: () => void) => fn()),
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      keyboardNavigation.handleTab(event);

      // Indenting shifts the block horizontally; the toolbar's content-relative
      // gutter offset is cached, so it must be recomputed against the new nested
      // geometry — otherwise the +/⋮⋮ handles end up jammed against the text.
      expect(moveAndOpen).toHaveBeenCalledWith(current);
    });

    it('repositions the toolbar to the current block after a successful Shift+Tab outdent', () => {
      const parent = createBlock({ id: 'p', parentId: null, contentIds: ['cur'] });
      const current = createBlock({ id: 'cur', parentId: 'p' });
      const blocks = [parent, current];
      const moveAndOpen = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks,
          getBlockIndex: (block: Block) => blocks.indexOf(block),
          getBlockByIndex: (index: number) => blocks[index],
          getBlockById: (id: string) => blocks.find((b) => b.id === id),
          setBlockParent: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          opened: false,
          close: vi.fn(),
          moveAndOpen,
          hideBlockActions: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          transactMoves: vi.fn((fn: () => void) => fn()),
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

      keyboardNavigation.handleTab(event);

      expect(moveAndOpen).toHaveBeenCalledWith(current);
    });

    it('does NOT reposition the toolbar when Tab is a no-op (no preceding sibling)', () => {
      const current = createBlock({ id: 'cur', parentId: null });
      const blocks = [current];
      const moveAndOpen = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: current,
          blocks,
          getBlockIndex: (block: Block) => blocks.indexOf(block),
          getBlockByIndex: (index: number) => blocks[index],
          getBlockById: (id: string) => blocks.find((b) => b.id === id),
          setBlockParent: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          opened: false,
          close: vi.fn(),
          moveAndOpen,
          hideBlockActions: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
        YjsManager: {
          transactMoves: vi.fn((fn: () => void) => fn()),
          markCaretBeforeChange: vi.fn(),
          updateLastCaretAfterPosition: vi.fn(),
        } as unknown as BlokModules['YjsManager'],
      });
      const keyboardNavigation = new KeyboardNavigation(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      keyboardNavigation.handleTab(event);

      // The first block has no preceding sibling → Tab can't indent → strict
      // no-op, so the toolbar is left alone (and native Tab focus-out preserved).
      expect(moveAndOpen).not.toHaveBeenCalled();
    });
  });
});
