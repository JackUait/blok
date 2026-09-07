import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  IconMarker,
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


const INLINE_ICONS = {
  IconMarker,
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

const digitPathOf = (icon: string): string => {
  const paths = Array.from(svgOf(icon).querySelectorAll('path'));

  return paths[paths.length - 1].getAttribute('d') ?? '';
};

interface Point { x: number; y: number }

const pointsOf = (d: string): Point[] => {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  const push = (point: Point): void => {
    current = point;
    points.push(point);
  };

  for (const match of d.matchAll(/([MLCHV])([^MLCHV]*)/g)) {
    const nums = match[2].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    if (match[1] === 'H') {
      nums.forEach((x) => push({ x, y: current.y }));
    } else if (match[1] === 'V') {
      nums.forEach((y) => push({ x: current.x, y }));
    } else {
      nums.filter((_n, i) => i % 2 === 0).forEach((x, i) => push({ x, y: nums[i * 2 + 1] }));
    }
  }

  return points;
};

const affineOf = (source: Point[], target: Point[]): { sx: number; sy: number; tx: number; ty: number } => {
  const box = (pts: Point[]): { x: number; y: number; w: number; h: number } => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);

    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };
  const from = box(source);
  const to = box(target);
  const sx = to.w / from.w;
  const sy = to.h / from.h;

  return { sx, sy, tx: to.x - from.x * sx, ty: to.y - from.y * sy };
};

const spanOf = (d: string): { x: number; y: number } => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const xs = nums.filter((_v, i) => i % 2 === 0);
  const ys = nums.filter((_v, i) => i % 2 === 1);

  return {
    x: Math.max(...xs) - Math.min(...xs),
    y: Math.max(...ys) - Math.min(...ys),
  };
};

describe('inline-toolbar icon unity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(INLINE_ICONS))('%s uses the house stroke with lighter tiny digits', (name, icon) => {
    const shapes = Array.from(svgOf(icon).querySelectorAll('[stroke="currentColor"]'));
    const hasSmallDigit = name === 'IconSuperscript' || name === 'IconSubscript';

    expect(shapes.length).toBeGreaterThan(0);

    for (const [index, shape] of shapes.entries()) {
      const width = hasSmallDigit && index === shapes.length - 1 ? '1.05' : '1.25';

      expect(shape.getAttribute('stroke-width')).toBe(width);
    }
  });

  it('letterforms sit on the shared cap line (y5) and baseline (y15)', () => {
    expect(IconBold).toContain('M6.5 5v10');
    expect(IconItalic).toContain('M9 5h6');
    expect(IconUnderline).toContain('M6 5v4');
    expect(IconUnderline).toContain('M5.5 15h9');
    expect(IconClearFormat).toContain('M4 5h8M8 5v10');
  });

  it('symbol outlines stay centred on (10,10) inside the letterform band', () => {
    for (const icon of [IconCode, IconEquation]) {
      const outline = svgOf(icon).querySelector('path')?.getAttribute('d') ?? '';
      const points = pointsOf(outline);
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);

      expect(points.length).toBeGreaterThanOrEqual(4);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(10);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(10);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...xs)).toBeLessThanOrEqual(17);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(5);
      expect(Math.max(...ys)).toBeLessThanOrEqual(15);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(8);
    }
  });

  it('the small × subglyphs of Tx and √x are the same 3.4-unit glyph', () => {
    for (const icon of [IconClearFormat, IconEquation]) {
      const paths = Array.from(svgOf(icon).querySelectorAll('path'));
      const x = paths[paths.length - 1].getAttribute('d') ?? '';
      const span = spanOf(x);

      expect(span.x).toBeCloseTo(3.4, 10);
      expect(span.y).toBeCloseTo(3.4, 10);
    }
  });

  it('marker chip uses the shared 14 by 12 panel', () => {
    expect(IconMarker).toContain('x="3" y="4" width="14" height="12"');
  });

  it('sup/sub × crosses are the same 6.5-unit glyph on the shared letterform lines', () => {
    expect(IconSuperscript).toContain('M4 8.5 10.5 15M10.5 8.5 4 15');
    expect(IconSubscript).toContain('M4 5 10.5 11.5M10.5 5 4 11.5');
  });

  it('the ²/₂ digits are the house digit-2 skeleton, affine-mapped', () => {
    const source = pointsOf(digitPathOf(IconH2));
    const sup = pointsOf(digitPathOf(IconSuperscript));
    const sub = pointsOf(digitPathOf(IconSubscript));

    expect(sup.length).toBe(source.length);
    expect(sub.length).toBe(source.length);

    const mapping = affineOf(source, sup);

    expect(Math.abs(mapping.sx - mapping.sy)).toBeLessThanOrEqual(0.01);

    for (const [i, p] of source.entries()) {
      expect(sup[i].x).toBeCloseTo(mapping.tx + p.x * mapping.sx, 1);
      expect(sup[i].y).toBeCloseTo(mapping.ty + p.y * mapping.sy, 1);
    }

    for (const [i, p] of sup.entries()) {
      expect(sub[i].x).toBeCloseTo(p.x, 10);
      expect(sub[i].y).toBeCloseTo(p.y + 6, 10);
    }

    expect(Math.min(...sup.map((p) => p.y))).toBeCloseTo(5, 10);
    expect(Math.max(...sub.map((p) => p.y))).toBeCloseTo(15, 10);

    expect(Math.max(...sup.map((p) => p.x))).toBeLessThanOrEqual(17);
  });
});
