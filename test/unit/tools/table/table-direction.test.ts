import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colEdgeX, gridX, inlineAxis, scrollToInlineEnd } from '../../../../src/tools/table/table-direction';

const EDGES = [0, 100, 250, 400];

describe('table direction helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('colEdgeX', () => {
    it('keeps logical edges in LTR', () => {
      expect(EDGES.map((_, k) => colEdgeX(EDGES, k, 'ltr'))).toEqual([0, 100, 250, 400]);
    });

    it('mirrors edges in RTL so column 0 starts at the right', () => {
      expect(EDGES.map((_, k) => colEdgeX(EDGES, k, 'rtl'))).toEqual([400, 300, 150, 0]);
    });
  });

  describe('gridX', () => {
    it('turns a physical grid x into a distance from the inline start', () => {
      expect(gridX(30, 400, 'ltr')).toBe(30);
      expect(gridX(30, 400, 'rtl')).toBe(370);
    });
  });

  describe('inlineAxis', () => {
    const rect = { left: 10, right: 110 };

    it('is the identity in LTR', () => {
      const axis = inlineAxis('ltr');

      expect([axis.x(42), axis.start(rect), axis.end(rect)]).toEqual([42, 10, 110]);
    });

    it('mirrors x in RTL so the inline end is the larger value', () => {
      const axis = inlineAxis('rtl');

      expect([axis.x(42), axis.start(rect), axis.end(rect)]).toEqual([-42, -110, -10]);
      expect(axis.end(rect)).toBeGreaterThan(axis.start(rect));
    });
  });

  describe('scrollToInlineEnd', () => {
    const scroller = (dir: 'ltr' | 'rtl'): HTMLElement => {
      const el = document.createElement('div');

      el.setAttribute('dir', dir);
      document.body.appendChild(el);
      Object.defineProperty(el, 'scrollWidth', { value: 900 });

      let left = 0;

      Object.defineProperty(el, 'scrollLeft', {
        get: () => left,
        set: (value: number) => {
          left = value;
        },
      });

      return el;
    };

    it('scrolls right in LTR', () => {
      const el = scroller('ltr');

      scrollToInlineEnd(el);

      expect(el.scrollLeft).toBe(900);
    });

    it('scrolls to the negative end in RTL', () => {
      const el = scroller('rtl');

      scrollToInlineEnd(el);

      expect(el.scrollLeft).toBe(-900);
    });
  });
});
