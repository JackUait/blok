/**
 * The database toolbar's Filter and Sort icons (research/07:53 draws both as
 * 28px icon buttons). Filter: three centred rules that narrow, on the list
 * rows. Sort: an up and a down arrow, one skeleton mirrored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconChevronDoubleRight, IconChevronRight, IconFilter, IconSigma, IconSort } from '../../../../src/components/icons';

const paths = (markup: string): string[] =>
  [ ...markup.matchAll(/<path d="([^"]+)"/g) ].map((m) => m[1]);

type Point = [number, number];

interface Segment { command: string; from: Point; to: Point; controls: Point[]; arc: number[] }

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const IMPLICIT_LINE: Record<string, string> = { M: 'L', m: 'l' };
const NORMALISED: Record<string, string> = { H: 'L', V: 'L', S: 'C', T: 'Q' };

/** Absolute segments of path data. H and V become L, S becomes C, T becomes Q; an arc keeps [rx, ry, rotation, large, sweep]. */
const segmentsOf = (d: string): Segment[] => {
  // One [letter, args] entry per drawn command; extra pairs after M are implicit L.
  const commands = Array.from(d.matchAll(/([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi), ([, letter = '', body = '']) => {
    const values = body.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    const arity = ARITY[letter.toUpperCase()] ?? 0;
    const count = arity === 0 ? 1 : Math.max(1, values.length / arity);

    return Array.from({ length: count }, (_, index) => ({
      letter: index > 0 ? IMPLICIT_LINE[letter] ?? letter : letter,
      args: values.slice(index * arity, index * arity + arity),
    }));
  }).flat();
  const segments: Segment[] = [];
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let control: Point | null = null;

  for (const { letter, args } of commands) {
    const command = letter.toUpperCase();
    const from = pen;
    const [dx, dy] = letter === command ? [0, 0] : from;
    const at = (offset: number): Point => [(args[offset] ?? 0) + dx, (args[offset + 1] ?? 0) + dy];
    const reflected: Point = control === null ? from : [2 * from[0] - control[0], 2 * from[1] - control[1]];
    const controlsBy: Record<string, Point[]> = { C: [at(0), at(2)], S: [reflected, at(0)], Q: [at(0)], T: [reflected] };
    const endBy: Record<string, Point> = { H: [(args[0] ?? 0) + dx, from[1]], V: [from[0], (args[0] ?? 0) + dy], Z: start };
    const controls = controlsBy[command] ?? [];
    const to = endBy[command] ?? at(args.length - 2);

    segments.push({ command: NORMALISED[command] ?? command, from, to, controls, arc: command === 'A' ? args.slice(0, 5) : [] });
    control = controls.at(-1) ?? null;
    pen = to;
    start = command === 'M' ? to : start;
  }

  return segments;
};

/** On-curve and control points: every coordinate the path draws through or bends toward. */
const pointsOf = (d: string): Point[] => segmentsOf(d).flatMap(({ command, controls, to }) => (command === 'Z' ? [] : [...controls, to]));

/** Every drawn sub-path, as its absolute points. */
const strokesOf = (markup: string): Point[][] => paths(markup).flatMap(d => d.match(/M[^M]+/g) ?? []).map(pointsOf);
const keys = (points: Point[]): string[] => points.map(point => point.join()).sort();

describe('database toolbar icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Filter: three rules centred on x 10, each shorter, from the first to the last list row', () => {
    const rules = strokesOf(IconFilter);

    expect(rules).toHaveLength(3);
    for (const [[x1, y1] = [0, 0], [x2, y2] = [0, 0], ...rest] of rules) {
      expect(rest).toHaveLength(0);
      expect(y2).toBe(y1);
      expect((x1 + x2) / 2).toBe(10);
    }
    const widths = rules.map(([[x1] = [0], [x2] = [0]]) => x2 - x1);

    expect(widths[0]).toBeGreaterThan(widths[1] ?? 0);
    expect(widths[1]).toBeGreaterThan(widths[2] ?? 0);
    expect(rules.map(([[, y] = [0, 0]]) => y)).toEqual([6.5, 10, 13.5]);
  });

  it('Sort: the down arrow is the up arrow turned over, same arm length', () => {
    const [up = '', down = ''] = paths(IconSort);
    const flipped = pointsOf(up).map(([x, y]): Point => [x + 6, 20 - y]);

    expect(new Set(keys(pointsOf(down)))).toEqual(new Set(keys(flipped)));
  });

  it('Sigma: one stroke on the type cap and baseline, centred on x 10, its halves mirrored', () => {
    const all = paths(IconSigma);
    const points = pointsOf(all[0] ?? '');
    const ys = points.map(([, y]) => y);
    const xs = points.map(([x]) => x);

    expect(all).toHaveLength(1);
    expect(strokesOf(IconSigma)).toHaveLength(1);
    // Keyline type grid: cap 4.5, baseline 15.5.
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([4.5, 15.5]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(10);
    expect(keys(points.map(([x, y]) => [x, 20 - y]))).toEqual(keys(points));
  });

  it('Minimize: two copies of IconChevronRight\'s skeleton, 4 units apart and centred on the canvas', () => {
    const [single = []] = strokesOf(IconChevronRight);
    const [left, right] = strokesOf(IconChevronDoubleRight);
    const shift = (dx: number): Point[] => single.map(([x, y]) => [x + dx, y]);

    expect(strokesOf(IconChevronDoubleRight)).toHaveLength(2);
    expect(left).toEqual(shift(-2));
    expect(right).toEqual(shift(2));
  });
});
