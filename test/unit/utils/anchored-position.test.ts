import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  positionAnchored,
  positionFixedAnchored,
  createPositionTracker,
} from '../../../src/components/utils/popover/anchored-position';

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

describe('anchored-position', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;
  let originalScrollX: number;
  let originalScrollY: number;

  beforeEach(() => {
    vi.clearAllMocks();

    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    originalScrollX = window.scrollX;
    originalScrollY = window.scrollY;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768, writable: true });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight, writable: true });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: originalScrollX, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: originalScrollY, writable: true });

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('positionAnchored — vertical primary', () => {
    it('places content below the anchor and stamps data-side/data-align', () => {
      const content = document.createElement('div');

      stubSize(content, 200, 150);
      document.body.appendChild(content);

      const anchor = rect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 });

      const resolved = positionAnchored(content, anchor, { side: 'bottom', offset: 8 });

      expect(resolved.side).toBe('bottom');
      expect(resolved.align).toBe('start');
      // anchor.bottom (140) + offset (8) = 148
      expect(resolved.top).toBe(148);
      expect(content.style.top).toBe('148px');
      expect(content.dataset.side).toBe('bottom');
      expect(content.dataset.align).toBe('start');
    });

    it('flips above the anchor when there is no room below', () => {
      const content = document.createElement('div');

      stubSize(content, 200, 300);
      document.body.appendChild(content);

      const anchor = rect({ top: 700, bottom: 740, left: 50, right: 250, width: 200, height: 40 });

      const resolved = positionAnchored(content, anchor, { side: 'bottom', offset: 8 });

      expect(resolved.side).toBe('top');
      expect(content.dataset.side).toBe('top');
      // 700 - 8 - 300 = 392
      expect(resolved.top).toBe(392);
    });

    it('reports align=end when the content flips to the left edge', () => {
      const content = document.createElement('div');

      stubSize(content, 400, 100);
      document.body.appendChild(content);

      // Anchor hugging the right edge: content flips left (openLeft)
      const anchor = rect({ top: 100, bottom: 140, left: 900, right: 1000, width: 100, height: 40 });

      const resolved = positionAnchored(content, anchor, { side: 'bottom' });

      expect(resolved.align).toBe('end');
      expect(content.dataset.align).toBe('end');
    });

    it('does not mutate content styles when apply is false but still returns coords', () => {
      const content = document.createElement('div');

      stubSize(content, 200, 150);
      document.body.appendChild(content);

      const anchor = rect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 });

      const resolved = positionAnchored(content, anchor, { side: 'bottom', apply: false });

      expect(content.style.top).toBe('');
      expect(content.style.left).toBe('');
      expect(resolved.top).toBe(148);
      // data attributes are geometry-independent and still stamped
      expect(content.dataset.side).toBe('bottom');
    });
  });

  describe('positionAnchored — horizontal primary', () => {
    it('places content to the right of the anchor when room exists', () => {
      const content = document.createElement('div');

      stubSize(content, 200, 100);
      document.body.appendChild(content);

      const anchor = rect({ top: 100, bottom: 300, left: 50, right: 250, width: 200, height: 200 });

      const resolved = positionAnchored(content, anchor, { side: 'right' });

      expect(resolved.side).toBe('right');
      expect(content.dataset.side).toBe('right');
    });

    it('flips to the left when there is no room on the right', () => {
      const content = document.createElement('div');

      stubSize(content, 400, 100);
      document.body.appendChild(content);

      // Anchor hard against the right edge; 400px content cannot fit on the right
      const anchor = rect({ top: 100, bottom: 300, left: 600, right: 1000, width: 400, height: 200 });

      const resolved = positionAnchored(content, anchor, { side: 'right' });

      expect(resolved.side).toBe('left');
      expect(content.dataset.side).toBe('left');
    });
  });

  describe('positionFixedAnchored', () => {
    it('converts the shared document result back to fixed viewport coordinates exactly once', () => {
      const content = document.createElement('div');

      stubSize(content, 200, 150);
      document.body.appendChild(content);
      Object.defineProperty(window, 'scrollX', { configurable: true, value: 120, writable: true });
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 600, writable: true });

      const anchor = rect({ top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 });
      const resolved = positionFixedAnchored(content, anchor, { side: 'bottom', offset: 8 });

      expect(resolved.top).toBe(748);
      expect(resolved.left).toBe(170);
      expect(content.style.top).toBe('148px');
      expect(content.style.left).toBe('50px');
    });
  });

  describe('createPositionTracker', () => {
    it('wires a capture-phase passive scroll listener, a resize listener, and re-positions on those events', () => {
      const content = document.createElement('div');

      document.body.appendChild(content);

      const addSpy = vi.spyOn(window, 'addEventListener');
      const reposition = vi.fn();
      const tracker = createPositionTracker(content, reposition);

      tracker.attach();

      const scrollCall = addSpy.mock.calls.find(([type]) => type === 'scroll');
      const resizeCall = addSpy.mock.calls.find(([type]) => type === 'resize');

      expect(scrollCall).toBeDefined();
      expect(resizeCall).toBeDefined();

      const scrollOptions = scrollCall?.[2];

      expect(scrollOptions).toMatchObject({ capture: true, passive: true });

      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(2);

      tracker.detach();
    });

    it('stops re-positioning after detach', () => {
      const content = document.createElement('div');

      document.body.appendChild(content);

      const reposition = vi.fn();
      const tracker = createPositionTracker(content, reposition);

      tracker.attach();
      tracker.detach();

      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));

      expect(reposition).not.toHaveBeenCalled();
    });

    it('observes the content via ResizeObserver and re-positions on resize', () => {
      const observe = vi.fn();
      const disconnect = vi.fn();
      let observerCallback: (() => void) | undefined;

      class MockResizeObserver {
        constructor(callback: () => void) {
          observerCallback = callback;
        }

        public observe = observe;

        public disconnect = disconnect;

        public unobserve = vi.fn();
      }

      vi.stubGlobal('ResizeObserver', MockResizeObserver);

      const content = document.createElement('div');

      document.body.appendChild(content);

      const reposition = vi.fn();
      const tracker = createPositionTracker(content, reposition);

      tracker.attach();

      expect(observe).toHaveBeenCalledWith(content);

      observerCallback?.();
      expect(reposition).toHaveBeenCalledTimes(1);

      tracker.detach();
      expect(disconnect).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('does not throw when ResizeObserver is unavailable', () => {
      const originalResizeObserver = globalThis.ResizeObserver;

      // Simulate an environment without ResizeObserver (older jsdom)
      vi.stubGlobal('ResizeObserver', undefined);

      const content = document.createElement('div');

      document.body.appendChild(content);

      const reposition = vi.fn();
      const tracker = createPositionTracker(content, reposition);

      expect(() => {
        tracker.attach();
        tracker.detach();
      }).not.toThrow();

      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    });
  });
});
