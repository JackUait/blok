import { describe, it, expect } from 'vitest';
import {
  FULL_RECT,
  clampRect,
  isFullRect,
  resizeRect,
  applyRatio,
} from '../../../src/tools/image/crop-math';

describe('crop-math', () => {
  describe('FULL_RECT', () => {
    it('is 0,0,100,100', () => {
      expect(FULL_RECT).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
  });

  describe('isFullRect', () => {
    it('true for 0,0,100,100', () => {
      expect(isFullRect({ x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    });
    it('false otherwise', () => {
      expect(isFullRect({ x: 5, y: 0, w: 95, h: 100 })).toBe(false);
    });
  });

  describe('clampRect', () => {
    it('keeps rect inside 0..100 bounds', () => {
      expect(clampRect({ x: -10, y: -5, w: 50, h: 50 })).toEqual({
        x: 0, y: 0, w: 50, h: 50,
      });
    });
    it('shrinks rect that overflows right/bottom', () => {
      expect(clampRect({ x: 70, y: 70, w: 50, h: 50 })).toEqual({
        x: 50, y: 50, w: 50, h: 50,
      });
    });
    it('enforces min size 5', () => {
      expect(clampRect({ x: 0, y: 0, w: 1, h: 1 })).toEqual({
        x: 0, y: 0, w: 5, h: 5,
      });
    });
  });

  describe('resizeRect', () => {
    const start = { x: 10, y: 10, w: 80, h: 80 };
    it('se handle extends width/height by delta %', () => {
      const out = resizeRect(start, 'se', 5, 10);
      expect(out).toEqual({ x: 10, y: 10, w: 85, h: 90 });
    });
    it('nw handle moves x/y and shrinks w/h', () => {
      const out = resizeRect(start, 'nw', 5, 10);
      expect(out).toEqual({ x: 15, y: 20, w: 75, h: 70 });
    });
    it('n handle only shifts top', () => {
      const out = resizeRect(start, 'n', 99, 10);
      expect(out).toEqual({ x: 10, y: 20, w: 80, h: 70 });
    });
    it('clamps result to bounds/min', () => {
      const out = resizeRect(start, 'se', 999, 999);
      expect(out.x + out.w).toBeLessThanOrEqual(100);
      expect(out.y + out.h).toBeLessThanOrEqual(100);
    });
  });

  describe('applyRatio', () => {
    it('snaps rect to 1:1 centered', () => {
      const out = applyRatio({ x: 0, y: 0, w: 100, h: 100 }, 1);
      expect(out.w).toBe(out.h);
      expect(out.x + out.w / 2).toBeCloseTo(50);
      expect(out.y + out.h / 2).toBeCloseTo(50);
    });
    it('16:9 wider than tall', () => {
      const out = applyRatio({ x: 0, y: 0, w: 100, h: 100 }, 16 / 9);
      expect(out.w).toBe(100);
      expect(out.h).toBeCloseTo(100 * 9 / 16, 1);
    });
    it('null ratio returns input unchanged', () => {
      const r = { x: 10, y: 10, w: 50, h: 50 };
      expect(applyRatio(r, null)).toEqual(r);
    });
  });
});
