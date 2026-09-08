import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  positionAnchored,
  positionFixedAnchored,
  createPositionTracker,
  resolveBoundaryRect,
} from '../../../src/components/utils/popover/anchored-position';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

interface RectNumbers {
  x: number;
  y: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Numeric fields of a rect, so a whole rect can be compared structurally
 * without the `toJSON` function participating in the equality check.
 * @param value - rect to flatten
 */
const rectNumbers = (value: DOMRect): RectNumbers => ({
  x: value.x,
  y: value.y,
  top: value.top,
  left: value.left,
  right: value.right,
  bottom: value.bottom,
  width: value.width,
  height: value.height,
});

/**
 * Creates a mounted content element with stubbed layout metrics — jsdom lays
 * nothing out, so every measurement this engine reads is 0 without the stub.
 * @param width - offsetWidth to report
 * @param height - offsetHeight to report
 */
const contentOf = (width: number, height: number): HTMLElement => {
  const el = document.createElement('div');

  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
  document.body.appendChild(el);

  return el;
};

/**
 * Overrides a window geometry property for the duration of a test.
 * @param name - property to override
 * @param value - value to report
 */
const setWindowMetric = (name: 'innerWidth' | 'innerHeight' | 'scrollX' | 'scrollY', value: number): void => {
  Object.defineProperty(window, name, { configurable: true, value, writable: true });
};

describe('anchored-position — mutation coverage', () => {
  const originalMetrics = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    setWindowMetric('innerWidth', 1000);
    setWindowMetric('innerHeight', 800);
    setWindowMetric('scrollX', 0);
    setWindowMetric('scrollY', 0);
  });

  afterEach(() => {
    setWindowMetric('innerWidth', originalMetrics.innerWidth);
    setWindowMetric('innerHeight', originalMetrics.innerHeight);
    setWindowMetric('scrollX', originalMetrics.scrollX);
    setWindowMetric('scrollY', originalMetrics.scrollY);

    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('resolveBoundaryRect', () => {
    it('returns the very rect of an explicit non-root element boundary', () => {
      const boundary = document.createElement('section');
      const boundaryRect = rect({
        x: 20, y: 10, top: 10, left: 20, right: 120, bottom: 110, width: 100, height: 100,
      });

      document.body.appendChild(boundary);
      vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue(boundaryRect);

      const resolved = resolveBoundaryRect(boundary, { width: 640, height: 480 });

      expect(resolved).toBe(boundaryRect);
      expect(rectNumbers(resolved)).toStrictEqual({
        x: 20, y: 10, top: 10, left: 20, right: 120, bottom: 110, width: 100, height: 100,
      });
    });

    it.each([
      ['undefined', (): undefined => undefined],
      ['document.body', (): HTMLElement => document.body],
      ['document.documentElement', (): HTMLElement => document.documentElement],
    ] as const)('resolves the %s boundary to the live viewport rect', (_label, getBoundary) => {
      const boundary = getBoundary();

      if (boundary !== undefined) {
        vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue(
          rect({ top: -900, bottom: -420, left: -60, right: 580, width: 640, height: 480 })
        );
      }

      const resolved = resolveBoundaryRect(boundary, { width: 640, height: 480 });

      expect(rectNumbers(resolved)).toStrictEqual({
        x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480,
      });
      expect(resolved.toJSON()).toStrictEqual({});
    });
  });

  describe('cross-axis alignment for horizontal sides', () => {
    const anchor = rect({ top: 100, bottom: 500, left: 300, right: 400, width: 100, height: 400 });
    const alignTo = rect({ top: 200, bottom: 300, left: 300, right: 400, width: 100, height: 100 });

    it.each([
      ['start', 200],
      ['end', 240],
      ['center', 220],
    ] as const)('places a right-side surface with align=%s at top %i', (align, top) => {
      const content = contentOf(200, 60);

      const resolved = positionAnchored(content, anchor, { side: 'right', align, alignTo });

      expect(resolved).toStrictEqual({ side: 'right', align, top, left: 396 });
    });

    it('defaults horizontal alignment to center', () => {
      const content = contentOf(200, 60);

      const resolved = positionAnchored(content, anchor, { side: 'right', alignTo });

      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 220, left: 396 });
      expect(content.getAttribute('data-align')).toBe('center');
    });

    it('centers on alignTo rather than on the anchor when alignTo is given', () => {
      const content = contentOf(200, 60);

      const withoutAlignTo = positionAnchored(contentOf(200, 60), anchor, { side: 'right' });
      const withAlignTo = positionAnchored(content, anchor, { side: 'right', alignTo });

      // anchor centre: 100 + 400 / 2 - 60 / 2 = 270; alignTo centre: 200 + 100 / 2 - 60 / 2 = 220
      expect(withoutAlignTo).toStrictEqual({ side: 'right', align: 'center', top: 270, left: 396 });
      expect(withAlignTo).toStrictEqual({ side: 'right', align: 'center', top: 220, left: 396 });
    });
  });

  describe('boundary-local geometry for horizontal sides', () => {
    it('measures the left gap from the boundary left edge and keeps the right side', () => {
      const content = contentOf(300, 100);
      const anchor = rect({ top: 300, bottom: 400, left: 380, right: 480, width: 100, height: 100 });
      const boundary = rect({ top: 0, bottom: 800, left: 200, right: 900, width: 700, height: 800 });

      const resolved = positionAnchored(content, anchor, { side: 'left', boundary });

      // 180px inside the boundary on the left is too little for 300px of content;
      // 424px on the right fits, so the preferred side flips.
      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 300, left: 476 });
    });

    it('measures the right gap in boundary-local width and flips to the left side', () => {
      const content = contentOf(180, 100);
      const anchor = rect({ top: 300, bottom: 400, left: 400, right: 500, width: 100, height: 100 });
      const boundary = rect({ top: 0, bottom: 800, left: 200, right: 600, width: 400, height: 800 });

      const resolved = positionAnchored(content, anchor, { side: 'right', boundary });

      // Boundary-local width 400: only 104px right of the anchor, 200px left of it.
      expect(resolved).toStrictEqual({ side: 'left', align: 'center', top: 300, left: 224 });
    });

    it('clamps the cross-axis top against the boundary top floor', () => {
      const content = contentOf(100, 200);
      const anchor = rect({ top: 310, bottom: 350, left: 400, right: 500, width: 100, height: 40 });
      const boundary = rect({ top: 300, bottom: 700, left: 0, right: 1000, width: 1000, height: 400 });

      const resolved = positionAnchored(content, anchor, { side: 'right', boundary });

      // Centred top would be 230 — above the boundary; floor = boundary.top + margin(8).
      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 308, left: 496 });
    });

    it('clamps the cross-axis top against the boundary bottom ceiling', () => {
      const content = contentOf(100, 150);
      const anchor = rect({ top: 400, bottom: 440, left: 400, right: 500, width: 100, height: 40 });
      const boundary = rect({ top: 100, bottom: 500, left: 0, right: 1000, width: 1000, height: 400 });

      const resolved = positionAnchored(content, anchor, { side: 'right', boundary });

      // Centred top 345 exceeds boundary.bottom - height - margin(8) = 342.
      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 342, left: 496 });
    });

    it('adds each scroll axis exactly once to the horizontal result', () => {
      setWindowMetric('scrollX', 70);
      setWindowMetric('scrollY', 250);

      const content = contentOf(200, 100);
      const anchor = rect({ top: 200, bottom: 300, left: 300, right: 400, width: 100, height: 100 });

      const resolved = positionAnchored(content, anchor, { side: 'right' });

      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 450, left: 466 });
    });
  });

  describe('side selection', () => {
    const anchor = rect({ top: 200, bottom: 300, left: 400, right: 500, width: 100, height: 100 });

    it('routes side=left through the horizontal engine and prefers the left side', () => {
      const content = contentOf(200, 100);

      const resolved = positionAnchored(content, anchor, { side: 'left' });

      expect(resolved).toStrictEqual({ side: 'left', align: 'center', top: 200, left: 204 });
      expect(content.getAttribute('data-side')).toBe('left');
    });

    it('keeps side=right on the right when both sides have room', () => {
      const content = contentOf(200, 100);

      const resolved = positionAnchored(content, anchor, { side: 'right' });

      expect(resolved).toStrictEqual({ side: 'right', align: 'center', top: 200, left: 496 });
      expect(content.getAttribute('data-side')).toBe('right');
      expect(content.style.top).toBe('200px');
      expect(content.style.left).toBe('496px');
    });
  });

  describe('positionFixedAnchored', () => {
    it('writes position/top/left once each, in viewport coordinates', () => {
      setWindowMetric('scrollX', 70);
      setWindowMetric('scrollY', 250);

      const content = contentOf(200, 100);
      const anchor = rect({ top: 200, bottom: 300, left: 400, right: 500, width: 100, height: 100 });
      const setProperty = vi.spyOn(content.style, 'setProperty');

      const resolved = positionFixedAnchored(content, anchor, { side: 'left' });

      expect(resolved).toStrictEqual({ side: 'left', align: 'center', top: 450, left: 274 });
      // Three writes, not five: the document-coordinate pass must not apply styles.
      expect(setProperty.mock.calls).toStrictEqual([
        ['position', 'fixed'],
        ['top', '200px'],
        ['left', '204px'],
      ]);
      expect(content.style.position).toBe('fixed');
      expect(content.style.top).toBe('200px');
      expect(content.style.left).toBe('204px');
    });
  });

  describe('createPositionTracker', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockResizeObserver {
      public constructor(callback: () => void) {
        void callback;
      }

      public observe = observe;

      public disconnect = disconnect;

      public unobserve = vi.fn();
    }

    it('ignores a second attach while already attached', () => {
      vi.stubGlobal('ResizeObserver', MockResizeObserver);

      const content = document.createElement('div');

      document.body.appendChild(content);

      const tracker = createPositionTracker(content, vi.fn());

      tracker.attach();
      tracker.attach();

      expect(observe).toHaveBeenCalledTimes(1);

      tracker.detach();
    });

    it('does not touch window listeners when detached before ever attaching', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const content = document.createElement('div');

      document.body.appendChild(content);

      const tracker = createPositionTracker(content, vi.fn());

      tracker.detach();
      tracker.detach();

      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('re-attaches after a detach', () => {
      const content = document.createElement('div');

      document.body.appendChild(content);

      const reposition = vi.fn();
      const tracker = createPositionTracker(content, reposition);

      tracker.attach();
      tracker.detach();
      tracker.attach();

      window.dispatchEvent(new Event('scroll'));

      expect(reposition).toHaveBeenCalledTimes(1);

      tracker.detach();
    });
  });

  /*
   * Three mutants in this file are equivalent and cannot be killed:
   *
   * - `side = 'bottom'` -> `side = ''` (L252). `side` is read only by
   *   `side === 'left' || side === 'right'` and by `side === 'left'`; both are
   *   false for '' exactly as for 'bottom'.
   * - `'start'` -> `''` (L254). That branch of the align default is reached only
   *   when the placement is vertical, and `align` is then never passed on —
   *   `positionVertical` derives its own align from the flip.
   * - `{ attached: false, resizeObserver: null }` -> `{}` (L331). Both guards
   *   test truthiness of `attached` (undefined and false are alike) and the
   *   observer is reached only through `?.` (undefined and null are alike).
   */
});
