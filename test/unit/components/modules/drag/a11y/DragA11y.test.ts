/**
 * Tests for DragA11y
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DragA11y } from '../../../../../../src/components/modules/drag/a11y/DragA11y';
import type { Block } from '../../../../../../src/components/block';

describe('DragA11y', () => {
  let a11y: DragA11y;
  let mockBlockManager: {
    getBlockIndex: (block: Block) => number;
    blocks: Block[];
  };
  let mockI18n: {
    t: (key: string, params?: Record<string, number | string>) => string;
  };
  let mockAnnouncer: {
    announce: (message: string, options?: { politeness: 'polite' | 'assertive' }) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockBlockManager = {
      getBlockIndex: vi.fn(),
      blocks: [],
    };

    mockI18n = {
      t: vi.fn((key, params) => `${key}:${JSON.stringify(params ?? {})}`),
    };

    mockAnnouncer = {
      announce: vi.fn(),
    };

    a11y = new DragA11y(mockBlockManager, mockI18n, mockAnnouncer);
  });

  const setBlockOrder = (...blocks: Block[]): void => {
    mockBlockManager.blocks = blocks;
    mockBlockManager.getBlockIndex = vi.fn(
      (block: Block) => mockBlockManager.blocks.indexOf(block)
    );
  };

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with adapters', () => {
      expect(a11y).toBeInstanceOf(DragA11y);
    });
  });

  describe('announceDropPosition', () => {
    it.each([
      {
        name: 'single source before target',
        order: ['S', 'A', 'T', 'B', 'C'],
        sources: ['S'],
        expectedPosition: 3,
      },
      {
        name: 'single source after target',
        order: ['A', 'T', 'B', 'S', 'C'],
        sources: ['S'],
        expectedPosition: 3,
      },
      {
        name: 'multiple sources before target',
        order: ['S1', 'S2', 'A', 'T', 'B', 'C'],
        sources: ['S1', 'S2'],
        expectedPosition: 3,
      },
      {
        name: 'multiple sources after target',
        order: ['A', 'T', 'B', 'S1', 'S2', 'C'],
        sources: ['S1', 'S2'],
        expectedPosition: 3,
      },
      {
        name: 'single source before bottom-most target',
        order: ['S', 'A', 'B', 'T'],
        sources: ['S'],
        expectedPosition: 4,
      },
      {
        name: 'multiple sources before bottom-most target',
        order: ['S1', 'S2', 'A', 'T'],
        sources: ['S1', 'S2'],
        expectedPosition: 3,
      },
    ])('announces the eventual first moved position for $name', ({ order, sources, expectedPosition }) => {
      const byId = new Map(order.map(id => [id, createMockBlock(id) as Block]));

      mockBlockManager.blocks = order.map(id => byId.get(id)!);
      mockBlockManager.getBlockIndex = vi.fn(
        (block: Block) => mockBlockManager.blocks.indexOf(block)
      );

      a11y.announceDropPosition(
        byId.get('T')!,
        'bottom',
        sources.map(id => byId.get(id)!)
      );
      vi.advanceTimersByTime(300);

      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropPosition', {
        position: expectedPosition,
        total: order.length,
      });
      expect(a11y.getLastAnnouncedIndex()).toBe(expectedPosition - 1);
    });

    it('keeps the raw insertion position for duplicate previews because sources are not removed', () => {
      const source = createMockBlock('source') as Block;
      const target = createMockBlock('target') as Block;

      mockBlockManager.blocks = [source, target];
      mockBlockManager.getBlockIndex = vi.fn(
        (block: Block) => mockBlockManager.blocks.indexOf(block)
      );

      a11y.announceDropPosition(target, 'bottom', [source], true);
      vi.advanceTimersByTime(300);

      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropPosition', {
        position: 3,
        total: 3,
      });
    });

    it('does not announce a duplicate preview when a source is stale', () => {
      const staleSource = createMockBlock('stale-source') as Block;
      const target = createMockBlock('target') as Block;

      setBlockOrder(target);
      a11y.announceDropPosition(target, 'bottom', [staleSource], true);
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
      expect(mockI18n.t).not.toHaveBeenCalled();
    });

    it('does not announce a duplicate preview for an empty source group', () => {
      const target = createMockBlock('target') as Block;

      setBlockOrder(target);
      a11y.announceDropPosition(target, 'bottom', [], true);
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
      expect(mockI18n.t).not.toHaveBeenCalled();
    });

    it('should announce drop position with throttling', () => {
      const before1 = createMockBlock('before-1') as Block;
      const before2 = createMockBlock('before-2') as Block;
      const targetBlock = createMockBlock('target') as Block;

      setBlockOrder(before1, before2, targetBlock);
      a11y.announceDropPosition(targetBlock, 'bottom');

      // Before throttle timeout, no announcement yet
      expect(mockAnnouncer.announce).not.toHaveBeenCalled();

      // Fast forward to after throttle timeout
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":4,"total":3}',
        { politeness: 'polite' }
      );
    });

    it('should not announce same position twice', () => {
      const targetBlock = createMockBlock('target') as Block;

      setBlockOrder(
        createMockBlock('before-1') as Block,
        createMockBlock('before-2') as Block,
        targetBlock
      );
      a11y.announceDropPosition(targetBlock, 'bottom');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      // Same position again
      a11y.announceDropPosition(targetBlock, 'bottom');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });

    it('should calculate correct drop index for top edge', () => {
      const targetBlock = createMockBlock('target') as Block;

      setBlockOrder(
        createMockBlock('before-1') as Block,
        createMockBlock('before-2') as Block,
        targetBlock
      );
      a11y.announceDropPosition(targetBlock, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":3,"total":3}',
        { politeness: 'polite' }
      );
    });

    it('should calculate correct drop index for bottom edge', () => {
      const targetBlock = createMockBlock('target') as Block;

      setBlockOrder(
        createMockBlock('before-1') as Block,
        createMockBlock('before-2') as Block,
        targetBlock
      );
      a11y.announceDropPosition(targetBlock, 'bottom');
      vi.advanceTimersByTime(300);

      // targetIndex 2 + 1 = 3, position is 3 + 1 = 4
      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropPosition', {
        position: 4,
        total: 3,
      });
    });

    it('does not announce a stale target that is no longer in the block array', () => {
      const staleTarget = createMockBlock('stale-target') as Block;

      setBlockOrder(createMockBlock('live') as Block);
      a11y.announceDropPosition(staleTarget, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
      expect(mockI18n.t).not.toHaveBeenCalled();
    });

    it('should throttle rapid position changes', () => {
      const targetBlock1 = createMockBlock('target1');
      const targetBlock2 = createMockBlock('target2');

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock1) return 0;
        if (block === targetBlock2) return 1;
        return -1;
      });
      mockBlockManager.blocks = [targetBlock1 as Block, targetBlock2 as Block];

      // First announcement
      a11y.announceDropPosition(targetBlock1 as Block, 'top');

      // Second announcement before timeout - should only schedule once
      a11y.announceDropPosition(targetBlock2 as Block, 'bottom');

      vi.advanceTimersByTime(300);

      // Only one announcement should be made (the last one wins)
      expect(mockAnnouncer.announce).toHaveBeenCalledTimes(1);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":3,"total":2}',
        { politeness: 'polite' }
      );
    });

    it('should not fire a stale pending announcement after returning to the last-announced position within the throttle window', () => {
      const targetBlock1 = createMockBlock('target1');
      const targetBlock2 = createMockBlock('target2');

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock1) return 0;
        if (block === targetBlock2) return 1;
        return -1;
      });
      mockBlockManager.blocks = [targetBlock1 as Block, targetBlock2 as Block];

      // Announce position over block 1 and let it fire.
      a11y.announceDropPosition(targetBlock1 as Block, 'top');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      // Within the next throttle window: move to block 2, then BACK to block 1
      // (the last-announced position). The pending block-2 announcement is now
      // stale and must not fire.
      a11y.announceDropPosition(targetBlock2 as Block, 'top');
      a11y.announceDropPosition(targetBlock1 as Block, 'top');

      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });

    it('should announce the latest position when moving away, back, and away again within the throttle window', () => {
      const targetBlock1 = createMockBlock('target1');
      const targetBlock2 = createMockBlock('target2');
      const targetBlock3 = createMockBlock('target3');

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock1) return 0;
        if (block === targetBlock2) return 1;
        if (block === targetBlock3) return 2;
        return -1;
      });
      mockBlockManager.blocks = [targetBlock1 as Block, targetBlock2 as Block, targetBlock3 as Block];

      a11y.announceDropPosition(targetBlock1 as Block, 'top');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      // 1 → 2 → 1 → 3 within the window: only the final position (block 3) fires.
      a11y.announceDropPosition(targetBlock2 as Block, 'top');
      a11y.announceDropPosition(targetBlock1 as Block, 'top');
      a11y.announceDropPosition(targetBlock3 as Block, 'top');

      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledTimes(1);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":3,"total":3}',
        { politeness: 'polite' }
      );
    });

    it('should handle position changes after timeout', () => {
      const targetBlock1 = createMockBlock('target1') as Block;
      const middleBlock = createMockBlock('middle') as Block;
      const targetBlock2 = createMockBlock('target2') as Block;

      setBlockOrder(targetBlock1, middleBlock, targetBlock2);

      // First announcement
      a11y.announceDropPosition(targetBlock1, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":1,"total":3}',
        { politeness: 'polite' }
      );

      // Second announcement after first completed
      a11y.announceDropPosition(targetBlock2, 'bottom');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":4,"total":3}',
        { politeness: 'polite' }
      );
    });
  });

  describe('announceDropPosition - column drops', () => {
    it('does not announce a column drop for a stale target', () => {
      const staleTarget = createMockBlock('stale-target') as Block;

      setBlockOrder(createMockBlock('live') as Block);
      a11y.announceDropPosition(staleTarget, 'left');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
      expect(mockI18n.t).not.toHaveBeenCalled();
    });

    it('should announce creating a column to the left, throttled', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'left');

      // Throttled: nothing announced before the timeout
      expect(mockAnnouncer.announce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);

      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropCreateColumnLeft');
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropCreateColumnLeft:{}',
        { politeness: 'polite' }
      );
    });

    it('should announce creating a column to the right, throttled', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'right');
      vi.advanceTimersByTime(300);

      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropCreateColumnRight');
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropCreateColumnRight:{}',
        { politeness: 'polite' }
      );
    });

    it('should not announce the same column edge twice', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'left');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      a11y.announceDropPosition(targetBlock as Block, 'left');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });
  });

  describe('announceDropComplete', () => {
    it('should announce single block moved', () => {
      const sourceBlock = createMockBlock('source');
      mockBlockManager.getBlockIndex = vi.fn(() => 3);
      mockBlockManager.blocks = [
        sourceBlock as Block,
        createMockBlock('other') as Block,
        createMockBlock('other2') as Block,
      ];

      a11y.announceDropComplete(sourceBlock as Block, [sourceBlock as Block], false);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.blockMoved:{"position":4,"total":3}',
        { politeness: 'assertive' }
      );
    });

    it('should announce multiple blocks moved', () => {
      const sourceBlock = createMockBlock('source');
      const sourceBlock2 = createMockBlock('source2');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [sourceBlock as Block, sourceBlock2 as Block];

      a11y.announceDropComplete(sourceBlock as Block, [sourceBlock as Block, sourceBlock2 as Block], true);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.blocksMoved:{"count":2,"position":3}',
        { politeness: 'assertive' }
      );
    });
  });

  describe('announceDuplicateComplete', () => {
    it('should announce single block duplicated', () => {
      const duplicatedBlock = createMockBlock('duplicated');
      mockBlockManager.getBlockIndex = vi.fn(() => 3);
      mockBlockManager.blocks = [
        createMockBlock('existing-1') as Block,
        createMockBlock('existing-2') as Block,
        createMockBlock('existing-3') as Block,
        duplicatedBlock as Block,
      ];

      a11y.announceDuplicateComplete([duplicatedBlock as Block]);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.blockDuplicated:{"position":4,"total":4}',
        { politeness: 'assertive' }
      );
    });

    it('should announce multiple blocks duplicated', () => {
      const duplicatedBlock1 = createMockBlock('dup1');
      const duplicatedBlock2 = createMockBlock('dup2');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);

      a11y.announceDuplicateComplete([duplicatedBlock1 as Block, duplicatedBlock2 as Block]);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.blocksDuplicated:{"count":2,"position":3}',
        { politeness: 'assertive' }
      );
    });

    it('should not announce if no blocks duplicated', () => {
      a11y.announceDuplicateComplete([]);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should clear timeout', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'top');

      // Reset before timeout
      a11y.reset();
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });

    it('should reset announcement state', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":1,"total":1}',
        { politeness: 'polite' }
      );

      // Reset and announce same position - should announce again
      a11y.reset();
      vi.clearAllMocks();

      a11y.announceDropPosition(targetBlock as Block, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":1,"total":1}',
        { politeness: 'polite' }
      );
    });
  });

  describe('getLastAnnouncedIndex', () => {
    it('should return null before any announcement', () => {
      expect(a11y.getLastAnnouncedIndex()).toBeNull();
    });

    it('should return last announced index after announcement', () => {
      const targetBlock = createMockBlock('target') as Block;

      setBlockOrder(
        createMockBlock('before-1') as Block,
        createMockBlock('before-2') as Block,
        targetBlock
      );
      a11y.announceDropPosition(targetBlock, 'bottom');
      vi.advanceTimersByTime(300);

      // dropIndex = 2 + 1 = 3
      expect(a11y.getLastAnnouncedIndex()).toBe(3);
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (id: string): Partial<Block> => {
  return {
    id,
    name: 'paragraph',
    holder: document.createElement('div'),
  } as Block;
}
