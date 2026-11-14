import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconToggleList, IconListNumbered,
} from '../../../../src/components/icons';

type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };
type Pen = { at: Point; start: Point; control: Point | null };

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, A: 7, Z: 0 };
const SAMPLES = 64;

const sweepTurn = (raw: number, sweep: boolean): number => {
  if (sweep && raw < 0) {
    return raw + 2 * Math.PI;
  }
  if (!sweep && raw > 0) {
    return raw - 2 * Math.PI;
  }

  return raw;
};

// Arcs here never rotate, so the x-axis-rotation argument is ignored.
const arcPoints = (from: Point, to: Point, rx: number, ry: number, large: boolean, sweep: boolean): Point[] => {
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const grow = Math.max(1, Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)));
  const a = rx * grow;
  const b = ry * grow;
  const spread = Math.max(0, a * a * b * b - a * a * dy * dy - b * b * dx * dx) / (a * a * dy * dy + b * b * dx * dx);
  const k = (large === sweep ? -1 : 1) * Math.sqrt(spread);
  const cx = (k * a * dy) / b + (from.x + to.x) / 2;
  const cy = (-k * b * dx) / a + (from.y + to.y) / 2;
  const start = Math.atan2((from.y - cy) / b, (from.x - cx) / a);
  const turn = sweepTurn(Math.atan2((to.y - cy) / b, (to.x - cx) / a) - start, sweep);

  return Array.from({ length: SAMPLES + 1 }, (_, i) => ({
    x: cx + a * Math.cos(start + (turn * i) / SAMPLES),
    y: cy + b * Math.sin(start + (turn * i) / SAMPLES),
  }));
};

const cubicPoints = (p0: Point, p1: Point, p2: Point, p3: Point): Point[] =>
  Array.from({ length: SAMPLES }, (_, i) => {
    const t = (i + 1) / SAMPLES;
    const u = 1 - t;

    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  });

const lineEnd = (command: string, origin: Point, at: Point, v: number[]): Point => {
  if (command === 'H') {
    return { x: origin.x + v[0], y: at.y };
  }
  if (command === 'V') {
    return { x: at.x, y: origin.y + v[0] };
  }

  return { x: origin.x + v[0], y: origin.y + v[1] };
};

// Points one segment adds; moves the pen to the segment's end.
const segmentPoints = (pen: Pen, letter: string, v: number[], first: boolean): Point[] => {
  const command = letter.toUpperCase();
  const from = pen.at;
  const origin = letter === command ? { x: 0, y: 0 } : from;
  const abs = (x: number, y: number): Point => ({ x: origin.x + x, y: origin.y + y });

  if (command === 'C' || command === 'S') {
    const reflected = pen.control === null ? from : { x: 2 * from.x - pen.control.x, y: 2 * from.y - pen.control.y };
    const head = command === 'C' ? abs(v[0], v[1]) : reflected;
    const rest = command === 'C' ? v.slice(2) : v;
    const second = abs(rest[0], rest[1]);
    const end = abs(rest[2], rest[3]);

    Object.assign(pen, { at: end, control: second });

    return cubicPoints(from, head, second, end);
  }
  if (command === 'A') {
    const end = abs(v[5], v[6]);

    Object.assign(pen, { at: end, control: null });

    return arcPoints(from, end, v[0], v[1], v[3] === 1, v[4] === 1);
  }

  const end = lineEnd(command, origin, from, v);

  Object.assign(pen, { at: end, control: null, start: command === 'M' && first ? end : pen.start });

  return [end];
};

// Absolute points along the centreline: line vertices as drawn, curves and arcs sampled.
const inkOf = (d: string): Point[] => {
  const pen: Pen = { at: { x: 0, y: 0 }, start: { x: 0, y: 0 }, control: null };

  return Array.from(d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)).flatMap(([, letter, args]) => {
    const arity = ARITY[letter.toUpperCase()];
    const values = (args.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

    if (arity === undefined) {
      throw new Error(`unsupported path command ${letter}`);
    }
    if (arity === 0) {
      Object.assign(pen, { at: pen.start, control: null });

      return [pen.at];
    }

    return Array.from({ length: Math.ceil(values.length / arity) }, (_, i) =>
      segmentPoints(pen, letter, values.slice(i * arity, (i + 1) * arity), i === 0)).flat();
  });
};

const boxOf = (points: Point[]): Box => {
  if (points.length === 0) {
    throw new Error('no points to measure');
  }

  return {
    left: Math.min(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)),
    bottom: Math.max(...points.map(p => p.y)),
  };
};

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

const paths = (icon: string): SVGPathElement[] => Array.from(parseSvg(icon).querySelectorAll('path'));
const rows = 'M9 6.5h7.5M9 13.5h7.5';
// Keyline: neighbouring features sit at least 1 unit of clear space apart.
const CLEAR = 1;

describe('heading, list and toggle icon structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries({
    IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  }))('%s has one main glyph and one digit, both stroked', (_name, icon) => {
    const all = paths(icon);

    expect(all).toHaveLength(2);

    for (const path of all) {
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('fill')).toBeNull();
      expect(path.getAttribute('stroke-linecap')).toBe('round');
    }
  });

  it.each(Object.entries({
    IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  }))('%s is a solid triangle, then a stroked H and digit, like Notion', (_name, icon) => {
    const [triangle, ...glyphs] = paths(icon);

    expect(glyphs).toHaveLength(2);
    expect(triangle?.getAttribute('fill')).toBe('currentColor');
    expect(triangle?.getAttribute('stroke-linejoin')).toBe('round');

    for (const path of glyphs) {
      expect(path.getAttribute('stroke')).toBe('currentColor');
      expect(path.getAttribute('fill')).toBeNull();
      expect(path.getAttribute('stroke-linecap')).toBe('round');
    }
  });

  it('IconHeading has a single stroked H glyph', () => {
    const all = paths(IconHeading);

    expect(all).toHaveLength(1);
    expect(all[0]?.getAttribute('stroke')).toBe('currentColor');
    expect(all[0]?.getAttribute('fill')).toBeNull();
  });

  it('toggle list keeps a solid disclosure triangle beside each of its two rows', () => {
    const triangles = paths(IconToggleList).filter((path) => path.getAttribute('fill') === 'currentColor');
    const rules = paths(IconToggleList).find((path) => path.getAttribute('fill') === null);

    expect(triangles).toHaveLength(2);
    expect(rules?.getAttribute('d')).toBe('M10 6.5h6.5M10 13.5h6.5');

    for (const [index, triangle] of triangles.entries()) {
      const box = boxOf(inkOf(triangle.getAttribute('d') ?? ''));

      expect(triangle.getAttribute('stroke-linejoin')).toBe('round');
      expect(triangle.getAttribute('d')?.match(/[zZ]/g)).toHaveLength(1);
      expect((box.top + box.bottom) / 2).toBe([6.5, 13.5][index]);
    }
  });

  it('numbered list renders two stroked digits without font dependencies or solid fills', () => {
    const svg = parseSvg(IconListNumbered);
    const digit = paths(IconListNumbered)[1];

    expect(svg.querySelectorAll('text')).toHaveLength(0);
    expect(paths(IconListNumbered)).toHaveLength(2);
    expect(digit?.getAttribute('stroke')).toBe('currentColor');
    expect(digit?.getAttribute('fill')).not.toBe('currentColor');
    expect(digit?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(paths(IconListNumbered)[0]?.getAttribute('d')).toBe(rows);
  });

  it('leaves at least one unit of clear space between the numbered markers', () => {
    const marker = paths(IconListNumbered)[1];
    const digits = (marker?.getAttribute('d') ?? '').split(/(?=M)/);
    const stroke = Number(marker?.getAttribute('stroke-width'));

    expect(digits).toHaveLength(2);

    const [first, second] = digits.map((d) => boxOf(inkOf(d)));

    expect(second.top - first.bottom - stroke).toBeGreaterThanOrEqual(CLEAR);
  });
});
