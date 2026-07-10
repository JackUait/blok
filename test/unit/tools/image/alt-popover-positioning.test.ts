import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openAltPopover } from '../../../../src/tools/image/alt-popover';

const POPOVER_SELECTOR = '[data-role="image-alt-popover"]';

/**
 * Dispatch a capture-phase pointerdown whose target is the given element.
 * The shared dismissal layer keys outside-dismiss off pointerdown.
 * @param target - the event target to simulate the press on
 */
const pressPointerDown = (target: EventTarget): void => {
  const event = new PointerEvent('pointerdown', { bubbles: true });

  Object.defineProperty(event, 'target', { value: target });
  document.dispatchEvent(event);
};

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

/**
 * Stubs offsetWidth/offsetHeight on an element (jsdom reports 0 for both).
 * @param el - element to stub
 * @param width - width to report
 * @param height - height to report
 */
const stubSize = (el: HTMLElement, width: number, height: number): void => {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
};

describe('openAltPopover — shared positioning engine', () => {
  let anchor: HTMLElement;
  let detach: (() => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768, writable: true });

    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    detach = null;
  });

  afterEach(() => {
    detach?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const open = (): void => {
    detach = openAltPopover({
      anchor,
      value: '',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });
  };

  const queryPopover = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(POPOVER_SELECTOR);

  it('places the popover below the anchor via the shared engine (left-aligned, data attributes stamped)', () => {
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 })
    );

    open();

    const popover = queryPopover();

    if (popover === null) {
      throw new Error('popover missing');
    }

    expect(popover.dataset.side).toBe('bottom');
    expect(popover.dataset.align).toBe('start');
    // anchor.bottom (140) + offset (8) = 148; anchor.left = 50
    expect(popover.style.top).toBe('148px');
    expect(popover.style.left).toBe('50px');
  });

  it('flips above the anchor when there is no room below', () => {
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 700, bottom: 740, left: 50, right: 250, width: 200, height: 40 })
    );

    open();

    const popover = queryPopover();

    if (popover === null) {
      throw new Error('popover missing');
    }

    // Give the popover a measurable height and force a reposition via scroll.
    stubSize(popover, 320, 300);
    window.dispatchEvent(new Event('scroll'));

    expect(popover.dataset.side).toBe('top');
    // 700 - 8 - 300 = 392
    expect(popover.style.top).toBe('392px');
  });

  it('tracks the popover size via the shared tracker (ResizeObserver attach/detach)', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockResizeObserver {
      public observe = observe;

      public disconnect = disconnect;

      public unobserve = vi.fn();
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    try {
      open();

      const popover = queryPopover();

      expect(popover).not.toBeNull();
      expect(observe).toHaveBeenCalledWith(popover);

      detach?.();
      detach = null;

      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('repositions on scroll while open and stops after detach', () => {
    const rectSpy = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 })
    );

    open();

    const popover = queryPopover();

    if (popover === null) {
      throw new Error('popover missing');
    }

    rectSpy.mockReturnValue(
      rect({ top: 60, bottom: 100, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('scroll'));

    expect(popover.style.top).toBe('108px');

    detach?.();
    detach = null;

    const lastTop = popover.style.top;

    rectSpy.mockReturnValue(
      rect({ top: 200, bottom: 240, left: 50, right: 250, width: 200, height: 40 })
    );
    window.dispatchEvent(new Event('scroll'));

    expect(popover.style.top).toBe(lastTop);
  });

  describe('outside-dismiss reopen guard', () => {
    it('ignores a re-open on the same anchor right after an outside-pointer dismissal', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-02T10:00:00Z'));

      const onSave = vi.fn();

      detach = openAltPopover({ anchor, value: '', onSave, onCancel: vi.fn() });

      // In real browsers the modal `inert` retargets the trigger press to body:
      // the layer dismisses, and the subsequent click on the (no longer inert)
      // trigger would instantly re-open the popover.
      pressPointerDown(document.body);

      expect(onSave).toHaveBeenCalled();
      expect(queryPopover()).toBeNull();

      // The click handler fires ~immediately after the pointerdown dismissal.
      vi.setSystemTime(new Date('2026-07-02T10:00:00.050Z'));

      detach = openAltPopover({ anchor, value: '', onSave: vi.fn(), onCancel: vi.fn() });

      expect(queryPopover()).toBeNull();
      expect(() => detach?.()).not.toThrow();
    });

    it('allows re-opening once the guard window has elapsed', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-02T10:00:00Z'));

      detach = openAltPopover({ anchor, value: '', onSave: vi.fn(), onCancel: vi.fn() });

      pressPointerDown(document.body);
      expect(queryPopover()).toBeNull();

      vi.setSystemTime(new Date('2026-07-02T10:00:00.500Z'));

      detach = openAltPopover({ anchor, value: '', onSave: vi.fn(), onCancel: vi.fn() });

      expect(queryPopover()).not.toBeNull();
    });

    it('does not guard re-opens on a different anchor', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-02T10:00:00Z'));

      detach = openAltPopover({ anchor, value: '', onSave: vi.fn(), onCancel: vi.fn() });

      pressPointerDown(document.body);
      expect(queryPopover()).toBeNull();

      const otherAnchor = document.createElement('button');

      document.body.appendChild(otherAnchor);

      detach = openAltPopover({ anchor: otherAnchor, value: '', onSave: vi.fn(), onCancel: vi.fn() });

      expect(queryPopover()).not.toBeNull();
    });
  });
});
