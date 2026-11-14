import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (name: string): SVGSVGElement => {
  const markup = Object.entries(icons).find(([key]) => key === name)?.[1];

  expect(typeof markup, name).toBe('string');
  const svg = new DOMParser().parseFromString(String(markup), 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error(`Invalid SVG: ${name}`);
  }

  return svg;
};
const numbers = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
const pathOf = (svg: SVGSVGElement, index = 0): string => svg.querySelectorAll('path')[index]?.getAttribute('d') ?? '';
const numeric = (element: Element, attribute: string): number => Number(element.getAttribute(attribute));

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
const lowest = (points: Point[]): number => Math.max(...points.map(([, y]) => y));
const commandsOf = (d: string): string => segmentsOf(d).map(({ command }) => command).join('');

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('compact emoji picker artwork', () => {
  it.each([
    'Star', 'Smile', 'Sprout', 'Utensils', 'Ball', 'Globe', 'Lightbulb', 'Heart', 'Flag', 'Dice',
  ])('%s keeps the standard canvas, self-contained paint and decorative accessibility', (name) => {
    const svg = parse(`IconEmoji${name}`);

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('text, image, use, style, filter, foreignObject')).toBeNull();
    for (const stroke of svg.querySelectorAll('[stroke]')) {
      expect(stroke.getAttribute('stroke')).toBe('currentColor');
      expect(stroke.getAttribute('stroke-width')).toBe('1.25');
      expect(stroke.getAttribute('stroke-linecap')).toBe('round');
      expect(stroke.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it('mirrors the heart lobes about the canvas centre and spans the family circle box', () => {
    const svg = parse('IconEmojiHeart');
    const outline = pathOf(svg);
    const points = pointsOf(outline);
    const key = (x: number, y: number): string => `${round(x)},${round(y)}`;
    const drawn = points.map(([x, y]) => key(x, y));
    const face = parse('IconEmojiSmile').querySelector('circle');

    if (face === null) {
      throw new Error('IconEmojiSmile lost the family circle');
    }

    expect(outline.endsWith('Z')).toBe(true);
    expect(svg.getAttribute('fill')).toBe('none');

    // A lopsided heart reads as a scribble next to the family's symmetric shapes.
    for (const [x, y] of points) {
      expect(drawn, `unmirrored point ${key(x, y)}`).toContain(key(20 - x, y));
    }

    const edge = numeric(face, 'cx') - numeric(face, 'r');
    const xs = points.map(([x]) => x);

    expect(Math.min(...xs)).toBe(edge);
    expect(Math.max(...xs)).toBe(20 - edge);
  });

  it('draws the star as the outline IconStarFilled fills, without filling it', () => {
    const svg = parse('IconEmojiStar');
    const outline = svg.querySelector('path');

    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(outline?.getAttribute('d')).toBe(parse('IconStarFilled').querySelector('path')?.getAttribute('d'));
    expect(outline?.hasAttribute('fill')).toBe(false);
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('centers one open smile curve with clear space below the eyes and above the frame', () => {
    const svg = parse('IconEmojiSmile');
    const mouth = pathOf(svg);
    const [frame, ...eyes] = Array.from(svg.querySelectorAll('circle'));

    expect(commandsOf(mouth)).toBe('MC');
    const [, curve] = segmentsOf(mouth);
    const [left, top] = curve?.from ?? [0, 0];
    const [right, endY] = curve?.to ?? [0, 0];
    const [[controlX1, controlY1] = [0, 0], [controlX2, controlY2] = [0, 0]] = curve?.controls ?? [];

    expect(left + right).toBe(20);
    expect(top).toBe(endY);
    expect(controlX1 + controlX2).toBe(20);
    expect(controlY1).toBe(controlY2);
    const bottom = lowest(samplesOf(mouth));

    expect(bottom - top).toBeGreaterThanOrEqual(STROKE);
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      expect(top - numeric(eye, 'cy') - numeric(eye, 'r') - STROKE / 2).toBeGreaterThanOrEqual(CLEAR);
    }
    if (frame === undefined) {
      throw new Error('IconEmojiSmile lost its frame');
    }
    expect(numeric(frame, 'cy') + numeric(frame, 'r') - bottom - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('attaches both leaves to a centered vertical stem that stops at the upper leaf', () => {
    const svg = parse('IconEmojiSprout');
    const stemPath = pathOf(svg, 2);

    expect(stemPath).toMatch(/^M[\d. ]+V[\d.]+$/);
    expect(svg.querySelectorAll('path')).toHaveLength(3);
    const [stemX, stemBottom, stemTop] = numbers(stemPath);

    expect(stemX).toBe(10);

    const leaves = [pathOf(svg, 0), pathOf(svg, 1)].map((outline) => {
      expect(commandsOf(outline)).toBe('MCCZ');
      const [start, tip] = segmentsOf(outline).map(({ to }) => to);
      const points = pointsOf(outline);

      expect(points.at(-1)).toStrictEqual(start);
      expect(start?.[0]).toBe(stemX);
      expect(start?.[1]).toBeGreaterThanOrEqual(stemTop);
      expect(stemBottom - lowest(points) - STROKE).toBeGreaterThanOrEqual(CLEAR);

      return { start: start ?? [0, 0], tip: tip ?? [0, 0] };
    });
    const [left, right] = leaves;

    expect(left?.tip[0]).toBeLessThan(stemX);
    expect(right?.tip[0]).toBeGreaterThan(stemX);
    expect(left?.start[1]).toBeGreaterThan(right?.start[1] ?? 0);
    expect(stemTop).toBe(right?.start[1]);
  });

  it('aligns the spoon handle with its bowl and the fork baseline', () => {
    const svg = parse('IconEmojiUtensils');
    const bowl = svg.querySelector('ellipse');

    expect(bowl).not.toBeNull();
    if (bowl === null) {
      return;
    }
    const fork = pointsOf(pathOf(svg, 0));
    const [[x, top] = [0, 0], [, bottom] = [0, 0]] = pointsOf(pathOf(svg, 1));

    expect(x).toBe(numeric(bowl, 'cx'));
    expect(top).toBe(numeric(bowl, 'cy') + numeric(bowl, 'ry'));
    expect(bottom).toBe(lowest(fork));
    expect(x - numeric(bowl, 'rx') - Math.max(...fork.map(([forkX]) => forkX)) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('keeps the ball interior open between its two curved seams', () => {
    const seams = pathOf(parse('IconEmojiBall')).match(/M[^M]+/g) ?? [];

    expect(seams).toHaveLength(2);
    for (const seam of seams) {
      expect(commandsOf(seam)).toBe('MA');
    }
    const [first = [], second = []] = seams.map(seam => samplesOf(seam));

    expect(nearest(first, second) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('anchors smooth continental edges to the shared circular frame', () => {
    const globe = parse('IconEmojiGlobe');
    const face = parse('IconEmojiSmile').querySelector('circle');
    const frame = globe.querySelector('circle');

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(face?.getAttribute(attribute));
    }
    if (frame === null) {
      throw new Error('IconEmojiGlobe lost its frame');
    }
    const radius = numeric(frame, 'r');

    expect(globe.querySelectorAll('path')).toHaveLength(2);
    for (const element of globe.querySelectorAll('path')) {
      const outline = element.getAttribute('d') ?? '';

      expect(outline).toMatch(/^M[\d. ]+(C[\d. ]+){2,3}$/);
      const path = numbers(outline);

      expect(Math.hypot(path[0] - 10, path[1] - 10)).toBeCloseTo(radius, 1);
      expect(Math.hypot(path[path.length - 2] - 10, path[path.length - 1] - 10)).toBeCloseTo(radius, 1);
      for (const [x, y] of samplesOf(outline)) {
        expect(Math.hypot(x - 10, y - 10)).toBeLessThanOrEqual(radius + 0.01);
      }
    }
  });

  it('keeps symmetric glass clear of two centred base lines, the lower one shorter', () => {
    const svg = parse('IconEmojiLightbulb');

    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelector('line, polyline, polygon, circle, ellipse')).toBeNull();
    expect(svg.getAttribute('fill')).toBe('none');
    const glass = pathOf(svg);

    expect(commandsOf(glass)).toBe('MCACZ');
    const points = pointsOf(glass);

    for (const [x, y] of points) {
      expect(points.map(point => point.join())).toContain(`${20 - x},${y}`);
    }
    const neck = lowest(points);
    const lines = (pathOf(svg, 1).match(/M[^M]+/g) ?? []).map(line => numbers(line));

    expect(pathOf(svg, 1)).toMatch(/^(M[\d. ]+h[\d.]+)+$/);
    expect(lines).toHaveLength(2);
    const [upper = [], lower = []] = lines;

    for (const [left = 0, , width = 0] of lines) {
      expect(left + width / 2).toBe(10);
    }
    expect(upper[0]).toBeGreaterThanOrEqual(Math.min(...points.filter(([, y]) => y === neck).map(([x]) => x)));
    expect(lower[2]).toBeLessThan(upper[2] ?? 0);
    expect((upper[1] ?? 0) - neck - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect((lower[1] ?? 0) - (upper[1] ?? 0) - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it('draws the pole and cloth as one stroke, with no transform', () => {
    const svg = parse('IconEmojiFlag');
    const flag = pathOf(svg);

    expect(svg.querySelector('g, [transform]')).toBeNull();
    expect(svg.hasAttribute('transform')).toBe(false);
    expect(svg.querySelectorAll(':scope > path')).toHaveLength(1);
    const segments = segmentsOf(flag);
    const [foot, poleTop] = segments.map(({ to }) => to);
    const clothEnd = segments.at(-1)?.to ?? [0, 0];
    const fly = segments.find(({ command, from, to }) => command === 'L' && from[0] === to[0] && from[0] !== foot?.[0]);

    expect(segments[1]?.command).toBe('L');
    expect(poleTop?.[0]).toBe(foot?.[0]);
    expect(clothEnd[0]).toBe(foot?.[0]);
    // The cloth ends partway down the pole.
    expect(clothEnd[1]).toBeGreaterThan(poleTop?.[1] ?? 0);
    expect(clothEnd[1]).toBeLessThan(foot?.[1] ?? 0);
    expect(Math.abs((fly?.to[1] ?? 0) - (fly?.from[1] ?? 0))).toBeGreaterThanOrEqual(7.5);
  });

  it('hides the two side pips a six needs until the die rolls', () => {
    const svg = parse('IconEmojiDice');
    const sides = Array.from(svg.querySelectorAll('[data-blok-dice-pip="side"]'));

    expect(sides.map(pip => [numeric(pip, 'cx'), numeric(pip, 'cy')])).toEqual([[7, 10], [13, 10]]);
    for (const pip of sides) {
      expect(pip.getAttribute('transform')).toBe('scale(0)');
    }
    expect(svg.querySelectorAll('[data-blok-dice-pip="corner"]')).toHaveLength(2);
    expect(svg.querySelectorAll('[data-blok-dice-pip="center"]')).toHaveLength(1);
  });

  it('centers five pips in a single tilted die with generous edge clearance', () => {
    const svg = parse('IconEmojiDice');
    const group = svg.querySelector('[data-blok-dice-roll] > g');
    const frame = group?.querySelector('rect');
    const pips = Array.from(group?.querySelectorAll('circle:not([transform])') ?? []);

    expect(group?.getAttribute('transform')).toMatch(/^rotate\(-[\d.]+ 10 10\)$/);
    expect(pips).toHaveLength(5);
    expect(frame).toBeDefined();
    expect(frame).not.toBeNull();
    if (frame === undefined || frame === null) {
      return;
    }
    const left = numeric(frame, 'x');
    const top = numeric(frame, 'y');
    const right = left + numeric(frame, 'width');
    const bottom = top + numeric(frame, 'height');

    expect(pips.reduce((sum, pip) => sum + numeric(pip, 'cx'), 0) / pips.length).toBe(10);
    expect(pips.reduce((sum, pip) => sum + numeric(pip, 'cy'), 0) / pips.length).toBe(10);
    for (const pip of pips) {
      const x = numeric(pip, 'cx');
      const y = numeric(pip, 'cy');
      const radius = numeric(pip, 'r');

      expect(Math.min(x - left, right - x, y - top, bottom - y) - radius - 0.625).toBeGreaterThanOrEqual(1.25);
    }
  });

});
