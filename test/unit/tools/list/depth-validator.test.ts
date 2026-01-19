/**
 * Unit tests for ListDepthValidator
 */

import { describe, it, expect } from 'vitest';
import { ListDepthValidator } from '../../../../src/tools/list/depth-validator';
import type { BlocksAPI } from '../../../../src/tools/list/marker-calculator';

describe('ListDepthValidator', () => {
  // Mock block factory
  const createMockBlock = (options: {
    name?: string;
    depth?: number;
  } = {}) => {
    const { name = 'list', depth = 0 } = options;

    const roleItem = document.createElement('div');
    roleItem.setAttribute('role', 'listitem');
    if (depth > 0) {
      roleItem.style.marginLeft = `${depth * 24}px`;
    }

    return {
      id: `block-${Math.random()}`,
      name,
      holder: {
        querySelector: (selector: string) => {
          if (selector === '[role="listitem"]') return roleItem;
          return null;
        },
      },
    };
  };

  const createMockBlocksAPI = (blocks: ReturnType<typeof createMockBlock>[]): BlocksAPI => {
    return {
      getBlockByIndex: (index: number) => blocks[index] ?? undefined,
      getBlockIndex: () => 0,
      getBlocksCount: () => blocks.length,
      getCurrentBlockIndex: () => 0,
    };
  };

  describe('getMaxAllowedDepth', () => {
    it('returns 0 for the first item (index 0)', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(0)).toBe(0);
    });

    it('returns 0 when previous block is not a list item', () => {
      const blocks = [createMockBlock({ name: 'paragraph' })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(0);
    });

    it('returns 0 when there is no previous block', () => {
      const blocks: ReturnType<typeof createMockBlock>[] = [];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Index 1 but no blocks at all
      expect(validator.getMaxAllowedDepth(1)).toBe(0);
    });

    it('returns previous.depth + 1 when previous is a list item at depth 0', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('returns previous.depth + 1 when previous is a nested list item', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
      expect(validator.getMaxAllowedDepth(2)).toBe(2);
    });

    it('returns 1 when previous is at depth 0', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('returns 2 when previous is at depth 1', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(2)).toBe(2);
    });
  });

  describe('isValidDepth', () => {
    it('returns true for depth 0 at index 0', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, 0)).toBe(true);
    });

    it('returns false for depth > 0 at index 0', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, 1)).toBe(false);
      expect(validator.isValidDepth(0, 2)).toBe(false);
    });

    it('returns true for valid depth after a list item', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(1, 0)).toBe(true);
      expect(validator.isValidDepth(1, 1)).toBe(true);
    });

    it('returns false for depth exceeding max allowed', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(1, 2)).toBe(false);
    });

    it('returns false for negative depth', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, -1)).toBe(false);
    });
  });

  describe('getTargetDepthForMove', () => {
    it('returns 0 for first position when current depth is deeper', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 2 })).toBe(0);
    });

    it('caps depth to max allowed', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Max allowed at index 1 is 1, so depth 2 should be capped to 1
      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 2 })).toBe(1);
    });

    it('matches next block depth when next is deeper and within max allowed', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Dropping at index 1 with current depth 0, next is depth 1
      // Max allowed at index 1 is 1 (previous is depth 0)
      // Should match next depth to become sibling
      const result = validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0 });
      expect(result).toBe(1);
    });

    it('does not match next depth when it exceeds max allowed', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // At index 0, max allowed is 0, so even though next is depth 1, we stay at 0
      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 0 })).toBe(0);
    });

    it('matches previous depth when previous is deeper and no next list item', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Dropping at index 2 (after the depth 1 item), current depth 0
      // Previous is depth 1, no next list item
      const result = validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 });
      expect(result).toBe(1);
    });

    it('keeps current depth when no adjustments needed', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 0 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0 })).toBe(0);
    });

    it('handles empty editor', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 0 })).toBe(0);
    });
  });

  describe('getBlockDepth', () => {
    it('returns 0 for blocks with no margin-left', () => {
      const block = createMockBlock({ depth: 0 });
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(block)).toBe(0);
    });

    it('calculates depth from margin-left', () => {
      const block = createMockBlock({ depth: 2 });
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(block)).toBe(2);
    });

    it('returns 0 for undefined block', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(undefined)).toBe(0);
    });
  });
});
