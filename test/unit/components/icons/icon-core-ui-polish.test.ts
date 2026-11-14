import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconCallout, IconCheck, IconDotsHorizontal, IconSearch, IconSelect, IconUnderline, IconWand } from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const numbersOf = (path: string): number[] => (path.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

const pathOf = (icon: string, index = 0): string =>
  svgOf(icon).querySelectorAll('path')[index]?.getAttribute('d') ?? '';

type Point = [number, number];

const SIZES: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, a: 7, c: 6 };

/** The point one path command lands on; h and v keep the other coordinate. */
const stepTo = (lower: string, relative: boolean, chunk: number[], [x, y]: Point): Point => {
  const [ox, oy] = relative ? [x, y] : [0, 0];

  if (lower === 'h') {
    return [ox + chunk[0], y];
  }
  if (lower === 'v') {
    return [x, oy + chunk[0]];
  }

  return [ox + chunk[chunk.length - 2], oy + chunk[chunk.length - 1]];
};

/** Absolute points of every subpath; with `handles`, cubic handles are kept too. */
const subpathsOf = (d: string, handles = false): Point[][] => {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let point: Point = [0, 0];

  for (const [, letter, args] of d.matchAll(/([MLHVACZmlhvacz])([^MLHVACZmlhvacz]*)/g)) {
    const lower = letter.toLowerCase();
    const size = SIZES[lower] ?? 0;
    const values = numbersOf(args);

    if (lower === 'z') {
      point = current[0] ?? point;
      continue;
    }
    if (lower === 'm') {
      current = [];
      subpaths.push(current);
    }
    for (let i = 0; i + size <= values.length; i += size) {
      const chunk = values.slice(i, i + size);
      const kept = handles && lower === 'c' ? [0, 2].map(at => stepTo('l', letter === lower, chunk.slice(at, at + 2), point)) : [];

      point = stepTo(lower, letter === lower, chunk, point);
      current.push(...kept, point);
    }
  }

  return subpaths;
};

const strokesOf = (icon: string): Point[][] =>
  Array.from(svgOf(icon).querySelectorAll('path')).flatMap(path => subpathsOf(path.getAttribute('d') ?? ''));

/** Left and right ink edges of an icon's contents, every rect after the first (the panel) included. */
const inkSpanOf = (icon: string): number[] => {
  const svg = svgOf(icon);
  const edges: number[] = [];

  for (const dot of svg.querySelectorAll('circle')) {
    const cx = Number(dot.getAttribute('cx'));
    const r = Number(dot.getAttribute('r'));

    edges.push(cx - r, cx + r);
  }
  for (const path of svg.querySelectorAll('path')) {
    const halfStroke = Number(path.getAttribute('stroke-width')) / 2;
    const xs = subpathsOf(path.getAttribute('d') ?? '').flat().map(([x]) => x);

    edges.push(Math.min(...xs) - halfStroke, Math.max(...xs) + halfStroke);
  }
  for (const rect of Array.from(svg.querySelectorAll('rect')).slice(1)) {
    const x = Number(rect.getAttribute('x'));
    const halfStroke = Number(rect.getAttribute('stroke-width')) / 2;

    edges.push(x - halfStroke, x + Number(rect.getAttribute('width')) + halfStroke);
  }

  return [Math.min(...edges), Math.max(...edges)];
};

describe('Blok Line core UI polish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('centres the check tick on the canvas', () => {
    const [points] = subpathsOf(pathOf(IconCheck));
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);

    expect(points).toHaveLength(3);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(10);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(10);
  });

  it('draws the sparkle with long, thin rays that meet the axes near its centre', () => {
    const [points] = subpathsOf(pathOf(IconWand), true);
    const [top, control1, control2, right] = points;

    expect(top).toEqual([10, 3.5]);
    expect(right).toEqual([16.5, 10]);
    // Controls close to the axes keep the rays sharp; 0.5 already reads blunt at 16 px.
    expect(Math.abs(control1[0] - 10)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(control2[1] - 10)).toBeLessThanOrEqual(0.35);

    const key = ([px, py]: number[]): string => `${px.toFixed(3)},${py.toFixed(3)}`;
    const all = new Set(points.map(key));

    expect(points).toHaveLength(13);
    for (const [px, py] of points) {
      expect(all.has(key([20 - px, py])), `mirror of ${px},${py}`).toBe(true);
      expect(all.has(key([px, 20 - py])), `flip of ${px},${py}`).toBe(true);
    }
  });

  it('centres the lens and handle together and keeps the handle on the lens diagonal', () => {
    const lens = svgOf(IconSearch).querySelector('circle');
    const [cx, cy, r] = ['cx', 'cy', 'r'].map(name => Number(lens?.getAttribute(name)));
    const [[[sx, sy], [ex, ey]]] = [subpathsOf(pathOf(IconSearch))[0]];

    // Keyline's lens: r 5.5 at (9, 9).
    expect([cx, cy, r]).toEqual([9, 9, 5.5]);
    expect(sx - cx).toBe(sy - cy);
    expect(ex - sx).toBe(ey - sy);
    expect((cx - r + ex) / 2).toBe(10);
    expect((cy - r + ey) / 2).toBe(10);
    // The handle starts just outside the lens so the two strokes read as one joint.
    expect(Math.hypot(sx - cx, sy - cy) - r).toBeGreaterThan(0);
    expect(Math.hypot(sx - cx, sy - cy) - r).toBeLessThan(1.25 / 2);
  });

  it('keeps a full stroke of space between the underline U and its rule', () => {
    const [bowl] = subpathsOf(pathOf(IconUnderline));
    const [[, rule]] = subpathsOf(pathOf(IconUnderline, 1))[0];
    const [, arcStart, arcEnd] = bowl;
    const bowlBottom = arcStart[1] + (arcEnd[0] - arcStart[0]) / 2;

    expect(arcEnd[1]).toBe(arcStart[1]);
    expect(rule - bowlBottom - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it.each(Object.entries({ IconCallout, IconSelect }))('%s centres its contents inside the panel', (_name, icon) => {
    const [left, right] = inkSpanOf(icon);

    // Content edges sit on the 0.25 grid but ink adds a 0.625 half stroke, so the
    // closest a dot-and-rule row can get to centre is 1/16 of a unit.
    expect(Math.abs((left + right) / 2 - 10)).toBeLessThanOrEqual(1 / 16);
  });

  it('gives Select one stroked value rule and a down chevron, the single-choice sibling of Multi-select', () => {
    const svg = svgOf(IconSelect);
    const [value, chevron] = strokesOf(IconSelect);
    const halfStroke = 1.25 / 2;

    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect(svg.querySelector('[fill="currentColor"]')).toBeNull();
    expect(value).toHaveLength(2);
    expect(value[0][1]).toBe(10);
    expect(value[1][1]).toBe(10);
    expect(chevron).toHaveLength(3);
    expect(chevron[1][1]).toBeGreaterThan(chevron[0][1]);
    expect(chevron[2][1]).toBe(chevron[0][1]);
    expect(chevron[0][0] - halfStroke - (value[1][0] + halfStroke)).toBeGreaterThanOrEqual(1.25);
  });

  it('marks the callout with the stand-alone dot beside a long and a short text rule', () => {
    const svg = svgOf(IconCallout);
    const dot = svg.querySelector('circle');
    const [cx, cy, r] = ['cx', 'cy', 'r'].map(name => Number(dot?.getAttribute(name)));
    const [long, short] = strokesOf(IconCallout);
    const ellipsisDot = Number(svgOf(IconDotsHorizontal).querySelector('circle')?.getAttribute('r'));
    const halfStroke = 1.25 / 2;

    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(r).toBe(ellipsisDot);
    expect(cy).toBe(10);
    // Two rules three apart, centred on the dot, the lower one shorter.
    expect(long[0][1]).toBe(long[1][1]);
    expect(short[0][1] - long[0][1]).toBe(3);
    expect((long[0][1] + short[0][1]) / 2).toBe(cy);
    expect(short[0][0]).toBe(long[0][0]);
    expect(short[1][0] - short[0][0]).toBeLessThan(long[1][0] - long[0][0]);
    // One clear unit to the panel and between the dot and the rules.
    expect(cx - r - (3 + halfStroke)).toBeGreaterThanOrEqual(1);
    expect(long[0][0] - halfStroke - (cx + r)).toBeGreaterThanOrEqual(1);
    expect(17 - halfStroke - (long[1][0] + halfStroke)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the slash-search CSS glyph identical to IconSearch', () => {
    const css = readFileSync(resolve(__dirname, '../../../../src/styles/field.css'), 'utf8');
    const dataUrl = css.match(/--_blok-search-glyph: url\("data:image\/svg\+xml,([^"]+)"\)/)?.[1];

    if (dataUrl === undefined) {
      throw new Error('Missing search glyph');
    }

    const glyph = svgOf(decodeURIComponent(dataUrl));
    const icon = svgOf(IconSearch);
    const circleOf = (doc: Document): (string | null)[] =>
      ['cx', 'cy', 'r'].map(name => doc.querySelector('circle')?.getAttribute(name) ?? null);

    expect(circleOf(glyph)).toEqual(circleOf(icon));
    expect(glyph.querySelector('path')?.getAttribute('d')).toBe(pathOf(IconSearch));
  });
});
