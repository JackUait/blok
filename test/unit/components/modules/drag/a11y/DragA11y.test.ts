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
    it('should announce drop position with throttling', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'bottom');

      // Before throttle timeout, no announcement yet
      expect(mockAnnouncer.announce).not.toHaveBeenCalled();

      // Fast forward to after throttle timeout
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":4,"total":1}',
        { politeness: 'polite' }
      );
    });

    it('should not announce same position twice', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'bottom');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      // Same position again
      a11y.announceDropPosition(targetBlock as Block, 'bottom');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    });

    it('should calculate correct drop index for top edge', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.dropPosition:{"position":3,"total":1}',
        { politeness: 'polite' }
      );
    });

    it('should calculate correct drop index for bottom edge', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'bottom');
      vi.advanceTimersByTime(300);

      // targetIndex 2 + 1 = 3, position is 3 + 1 = 4
      expect(mockI18n.t).toHaveBeenCalledWith('a11y.dropPosition', {
        position: 4,
        total: 1,
      });
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

      // Only one call to announce (the last one wins)
      expect(mockAnnouncer.announce).toHaveBeenCalledTimes(1);
    });

    it('should handle position changes after timeout', () => {
      const targetBlock1 = createMockBlock('target1');
      const targetBlock2 = createMockBlock('target2');

      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock1) return 0;
        if (block === targetBlock2) return 2;
        return -1;
      });
      mockBlockManager.blocks = [targetBlock1 as Block, targetBlock2 as Block];

      // First announcement
      a11y.announceDropPosition(targetBlock1 as Block, 'top');
      vi.advanceTimersByTime(300);
      vi.clearAllMocks();

      // Second announcement after first completed
      a11y.announceDropPosition(targetBlock2 as Block, 'bottom');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalledTimes(1);
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

      a11y.announceDuplicateComplete([duplicatedBlock as Block]);

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        'a11y.blockDuplicated:{"position":4}',
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

      // Reset and announce same position - should announce again
      a11y.reset();
      vi.clearAllMocks();

      a11y.announceDropPosition(targetBlock as Block, 'top');
      vi.advanceTimersByTime(300);

      expect(mockAnnouncer.announce).toHaveBeenCalled();
    });
  });

  describe('getLastAnnouncedIndex', () => {
    it('should return null before any announcement', () => {
      expect(a11y.getLastAnnouncedIndex()).toBeNull();
    });

    it('should return last announced index after announcement', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 2);
      mockBlockManager.blocks = [targetBlock as Block];

      a11y.announceDropPosition(targetBlock as Block, 'bottom');
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
