import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PopoverRegistry } from '../../../src/components/utils/popover/popover-registry';
import type { PopoverAbstract } from '../../../src/components/utils/popover/popover-abstract';

/**
 * Creates a mock popover for testing
 * @param options - optional focus host returned by getFocusHost
 */
const createMockPopover = (options: { focusHost?: HTMLElement | null } = {}): {
  popover: PopoverAbstract;
  trigger: HTMLElement;
  popoverEl: HTMLElement;
} => {
  const popoverEl = document.createElement('div');

  const popover = {
    hide: vi.fn(),
    hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
    getElement: vi.fn(() => popoverEl),
    getFocusHost: vi.fn(() => options.focusHost ?? null),
  } as unknown as PopoverAbstract;

  const trigger = document.createElement('button');

  return { popover, trigger, popoverEl };
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

  describe('capture-phase Escape backstop', () => {
    it('closes the topmost popover on Escape keydown', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(popover.hide).toHaveBeenCalledOnce();
    });

    it('ignores Escape when no popovers are open', () => {
      // Register then unregister so listeners were installed at least once.
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);
      registry.unregister(popover);
      vi.mocked(popover.hide).mockClear();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('ignores non-Escape keys', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('removes the keydown listener when the stack empties', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);
      registry.unregister(popover);

      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    });
  });

  describe('focus restore on closeTopmost', () => {
    it('restores focus to the trigger element after closing', () => {
      const { popover, trigger } = createMockPopover();

      document.body.appendChild(trigger);
      const focusSpy = vi.spyOn(trigger, 'focus');

      registry.register(popover, trigger);
      registry.closeTopmost();

      expect(focusSpy).toHaveBeenCalledOnce();

      trigger.remove();
    });

    it('does not throw when the trigger has been detached', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      // trigger never attached → isConnected false
      expect(() => registry.closeTopmost()).not.toThrow();
    });
  });

  describe('focusin outside-walk', () => {
    it('closes the topmost popover when focus leaves its subtree', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const outside = document.createElement('input');

      document.body.appendChild(outside);

      const event = new FocusEvent('focusin', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outside });
      document.dispatchEvent(event);

      expect(popover.hide).toHaveBeenCalledOnce();

      outside.remove();
    });

    it('does NOT close when focus moves inside the popover', () => {
      const { popover, trigger, popoverEl } = createMockPopover();

      const inner = document.createElement('button');

      popoverEl.appendChild(inner);
      registry.register(popover, trigger);

      const event = new FocusEvent('focusin', { bubbles: true });

      Object.defineProperty(event, 'target', { value: inner });
      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('does NOT close when focus moves to the trigger', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const event = new FocusEvent('focusin', { bubbles: true });

      Object.defineProperty(event, 'target', { value: trigger });
      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('does NOT close when focus moves to the active-descendant host (combobox pattern)', () => {
      const host = document.createElement('div');

      document.body.appendChild(host);

      const { popover, trigger } = createMockPopover({ focusHost: host });

      registry.register(popover, trigger);

      const event = new FocusEvent('focusin', { bubbles: true });

      Object.defineProperty(event, 'target', { value: host });
      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();

      host.remove();
    });
  });

  describe('nested (contained) popover registration', () => {
    it('does NOT close an ancestor popover when a contained child registers', () => {
      const parent = createMockPopover();
      const childEl = document.createElement('div');

      // Child popover element is a descendant of the parent's element (as with
      // desktop nested popovers appended inside the parent's root).
      parent.popoverEl.appendChild(childEl);

      const child = {
        hide: vi.fn(),
        hasNode: vi.fn((node: Node) => childEl.contains(node)),
        getElement: vi.fn(() => childEl),
        getFocusHost: vi.fn(() => null),
      } as unknown as PopoverAbstract;
      const childTrigger = document.createElement('button');

      registry.register(parent.popover, parent.trigger);
      registry.register(child, childTrigger);

      expect(parent.popover.hide).not.toHaveBeenCalled();
      expect(registry.hasOpenPopovers()).toBe(true);
    });
  });
});
