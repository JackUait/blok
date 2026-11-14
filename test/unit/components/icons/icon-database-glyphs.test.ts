import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

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

/** Polylines of an icon's paths: one absolute point list per sub-path. */
const polylines = (markup: string | undefined): Point[][] => {
  const doc = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml');

  return [...doc.querySelectorAll('path')].flatMap((path) => (path.getAttribute('d') ?? '').match(/M[^M]+/g) ?? []).map(pointsOf);
};

const mirrorX = (lines: Point[][]): Point[][] => lines.map((line) => line.map(([x, y]): Point => [20 - x, y]));
const mirrorY = (lines: Point[][]): Point[][] => lines.map((line) => line.map(([x, y]): Point => [x, 20 - y]));

/** Every segment of a chevron arm runs at 45 degrees. */
const armsAt45 = (line: Point[]): boolean =>
  line.slice(1).every(([x, y], i) => Math.abs(Math.abs(x - (line[i]?.[0] ?? 0)) - Math.abs(y - (line[i]?.[1] ?? 0))) < 1e-9);

describe('database glyphs drawn after Notion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('small straight arrows (timeline off-screen chip)', () => {
    const left = polylines(icons.IconArrowLeftSmall);
    const right = polylines(icons.IconArrowRightSmall);

    it('draws a shaft and an open 45-degree head', () => {
      expect(left).toHaveLength(2);
      expect(left.find((line) => line.length === 3)).toSatisfy(armsAt45);
    });

    it('the right arrow mirrors the left about x = 10', () => {
      expect(right).toEqual(mirrorX(left));
    });

    // The chip draws it in a 14x12 box (Notion's measure), so a 20-unit
    // square renders at 0.6. Notion's arrow is about 8x7 px there.
    it('spans about 8 by 7 px at the chip size', () => {
      const points = left.flat();
      const width = Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
      const height = Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));

      expect(width * 0.6).toBeCloseTo(7.5, 0);
      expect(height * 0.6).toBeCloseTo(6.6, 0);
    });
  });

  describe('up/down chevron (select-like fields)', () => {
    const lines = polylines(icons.IconChevronUpDown);

    it('is two 45-degree chevrons, the lower one the upper turned over about y = 10', () => {
      expect(lines).toHaveLength(2);
      expect(lines.every(armsAt45)).toBe(true);
      expect(mirrorY([lines[0]])).toEqual([lines[1]]);
    });

    it('draws each half as IconChevronDown\'s skeleton, moved up or down only', () => {
      const [down = []] = polylines(icons.IconChevronDown);
      const [upper = [], lower = []] = lines;
      const shift = (lower[0]?.[1] ?? 0) - (down[0]?.[1] ?? 0);

      expect(lower).toEqual(down.map(([x, y]) => [x, y + shift]));
      expect(upper).toEqual(mirrorY([lower])[0]);
    });

    it('spans 7 by 12 units, with a 5-unit gap between the halves', () => {
      const points = lines.flat();
      const ys = points.map(([, y]) => y);
      const [upper = [], lower = []] = lines;

      expect(Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x))).toBe(7);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(12);
      expect(Math.min(...lower.map(([, y]) => y)) - Math.max(...upper.map(([, y]) => y))).toBe(5);
    });
  });
});
