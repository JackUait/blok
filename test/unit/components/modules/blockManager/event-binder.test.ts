import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BlockEventBinder, type ModuleListeners } from '../../../../../src/components/modules/blockManager/event-binder';
import type { BlockEventBinderDependencies } from '../../../../../src/components/modules/blockManager/event-binder';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { Block } from '../../../../../src/components/block';

/**
 * Create a mock BlockEvents module
 */
const createMockBlockEvents = () => ({
  keydown: vi.fn(),
  keyup: vi.fn(),
  input: vi.fn(),
  handleCommandX: vi.fn(),
  handleCommandC: vi.fn(),
});

/**
 * Create a mock ModuleListeners object
 */
const createMockListeners = (): ModuleListeners => {
  const boundListeners: Array<{
    element: EventTarget;
    eventType: string;
    handler: (event: Event) => void;
  }> = [];

  return {
    on: vi.fn((element, eventType, handler) => {
      boundListeners.push({ element, eventType, handler });
      // Actually bind the event so we can test it
      element.addEventListener(eventType, handler);
    }),
    clearAll: vi.fn(() => {
      for (const { element, eventType, handler } of boundListeners) {
        element.removeEventListener(eventType, handler);
      }
      boundListeners.length = 0;
    }),
  };
};

/**
 * Create a mock EventsDispatcher
 */
const createMockEventsDispatcher = (): EventsDispatcher<BlokEventMap> => {
  return new EventsDispatcher<BlokEventMap>();
};

/**
 * Create a mock Block for testing
 */
const createMockBlock = (id = 'test-block'): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', 'block');

  const block = {
    id,
    holder,
    name: 'paragraph',
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Block;

  return block;
};

/**
 * Create mock dependencies for BlockEventBinder
 */
const createMockDependencies = (): BlockEventBinderDependencies => ({
  blockEvents: createMockBlockEvents() as unknown as BlockEventBinderDependencies['blockEvents'],
  listeners: createMockListeners(),
  eventsDispatcher: createMockEventsDispatcher(),
  getBlockIndex: vi.fn(() => 0),
  onBlockMutated: vi.fn((_, block) => block),
});

describe('BlockEventBinder', () => {
  let binder: BlockEventBinder;
  let dependencies: BlockEventBinderDependencies;
  let mockListeners: ModuleListeners;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies = createMockDependencies();
    mockListeners = dependencies.listeners;
    binder = new BlockEventBinder(dependencies);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('bindBlockEvents', () => {
    it('binds keydown event to block holder', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      expect(mockListeners.on).toHaveBeenCalledWith(
        block.holder,
        'keydown',
        expect.any(Function)
      );
    });

    it('binds keyup event to block holder', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      expect(mockListeners.on).toHaveBeenCalledWith(
        block.holder,
        'keyup',
        expect.any(Function)
      );
    });

    it('binds input event to block holder', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      expect(mockListeners.on).toHaveBeenCalledWith(
        block.holder,
        'input',
        expect.any(Function)
      );
    });

    it('binds didMutated event and emits BlockChanged', () => {
      const block = createMockBlock();

      binder.bindBlockEvents(block);

      // Verify block.on was called for didMutated
      expect(block.on).toHaveBeenCalledWith(
        'didMutated',
        expect.any(Function)
      );

      // Get the callback and invoke it
      const didMutatedCallback = (block.on as ReturnType<typeof vi.fn>).mock.calls.find(
        call => call[0] === 'didMutated'
      )?.[1];

      if (didMutatedCallback) {
        didMutatedCallback(block);
      }

      expect(dependencies.onBlockMutated).toHaveBeenCalledWith(
        'block-changed',
        block,
        { index: 0 }
      );
    });

    it('delegates to BlockEvents.keydown when keydown event fires', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      // Dispatch real keydown event to verify it reaches BlockEvents
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      block.holder.dispatchEvent(event);

      expect(dependencies.blockEvents.keydown).toHaveBeenCalledWith(event);
    });

    it('delegates to BlockEvents.keyup when keyup event fires', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      // Dispatch real keyup event to verify it reaches BlockEvents
      const event = new KeyboardEvent('keyup', { key: 'a' });
      block.holder.dispatchEvent(event);

      expect(dependencies.blockEvents.keyup).toHaveBeenCalledWith(event);
    });

    it('delegates to BlockEvents.input when input event fires', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      // Dispatch real input event to verify it reaches BlockEvents
      const event = new InputEvent('input', { data: 'a' });
      block.holder.dispatchEvent(event);

      expect(dependencies.blockEvents.input).toHaveBeenCalledWith(event);
    });

    it('does not bind non-KeyboardEvent to keydown handler', () => {
      const block = createMockBlock();
      binder.bindBlockEvents(block);

      // Regular Event('keydown') is not a KeyboardEvent (no key property)
      const event = new Event('keydown');
      block.holder.dispatchEvent(event);

      // Should not call BlockEvents.keydown for non-KeyboardEvent
      expect(dependencies.blockEvents.keydown).not.toHaveBeenCalled();
    });
  });

  describe('enableBindings', () => {
    it('binds document cut event when enabled', () => {
      const blocks = [createMockBlock('block-1'), createMockBlock('block-2')];

      binder.enableBindings(blocks);

      expect(mockListeners.on).toHaveBeenCalledWith(
        document,
        'cut',
        expect.any(Function)
      );
    });

    it('enables bindings for all blocks when enabled', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const blocks = [block1, block2];

      binder.enableBindings(blocks);

      // Should bind events for both blocks
      expect(block1.on).toHaveBeenCalledWith('didMutated', expect.any(Function));
      expect(block2.on).toHaveBeenCalledWith('didMutated', expect.any(Function));

      // Each block should have 3 event bindings (keydown, keyup, input)
      expect(mockListeners.on).toHaveBeenCalledWith(block1.holder, 'keydown', expect.any(Function));
      expect(mockListeners.on).toHaveBeenCalledWith(block1.holder, 'keyup', expect.any(Function));
      expect(mockListeners.on).toHaveBeenCalledWith(block1.holder, 'input', expect.any(Function));
      expect(mockListeners.on).toHaveBeenCalledWith(block2.holder, 'keydown', expect.any(Function));
      expect(mockListeners.on).toHaveBeenCalledWith(block2.holder, 'keyup', expect.any(Function));
      expect(mockListeners.on).toHaveBeenCalledWith(block2.holder, 'input', expect.any(Function));
    });

    it('calls handleCommandX when cut event fires', () => {
      const blocks = [createMockBlock()];
      binder.enableBindings(blocks);

      // Dispatch real cut event to document to verify it reaches BlockEvents
      const event = new Event('cut', { bubbles: true }) as Event & { clipboardData: DataTransfer | null };
      event.clipboardData = null;
      document.dispatchEvent(event);

      expect(dependencies.blockEvents.handleCommandX).toHaveBeenCalledWith(event);
    });

    it('handles empty blocks array', () => {
      const blocks: Block[] = [];

      binder.enableBindings(blocks);

      // Should still bind document cut event
      expect(mockListeners.on).toHaveBeenCalledWith(
        document,
        'cut',
        expect.any(Function)
      );
    });
  });

  describe('disableBindings', () => {
    it('disables all bindings when disabled', () => {
      const block = createMockBlock('test-block');
      const blocks = [block];

      binder.enableBindings(blocks);

      // Verify event is handled before disable
      const eventBefore = new KeyboardEvent('keydown', { key: 'a' });
      block.holder.dispatchEvent(eventBefore);
      expect(dependencies.blockEvents.keydown).toHaveBeenCalledWith(eventBefore);

      binder.disableBindings();

      // Verify event is no longer handled after disable
      const eventAfter = new KeyboardEvent('keydown', { key: 'b' });
      block.holder.dispatchEvent(eventAfter);
      // The keydown call count should still be 1 (from before disable)
      expect(dependencies.blockEvents.keydown).toHaveBeenCalledTimes(1);
    });

    it('can call disableBindings without calling enableBindings first', () => {
      // Should not throw
      expect(() => {
        binder.disableBindings();
      }).not.toThrow();
    });

    it('clears all mutable listeners', () => {
      const block = createMockBlock('test-block');
      binder.enableBindings([block]);

      // Verify initial state
      expect(dependencies.blockEvents.keydown).not.toHaveBeenCalled();

      binder.disableBindings();

      // After disable, dispatching events should not reach BlockEvents
      const event = new KeyboardEvent('keydown', { key: 'a' });
      block.holder.dispatchEvent(event);
      expect(dependencies.blockEvents.keydown).not.toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('handles enable/disable cycle correctly', () => {
      const block = createMockBlock();
      const blocks = [block];

      // Enable and verify events are handled
      binder.enableBindings(blocks);
      const event1 = new KeyboardEvent('keydown', { key: 'a' });
      block.holder.dispatchEvent(event1);
      expect(dependencies.blockEvents.keydown).toHaveBeenCalledWith(event1);

      // Disable and verify events are NOT handled
      binder.disableBindings();
      const event2 = new KeyboardEvent('keydown', { key: 'b' });
      block.holder.dispatchEvent(event2);
      expect(dependencies.blockEvents.keydown).toHaveBeenCalledTimes(1);

      // Re-enable and verify events are handled again
      binder.enableBindings(blocks);
      const event3 = new KeyboardEvent('keydown', { key: 'c' });
      block.holder.dispatchEvent(event3);
      expect(dependencies.blockEvents.keydown).toHaveBeenCalledTimes(2);
    });

    it('binds events to multiple independent blocks', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      binder.bindBlockEvents(block1);
      binder.bindBlockEvents(block2);
      binder.bindBlockEvents(block3);

      expect(block1.on).toHaveBeenCalledWith('didMutated', expect.any(Function));
      expect(block2.on).toHaveBeenCalledWith('didMutated', expect.any(Function));
      expect(block3.on).toHaveBeenCalledWith('didMutated', expect.any(Function));
    });

    it('uses correct getBlockIndex callback for each block', () => {
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      dependencies.getBlockIndex = vi.fn((block) => {
        return block.id === 'block-1' ? 0 : 1;
      });

      binder.bindBlockEvents(block1);
      binder.bindBlockEvents(block2);

      // Trigger didMutated for block1
      const block1Callback = (block1.on as ReturnType<typeof vi.fn>).mock.calls.find(
        call => call[0] === 'didMutated'
      )?.[1];

      if (block1Callback) {
        block1Callback(block1);
      }

      expect(dependencies.onBlockMutated).toHaveBeenCalledWith(
        'block-changed',
        block1,
        { index: 0 }
      );

      // Trigger didMutated for block2
      const block2Callback = (block2.on as ReturnType<typeof vi.fn>).mock.calls.find(
        call => call[0] === 'didMutated'
      )?.[1];

      if (block2Callback) {
        block2Callback(block2);
      }

      expect(dependencies.onBlockMutated).toHaveBeenCalledWith(
        'block-changed',
        block2,
        { index: 1 }
      );
    });
  });
});
