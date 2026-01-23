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
    contentRect?: DOMRect;
  }): {
    controller: BlockHoverController;
    blok: BlokModules;
    eventsDispatcher: ModuleConfig['eventsDispatcher'];
  } => {
    const contentRect = options?.contentRect ?? {
      left: 100,
      right: 700,
      top: 0,
      bottom: 800,
      width: 600,
      height: 800,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    };

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
      contentRectGetter: () => contentRect,
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

  describe('extended hover zone detection (LTR)', () => {
    it('detects block in hover zone to the left of content', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is in hover zone (left of content by 50px, within 100px)
      const event = new MouseEvent('mousemove', {
        clientX: 50, // 100 - 50 = 50, which is in the hover zone
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: nonBlockElement,
      });
    });

    it('does not detect block via hover zone when cursor is inside content area', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is inside the content area (between left and right), NOT in hover zone
      const event = new MouseEvent('mousemove', {
        clientX: 400, // Inside content area (100 < 400 < 700)
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      // Should NOT emit via hover zone (not on a block element, inside content area)
      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
    });

    it('finds correct block by Y position in hover zone', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

      const block1 = createMockBlock('block-1', 100, 200);
      const block2 = createMockBlock('block-2', 200, 300);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block1, block2];

      // Cursor is in hover zone and at Y position of block2
      const event = new MouseEvent('mousemove', {
        clientX: 50, // In hover zone
        clientY: 250, // Within block2's vertical range
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block: block2,
        target: nonBlockElement,
      });
    });
  });

  describe('extended hover zone detection (RTL)', () => {
    it('detects block in hover zone to the right of content for RTL', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is in hover zone (right of content by 50px, within 100px)
      const event = new MouseEvent('mousemove', {
        clientX: 750, // 700 + 50 = 750, which is in the hover zone
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      expect(eventsDispatcher.emit).toHaveBeenCalledWith(BlockHovered, {
        block,
        target: nonBlockElement,
      });
    });

    it('does not detect block via hover zone when cursor is inside content area (RTL)', () => {
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

      const block = createMockBlock('block-1', 150, 250);
      const nonBlockElement = document.createElement('div');

      document.body.appendChild(nonBlockElement);

      (controller as unknown as { enable: () => void }).enable();

      (blok.BlockManager as { blocks: typeof blok.BlockManager.blocks }).blocks = [block];

      // Cursor is inside the content area (between left and right), NOT in hover zone
      const event = new MouseEvent('mousemove', {
        clientX: 400, // Inside content area (100 < 400 < 700)
        clientY: 200,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: nonBlockElement });

      document.dispatchEvent(event);
      vi.runAllTimers();

      // Should NOT emit via hover zone (not on a block element, inside content area)
      expect(eventsDispatcher.emit).not.toHaveBeenCalled();
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
      const { controller, blok, eventsDispatcher } = createBlockHoverController({
        contentRect: {
          left: 100,
          right: 700,
          top: 0,
          bottom: 800,
          width: 600,
          height: 800,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        },
      });

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
});
