/**
 * Unit tests for ListMarkerCalculator
 */

import { describe, it, expect } from 'vitest';
import { ListMarkerCalculator } from '../../../../src/tools/list/marker-calculator';
import type { ListItemStyle } from '../../../../src/tools/list/types';

describe('ListMarkerCalculator', () => {
  // Mock block factory
  const createMockBlock = (options: {
    name?: string;
    depth?: number;
    style?: ListItemStyle;
    start?: number;
  } = {}) => {
    const { name = 'list', depth = 0, style = 'unordered', start = 1 } = options;

    const listItemEl = document.createElement('div');
    listItemEl.setAttribute('data-list-style', style);
    if (start !== 1) {
      listItemEl.setAttribute('data-list-start', String(start));
    }

    const roleItem = document.createElement('div');
    roleItem.setAttribute('role', 'listitem');
    if (depth > 0) {
      roleItem.style.marginLeft = `${depth * 24}px`;
    }
    listItemEl.appendChild(roleItem);

    return {
      id: `block-${Math.random()}`,
      name,
      holder: {
        querySelector: (selector: string) => {
          if (selector === '[data-list-style]') return listItemEl;
          if (selector === '[role="listitem"]') return roleItem;
          return null;
        },
      },
    };
  };

  const createMockBlocksAPI = (blocks: ReturnType<typeof createMockBlock>[]) => {
    return {
      getBlockByIndex: (index: number) => blocks[index] ?? null,
      getBlockIndex: () => 0,
      getBlocksCount: () => blocks.length,
      getCurrentBlockIndex: () => 0,
    };
  };

  describe('getBulletCharacter', () => {
    it('returns different bullets at different depths', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBulletCharacter(0)).toBe('•');
      expect(calc.getBulletCharacter(1)).toBe('◦');
      expect(calc.getBulletCharacter(2)).toBe('▪');
      expect(calc.getBulletCharacter(3)).toBe('•'); // Cycles
      expect(calc.getBulletCharacter(4)).toBe('◦');
      expect(calc.getBulletCharacter(5)).toBe('▪');
    });
  });

  describe('formatNumber', () => {
    it('formats numbers at different depths', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      // Depth 0, 3, 6... → decimal
      expect(calc.formatNumber(1, 0)).toBe('1.');
      expect(calc.formatNumber(5, 0)).toBe('5.');
      expect(calc.formatNumber(10, 3)).toBe('10.');

      // Depth 1, 4, 7... → alpha
      expect(calc.formatNumber(1, 1)).toBe('a.');
      expect(calc.formatNumber(26, 1)).toBe('z.');
      expect(calc.formatNumber(27, 1)).toBe('aa.');

      // Depth 2, 5, 8... → roman
      expect(calc.formatNumber(1, 2)).toBe('i.');
      expect(calc.formatNumber(5, 2)).toBe('v.');
      expect(calc.formatNumber(10, 2)).toBe('x.');
    });
  });

  describe('getSiblingIndex', () => {
    it('returns 0 for the first item', () => {
      const blocks = [createMockBlock()];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getSiblingIndex(0, 0, 'ordered')).toBe(0);
    });

    it('counts consecutive items at same depth and style', () => {
      const blocks = [
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 0, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getSiblingIndex(0, 0, 'ordered')).toBe(0);
      expect(calc.getSiblingIndex(1, 0, 'ordered')).toBe(1);
      expect(calc.getSiblingIndex(2, 0, 'ordered')).toBe(2);
    });

    it('stops counting at different style boundary', () => {
      const blocks = [
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 0, style: 'unordered' }), // Different style
        createMockBlock({ depth: 0, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getSiblingIndex(0, 0, 'ordered')).toBe(0);
      expect(calc.getSiblingIndex(2, 0, 'ordered')).toBe(0); // Reset after style break
    });

    it('skips items at deeper depths', () => {
      const blocks = [
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 1, style: 'ordered' }), // Nested
        createMockBlock({ depth: 1, style: 'ordered' }), // Nested
        createMockBlock({ depth: 0, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getSiblingIndex(0, 0, 'ordered')).toBe(0);
      expect(calc.getSiblingIndex(3, 0, 'ordered')).toBe(1);
    });

    it('stops at parent (shallower depth)', () => {
      const blocks = [
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 1, style: 'ordered' }),
        createMockBlock({ depth: 1, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      // For depth 1 item, the depth 0 item is a parent, not a sibling
      expect(calc.getSiblingIndex(2, 1, 'ordered')).toBe(1);
    });

    it('returns 0 for first block index', () => {
      const blocks = [createMockBlock()];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getSiblingIndex(0, 0, 'ordered')).toBe(0);
    });
  });

  describe('findGroupStart', () => {
    it('returns the same index when no preceding siblings exist', () => {
      const blocks = [createMockBlock({ style: 'ordered' })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findGroupStart(0, 0, 'ordered')).toBe(0);
    });

    it('finds the start of a consecutive group', () => {
      const blocks = [
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findGroupStart(2, 0, 'ordered')).toBe(0);
      expect(calc.findGroupStart(1, 0, 'ordered')).toBe(0);
    });

    it('respects style boundaries', () => {
      const blocks = [
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'unordered' }),
        createMockBlock({ style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findGroupStart(2, 0, 'ordered')).toBe(2);
    });

    it('skips deeper items when finding group start', () => {
      const blocks = [
        createMockBlock({ depth: 0, style: 'ordered' }),
        createMockBlock({ depth: 1, style: 'ordered' }),
        createMockBlock({ depth: 0, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findGroupStart(2, 0, 'ordered')).toBe(0);
    });
  });

  describe('getBlockDepth', () => {
    it('returns 0 for blocks with no margin-left', () => {
      const block = createMockBlock({ depth: 0 });
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockDepth(block)).toBe(0);
    });

    it('calculates depth from margin-left', () => {
      const block = createMockBlock({ depth: 2 });
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockDepth(block)).toBe(2);
    });

    it('returns 0 for undefined block', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockDepth(undefined)).toBe(0);
    });
  });

  describe('getBlockStyle', () => {
    it('returns the style from data-list-style attribute', () => {
      const block = createMockBlock({ style: 'ordered' });
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockStyle(block)).toBe('ordered');
    });

    it('returns null for undefined block', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockStyle(undefined)).toBeNull();
    });
  });

  describe('getBlockStartValue', () => {
    it('returns 1 for blocks without data-list-start', () => {
      const block = createMockBlock({ start: 1 });
      const blocksAPI = createMockBlocksAPI([block]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockStartValue(0)).toBe(1);
    });

    it('returns the custom start value', () => {
      const block = createMockBlock({ start: 5 });
      const blocksAPI = createMockBlocksAPI([block]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockStartValue(0)).toBe(5);
    });

    it('returns 1 for non-existent block', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getBlockStartValue(99)).toBe(1);
    });
  });

  describe('getGroupStartValue', () => {
    it('reads start value from DOM for first item (siblingIndex 0)', () => {
      const blocks = [createMockBlock({ start: 5 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getGroupStartValue(0, 0, 0, 'ordered')).toBe(5);
    });

    it('returns 1 when start value is 1 (not stored in DOM)', () => {
      const blocks = [createMockBlock({ start: 1 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getGroupStartValue(0, 0, 0, 'ordered')).toBe(1);
    });

    it('finds start value from first item in group', () => {
      const blocks = [
        createMockBlock({ start: 5, style: 'ordered' }),
        createMockBlock({ start: 1, style: 'ordered' }),
        createMockBlock({ start: 1, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getGroupStartValue(2, 0, 2, 'ordered')).toBe(5);
    });
  });

  describe('getMarkerText', () => {
    it('returns bullet for unordered lists', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 0, style: 'unordered' })).toBe('•');
      expect(calc.getMarkerText({ blockIndex: 0, depth: 1, style: 'unordered' })).toBe('◦');
    });

    it('returns numbered markers for ordered lists', () => {
      const blocks = [
        createMockBlock({ style: 'ordered', start: 1 }),
        createMockBlock({ style: 'ordered', start: 1 }),
        createMockBlock({ style: 'ordered', start: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 0, style: 'ordered' })).toBe('1.');
      expect(calc.getMarkerText({ blockIndex: 1, depth: 0, style: 'ordered' })).toBe('2.');
      expect(calc.getMarkerText({ blockIndex: 2, depth: 0, style: 'ordered' })).toBe('3.');
    });

    it('uses custom start value', () => {
      const blocks = [
        createMockBlock({ style: 'ordered', start: 5 }),
        createMockBlock({ style: 'ordered', start: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 0, style: 'ordered', start: 5 })).toBe('5.');
      expect(calc.getMarkerText({ blockIndex: 1, depth: 0, style: 'ordered' })).toBe('6.');
    });

    it('formats as alpha at depth 1', () => {
      const blocks = [
        createMockBlock({ depth: 1, style: 'ordered' }),
        createMockBlock({ depth: 1, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 1, style: 'ordered' })).toBe('a.');
      expect(calc.getMarkerText({ blockIndex: 1, depth: 1, style: 'ordered' })).toBe('b.');
    });

    it('formats as roman at depth 2', () => {
      const blocks = [
        createMockBlock({ depth: 2, style: 'ordered' }),
        createMockBlock({ depth: 2, style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 2, style: 'ordered' })).toBe('i.');
      expect(calc.getMarkerText({ blockIndex: 1, depth: 2, style: 'ordered' })).toBe('ii.');
    });

    it('respects style boundaries', () => {
      const blocks = [
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'unordered' }),
        createMockBlock({ style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.getMarkerText({ blockIndex: 0, depth: 0, style: 'ordered' })).toBe('1.');
      expect(calc.getMarkerText({ blockIndex: 2, depth: 0, style: 'ordered' })).toBe('1.'); // Reset
    });
  });

  describe('findFirstItemIndex', () => {
    it('returns index + 1 when count is 0', () => {
      const blocks = [createMockBlock()];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findFirstItemIndex(0, 0, 0, 'ordered')).toBe(1);
    });

    it('finds the first item in a consecutive group', () => {
      const blocks = [
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      // Find 2 items back from index 2 - should return index 1 (the second item)
      // because remainingCount goes 2 -> 1 -> 0, and we return index + 1 = 0 + 1 = 1
      expect(calc.findFirstItemIndex(2, 0, 2, 'ordered')).toBe(1);
    });

    it('respects style boundaries', () => {
      const blocks = [
        createMockBlock({ style: 'ordered' }),
        createMockBlock({ style: 'unordered' }),
        createMockBlock({ style: 'ordered' }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const calc = new ListMarkerCalculator(blocksAPI);

      expect(calc.findFirstItemIndex(2, 0, 1, 'ordered')).toBe(2);
    });
  });
});
