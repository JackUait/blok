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
      let sourceIndex = 0;

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return sourceIndex;
        if (block === targetBlock) return 2;

        return -1;
      });
      mockBlockManager.move = vi.fn((toIndex) => {
        sourceIndex = toIndex;
      });

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
      let sourceIndex = 5;

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return sourceIndex;
        if (block === targetBlock) return 2;

        return -1;
      });
      mockBlockManager.move = vi.fn((toIndex) => {
        sourceIndex = toIndex;
      });

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

    /**
     * Regression: alt-drag duplicate used to pass `saved.data` to `insert()` by
     * reference. Tools whose save() returns nested arrays/objects straight from
     * their internal state (e.g. table.content) would then share those nested
     * structures between the original and the duplicate — mutating one would
     * silently corrupt the other until the next save cycle.
     *
     * The fix deep-clones `saved.data` and `saved.tunes` before insert so the
     * duplicate is fully independent.
     */
    it('deep-clones nested data so the duplicate does not share references with the source', async () => {
      const sourceBlock = createMockBlock('source', 'table', {});
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      const newBlock = createMockBlock('new-1', 'table', {});

      const sharedContent = [[{ blocks: ['p-1'] }, { blocks: ['p-2'] }]];
      const sharedTune = { nested: { value: 'original' } };

      sourceBlock.save = vi.fn(async () => ({
        id: 'source',
        tool: 'table',
        data: { content: sharedContent },
        time: Date.now(),
        tunes: sharedTune,
      }));

      let capturedConfig: { data: Record<string, unknown>; tunes: Record<string, unknown> } | null = null;

      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.insert = vi.fn((config) => {
        capturedConfig = config;

        return newBlock;
      });

      await operations.duplicateBlocks([sourceBlock], targetBlock, 'bottom');

      expect(capturedConfig).not.toBeNull();

      const captured = capturedConfig as unknown as {
        data: { content: unknown };
        tunes: { nested: unknown };
      };

      // Reference identity: the duplicate must NOT share nested objects with the source.
      expect(captured.data.content).not.toBe(sharedContent);
      expect(captured.tunes.nested).not.toBe(sharedTune.nested);

      // Value equality: the duplicate must still carry the same content.
      expect(captured.data.content).toEqual(sharedContent);
      expect(captured.tunes.nested).toEqual(sharedTune.nested);

      // Mutation isolation: mutating the duplicate must not reach the source.
      (captured.data.content as Array<Array<{ blocks: string[] }>>)[0][0].blocks.push('p-EVIL');
      (captured.tunes.nested as { value: string }).value = 'mutated';

      expect(sharedContent[0][0].blocks).toEqual(['p-1']);
      expect(sharedTune.nested.value).toBe('original');
    });
  });

  describe('moveBlocks - stale source/target (regression)', () => {
    it('should abort without moving any block when sourceBlock is no longer in array', () => {
      const staleSource = createMockBlock('stale', 'paragraph', { text: 'stale' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      // sourceBlock was replaced mid-drag (Yjs sync / conversion / update).
      // getBlockIndex returns -1 for the stale reference; target is healthy.
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === staleSource) return -1;
        if (block === targetBlock) return 3;

        return -1;
      });

      const result = operations.moveBlocks([staleSource], targetBlock, 'bottom');

      // Must NOT call move — calling move(toIndex, -1) would splice the last
      // block (JS Array.splice(-1, 1) removes tail) and drop a completely
      // unrelated block. This is the reported wrong-block-dropped bug.
      expect(mockBlockManager.move).not.toHaveBeenCalled();
      expect(result.movedBlocks).toEqual([]);
    });

    it('should abort when targetBlock is no longer in array', () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const staleTarget = createMockBlock('stale-target', 'paragraph', { text: 'stale' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 2;
        if (block === staleTarget) return -1;

        return -1;
      });

      const result = operations.moveBlocks([sourceBlock], staleTarget, 'top');

      expect(mockBlockManager.move).not.toHaveBeenCalled();
      expect(result.movedBlocks).toEqual([]);
    });

    it('should abort multi-block move when any source is stale', () => {
      const block1 = createMockBlock('b1', 'paragraph', { text: '1' });
      const staleBlock = createMockBlock('stale', 'paragraph', { text: 'stale' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === staleBlock) return -1;
        if (block === targetBlock) return 4;

        return -1;
      });

      const result = operations.moveBlocks([block1, staleBlock], targetBlock, 'bottom');

      expect(mockBlockManager.move).not.toHaveBeenCalled();
      expect(result.movedBlocks).toEqual([]);
    });
  });

  describe('duplicateBlocks - stale source/target (regression)', () => {
    it('should abort alt+drag without inserting when targetBlock is no longer in array', async () => {
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const staleTarget = createMockBlock('stale-target', 'paragraph', { text: 'stale' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 2;
        if (block === staleTarget) return -1;

        return -1;
      });

      const result = await operations.duplicateBlocks([sourceBlock], staleTarget, 'top');

      // Without this guard, targetIndex=-1 produces baseInsertIndex=-1 (or 0 for bottom).
      // Blocks.insert(-1, block) splices at -1, placing block BEFORE the last element and
      // diverging the array from the DOM — the next move operation then splices the wrong
      // block. Must abort cleanly instead.
      expect(mockBlockManager.insert).not.toHaveBeenCalled();
      expect(result.duplicatedBlocks).toEqual([]);
    });

    it('should abort alt+drag when any sourceBlock is stale', async () => {
      const block1 = createMockBlock('b1', 'paragraph', { text: '1' });
      const staleBlock = createMockBlock('stale', 'paragraph', { text: 'stale' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === block1) return 0;
        if (block === staleBlock) return -1;
        if (block === targetBlock) return 4;

        return -1;
      });

      const result = await operations.duplicateBlocks(
        [block1, staleBlock],
        targetBlock,
        'bottom'
      );

      expect(mockBlockManager.insert).not.toHaveBeenCalled();
      expect(result.duplicatedBlocks).toEqual([]);
    });

    it('should abort alt+drag when targetBlock becomes stale during async save', async () => {
      // Regression: Layer 9 only checks getBlockIndex BEFORE block.save() is awaited.
      // Between the guard and the insert call, the blocks array can mutate (yjs remote
      // update, undo, tool conversion), invalidating baseInsertIndex captured pre-save.
      // Insert at a stale index silently diverges array from DOM — next move drops
      // the wrong block.
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      let targetAlive = true;

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 2;
        if (block === targetBlock) return targetAlive ? 4 : -1;

        return -1;
      });

      // Simulate mid-drag mutation: target is removed between guard and insert
      (sourceBlock.save as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        targetAlive = false;

        return {
          id: 'source',
          tool: 'paragraph',
          data: { text: 'source' },
          time: Date.now(),
          tunes: {},
        };
      });

      const result = await operations.duplicateBlocks([sourceBlock], targetBlock, 'bottom');

      expect(mockBlockManager.insert).not.toHaveBeenCalled();
      expect(result.duplicatedBlocks).toEqual([]);
    });

    it('should recompute baseInsertIndex after save when target has moved', async () => {
      // Even if target is still alive, its index can shift during save (e.g. blocks
      // inserted/removed before it by a concurrent yjs update). Pre-save capture would
      // insert at the wrong absolute position; post-save recomputation uses the live
      // index.
      const sourceBlock = createMockBlock('source', 'paragraph', { text: 'source' });
      const targetBlock = createMockBlock('target', 'paragraph', { text: 'target' });
      let targetIndex = 4;

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === sourceBlock) return 2;
        if (block === targetBlock) return targetIndex;

        return -1;
      });

      mockBlockManager.insert = vi.fn((config) => {
        return createMockBlock(`dup-${config.index}`, 'paragraph', { text: 'dup' });
      });

      (sourceBlock.save as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        // Two blocks were inserted before target during save — target shifted 4 → 6
        targetIndex = 6;

        return {
          id: 'source',
          tool: 'paragraph',
          data: { text: 'source' },
          time: Date.now(),
          tunes: {},
        };
      });

      await operations.duplicateBlocks([sourceBlock], targetBlock, 'bottom');

      // edge=bottom → insert at targetIndex + 1 = 7 (NOT the pre-save 5)
      expect(mockBlockManager.insert).toHaveBeenCalledWith(
        expect.objectContaining({ index: 7 })
      );
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
