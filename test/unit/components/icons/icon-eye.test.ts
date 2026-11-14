/**
 * The page layout builder's visibility glyphs (research/09 §5: Notion's
 * `eyeFill`, `eyeSlash`, `eyeClosed`). Always show reuses IconPreview; the
 * other two are drawn from its eye.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconEyeClosed, IconEyeSlash, IconPreview } from '../../../../src/components/icons';

const svg = (markup: string): SVGSVGElement => {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('svg');

  if (root === null) throw new Error('no svg');

  return root;
};
const paths = (markup: string): string[] => [...svg(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');
const numbers = (d: string): number[] => [...d.matchAll(/-?(?:\d*\.)?\d+/g)].map((m) => Number(m[0]));

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

describe('eye icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('slashes the open eye: same outline and iris, plus one diagonal', () => {
    const [eye] = paths(IconPreview);
    const slashed = paths(IconEyeSlash);
    const iris = svg(IconPreview).querySelector('circle')?.outerHTML;

    expect(slashed).toContain(eye);
    expect(svg(IconEyeSlash).querySelector('circle')?.outerHTML).toBe(iris);
    const [slash] = slashed.filter((d) => d !== eye).flatMap(subpathsOf);
    const [[x1, y1], [x2, y2]] = slash;

    expect(Math.sign(x2 - x1)).toBe(Math.sign(y2 - y1));
    expect(Math.abs(x2 - x1)).toBe(Math.abs(y2 - y1));
    expect(Math.abs(x2 - x1)).toBeGreaterThanOrEqual(10);
  });

  it('closes the eye with the open eye lower lid curve, corner to corner', () => {
    const [lid] = paths(IconEyeClosed);
    const [x0, y0, c1x, c1y, c2x, c2y, x3, y3] = numbers(lid);
    // IconPreview's second curve is the lower lid, drawn right to left.
    const eye = numbers(paths(IconPreview)[0]);
    const lower = [[eye[12], eye[13]], [eye[10], eye[11]], [eye[8], eye[9]], [eye[6], eye[7]]];

    expect(svg(IconEyeClosed).querySelector('circle')).toBeNull();
    // Same corners and handle inset as the open eye.
    expect([x0, c1x, c2x, x3]).toEqual(lower.map(([x]) => x));
    // Same depth: handles as far below the corners as on the open eye.
    expect([c1y - y0, c2y - y3, y3 - y0]).toEqual([lower[1][1] - lower[0][1], lower[2][1] - lower[3][1], 0]);
  });

  it('keeps every drawing inside x/y 3-17', () => {
    for (const d of [...paths(IconEyeSlash), ...paths(IconEyeClosed)]) {
      for (const n of subpathsOf(d).flat(2)) {
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(17);
      }
    }
  });
});
