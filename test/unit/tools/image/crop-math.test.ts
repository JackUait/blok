import { describe, it, expect } from 'vitest';
import { resizeRect, clampRect, widthForAspectChange, applyRatio } from '../../../../src/tools/image/crop-math';

describe('widthForAspectChange', () => {
  it('keeps width when aspect unchanged', () => {
    expect(widthForAspectChange(60, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(60);
  });

  it('shrinks width when new crop is much taller so rendered height stays ≈ previous', () => {
    // prev aspect unit = 100/100 = 1, new = 30/90 = 1/3; ratio new/prev = 1/3 → width × 1/3
    const next = widthForAspectChange(60, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 30, h: 90 });
    expect(next).toBe(20);
  });

  it('grows width when new crop is wider so rendered height stays ≈ previous', () => {
    // prev aspect unit = 50/50 = 1, new = 100/50 = 2 → width × 2
    const next = widthForAspectChange(30, { x: 0, y: 0, w: 50, h: 50 }, { x: 0, y: 0, w: 100, h: 50 });
    expect(next).toBe(60);
  });

  it('treats null prev as aspect-unit 1 (natural cancels); width × (w_new/h_new)', () => {
    const next = widthForAspectChange(40, null, { x: 0, y: 0, w: 50, h: 100 });
    expect(next).toBe(20);
  });

  it('treats null new as 1:1 natural-aspect baseline', () => {
    // new is "no crop"; width × h_old/w_old
    const next = widthForAspectChange(20, { x: 0, y: 0, w: 50, h: 100 }, null);
    expect(next).toBe(40);
  });

  it('clamps result to [10, 100]', () => {
    // tiny aspect shrinks width below 10 → clamped
    expect(widthForAspectChange(20, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 5, h: 100 })).toBe(10);
    // huge aspect grows width above 100 → clamped
    expect(widthForAspectChange(50, { x: 0, y: 0, w: 50, h: 50 }, { x: 0, y: 0, w: 100, h: 20 })).toBe(100);
  });

  it('rounds to 2 decimals to avoid float noise in saved data', () => {
    const next = widthForAspectChange(50, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 33, h: 100 });
    expect(next).toBe(16.5);
  });
});

describe('resizeRect — opposite edge stays pinned when handle hits bounds', () => {
  it('w-handle dragged past left boundary pins right edge, does not grow width', () => {
    const start = { x: 20, y: 0, w: 60, h: 100 };
    const result = resizeRect(start, 'w', -50, 0);
    expect(result.x + result.w).toBe(80);
    expect(result.x).toBe(0);
  });

  it('e-handle dragged past right boundary pins left edge, does not grow width', () => {
    const start = { x: 20, y: 0, w: 60, h: 100 };
    const result = resizeRect(start, 'e', 50, 0);
    expect(result.x).toBe(20);
    expect(result.x + result.w).toBe(100);
  });

  it('n-handle dragged past top boundary pins bottom edge', () => {
    const start = { x: 0, y: 20, w: 100, h: 60 };
    const result = resizeRect(start, 'n', 0, -50);
    expect(result.y + result.h).toBe(80);
    expect(result.y).toBe(0);
  });

  it('s-handle dragged past bottom boundary pins top edge', () => {
    const start = { x: 0, y: 20, w: 100, h: 60 };
    const result = resizeRect(start, 's', 0, 50);
    expect(result.y).toBe(20);
    expect(result.y + result.h).toBe(100);
  });

  it('w-handle shrink past MIN pins right edge, width clamps to MIN', () => {
    const start = { x: 20, y: 0, w: 60, h: 100 };
    const result = resizeRect(start, 'w', 70, 0);
    expect(result.x + result.w).toBe(80);
    expect(result.w).toBe(5);
  });

  it('e-handle shrink past MIN pins left edge, width clamps to MIN', () => {
    const start = { x: 20, y: 0, w: 60, h: 100 };
    const result = resizeRect(start, 'e', -70, 0);
    expect(result.x).toBe(20);
    expect(result.w).toBe(5);
  });

  it('nw-corner dragged past both left+top boundaries pins se corner', () => {
    const start = { x: 20, y: 20, w: 60, h: 60 };
    const result = resizeRect(start, 'nw', -50, -50);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.x + result.w).toBe(80);
    expect(result.y + result.h).toBe(80);
  });

  it('se-corner dragged past both right+bottom boundaries pins nw corner', () => {
    const start = { x: 20, y: 20, w: 60, h: 60 };
    const result = resizeRect(start, 'se', 50, 50);
    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
    expect(result.x + result.w).toBe(100);
    expect(result.y + result.h).toBe(100);
  });

  it('w-handle small drag within bounds grows width leftward, pins right', () => {
    const start = { x: 30, y: 0, w: 40, h: 100 };
    const result = resizeRect(start, 'w', -10, 0);
    expect(result.x).toBe(20);
    expect(result.w).toBe(50);
    expect(result.x + result.w).toBe(70);
  });
});

describe('applyRatio anchors opposite edge when handle passed (resize drag)', () => {
  it('se handle: NW corner stays pinned after ratio snap', () => {
    const resized = resizeRect({ x: 10, y: 10, w: 40, h: 40 }, 'se', 20, 10);
    const out = applyRatio(resized, 1, 'se');
    expect(out.x).toBe(10);
    expect(out.y).toBe(10);
  });

  it('nw handle: SE corner stays pinned after ratio snap', () => {
    const start = { x: 20, y: 20, w: 60, h: 60 };
    const resized = resizeRect(start, 'nw', -10, -20);
    const out = applyRatio(resized, 1, 'nw');
    expect(out.x + out.w).toBe(80);
    expect(out.y + out.h).toBe(80);
  });

  it('e handle: left edge + vertical center preserved', () => {
    const start = { x: 10, y: 10, w: 40, h: 40 };
    const resized = resizeRect(start, 'e', 20, 0);
    const out = applyRatio(resized, 1, 'e');
    expect(out.x).toBe(10);
    expect(out.y + out.h / 2).toBeCloseTo(30);
  });

  it('s handle: top edge + horizontal center preserved', () => {
    const start = { x: 10, y: 10, w: 40, h: 40 };
    const resized = resizeRect(start, 's', 0, 20);
    const out = applyRatio(resized, 1, 's');
    expect(out.y).toBe(10);
    expect(out.x + out.w / 2).toBeCloseTo(30);
  });

  it('without handle (ratio chip switch / body drag): centers around midpoint', () => {
    const out = applyRatio({ x: 10, y: 10, w: 60, h: 40 }, 1);
    expect(out.x + out.w / 2).toBeCloseTo(40);
    expect(out.y + out.h / 2).toBeCloseTo(30);
  });
});

describe('clampRect', () => {
  it('clamps x into [0, 100-w]', () => {
    expect(clampRect({ x: -5, y: 0, w: 50, h: 100 }).x).toBe(0);
  });
  it('clamps w into [MIN, 100]', () => {
    expect(clampRect({ x: 0, y: 0, w: 1, h: 100 }).w).toBe(5);
  });
});
