/**
 * Tests for DropTargetDetector
 */

import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
import { DropTargetDetector } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';
import type { Block } from '../../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../../src/components/constants';
import type { BlockManagerAdapter } from '../../../../../../src/components/modules/drag/target/DropTargetDetector';

describe('DropTargetDetector', () => {
  let detector: DropTargetDetector;
  let mockBlockManager: BlockManagerAdapter & {
    getBlockByIndex: Mock<(index: number) => Block | undefined>;
    getBlockIndex: Mock<(block: Block) => number>;
  };
  let mockUI: { contentRect: { left: number } };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBlockManager = {
      getBlockByIndex: vi.fn(),
      getBlockIndex: vi.fn(),
      getBlockById: vi.fn(),
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
      detector.setSourceBlocks(blocks);
      // Source blocks are now set for exclusion
      expect(blocks).toHaveLength(2);
    });
  });

  describe('findDropTargetBlock', () => {
    it('should find block holder via data attribute', () => {
      const block = createMockBlock('block-1');
      mockBlockManager.blocks = [block];
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

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
      vi.spyOn(block2.holder, 'getBoundingClientRect').mockReturnValue({
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

      mockBlockManager.blocks = [block, block2];

      detector.setSourceBlocks([block]);

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

      vi.spyOn(block1.holder, 'getBoundingClientRect').mockReturnValue({
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

      mockBlockManager.blocks = [block1, block2];
      mockUI.contentRect = { left: 100 };

      const result = detector.findBlockInLeftDropZone(70, 75);

      expect(result).toBe(block1);
    });

    it('should skip source blocks in left drop zone', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      vi.spyOn(block1.holder, 'getBoundingClientRect').mockReturnValue({
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
      vi.spyOn(block2.holder, 'getBoundingClientRect').mockReturnValue({
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

      mockBlockManager.blocks = [block1, block2];
      detector.setSourceBlocks([block1]);
      mockUI.contentRect = { left: 100 };

      // Cursor at block1's Y position, but block1 is a source block
      const result = detector.findBlockInLeftDropZone(70, 75);

      expect(result).toBeNull();
    });

    it('should return null when no block at Y position', () => {
      const block1 = createMockBlock('block-1');

      vi.spyOn(block1.holder, 'getBoundingClientRect').mockReturnValue({
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

      mockBlockManager.blocks = [block1];
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

      mockBlockManager.blocks = [previousBlock, targetBlock];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === previousBlock) return 0;
        if (block === targetBlock) return 1;
        return -1;
      });
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

      // The target block's holder needs to be in the DOM for closest to work
      // and getBoundingClientRect needs to be mocked
      vi.spyOn(targetBlock.holder, 'getBoundingClientRect').mockReturnValue({
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
      document.body.appendChild(targetBlock.holder);

      // Create element that is inside the holder (so closest finds holder)
      const targetElement = document.createElement('div');
      targetBlock.holder.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(previousBlock);
      expect(result?.edge).toBe('bottom');

      // Clean up
      document.body.removeChild(targetBlock.holder);
    });

    it('should determine top edge for first block', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      mockBlockManager.blocks = [targetBlock];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

      vi.spyOn(targetBlock.holder, 'getBoundingClientRect').mockReturnValue({
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
      document.body.appendChild(targetBlock.holder);

      const targetElement = document.createElement('div');
      targetBlock.holder.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(targetBlock);
      expect(result?.edge).toBe('top');

      // Clean up
      document.body.removeChild(targetBlock.holder);
    });

    it('should determine bottom edge for bottom half of block', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      mockBlockManager.blocks = [targetBlock];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

      vi.spyOn(targetBlock.holder, 'getBoundingClientRect').mockReturnValue({
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
      document.body.appendChild(targetBlock.holder);

      const targetElement = document.createElement('div');
      targetBlock.holder.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 170, sourceBlock);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(targetBlock);
      expect(result?.edge).toBe('bottom');

      // Clean up
      document.body.removeChild(targetBlock.holder);
    });

    it('should return null when target is source block', () => {
      const sourceBlock = createMockBlock('source');

      mockBlockManager.blocks = [sourceBlock];
      mockBlockManager.getBlockIndex = vi.fn(() => 0);

      const targetElement = document.createElement('div');
      targetElement.setAttribute(DATA_ATTR.element, 'block');

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock);

      expect(result).toBeNull();
    });

    it('should return null when target is in source blocks', () => {
      const sourceBlock = createMockBlock('source');
      const targetBlock = createMockBlock('target');

      detector.setSourceBlocks([sourceBlock, targetBlock]);
      mockBlockManager.blocks = [sourceBlock, targetBlock];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === targetBlock) return 1;
        return 0;
      });

      const targetElement = document.createElement('div');
      targetElement.setAttribute(DATA_ATTR.element, 'block');

      const result = detector.determineDropTarget(targetElement, 50, 120, sourceBlock);

      expect(result).toBeNull();
    });

    it('should redirect target to table block when targeting a cell-interior block', () => {
      const sourceBlock = createMockBlock('source', 'header');

      const tableBlock = createMockBlock('table', 'table');

      const cellBlock = createMockBlock('cell-paragraph');

      // Build DOM: tableBlock.holder > [data-blok-table-cell-blocks] > cellBlock.holder
      const cellBlocksContainer = document.createElement('div');
      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableBlock.holder.appendChild(cellBlocksContainer);
      cellBlocksContainer.appendChild(cellBlock.holder);

      document.body.appendChild(tableBlock.holder);

      mockBlockManager.blocks = [tableBlock, cellBlock, sourceBlock];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === tableBlock) return 0;
        if (block === cellBlock) return 1;
        if (block === sourceBlock) return 2;
        return -1;
      });
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

      vi.spyOn(cellBlock.holder, 'getBoundingClientRect').mockReturnValue({
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

      vi.spyOn(tableBlock.holder, 'getBoundingClientRect').mockReturnValue({
        top: 50,
        bottom: 300,
        left: 0,
        right: 100,
        width: 100,
        height: 250,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      });

      // Target element inside cell block holder
      const targetElement = document.createElement('div');
      cellBlock.holder.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 170, sourceBlock);

      expect(result).not.toBeNull();
      // Should redirect to the table block, NOT the cell block
      expect(result?.block).toBe(tableBlock);

      // Clean up
      document.body.removeChild(tableBlock.holder);
    });

    it('should allow targeting cell-interior blocks when source is also in the same cell', () => {
      const tableBlock = createMockBlock('table', 'table');

      const sourceBlock = createMockBlock('source-in-cell');

      const targetBlock = createMockBlock('target-in-cell');

      // Build DOM: tableBlock.holder > [data-blok-table-cell-blocks] > sourceBlock.holder + targetBlock.holder
      const cellBlocksContainer = document.createElement('div');
      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableBlock.holder.appendChild(cellBlocksContainer);
      cellBlocksContainer.appendChild(sourceBlock.holder);
      cellBlocksContainer.appendChild(targetBlock.holder);

      document.body.appendChild(tableBlock.holder);

      mockBlockManager.blocks = [tableBlock, sourceBlock, targetBlock];
      mockBlockManager.getBlockIndex = vi.fn((block) => {
        if (block === tableBlock) return 0;
        if (block === sourceBlock) return 1;
        if (block === targetBlock) return 2;
        return -1;
      });
      mockBlockManager.getBlockByIndex = vi.fn((index) => mockBlockManager.blocks[index] ?? undefined);

      vi.spyOn(targetBlock.holder, 'getBoundingClientRect').mockReturnValue({
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

      // Target element inside the target block holder
      const targetElement = document.createElement('div');
      targetBlock.holder.appendChild(targetElement);

      const result = detector.determineDropTarget(targetElement, 50, 170, sourceBlock);

      expect(result).not.toBeNull();
      // Should NOT redirect — source is in the same cell, so targeting the cell block is valid
      expect(result?.block).toBe(targetBlock);

      // Clean up
      document.body.removeChild(tableBlock.holder);
    });
  });

  describe('calculateTargetDepth', () => {
    it('should return 0 for first position', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);

      const depth = detector.calculateTargetDepth(targetBlock, 'top');

      expect(depth).toBe(0);
    });

    it('should return 0 when no previous block', () => {
      const targetBlock = createMockBlock('target');
      mockBlockManager.getBlockIndex = vi.fn(() => 0);
      mockBlockManager.getBlockByIndex = vi.fn(() => undefined);

      const depth = detector.calculateTargetDepth(targetBlock, 'bottom');

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

      const depth = detector.calculateTargetDepth(targetBlock, 'top');

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

      const depth = detector.calculateTargetDepth(targetBlock, 'top');

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

      const depth = detector.calculateTargetDepth(targetBlock, 'bottom');

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

      const depth = detector.calculateTargetDepth(targetBlock, 'bottom');

      expect(depth).toBe(0);
    });

    describe('with sourceBlock (depth prediction accuracy)', () => {
      it('should predict depth 1 when depth-1 list item is dropped after a depth-0 list item with no next block', () => {
        // Scenario: List A (depth 0) at index 0. Dragging List B (depth 1) to bottom of A.
        // ListDepthValidator would compute: maxAllowed = 0+1 = 1, currentDepth(1) <= 1, return 1.
        // The indicator must match and predict depth 1.
        const previousBlock = createMockListBlock('prev', 0);
        const targetBlock = createMockListBlock('target', 0);
        const sourceBlock = createMockListBlock('source', 1);

        mockBlockManager.getBlockIndex = vi.fn(() => 0);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          // dropIndex = bottom of index 0 = 1
          // previous at index 0 = previousBlock (depth 0)
          // next at index 1 = undefined
          if (index === 0) return previousBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'bottom', sourceBlock);

        expect(depth).toBe(1);
      });

      it('should predict depth 0 when depth-2 list item is dropped after paragraph and before depth-1 list', () => {
        // Scenario: Paragraph at index 0, List C (depth 1) at index 1.
        // Dragging List B (depth 2) to top of index 1 (between paragraph and list C).
        // ListDepthValidator: previous is not a list → maxAllowed = 0, depth-2 capped to 0.
        // The indicator must match and predict depth 0.
        const previousBlock = createMockBlock('prev'); // paragraph, no depth
        const nextBlock = createMockListBlock('next', 1);
        const targetBlock = createMockBlock('target');
        const sourceBlock = createMockListBlock('source', 2);

        mockBlockManager.getBlockIndex = vi.fn(() => 1);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          // dropIndex = top of index 1 = 1
          // previous at index 0 = previousBlock (paragraph)
          // next at index 1 = nextBlock (depth 1)
          if (index === 0) return previousBlock;
          if (index === 1) return nextBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'top', sourceBlock);

        expect(depth).toBe(0);
      });

      it('should cap depth when source depth exceeds maxAllowed', () => {
        // Source at depth 3, but previous list item is depth 1 → max = 2
        const previousBlock = createMockListBlock('prev', 1);
        const targetBlock = createMockListBlock('target', 1);
        const sourceBlock = createMockListBlock('source', 3);

        mockBlockManager.getBlockIndex = vi.fn(() => 1);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          if (index === 1) return previousBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'bottom', sourceBlock);

        expect(depth).toBe(2); // maxAllowed = 1 + 1 = 2
      });

      it('should match next list item depth when deeper than capped source depth', () => {
        // Source at depth 0, previous at depth 1, next at depth 2
        // maxAllowed = 2, currentDepth = 0, next(2) > 0 && 2 <= 2 → match next
        const previousBlock = createMockListBlock('prev', 1);
        const nextBlock = createMockListBlock('next', 2);
        const targetBlock = createMockListBlock('target', 1);
        const sourceBlock = createMockListBlock('source', 0);

        mockBlockManager.getBlockIndex = vi.fn(() => 1);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          if (index === 1) return previousBlock;
          if (index === 2) return nextBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'bottom', sourceBlock);

        expect(depth).toBe(2);
      });

      it('should preserve source depth when valid and no adjustments needed', () => {
        // Source at depth 1, previous at depth 1 (maxAllowed = 2). No constraints violated.
        const previousBlock = createMockListBlock('prev', 1);
        const targetBlock = createMockListBlock('target', 1);
        const sourceBlock = createMockListBlock('source', 1);

        mockBlockManager.getBlockIndex = vi.fn(() => 1);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          if (index === 1) return previousBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'bottom', sourceBlock);

        expect(depth).toBe(1);
      });

      it('should not change behavior for non-list source blocks', () => {
        // Source is a paragraph (no depth), previous is a list at depth 2
        // Should use the neighbor-based algorithm (return 2)
        const previousBlock = createMockListBlock('prev', 2);
        const targetBlock = createMockBlock('target');
        const sourceBlock = createMockBlock('source'); // paragraph

        mockBlockManager.getBlockIndex = vi.fn(() => 1);
        mockBlockManager.getBlockByIndex = vi.fn((index) => {
          if (index === 1) return previousBlock;

          return undefined;
        });

        const depth = detector.calculateTargetDepth(targetBlock, 'bottom', sourceBlock);

        expect(depth).toBe(2);
      });
    });
  });

  describe('toggle nesting detection', () => {
    /**
     * Creates a block stub for toggle nesting tests.
     */
    const createToggleTestBlock = (options: {
      id?: string;
      parentId?: string | null;
      contentIds?: string[];
      toggleOpen?: boolean;
      name?: string;
    } = {}): Block => {
      const holder = document.createElement('div');
      holder.setAttribute(DATA_ATTR.element, 'block');

      if (options.toggleOpen !== undefined) {
        const toggleWrapper = document.createElement('div');
        toggleWrapper.setAttribute('data-blok-toggle-open', String(options.toggleOpen));
        holder.appendChild(toggleWrapper);
      }

      return {
        id: options.id ?? `block-${Math.random().toString(36).slice(2)}`,
        parentId: options.parentId ?? null,
        contentIds: options.contentIds ?? [],
        holder,
        name: options.name ?? 'paragraph',
        selected: false,
        stretched: false,
      } as unknown as Block;
    };

    const createToggleBlockManager = (blocks: Block[]): BlockManagerAdapter => ({
      blocks,
      getBlockByIndex: (index: number) => blocks[index],
      getBlockIndex: (block: Block) => blocks.indexOf(block),
      getBlockById: (id: string) => blocks.find(b => b.id === id),
    });

    const createToggleUIAdapter = (): { contentRect: { left: number } } => ({
      contentRect: { left: 0 },
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should set parentId when dropping on bottom edge of open toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: [],
        name: 'toggle',
      });
      const paragraph = createToggleTestBlock({ id: 'para-1' });

      const blockManager = createToggleBlockManager([toggle, paragraph]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([paragraph]);

      // Mock getBoundingClientRect for the toggle holder
      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      // Add to DOM so closest works
      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      const result = det.determineDropTarget(innerElement, 100, 99, paragraph);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(toggle);
      expect(result?.edge).toBe('bottom');
      expect(result?.parentId).toBe('toggle-1');

      document.body.removeChild(toggle.holder);
    });

    it('should NOT set parentId when dropping on bottom edge of closed toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: false,
        contentIds: [],
        name: 'toggle',
      });
      const paragraph = createToggleTestBlock({ id: 'para-1' });

      const blockManager = createToggleBlockManager([toggle, paragraph]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([paragraph]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      const result = det.determineDropTarget(innerElement, 100, 99, paragraph);

      expect(result).not.toBeNull();
      expect(result?.parentId).toBeNull();

      document.body.removeChild(toggle.holder);
    });

    it('should set parentId when target block is child of open toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: ['child-1'],
        name: 'toggle',
      });
      const child = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' });
      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, child, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(child.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100, x: 0, y: 100, toJSON: () => ({}),
      });

      document.body.appendChild(child.holder);

      const innerElement = document.createElement('div');
      child.holder.appendChild(innerElement);

      const result = det.determineDropTarget(innerElement, 100, 199, outsider);

      expect(result).not.toBeNull();
      expect(result?.parentId).toBe('toggle-1');

      document.body.removeChild(child.holder);
    });

    it('should set indicator depth when target block is child of open toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: ['child-1'],
        name: 'toggle',
      });
      // Toggle at root level → data-blok-depth = 0
      toggle.holder.setAttribute('data-blok-depth', '0');
      const child = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' });
      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, child, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(child.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100, x: 0, y: 100, toJSON: () => ({}),
      });

      document.body.appendChild(child.holder);

      const innerElement = document.createElement('div');
      child.holder.appendChild(innerElement);

      const result = det.determineDropTarget(innerElement, 100, 199, outsider);

      expect(result).not.toBeNull();
      // Depth should be (toggleHierarchyDepth + 1) * 28 / 24 = (0 + 1) * 28 / 24 ≈ 1.1667
      // indicator CSS: left = depth * 24px → 1.1667 * 24 = 28px = pl-7 padding of toggle children
      expect(result?.depth).toBeCloseTo(28 / 24, 4);

      document.body.removeChild(child.holder);
    });

    it('should set parentId when target is body placeholder inside open toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: [],
        name: 'toggle',
      });
      const placeholder = document.createElement('div');
      placeholder.setAttribute('data-blok-toggle-body-placeholder', '');
      toggle.holder.appendChild(placeholder);

      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const result = det.determineDropTarget(placeholder, 100, 50, outsider);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(toggle);
      expect(result?.edge).toBe('bottom');
      expect(result?.parentId).toBe('toggle-1');

      document.body.removeChild(toggle.holder);
    });

    it('should set parentId for toggle heading (header with toggle-open)', () => {
      const toggleHeading = createToggleTestBlock({
        id: 'header-1',
        toggleOpen: true,
        contentIds: [],
        name: 'header',
      });
      const paragraph = createToggleTestBlock({ id: 'para-1' });

      const blockManager = createToggleBlockManager([toggleHeading, paragraph]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([paragraph]);

      vi.spyOn(toggleHeading.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggleHeading.holder);

      const innerElement = toggleHeading.holder.querySelector('[data-blok-toggle-open]') ?? toggleHeading.holder;
      const result = det.determineDropTarget(innerElement, 100, 99, paragraph);

      expect(result).not.toBeNull();
      expect(result?.parentId).toBe('header-1');

      document.body.removeChild(toggleHeading.holder);
    });

    it('should set depth to 28/24 when dropping inside root-level toggle (bottom edge)', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: [],
        name: 'toggle',
      });
      // Root-level toggle has no data-blok-depth attribute (defaults to 0)
      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      const result = det.determineDropTarget(innerElement, 100, 99, outsider);

      expect(result).not.toBeNull();
      // (toggleHierarchyDepth + 1) * 28 / 24 = (0 + 1) * 28 / 24 ≈ 1.1667
      // indicator at depth * 24px = 28px = pl-7 padding of [data-blok-toggle-children]
      expect(result?.depth).toBeCloseTo(28 / 24, 4);

      document.body.removeChild(toggle.holder);
    });

    it('should set depth to 56/24 when dropping inside a depth-1 nested toggle (bottom edge)', () => {
      const outerToggle = createToggleTestBlock({
        id: 'outer-toggle',
        toggleOpen: true,
        contentIds: ['inner-toggle'],
        name: 'toggle',
      });
      outerToggle.holder.setAttribute('data-blok-depth', '0');

      const innerToggle = createToggleTestBlock({
        id: 'inner-toggle',
        toggleOpen: true,
        contentIds: [],
        name: 'toggle',
        parentId: 'outer-toggle',
      });
      // data-blok-depth="1" — nested one level inside outer toggle
      innerToggle.holder.setAttribute('data-blok-depth', '1');

      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([outerToggle, innerToggle, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(innerToggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(innerToggle.holder);

      const innerElement = innerToggle.holder.querySelector('[data-blok-toggle-open]') ?? innerToggle.holder;
      const result = det.determineDropTarget(innerElement, 100, 99, outsider);

      expect(result).not.toBeNull();
      // (toggleHierarchyDepth + 1) * 28 / 24 = (1 + 1) * 28 / 24 ≈ 2.3333
      expect(result?.depth).toBeCloseTo(56 / 24, 4);

      document.body.removeChild(innerToggle.holder);
    });

    it('should NOT set parentId when dropping on top edge of open toggle', () => {
      const paragraph = createToggleTestBlock({ id: 'para-1' });
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: [],
        name: 'toggle',
      });

      // paragraph is first, toggle is second
      const blockManager = createToggleBlockManager([paragraph, toggle]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([paragraph]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100, x: 0, y: 100, toJSON: () => ({}),
      });

      // When dropping on top edge of toggle (index 1), normalization converts to "bottom of paragraph (index 0)"
      // We also need paragraph to have getBoundingClientRect
      vi.spyOn(paragraph.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      // Top half of toggle = clientY close to top
      const result = det.determineDropTarget(innerElement, 100, 101, paragraph);

      // "top of toggle" normalizes to "bottom of paragraph" — no nesting
      expect(result).not.toBeNull();
      expect(result?.parentId).toBeNull();

      document.body.removeChild(toggle.holder);
    });

    it('should NOT set parentId when dragging a block that is already a child of the target open toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: ['child-1'],
        name: 'toggle',
      });
      const child = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' });

      const blockManager = createToggleBlockManager([toggle, child]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([child]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      // Bottom half of toggle
      const result = det.determineDropTarget(innerElement, 100, 99, child);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(toggle);
      expect(result?.edge).toBe('bottom');
      // The child is already inside this toggle — should NOT re-enter it
      expect(result?.parentId).toBeNull();

      document.body.removeChild(toggle.holder);
    });

    it('should set parentId when dragging an external block onto the bottom of an open toggle that already has children', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: ['child-1'],
        name: 'toggle',
      });
      const child = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' });
      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, child, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(toggle.holder, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}),
      });

      document.body.appendChild(toggle.holder);

      const innerElement = toggle.holder.querySelector('[data-blok-toggle-open]') ?? toggle.holder;
      // Bottom half of toggle
      const result = det.determineDropTarget(innerElement, 100, 99, outsider);

      expect(result).not.toBeNull();
      expect(result?.block).toBe(toggle);
      expect(result?.edge).toBe('bottom');
      // External block should still enter the toggle
      expect(result?.parentId).toBe('toggle-1');

      document.body.removeChild(toggle.holder);
    });

    it('should NOT set parentId when target child belongs to closed toggle', () => {
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: false,
        contentIds: ['child-1'],
        name: 'toggle',
      });
      const child = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' });
      const outsider = createToggleTestBlock({ id: 'outsider' });

      const blockManager = createToggleBlockManager([toggle, child, outsider]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([outsider]);

      vi.spyOn(child.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 0, right: 200, width: 200, height: 100, x: 0, y: 100, toJSON: () => ({}),
      });

      document.body.appendChild(child.holder);

      const innerElement = document.createElement('div');
      child.holder.appendChild(innerElement);

      const result = det.determineDropTarget(innerElement, 100, 199, outsider);

      expect(result).not.toBeNull();
      expect(result?.parentId).toBeNull();

      document.body.removeChild(child.holder);
    });

    it('should NOT trap a toggle child inside the toggle when cursor is at top half of the next external block (multi-child toggle)', () => {
      // Scenario: toggle T has two children [childA, childD].
      // User drags childA. cursor is at the TOP HALF of the external block C (right after T).
      // Without the fix, normalization converts "top of C" → "bottom of childD" (last child of T),
      // which returns parentId=T.id — trapping childA inside T forever.
      const toggle = createToggleTestBlock({
        id: 'toggle-1',
        toggleOpen: true,
        contentIds: ['child-1', 'child-2'],
        name: 'toggle',
      });
      const childA = createToggleTestBlock({ id: 'child-1', parentId: 'toggle-1' }); // source
      const childD = createToggleTestBlock({ id: 'child-2', parentId: 'toggle-1' }); // last child, NOT source
      const external = createToggleTestBlock({ id: 'external' }); // C: next block after toggle

      // flat array order: [toggle, childA, childD, external]
      const blockManager = createToggleBlockManager([toggle, childA, childD, external]);
      const det = new DropTargetDetector(createToggleUIAdapter(), blockManager);
      det.setSourceBlocks([childA]);

      vi.spyOn(external.holder, 'getBoundingClientRect').mockReturnValue({
        top: 200, bottom: 300, left: 0, right: 200, width: 200, height: 100, x: 0, y: 200, toJSON: () => ({}),
      });

      document.body.appendChild(external.holder);

      const innerElement = document.createElement('div');
      external.holder.appendChild(innerElement);

      // Cursor at Y=210 — top half of external block (midpoint is 250)
      const result = det.determineDropTarget(innerElement, 100, 210, childA);

      expect(result).not.toBeNull();
      // Must escape the toggle — parentId must be null (root level)
      expect(result?.parentId).toBeNull();

      document.body.removeChild(external.holder);
    });
  });
});

/**
 * Helper to create a mock block
 */
const createMockBlock = (id: string, name = 'paragraph'): Block => {
  const holder = document.createElement('div');
  holder.setAttribute(DATA_ATTR.element, 'block');

  return {
    id,
    holder,
    name,
    stretched: false,
  } as Block;
};

/**
 * Helper to create a mock list block with depth
 */
const createMockListBlock = (id: string, depth: number): Block => {
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
