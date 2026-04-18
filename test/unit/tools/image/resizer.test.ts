import { describe, it, expect } from 'vitest';
import { computeWidthPercent, clampPercent } from '../../../../src/tools/image/resizer';

describe('clampPercent', () => {
  it('clamps below MIN to 10', () => {
    expect(clampPercent(5)).toBe(10);
  });
  it('clamps above MAX to 100', () => {
    expect(clampPercent(150)).toBe(100);
  });
  it('passes through in-range', () => {
    expect(clampPercent(42)).toBe(42);
  });
});

describe('computeWidthPercent', () => {
  it('right-edge drag: percent = (dragX - originX) / containerWidth * 100', () => {
    expect(computeWidthPercent({ edge: 'right', containerWidth: 1000, dragX: 500, originX: 0 })).toBe(50);
  });
  it('right-edge drag past full width clamps to 100', () => {
    expect(computeWidthPercent({ edge: 'right', containerWidth: 1000, dragX: 1500, originX: 0 })).toBe(100);
  });
  it('left-edge drag: width shrinks as dragX moves right relative to origin', () => {
    expect(computeWidthPercent({ edge: 'left', containerWidth: 1000, dragX: 200, originX: 0 })).toBe(80);
  });
});
