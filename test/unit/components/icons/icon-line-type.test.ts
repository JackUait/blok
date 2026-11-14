import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconBold, IconItalic, IconUnderline, IconClearFormat, IconStrikethrough,
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconListBulleted, IconListNumbered, IconListChecklist, IconToggleList,
  IconQuote, IconTextSizeSmall, IconTextSizeLarge, IconSuperscript, IconSubscript,
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

// Keyline coordinates snap to 0.25, so a scaled copy may miss by up to one step.
const SNAP = 0.25;
const CAP = 4.5;
const BASELINE = 15.5;
const H = 'M3.5 4.5v11M10 4.5v11M3.5 10h6.5';

const pathsOf = (icon: string): SVGPathElement[] =>
  Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path'));

const pathOf = (icon: string, index = 0): string => {
  const path = pathsOf(icon)[index]?.getAttribute('d');

  if (path === undefined || path === null) {
    throw new Error('Missing icon path');
  }

  return path;
};

const rulesOf = (icon: string): string => {
  const rules = pathsOf(icon).find(path => path.getAttribute('fill') === null && /^M[\d.]+ [\d.]+h[\d.]+M/.test(path.getAttribute('d') ?? ''));

  return rules?.getAttribute('d') ?? '';
};

const headings = [IconH1, IconH2, IconH3, IconH4, IconH5, IconH6];
const toggles = [IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6];

describe('Blok Line type family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the Keyline B with one spine and a middle bar drawn once', () => {
    const d = pathOf(IconBold);

    expect(d).toBe('M6 10h5a2.75 2.75 0 0 1 0 5.5H6V4.5h4.5a2.75 2.75 0 0 1 0 5.5');
    expect(d.match(/[vV]/g)).toHaveLength(1);
    expect(d).not.toMatch(/[zZ]/);
  });

  it('draws all six heading levels on the one Keyline H with the house digit weight', () => {
    expect(pathOf(IconH1, 1)).toBe('M13.25 10.75 15 9.5v6');
    expect(pathOf(IconH2, 1)).toBe('M12.75 11a1.6 1.6 0 0 1 3.2.1c0 .75-.5 1.2-1.1 1.75L12.75 15.5h3.5');
    expect(pathOf(IconH3, 1)).toBe('M12.75 9.5h3.25l-1.75 2.5a1.75 1.75 0 1 1-1.5 2.75');

    for (const icon of headings) {
      expect(pathOf(icon)).toBe(H);
      expect(pathsOf(icon)[1]?.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it('draws every toggle heading as the same triangle and H on the heading cap and baseline, at the house digit weight', () => {
    for (const icon of toggles) {
      const h = boxOf(inkOf(pathOf(icon, 1)));

      expect(pathOf(icon)).toBe(pathOf(IconToggleH1));
      expect(pathOf(icon, 1)).toBe(pathOf(IconToggleH1, 1));
      expect([h.top, h.bottom]).toStrictEqual([CAP, BASELINE]);
      expect(pathsOf(icon).at(-1)?.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it('uses the same cap and baseline for inline letters and the plain heading', () => {
    expect(pathOf(IconItalic)).toBe('M8.5 4.5h6M5.5 15.5h6M12 4.5l-4 11');
    expect(pathOf(IconHeading)).toBe('M6.75 4.5v11M13.25 4.5v11M6.75 10h6.5');

    for (const icon of [IconBold, IconItalic, IconUnderline, IconClearFormat, IconHeading]) {
      const box = boxOf(pathsOf(icon).flatMap(path => inkOf(path.getAttribute('d') ?? '')));

      expect([box.top, box.bottom]).toStrictEqual([CAP, BASELINE]);
    }
  });

  it('keeps the S on the letterform cap and baseline around its centered strike', () => {
    const all = pathsOf(IconStrikethrough);

    expect(all).toHaveLength(3);
    expect(pathOf(IconStrikethrough)).toBe('M4 10h12');
    expect(boxOf(inkOf(pathOf(IconStrikethrough, 1))).top).toBeCloseTo(CAP, 10);
    expect(boxOf(inkOf(pathOf(IconStrikethrough, 2))).bottom).toBeCloseTo(BASELINE, 10);
  });

  it.each([
    ['bulleted', IconListBulleted],
    ['checklist', IconListChecklist],
  ])('%s list shares three evenly spaced rows', (_name, icon) => {
    expect(rulesOf(icon)).toBe('M9 5h7.5M9 10h7.5M9 15h7.5');
  });

  it.each([
    ['numbered', IconListNumbered, 9],
    ['toggle', IconToggleList, 10],
  ])('%s list shares the two numbered-list rows', (_name, icon, left) => {
    const points = inkOf(rulesOf(icon));

    expect(points.map(p => p.y)).toStrictEqual([6.5, 6.5, 13.5, 13.5]);
    expect(points.map(p => p.x)).toStrictEqual([left, 16.5, left, 16.5]);
  });

  it('uses the two Keyline numbered markers at the house weight', () => {
    expect(pathOf(IconListNumbered, 1)).toBe('M3.75 5.25l1.25-.75v4M3.5 12a1.25 1.25 0 0 1 2.5.1c0 .6-.4.95-.85 1.4L3.5 15h2.75');
    expect(pathsOf(IconListNumbered)[1]?.getAttribute('stroke-width')).toBe('1.25');
  });

  it('centers the three bullets beside their rows without crowding the text', () => {
    const doc = new DOMParser().parseFromString(IconListBulleted, 'image/svg+xml');
    const bullets = Array.from(doc.querySelectorAll('circle'));

    expect(bullets).toHaveLength(3);
    expect(bullets.map((bullet) => Number(bullet.getAttribute('cy')))).toEqual([5, 10, 15]);

    for (const bullet of bullets) {
      const right = Number(bullet.getAttribute('cx')) + Number(bullet.getAttribute('r'));

      expect(9 - 0.625 - right).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the approved tapered quotation marks, the second one moved sideways', () => {
    const [first, second] = [pathOf(IconQuote), pathOf(IconQuote, 1)];

    expect(first).toBe('M4.5 11.5C4.5 8.6 5.9 6.9 8.4 6.3A.6 .6 0 0 1 8.65 7.45C7.1 7.85 6.2 8.55 5.85 9.75A2.25 2.25 0 1 1 4.5 11.5Z');
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

  it('draws superscript and subscript numerals at the same weight as the letter', () => {
    for (const icon of [IconSuperscript, IconSubscript]) {
      expect(pathsOf(icon)[0]?.getAttribute('stroke-width')).toBe('1.25');
      expect(pathsOf(icon)[1]?.getAttribute('stroke-width')).toBe('1.25');
    }
  });

  it('makes text size choices scaled versions of the same A', () => {
    const large = inkOf(pathOf(IconTextSizeLarge));
    const small = inkOf(pathOf(IconTextSizeSmall));
    const scale = (boxOf(small).bottom - boxOf(small).top) / (boxOf(large).bottom - boxOf(large).top);

    expect([boxOf(large).top, boxOf(large).bottom]).toStrictEqual([CAP, BASELINE]);
    expect(scale).toBeLessThan(1);
    expect(small).toHaveLength(large.length);

    for (const [index, point] of large.entries()) {
      expect(Math.abs(small[index].x - (10 + (point.x - 10) * scale))).toBeLessThanOrEqual(SNAP);
      expect(Math.abs(small[index].y - (10 + (point.y - 10) * scale))).toBeLessThanOrEqual(SNAP);
    }
  });
});
