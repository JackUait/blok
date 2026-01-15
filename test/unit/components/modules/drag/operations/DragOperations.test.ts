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
      transactMoves: vi.fn((fn) => fn()),
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
      const movedBlock = createMockBlock('moved', 'paragraph', { text: 'moved' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 0;
        if (block === targetBlock) return 2;
        return -1;
      });

      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        if (index === 2) return movedBlock; // After move, block is at index 2
        return undefined;
      });

      const result = operations.moveBlocks([sourceBlock], targetBlock, 'bottom');

      // targetIndex(2) + 1 = 3, but source is at 0 which is < 3, so toIndex = 3 - 1 = 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 0, false);
      expect(mockBlockSelection.selectBlock).toHaveBeenCalledWith(movedBlock);
      expect(result.movedBlocks).toEqual([movedBlock]);
      expect(result.targetIndex).toBe(2);
    });

    it('should move block to top of target', () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const movedBlock = createMockBlock('moved', 'paragraph', { text: 'moved' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 5;
        if (block === targetBlock) return 2;
        return -1;
      });

      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        if (index === 2) return movedBlock;
        return undefined;
      });

      const result = operations.moveBlocks([sourceBlock], targetBlock, 'top');

      // targetIndex(2), source is at 5 which is >= 2, so toIndex = 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 5, false);
      expect(result.movedBlocks).toEqual([movedBlock]);
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

      // Moving down: insertIndex = 5, reverse order
      expect(mockBlockManager.move).toHaveBeenCalledWith(4, 1, false); // block2 to position 4
      expect(mockBlockManager.move).toHaveBeenCalledWith(3, 0, false); // block1 to position 3
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

      // Moving up: insertIndex = 2, maintain order
      expect(mockBlockManager.move).toHaveBeenCalledWith(2, 5, false); // block1 to position 2
      expect(mockBlockManager.move).toHaveBeenCalledWith(3, 6, false); // block2 to position 3
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

      mockBlockManager.insert = vi.fn((config) => {
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

      ops.moveBlocks([block1, block2], targetBlock, 'bottom');

      // Moves should still be executed
      expect(mockBlockManager.move).toHaveBeenCalled();
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (id: string, name: string, data: Record<string, unknown>): Block => {
  const holder = document.createElement('div');
  const block = {
    id,
    name,
    holder,
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
