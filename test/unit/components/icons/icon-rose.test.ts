/**
 * The Ask AI rose: a four-petal rose curve in one closed stroke. The working bar
 * turns it, so it must look the same a quarter turn on, or the turn would read
 * as a loop with a start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconRose } from '../../../../src/components/icons';

const doc = (): Document => new DOMParser().parseFromString(IconRose, 'image/svg+xml');

type Point = [number, number];

interface Segment {
  cmd: string;
  from: Point;
  points: Point[];
  arc?: { rx: number; ry: number; large: number; sweep: number };
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// Every command made absolute: H/V become L, S/T get their reflected control point.
const segmentsOf = (d: string): Segment[] => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let cmd = '';
  let index = 0;

  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) {
      cmd = tokens[index];
      index += 1;
    }
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const args = tokens.slice(index, index + ARITY[upper]).map(Number);

    index += ARITY[upper];
    const at = (x: number, y: number): Point => relative ? [pen[0] + x, pen[1] + y] : [x, y];
    const previous = out[out.length - 1];
    const reflect = (): Point => {
      const control = previous !== undefined && ['C', 'Q'].includes(previous.cmd) ? previous.points[previous.points.length - 2] : pen;

      return [2 * pen[0] - control[0], 2 * pen[1] - control[1]];
    };
    let segment: Segment;

    switch (upper) {
      case 'M': segment = { cmd: 'M', from: pen, points: [at(args[0], args[1])] }; start = segment.points[0]; cmd = relative ? 'l' : 'L'; break;
      case 'L': segment = { cmd: 'L', from: pen, points: [at(args[0], args[1])] }; break;
      case 'H': segment = { cmd: 'L', from: pen, points: [[relative ? pen[0] + args[0] : args[0], pen[1]]] }; break;
      case 'V': segment = { cmd: 'L', from: pen, points: [[pen[0], relative ? pen[1] + args[0] : args[0]]] }; break;
      case 'C': segment = { cmd: 'C', from: pen, points: [at(args[0], args[1]), at(args[2], args[3]), at(args[4], args[5])] }; break;
      case 'S': segment = { cmd: 'C', from: pen, points: [reflect(), at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'Q': segment = { cmd: 'Q', from: pen, points: [at(args[0], args[1]), at(args[2], args[3])] }; break;
      case 'T': segment = { cmd: 'Q', from: pen, points: [reflect(), at(args[0], args[1])] }; break;
      case 'A': segment = { cmd: 'A', from: pen, points: [at(args[5], args[6])], arc: { rx: args[0], ry: args[1], large: args[3], sweep: args[4] } }; break;
      default: segment = { cmd: 'Z', from: pen, points: [start] };
    }
    out.push(segment);
    pen = segment.points[segment.points.length - 1];
  }

  return out;
};

// Every end and control point, absolute, so the drawing's relative commands compare as coordinates.
const points = (d: string): Point[] => segmentsOf(d).flatMap((segment) => segment.points);

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
    const has = ([x, y]: Point): boolean => all.some(([px, py]) => Math.abs(px - x) < 0.02 && Math.abs(py - y) < 0.02);

    expect(all.length).toBeGreaterThan(8);
    all.forEach(([x, y]) => expect(has([10 - (y - 10), 10 + (x - 10)]), `${x} ${y}`).toBe(true));
  });
});
