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

    describe('indent (Tab)', () => {
      it('returns false when first selected block has no previous block', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'first-list' });
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockByIndex: vi.fn(() => null),
            getBlockIndex: vi.fn(() => 0),
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
      });

      it('returns false when previous block is not a list', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'list-block' });
        const mockPreviousBlock = createBlock({ name: 'paragraph', id: 'prev-block' });
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockIndex: vi.fn(() => 1),
            getBlockByIndex: vi.fn((index: number) => index === 0 ? mockPreviousBlock : mockListBlock),
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
      });

      it('returns false when selected block depth > previous block depth', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'list-block' });
        const mockPreviousBlock = createBlock({ name: 'list', id: 'prev-block' });

        // Set depths: previous at 0, selected at 2 (cannot indent past previous)
        const depthAttr1 = document.createElement('span');
        depthAttr1.setAttribute('data-list-depth', '0');
        mockPreviousBlock.holder.appendChild(depthAttr1);

        const depthAttr2 = document.createElement('span');
        depthAttr2.setAttribute('data-list-depth', '2');
        mockListBlock.holder.appendChild(depthAttr2);

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockIndex: vi.fn(() => 1),
            getBlockByIndex: vi.fn((index: number) => index === 0 ? mockPreviousBlock : mockListBlock),
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
      });
    });

    describe('outdent (Shift+Tab)', () => {
      it('returns false when selected blocks have depth 0', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'list-block' });
        const depthAttr = document.createElement('span');
        depthAttr.setAttribute('data-list-depth', '0');
        mockListBlock.holder.appendChild(depthAttr);

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
      });

      it('allows outdent when selected blocks have depth > 0', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'list-block' });
        const depthAttr = document.createElement('span');
        depthAttr.setAttribute('data-list-depth', '2');
        mockListBlock.holder.appendChild(depthAttr);

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockIndex: vi.fn(() => 0),
            update: vi.fn(() => Promise.resolve(mockListBlock)),
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
      });
    });

    describe('updateSelectedListItemsDepth', () => {
      it('updates depth of all selected list items and marks them as selected', async () => {
        const mockListBlock1 = createBlock({ name: 'list', id: 'list-1' });
        const mockListBlock2 = createBlock({ name: 'list', id: 'list-2' });

        // Set both blocks to depth 1 so they can be outdented
        const depthAttr1 = document.createElement('span');
        depthAttr1.setAttribute('data-list-depth', '1');
        mockListBlock1.holder.appendChild(depthAttr1);

        const depthAttr2 = document.createElement('span');
        depthAttr2.setAttribute('data-list-depth', '1');
        mockListBlock2.holder.appendChild(depthAttr2);

        // Make save return proper data structure
        mockListBlock1.save = vi.fn(() => Promise.resolve({
          id: 'list-1',
          tool: 'list',
          data: { text: 'item 1', style: 'unordered' },
          time: 0,
          tunes: {},
        }));
        mockListBlock2.save = vi.fn(() => Promise.resolve({
          id: 'list-2',
          tool: 'list',
          data: { text: 'item 2', style: 'unordered' },
          time: 0,
          tunes: {},
        }));

        const updatedBlock1 = createBlock({ name: 'list', id: 'list-1-updated' });
        const updatedBlock2 = createBlock({ name: 'list', id: 'list-2-updated' });
        let callIndex = 0;
        const update = vi.fn(() => Promise.resolve(callIndex++ === 0 ? updatedBlock1 : updatedBlock2));
        const clearCache = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock1, mockListBlock2],
            clearCache,
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockIndex: vi.fn((block: Block) => block.id === 'list-1' ? 0 : 1),
            getBlockByIndex: vi.fn((index: number) => index === 0 ? mockListBlock1 : mockListBlock2),
            update,
          } as unknown as BlokModules['BlockManager'],
        });

        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        await blockSelectionKeys.handleIndent(event);

        // Wait for the async update operation to complete (it's fire-and-forget in the code)
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify observable behavior: the update calls include the new depth value
        expect(update).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledWith(mockListBlock1, expect.objectContaining({
          depth: 0, // Outdent from depth 1 to 0
        }));
        expect(update).toHaveBeenCalledWith(mockListBlock2, expect.objectContaining({
          depth: 0, // Outdent from depth 1 to 0
        }));

        // Verify observable behavior: the returned blocks have selected set to true
        expect(updatedBlock1.selected).toBe(true);
        expect(updatedBlock2.selected).toBe(true);

        // Verify observable behavior: the cache was cleared to reflect changes
        expect(clearCache).toHaveBeenCalled();
      });
    });
  });
});
