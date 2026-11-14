/**
 * Edit formula's ↩ (Notion's `arrowUTurnDownLeft`): a left arrow whose shaft turns up and back
 * on the right.
 */
import { describe, expect, it } from 'vitest';

import { IconReturn, IconUndo, IconUTurnLeft } from '../../../../src/components/icons';

const STROKE = 1.25;

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

const strokes = (markup: string): Point[][] => paths(markup).flatMap(subpathsOf);

const arms = ([a, tip, b]: Point[]): number[][] =>
  [[a[0] - tip[0], a[1] - tip[1]], [b[0] - tip[0], b[1] - tip[1]]].sort((p, q) => p[1] - q[1]);

describe('IconUTurnLeft', () => {
  const [shaft, head] = strokes(IconUTurnLeft);

  it('is a new drawing, not the Enter arrow', () => {
    expect(IconUTurnLeft).not.toBe(IconReturn);
    expect(strokes(IconUTurnLeft)).toHaveLength(2);
    expect(head).toHaveLength(3);
  });

  it('ends its shaft at the arrowhead\'s tip, which points left', () => {
    const [a, tip, b] = head;

    expect(shaft[shaft.length - 1]).toEqual(tip);
    expect(a[0]).toBeGreaterThan(tip[0]);
    expect(b[0]).toBeGreaterThan(tip[0]);
    expect(a[1] + b[1]).toBe(2 * tip[1]);
    // The same head as Undo, the other left-pointing hook.
    expect(arms(head)).toEqual(arms(strokes(IconUndo)[0]));
  });

  it('turns its shaft back with a half circle, so the top stroke sits one diameter above it', () => {
    const d = paths(IconUTurnLeft)[0];
    const arc = /a([\d.]+) ([\d.]+) 0 0 1 0 (-?[\d.]+)/.exec(d);
    const [, start] = /^M[\d.]+ ([\d.]+)/.exec(d) ?? [];

    expect(arc).not.toBeNull();
    expect(Number(arc?.[3])).toBe(2 * Number(arc?.[1]));
    expect(Number(start) + Number(arc?.[3])).toBe(head[1][1]);
  });

  it('centres its ink on the 20 canvas, inside the live area', () => {
    const [a, tip, b] = head;
    const arc = /h(-?[\d.]+)a([\d.]+)/.exec(paths(IconUTurnLeft)[0]);
    const right = shaft[0][0] + Number(arc?.[1]) + Number(arc?.[2]) + STROKE / 2;
    const left = tip[0] - STROKE / 2;
    const top = Math.min(a[1], shaft[0][1]) - STROKE / 2;
    const bottom = b[1] + STROKE / 2;

    expect((left + right) / 2).toBe(10);
    expect((top + bottom) / 2).toBe(10);
    expect(left + STROKE / 2).toBeGreaterThanOrEqual(3);
    expect(right - STROKE / 2).toBeLessThanOrEqual(17);
  });
});
