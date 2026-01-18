/**
 * Tests for DropTargetDetector
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { DropTargetDetector } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { Block } from '../../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../../src/components/constants';

describe('DropTargetDetector', () => {
  let detector: DropTargetDetector;
  let mockBlockManager: {
    getBlockByIndex: any;
    getBlockIndex: any;
    blocks: Block[];
  };
  let mockUI: { contentRect: { left: number } };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBlockManager = {
      getBlockByIndex: vi.fn(),
      getBlockIndex: vi.fn(),
      blocks: [],
    };

    mockUI = {
      contentRect: { left: 100 },
    };

    detector = new DropTargetDetector(mockUI, mockBlockManager);
  });

  describe('constructor', () => {
    it('should initialize with UI and BlockManager adapters', () => {
      expect(detector).toBeInstanceOf(DropTargetDetector);
    });
  });

  describe('setSourceBlocks', () => {
    it('should set source blocks for exclusion', () => {
      const blocks = [createMockBlock('block-1'), createMockBlock('block-2')];
      detector.setSourceBlocks(blocks as Block[]);
      // Source blocks are now set for exclusion
      expect(blocks).toHaveLength(2);
    });
  });

  describe('findDropTargetBlock', () => {
    it('should find block holder via data attribute', () => {
      const block = createMockBlock('block-1');
      mockBlockManager.blocks = [block as Block];
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index]);

      // The element itself has the data attribute (closest should return the element itself)
      const element = document.createElement('div');
      element.setAttribute(DATA_ATTR.element, 'block');
      // Add to DOM so closest can traverse
      document.body.appendChild(element);

      const result = detector.findDropTargetBlock(element, 100, 100);

      expect(result.block).toBeUndefined(); // No block in blocks array has this element as holder
      expect(result.holder).toBe(element);

      // Clean up
      document.body.removeChild(element);
    });

    it('should use left drop zone fallback when no direct holder found', () => {
      const block = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      // Setup getBoundingClientRect for vertical position check
      vi.spyOn(block2.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });

      mockBlockManager.blocks = [block as Block, block2 as Block];

      detector.setSourceBlocks([block as Block]);

      // Element without data attribute - triggers fallback
      const element = document.createElement('div');
      // Add to DOM so elementFromPoint would work in real scenario
      document.body.appendChild(element);

      const result = detector.findDropTargetBlock(element, 60, 75);

      expect(result.block).toBe(block2);
      expect(result.holder).toBe(block2.holder);

      // Clean up
      document.body.removeChild(element);
    });

    it('should return empty result when no target found', () => {
      const element = document.createElement('div');
      const result = detector.findDropTargetBlock(element, 100, 100);

      expect(result.block).toBeUndefined();
      expect(result.holder).toBeNull();
    });
  });

  describe('findBlockInLeftDropZone', () => {
    it('should return null when cursor is to the right of content', () => {
      mockUI.contentRect = { left: 100 };

      const result = detector.findBlockInLeftDropZone(150, 50);

      expect(result).toBeNull();
    });

    it('should return null when cursor is too far left', () => {
      mockUI.contentRect = { left: 100 };

      const result = detector.findBlockInLeftDropZone(40, 50); // 60px from edge, more than 50px zone

      expect(result).toBeNull();
    });

    it('should find block in left drop zone', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      vi.spyOn(block1.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });

      mockBlockManager.blocks = [block1 as Block, block2 as Block];
      mockUI.contentRect = { left: 100 };

      const result = detector.findBlockInLeftDropZone(70, 75);

      expect(result).toBe(block1);
    });

    it('should skip source blocks in left drop zone', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      vi.spyOn(block1.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });
      vi.spyOn(block2.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      mockBlockManager.blocks = [block1 as Block, block2 as Block];
      detector.setSourceBlocks([block1 as Block]);
      mockUI.contentRect = { left: 100 };

      // Cursor at block1's Y position, but block1 is a source block
      const result = detector.findBlockInLeftDropZone(70, 75);

      expect(result).toBeNull();
    });

    it('should return null when no block at Y position', () => {
      const block1 = createMockBlock('block-1');

      vi.spyOn(block1.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 100,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });

      mockBlockManager.blocks = [block1 as Block];
      mockUI.contentRect = { left: 100 };

      // Cursor at Y position with no block
      const result = detector.findBlockInLeftDropZone(70, 150);

      expect(result).toBeNull();
    });
  });

  describe('determineDropTarget', () => {
    it('should determine bottom edge of previous block for top half', () => {
      const sourceBlock = createMockBlock('source');
      const previousBlock = createMockBlock('previous');
      const targetBlock = createMockBlock('target');

      mockBlockManager.blocks = [previousBlock as Block, targetBlock as Block];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === previousBlock) return 0;
        if (block === targetBlock) return 1;
        return -1;
      });
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index]);

      // The target block's holder needs to be in the DOM for closest to work
      // and getBoundingClientRect needs to be mocked
      vi.spyOn(targetBlock.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 200,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.body.appendChild(targetBlock.holder!);

      // Create element that is inside the holder (so closest finds holder)
      const targetElement = document.createElement('div');
      targetBlock.holder!.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock as Block);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(previousBlock);
      expect(result?.edge).toBe('bottom');

      // Clean up
      document.body.removeChild(targetBlock.holder!);
    });

    it('should determine top edge for first block', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      mockBlockManager.blocks = [targetBlock as Block];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index]);

      vi.spyOn(targetBlock.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 200,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.body.appendChild(targetBlock.holder!);

      const targetElement = document.createElement('div');
      targetBlock.holder!.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock as Block);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(targetBlock);
      expect(result?.edge).toBe('top');

      // Clean up
      document.body.removeChild(targetBlock.holder!);
    });

    it('should determine bottom edge for bottom half of block', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      mockBlockManager.blocks = [targetBlock as Block];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index]);

      vi.spyOn(targetBlock.holder as any, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 200,
        left: 0,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      document.body.appendChild(targetBlock.holder!);

      const targetElement = document.createElement('div');
      targetBlock.holder!.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 170, sourceBlock as Block);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(targetBlock);
      expect(result?.edge).toBe('bottom');

      // Clean up
      document.body.removeChild(targetBlock.holder!);
    });

    it('should return null when target is source block', () => {
      const sourceBlock = createMockBlock('source');

      mockBlockManager.blocks = [sourceBlock as Block];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);

      const targetElement = document.createElement('div');
      targetElement.setAttribute(DATA_ATTR.element, 'block');

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock as Block);

      expect(result).toBeNull();
    });

    it('should return null when target is in source blocks', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      detector.setSourceBlocks([sourceBlock as Block, targetBlock as Block]);
      mockBlockManager.blocks = [sourceBlock as Block, targetBlock as Block];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock) return 1;
        return 0;
      });

      const targetElement = document.createElement('div');
      targetElement.setAttribute(DATA_ATTR.element, 'block');

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock as Block);

      expect(result).toBeNull();
    });
  });

  describe('calculateTargetDepth', () => {
    it('should return 0 for first position', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'top');

      expect(depth).toBe(0);
    });

    it('should return 0 when no previous block', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn(() => undefined);

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'bottom');

      expect(depth).toBe(0);
    });

    it('should match next depth when next is nested and within range', () => {
      const previousBlock = createMockListBlock('prev', 1);
      const nextBlock = createMockListBlock('next', 2);
      const targetBlock = createMockBlock('target');

      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        if (index === 0) return previousBlock;
        if (index === 1) return nextBlock;
        return undefined;
      });

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'top');

      expect(depth).toBe(2);
    });

    it('should not match next depth when it exceeds previous depth + 1', () => {
      const previousBlock = createMockListBlock('prev', 1);
      const nextBlock = createMockListBlock('next', 5); // Much deeper
      const targetBlock = createMockBlock('target');

      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        if (index === 0) return previousBlock;
        if (index === 1) return nextBlock;
        return undefined;
      });

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'top');

      // Should match previous depth since next is too deep
      expect(depth).toBe(1);
    });

    it('should match previous depth when previous is nested', () => {
      const previousBlock = createMockListBlock('prev', 2);
      const targetBlock = createMockBlock('target');

      // targetBlock is at index 1
      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        // When dropIndex is 2 (target at index 1, bottom edge), we look up:
        // - previousBlock at index 1 (dropIndex - 1)
        // - nextBlock at index 2 (dropIndex)
        if (index === 1) return previousBlock;
        return undefined;
      });

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'bottom');

      expect(depth).toBe(2);
    });

    it('should return 0 when neither previous nor next are list items', () => {
      const previousBlock = createMockBlock('prev'); // No list depth
      const targetBlock = createMockBlock('target');

      mockBlockManager.getBlockIndex = vi.fn(() => 1);
      mockBlockManager.getBlockByIndex = vi.fn((index) => {
        if (index === 0) return previousBlock;
        return undefined;
      });

      const depth = detector.calculateTargetDepth(targetBlock as Block, 'bottom');

      expect(depth).toBe(0);
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (id: string): Partial<Block> => {
  const holder = document.createElement('div');
  holder.setAttribute(DATA_ATTR.element, 'block');

  return {
    id,
    holder,
    name: 'paragraph',
    stretched: false,
  } as Block;
};

/**
 * Helper to create a mock list block with depth
 */
const createMockListBlock = (id: string, depth: number): Partial<Block> => {
  const holder = document.createElement('div');
  holder.setAttribute(DATA_ATTR.element, 'block');

  const listWrapper = document.createElement('div');
  listWrapper.setAttribute('data-list-depth', String(depth));
  holder.appendChild(listWrapper);

  return {
    id,
    holder,
    name: 'list',
    stretched: false,
  } as Block;
};
