import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockHoverController } from '../../../../../../src/components/modules/uiControllers/controllers/blockHover';
import { BlockHovered } from '../../../../../../src/components/events/BlockHovered';
import type { Block } from '../../../../../../src/components/block';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../../types';
import type { ModuleConfig } from '../../../../../../src/types-internal/module-config';

const createBlokStub = (): BlokModules => {
  return {
    BlockManager: {
      blocks: [],
      getBlockByChildNode: vi.fn(),
    },
  } as unknown as BlokModules;
};

describe('BlockHoverController', () => {
  const controllers: BlockHoverController[] = [];

  const createBlockHoverController = (options?: {
    blokOverrides?: Partial<BlokModules>;
    configOverrides?: Partial<BlokConfig>;
  }): {
    controller: BlockHoverController;
    blok: BlokModules;
    eventsDispatcher: ModuleConfig['eventsDispatcher'];
  } => {
    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as ModuleConfig['eventsDispatcher'];

    const blok = createBlokStub();

    if (options?.blokOverrides) {
      Object.assign(blok, options.blokOverrides);
    }

    const controller = new BlockHoverController({
      config: {
        holder: document.createElement('div'),
        minHeight: 50,
        ...options?.configOverrides,
      } as BlokConfig,
      eventsDispatcher: eventsDispatcher,
    });

    controller.state = blok;

    // Register for cleanup
    controllers.push(controller);

    return { controller, blok, eventsDispatcher };
  };

  const createMockBlock = (id: string, top: number, bottom: number): Block => {
    const holder = document.createElement('div');
    const rect = {
      left: 100,
      right: 700,
      top,
      bottom,
      width: 600,
      height: bottom - top,
      x: 100,
      y: top,
      toJSON: () => ({}),
    };

    vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue(rect);

    return {
      id,
      name: 'paragraph',
      holder,
    } as unknown as Block;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Disable all controllers to remove event listeners
    controllers.forEach((controller) => {
      (controller as unknown as { disable: () => void }).disable();
    });
    controllers.length = 0;

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('creates controller with dependencies', () => {
      const { controller } = createBlockHoverController();

      expect(controller).toBeInstanceOf(BlockHoverController);
    });

    it('can be enabled and disabled', () => {
      const { controller } = createBlockHoverController();

      expect(() => {
        (controller as unknown as { enable: () => void }).enable();
        (controller as unknown as { disable: () => void }).disable();
      }).not.toThrow();
    });

    it('resets hover state', () => {
      const { controller } = createBlockHoverController();

      (controller as unknown as {
        blockHoveredState: { lastHoveredBlockId: string | null };
      }).blockHoveredState.lastHoveredBlockId = 'block-1';

      controller.resetHoverState();

      expect(
        (controller as unknown as {
          blockHoveredState: { lastHoveredBlockId: string | null };
        }).blockHoveredState.lastHoveredBlockId
      ).toBeNull();
    });
  });

  describe('direct block hover detection', () => {
    it('emits BlockHovered event when hovering over block wrapper', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const block = createMockBlock('block-1', 100, 200);
      const blockWrapper = document.createElement('div');

      blockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
      document.body.appendChild(blockWrapper);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];
      vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(block);

      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 150,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: blockWrapper });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: blockWrapper,
      });
    });

    it('does not emit duplicate events for same block', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const block = createMockBlock('block-1', 100, 200);
      const blockWrapper = document.createElement('div');

      blockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
      document.body.appendChild(blockWrapper);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];
      vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(block);

      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 150,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: blockWrapper });

      document.dispatchEvent(event);
      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(1);
      // Verify that the single emitted event was for the correct block
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: blockWrapper,
      });
    });

    it('does not emit event when block not found', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const blockWrapper = document.createElement('div');

      blockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
      document.body.appendChild(blockWrapper);

      (controller as unknown as { enable: () => void }).enable();

      vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(undefined);

      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 150,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: blockWrapper });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
    });

    it('emits event when moving to different block', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const block1 = createMockBlock('block-1', 100, 200);
      const block2 = createMockBlock('block-2', 200, 300);
      const blockWrapper1 = document.createElement('div');
      const blockWrapper2 = document.createElement('div');

      blockWrapper1.setAttribute('data-blok-testid', 'block-wrapper');
      blockWrapper2.setAttribute('data-blok-testid', 'block-wrapper');
      document.body.appendChild(blockWrapper1);
      document.body.appendChild(blockWrapper2);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];
      vi.mocked(blok.BlockManager.getBlockByChildNode)
        .mockReturnValueOnce(block1)
        .mockReturnValueOnce(block2);

      const event1 = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 150,
        bubbles: true,
      });
      Object.defineProperty(event1, 'target', { value: blockWrapper1 });

      const event2 = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 250,
        bubbles: true,
      });
      Object.defineProperty(event2, 'target', { value: blockWrapper2 });

      document.dispatchEvent(event1);
      document.dispatchEvent(event2);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(2);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block1,
        target: blockWrapper1,
      });
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block2,
        target: blockWrapper2,
      });
    });
  });

  describe('nearest block detection (LTR)', () => {
    it('finds nearest block when cursor is to the left of content area', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is to the left of content, nearest block detection finds block by Y
      const event = new MouseEvent('mousemove', {
        clientX: 50, // Left of content area
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });

    it('finds nearest block when cursor is inside content area but not on a block element', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is inside the content area but not on a block element
      const event = new MouseEvent('mousemove', {
        clientX: 400, // Inside content area (100 < 400 < 700)
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });

    it('finds correct block by Y position when cursor is outside content area', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block1 = createMockBlock('block-1', 100, 200);
      const block2 = createMockBlock('block-2', 200, 300);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];

      // Cursor is outside content area and at Y position of block2
      const event = new MouseEvent('mousemove', {
        clientX: 50, // Outside content area
        clientY: 250, // Within block2's vertical range
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block2,
        target: block2.holder,
      });
    });
  });

  describe('nearest block detection (RTL)', () => {
    it('finds nearest block when cursor is to the right of content area (RTL)', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is to the right of content area, nearest block detection finds block by Y
      const event = new MouseEvent('mousemove', {
        clientX: 750, // Right of content area
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });

    it('finds nearest block when cursor is inside content area but not on a block element (RTL)', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is inside the content area but not on a block element
      const event = new MouseEvent('mousemove', {
        clientX: 400, // Inside content area (100 < 400 < 700)
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });
  });

  describe('throttling', () => {
    it('throttles mousemove events', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const block = createMockBlock('block-1', 100, 200);
      const blockWrapper = document.createElement('div');

      blockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
      document.body.appendChild(blockWrapper);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];
      vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(block);

      // Trigger multiple rapid events
      for (let i = 0; i < 10; i++) {
        const event = new MouseEvent('mousemove', {
          clientX: 400 + i,
          clientY: 150 + i,
          bubbles: true,
        });
        Object.defineProperty(event, 'target', { value: blockWrapper });
        document.dispatchEvent(event);
      }

      vi.runAllTimers();

      // Should be throttled, not all 10 events processed
      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(1);
      // Verify that the throttled event was for the correct block
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: blockWrapper,
      });
    });
  });

  describe('table cell hover', () => {
    it('emits BlockHovered for the table block when hovering over a nested cell block', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const tableBlock = createMockBlock('table-block', 100, 400);

      /**
       * Build DOM hierarchy matching the real table structure:
       * Table Block wrapper (data-blok-testid="block-wrapper")
       *   └── Cell Blocks Container (data-blok-table-cell-blocks)
       *       └── Nested Block wrapper (data-blok-testid="block-wrapper")
       *           └── Paragraph content
       */
      const tableWrapper = tableBlock.holder;

      tableWrapper.setAttribute('data-blok-testid', 'block-wrapper');

      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableWrapper.appendChild(cellBlocksContainer);

      const nestedBlockWrapper = document.createElement('div');

      nestedBlockWrapper.setAttribute('data-blok-testid', 'block-wrapper');
      cellBlocksContainer.appendChild(nestedBlockWrapper);

      const paragraphContent = document.createElement('p');

      paragraphContent.textContent = 'Cell text';
      nestedBlockWrapper.appendChild(paragraphContent);

      document.body.appendChild(tableWrapper);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [tableBlock];
      vi.mocked(blok.BlockManager.getBlockByChildNode).mockReturnValue(tableBlock);

      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 250,
        bubbles: true,
      });

      Object.defineProperty(event, 'target', { value: paragraphContent });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: tableBlock,
        target: paragraphContent,
      });

      /**
       * Verify getBlockByChildNode was called with the TABLE wrapper, not the nested one
       */
      expect(blok.BlockManager.getBlockByChildNode).toHaveBeenCalledWith(tableWrapper);
    });
  });

  describe('edge cases', () => {
    it('handles MouseEvent type check', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();
      const block = createMockBlock('block-1', 100, 200);
      const target = document.createElement('div');
      document.body.appendChild(target);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Dispatch non-MouseEvent to verify type guard behavior
      // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Required to test MouseEvent type guard in event handler
      document.dispatchEvent(new Event('mousemove'));
      vi.runAllTimers();

      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
    });

    it('handles empty blocks array', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [];

      const target = document.createElement('div');
      document.body.appendChild(target);

      const event = new MouseEvent('mousemove', {
        clientX: 50,
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: target, writable: false });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
    });
  });

  describe('nearest block detection (always-visible toolbar)', () => {
    it('finds nearest block when cursor is between two blocks vertically', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block1 = createMockBlock('block-1', 100, 200);
      const block2 = createMockBlock('block-2', 250, 350);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];

      // Cursor at Y=230: block1 center=150, block2 center=300. Closer to block2.
      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 230,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block2,
        target: block2.holder,
      });
    });

    it('finds first block when cursor is above all blocks', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block1 = createMockBlock('block-1', 200, 300);
      const block2 = createMockBlock('block-2', 300, 400);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];

      // Cursor at Y=50, above all blocks
      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block1,
        target: block1.holder,
      });
    });

    it('finds last block when cursor is below all blocks', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block1 = createMockBlock('block-1', 100, 200);
      const block2 = createMockBlock('block-2', 200, 300);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];

      // Cursor at Y=500, below all blocks
      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 500,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block2,
        target: block2.holder,
      });
    });

    it('finds nearest block when cursor is inside content area but not on a block element', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor inside content area but not on a block element
      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });

    it('returns single block regardless of cursor position', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 100, 200);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor far below the only block
      const event = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 900,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });

    it('deduplicates events for nearest block same as direct hover', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController();

      const block = createMockBlock('block-1', 100, 200);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Two mousemove events at different Y positions, both resolve to the same nearest block
      const event1 = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 50,
        bubbles: true,
      });
      Object.defineProperty(event1, 'target', { value: nonBlockElement });

      const event2 = new MouseEvent('mousemove', {
        clientX: 400,
        clientY: 60,
        bubbles: true,
      });
      Object.defineProperty(event2, 'target', { value: nonBlockElement });

      document.dispatchEvent(event1);
      vi.runAllTimers();

      document.dispatchEvent(event2);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledTimes(1);
      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: block.holder,
      });
    });
  });
});
