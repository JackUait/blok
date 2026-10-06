import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIT, clampView, panView, zoomViewAt, toView } from '../../../../../src/tools/image/darkroom/view-zoom';

const STAGE = { w: 1000, h: 600 };

describe('view zoom maths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('zooming about a point keeps that point under the pointer', () => {
    const at = { x: 300, y: 200 };
    const v = zoomViewAt(FIT, 2, at, STAGE, 8);
    // A content point p shows at p·z + (x, y).

    expect(v.z).toBe(2);
    expect(300 * v.z + v.x).toBeCloseTo(300);
    expect(200 * v.z + v.y).toBeCloseTo(200);
  });

  it('never zooms out past fit or in past the cap', () => {
    expect(zoomViewAt(FIT, 0.5, { x: 0, y: 0 }, STAGE, 8)).toEqual(FIT);
    expect(zoomViewAt(FIT, 100, { x: 0, y: 0 }, STAGE, 8).z).toBe(8);
  });

  it('a pan stops where the zoomed content would leave an edge of the stage uncovered', () => {
    const v = { z: 2, x: -500, y: -300 };

    expect(panView(v, 10_000, 10_000, STAGE)).toEqual({ z: 2, x: 0, y: 0 });
    expect(panView(v, -10_000, -10_000, STAGE)).toEqual({ z: 2, x: -1000, y: -600 });
  });

  it('clamping at fit pins the view to the origin', () => {
    expect(clampView({ z: 1, x: 40, y: -20 }, STAGE)).toEqual(FIT);
  });

  it('toView maps a box drawn in stage space to where it shows on screen', () => {
    expect(toView({ x: 10, y: 20, w: 100, h: 50 }, { z: 2, x: -5, y: 7 })).toEqual({ x: 15, y: 47, w: 200, h: 100 });
  });
});
