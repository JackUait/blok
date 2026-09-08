import { describe, it, expect } from 'vitest';

import { applyRubberBand, rubberBand } from '../../../../src/tools/image/spring';

/**
 * Five survivors are equivalent, and all of them sit on a boundary where both
 * branches produce the same number.
 *
 * At zero overshoot the early return and the curve both give 0, so neither the
 * zero test nor the sign test below it can decide anything. At exactly the
 * limit, returning the value and returning `sign * (limit + rubberBand(0))`
 * are the same number, which covers both halves of the in-range test. And the
 * sign test in applyRubberBand is only reached once the value is outside the
 * limit, so the zero it would disagree about never arrives.
 */
describe('rubber band mutants', () => {
  describe('the curve', () => {
    it('bends an overshoot toward the dimension, and mirrors for a negative one', () => {
      expect(rubberBand(100, 200)).toBeCloseTo(43.1372549, 5);
      expect(rubberBand(-100, 200)).toBeCloseTo(-43.1372549, 5);
    });

    it('stays put at no overshoot and flattens as the overshoot grows', () => {
      expect(rubberBand(0, 200)).toBe(0);
      expect(rubberBand(1e6, 200)).toBeLessThan(200);
      expect(rubberBand(1e6, 200)).toBeGreaterThan(199);
    });
  });

  describe('applying it to a value', () => {
    it('returns a value inside the limit untouched, boundaries included', () => {
      expect(applyRubberBand(50, 100, 200)).toBe(50);
      expect(applyRubberBand(100, 100, 200)).toBe(100);
      expect(applyRubberBand(-100, 100, 200)).toBe(-100);
    });

    it('bends only the part of the value that is past the limit', () => {
      expect(applyRubberBand(150, 100, 200)).toBeCloseTo(124.1758241, 5);
      expect(applyRubberBand(-150, 100, 200)).toBeCloseTo(-124.1758241, 5);
    });
  });
});
