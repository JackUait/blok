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

    it('places popover above anchor when no space below but space above', () => {
      const result = resolvePosition({
        anchor: rect({ top: 500, bottom: 540, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 300 },
        scopeBounds: rect({ top: 0, bottom: 600, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 600 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result.top).toBe(192); // 500 - 8 - 300
      expect(result.openTop).toBe(true);
    });

    it('picks the side with more space when neither direction fits', () => {
      const result = resolvePosition({
        anchor: rect({ top: 200, bottom: 240, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 400 },
        scopeBounds: rect({ top: 0, bottom: 500, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 500 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceBelow = 500 - 240 - 8 = 252, spaceAbove = 200 - 8 = 192
      expect(result.openTop).toBe(false);
      expect(result.top).toBe(248);
    });

    it('stays below when neither direction fits even if more space above', () => {
      const result = resolvePosition({
        anchor: rect({ top: 350, bottom: 390, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 400 },
        scopeBounds: rect({ top: 0, bottom: 500, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 500 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceBelow = 102, spaceAbove = 342
      // Neither fits → stay below to remain adjacent to anchor
      expect(result.openTop).toBe(false);
      expect(result.top).toBe(398); // 390 + 8
    });

    it('stays below when neither direction fits in small viewport', () => {
      const result = resolvePosition({
        anchor: rect({ top: 150, bottom: 190, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 500 },
        scopeBounds: rect({ top: 0, bottom: 300, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 300 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceBelow = 300 - 190 - 8 = 102, spaceAbove = 150 - 8 = 142
      // Neither fits → stay below to remain adjacent to anchor
      expect(result.openTop).toBe(false);
      expect(result.top).toBe(198); // 190 + 8
    });

    it('stays below with scroll offset when neither direction fits', () => {
      const result = resolvePosition({
        anchor: rect({ top: 150, bottom: 190, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 500 },
        scopeBounds: rect({ top: 0, bottom: 300, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 300 },
        scrollOffset: { x: 0, y: 200 },
        offset: 8,
      });

      // spaceBelow = 102, spaceAbove = 142
      // Neither fits → stay below
      expect(result.openTop).toBe(false);
      expect(result.top).toBe(398); // 190 + 8 + 200
    });

    it('accounts for scroll offset in vertical positioning', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 300 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 500 },
        offset: 8,
      });

      expect(result.top).toBe(648); // 140 + 8 + 500
    });
  });

  describe('horizontal placement', () => {
    it('aligns to anchor left when space is available', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 200, right: 300 }),
        popoverSize: { width: 250, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result.left).toBe(200);
      expect(result.openLeft).toBe(false);
    });

    it('flips to left-aligned when popover overflows right boundary', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 800, right: 900 }),
        popoverSize: { width: 300, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      expect(result.openLeft).toBe(true);
      expect(result.left).toBe(600); // 900 - 300
    });

    it('clamps popover to not overflow right boundary even when opening right', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 850, right: 900 }),
        popoverSize: { width: 200, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1000, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceRight = 1000 - 850 = 150 < 200 → openLeft
      // left = 900 - 200 = 700
      expect(result.left).toBe(700);
    });

    it('uses leftAlignRect for horizontal positioning when provided', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 50, right: 90 }),
        popoverSize: { width: 200, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
        leftAlignRect: rect({ left: 300 }),
      });

      expect(result.left).toBe(300);
      expect(result.openLeft).toBe(false);
    });

    it('accounts for scroll offset in horizontal positioning', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 200, right: 300 }),
        popoverSize: { width: 250, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 100, y: 0 },
        offset: 8,
      });

      expect(result.left).toBe(300); // 200 + 100
    });

    it('picks the side with more space when neither direction fits horizontally', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 100, right: 200 }),
        popoverSize: { width: 500, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 400 }),
        viewportSize: { width: 400, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceRight = 400 - 100 = 300; spaceLeft = 200 - 0 = 200
      // 300 > 200 → openLeft = false, left = 100
      // clamp: 100 + 500 > 400 → left = max(0, 400 - 500) = 0
      expect(result.openLeft).toBe(false);
      expect(result.left).toBe(0);
    });
  });

  describe('scope boundary', () => {
    it('uses scope bottom instead of viewport when scope is smaller', () => {
      const result = resolvePosition({
        anchor: rect({ top: 300, bottom: 340, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 200 },
        scopeBounds: rect({ top: 0, bottom: 400, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceBelow = min(768, 400) - 340 - 8 = 52 (not enough for 200)
      // spaceAbove = 300 - 8 = 292 (enough)
      expect(result.openTop).toBe(true);
      expect(result.top).toBe(92); // 300 - 8 - 200
    });

    it('uses scope right instead of viewport when scope is smaller', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 300, right: 400 }),
        popoverSize: { width: 250, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 500 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
        offset: 8,
      });

      // spaceRight = min(1024, 500) - 300 = 200 (not enough for 250)
      // spaceLeft = 400 - 0 = 400 (enough)
      expect(result.openLeft).toBe(true);
      expect(result.left).toBe(150); // 400 - 250
    });

    it('defaults offset to 8 when not provided', () => {
      const result = resolvePosition({
        anchor: rect({ top: 100, bottom: 140, left: 50, right: 200 }),
        popoverSize: { width: 200, height: 100 },
        scopeBounds: rect({ top: 0, bottom: 800, left: 0, right: 1000 }),
        viewportSize: { width: 1024, height: 768 },
        scrollOffset: { x: 0, y: 0 },
      });

      expect(result.top).toBe(148); // 140 + 8 (default)
    });

    it('stays below anchor when neither direction fits to keep popover adjacent to trigger', () => {
      // Regression: drawer scenario where the trigger is near the bottom of the viewport.
      // When neither direction fits, the popover should stay below (preferred direction)
      // instead of flipping above and getting clamped to the boundary top — which
      // would detach the popover from the trigger.
      const result = resolvePosition({
        anchor: rect({ top: 384, bottom: 408, left: 762, right: 786 }),
        popoverSize: { width: 291, height: 400 },
        scopeBounds: rect({ top: 0, bottom: 720, left: 0, right: 1280 }),
        viewportSize: { width: 1280, height: 720 },
        scrollOffset: { x: 0, y: 3165 },
        offset: 8,
      });

      // spaceBelow = 720 - 408 - 8 = 304, spaceAbove = 384 - 8 = 376
      // Neither fits 400px → stay below to keep popover adjacent to trigger
      expect(result.openTop).toBe(false);
      expect(result.top).toBe(3581); // 408 + 8 + 3165 = viewport 416
    });
  });
});
