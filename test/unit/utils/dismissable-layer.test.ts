import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { registerLayer } from '../../../src/components/utils/dismissable-layer';

describe('dismissable-layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const makeLayerElement = (): HTMLElement => {
    const el = document.createElement('div');

    document.body.appendChild(el);

    return el;
  };

  describe('escape dismissal', () => {
    it('dismisses the topmost layer that opted into escape on Escape keydown', () => {
      const element = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(onDismiss).toHaveBeenCalledTimes(1);

      unregister();
    });

    it('does NOT dismiss when escape is opted out', () => {
      const element = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss, escape: false });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(onDismiss).not.toHaveBeenCalled();

      unregister();
    });

    it('dismisses only the topmost layer, not the ones beneath it', () => {
      const firstEl = makeLayerElement();
      const secondEl = makeLayerElement();
      const firstDismiss = vi.fn();
      const secondDismiss = vi.fn();

      const unregisterFirst = registerLayer({ element: firstEl, onDismiss: firstDismiss });
      const unregisterSecond = registerLayer({ element: secondEl, onDismiss: secondDismiss });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(secondDismiss).toHaveBeenCalledTimes(1);
      expect(firstDismiss).not.toHaveBeenCalled();

      unregisterFirst();
      unregisterSecond();
    });

    it('ignores non-Escape keys', () => {
      const element = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(onDismiss).not.toHaveBeenCalled();

      unregister();
    });
  });

  describe('outside pointerdown dismissal', () => {
    it('dismisses the topmost layer when pointerdown lands outside its element', () => {
      const element = makeLayerElement();
      const outside = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outside });
      document.dispatchEvent(event);

      expect(onDismiss).toHaveBeenCalledTimes(1);

      unregister();
    });

    it('does NOT dismiss when pointerdown lands inside its element', () => {
      const element = makeLayerElement();
      const inner = document.createElement('span');

      element.appendChild(inner);
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: inner });
      document.dispatchEvent(event);

      expect(onDismiss).not.toHaveBeenCalled();

      unregister();
    });

    it('does NOT dismiss on outside pointerdown when outside is opted out', () => {
      const element = makeLayerElement();
      const outside = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, onDismiss, outside: false });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outside });
      document.dispatchEvent(event);

      expect(onDismiss).not.toHaveBeenCalled();

      unregister();
    });

    it('treats pointerdown inside the anchor as inside (does not dismiss)', () => {
      const element = makeLayerElement();
      const anchor = makeLayerElement();
      const onDismiss = vi.fn();

      const unregister = registerLayer({ element, anchor, onDismiss });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: anchor });
      document.dispatchEvent(event);

      expect(onDismiss).not.toHaveBeenCalled();

      unregister();
    });
  });

  describe('listener lifecycle', () => {
    it('adds document listeners lazily on first registration', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');

      const element = makeLayerElement();
      const unregister = registerLayer({ element, onDismiss: vi.fn() });

      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);

      unregister();
    });

    it('removes document listeners when the stack empties', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const element = makeLayerElement();
      const unregister = registerLayer({ element, onDismiss: vi.fn() });

      unregister();

      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    });

    it('does not install listeners more than once for multiple layers', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');

      const first = registerLayer({ element: makeLayerElement(), onDismiss: vi.fn() });
      const second = registerLayer({ element: makeLayerElement(), onDismiss: vi.fn() });

      const keydownAdds = addSpy.mock.calls.filter(([type]) => type === 'keydown');

      expect(keydownAdds).toHaveLength(1);

      first();
      second();
    });

    it('unregister is idempotent', () => {
      const element = makeLayerElement();
      const onDismiss = vi.fn();
      const unregister = registerLayer({ element, onDismiss });

      unregister();

      expect(() => unregister()).not.toThrow();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
