import { describe, it, expect } from 'vitest';
import { resolvePosition } from '../../../src/components/utils/popover/popover-position';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

describe('resolvePosition', () => {
  describe('vertical placement', () => {
    it('places popover below anchor when space is available', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 300 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result.top).toBe(148); // anchor.bottom (140) + offset (8)
      expect(result.openTop).toBe(false);
    });
  });
});
