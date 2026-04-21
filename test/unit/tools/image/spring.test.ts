import { describe, expect, it } from 'vitest';
import { rubberBand, applyRubberBand } from '../../../../src/tools/image/spring';

describe('rubberBand', () => {
  it('returns 0 at 0 overshoot', () => {
    expect(rubberBand(0, 800)).toBe(0);
  });

  it('is symmetric: rubberBand(-x, d) === -rubberBand(x, d)', () => {
    expect(rubberBand(-500, 800)).toBeCloseTo(-rubberBand(500, 800));
  });

  it('dampens overshoot so output < raw input', () => {
    const out = rubberBand(500, 800);
    expect(Math.abs(out)).toBeLessThan(500);
    expect(Math.abs(out)).toBeGreaterThan(0);
  });

  it('is monotonic — larger overshoot → larger dampened output', () => {
    expect(rubberBand(200, 800)).toBeLessThan(rubberBand(400, 800));
    expect(rubberBand(400, 800)).toBeLessThan(rubberBand(800, 800));
  });

  it('asymptotically approaches dimension, never exceeding it', () => {
    expect(rubberBand(10_000, 800)).toBeLessThan(800);
    expect(rubberBand(1_000_000, 800)).toBeLessThan(800);
  });
});

describe('applyRubberBand', () => {
  it('passes value through unchanged when within [-limit, limit]', () => {
    expect(applyRubberBand(0, 400, 800)).toBe(0);
    expect(applyRubberBand(200, 400, 800)).toBe(200);
    expect(applyRubberBand(-400, 400, 800)).toBe(-400);
    expect(applyRubberBand(400, 400, 800)).toBe(400);
  });

  it('past positive limit, returns limit + dampened overshoot', () => {
    const out = applyRubberBand(1000, 400, 800);
    expect(out).toBeGreaterThan(400);
    expect(out).toBeLessThan(1000);
  });

  it('past negative limit, returns -limit - dampened overshoot', () => {
    const out = applyRubberBand(-1000, 400, 800);
    expect(out).toBeLessThan(-400);
    expect(out).toBeGreaterThan(-1000);
  });

  it('extreme overshoot stays bounded by limit + dimension', () => {
    const out = applyRubberBand(1_000_000, 400, 800);
    expect(out).toBeLessThan(400 + 800);
  });
});
