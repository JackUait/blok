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
      // Depth should be 0 so the indicator is full-width (same as root-level indicators)
      expect(result?.depth).toBe(0);

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

    it('should set depth to 0 when dropping inside root-level toggle (bottom edge)', () => {
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
      // Depth should be 0 so the indicator is full-width (same as root-level indicators)
      expect(result?.depth).toBe(0);

      document.body.removeChild(toggle.holder);
    });

    it('should set depth to 0 when dropping inside a depth-1 nested toggle (bottom edge)', () => {
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
      // Depth should be 0 so the indicator is full-width (same as root-level indicators)
      expect(result?.depth).toBe(0);

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

  });

  describe('horizontal (side) drop detection', () => {
    let originalInnerWidth: number;

    /**
     * Creates a block stub for horizontal-drop tests.
     */
    const createSideTestBlock = (options: {
      id?: string;
      parentId?: string | null;
      name?: string;
    } = {}): Block => {
      const holder = document.createElement('div');
      holder.setAttribute(DATA_ATTR.element, 'block');

      return {
        id: options.id ?? `block-${Math.random().toString(36).slice(2)}`,
        parentId: options.parentId ?? null,
        contentIds: [],
        holder,
        name: options.name ?? 'paragraph',
        selected: false,
        stretched: false,
      } as unknown as Block;
    };

    const createSideBlockManager = (blocks: Block[]): BlockManagerAdapter => ({
      blocks,
      getBlockByIndex: (index: number) => blocks[index],
      getBlockIndex: (block: Block) => blocks.indexOf(block),
      getBlockById: (id: string) => blocks.find(b => b.id === id),
    });

    const createSideUIAdapter = (): { contentRect: { left: number } } => ({
      contentRect: { left: 0 },
    });

    /**
     * Rect with top=100, bottom=200 (height 100), left=300, right=500 (width 200).
     * Mid-band (60%) spans clientY from 100 + 20 = 120 to 200 - 20 = 180.
     */
    const stubRect = (block: Block): void => {
      vi.spyOn(block.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 300, right: 500, width: 200, height: 100, x: 300, y: 100, toJSON: () => ({}),
      });
    };

    beforeEach(() => {
      originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
      vi.restoreAllMocks();
    });

    it('should detect right edge when cursor is near right within mid-band', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubRect(target);

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=480 (within 48px of right=500), clientY=150 (mid-band 120..180)
      const result = det.determineDropTarget(inner, 480, 150, source);

      expect(result).not.toBeNull();
      expect(result?.edge).toBe('right');
      expect(result?.block).toBe(target);
      expect(result?.depth).toBe(0);
      expect(result?.parentId).toBeNull();

      document.body.removeChild(target.holder);
    });

    it('should detect left edge when cursor is near left within mid-band', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubRect(target);

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=320 (within 48px of left=300), clientY=150 (mid-band)
      const result = det.determineDropTarget(inner, 320, 150, source);

      expect(result).not.toBeNull();
      expect(result?.edge).toBe('left');
      expect(result?.block).toBe(target);

      document.body.removeChild(target.holder);
    });

    it('should fall back to top/bottom when cursor is near right edge but OUTSIDE mid-band', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubRect(target);

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=480 (near right), clientY=105 (above mid-band start 120 → near top corner)
      const result = det.determineDropTarget(inner, 480, 105, source);

      expect(result).not.toBeNull();
      expect(['top', 'bottom']).toContain(result?.edge);

      document.body.removeChild(target.holder);
    });

    it('should use top/bottom when cursor is in the horizontal center', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubRect(target);

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=400 (center, not near either side), clientY=150
      const result = det.determineDropTarget(inner, 400, 150, source);

      expect(result).not.toBeNull();
      expect(['top', 'bottom']).toContain(result?.edge);

      document.body.removeChild(target.holder);
    });

    it('should NOT produce a horizontal edge when target is a column or column_list', () => {
      const source = createSideTestBlock({ id: 'source' });
      const column = createSideTestBlock({ id: 'col', name: 'column' });
      stubRect(column);

      const bm = createSideBlockManager([column, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(column.holder);
      const inner = document.createElement('div');
      column.holder.appendChild(inner);

      const colResult = det.determineDropTarget(inner, 480, 150, source);
      expect(['top', 'bottom']).toContain(colResult?.edge);

      document.body.removeChild(column.holder);

      const columnList = createSideTestBlock({ id: 'col-list', name: 'column_list' });
      stubRect(columnList);
      const bm2 = createSideBlockManager([columnList, source]);
      const det2 = new DropTargetDetector(createSideUIAdapter(), bm2);
      det2.setSourceBlocks([source]);

      document.body.appendChild(columnList.holder);
      const inner2 = document.createElement('div');
      columnList.holder.appendChild(inner2);

      const listResult = det2.determineDropTarget(inner2, 480, 150, source);
      expect(['top', 'bottom']).toContain(listResult?.edge);

      document.body.removeChild(columnList.holder);
    });

    it('should set parentId to enclosing column id when target is inside a column, null at top level', () => {
      const source = createSideTestBlock({ id: 'source' });
      const column = createSideTestBlock({ id: 'col-1', name: 'column' });
      const target = createSideTestBlock({ id: 'target', parentId: 'col-1' });
      stubRect(target);

      const bm = createSideBlockManager([column, target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      const result = det.determineDropTarget(inner, 480, 150, source);

      expect(result?.edge).toBe('right');
      expect(result?.parentId).toBe('col-1');

      document.body.removeChild(target.holder);

      // Top-level target (no column ancestor) → parentId null
      const target2 = createSideTestBlock({ id: 'target2' });
      stubRect(target2);
      const bm2 = createSideBlockManager([target2, source]);
      const det2 = new DropTargetDetector(createSideUIAdapter(), bm2);
      det2.setSourceBlocks([source]);

      document.body.appendChild(target2.holder);
      const inner2 = document.createElement('div');
      target2.holder.appendChild(inner2);

      const result2 = det2.determineDropTarget(inner2, 480, 150, source);

      expect(result2?.edge).toBe('right');
      expect(result2?.parentId).toBeNull();

      document.body.removeChild(target2.holder);
    });

    /**
     * Appends a `[data-blok-element-content]` child to a block's holder and
     * stubs its rect to the given horizontal bounds (vertical bounds match the
     * holder's 100..200 band). Models the real DOM where the holder spans the
     * full editor width but the visible content box is narrower and centered.
     */
    const stubContentRect = (block: Block, left: number, right: number): HTMLElement => {
      const content = document.createElement('div');
      content.setAttribute('data-blok-element-content', '');
      block.holder.appendChild(content);

      vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left, right, width: right - left, height: 100, x: left, y: 100, toJSON: () => ({}),
      });

      return content;
    };

    /**
     * Stubs the holder rect to the FULL editor width (left=0, right=1200) — the
     * real-world geometry where the holder spans edge-to-edge while content is
     * centered. Used to prove side detection measures the content box, not the
     * full-width holder.
     */
    const stubWideHolder = (block: Block): void => {
      vi.spyOn(block.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 0, right: 1200, width: 1200, height: 100, x: 0, y: 100, toJSON: () => ({}),
      });
    };

    it('should detect side edge near the CONTENT box edge, not the full-width holder', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubWideHolder(target);
      stubContentRect(target, 300, 900); // visible content box

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=880 is within 48px of the CONTENT right edge (900), but ~320px
      // from the holder right edge (1200). Must detect a right side-drop.
      const result = det.determineDropTarget(inner, 880, 150, source);

      expect(result?.edge).toBe('right');

      document.body.removeChild(target.holder);
    });

    it('should treat the outer quarter of the content box as the side zone (Notion-style), not a thin edge strip', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubWideHolder(target);
      stubContentRect(target, 300, 900); // content width 600 → outer 25% = 150px each side

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // clientX=420 is 120px from the content left (300) — inside the 150px outer
      // zone but well outside any 48px edge strip. Must read as a left side-drop.
      const left = det.determineDropTarget(inner, 420, 150, source);
      expect(left?.edge).toBe('left');

      // clientX=780 is 120px from the content right (900) — inside the right zone.
      const right = det.determineDropTarget(inner, 780, 150, source);
      expect(right?.edge).toBe('right');

      // clientX=600 is dead center (300px from each edge) — reorder, not side.
      const center = det.determineDropTarget(inner, 600, 150, source);
      expect(['top', 'bottom']).toContain(center?.edge);

      document.body.removeChild(target.holder);
    });

    it('should detect a side edge at ANY distance into the margin (left/right of the content box)', () => {
      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubWideHolder(target);          // holder spans 0..1200
      stubContentRect(target, 300, 900); // content box centered at 300..900

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // x=20 is deep in the LEFT margin (280px left of the content box) — must
      // still create a left column, no matter how far from the content edge.
      const farLeft = det.determineDropTarget(inner, 20, 150, source);
      expect(farLeft?.edge).toBe('left');

      // x=1150 is deep in the RIGHT margin — must create a right column.
      const farRight = det.determineDropTarget(inner, 1150, 150, source);
      expect(farRight?.edge).toBe('right');

      document.body.removeChild(target.holder);
    });

    /**
     * Wraps a block holder inside a single-column `[data-blok-columns]` row whose
     * rect is TALLER than the block — models a short block sitting in a
     * column_list whose row height is set by a taller sibling column. Builds the
     * real nesting (columns > column holder > [data-blok-column] > block) so the
     * first/last-column edge gating resolves; a lone column is both first AND
     * last. Returns the container.
     */
    const wrapInColumns = (block: Block, top: number, bottom: number): HTMLElement => {
      const columns = document.createElement('div');
      columns.setAttribute('data-blok-columns', '');

      const columnHolder = document.createElement('div');
      columnHolder.setAttribute(DATA_ATTR.element, 'block');
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-column', '');
      wrapper.appendChild(block.holder);
      columnHolder.appendChild(wrapper);
      columns.appendChild(columnHolder);

      vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({
        top, bottom, left: 300, right: 900, width: 600, height: bottom - top, x: 300, y: top, toJSON: () => ({}),
      });

      return columns;
    };

    it('treats the column block body center as into-column reorder; only the narrow edges are side-drops', () => {
      const source = createSideTestBlock({ id: 'source' });
      const column = createSideTestBlock({ id: 'col-1', name: 'column' });
      const target = createSideTestBlock({ id: 'target', parentId: 'col-1' });
      stubWideHolder(target);              // block band is only 100..200
      stubContentRect(target, 300, 500);   // content box width 200 → sideZone=max(50,48)=50
      const columns = wrapInColumns(target, 50, 400); // row spans 50..400

      const bm = createSideBlockManager([column, target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // Dead center of the body (clientX=400, clientY=150 mid-band) is NOT a
      // side-drop — it falls through to a top/bottom reorder so the block stacks
      // INTO this column. This is the user-facing fix: dropping over a column's
      // body adds to the column, it does not spawn a new column.
      const center = det.determineDropTarget(inner, 400, 150, source);
      expect(['top', 'bottom']).toContain(center?.edge);

      // Only the narrow left edge (within 50px of left=300) reads as a left
      // side-drop that creates a new column.
      const left = det.determineDropTarget(inner, 320, 150, source);
      expect(left?.edge).toBe('left');
      expect(left?.parentId).toBe('col-1');

      // Likewise the narrow right edge (within 50px of right=500).
      const right = det.determineDropTarget(inner, 480, 150, source);
      expect(right?.edge).toBe('right');
      expect(right?.parentId).toBe('col-1');

      document.body.removeChild(columns);
    });

    it('keeps stack-inside reorder available across the WHOLE column block body, not just a thin edge', () => {
      const source = createSideTestBlock({ id: 'source' });
      const column = createSideTestBlock({ id: 'col-1', name: 'column' });
      const target = createSideTestBlock({ id: 'target', parentId: 'col-1' });
      stubWideHolder(target);
      stubContentRect(target, 300, 500); // content box 300..500, center zone 350..450
      const columns = wrapInColumns(target, 50, 400);

      const bm = createSideBlockManager([column, target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      // Multiple interior x positions across the central band all reorder (stack
      // inside) — the into-column zone is the dominant body region, the opposite
      // of the old design where only a 10px margin stacked inside.
      for (const x of [370, 400, 430]) {
        const result = det.determineDropTarget(inner, x, 150, source);
        expect(['top', 'bottom']).toContain(result?.edge);
      }

      document.body.removeChild(columns);
    });

    it('redirects a drop in the empty space below a column to the column\'s LAST child (into-column), not the column container', () => {
      const source = createSideTestBlock({ id: 'source' });
      const column = createSideTestBlock({ id: 'col-1', name: 'column' });
      const child1 = createSideTestBlock({ id: 'child-1', parentId: 'col-1' });
      const child2 = createSideTestBlock({ id: 'child-2', parentId: 'col-1' });

      // The column spans y 100..400, but its last block (child2) ends at y 240,
      // leaving ~160px of EMPTY column space below it — the bug zone. A cursor in
      // that gap resolves (via closest) to the column CONTAINER block, which used
      // to give a container-bottom indicator AND a drop that spawned a new column.
      vi.spyOn(column.holder, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 400, left: 300, right: 500, width: 200, height: 300, x: 300, y: 100, toJSON: () => ({}),
      });
      vi.spyOn(child2.holder, 'getBoundingClientRect').mockReturnValue({
        top: 200, bottom: 240, left: 300, right: 500, width: 200, height: 40, x: 300, y: 200, toJSON: () => ({}),
      });
      const child2Content = document.createElement('div');
      child2Content.setAttribute('data-blok-element-content', '');
      child2.holder.appendChild(child2Content);
      vi.spyOn(child2Content, 'getBoundingClientRect').mockReturnValue({
        top: 200, bottom: 240, left: 300, right: 500, width: 200, height: 40, x: 300, y: 200, toJSON: () => ({}),
      });

      const columns = document.createElement('div');
      columns.setAttribute('data-blok-columns', '');
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-blok-column', '');
      wrapper.append(child1.holder, child2.holder);
      column.holder.appendChild(wrapper);
      columns.appendChild(column.holder);

      // The empty-space element sits inside the column wrapper, below the blocks.
      const emptyZone = document.createElement('div');
      wrapper.appendChild(emptyZone);
      document.body.appendChild(columns);

      const bm = createSideBlockManager([column, child1, child2, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      // Cursor at x=400 (body center), y=320 (deep in the empty gap). The drop
      // must land at the BOTTOM of the column's last child — one indicator that
      // matches the drop (append into the column), never the container itself.
      const result = det.determineDropTarget(emptyZone, 400, 320, source);

      expect(result?.block).toBe(child2);
      expect(result?.edge).toBe('bottom');

      document.body.removeChild(columns);
    });

    /**
     * Builds the real column-row DOM around two columns divided by a resize
     * separator: [data-blok-columns] > [leftHolder, resizer, rightColumn.holder].
     * The right column holder contains its first inner child block holder, since a
     * gutter drop targets that child with a 'left' side-drop to insert a column
     * before the right column (i.e. between the two columns). Returns the resizer.
     */
    const buildGutter = (rightColumn: Block, rightChild: Block): { columns: HTMLElement; resizer: HTMLElement } => {
      const columns = document.createElement('div');
      columns.setAttribute('data-blok-columns', '');

      const leftHolder = document.createElement('div');
      leftHolder.setAttribute(DATA_ATTR.element, 'block');

      const resizer = document.createElement('div');
      resizer.setAttribute('data-blok-column-resizer', '');

      rightColumn.holder.appendChild(rightChild.holder);
      columns.append(leftHolder, resizer, rightColumn.holder);

      return { columns, resizer };
    };

    it('redirects a drop on the inter-column resizer gutter to a between-columns side-drop', () => {
      const source = createSideTestBlock({ id: 'source' });
      const rightColumn = createSideTestBlock({ id: 'col-right', name: 'column' });
      const rightChild = createSideTestBlock({ id: 'right-child', parentId: 'col-right' });

      const { columns, resizer } = buildGutter(rightColumn, rightChild);

      const bm = createSideBlockManager([rightColumn, rightChild, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);

      // Cursor sits on the resize separator dividing the two columns. The drop must
      // insert a NEW column between them: target the right column's child with a
      // 'left' edge → addColumnToList(rightColumn, 'left') inserts before it.
      const result = det.determineDropTarget(resizer, 510, 150, source);

      expect(result?.edge).toBe('left');
      expect(result?.parentId).toBe('col-right');
      expect(result?.block).toBe(rightChild);

      document.body.removeChild(columns);
    });

    /**
     * Builds a full two-column row: [data-blok-columns] containing the left
     * column holder (wrapping its child), a resize separator, and the right
     * column holder (wrapping its child). Mirrors the real DOM closely enough for
     * the boundary-canonicalization walk (child → [data-blok-column] → column
     * holder → next column holder). Stubs the row rect so the vertical band check
     * passes at clientY 150. Returns the row and its separator.
     */
    const buildColumnRow = (
      leftColumn: Block,
      leftChild: Block,
      rightColumn: Block,
      rightChild: Block
    ): { columns: HTMLElement; resizer: HTMLElement } => {
      const columns = document.createElement('div');
      columns.setAttribute('data-blok-columns', '');
      vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 200, left: 300, right: 760, width: 460, height: 100, x: 300, y: 100, toJSON: () => ({}),
      });

      const wrapLeft = document.createElement('div');
      wrapLeft.setAttribute('data-blok-column', '');
      wrapLeft.appendChild(leftChild.holder);
      leftColumn.holder.appendChild(wrapLeft);

      const resizer = document.createElement('div');
      resizer.setAttribute('data-blok-column-resizer', '');

      const wrapRight = document.createElement('div');
      wrapRight.setAttribute('data-blok-column', '');
      wrapRight.appendChild(rightChild.holder);
      rightColumn.holder.appendChild(wrapRight);

      columns.append(leftColumn.holder, resizer, rightColumn.holder);

      return { columns, resizer };
    };

    it('inner column edges fall through to into-column; only the row outer edges side-drop', () => {
      const source = createSideTestBlock({ id: 'source' });
      const leftColumn = createSideTestBlock({ id: 'col-left', name: 'column' });
      const leftChild = createSideTestBlock({ id: 'left-child', parentId: 'col-left' });
      const rightColumn = createSideTestBlock({ id: 'col-right', name: 'column' });
      const rightChild = createSideTestBlock({ id: 'right-child', parentId: 'col-right' });

      const { columns } = buildColumnRow(leftColumn, leftChild, rightColumn, rightChild);

      // Left column content box 300..500, right column 560..760 (gutter between).
      stubWideHolder(leftChild);
      stubContentRect(leftChild, 300, 500);
      stubWideHolder(rightChild);
      stubContentRect(rightChild, 560, 760);

      const bm = createSideBlockManager([leftColumn, leftChild, rightColumn, rightChild, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);
      const innerLeft = document.createElement('div');
      leftChild.holder.appendChild(innerLeft);
      const innerRight = document.createElement('div');
      rightChild.holder.appendChild(innerRight);

      // The INNER edges between the two columns NO LONGER side-drop — they fall
      // through to a top/bottom reorder (stack INTO the column). Between-column
      // insertion is the gutter separator's job, so the indicator never flips to
      // a vertical "new column" bar as the cursor crosses a column body edge.
      const leftInnerEdge = det.determineDropTarget(innerLeft, 480, 150, source);
      expect(['top', 'bottom']).toContain(leftInnerEdge?.edge);

      const rightInnerEdge = det.determineDropTarget(innerRight, 580, 150, source);
      expect(['top', 'bottom']).toContain(rightInnerEdge?.edge);

      // The OUTER edges DO side-drop: the first column's left edge appends a
      // column at the start...
      const firstOuter = det.determineDropTarget(innerLeft, 320, 150, source);
      expect(firstOuter?.edge).toBe('left');
      expect(firstOuter?.block).toBe(leftChild);
      expect(firstOuter?.parentId).toBe('col-left');

      // ...and the last column's right edge appends one at the end.
      const lastOuter = det.determineDropTarget(innerRight, 740, 150, source);
      expect(lastOuter?.edge).toBe('right');
      expect(lastOuter?.block).toBe(rightChild);
      expect(lastOuter?.parentId).toBe('col-right');

      document.body.removeChild(columns);
    });

    it('keeps a right side-drop on the LAST column as-is (outer edge appends a column at the end)', () => {
      const source = createSideTestBlock({ id: 'source' });
      const leftColumn = createSideTestBlock({ id: 'col-left', name: 'column' });
      const leftChild = createSideTestBlock({ id: 'left-child', parentId: 'col-left' });
      const rightColumn = createSideTestBlock({ id: 'col-right', name: 'column' });
      const rightChild = createSideTestBlock({ id: 'right-child', parentId: 'col-right' });

      const { columns } = buildColumnRow(leftColumn, leftChild, rightColumn, rightChild);

      stubWideHolder(rightChild);
      stubContentRect(rightChild, 560, 760);

      const bm = createSideBlockManager([leftColumn, leftChild, rightColumn, rightChild, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);
      const innerRight = document.createElement('div');
      rightChild.holder.appendChild(innerRight);

      // Right edge of the last column → append a column at the end (outer edge).
      const result = det.determineDropTarget(innerRight, 740, 150, source);

      expect(result?.edge).toBe('right');
      expect(result?.block).toBe(rightChild);
      expect(result?.parentId).toBe('col-right');

      document.body.removeChild(columns);
    });

    /**
     * Adds a `[data-blok-element-content]` element to a child holder and stubs its
     * rect to a fixed vertical span. Used to give two columns DIFFERENT content
     * heights so the dead gap below the shorter one can be targeted.
     */
    const stubChildContent = (block: Block, top: number, bottom: number): void => {
      const content = document.createElement('div');
      content.setAttribute('data-blok-element-content', '');
      block.holder.appendChild(content);
      vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({
        top, bottom, left: 300, right: 500, width: 200, height: bottom - top, x: 300, y: top, toJSON: () => ({}),
      });
    };

    it('stacks a gutter drop into the column whose dead gap it lands in, instead of inserting a new column', () => {
      const source = createSideTestBlock({ id: 'source' });
      const leftColumn = createSideTestBlock({ id: 'col-left', name: 'column' });
      const leftChild = createSideTestBlock({ id: 'left-child', parentId: 'col-left' });
      const rightColumn = createSideTestBlock({ id: 'col-right', name: 'column' });
      const rightChild = createSideTestBlock({ id: 'right-child', parentId: 'col-right' });

      const { columns, resizer } = buildColumnRow(leftColumn, leftChild, rightColumn, rightChild);

      // Left column content ends at y160; right column content fills to y200. The
      // separator spans the full row (100..200), so its lower strip (160..200)
      // overlaps the EMPTY gap below the left column — the bug zone where a drop
      // used to insert a new column between the two.
      stubChildContent(leftChild, 100, 160);
      stubChildContent(rightChild, 100, 200);

      const bm = createSideBlockManager([leftColumn, leftChild, rightColumn, rightChild, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);

      // Cursor on the separator at y180 — inside the left column's dead gap (its
      // content ended at 160) while the right column still has content. This must
      // stack INTO the left column (bottom of its last child), NOT side-drop.
      const inGap = det.determineDropTarget(resizer, 510, 180, source);

      expect(inGap?.edge).toBe('bottom');
      expect(inGap?.block).toBe(leftChild);

      // Higher up (y130), both columns have content beside the separator — the
      // gutter still inserts a NEW column between them (unchanged behaviour).
      const betweenContent = det.determineDropTarget(resizer, 510, 130, source);

      expect(betweenContent?.edge).toBe('left');
      expect(betweenContent?.block).toBe(rightChild);
      expect(betweenContent?.parentId).toBe('col-right');

      document.body.removeChild(columns);
    });

    it('does NOT redirect a gutter drop below 651px (columns stack, no separators)', () => {
      Object.defineProperty(window, 'innerWidth', { value: 650, writable: true, configurable: true });

      const source = createSideTestBlock({ id: 'source' });
      const rightColumn = createSideTestBlock({ id: 'col-right', name: 'column' });
      const rightChild = createSideTestBlock({ id: 'right-child', parentId: 'col-right' });

      const { columns, resizer } = buildGutter(rightColumn, rightChild);

      const bm = createSideBlockManager([rightColumn, rightChild, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(columns);

      const result = det.determineDropTarget(resizer, 510, 150, source);

      // No between-insertion on a stacked layout — must not produce a 'left' edge.
      expect(result?.edge).not.toBe('left');

      document.body.removeChild(columns);
    });

    it('should NOT produce a horizontal edge when window is narrower than 651px', () => {
      Object.defineProperty(window, 'innerWidth', { value: 650, writable: true, configurable: true });

      const source = createSideTestBlock({ id: 'source' });
      const target = createSideTestBlock({ id: 'target' });
      stubRect(target);

      const bm = createSideBlockManager([target, source]);
      const det = new DropTargetDetector(createSideUIAdapter(), bm);
      det.setSourceBlocks([source]);

      document.body.appendChild(target.holder);
      const inner = document.createElement('div');
      target.holder.appendChild(inner);

      const result = det.determineDropTarget(inner, 480, 150, source);

      expect(result).not.toBeNull();
      expect(['top', 'bottom']).toContain(result?.edge);

      document.body.removeChild(target.holder);
    });
  });

  describe('more toggle nesting detection', () => {
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
