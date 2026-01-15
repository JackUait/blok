/**
 * Tests for ListItemDepth utility
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ListItemDepth } from '../../../../../../src/components/modules/drag/utils/ListItemDepth';
import type { Block } from '../../../../../../src/components/block';

describe('ListItemDepth', () => {
  let mockBlockManager: {
    blocks: Block[];
    getBlockIndex: (block: Block) => number;
    getBlockByIndex: (index: number) => Block | null;
  };
  let listItemDepth: ListItemDepth;

  // Helper to create a mock block
  const createMockBlock = (id: string, depth: number | null): Partial<Block> => {
    const holder = document.createElement('div');
    holder.setAttribute('data-blok-element', 'block');

    if (depth !== null) {
      const contentWrapper = document.createElement('div');
      contentWrapper.setAttribute('data-list-depth', String(depth));
      holder.appendChild(contentWrapper);
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

    listItemDepth = new ListItemDepth(mockBlockManager as any);
  });

  describe('getDepth', () => {
    it('should return null for non-list block', () => {
      const block = createMockBlock('para-1', null);

      expect(listItemDepth.getDepth(block as Block)).toBeNull();
    });

    it('should return depth from data-list-depth attribute', () => {
      const block = createMockBlock('list-1', 2);

      expect(listItemDepth.getDepth(block as Block)).toBe(2);
    });

    it('should return 0 when data-list-depth is "0"', () => {
      const block = createMockBlock('list-1', 0);

      expect(listItemDepth.getDepth(block as Block)).toBe(0);
    });

    it('should return 0 when data-list-depth attribute exists but is empty', () => {
      const holder = document.createElement('div');
      holder.setAttribute('data-blok-element', 'block');
      const contentWrapper = document.createElement('div');
      contentWrapper.setAttribute('data-list-depth', '');
      holder.appendChild(contentWrapper);

      const block = { id: 'test', holder } as Block;

      expect(listItemDepth.getDepth(block)).toBe(0);
    });
  });

  describe('calculateTargetDepth', () => {
    it('should return 0 for first position (top edge of first block)', () => {
      const block1 = createMockBlock('block-1', null);
      mockBlockManager.blocks = [block1 as Block];

      const depth = listItemDepth.calculateTargetDepth(block1 as Block, 'top');

      expect(depth).toBe(0);
    });

    it('should match previous block depth when dropping at bottom', () => {
      const block1 = createMockBlock('list-1', 1);
      const block2 = createMockBlock('list-2', null);

      mockBlockManager.blocks = [block1 as Block, block2 as Block];

      // Dropping at bottom of block1 means we're at index 1, previous is block1 (depth 1)
      const depth = listItemDepth.calculateTargetDepth(block1 as Block, 'bottom');

      expect(depth).toBe(1);
    });

    it('should match next block depth when next is nested', () => {
      const block1 = createMockBlock('list-1', null);
      const block2 = createMockBlock('list-2', 1);

      mockBlockManager.blocks = [block1 as Block, block2 as Block];

      // Dropping at bottom of block1 means we're before block2
      const depth = listItemDepth.calculateTargetDepth(block1 as Block, 'bottom');

      expect(depth).toBe(1);
    });

    it('should return 0 when neither previous nor next are list items', () => {
      const block1 = createMockBlock('para-1', null);
      const block2 = createMockBlock('para-2', null);

      mockBlockManager.blocks = [block1 as Block, block2 as Block];

      const depth = listItemDepth.calculateTargetDepth(block1 as Block, 'bottom');

      expect(depth).toBe(0);
    });

    it('should handle deep nesting structure', () => {
      // Structure:
      // list-1 (depth 0)
      //   list-2 (depth 1)
      //     list-3 (depth 2)
      // list-4 (depth 0)

      const list1 = createMockBlock('list-1', 0);
      const list2 = createMockBlock('list-2', 1);
      const list3 = createMockBlock('list-3', 2);
      const list4 = createMockBlock('list-4', 0);

      mockBlockManager.blocks = [
        list1 as Block,
        list2 as Block,
        list3 as Block,
        list4 as Block,
      ];

      // Drop at bottom of list2 (index 1) - next is list3 at depth 2, which is <= previousDepth + 1 (2)
      // So we match next's depth (2) to become a sibling of list3
      expect(listItemDepth.calculateTargetDepth(list2 as Block, 'bottom')).toBe(2);

      // Drop at top of list3 (index 2) - previous is list2 with depth 1, next is list3 with depth 2
      // Since nextDepth (2) > previousDepth (1) and <= previousDepth + 1 (2), we match next
      expect(listItemDepth.calculateTargetDepth(list3 as Block, 'top')).toBe(2);

      // Drop at bottom of list3 (index 2) - previous is list3 with depth 2
      expect(listItemDepth.calculateTargetDepth(list3 as Block, 'bottom')).toBe(2);
    });

    it('should limit next depth match to previous depth + 1', () => {
      // This tests the condition: nextDepth <= previousDepth + 1
      // If next is much deeper than previous, don't jump all the way down

      const list1 = createMockBlock('list-1', 0);
      const list2 = createMockBlock('list-2', null);
      const list3 = createMockBlock('list-3', 3); // Much deeper

      mockBlockManager.blocks = [
        list1 as Block,
        list2 as Block,
        list3 as Block,
      ];

      // Dropping at bottom of list2: previous has depth 0, next has depth 3
      // Since 3 > 0 + 1, we don't match next, we match previous (0)
      const depth = listItemDepth.calculateTargetDepth(list2 as Block, 'bottom');

      expect(depth).toBe(0);
    });
  });
});
