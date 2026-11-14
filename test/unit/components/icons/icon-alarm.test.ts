import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconAlarm } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return svg;
};

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

/** Distance from a point to the line through two points. */
const toLine = (p: Point, a: Point, b: Point): number =>
  Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

describe('IconAlarm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // An alarm clock: a face with hands and two bells; the bells mirror and clear the face.
  it('mirrors its bells around the face and keeps a stroke width between them and the face', () => {
    const svg = svgOf(IconAlarm);
    const face = svg.querySelector('circle');
    const cx = Number(face?.getAttribute('cx'));
    const cy = Number(face?.getAttribute('cy'));
    const r = Number(face?.getAttribute('r'));
    const strokes = [...svg.querySelectorAll('path')].flatMap((path) => subpathsOf(path.getAttribute('d') ?? ''));
    const bells = strokes.filter((stroke) => stroke.every(([x, y]) => Math.hypot(x - cx, y - cy) > r));

    expect(cx).toBe(10);
    expect(bells).toHaveLength(2);
    const [left, right] = bells;

    expect(right).toEqual(left.map(([x, y]) => [2 * cx - x, y]));
    for (const p of [...left, ...right]) {
      expect(Math.min(...p)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...p)).toBeLessThanOrEqual(17);
    }
    const gap = toLine([cx, cy], left[0], left[1]) - r - 1.25;

    expect(gap).toBeGreaterThanOrEqual(1.25);
  });
});
