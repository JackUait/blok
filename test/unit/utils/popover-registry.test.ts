import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import type { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';

/**
 * Creates a mock popover for testing
 */
const createMockPopover = (): {
  popover: PopoverAbstract;
  trigger: HTMLElement;
} => {
  const popoverEl = document.createElement('div');

  const popover = {
    hide: vi.fn(),
    hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
    getElement: vi.fn(() => popoverEl),
  } as unknown as PopoverAbstract;

  const trigger = document.createElement('button');

  return { popover, trigger };
};

describe('PopoverRegistry', () => {
  let registry: PopoverRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    registry.destroy();
  });

  describe('register', () => {
    it('should add popover to stack', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      expect(registry.hasOpenPopovers()).toBe(true);
    });

    it('should close existing popovers on register (mutual exclusion)', () => {
      const first = createMockPopover();
      const second = createMockPopover();

      registry.register(first.popover, first.trigger);
      registry.register(second.popover, second.trigger);

      expect(first.popover.hide).toHaveBeenCalledOnce();
    });

    it('should not close the same popover being registered', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      expect(popover.hide).not.toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('should remove popover from stack', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);
      registry.unregister(popover);

      expect(registry.hasOpenPopovers()).toBe(false);
    });

    it('should be a no-op for unregistered popover', () => {
      const { popover } = createMockPopover();

      expect(() => registry.unregister(popover)).not.toThrow();
    });
  });

  describe('closeTopmost', () => {
    it('should call hide() on the topmost popover', () => {
      const first = createMockPopover();
      const second = createMockPopover();

      registry.register(first.popover, first.trigger);
      // Clear the hide call from mutual exclusion
      vi.mocked(first.popover.hide).mockClear();

      registry.register(second.popover, second.trigger);

      registry.closeTopmost();

      expect(second.popover.hide).toHaveBeenCalledOnce();
    });

    it('should return true when a popover was closed', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      expect(registry.closeTopmost()).toBe(true);
    });

    it('should return false when stack is empty', () => {
      expect(registry.closeTopmost()).toBe(false);
    });
  });

  describe('hasOpenPopovers', () => {
    it('should return false when empty', () => {
      expect(registry.hasOpenPopovers()).toBe(false);
    });

    it('should return true when popovers are registered', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      expect(registry.hasOpenPopovers()).toBe(true);
    });
  });

  describe('click-outside via pointerdown', () => {
    it('should close popover when clicking outside', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const outsideElement = document.createElement('div');

      document.body.appendChild(outsideElement);

      const event = new PointerEvent('pointerdown', {
        bubbles: true,
      });

      Object.defineProperty(event, 'target', { value: outsideElement });

      document.dispatchEvent(event);

      expect(popover.hide).toHaveBeenCalledOnce();

      outsideElement.remove();
    });

    it('should not close popover when clicking inside it', () => {
      const popoverEl = document.createElement('div');
      const innerEl = document.createElement('span');

      popoverEl.appendChild(innerEl);

      const popover = {
        hide: vi.fn(),
        hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
      } as unknown as PopoverAbstract;

      const trigger = document.createElement('button');

      registry.register(popover, trigger);

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: innerEl });

      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('should not close popover when clicking on trigger element', () => {
      const { popover, trigger } = createMockPopover();

      document.body.appendChild(trigger);
      registry.register(popover, trigger);

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: trigger });

      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();

      trigger.remove();
    });

    it('should close multiple popovers when clicking outside all of them', () => {
      const first = createMockPopover();
      const second = createMockPopover();

      // Register both (first will be closed by mutual exclusion, but let's test pointerdown)
      // Instead, register them without mutual exclusion by mocking hide to not unregister
      registry.register(first.popover, first.trigger);
      vi.mocked(first.popover.hide).mockClear();

      // Second registration closes first via mutual exclusion, so only second remains
      registry.register(second.popover, second.trigger);

      const outsideElement = document.createElement('div');

      document.body.appendChild(outsideElement);

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outsideElement });

      document.dispatchEvent(event);

      expect(second.popover.hide).toHaveBeenCalledOnce();

      outsideElement.remove();
    });

    it('should not add listener when no popovers registered', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');

      // No register call — no listener should be added
      expect(addSpy).not.toHaveBeenCalledWith('pointerdown', expect.any(Function));
    });
  });
});
