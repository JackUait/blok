import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { pieSlices, slicePath } from '../../../../../../../src/tools/file/pptx/renderer/chart/pie';

describe('pie geometry', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sweeps slices clockwise from 12 o’clock in proportion to values', () => {
    expect(pieSlices([1, 1, 2], 0)).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 180 },
      { start: 180, end: 360 },
    ]);
  });

  it('starts at the first slice angle and treats negatives as their size', () => {
    expect(pieSlices([-1, 3], 90)).toEqual([{ start: 90, end: 180 }, { start: 180, end: 450 }]);
  });

  it('gives empty slices to an all-zero series', () => {
    expect(pieSlices([0, 0], 0)).toEqual([{ start: 0, end: 0 }, { start: 0, end: 0 }]);
  });

  it('draws a quarter slice from the top to 3 o’clock', () => {
    const d = slicePath({ cx: 100, cy: 100, outer: 50, inner: 0 }, { start: 0, end: 90 });

    expect(d).toMatch(/^M100 100 L100 50 A50 50 0 0 1 150 100 Z$/);
  });

  it('cuts the hole out of a doughnut slice', () => {
    const d = slicePath({ cx: 0, cy: 0, outer: 10, inner: 5 }, { start: 0, end: 180 });

    expect(d).toBe('M0 -10 A10 10 0 0 1 0 10 L0 5 A5 5 0 0 0 0 -5 Z');
  });

  it('draws a full circle as two arcs', () => {
    const d = slicePath({ cx: 0, cy: 0, outer: 10, inner: 0 }, { start: 0, end: 360 });

    expect(d).toBe('M0 -10 A10 10 0 1 1 0 10 A10 10 0 1 1 0 -10 Z');
  });
});
