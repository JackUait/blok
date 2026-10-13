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
const numbers = (d: string): number[] => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

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
    const [slash] = slashed.filter((d) => d !== eye);
    const [x1, y1, x2, y2] = numbers(slash);

    expect(Math.sign(x2 - x1)).toBe(Math.sign(y2 - y1));
    expect(Math.abs(x2 - x1)).toBeGreaterThanOrEqual(10);
  });

  it('closes the eye with the open eye lower lid curve, corner to corner', () => {
    const [lid] = paths(IconEyeClosed);
    const [x0, y0, c1x, c1y, c2x, c2y, x3, y3] = numbers(lid);

    expect(svg(IconEyeClosed).querySelector('circle')).toBeNull();
    // IconPreview's lid: corners at x 3 and 17, handles 2.25 in and 6 down.
    expect([x0, c1x, c2x, x3]).toEqual([3, 5.25, 14.75, 17]);
    expect([c1y - y0, c2y - y3, y3 - y0]).toEqual([6, 6, 0]);
  });

  it('keeps every drawing inside x/y 3-17', () => {
    for (const d of [...paths(IconEyeSlash), ...paths(IconEyeClosed)]) {
      for (const n of numbers(d)) {
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(17);
      }
    }
  });
});
