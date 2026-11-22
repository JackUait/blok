import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isEscapeConsumed, markEscapeConsumed } from '../../../src/components/utils/consumed-escape';
import { registerLayer } from '../../../src/components/utils/dismissable-layer';
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

    it('does not push a duplicate entry when the same popover registers twice (double show without hide)', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);
      registry.register(popover, trigger);

      registry.unregister(popover);

      // A duplicate stack entry would leave hasOpenPopovers() stuck true.
      expect(registry.hasOpenPopovers()).toBe(false);
    });

    it('refreshes the trigger element when the same popover re-registers', () => {
      const { popover, trigger } = createMockPopover();
      const newTrigger = document.createElement('button');

      document.body.appendChild(newTrigger);
      const focusSpy = vi.spyOn(newTrigger, 'focus');

      registry.register(popover, trigger);
      registry.register(popover, newTrigger);

      registry.closeTopmost();

      // Focus restore proves the refreshed trigger replaced the stale one.
      expect(focusSpy).toHaveBeenCalled();
      expect(registry.hasOpenPopovers()).toBe(false);

      newTrigger.remove();
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

    // research/27 §7: a menu that opts in closes an open submenu first and stays open.
    it('closes only an open submenu when the menu says it did', () => {
      const { popover, trigger } = createMockPopover();
      const closeSubmenuOnEscape = vi.fn(() => true);

      Object.assign(popover, { closeSubmenuOnEscape });
      registry.register(popover, trigger);

      expect(registry.closeTopmost()).toBe(true);
      expect(closeSubmenuOnEscape).toHaveBeenCalledOnce();
      expect(popover.hide).not.toHaveBeenCalled();
      expect(registry.hasOpenPopovers()).toBe(true);

      closeSubmenuOnEscape.mockReturnValue(false);
      expect(registry.closeTopmost()).toBe(true);
      expect(popover.hide).toHaveBeenCalledOnce();
      expect(registry.hasOpenPopovers()).toBe(false);
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

    // Blok is published: closing a popover must not change what a host sees on the press.
    it('marks the Escape it closes a popover on as consumed, without preventing its default', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(isEscapeConsumed(event)).toBe(true);
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

    it('ignores an Escape whose default was already prevented (already consumed elsewhere)', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      event.preventDefault();
      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('ignores an Escape another Blok closer already consumed', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      markEscapeConsumed(event);
      document.dispatchEvent(event);

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('defers to the dismissable-layer stack: one Escape peels only the layer, not the popover (popover registered first)', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const layerEl = document.createElement('div');

      document.body.appendChild(layerEl);
      const layerDismiss = vi.fn();
      const unregisterLayer = registerLayer({ element: layerEl, onDismiss: layerDismiss });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

      expect(layerDismiss).toHaveBeenCalledTimes(1);
      expect(popover.hide).not.toHaveBeenCalled();

      unregisterLayer();
      layerEl.remove();
    });

    it('defers to the dismissable-layer stack: one Escape peels only the layer, not the popover (layer registered first)', () => {
      const layerEl = document.createElement('div');

      document.body.appendChild(layerEl);
      const layerDismiss = vi.fn();
      const unregisterLayer = registerLayer({ element: layerEl, onDismiss: layerDismiss });

      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

      expect(layerDismiss).toHaveBeenCalledTimes(1);
      expect(popover.hide).not.toHaveBeenCalled();

      unregisterLayer();
      layerEl.remove();
    });

    it('still closes the popover when the only registered layers opted out of Escape', () => {
      const { popover, trigger } = createMockPopover();

      registry.register(popover, trigger);

      const layerEl = document.createElement('div');

      document.body.appendChild(layerEl);
      const layerDismiss = vi.fn();
      const unregisterLayer = registerLayer({ element: layerEl, onDismiss: layerDismiss, escape: false });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

      expect(popover.hide).toHaveBeenCalledOnce();
      expect(layerDismiss).not.toHaveBeenCalled();

      unregisterLayer();
      layerEl.remove();
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

  describe('same-trigger click suppression (clicking the item that opened the popover does nothing)', () => {
    /**
     * Simulates a full press gesture on an element: pointerdown (arms the
     * suppression when the popover is already open) followed by the click.
     */
    const pressAndClick = (element: HTMLElement): void => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    it('swallows the click of a press that started on the open popover\'s interactive trigger', () => {
      const { popover, trigger } = createMockPopover();

      document.body.appendChild(trigger);
      const clickListener = vi.fn();

      trigger.addEventListener('click', clickListener);

      registry.register(popover, trigger);
      pressAndClick(trigger);

      expect(clickListener).not.toHaveBeenCalled();
      expect(popover.hide).not.toHaveBeenCalled();

      trigger.remove();
    });

    it('does not swallow the opening click (popover registered mid-gesture, after pointerdown)', () => {
      const { popover, trigger } = createMockPopover();

      document.body.appendChild(trigger);
      const clickListener = vi.fn();

      trigger.addEventListener('click', clickListener);

      // Mouseup-driven openers (settings toggler, plus button) register the
      // popover BETWEEN pointerdown and click of the same gesture.
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      registry.register(popover, trigger);
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(clickListener).toHaveBeenCalledTimes(1);

      trigger.remove();
    });

    it('does not swallow clicks when the trigger is a non-interactive anchor (e.g. a block holder)', () => {
      const holderTrigger = document.createElement('div');
      const linkInsideHolder = document.createElement('a');

      holderTrigger.appendChild(linkInsideHolder);
      document.body.appendChild(holderTrigger);

      const popoverEl = document.createElement('div');
      const popover = {
        hide: vi.fn(),
        hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
        getElement: vi.fn(() => popoverEl),
        getFocusHost: vi.fn(() => null),
      } as unknown as PopoverAbstract;

      const clickListener = vi.fn();

      linkInsideHolder.addEventListener('click', clickListener);

      registry.register(popover, holderTrigger);
      pressAndClick(linkInsideHolder);

      expect(clickListener).toHaveBeenCalledTimes(1);

      holderTrigger.remove();
    });

    it('does not swallow the click when the popover closed between press and click', () => {
      const { popover, trigger } = createMockPopover();

      document.body.appendChild(trigger);
      const clickListener = vi.fn();

      trigger.addEventListener('click', clickListener);

      registry.register(popover, trigger);
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      registry.unregister(popover);
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(clickListener).toHaveBeenCalledTimes(1);

      trigger.remove();
    });

    it('does not swallow a click landing outside the pressed trigger', () => {
      const { popover, trigger } = createMockPopover();
      const outsideElement = document.createElement('button');

      document.body.appendChild(trigger);
      document.body.appendChild(outsideElement);

      const clickListener = vi.fn();

      outsideElement.addEventListener('click', clickListener);

      registry.register(popover, trigger);
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(clickListener).toHaveBeenCalledTimes(1);

      trigger.remove();
      outsideElement.remove();
    });
  });

  describe('isOpenTrigger', () => {
    it('reports whether an element is (or is inside) the trigger of an open popover', () => {
      const { popover, trigger } = createMockPopover();
      const iconInsideTrigger = document.createElement('span');

      trigger.appendChild(iconInsideTrigger);

      expect(registry.isOpenTrigger(trigger)).toBe(false);

      registry.register(popover, trigger);

      expect(registry.isOpenTrigger(trigger)).toBe(true);
      expect(registry.isOpenTrigger(iconInsideTrigger)).toBe(true);
      expect(registry.isOpenTrigger(document.createElement('button'))).toBe(false);

      registry.unregister(popover);

      expect(registry.isOpenTrigger(trigger)).toBe(false);
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
  describe('swallowsOutsideClick (opt-in click-away backdrop)', () => {
    /** A full press: pointerdown, mousedown, mouseup, click, each cancelable. */
    const press = (element: HTMLElement): void => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    };

    const outsideTarget = (): { el: HTMLElement; seen: string[] } => {
      const el = document.createElement('div');
      const seen: string[] = [];

      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        el.addEventListener(type, () => seen.push(type));
      }
      document.body.appendChild(el);

      return { el, seen };
    };

    it('a click away closes a flagged popover and reaches nothing under it', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el, seen } = outsideTarget();

      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      press(el);

      expect(seen).toEqual([]);
      expect(popover.hide).toHaveBeenCalledOnce();
      popoverEl.remove();
      el.remove();
    });

    it('moves focus to the body', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el } = outsideTarget();
      const input = document.createElement('input');

      document.body.appendChild(input);
      input.focus();
      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      press(el);

      expect(document.body).toHaveFocus();
      popoverEl.remove();
      el.remove();
      input.remove();
    });

    it('the next click acts again, even when the swallowed press made no click', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el, seen } = outsideTarget();

      // A real popover leaves the registry when it hides.
      vi.mocked(popover.hide).mockImplementation(() => registry.unregister(popover));
      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      press(el);

      expect(seen).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
      popoverEl.remove();
      el.remove();
    });

    it('a click inside a flagged menu while its unflagged submenu is open still acts', () => {
      const parent = createMockPopover();
      const child = createMockPopover();
      const item = document.createElement('div');
      const seen: string[] = [];

      item.addEventListener('click', () => seen.push('click'));
      parent.popoverEl.appendChild(item);
      parent.popoverEl.appendChild(child.popoverEl);
      document.body.appendChild(parent.popoverEl);
      parent.popover.swallowsOutsideClick = true;
      registry.register(parent.popover, parent.trigger);
      registry.register(child.popover, child.trigger);
      press(item);

      expect(seen).toEqual(['click']);
      expect(parent.popover.hide).not.toHaveBeenCalled();
      parent.popoverEl.remove();
    });

    it('a flagged popover no longer in the document lets the click through', () => {
      const { popover, trigger } = createMockPopover();
      const { el, seen } = outsideTarget();

      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      press(el);

      expect(seen).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
      el.remove();
    });

    /** A right press, as Chrome fires it on macOS: contextmenu comes before mouseup. */
    const rightPress = (element: HTMLElement): boolean => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2 }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }));
      const notCancelled = element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));

      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 2 }));

      return notCancelled;
    };

    const rightTarget = (): { el: HTMLElement; seen: string[] } => {
      const target = outsideTarget();

      target.el.addEventListener('contextmenu', () => target.seen.push('contextmenu'));

      return target;
    };

    // notion-motion.md Round 108 §1 #2: a right-click away only closes the menu. Notion leaves the browser's own menu alone.
    it('a right-click away closes a flagged popover, opens nothing under it, and keeps the browser menu', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el, seen } = rightTarget();
      const input = document.createElement('input');

      document.body.appendChild(input);
      input.focus();
      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);

      expect(rightPress(el)).toBe(true);
      expect(seen).toEqual([]);
      expect(popover.hide).toHaveBeenCalledOnce();
      expect(document.body).toHaveFocus();
      popoverEl.remove();
      el.remove();
      input.remove();
    });

    it('the next right-click acts again', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el, seen } = rightTarget();

      vi.mocked(popover.hide).mockImplementation(() => registry.unregister(popover));
      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      rightPress(el);
      rightPress(el);

      expect(seen).toEqual(['pointerdown', 'mousedown', 'contextmenu', 'mouseup']);
      popoverEl.remove();
      el.remove();
    });

    it('an unflagged popover lets a right-click away through (the default)', () => {
      const { popover, trigger } = createMockPopover();
      const { el, seen } = rightTarget();

      registry.register(popover, trigger);
      rightPress(el);

      expect(seen).toEqual(['pointerdown', 'mousedown', 'contextmenu', 'mouseup']);
      expect(popover.hide).toHaveBeenCalledOnce();
      el.remove();
    });

    /** A middle press: pointerdown, mousedown, mouseup, auxclick. Returns whether auxclick kept its default. */
    const middlePress = (element: HTMLElement): boolean => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 1 }));

      return element.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    };

    // notion-motion.md Round 108 §1 #6: a middle click away keeps the card right-click menu open, and opens no tab.
    it('a middle click away leaves a holding popover open and reaches nothing under it', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el, seen } = outsideTarget();

      el.addEventListener('auxclick', () => seen.push('auxclick'));
      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      popover.holdsOnMiddleClick = true;
      registry.register(popover, trigger);

      expect(middlePress(el)).toBe(false);
      expect(seen).toEqual([]);
      expect(popover.hide).not.toHaveBeenCalled();
      popoverEl.remove();
      el.remove();
    });

    it('a middle click away still closes a popover that does not hold (the default)', () => {
      const { popover, trigger, popoverEl } = createMockPopover();
      const { el } = outsideTarget();

      document.body.appendChild(popoverEl);
      popover.swallowsOutsideClick = true;
      registry.register(popover, trigger);
      middlePress(el);

      expect(popover.hide).toHaveBeenCalledOnce();
      popoverEl.remove();
      el.remove();
    });

    it('an unflagged popover lets the click away through (the default)', () => {
      const { popover, trigger } = createMockPopover();
      const { el, seen } = outsideTarget();

      registry.register(popover, trigger);
      press(el);

      expect(seen).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
      expect(popover.hide).toHaveBeenCalledOnce();
      el.remove();
    });
  });
});
