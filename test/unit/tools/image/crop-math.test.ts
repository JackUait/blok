import { describe, it, expect } from 'vitest';
import { resizeRect, clampRect } from '../../../../src/tools/image/crop-math';

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

describe('clampRect', () => {
  it('clamps x into [0, 100-w]', () => {
    expect(clampRect({ x: -5, y: 0, w: 50, h: 100 }).x).toBe(0);
  });
  it('clamps w into [MIN, 100]', () => {
    expect(clampRect({ x: 0, y: 0, w: 1, h: 100 }).w).toBe(5);
  });
});
