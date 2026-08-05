import { describe, it, expect } from 'vitest';
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

/**
 * Inline-toolbar icon unity (2026-08-05, user-directed "make all of these
 * icons look unified when they are placed together").
 *
 * The inline formatting glyphs render side by side in the inline toolbar
 * grid, so they are read as ONE type specimen. Unified system:
 *
 * - one stroke weight: the 1.25 house hairline — including the B (the 1.9
 *   "semantic bold" experiment read as a different icon set in the grid)
 * - letterforms share cap line y=4 and baseline y=16
 * - symbol glyphs (code, equation) share the y 5.5-14.5 optical band,
 *   centred on (10, 10)
 * - the small × subglyphs (Tx, √x) are the same 3.4-unit glyph, sitting on
 *   their parent glyph's bottom line
 * - the sup/sub pair mirrors around the same lines: the lowercase × sits on
 *   the baseline (sup) or hangs from the cap line (sub), and the small 2 is
 *   the house digit-2 skeleton (IconH2's digit, affine-mapped)
 */

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

/** Flattens an absolute M/L/C/H/V path into its coordinate stream (control points included). */
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

/** Scale + translation taking the source point cloud's bounding box onto the target's. */
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
  it.each(Object.entries(INLINE_ICONS))('%s strokes only at the 1.25 hairline', (_name, icon) => {
    const widths = icon.match(/stroke-width="([^"]+)"/g) ?? [];

    expect(widths.length).toBeGreaterThan(0);

    for (const w of widths) {
      expect(w).toBe('stroke-width="1.25"');
    }
  });

  it('letterforms sit on the shared cap line (y4) and baseline (y16)', () => {
    expect(IconBold).toContain('M6.5 4V16');
    // italic serifs centred on x=10: top serif 9-15, bottom serif 5-11
    expect(IconItalic).toContain('M9 4h6');
    // U bowl starts on the cap line, the rule IS the baseline
    expect(IconUnderline).toContain('M6 4v5.5');
    expect(IconUnderline).toContain('M5.5 16h9');
    // T bar on the cap line, stem runs to the baseline
    expect(IconClearFormat).toContain('M4 4h8M8 4v12');
  });

  it('symbol glyphs share the 5.5-14.5 optical band centred on (10,10)', () => {
    expect(IconCode).toContain('m8 5.5-4 4.5 4 4.5m4-9 4 4.5-4 4.5');
    expect(IconEquation).toContain('M4.25 10.5 6 14.5 8.5 5.5h7.25');
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

  it('marker chip sits on the 3-17 content inset', () => {
    expect(IconMarker).toContain('x="3" y="3" width="14" height="14"');
  });

  it('sup/sub × crosses are the same 6.5-unit glyph on the shared letterform lines', () => {
    // superscript: × on the y16 baseline; subscript: × hanging from the y4 cap
    // line — the pair mirrors around the exact lines the letterforms use
    expect(IconSuperscript).toContain('M4 9.5 10.5 16M10.5 9.5 4 16');
    expect(IconSubscript).toContain('M4 4 10.5 10.5M10.5 4 4 10.5');
  });

  it('the ²/₂ digits are the house digit-2 skeleton, affine-mapped', () => {
    // one digit-2 drawing exists in the house (the heading skeleton); the
    // sup/sub digits are that skeleton uniformly scaled into their own cell so
    // the pair can never drift from the heading family sitting one row above
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

    // the subscript digit is the superscript digit translated straight down
    for (const [i, p] of sup.entries()) {
      expect(sub[i].x).toBeCloseTo(p.x, 10);
      expect(sub[i].y).toBeCloseTo(p.y + 7.2, 10);
    }

    // superscript hangs from the cap line, subscript sits on the baseline
    expect(Math.min(...sup.map((p) => p.y))).toBeCloseTo(4, 10);
    expect(Math.max(...sub.map((p) => p.y))).toBeCloseTo(16, 10);

    // both stay inside the 3-17 content inset
    expect(Math.max(...sup.map((p) => p.x))).toBeLessThanOrEqual(17);
  });
});
