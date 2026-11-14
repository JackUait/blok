import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconToggleH1,
  IconToggleH2,
  IconToggleH3,
  IconToggleH4,
  IconToggleH5,
  IconToggleH6,
  IconToggleList,
  IconListBulleted,
  IconListNumbered,
  IconListChecklist,
  IconBold,
  IconEquation,
  IconUnderline,
  IconClearFormat,
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
const STROKE = 1.25;
// Keyline: neighbouring features sit at least 1 unit of clear space apart.
const CLEAR = 1;
const CAP = 4.5;
const BASELINE = 15.5;
const DIGIT_TOP = 9.5;

const shapesOf = (icon: string): Element[] =>
  Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path, circle'));

const elementInk = (shape: Element): Point[] => {
  if (shape.tagName === 'circle') {
    const cx = Number(shape.getAttribute('cx'));
    const cy = Number(shape.getAttribute('cy'));
    const r = Number(shape.getAttribute('r'));

    return Array.from({ length: SAMPLES }, (_, i) => ({
      x: cx + r * Math.cos((2 * Math.PI * i) / SAMPLES),
      y: cy + r * Math.sin((2 * Math.PI * i) / SAMPLES),
    }));
  }

  return inkOf(shape.getAttribute('d') ?? '');
};

const dOf = (shape: Element | undefined): string => {
  const d = shape?.getAttribute('d');

  if (d === null || d === undefined) {
    throw new Error('path has no d');
  }

  return d;
};

// The H is the first stroked shape; everything after it is the digit (a 6 may be a circle plus a tail).
const partsOf = (icon: string): { triangle: Element | undefined; h: Element; digit: Element[] } => {
  const shapes = shapesOf(icon);
  const triangle = shapes[0]?.getAttribute('fill') === 'currentColor' ? shapes[0] : undefined;
  const rest = triangle === undefined ? shapes : shapes.slice(1);

  return { triangle, h: rest[0], digit: rest.slice(1) };
};

const digitBox = (icon: string): Box => boxOf(partsOf(icon).digit.flatMap(elementInk));

const headings: Record<string, string> = {
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
};

const toggles: Record<string, string> = {
  IconToggleH1,
  IconToggleH2,
  IconToggleH3,
  IconToggleH4,
  IconToggleH5,
  IconToggleH6,
};

const listTriangle = (): Element => {
  const triangle = shapesOf(IconToggleList).find(shape => shape.getAttribute('fill') === 'currentColor');

  if (triangle === undefined) {
    throw new Error('IconToggleList has no filled triangle');
  }

  return triangle;
};

// Triangle corners relative to the first one, so position does not matter.
const triangleShape = (shape: Element): number[][] => {
  const corners = inkOf(dOf(shape).split(/z/i)[0]);

  return corners.map(({ x, y }) => [x - corners[0].x, y - corners[0].y]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('heading digit skeleton geometry', () => {
  it.each(Object.entries({ ...headings, ...toggles }))(
    '%s digit curves are cubic arcs, not kink-prone quadratics',
    (_name, icon) => {
      for (const shape of partsOf(icon).digit) {
        expect(shape.getAttribute('d') ?? '').not.toMatch(/Q/i);
      }
    },
  );

  it.each([['IconH4', IconH4], ['IconToggleH4', IconToggleH4]])(
    '%s stem is full-height from an apex shared with the diagonal',
    (_name, icon) => {
      const d = dOf(partsOf(icon).digit[0]);
      const [foot, apex, diagonalEnd] = inkOf(d);

      expect(d.match(/M/gi)).toHaveLength(1);
      expect(foot.x).toBe(apex.x);
      expect(foot.y).toBe(BASELINE);
      expect(apex.y).toBe(DIGIT_TOP);
      expect(diagonalEnd.x).toBeLessThan(apex.x);
      expect(diagonalEnd.y).toBeGreaterThan(apex.y);
    },
  );

  it.each(Object.entries(headings))('%s digit sits in the heading numeral box (x 12.75-16.25, y 9.5-15.5)', (_name, icon) => {
    const box = digitBox(icon);

    expect(box.left).toBeGreaterThanOrEqual(12.75 - SNAP);
    expect(box.right).toBeLessThanOrEqual(16.25 + SNAP);
    expect(Math.abs(box.top - DIGIT_TOP)).toBeLessThanOrEqual(SNAP);
    expect(Math.abs(box.bottom - BASELINE)).toBeLessThanOrEqual(SNAP);
  });

  it.each(Object.entries(headings))('%s digit stands clear of the H', (_name, icon) => {
    const h = boxOf(inkOf(dOf(partsOf(icon).h)));

    expect(digitBox(icon).left - h.right - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  // Toggle digits get their own cell, right of the narrower toggle H.
  it.each(Object.entries(toggles))('%s digit sits in the toggle numeral box (x 14-17, y 9.5-15.5)', (_name, icon) => {
    const box = digitBox(icon);

    expect(box.left).toBeGreaterThanOrEqual(14 - SNAP);
    expect(box.right).toBeLessThanOrEqual(17 + SNAP);
    expect(Math.abs(box.top - DIGIT_TOP)).toBeLessThanOrEqual(SNAP);
    expect(Math.abs(box.bottom - BASELINE)).toBeLessThanOrEqual(SNAP);
  });

  it.each(Object.entries(toggles))('%s stays on the 20-unit canvas, strokes included', (_name, icon) => {
    for (const shape of shapesOf(icon)) {
      const half = Number(shape.getAttribute('stroke-width')) / 2;
      const box = boxOf(elementInk(shape));

      expect(box.left - half).toBeGreaterThanOrEqual(0);
      expect(box.right + half).toBeLessThanOrEqual(20);
      expect(box.top - half).toBeGreaterThanOrEqual(0);
      expect(box.bottom + half).toBeLessThanOrEqual(20);
    }
  });

  // Notion's toggle-heading icons: a solid disclosure triangle, then the H, then the digit.
  it.each(Object.entries(toggles))('%s leads with a filled triangle, then an H on the heading cap and baseline', (_name, icon) => {
    const { triangle, h, digit } = partsOf(icon);
    const tri = boxOf(inkOf(dOf(triangle)));
    const hBox = boxOf(inkOf(dOf(h)));
    const hBar = inkOf(dOf(h)).slice(-2);

    expect(triangle?.getAttribute('stroke-width')).toBe(listTriangle().getAttribute('stroke-width'));
    expect((tri.top + tri.bottom) / 2).toBe(10);
    expect(dOf(h).match(/M/g)).toHaveLength(3);
    expect(h.getAttribute('fill')).toBeNull();
    expect(hBox.top).toBe(CAP);
    expect(hBox.bottom).toBe(BASELINE);
    expect(hBar.map(p => p.y)).toStrictEqual([10, 10]);
    expect(hBar.map(p => p.x)).toStrictEqual([hBox.left, hBox.right]);
    expect(hBox.left - tri.right - STROKE).toBeGreaterThanOrEqual(CLEAR);
    expect(boxOf(digit.flatMap(elementInk)).left - hBox.right - STROKE).toBeGreaterThanOrEqual(CLEAR);
  });

  it.each(Object.entries(toggles))('%s triangle is the toggle-list triangle', (_name, icon) => {
    expect(triangleShape(shapesOf(icon)[0])).toStrictEqual(triangleShape(listTriangle()));
  });
});

describe('inline formatting glyph hygiene', () => {
  it('IconBold is grid-snapped with a single-drawn stem', () => {
    expect(IconBold).not.toMatch(/\d\.\d{3}/);
    expect(IconBold).not.toMatch(/Z/i);
  });

  it('IconBold shares the family hairline weight', () => {
    expect(IconBold).toContain('stroke-width="1.25"');
  });

  it('IconUnderline rule is centred on the U and overhangs its bowl by one stroke each side', () => {
    const [bowl, rule] = shapesOf(IconUnderline).map(shape => boxOf(elementInk(shape)));

    expect(rule.top).toBe(rule.bottom);
    expect(bowl.left - rule.left).toBe(STROKE);
    expect(rule.right - bowl.right).toBe(STROKE);
  });

  it('IconEquation x sits centered under the radical bar', () => {
    const [radicalShape, crossShape] = shapesOf(IconEquation);
    const radical = inkOf(dOf(radicalShape));
    const cross = boxOf(inkOf(dOf(crossShape)));
    const [barStart, barEnd] = radical.slice(-2);
    const stroke = Number(radicalShape.getAttribute('stroke-width'));

    expect(radical).toHaveLength(4);
    expect(barStart.y).toBe(barEnd.y);
    expect((cross.left + cross.right) / 2).toBeCloseTo((barStart.x + barEnd.x) / 2, 10);
    expect(cross.left - barStart.x).toBeGreaterThan(stroke);
    expect(barEnd.x - cross.right).toBeGreaterThan(stroke);
    expect(cross.top - barStart.y - stroke).toBeGreaterThanOrEqual(stroke);
  });

  it('IconClearFormat is a hairline T with a strike-out x', () => {
    const doc = new DOMParser().parseFromString(IconClearFormat, 'image/svg+xml');
    const paths = Array.from(doc.querySelectorAll('path'));

    expect(paths.length).toBeGreaterThanOrEqual(2);

    for (const p of paths) {
      expect(p.getAttribute('stroke')).toBe('currentColor');
      expect(p.getAttribute('fill')).toBeNull();
      expect(Number(p.getAttribute('stroke-width'))).toBeLessThanOrEqual(1.25);
    }
  });
});

describe('list icon family consistency', () => {
  it('IconListNumbered digit curves are cubic arcs, not kink-prone quadratics', () => {
    const doc = new DOMParser().parseFromString(IconListNumbered, 'image/svg+xml');

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      expect(p.getAttribute('d')).not.toMatch(/Q/i);
    }
  });

  // Rule rows as [left, y, right]; a two-row list uses the numbered-list rows.
  const rowsOf = (icon: string): number[][] => {
    const rules = shapesOf(icon).find(shape => /^M[\d.]+ [\d.]+h[\d.]+M/.test(shape.getAttribute('d') ?? ''));
    const points = inkOf(dOf(rules));

    return points.flatMap((p, i) => i % 2 === 0 ? [[p.x, p.y, points[i + 1].x]] : []);
  };

  it('all list icons share the same rule rows', () => {
    const three = rowsOf(IconListBulleted);
    const two = rowsOf(IconListNumbered);

    expect(three.map(([, y]) => y)).toStrictEqual([5, 10, 15]);
    expect(two.map(([, y]) => y)).toStrictEqual([6.5, 13.5]);
    expect(rowsOf(IconListChecklist)).toStrictEqual(three);
    expect(two.map(([left, , right]) => [left, right])).toStrictEqual(three.slice(0, 2).map(([left, , right]) => [left, right]));
    expect(rowsOf(IconToggleList).map(([, y, right]) => [y, right])).toStrictEqual(two.map(([, y, right]) => [y, right]));
  });
});
