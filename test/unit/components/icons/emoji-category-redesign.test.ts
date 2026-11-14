import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const svgOf = (name: string): SVGSVGElement => {
  const markup = Object.entries(icons).find(([key]) => key === name)?.[1];

  expect(typeof markup, name).toBe('string');
  const svg = new DOMParser().parseFromString(String(markup), 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error(`Invalid SVG: ${name}`);
  }

  return svg;
};
const pathOf = (svg: SVGSVGElement, index: number): string => svg.querySelectorAll('path')[index]?.getAttribute('d') ?? '';
const valuesOf = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
const numeric = (element: Element | null | undefined, attribute: string): number => Number(element?.getAttribute(attribute));

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

/** Points along every drawn segment, for stroke-to-stroke distances. */
const samplesOf = (d: string): Point[] => segmentsOf(d).flatMap((segment) => {
  if (segment.command === 'M') {
    return [segment.to];
  }

  return Array.from({ length: 41 }, (_, step) => {
    if (segment.command === 'A') {
      return arcPointAt(segment, step / 40);
    }
    // De Casteljau works for lines, quadratics and cubics alike.
    let level = [segment.from, ...segment.controls, segment.to];

    while (level.length > 1) {
      level = level.slice(1).map(([x, y], index) => {
        const [px, py] = level[index] ?? [x, y];

        return [px + (x - px) * step / 40, py + (y - py) * step / 40] as Point;
      });
    }

    return level[0] ?? segment.to;
  });
});

/** On-curve and control points: every coordinate the path draws through or bends toward. */
const pointsOf = (d: string): Point[] => segmentsOf(d).flatMap(({ command, controls, to }) => (command === 'Z' ? [] : [...controls, to]));

const nearest = (a: Point[], b: Point[]): number =>
  Math.min(...a.flatMap(([x, y]) => b.map(([bx, by]) => Math.hypot(x - bx, y - by))));

/** Keyline keeps neighbouring strokes at least one unit of clear space apart. */
const CLEAR = 1;
const STROKE = 1.25;

const round = (value: number): number => Math.round(value * 100) / 100;

/** Every point has a twin mirrored across the vertical line x = axis, to 0.01. */
const expectMirrored = (points: Point[], axis: number): void => {
  const drawn = points.map(([x, y]) => `${round(x)},${round(y)}`);

  for (const [x, y] of points) {
    expect(drawn, `unmirrored point ${round(x)},${round(y)}`).toContain(`${round(2 * axis - x)},${round(y)}`);
  }
};

const lowest = (points: Point[]): number => Math.max(...points.map(([, y]) => y));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('expressive emoji categories', () => {
  it.each(['Sparkles', 'Wink', 'Bowl', 'Gamepad', 'Map', 'Hearts'])('%s stays legible in the house icon frame', (name) => {
    const svg = svgOf(`IconEmoji${name}`);

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelectorAll('path, circle, ellipse, line, polyline, polygon').length).toBeGreaterThan(1);
    for (const stroke of svg.querySelectorAll('[stroke]')) {
      expect(stroke.getAttribute('stroke')).toBe('currentColor');
      expect(stroke.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it('draws two symmetric four-point sparkles and a twinkle dot, each clear of the others', () => {
    const sparkles = svgOf('IconEmojiSparkles');
    const stars = [pathOf(sparkles, 0), pathOf(sparkles, 1)];

    for (const star of stars) {
      expect(segmentsOf(star).map(({ command }) => command).join('')).toBe('MQQQQZ');
      const points = pointsOf(star);
      const [tipX] = points.at(-1) ?? [0, 0];

      expectMirrored(points, tipX);
    }
    const [big = [], small = []] = stars.map(star => samplesOf(star));

    expect(nearest(big, small) - STROKE).toBeGreaterThanOrEqual(CLEAR);

    const dot = sparkles.querySelector('circle');

    expect(dot?.getAttribute('fill')).toBe('currentColor');
    expect(nearest([[numeric(dot, 'cx'), numeric(dot, 'cy')]], [...big, ...small]) - numeric(dot, 'r') - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
  });

  it('winks the smile: same frame, eye and mouth, with a closed eye mirrored across', () => {
    const wink = svgOf('IconEmojiWink');
    const smile = svgOf('IconEmojiSmile');
    const [frame, eye] = Array.from(wink.querySelectorAll('circle'));
    const [smileFrame, smileEye] = Array.from(smile.querySelectorAll('circle'));

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(smileFrame?.getAttribute(attribute));
      expect(eye?.getAttribute(attribute)).toBe(smileEye?.getAttribute(attribute));
    }
    expect(wink.querySelectorAll('circle[fill="currentColor"]')).toHaveLength(1);
    expect(pathOf(wink, 1)).toBe(pathOf(smile, 0));

    const closedEye = segmentsOf(pathOf(wink, 0));
    const [, lid] = closedEye;

    expect(closedEye.map(({ command }) => command).join('')).toBe('MQ');
    expect(round(((lid?.from[0] ?? 0) + (lid?.to[0] ?? 0)) / 2)).toBe(20 - numeric(eye, 'cx'));
    expect(lid?.from[1]).toBe(lid?.to[1]);

    const mouth = samplesOf(pathOf(wink, 1));
    const top = Math.min(...mouth.map(([, y]) => y));

    expect(top - numeric(eye, 'cy') - numeric(eye, 'r') - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
    expect(numeric(frame, 'cy') + numeric(frame, 'r') - lowest(mouth) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('centers the bowl, its foot and both steam wisps, with clear air above the rim', () => {
    const bowl = svgOf('IconEmojiBowl');
    const rim = pointsOf(pathOf(bowl, 0));
    const steam = pathOf(bowl, 2).match(/M[^M]+/g) ?? [];

    expectMirrored(rim, 10);
    const [footX = 0, , footWidth = 0] = valuesOf(pathOf(bowl, 1));

    expect(pathOf(bowl, 1)).toMatch(/^M[\d. ]+h[\d.]+$/);
    expect(2 * footX + footWidth).toBe(20);
    expect(steam).toHaveLength(2);
    const [left, right] = steam.map(curl => valuesOf(curl));

    expect((left?.[0] ?? 0) + (right?.[0] ?? 0)).toBe(20);
    for (const curl of steam) {
      expect((rim[0]?.[1] ?? 0) - lowest(pointsOf(curl)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    }
  });

  it('draws a symmetric controller body with no cable, a d-pad and one button on its row', () => {
    const controller = svgOf('IconEmojiGamepad');
    const body = pathOf(controller, 0);

    expect(controller.querySelectorAll('path')).toHaveLength(2);
    expectMirrored(pointsOf(body), 10);

    const buttons = Array.from(controller.querySelectorAll('circle'));

    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    const pad = pointsOf(pathOf(controller, 1));
    const padRight = Math.max(...pad.map(([x]) => x));
    const padRow = (Math.min(...pad.map(([, y]) => y)) + lowest(pad)) / 2;

    expect(button?.getAttribute('fill')).toBe('currentColor');
    expect(numeric(button, 'cy')).toBe(padRow);
    expect(numeric(button, 'cx') - numeric(button, 'r') - padRight - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
    expect(nearest(samplesOf(pathOf(controller, 1)), samplesOf(body)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(nearest([[numeric(button, 'cx'), numeric(button, 'cy')]], samplesOf(body)) - numeric(button, 'r') - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
  });

  it('plants a centered location pin in an open ground ring that never crosses the pin', () => {
    const pin = svgOf('IconEmojiMap');
    const outline = pathOf(pin, 0);
    const hole = pin.querySelector('circle');
    const ground = pointsOf(pathOf(pin, 1));

    expect(segmentsOf(outline).map(({ command }) => command).join('')).toBe('MCACZ');
    const [tipX, tipY] = valuesOf(outline);

    expect(tipX).toBe(10);
    expect(numeric(hole, 'cx')).toBe(10);
    expect(hole?.hasAttribute('fill')).toBe(false);

    expect(pathOf(pin, 1).endsWith('Z')).toBe(false);
    expectMirrored(ground, 10);
    const [start] = segmentsOf(pathOf(pin, 1)).map(({ to }) => to);

    expect(tipY).toBeLessThan(lowest(ground));
    // The ring breaks where the pin stands; its loose ends keep clear air from the pin.
    expect(nearest([start ?? [0, 0], ground.at(-1) ?? [0, 0]], samplesOf(outline)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(nearest(samplesOf(pathOf(pin, 1)), samplesOf(outline)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(lowest(ground)).toBeLessThanOrEqual(17);
  });

  it('pairs an outlined heart with a smaller filled twin, both symmetric and clear of each other', () => {
    const hearts = svgOf('IconEmojiHearts');
    const paths = Array.from(hearts.querySelectorAll('path'));

    expect(paths).toHaveLength(2);
    const [outline, solid] = paths;

    expect(outline?.getAttribute('stroke')).toBe('currentColor');
    expect(outline?.hasAttribute('fill')).toBe(false);
    // Keyline filled twin: fill added, stroke kept.
    expect(solid?.getAttribute('fill')).toBe('currentColor');
    expect(solid?.getAttribute('stroke')).toBe('currentColor');

    const shapes = paths.map(path => pointsOf(path.getAttribute('d') ?? ''));

    for (const [index, path] of paths.entries()) {
      expect(path.getAttribute('d')?.endsWith('Z')).toBe(true);
      const points = shapes[index] ?? [];
      const [tipX] = points.at(-1) ?? [0, 0];

      expectMirrored(points, tipX);
    }
    const big = shapes[0] ?? [];
    const small = shapes[1] ?? [];
    const widthOf = (points: Point[]): number => Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
    const gap = nearest(samplesOf(outline?.getAttribute('d') ?? ''), samplesOf(solid?.getAttribute('d') ?? ''));

    expect(widthOf(small)).toBeLessThan(widthOf(big));
    expect(gap - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });
});
