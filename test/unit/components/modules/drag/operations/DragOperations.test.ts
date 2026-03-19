/**
 * Tests for DragOperations
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { DragOperations } from '../../../../../../src/components/modules/drag/operations/DragOperations';
import type { Block } from '../../../../../../src/components/block';
import type { SavedData } from '../../../../../../types/data-formats';

describe('DragOperations', () => {
  let operations: DragOperations;
  let mockBlockManager: {
    getBlockIndex: (block: Block) => number;
    getBlockByIndex: (index: number) => Block | undefined;
    move: (toIndex: number, fromIndex: number, needToFocus: boolean) => void;
    insert: (config: {
      tool: string;
      data: Record<string, unknown>;
      tunes: Record<string, unknown>;
      index: number;
      needToFocus: boolean;
    }) => Block;
    setBlockParent?: (block: Block, parentId: string | null) => void;
    getBlockById?: (id: string) => Block | undefined;
  };
  let mockYjsManager: {
    transactMoves: (fn: () => void) => void;
  };
  let mockBlockSelection: {
    clearSelection: () => void;
    selectBlock: (block: Block) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBlockManager = {
      getBlockIndex: vi.fn(),
      getBlockByIndex: vi.fn(),
      move: vi.fn(),
      insert: vi.fn(),
    };

    mockYjsManager = {
      transactMoves: vi.fn((fn: () => void): void => fn()),
    };

    mockBlockSelection = {
      clearSelection: vi.fn(),
      selectBlock: vi.fn(),
    };

    operations = new DragOperations(mockBlockManager, mockYjsManager, mockBlockSelection);
  });

  describe('constructor', () => {
    it('should initialize with adapters', () => {
      expect(operations).toBeInstanceOf(DragOperations);
    });

    it('should work without optional adapters', () => {
      const ops = new DragOperations(mockBlockManager);
      expect(ops).toBeInstanceOf(DragOperations);
    });
  });

  describe('moveBlocks - single block', () => {
    it('should move block to bottom of target', () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      // getBlockIndex is called 3 times: sourceBlock (pre-move), targetBlock, sourceBlock (post-move)
      mockBlockManager.getBlockIndex = vi.fn()
        .mockReturnValueOnce(0)  // sourceBlock pre-move
        .mockReturnValueOnce(2)  // targetBlock
        .mockReturnValueOnce(2); // sourceBlock post-move (moved to index 2)

      const result = operations.moveBlocks([sourceBlock], targetBlock, 'bottom');

      // targetIndex(2) + 1 = 3, but source is at 0 which is < 3, so toIndex = 3 - 1 = 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 0, false);
      expect(mockBlockSelection.selectBlock).toHaveBeenCalledWith(sourceBlock);
      expect(result.movedBlocks).toEqual([sourceBlock]);
      expect(result.targetIndex).toBe(2);
    });

    it('should move block to top of target', () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      // getBlockIndex is called 3 times: sourceBlock (pre-move), targetBlock, sourceBlock (post-move)
      mockBlockManager.getBlockIndex = vi.fn()
        .mockReturnValueOnce(5)  // sourceBlock pre-move
        .mockReturnValueOnce(2)  // targetBlock
        .mockReturnValueOnce(2); // sourceBlock post-move (moved to index 2)

      const result = operations.moveBlocks([sourceBlock], targetBlock, 'top');

      // targetIndex(2), source is at 5 which is >= 2, so toIndex = 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 5, false);
      expect(result.movedBlocks).toEqual([sourceBlock]);
      expect(result.targetIndex).toBe(2);
    });

    it('should not move if position unchanged', () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 2;
        if (block === targetBlock) return 3;
        return -1;
      });

      const result = operations.moveBlocks([sourceBlock], targetBlock, 'top');

      // source at 2, target at 3, moving to top of target = position 2 (same)
      expect(mockBlockManager.move).not.toHaveBeenCalled();
      expect(result.movedBlocks).toEqual([sourceBlock]);
      expect(result.targetIndex).toBe(2);
    });
  });

  describe('moveBlocks - multiple blocks', () => {
    it('should move multiple blocks down', () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === block2) return 1;
        if (block === targetBlock) return 4;
        return -1;
      });

      const result = operations.moveBlocks(
        [block1, block2],
        targetBlock,
        'bottom'
      );

      // Moving down: insertIndex = 5, reverse order; skipMovedHook=true defers lifecycle hooks
      expect(mockBlockManager.move).toHaveBeenCalledWith(4, 1, false, true); // block2 to position 4
      expect(mockBlockManager.move).toHaveBeenCalledWith(3, 0, false, true); // block1 to position 3
      expect(mockYjsManager.transactMoves).toHaveBeenCalled();
      expect(result.movedBlocks).toEqual([block1, block2]);
      expect(result.targetIndex).toBe(5);
    });

    it('should move multiple blocks up', () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 5;
        if (block === block2) return 6;
        if (block === targetBlock) return 2;
        return -1;
      });

      const result = operations.moveBlocks(
        [block1, block2],
        targetBlock,
        'top'
      );

      // Moving up: insertIndex = 2, maintain order; skipMovedHook=true defers lifecycle hooks
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 5, false, true); // block1 to position 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(3, 6, false, true); // block2 to position 3
      expect(result.movedBlocks).toEqual([block1, block2]);
      expect(result.targetIndex).toBe(2);
    });

    it('should clear and re-select blocks after move', () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 5;
        if (block === block2) return 6;
        if (block === targetBlock) return 2;
        return -1;
      });

      operations.moveBlocks([block1, block2], targetBlock, 'top');

      expect(mockBlockSelection.clearSelection).toHaveBeenCalled();
      expect(mockBlockSelection.selectBlock).toHaveBeenCalledWith(block1);
      expect(mockBlockSelection.selectBlock).toHaveBeenCalledWith(block2);
    });
  });

  describe('duplicateBlocks - toggle children hierarchy', () => {
    it('should re-establish parent-child relationships for duplicated toggle with children', async () => {
      // toggle (contentIds: [child1, child2]) at index 0
      // child1 (parentId: toggleId) at index 1
      // child2 (parentId: toggleId) at index 2
      // target at index 5
      const toggleBlock = createMockBlock('toggle-1', 'toggle', { text: 'Toggle' }, [], null);
      const child1 = createMockBlock('child-1', 'paragraph', { text: 'Child 1' }, [], 'toggle-1');
      const child2 = createMockBlock('child-2', 'paragraph', { text: 'Child 2' }, [], 'toggle-1');
      toggleBlock.contentIds = ['child-1', 'child-2'];
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'Target' }, [], null);

      const dupToggle = createMockBlock('dup-toggle', 'toggle', { text: 'Toggle' }, [], null);
      const dupChild1 = createMockBlock('dup-child-1', 'paragraph', { text: 'Child 1' }, [], null);
      const dupChild2 = createMockBlock('dup-child-2', 'paragraph', { text: 'Child 2' }, [], null);

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === toggleBlock) return 0;
        if (block === child1) return 1;
        if (block === child2) return 2;
        if (block === targetBlock) return 5;
        return -1;
      });

      let insertCallCount = 0;
      mockBlockManager.insert = vi.fn((): Block => {
        insertCallCount++;
        if (insertCallCount === 1) return dupToggle;
        if (insertCallCount === 2) return dupChild1;
        return dupChild2;
      });

      // Extend mock to support setBlockParent and getBlockById
      (mockBlockManager as unknown as { setBlockParent: (block: Block, parentId: string | null) => void }).setBlockParent =
        vi.fn((block: Block, parentId: string | null) => {
          // eslint-disable-next-line no-param-reassign
          (block as unknown as { parentId: string | null }).parentId = parentId;
        });
      (mockBlockManager as unknown as { getBlockById: (id: string) => Block | undefined }).getBlockById =
        vi.fn((id: string) => {
          if (id === 'dup-toggle') return dupToggle;
          if (id === 'dup-child-1') return dupChild1;
          if (id === 'dup-child-2') return dupChild2;
          return undefined;
        });

      const result = await operations.duplicateBlocks(
        [toggleBlock, child1, child2],
        targetBlock,
        'bottom'
      );

      expect(result.duplicatedBlocks).toHaveLength(3);

      // The duplicate children should have the duplicate toggle as their parent
      const setBlockParentMock = (mockBlockManager as unknown as { setBlockParent: ReturnType<typeof vi.fn> }).setBlockParent;
      expect(setBlockParentMock).toHaveBeenCalledWith(dupChild1, dupToggle.id);
      expect(setBlockParentMock).toHaveBeenCalledWith(dupChild2, dupToggle.id);
    });

    it('should not call setBlockParent for blocks with no original parent in the duplicated set', async () => {
      // Duplicating two sibling root-level blocks — no internal hierarchy to restore
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' }, [], null);
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' }, [], null);
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'Target' }, [], null);
      const newBlock1 = createMockBlock('new-1', 'paragraph', { text: '1' }, [], null);
      const newBlock2 = createMockBlock('new-2', 'paragraph', { text: '2' }, [], null);

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === block2) return 1;
        if (block === targetBlock) return 3;
        return -1;
      });

      let insertCallCount = 0;
      mockBlockManager.insert = vi.fn((): Block => {
        insertCallCount++;
        return insertCallCount === 1 ? newBlock1 : newBlock2;
      });

      (mockBlockManager as unknown as { setBlockParent: ReturnType<typeof vi.fn> }).setBlockParent = vi.fn();
      (mockBlockManager as unknown as { getBlockById: (id: string) => Block | undefined }).getBlockById = vi.fn();

      await operations.duplicateBlocks([block1, block2], targetBlock, 'bottom');

      const setBlockParentMock = (mockBlockManager as unknown as { setBlockParent: ReturnType<typeof vi.fn> }).setBlockParent;
      expect(setBlockParentMock).not.toHaveBeenCalled();
    });

    it('should handle toggle with no children without calling setBlockParent', async () => {
      const toggleBlock = createMockBlock('toggle-1', 'toggle', { text: 'Toggle' }, [], null);
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'Target' }, [], null);
      const dupToggle = createMockBlock('dup-toggle', 'toggle', { text: 'Toggle' }, [], null);

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === toggleBlock) return 0;
        if (block === targetBlock) return 2;
        return -1;
      });
      mockBlockManager.insert = vi.fn(() => dupToggle);

      (mockBlockManager as unknown as { setBlockParent: ReturnType<typeof vi.fn> }).setBlockParent = vi.fn();
      (mockBlockManager as unknown as { getBlockById: (id: string) => Block | undefined }).getBlockById = vi.fn();

      const result = await operations.duplicateBlocks([toggleBlock], targetBlock, 'bottom');

      expect(result.duplicatedBlocks).toHaveLength(1);
      const setBlockParentMock = (mockBlockManager as unknown as { setBlockParent: ReturnType<typeof vi.fn> }).setBlockParent;
      expect(setBlockParentMock).not.toHaveBeenCalled();
    });
  });

  describe('duplicateBlocks', () => {
    it('should duplicate blocks at target position', async () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const newBlock1 = createMockBlock('new-1', 'paragraph', { text: 'new-1' });
      const newBlock2 = createMockBlock('new-2', 'paragraph', { text: 'new-2' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === block2) return 1;
        if (block === targetBlock) return 3;
        return -1;
      });

      mockBlockManager.insert = vi.fn((config: {
        tool: string;
        data: Record<string, unknown>;
        tunes: Record<string, unknown>;
        index: number;
        needToFocus: boolean;
      }): Block => {
        if (config.index === 4) return newBlock1;
        if (config.index === 5) return newBlock2;
        return targetBlock;
      });

      const result = await operations.duplicateBlocks(
        [block1, block2],
        targetBlock,
        'bottom'
      );

      expect(mockBlockManager.insert).toHaveBeenCalledWith({
        tool: 'paragraph',
        data: { text: '1' },
        tunes: {},
        index: 4,
        needToFocus: false,
      });
      expect(mockBlockManager.insert).toHaveBeenCalledWith({
        tool: 'paragraph',
        data: { text: '2' },
        tunes: {},
        index: 5,
        needToFocus: false,
      });
      expect(result.duplicatedBlocks).toEqual([newBlock1, newBlock2]);
      expect(result.targetIndex).toBe(4);
    });

    it('should select duplicated blocks', async () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const newBlock = createMockBlock('new-1', 'paragraph', { text: 'new-1' });

      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.insert = vi.fn(() => newBlock);

      await operations.duplicateBlocks([block1], targetBlock, 'top');

      expect(mockBlockSelection.clearSelection).toHaveBeenCalled();
      expect(mockBlockSelection.selectBlock).toHaveBeenCalledWith(newBlock);
    });

    it('should return empty result if all saves fail', async () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      // Make save return undefined (failure)
      block1.save = vi.fn(async () => undefined);

      mockBlockManager.getBlockIndex = vi.fn(() => 0);

      const result = await operations.duplicateBlocks(
        [block1],
        targetBlock,
        'bottom'
      );

      expect(result.duplicatedBlocks).toEqual([]);
      expect(mockBlockManager.insert).not.toHaveBeenCalled();
    });

    it('should handle partial save failures', async () => {
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const newBlock = createMockBlock('new-1', 'paragraph', { text: 'new-1' });

      // block1 save succeeds, block2 save fails
      block1.save = vi.fn(async () => ({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: '1' },
        time: Date.now(),
        tunes: {},
      }));
      block2.save = vi.fn(async () => undefined);

      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.insert = vi.fn(() => newBlock);

      const result = await operations.duplicateBlocks(
        [block1, block2],
        targetBlock,
        'bottom'
      );

      expect(mockBlockManager.insert).toHaveBeenCalledTimes(1);
      expect(result.duplicatedBlocks).toEqual([newBlock]);
    });

    it('should work without blockSelection adapter', async () => {
      const ops = new DragOperations(mockBlockManager);
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const newBlock = createMockBlock('new-1', 'paragraph', { text: 'new-1' });

      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.insert = vi.fn(() => newBlock);

      const result = await ops.duplicateBlocks(
        [block1],
        targetBlock,
        'bottom'
      );

      expect(result.duplicatedBlocks).toEqual([newBlock]);
      // Should not throw even though blockSelection is undefined
    });
  });

  describe('moveBlocks - without yjsManager', () => {
    it('should execute moves directly without transactMoves', () => {
      const ops = new DragOperations(mockBlockManager, undefined, mockBlockSelection);
      const block1 = createMockBlock('block-1', 'paragraph', { text: '1' });
      const block2 = createMockBlock('block-2', 'paragraph', { text: '2' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === block2) return 1;
        if (block === targetBlock) return 4;
        return -1;
      });

      const result = ops.moveBlocks([block1, block2], targetBlock, 'bottom');

      // Moves should still be executed; skipMovedHook=true defers lifecycle hooks
      expect(mockBlockManager.move).toHaveBeenCalledWith(4, 1, false, true);
      expect(mockBlockManager.move).toHaveBeenCalledWith(3, 0, false, true);
      expect(result.movedBlocks).toEqual([block1, block2]);
      expect(result.targetIndex).toBe(5);
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (
  id: string,
  name: string,
  data: Record<string, unknown>,
  contentIds: string[] = [],
  parentId: string | null = null
): Block => {
  const holder = document.createElement('div');
  const block = {
    id,
    name,
    holder,
    contentIds,
    parentId,
    call: vi.fn(),
    save: vi.fn(async (): Promise<SavedData & { tunes: { [name: string]: unknown } } | undefined> => ({
      id,
      tool: name,
      data,
      time: Date.now(),
      tunes: {},
    })),
  };
  return block as unknown as Block;
}
