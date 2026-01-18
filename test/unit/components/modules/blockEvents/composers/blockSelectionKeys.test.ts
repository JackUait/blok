import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockSelectionKeys } from '../../../../../../src/components/modules/blockEvents/composers/blockSelectionKeys';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import * as SelectionUtilsModule from '../../../../../../src/components/selection';

const createKeyboardEvent = (options: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  return {
    keyCode: 0,
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as KeyboardEvent;
};

const createClipboardEvent = (options: Partial<ClipboardEvent> = {}): ClipboardEvent => {
  return {
    ...options,
  } as ClipboardEvent;
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
    selected: false,
    ...overrides,
  } as unknown as Block;
};

const createBlokModules = (overrides: Partial<BlokModules> = {}): BlokModules => {
  const mockBlock1 = createBlock({ id: 'block-1', name: 'list' });
  const mockBlock2 = createBlock({ id: 'block-2', name: 'list' });
  const mockParagraph = createBlock({ id: 'block-3', name: 'paragraph' });

  // Add depth attributes for list blocks
  const listDepthAttr = document.createElement('span');
  listDepthAttr.setAttribute('data-list-depth', '0');
  mockBlock1.holder.appendChild(listDepthAttr);
  mockBlock2.holder.appendChild(listDepthAttr.cloneNode());

  const defaults: Partial<BlokModules> = {
    BlockSelection: {
      anyBlockSelected: false,
      selectedBlocks: [],
      clearSelection: vi.fn(),
      clearCache: vi.fn(),
      copySelectedBlocks: vi.fn(() => Promise.resolve()),
    } as unknown as BlokModules['BlockSelection'],
    BlockManager: {
      currentBlock: mockBlock1,
      blocks: [mockBlock1, mockBlock2],
      getBlockByIndex: vi.fn((index: number) => [mockBlock1, mockBlock2][index] ?? null),
      getBlockIndex: vi.fn(() => 0),
      currentBlockIndex: 0,
      deleteSelectedBlocksAndInsertReplacement: vi.fn(() => mockParagraph),
      update: vi.fn(() => Promise.resolve(mockBlock1)),
    } as unknown as BlokModules['BlockManager'],
    BlockSettings: {
      opened: false,
      contains: vi.fn(() => false),
    } as unknown as BlokModules['BlockSettings'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
    } as unknown as BlokModules['Caret'],
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
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = Object.assign(
        {},
        defaultModule,
        moduleOverrides
      ) as BlokModules[typeof moduleName];
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

describe('BlockSelectionKeys', () => {
  describe('handleDeletion', () => {
    it('returns false when key is not Backspace or Delete', () => {
      const blok = createBlokModules();
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Enter' });

      const result = blockSelectionKeys.handleDeletion(event);

      expect(result).toBe(false);
    });

    it('returns false when no blocks are selected', () => {
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: false,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const result = blockSelectionKeys.handleDeletion(event);

      expect(result).toBe(false);
    });

    it('returns false when event target is inside BlockSettings', () => {
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
        } as unknown as BlokModules['BlockSelection'],
        BlockSettings: {
          contains: vi.fn(() => true),
        } as unknown as BlokModules['BlockSettings'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const result = blockSelectionKeys.handleDeletion(event);

      expect(result).toBe(false);
    });

    it('returns false when there is a non-collapsed selection', () => {
      vi.spyOn(SelectionUtilsModule.SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(true);
      vi.spyOn(SelectionUtilsModule.SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);

      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const result = blockSelectionKeys.handleDeletion(event);

      expect(result).toBe(false);
    });

    it('deletes selected blocks and prevents default when conditions are met', () => {
      const setToBlock = vi.fn();
      const deleteSelectedBlocksAndInsertReplacement = vi.fn(() => createBlock());
      const clearSelection = vi.fn();
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
        BlockManager: {
          deleteSelectedBlocksAndInsertReplacement,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Backspace' });

      const result = blockSelectionKeys.handleDeletion(event);

      expect(result).toBe(true);
      expect(deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalled();
      expect(clearSelection).toHaveBeenCalledWith(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCopy', () => {
    it('does nothing when no blocks are selected', () => {
      const copySelectedBlocks = vi.fn();
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: false,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createClipboardEvent();

      blockSelectionKeys.handleCopy(event);

      expect(copySelectedBlocks).not.toHaveBeenCalled();
    });

    it('copies selected blocks when blocks are selected', () => {
      const copySelectedBlocks = vi.fn(() => Promise.resolve());
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createClipboardEvent();

      blockSelectionKeys.handleCopy(event);

      expect(copySelectedBlocks).toHaveBeenCalledWith(event);
    });
  });

  describe('handleCut', () => {
    it('does nothing when no blocks are selected', () => {
      const copySelectedBlocks = vi.fn();
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: false,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createClipboardEvent();

      blockSelectionKeys.handleCut(event);

      expect(copySelectedBlocks).not.toHaveBeenCalled();
    });

    it('copies and deletes selected blocks when blocks are selected', async () => {
      const mockBlocks = [createBlock(), createBlock()];
      const insertedBlock = createBlock();
      const copySelectedBlocks = vi.fn(() => Promise.resolve());
      const deleteSelectedBlocksAndInsertReplacement = vi.fn(() => insertedBlock);
      const setToBlock = vi.fn();
      const clearSelection = vi.fn();
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          selectedBlocks: mockBlocks,
          copySelectedBlocks,
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
        BlockManager: {
          deleteSelectedBlocksAndInsertReplacement,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createClipboardEvent();

      blockSelectionKeys.handleCut(event);

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(copySelectedBlocks).toHaveBeenCalledWith(event);
      expect(deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(insertedBlock, 'start');
      expect(clearSelection).toHaveBeenCalledWith(event);
    });
  });

  describe('handleIndent', () => {
    it('returns false when no blocks are selected', () => {
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: false,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Tab' });

      const result = blockSelectionKeys.handleIndent(event);

      expect(result).toBe(false);
    });

    it('returns false when selected blocks are not all list items', () => {
      const mockBlocks = [createBlock({ name: 'paragraph' }), createBlock({ name: 'list' })];
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          selectedBlocks: mockBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Tab' });

      const result = blockSelectionKeys.handleIndent(event);

      expect(result).toBe(false);
    });

    it('returns true and prevents default for selected list items', () => {
      const mockListBlock = createBlock({ name: 'list' });
      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          selectedBlocks: [mockListBlock],
        } as unknown as BlokModules['BlockSelection'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Tab' });

      const result = blockSelectionKeys.handleIndent(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });
});
