/**
 * The page layout builder's pin buttons (research/09 §3: Notion's `pin` and
 * `pinFill`). Pinned fills the pin's body; both share one outline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconPin, IconPinFilled, IconPinSlash } from '../../../../src/components/icons';

const paths = (markup: string): Array<{ d: string; fill: string | null }> =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => ({ d: path.getAttribute('d') ?? '', fill: path.getAttribute('fill') }));

type Point = [number, number];

const SIZES: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, a: 7, c: 6 };

/** The point one path command lands on; h and v keep the other coordinate. */
const stepTo = (lower: string, relative: boolean, chunk: number[], [x, y]: Point): Point => {
  const [ox, oy] = relative ? [x, y] : [0, 0];

  if (lower === 'h') {
    return [ox + chunk[0], y];
  }
  if (lower === 'v') {
    return [x, oy + chunk[0]];
  }

  return [ox + chunk[chunk.length - 2], oy + chunk[chunk.length - 1]];
};

/** Absolute end points of every subpath (M/L/H/V/A/C, curve handles left out). */
const subpathsOf = (d: string): Point[][] => {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let point: Point = [0, 0];

  for (const [, letter, args] of d.matchAll(/([MLHVACZmlhvacz])([^MLHVACZmlhvacz]*)/g)) {
    const lower = letter.toLowerCase();
    const size = SIZES[lower] ?? 0;
    const values = (args.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

    if (lower === 'z') {
      point = current[0] ?? point;
      continue;
    }
    if (lower === 'm') {
      current = [];
      subpaths.push(current);
    }
    for (let i = 0; i + size <= values.length; i += size) {
      point = stepTo(lower, letter === lower, values.slice(i, i + size), point);
      current.push(point);
    }
  }

  return subpaths;
};

const sorted = (strokes: Point[][]): string[] => strokes.map((stroke) => JSON.stringify(stroke)).sort();

describe('pin icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the filled pin on the outline pin, filling only its body', () => {
    const outline = paths(IconPin);
    const filled = paths(IconPinFilled);

    expect(outline).toHaveLength(1);
    expect(outline[0].fill).toBeNull();
    const solid = filled.filter((p) => p.fill === 'currentColor');

    expect(solid).toHaveLength(1);
    // Same strokes in both, so the pin does not change size when it fills.
    expect(sorted(filled.flatMap((p) => subpathsOf(p.d)))).toEqual(sorted(subpathsOf(outline[0].d)));
    // Only the body closes and fills; the bar and the needle stay strokes.
    expect(solid[0].d).toMatch(/Z$/);
    expect(subpathsOf(solid[0].d)).toHaveLength(1);
    expect(subpathsOf(solid[0].d)[0].length).toBeGreaterThan(2);
  });

  it('stands upright on the vertical centre line, inside x/y 3-17', () => {
    const strokes = subpathsOf(paths(IconPin)[0].d);
    const needle = strokes.find((stroke) => stroke.length === 2 && stroke[0][0] === stroke[1][0]);
    const points = strokes.flat();

    expect(needle?.map(([x]) => x)).toEqual([10, 10]);
    expect(Math.max(...(needle ?? []).map(([, y]) => y))).toBe(16.5);
    expect(points.map(([x, y]) => [20 - x, y]).map(String).sort()).toEqual(points.map(String).sort());
    for (const n of points.flat()) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(17);
    }
  });

  // notion-motion.md Round 30 §6: Notion's `pinSlash` has a wide base, a long needle and a steep slash that breaks the pin.
  describe('struck-out pin (Unfreeze)', () => {
    const [pin, slash] = paths(IconPinSlash).map((p) => subpathsOf(p.d));
    const [[a, b]] = slash;
    const side = ([x, y]: Point): number => ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

    it('draws a 10-wide base low on the pin and a needle on the centre line down to 17', () => {
      const flat = pin.flatMap((stroke) => stroke.slice(1).map((end, i) => [stroke[i], end] as const));
      const base = flat.filter(([p, q]) => p[1] === 12.75 && q[1] === 12.75);
      const needle = pin.find((stroke) => stroke.every(([x]) => x === 10));

      expect(Math.min(...base.flat().map(([x]) => x))).toBe(5);
      expect(Math.max(...base.flat().map(([x]) => x))).toBe(15);
      expect(needle?.map(([, y]) => y)).toEqual([12.75, 17]);
    });

    it('runs the slash from the top left to the bottom right, steeper than 45°', () => {
      expect(slash).toEqual([[[4.5, 3.25], [15.5, 16.75]]]);
    });

    it('breaks the pin where the slash crosses: no stroke crosses it and every end keeps clear of it', () => {
      for (const stroke of pin) {
        const sides = stroke.map(side);

        expect(sides.every((d) => d > 0) || sides.every((d) => d < 0)).toBe(true);
        for (const d of sides) {
          expect(Math.abs(d)).toBeGreaterThanOrEqual(1.4);
        }
      }
    });
  });
});
