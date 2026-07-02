import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { hasEscapeLayer, registerLayer } from '../../../src/components/utils/dismissable-layer';

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

    it('walks past a topmost escape-opted-out layer and dismisses the layer beneath it', () => {
      const modalEl = makeLayerElement();
      const toastEl = makeLayerElement();
      const modalDismiss = vi.fn();
      const toastDismiss = vi.fn();

      const unregisterModal = registerLayer({ element: modalEl, onDismiss: modalDismiss });
      // A toast that opted out of Escape must not shield the modal below it.
      const unregisterToast = registerLayer({ element: toastEl, onDismiss: toastDismiss, escape: false });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(toastDismiss).not.toHaveBeenCalled();
      expect(modalDismiss).toHaveBeenCalledTimes(1);
      expect(modalDismiss).toHaveBeenCalledWith('escape');

      unregisterModal();
      unregisterToast();
    });

    it('consumes the Escape event when it dismisses a layer (preventDefault + stopImmediatePropagation)', () => {
      const element = makeLayerElement();
      const onDismiss = vi.fn();
      const laterListener = vi.fn();

      const unregister = registerLayer({ element, onDismiss });

      // Registered after the layer stack's listener, same phase: a consumed
      // dismissal must stop it so no second surface peels on the same press.
      document.addEventListener('keydown', laterListener, true);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      document.dispatchEvent(event);

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(laterListener).not.toHaveBeenCalled();

      document.removeEventListener('keydown', laterListener, true);
      unregister();
    });

    it('does NOT consume Escape when no layer participates in escape dismissal', () => {
      const element = makeLayerElement();
      const laterListener = vi.fn();

      const unregister = registerLayer({ element, onDismiss: vi.fn(), escape: false });

      document.addEventListener('keydown', laterListener, true);

      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(laterListener).toHaveBeenCalledTimes(1);

      document.removeEventListener('keydown', laterListener, true);
      unregister();
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

    it('walks past a topmost outside-opted-out layer and dismisses the layer beneath it', () => {
      const modalEl = makeLayerElement();
      const toastEl = makeLayerElement();
      const outside = makeLayerElement();
      const modalDismiss = vi.fn();
      const toastDismiss = vi.fn();

      const unregisterModal = registerLayer({ element: modalEl, onDismiss: modalDismiss });
      // A toast (outside: false) must not shield the modal below it from
      // outside-click dismissal.
      const unregisterToast = registerLayer({ element: toastEl, onDismiss: toastDismiss, outside: false });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outside });
      document.dispatchEvent(event);

      expect(toastDismiss).not.toHaveBeenCalled();
      expect(modalDismiss).toHaveBeenCalledTimes(1);
      expect(modalDismiss).toHaveBeenCalledWith('outside');

      unregisterModal();
      unregisterToast();
    });

    it('does NOT dismiss a lower layer when the press lands inside a non-participating layer above it', () => {
      const modalEl = makeLayerElement();
      const toastEl = makeLayerElement();
      const toastInner = document.createElement('span');

      toastEl.appendChild(toastInner);
      const modalDismiss = vi.fn();
      const toastDismiss = vi.fn();

      const unregisterModal = registerLayer({ element: modalEl, onDismiss: modalDismiss });
      const unregisterToast = registerLayer({ element: toastEl, onDismiss: toastDismiss, outside: false });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: toastInner });
      document.dispatchEvent(event);

      // Click inside the toast is inside the layer system — nothing dismisses.
      expect(toastDismiss).not.toHaveBeenCalled();
      expect(modalDismiss).not.toHaveBeenCalled();

      unregisterModal();
      unregisterToast();
    });

    it('dismisses only one layer per pointerdown even when several participate', () => {
      const lowerEl = makeLayerElement();
      const upperEl = makeLayerElement();
      const outside = makeLayerElement();
      const lowerDismiss = vi.fn();
      const upperDismiss = vi.fn();

      const unregisterLower = registerLayer({ element: lowerEl, onDismiss: lowerDismiss });
      const unregisterUpper = registerLayer({ element: upperEl, onDismiss: upperDismiss });

      const event = new PointerEvent('pointerdown', { bubbles: true });

      Object.defineProperty(event, 'target', { value: outside });
      document.dispatchEvent(event);

      expect(upperDismiss).toHaveBeenCalledTimes(1);
      expect(lowerDismiss).not.toHaveBeenCalled();

      unregisterLower();
      unregisterUpper();
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

  describe('hasEscapeLayer', () => {
    it('returns false when no layers are registered', () => {
      expect(hasEscapeLayer()).toBe(false);
    });

    it('returns true while an escape-participating layer is registered', () => {
      const unregister = registerLayer({ element: makeLayerElement(), onDismiss: vi.fn() });

      expect(hasEscapeLayer()).toBe(true);

      unregister();

      expect(hasEscapeLayer()).toBe(false);
    });

    it('returns false when only escape-opted-out layers are registered', () => {
      const unregister = registerLayer({ element: makeLayerElement(), onDismiss: vi.fn(), escape: false });

      expect(hasEscapeLayer()).toBe(false);

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
