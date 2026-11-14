import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconClearFormat,
  IconLink,
  IconStrikethrough,
  IconCode,
  IconEquation,
  IconSuperscript,
  IconSubscript,
  IconH2,
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

// Keyline coordinates snap to 0.25, so curved ink may miss a keyline by up to one step.
const SNAP = 0.25;
const CAP = 4.5;
const BASELINE = 15.5;

const INLINE_ICONS = {
  IconBold,
  IconItalic,
  IconUnderline,
  IconClearFormat,
  IconLink,
  IconStrikethrough,
  IconCode,
  IconEquation,
  IconSuperscript,
  IconSubscript,
};

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const dsOf = (icon: string): string[] =>
  Array.from(svgOf(icon).querySelectorAll('path'), path => path.getAttribute('d') ?? '');

const lastBox = (icon: string): Box => boxOf(inkOf(dsOf(icon).at(-1) ?? ''));

describe('inline-toolbar icon unity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(INLINE_ICONS))('%s uses the house stroke on every part', (_name, icon) => {
    const shapes = Array.from(svgOf(icon).querySelectorAll('[stroke="currentColor"]'));

    expect(shapes.length).toBeGreaterThan(0);

    for (const shape of shapes) {
      expect(shape.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it.each(Object.entries({ IconBold, IconItalic, IconUnderline, IconStrikethrough }))(
    '%s sits on the shared cap line (y4.5) and baseline (y15.5)',
    (_name, icon) => {
      const box = boxOf(dsOf(icon).flatMap(inkOf));

      expect(box.top).toBeCloseTo(CAP, 10);
      expect(box.bottom).toBeCloseTo(BASELINE, 10);
    },
  );

  it('the T of clear-format sits on the shared cap line and baseline', () => {
    const box = boxOf(inkOf(dsOf(IconClearFormat)[0]));

    expect([box.top, box.bottom]).toStrictEqual([CAP, BASELINE]);
  });

  it('symbol outlines stay centred on (10,10) inside the letterform band', () => {
    for (const icon of [IconCode, IconEquation]) {
      const points = inkOf(dsOf(icon)[0]);
      const box = boxOf(points);

      expect(points.length).toBeGreaterThanOrEqual(4);
      expect((box.left + box.right) / 2).toBe(10);
      expect((box.top + box.bottom) / 2).toBe(10);
      expect(box.left).toBeGreaterThanOrEqual(3);
      expect(box.right).toBeLessThanOrEqual(17);
      expect(box.top).toBeGreaterThanOrEqual(CAP);
      expect(box.bottom).toBeLessThanOrEqual(BASELINE);
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(8);
    }
  });

  it('the small × subglyphs of Tx and √x are the same 3.5-unit glyph', () => {
    for (const icon of [IconClearFormat, IconEquation]) {
      const box = lastBox(icon);

      expect(box.right - box.left).toBe(3.5);
      expect(box.bottom - box.top).toBe(3.5);
    }
  });

  it('sup/sub × crosses are the same 6.5-unit glyph, one on the baseline, one under the cap', () => {
    const sup = boxOf(inkOf(dsOf(IconSuperscript)[0]));
    const sub = boxOf(inkOf(dsOf(IconSubscript)[0]));

    for (const box of [sup, sub]) {
      expect(box.right - box.left).toBe(6.5);
      expect(box.bottom - box.top).toBe(6.5);
    }
    expect(sub.left).toBe(sup.left);
    expect(sup.bottom).toBe(BASELINE);
    expect(sub.top).toBe(CAP);
  });

  it('the ²/₂ digits are the heading digit 2, moved up or kept in place', () => {
    const source = inkOf(dsOf(IconH2).at(-1) ?? '');
    const sup = inkOf(dsOf(IconSuperscript).at(-1) ?? '');
    const sub = inkOf(dsOf(IconSubscript).at(-1) ?? '');
    const lift = sup[0].y - source[0].y;

    expect(sup).toHaveLength(source.length);
    expect(sub).toHaveLength(source.length);
    expect(lift).toBeLessThan(0);

    for (const [i, p] of source.entries()) {
      expect(sup[i].x).toBeCloseTo(p.x, 10);
      expect(sup[i].y).toBeCloseTo(p.y + lift, 10);
      expect(sub[i].x).toBeCloseTo(p.x, 10);
      expect(sub[i].y).toBeCloseTo(p.y, 10);
    }
  });

  it('the ² hangs from the cap line and the ₂ stands on the baseline', () => {
    expect(Math.abs(lastBox(IconSubscript).bottom - BASELINE)).toBeLessThanOrEqual(SNAP);
    expect(Math.abs(lastBox(IconSuperscript).top - CAP)).toBeLessThanOrEqual(SNAP);
    expect(lastBox(IconSuperscript).right).toBeLessThanOrEqual(17);
  });
});
