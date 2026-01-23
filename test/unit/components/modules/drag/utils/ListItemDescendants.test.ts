/**
 * Tests for ListItemDescendants utility
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ListItemDescendants, type BlockManagerAdapter } from '../../../../../../src/components/modules/drag/utils/ListItemDescendants';
import type { Block } from '../../../../../../src/components/block';

describe('ListItemDescendants', () => {
  let mockBlockManager: BlockManagerAdapter;
  let listItemDescendants: ListItemDescendants;

  // Helper to create a mock block
  const createMockBlock = (id: string, depth: number | null): Partial<Block> => {
    const holder = document.createElement('div');
    holder.setAttribute('data-blok-element', 'block');

    if (depth !== null) {
      // For list items, the data-list-depth is on the holder element itself
      holder.setAttribute('data-list-depth', String(depth));
    }

    return {
      id,
      holder,
    } as Block;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock BlockManager
    mockBlockManager = {
      blocks: [] as Block[],
      getBlockIndex: vi.fn((block: Block) => {
        return mockBlockManager.blocks.findIndex(b => b.id === block.id);
      }),
      getBlockByIndex: vi.fn((index: number) => {
        return mockBlockManager.blocks[index] || null;
      }),
    };

    listItemDescendants = new ListItemDescendants(mockBlockManager);
  });

  describe('getDescendants', () => {
    it('should return empty array for non-list block', () => {
      const block = createMockBlock('para-1', null);

      const descendants = listItemDescendants.getDescendants(block as Block);

      expect(descendants).toEqual([]);
    });

    it('should return empty array for list item with no descendants', () => {
      const block1 = createMockBlock('list-1', 0);
      const block2 = createMockBlock('para-1', null); // Not a list item

      mockBlockManager.blocks = [block1 as Block, block2 as Block];

      const descendants = listItemDescendants.getDescendants(block1 as Block);

      expect(descendants).toEqual([]);
    });

    it('should collect direct children (depth + 1)', () => {
      const parent = createMockBlock('list-1', 0);
      const child1 = createMockBlock('list-2', 1);
      const child2 = createMockBlock('list-3', 1);
      const unrelated = createMockBlock('para-1', null);

      mockBlockManager.blocks = [
        parent as Block,
        child1 as Block,
        child2 as Block,
        unrelated as Block,
      ];

      const descendants = listItemDescendants.getDescendants(parent as Block);

      expect(descendants).toHaveLength(2);
      expect(descendants[0].id).toBe('list-2');
      expect(descendants[1].id).toBe('list-3');
    });

    it('should collect grandchildren (depth + 2)', () => {
      const parent = createMockBlock('list-1', 0);
      const child = createMockBlock('list-2', 1);
      const grandchild = createMockBlock('list-3', 2);

      mockBlockManager.blocks = [
        parent as Block,
        child as Block,
        grandchild as Block,
      ];

      const descendants = listItemDescendants.getDescendants(parent as Block);

      expect(descendants).toHaveLength(2);
      expect(descendants.map(d => d.id)).toEqual(['list-2', 'list-3']);
    });

    it('should stop at sibling (same depth)', () => {
      const block1 = createMockBlock('list-1', 0);
      const block2 = createMockBlock('list-2', 1); // Child of block1
      const block3 = createMockBlock('list-3', 0); // Sibling of block1, should stop here

      mockBlockManager.blocks = [
        block1 as Block,
        block2 as Block,
        block3 as Block,
      ];

      const descendants = listItemDescendants.getDescendants(block1 as Block);

      expect(descendants).toHaveLength(1);
      expect(descendants[0].id).toBe('list-2');
    });

    it('should stop at parent (shallower depth)', () => {
      const block1 = createMockBlock('list-1', 1); // Nested at depth 1
      const block2 = createMockBlock('list-2', 2); // Child of block1
      const block3 = createMockBlock('list-3', 0); // Shallower than block1

      mockBlockManager.blocks = [
        block1 as Block,
        block2 as Block,
        block3 as Block,
      ];

      const descendants = listItemDescendants.getDescendants(block1 as Block);

      expect(descendants).toHaveLength(1);
      expect(descendants[0].id).toBe('list-2');
    });

    it('should handle complex nested structure', () => {
      // Structure:
      // list-1 (depth 0)
      //   list-2 (depth 1)
      //     list-3 (depth 2)
      //   list-4 (depth 1) - sibling of list-2, still a descendant of list-1
      // list-5 (depth 0) - sibling of list-1, should stop here

      const list1 = createMockBlock('list-1', 0);
      const list2 = createMockBlock('list-2', 1);
      const list3 = createMockBlock('list-3', 2);
      const list4 = createMockBlock('list-4', 1);
      const list5 = createMockBlock('list-5', 0);

      mockBlockManager.blocks = [
        list1 as Block,
        list2 as Block,
        list3 as Block,
        list4 as Block,
        list5 as Block,
      ];

      const descendants = listItemDescendants.getDescendants(list1 as Block);

      // list-2, list-3, and list-4 are all descendants (depth > 0)
      // list-5 is at depth 0, which is not > parentDepth (0), so it stops
      expect(descendants).toHaveLength(3);
      expect(descendants.map(d => d.id)).toEqual(['list-2', 'list-3', 'list-4']);
    });

    it('should handle non-list items mixed with list items', () => {
      const list1 = createMockBlock('list-1', 0);
      const para1 = createMockBlock('para-1', null); // No depth attribute
      const list2 = createMockBlock('list-2', 1);

      mockBlockManager.blocks = [
        list1 as Block,
        para1 as Block,
        list2 as Block,
      ];

      const descendants = listItemDescendants.getDescendants(list1 as Block);

      // Should stop at para1 since it has no depth attribute (null)
      expect(descendants).toEqual([]);
    });
  });
});
