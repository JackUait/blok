/**
 * The page layout builder's pin buttons (research/09 §3: Notion's `pin` and
 * `pinFill`). Pinned fills the pin's body; both share one outline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconPin, IconPinFilled } from '../../../../src/components/icons';

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
});
