/**
 * The Ask AI bar's Undo: a hooked arrow that turns back. Its head is the
 * return icon's head, so the two arrows read as one family.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconReturn, IconUndo } from '../../../../src/components/icons';

const paths = (markup: string): string[] =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => path.getAttribute('d') ?? '');

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

/** A three-point head, as its two arms from the tip. */
const arms = ([a, tip, b]: Point[]): number[][] =>
  [[a[0] - tip[0], a[1] - tip[1]], [b[0] - tip[0], b[1] - tip[1]]].sort((p, q) => p[1] - q[1]);

const headOf = (markup: string): Point[] | undefined =>
  paths(markup).flatMap(subpathsOf).find((stroke) => stroke.length === 3);

describe('IconUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('points left with the return icon\'s arrowhead', () => {
    const head = headOf(IconUndo);
    const returnHead = headOf(IconReturn);

    expect(head).toBeDefined();
    expect(returnHead).toBeDefined();

    const undoArms = arms(head ?? []);

    expect(undoArms).toEqual(arms(returnHead ?? []));
    // Both arms go right of the tip: the arrow points left.
    undoArms.forEach(([dx]) => expect(dx).toBeGreaterThan(0));
  });
});
