import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Point } from '../../../../../src/tools/image/darkroom/camera';
import { bakeMousePressure, smoothStroke, strokeOutline } from '../../../../../src/tools/image/markup/freehand';

interface Command { cmd: string; nums: number[] }

/** A path made of M, L, Q, A and Z, one entry per command letter. */
const commands = (d: string): Command[] =>
  Array.from(d.matchAll(/([MLQAZ])([^MLQAZ]*)/gi), (m) => ({
    cmd: (m[1] ?? '').toUpperCase(),
    nums: (m[2] ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [],
  }));

const pairs = (nums: number[]): Point[] =>
  Array.from({ length: Math.floor(nums.length / 2) }, (_, k) => ({ x: nums[k * 2] ?? 0, y: nums[k * 2 + 1] ?? 0 }));

/** Every vertex and control point; an arc contributes its end point. */
const vertices = (d: string): Point[] =>
  commands(d).flatMap(({ cmd, nums }) => pairs(cmd === 'A' ? nums.slice(5) : nums));

const segDist = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));

  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

const polylineDist = (p: Point, pts: number[]): number => {
  let best = Number.POSITIVE_INFINITY;

  for (let i = 0; i + 2 < pts.length; i += 3) {
    const a = { x: pts[i] ?? 0, y: pts[i + 1] ?? 0 };
    const b = i + 5 < pts.length ? { x: pts[i + 3] ?? 0, y: pts[i + 4] ?? 0 } : a;

    best = Math.min(best, segDist(p, a, b));
  }

  return best;
};


const steps = (n: number): number[] => Array.from({ length: n }, (_, k) => (k + 1) / n);

const quad = (a: Point, c: Point, b: Point): Point[] =>
  steps(8).map((t) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
  }));

/** Semicircle from a to b; sweep 0 runs toward decreasing angles. */
const semicircle = (a: Point, b: Point): Point[] => {
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const start = Math.atan2(a.y - c.y, a.x - c.x);

  return steps(12).map((t) => ({ x: c.x + r * Math.cos(start - Math.PI * t), y: c.y + r * Math.sin(start - Math.PI * t) }));
};

/** Flattens an outline (M, L, Q, semicircle A, Z) into closed polygons. */
const polygons = (d: string): Point[][] =>
  commands(d).reduce<Point[][]>((out, { cmd, nums }) => {
    const poly = out[out.length - 1] ?? [];
    const at = poly[poly.length - 1] ?? { x: 0, y: 0 };
    const [p1, p2] = pairs(cmd === 'A' ? nums.slice(5) : nums);

    if (cmd === 'M' && p1 !== undefined) out.push([p1]);
    if (cmd === 'L' && p1 !== undefined) poly.push(p1);
    if (cmd === 'Q' && p1 !== undefined && p2 !== undefined) poly.push(...quad(at, p1, p2));
    if (cmd === 'A' && p1 !== undefined) poly.push(...semicircle(at, p1));

    return out;
  }, []);

/** Nonzero winding of a point over every polygon. */
const winding = (p: Point, polys: Point[][]): number => {
  let w = 0;

  for (const poly of polys) {
    poly.forEach((a, k) => {
      const b = poly[(k + 1) % poly.length] ?? a;
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);

      if (a.y <= p.y && b.y > p.y && cross > 0) w++;
      if (a.y > p.y && b.y <= p.y && cross < 0) w--;
    });
  }

  return w;
};

const line = (n: number, step: number, p: (i: number) => number = () => 0.5): number[] =>
  Array.from({ length: n }, (_, i) => [10 + i * step, 50, p(i)]).flat();

/** Largest |y - 50| among vertices whose x is within `band` of `x`. */
const halfWidthAt = (d: string, x: number, band = 3): number =>
  Math.max(0, ...vertices(d).filter((v) => Math.abs(v.x - x) <= band).map((v) => Math.abs(v.y - 50)));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('smoothStroke', () => {
  it('returns [] for nothing and keeps a single point', () => {
    expect(smoothStroke([])).toEqual([]);
    expect(smoothStroke([1, 2, 0.5])).toEqual([1, 2, 0.5]);
  });

  it('keeps the first and last point and the point count', () => {
    const raw = [0, 0, 0.5, 10, 3, 0.6, 20, -3, 0.4, 30, 0, 0.5];
    const out = smoothStroke(raw);

    expect(out).toHaveLength(raw.length);
    expect(out.slice(0, 3)).toEqual([0, 0, 0.5]);
    expect(out.slice(-3)).toEqual([30, 0, 0.5]);
  });

  it('calms jitter around a straight line', () => {
    const raw = Array.from({ length: 40 }, (_, i) => [i * 4, i % 2 === 0 ? 1 : -1, 0.5]).flat();
    const out = smoothStroke(raw);
    const wobble = (pts: number[]): number => {
      let sum = 0;

      for (let i = 4; i < pts.length - 3; i += 3) sum += Math.abs(pts[i] ?? 0);

      return sum;
    };

    expect(wobble(out)).toBeLessThan(wobble(raw) * 0.5);
  });

  it('leaves a corner sharper than 90 degrees where the hand put it', () => {
    expect(smoothStroke([0, 0, 0.5, 10, 10, 0.5, 2, 0, 0.5])).toEqual([0, 0, 0.5, 10, 10, 0.5, 2, 0, 0.5]);
  });
});

describe('strokeOutline', () => {
  it('returns an empty path for no points', () => {
    expect(strokeOutline([], 4)).toBe('');
  });

  it('draws a dot for a single point', () => {
    const d = strokeOutline([20, 30, 0.5], 10);

    expect(d).toMatch(/^M[^A]*A[^A]*A[^A]*Z$/);
    expect(vertices(d).every((v) => Math.abs(Math.hypot(v.x - 20, v.y - 30) - 5) < 0.02)).toBe(true);
  });

  it('draws a dot when every point is in the same place', () => {
    expect(strokeOutline([20, 30, 0.5, 20, 30, 0.5, 20, 30, 0.5], 10)).toMatch(/^M[^A]*A[^A]*A[^A]*Z$/);
  });

  it('closes the path and writes only finite numbers with at most 2 decimals', () => {
    const pts = Array.from({ length: 60 }, (_, i) => [i * 2.3456, Math.sin(i / 5) * 20.123, 0.3 + (i % 7) / 10]).flat();
    const d = strokeOutline(pts, 6.789);
    const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];

    expect(d.trim().endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity|e[-+]/i);
    expect(numbers.length).toBeGreaterThan(20);
    expect(numbers.every((n) => !/\.\d{3,}/.test(n) && n !== '-0')).toBe(true);
  });

  it('ignores non-finite points', () => {
    expect(strokeOutline([0, 0, 0.5, Number.NaN, 4, 0.5, 10, 0, 0.5], 4)).not.toMatch(/NaN/);
  });

  describe('stays inside the stroke envelope (no spikes, no kinks)', () => {
    const width = 8;
    // Pressure 1 is the widest a point can be.
    const maxReach = (width / 2) * 1.65 * 1.02 + 0.02;
    const cases: Record<string, number[]> = {
      straight: line(30, 5),
      'slow dense jitter': Array.from({ length: 300 }, (_, i) => [10 + i * 0.2 + Math.sin(i * 2.7) * 0.4, 50 + Math.cos(i * 1.9) * 0.4, 0.5]).flat(),
      'sharp U-turn': [...line(20, 4), ...Array.from({ length: 20 }, (_, i) => [86 - i * 4, 52, 0.5]).flat()],
      zigzag: Array.from({ length: 30 }, (_, i) => [10 + i * 6, i % 2 === 0 ? 40 : 60, 0.5]).flat(),
      'tight spiral': Array.from({ length: 120 }, (_, i) => [50 + Math.cos(i / 6) * (2 + i / 20), 50 + Math.sin(i / 6) * (2 + i / 20), 0.5]).flat(),
      'pressure ramp': line(40, 2, (i) => i / 39),
    };

    for (const [name, pts] of Object.entries(cases)) {
      it(name, () => {
        const d = strokeOutline(pts, width);
        const worst = Math.max(...vertices(d).map((v) => polylineDist(v, pts)));

        expect(worst).toBeLessThanOrEqual(maxReach);
      });
    }
  });

  describe('fills the whole body, with no holes', () => {
    const cases: Record<string, number[]> = {
      'tight spiral': Array.from({ length: 300 }, (_, i) => [150 + Math.cos(i / 10) * (4 + i / 5), 150 + Math.sin(i / 10) * (4 + i / 5), 0.5]).flat(),
      'small circles': Array.from({ length: 200 }, (_, i) => [60 + Math.cos(i / 3) * 6 + i * 0.3, 60 + Math.sin(i / 2.3) * 6, 0.5]).flat(),
      'U-turn': [...line(20, 4), ...Array.from({ length: 20 }, (_, i) => [86 - i * 4, 54, 0.5]).flat()],
      'loops tighter than the stroke': Array.from({ length: 66 }, (_, i) => [50 + Math.cos(i * 0.088) * 9.77 + i * 0.36, 50 + Math.sin(i * 0.088) * 9.77, 0.5]).flat(),
      'small loops': Array.from({ length: 40 }, (_, i) => [50 + Math.cos(i * 0.168) * 4.7 + i * 0.22, 50 + Math.sin(i * 0.168) * 4.7, 0.5]).flat(),
      'coil': Array.from({ length: 85 }, (_, i) => [50 + Math.cos(i * 0.339) * 5 + i * 0.635, 50 + Math.sin(i * 0.339) * 5, 0.5]).flat(),
    };

    for (const [name, pts] of Object.entries(cases)) {
      it(name, () => {
        const width = 18;
        const polys = polygons(strokeOutline(pts, width, { taper: false, pressure: false }));
        const misses = Array.from({ length: pts.length / 3 }, (_, k) => k * 3)
          .flatMap((k) => Array.from({ length: 8 }, (_, a) => ({
            x: (pts[k] ?? 0) + Math.cos(a) * width * 0.15,
            y: (pts[k + 1] ?? 0) + Math.sin(a) * width * 0.15,
          })))
          .filter((p) => winding(p, polys) === 0);

        expect(misses).toEqual([]);
      });
    }
  });

  it('spans the whole centreline and closes both ends with round caps', () => {
    const d = strokeOutline(line(30, 5), 8, { taper: false, pressure: false });
    const xs = vertices(d).map((v) => v.x);

    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(155);
    expect(d.match(/A4 4 0 0 0 /g)).toHaveLength(2);
  });

  it('is wider where the pressure is higher', () => {
    const d = strokeOutline(line(41, 4, (i) => (i < 20 ? 0.1 : 1)), 10, { taper: false });

    expect(halfWidthAt(d, 130)).toBeGreaterThan(halfWidthAt(d, 30) * 2);
  });

  it('keeps a constant width with pressure off', () => {
    const d = strokeOutline(line(41, 4, (i) => (i < 20 ? 0.1 : 1)), 10, { taper: false, pressure: false });

    expect(halfWidthAt(d, 130)).toBeCloseTo(5, 1);
    expect(halfWidthAt(d, 30)).toBeCloseTo(5, 1);
  });

  it('thins a fast mouse stroke and thickens a slow one', () => {
    const slow = Array.from({ length: 40 }, (_, i) => [10 + i * 1, 50, 0.5]);
    const fast = Array.from({ length: 12 }, (_, i) => [50 + (i + 1) * 15, 50, 0.5]);
    const d = strokeOutline([...slow, ...fast].flat(), 10, { taper: false });

    expect(halfWidthAt(d, 35)).toBeGreaterThan(halfWidthAt(d, 200, 8) * 1.3);
  });

  it('changes width smoothly, without steps between neighbours', () => {
    const d = strokeOutline(line(41, 4, (i) => (i < 20 ? 0.1 : 1)), 10, { taper: false });
    const top = vertices(d).filter((v) => v.y < 50 && v.x > 20 && v.x < 150).sort((a, b) => a.x - b.x);
    const jumps = top.slice(1).map((v, i) => Math.abs(v.y - (top[i]?.y ?? v.y)));

    expect(Math.max(...jumps)).toBeLessThan(1.5);
  });

  it('keeps full width along a long stroke with only two points', () => {
    const d = strokeOutline([10, 50, 0.5, 400, 50, 0.5], 10, { pressure: false });

    expect(halfWidthAt(d, 200)).toBeCloseTo(5, 0);
  });

  it('tapers the ends when asked', () => {
    const pts = line(41, 4);
    const tapered = strokeOutline(pts, 10, { taper: true, pressure: false });
    const blunt = strokeOutline(pts, 10, { taper: false, pressure: false });

    expect(halfWidthAt(tapered, 12)).toBeLessThan(halfWidthAt(tapered, 90) * 0.7);
    expect(halfWidthAt(tapered, 168)).toBeLessThan(halfWidthAt(tapered, 90) * 0.7);
    expect(halfWidthAt(blunt, 12)).toBeCloseTo(5, 1);
  });

  it('tapers only the ends it is asked to', () => {
    const pts = line(41, 4);
    const d = strokeOutline(pts, 10, { taper: { start: false, end: true }, pressure: false });

    expect(halfWidthAt(d, 12)).toBeCloseTo(5, 1);
    expect(halfWidthAt(d, 168)).toBeLessThan(halfWidthAt(d, 90) * 0.7);
  });
});

describe('bakeMousePressure', () => {
  it('writes the speed-simulated pressure into a mouse stroke', () => {
    const slow = Array.from({ length: 30 }, (_, i) => [10 + i, 50, 0.5]).flat();
    const baked = bakeMousePressure(slow, 10);

    expect(baked.filter((_, i) => i % 3 === 2).every((p) => p > 0.5)).toBe(true);
    expect(baked.filter((_, i) => i % 3 !== 2)).toEqual(slow.filter((_, i) => i % 3 !== 2));
  });

  it('leaves real stylus pressure alone', () => {
    const pts = [10, 50, 0.2, 20, 50, 0.9];

    expect(bakeMousePressure(pts, 10)).toEqual(pts);
  });
});
