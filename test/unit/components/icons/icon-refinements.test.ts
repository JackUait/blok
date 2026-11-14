import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconQuote,
  IconCaption,
  IconPencil,
  IconMergeCells,
  IconSplitCell,
  IconHeading,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconToggleH1,
  IconToggleH2,
  IconToggleH3,
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

// Keyline coordinates snap to 0.25, so a mark may sit up to one step off centre.
const SNAP = 0.25;

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('icon refinements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IconQuote', () => {
    const marksOf = (): string[] => Array.from(parseSvg(IconQuote).querySelectorAll('path'), path => path.getAttribute('d') ?? '');

    it('should draw printed quotation marks as two solid shapes with no outline', () => {
      const svg = parseSvg(IconQuote);
      const paths = Array.from(svg.querySelectorAll('path'));

      expect(paths).toHaveLength(2);
      for (const path of paths) {
        expect(path.getAttribute('fill')).toBe('currentColor');
        expect(path.hasAttribute('stroke')).toBe(false);
      }
      expect(svg.querySelector('rect, circle, line, polyline')).toBeNull();
    });

    it('should give each mark a round ball and a round-ended tail, and set the pair as one shape moved sideways', () => {
      const [first, second] = marksOf();

      for (const mark of [first, second]) {
        const arcs = Array.from(mark.matchAll(/A([\d.]+) ([\d.]+) /g));

        expect(arcs).toHaveLength(2);

        for (const [, rx, ry] of arcs) {
          expect(rx).toBe(ry);
        }
      }

      const a = inkOf(first);
      const b = inkOf(second);
      const shift = b[0].x - a[0].x;

      expect(shift).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length);
      b.forEach((p, i) => {
        expect(p.x).toBeCloseTo(a[i].x + shift, 5);
        expect(p.y).toBeCloseTo(a[i].y, 5);
      });
    });

    it('should stay inside the 3-17 frame and sit centred', () => {
      const box = boxOf(marksOf().flatMap(inkOf));

      expect(box.left).toBeGreaterThanOrEqual(3);
      expect(box.right).toBeLessThanOrEqual(17);
      expect(Math.abs((box.left + box.right) / 2 - 10)).toBeLessThanOrEqual(SNAP);
      expect(box.top).toBeGreaterThanOrEqual(3);
      expect(box.bottom).toBeLessThanOrEqual(17);
    });
  });

  describe('IconCaption', () => {
    it('should show image content in the panel so it does not read as a monitor', () => {
      const svg = parseSvg(IconCaption);

      const panel = svg.querySelector('rect');
      const paths = Array.from(svg.querySelectorAll('path'));
      const caption = paths[1]?.getAttribute('d')?.match(/^M([\d.]+) ([\d.]+)h([\d.]+)$/);

      expect(panel).not.toBeNull();
      expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
      expect(paths).toHaveLength(2);
      expect(paths[0]?.getAttribute('stroke')).toBe('currentColor');
      expect(caption).toBeTruthy();

      const [left, y, width] = caption?.slice(1).map(Number) ?? [];
      const panelBottom = Number(panel?.getAttribute('y')) + Number(panel?.getAttribute('height'));

      expect(left).toBe(Number(panel?.getAttribute('x')));
      expect(width).toBeGreaterThan(Number(panel?.getAttribute('width')) / 2);
      expect(width).toBeLessThan(Number(panel?.getAttribute('width')));
      expect(y - panelBottom - 1.25).toBeGreaterThanOrEqual(1.25);
      expect(y + 0.625).toBeLessThanOrEqual(17);
    });
  });

  describe('IconPencil', () => {
    it('should have a pointed tip instead of a chopped heel', () => {
      const outline = parseSvg(IconPencil).querySelector('path')?.getAttribute('d') ?? '';
      const start = outline.match(/^M([\d.]+) ([\d.]+)/)?.slice(1).map(Number) ?? [];
      const nib = outline.match(/L([\d.]+) ([\d.]+)l(-?[\d.]+) (-?[\d.]+) (-?[\d.]+)(-?[\d.]+)Z$/)?.slice(1).map(Number) ?? [];

      expect(start).toHaveLength(2);
      expect(nib).toHaveLength(6);

      const [baseX, baseY, tipDx, tipDy, returnDx, returnDy] = nib;
      const tip = [baseX + tipDx, baseY + tipDy];

      expect(tip[0] + returnDx).toBe(start[0]);
      expect(tip[1] + returnDy).toBe(start[1]);
      expect(tip[0]).toBeLessThan(Math.min(start[0], baseX));
      expect(tip[1]).toBeGreaterThan(Math.max(start[1], baseY));
      expect(Math.hypot(tipDx, tipDy)).toBeCloseTo(Math.hypot(returnDx, returnDy), 10);
      expect(tip[0] + tip[1]).toBeCloseTo((start[0] + start[1] + baseX + baseY) / 2, 10);
    });
  });

  describe('IconMergeCells / IconSplitCell', () => {
    // Keyline: neighbouring features sit at least 1 unit of clear space apart.
    const CLEARANCE = 1;

    it.each([
      ['merge', IconMergeCells, 'M10 4.5V7M10 15.5V13'],
      ['split', IconSplitCell, 'M10 4.5v11'],
    ])('should draw the %s result: an opened wall or a full one, with mirrored chevrons', (action, icon, wall) => {
      const svg = parseSvg(icon);
      const frame = svg.querySelector('rect');
      const paths = Array.from(svg.querySelectorAll('path'));

      expect(['x', 'y', 'width', 'height', 'rx'].map(name => Number(frame?.getAttribute(name)))).toEqual([3, 4.5, 14, 11, 2.5]);
      expect(paths).toHaveLength(2);
      expect(paths[0].getAttribute('d')).toBe(wall);

      const stroke = Number(paths[1].getAttribute('stroke-width'));
      const chevrons = (paths[1].getAttribute('d') ?? '').split(/(?=M)/).map(part => part.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? []);

      expect(chevrons).toHaveLength(2);
      expect(chevrons[0][0] + chevrons[1][0]).toBe(20);

      for (const [x, y, dx1, dy1, dx2, dy2] of chevrons) {
        const tipX = x + dx1;

        expect(y + dy1).toBe(10);
        expect(dx2).toBe(-dx1);
        expect(dy2).toBe(dy1);
        expect(Math.abs(tipX - 10) < Math.abs(x - 10)).toBe(action === 'merge');
        // Clear of the frame sides, and of the wall where the wall is drawn.
        expect(Math.min(tipX, x) - 3 - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        expect(17 - Math.max(tipX, x) - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        if (action === 'split') {
          expect(Math.min(Math.abs(tipX - 10), Math.abs(x - 10)) - stroke).toBeGreaterThanOrEqual(CLEARANCE - 1e-9);
        }
      }
    });
  });

  describe('heading family grid snap', () => {
    const family: Record<string, string> = {
      IconHeading,
      IconH1,
      IconH2,
      IconH3,
      IconH4,
      IconH5,
      IconH6,
      IconToggleH1,
      IconToggleH2,
      IconToggleH3,
    };

    it.each(Object.entries(family))('%s should not carry legacy off-grid coordinates', (_name, icon) => {
      // 24→20 scale leftovers like 3.33334 / 1.6667 — everything snaps to ≤2 decimals
      expect(icon).not.toMatch(/\d\.\d{3}/);
    });
  });

});
