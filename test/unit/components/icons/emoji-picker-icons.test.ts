import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconEmojiBall, IconEmojiLightbulb, IconEmojiSmile, IconEmojiUtensils,
} from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');
const pathsOf = (icon: string): string[] => Array.from(svgOf(icon).querySelectorAll('path'))
  .map(path => path.getAttribute('d') ?? '');

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

/** A point on an SVG arc segment, from the endpoint form (SVG 1.1 F.6.5). Rotation is ignored: these icons draw circular arcs. */
const arcPointAt = ({ from, to, arc }: Segment, t: number): Point => {
  const [rx = 0, , , large = 0, sweep = 0] = arc;
  const mx = (from[0] - to[0]) / 2;
  const my = (from[1] - to[1]) / 2;
  const radius = Math.max(rx, Math.hypot(mx, my));
  const offset = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, radius * radius / (mx * mx + my * my) - 1));
  const cx = (from[0] + to[0]) / 2 + offset * my;
  const cy = (from[1] + to[1]) / 2 - offset * mx;
  const begin = Math.atan2(from[1] - cy, from[0] - cx);
  let turn = Math.atan2(to[1] - cy, to[0] - cx) - begin;

  if (sweep === 1 && turn < 0) {
    turn += 2 * Math.PI;
  }
  if (sweep === 0 && turn > 0) {
    turn -= 2 * Math.PI;
  }

  return [cx + radius * Math.cos(begin + turn * t), cy + radius * Math.sin(begin + turn * t)];
};

/** On-curve and control points: every coordinate the path draws through or bends toward. */
const pointsOf = (d: string): Point[] => segmentsOf(d).flatMap(({ command, controls, to }) => (command === 'Z' ? [] : [...controls, to]));

/** Keyline keeps neighbouring strokes at least one unit of clear space apart. */
const CLEAR = 1;
const STROKE = 1.25;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('emoji category icon relationships', () => {
  it('gives the fork three evenly spaced tines with clear space between them', () => {
    const fork = segmentsOf(pathsOf(IconEmojiUtensils)[0] ?? '');
    const tines = fork.filter(({ command, from, to }) => command === 'L' && from[0] === to[0]);
    const xs = tines.map(({ from }) => from[0]).sort((a, b) => a - b);
    const [left = 0, center = 0, right = 0] = [...new Set(xs)];
    const stem = tines.find(({ from }) => from[0] === center);
    const top = Math.min(...tines.flatMap(({ from, to }) => [from[1], to[1]]));

    expect(new Set(xs).size).toBe(3);
    expect(center - left).toBe(right - center);
    expect(center - left - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(stem?.from[1]).toBe(top);
    expect(stem?.to[1]).toBe(16.5);
  });

  it('gives the ball two opposed curved seams that meet the shared circular frame', () => {
    const seams = (pathsOf(IconEmojiBall)[0]?.match(/M[^M]+/g) ?? []).map(seam => segmentsOf(seam));

    expect(seams).toHaveLength(2);
    const [first = [], second = []] = seams;

    expect(first.map(({ command }) => command).join('')).toBe('MA');
    expect(second.map(({ command }) => command).join('')).toBe('MA');
    // Opposed: the second seam is the first turned a half turn about the centre.
    const ends = (seam: Segment[]): number[] => [seam[1]?.from ?? [0, 0], seam[1]?.to ?? [0, 0]].flat();

    ends(first).forEach((value, index) => {
      expect(value + (ends(second)[index] ?? 0)).toBe(20);
    });
    const frame = svgOf(IconEmojiBall).querySelector('circle');
    const face = svgOf(IconEmojiSmile).querySelector('circle');
    const radius = Number(frame?.getAttribute('r'));

    for (const seam of [first, second]) {
      for (const [x, y] of [seam[1]?.from ?? [0, 0], seam[1]?.to ?? [0, 0]]) {
        expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(radius);
      }
    }
    const [firstMiddle, secondMiddle] = [first, second].map(([, arc]) => (arc === undefined ? [0, 0] : arcPointAt(arc, 0.5)));

    expect(Math.hypot((firstMiddle?.[0] ?? 0) - (secondMiddle?.[0] ?? 0), (firstMiddle?.[1] ?? 0) - (secondMiddle?.[1] ?? 0)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(face?.getAttribute(attribute));
    }
  });

  it('centers the bulb base under its broad neck with clear space', () => {
    const paths = pathsOf(IconEmojiLightbulb);
    const glass = pointsOf(paths[0] ?? '');
    const neckY = Math.max(...glass.map(([, y]) => y));
    const neckLeft = Math.min(...glass.filter(([, y]) => y === neckY).map(([x]) => x));
    const [base] = (paths[1]?.match(/M[^M]+/g) ?? []).map(line => pointsOf(line));
    const [[left, baseline] = [0, 0], [right] = [0, 0]] = base ?? [];
    const width = right - left;

    expect(left + width / 2).toBe(10);
    expect(width).toBeGreaterThanOrEqual(4);
    expect(left).toBeGreaterThanOrEqual(neckLeft);
    expect(baseline - neckY - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });
});
