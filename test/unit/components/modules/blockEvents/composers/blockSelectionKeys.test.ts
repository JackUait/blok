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

    it('indents BOTH kinds of a mixed list + non-list selection (Notion parity, no longer a no-op)', async () => {
      // A selection mixing a paragraph and a list item must indent each by its own
      // mechanism: the list item's depth increases (data-driven) and the paragraph
      // nests structurally under its preceding sibling — instead of bailing (the old
      // no-op divergence).
      const preceding = createBlock({ id: 'pre', name: 'paragraph' });
      const paragraph = createBlock({ id: 'para', name: 'paragraph' });
      const listItem = createBlock({ id: 'li', name: 'list' });
      const depthAttr = document.createElement('span');
      depthAttr.setAttribute('data-list-depth', '0');
      listItem.holder.appendChild(depthAttr);

      const blocks = [preceding, paragraph, listItem];
      const updatedList = createBlock({ id: 'li-updated', name: 'list' });

      const blok = createBlokModules({
        BlockSelection: {
          anyBlockSelected: true,
          selectedBlocks: [paragraph, listItem],
          clearCache: vi.fn(),
        } as unknown as BlokModules['BlockSelection'],
        BlockManager: {
          blocks,
          getBlockIndex: vi.fn((b: Block) => blocks.indexOf(b)),
          getBlockByIndex: vi.fn((i: number) => blocks[i] ?? null),
          getBlockById: vi.fn((id: string) => blocks.find(b => b.id === id)),
          update: vi.fn(() => Promise.resolve(updatedList)),
          setBlockParent: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
      });
      const blockSelectionKeys = new BlockSelectionKeys(blok);
      const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

      const result = blockSelectionKeys.handleIndent(event);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Handled (not a no-op): preventDefault fired and it returned true.
      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      // List item indented one depth level.
      expect(blok.BlockManager.update).toHaveBeenCalledWith(listItem, expect.objectContaining({ depth: 1 }));
      // Paragraph nested structurally under its preceding sibling.
      expect(blok.BlockManager.setBlockParent).toHaveBeenCalledWith(paragraph, 'pre');
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
      it('is a no-op when the first selected list item is the first block (nothing to nest under)', () => {
        // M-9: multi-select Tab reparents STRUCTURALLY. The first block has no
        // preceding sibling, so there is nothing to nest under — no orphan depth-1.
        const mockListBlock = createBlock({ name: 'list', id: 'first-list', parentId: null });
        const blocks = [mockListBlock];
        const setBlockParent = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn(() => 0),
            getBlockByIndex: vi.fn(() => mockListBlock),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).not.toHaveBeenCalled();
      });

      it('nests a list item structurally under a preceding non-list block (M-2 parity)', () => {
        // M-9: a first-in-group list item below a paragraph nests under that
        // paragraph via setBlockParent — not a flat orphaned depth bump.
        const mockPreviousBlock = createBlock({ name: 'paragraph', id: 'prev-block', parentId: null });
        const mockListBlock = createBlock({ name: 'list', id: 'list-block', parentId: null });
        const blocks = [mockPreviousBlock, mockListBlock];
        const setBlockParent = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockByIndex: vi.fn((index: number) => blocks[index] ?? null),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(mockListBlock, 'prev-block');
      });

      it('blocks indent when first-in-group item is already at depth 1', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'first-list' });
        const depthAttr = document.createElement('span');
        depthAttr.setAttribute('data-list-depth', '1');
        mockListBlock.holder.appendChild(depthAttr);

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            getBlockByIndex: vi.fn(() => mockListBlock),
            getBlockIndex: vi.fn(() => 0),
            update: vi.fn(() => Promise.resolve(mockListBlock)),
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        // update should NOT have been called — can't indent past depth 1
        expect(blok.BlockManager.update).not.toHaveBeenCalled();
        expect(blok.BlockSelection.clearCache).not.toHaveBeenCalled();
      });

      it('reparents only the top-level selected item; a selected descendant follows it', () => {
        // M-9: a parent + its child are both selected. The parent reparents under
        // its preceding sibling; the child (a structural descendant) is NOT moved
        // directly — it travels with the parent, preserving relative nesting.
        const pre = createBlock({ name: 'list', id: 'pre', parentId: null });
        const mockParentBlock = createBlock({ name: 'list', id: 'parent-block', parentId: null });
        const mockChildBlock = createBlock({ name: 'list', id: 'child-block', parentId: 'parent-block' });
        const blocks = [pre, mockParentBlock, mockChildBlock];
        const setBlockParent = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockParentBlock, mockChildBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockByIndex: vi.fn((index: number) => blocks[index] ?? null),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });

        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(mockParentBlock, 'pre');
      });

      it('nests the selected list item under its preceding list sibling', () => {
        // M-9: structural reparent under the preceding list sibling (parentId set).
        const mockPreviousBlock = createBlock({ name: 'list', id: 'prev-block', parentId: null });
        const mockListBlock = createBlock({ name: 'list', id: 'list-block', parentId: null });
        const blocks = [mockPreviousBlock, mockListBlock];
        const setBlockParent = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockByIndex: vi.fn((index: number) => blocks[index] ?? null),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(mockListBlock, 'prev-block');
      });
    });

    describe('structural indent for non-list selections (H6)', () => {
      it('indents a multi-paragraph selection under the preceding sibling', () => {
        const pre = createBlock({ id: 'pre', name: 'paragraph', parentId: null });
        const p1 = createBlock({ id: 'p1', name: 'paragraph', parentId: null, selected: true });
        const p2 = createBlock({ id: 'p2', name: 'paragraph', parentId: null, selected: true });
        const blocks = [pre, p1, p2];
        const setBlockParent = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [p1, p2],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(p1, 'pre');
        expect(setBlockParent).toHaveBeenCalledWith(p2, 'pre');
      });

      it('nests every block but the first under the first when the selection starts at the top', () => {
        const p1 = createBlock({ id: 'p1', name: 'paragraph', parentId: null, selected: true });
        const p2 = createBlock({ id: 'p2', name: 'paragraph', parentId: null, selected: true });
        const blocks = [p1, p2];
        const setBlockParent = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [p1, p2],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: false });

        const result = blockSelectionKeys.handleIndent(event);

        // The first selected block has no preceding sibling so it cannot indent;
        // it becomes the anchor and the rest nest under it (Notion parity).
        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(p2, 'p1');
      });

      it('outdents a multi-paragraph selection to the grandparent, adopting trailing siblings', () => {
        const gp = createBlock({ id: 'gp', name: 'paragraph', parentId: null });
        const parent = createBlock({ id: 'p', name: 'paragraph', parentId: 'gp', contentIds: ['p1', 'p2', 'trail'] });
        const p1 = createBlock({ id: 'p1', name: 'paragraph', parentId: 'p', selected: true });
        const p2 = createBlock({ id: 'p2', name: 'paragraph', parentId: 'p', selected: true });
        const trail = createBlock({ id: 'trail', name: 'paragraph', parentId: 'p' });
        const blocks = [gp, parent, p1, p2, trail];
        const setBlockParent = vi.fn();
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [p1, p2],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        // The trailing sibling is adopted by the last selected block, then both
        // selected blocks move up to the grandparent.
        expect(setBlockParent).toHaveBeenCalledWith(trail, 'p2');
        expect(setBlockParent).toHaveBeenCalledWith(p1, 'gp');
        expect(setBlockParent).toHaveBeenCalledWith(p2, 'gp');
      });

      it('handles a mixed list + non-list selection (no longer a no-op)', () => {
        // Mixed selections are now indented per-kind (Notion parity) instead of
        // bailing — the detailed dual-mechanism behaviour is covered by the
        // 'indents BOTH kinds of a mixed list + non-list selection' test above.
        const paragraph = createBlock({ id: 'mixed-para', name: 'paragraph' });
        const listItem = createBlock({ id: 'mixed-li', name: 'list' });
        const blocks = [paragraph, listItem];
        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: blocks,
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((b: Block) => blocks.indexOf(b)),
            getBlockByIndex: vi.fn((i: number) => blocks[i] ?? null),
            getBlockById: vi.fn((id: string) => blocks.find(b => b.id === id)),
            update: vi.fn(() => Promise.resolve(listItem)),
            setBlockParent: vi.fn(),
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
      it('leaves a root (depth-0) list item in place — no structural move (M-8)', () => {
        const mockListBlock = createBlock({ name: 'list', id: 'list-block', parentId: null });
        const blocks = [mockListBlock];
        const setBlockParent = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(setBlockParent).not.toHaveBeenCalled();
      });

      it('outdents a nested list item structurally to its grandparent', () => {
        const parent = createBlock({ name: 'list', id: 'parent-block', parentId: null });
        const mockListBlock = createBlock({ name: 'list', id: 'list-block', parentId: 'parent-block' });
        const blocks = [parent, mockListBlock];
        const setBlockParent = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [mockListBlock],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((b) => b.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });
        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        // Grandparent is the parent's parent (root / null here).
        expect(setBlockParent).toHaveBeenCalledWith(mockListBlock, null);
      });

      it('outdents only the eligible items in a mixed-depth selection (M-8)', () => {
        // a(root) > b(child); c is a separate root item. Both b and c are selected.
        const a = createBlock({ name: 'list', id: 'a', parentId: null });
        const b = createBlock({ name: 'list', id: 'b', parentId: 'a' });
        const c = createBlock({ name: 'list', id: 'c', parentId: null });
        const blocks = [a, b, c];
        const setBlockParent = vi.fn();

        const blok = createBlokModules({
          BlockSelection: {
            anyBlockSelected: true,
            selectedBlocks: [b, c],
            clearCache: vi.fn(),
          } as unknown as BlokModules['BlockSelection'],
          BlockManager: {
            blocks,
            getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
            getBlockById: vi.fn((id: string) => blocks.find((bl) => bl.id === id)),
            setBlockParent,
          } as unknown as BlokModules['BlockManager'],
        });

        const blockSelectionKeys = new BlockSelectionKeys(blok);
        const event = createKeyboardEvent({ key: 'Tab', shiftKey: true });

        const result = blockSelectionKeys.handleIndent(event);

        expect(result).toBe(true);
        // b outdents to its grandparent (root/null); c (already root) stays put.
        expect(setBlockParent).toHaveBeenCalledTimes(1);
        expect(setBlockParent).toHaveBeenCalledWith(b, null);
      });
    });
  });
});
