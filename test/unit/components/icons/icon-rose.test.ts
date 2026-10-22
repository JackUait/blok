/**
 * The Ask AI rose: a four-petal rose curve in one closed stroke. The working bar
 * turns it, so it must look the same a quarter turn on, or the turn would read
 * as a loop with a start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconRose } from '../../../../src/components/icons';

const doc = (): Document => new DOMParser().parseFromString(IconRose, 'image/svg+xml');

const points = (d: string): Array<[number, number]> => {
  const numbers = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

  return Array.from({ length: numbers.length / 2 }, (_, index) => [numbers[index * 2], numbers[index * 2 + 1]]);
};

describe('IconRose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is one closed Blok Line stroke', () => {
    const shapes = doc().querySelectorAll('path, circle, ellipse, line, rect, polyline, polygon');
    const path = doc().querySelector('path');

    expect(shapes).toHaveLength(1);
    expect(path?.getAttribute('d')).toMatch(/^M[^M]*Z$/);
    expect(path?.getAttribute('stroke')).toBe('currentColor');
    expect(path?.getAttribute('stroke-width')).toBe('1.25');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
    expect(doc().documentElement.getAttribute('fill')).toBe('none');
  });

  it('stays inside 3–17 on the 20 grid', () => {
    points(doc().querySelector('path')?.getAttribute('d') ?? '').forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(17);
      expect(y).toBeGreaterThanOrEqual(3);
      expect(y).toBeLessThanOrEqual(17);
    });
  });

  it('looks the same a quarter turn on, so turning it never shows a start', () => {
    const all = points(doc().querySelector('path')?.getAttribute('d') ?? '');
    const has = ([x, y]: [number, number]): boolean => all.some(([px, py]) => Math.abs(px - x) < 0.02 && Math.abs(py - y) < 0.02);

    expect(all.length).toBeGreaterThan(8);
    all.forEach(([x, y]) => expect(has([10 - (y - 10), 10 + (x - 10)]), `${x} ${y}`).toBe(true));
  });
});
