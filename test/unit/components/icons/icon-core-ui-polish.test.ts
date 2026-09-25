import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconCallout, IconCheck, IconSearch, IconSelect, IconUnderline, IconWand } from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');

const numbersOf = (path: string): number[] => (path.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

const pathOf = (icon: string, index = 0): string =>
  svgOf(icon).querySelectorAll('path')[index]?.getAttribute('d') ?? '';

const stepOf = (command: string, [x, y]: number[], values: number[]): number[] => {
  switch (command) {
    case 'M':
    case 'L':
      return values;
    case 'm':
    case 'l':
      return [x + values[0], y + values[1]];
    case 'H':
      return [values[0], y];
    default:
      return [x + values[0], y];
  }
};

// Absolute x of every point in a path made of M/m/h/l commands.
const xsOf = (d: string): number[] => {
  const xs: number[] = [];
  let point = [0, 0];

  for (const [, command, args] of d.matchAll(/([MmHhLl])([^MmHhLl]*)/g)) {
    const values = numbersOf(args);
    const size = command.toLowerCase() === 'h' ? 1 : 2;

    for (let i = 0; i < values.length; i += size) {
      point = stepOf(command, point, values.slice(i, i + size));
      xs.push(point[0]);
    }
  }

  return xs;
};

const pairsOf = (values: number[]): number[][] =>
  values.reduce<number[][]>((pairs, value, index) => index % 2 === 0 ? [...pairs, [value, values[index + 1]]] : pairs, []);

describe('Blok Line core UI polish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('centres the check tick on the canvas', () => {
    const [x, y, dx1, dy1, dx2, dy2] = numbersOf(pathOf(IconCheck));
    const points = [[x, y], [x + dx1, y + dy1], [x + dx1 + dx2, y + dy1 + dy2]];
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);

    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(10);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(10);
  });

  it('draws the sparkle with long, thin rays that meet the axes near its centre', () => {
    const points = pairsOf(numbersOf(pathOf(IconWand)));
    const [top, control1, control2, right] = points;

    expect(top).toEqual([10, 3.5]);
    expect(right).toEqual([16.5, 10]);
    // Controls close to the axes keep the rays sharp; 0.5 already reads blunt at 16 px.
    expect(Math.abs(control1[0] - 10)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(control2[1] - 10)).toBeLessThanOrEqual(0.35);

    const key = ([px, py]: number[]): string => `${px},${py}`;
    const all = new Set(points.map(key));

    for (const [px, py] of points) {
      expect(all.has(key([20 - px, py])), `mirror of ${px},${py}`).toBe(true);
      expect(all.has(key([px, 20 - py])), `flip of ${px},${py}`).toBe(true);
    }
  });

  it('centres the lens and handle together and keeps the handle on the lens diagonal', () => {
    const lens = svgOf(IconSearch).querySelector('circle');
    const [cx, cy, r] = ['cx', 'cy', 'r'].map(name => Number(lens?.getAttribute(name)));
    const [sx, sy, dx, dy] = numbersOf(pathOf(IconSearch));

    expect(r).toBe(5);
    expect(sx - cx).toBe(sy - cy);
    expect(dx).toBe(dy);
    expect((cx - r + sx + dx) / 2).toBe(10);
    expect((cy - r + sy + dy) / 2).toBe(10);
    // The handle starts just outside the lens so the two strokes read as one joint.
    expect(Math.hypot(sx - cx, sy - cy) - r).toBeGreaterThan(0);
    expect(Math.hypot(sx - cx, sy - cy) - r).toBeLessThan(1.25 / 2);
  });

  it('keeps a full stroke of space between the underline U and its rule', () => {
    const [, top, stem, radius] = numbersOf(pathOf(IconUnderline));
    const [, rule] = numbersOf(pathOf(IconUnderline, 1));
    const bowlBottom = top + stem + radius;

    expect(rule - bowlBottom - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it.each(Object.entries({ IconCallout, IconSelect }))('%s centres its contents inside the panel', (_name, icon) => {
    const svg = svgOf(icon);
    const edges: number[] = [];

    for (const dot of svg.querySelectorAll('circle')) {
      const cx = Number(dot.getAttribute('cx'));
      const r = Number(dot.getAttribute('r'));

      edges.push(cx - r, cx + r);
    }
    for (const path of svg.querySelectorAll('path')) {
      const halfStroke = Number(path.getAttribute('stroke-width')) / 2;
      const xs = xsOf(path.getAttribute('d') ?? '');

      edges.push(Math.min(...xs) - halfStroke, Math.max(...xs) + halfStroke);
    }

    expect((Math.min(...edges) + Math.max(...edges)) / 2).toBeCloseTo(10, 1);
  });

  it('keeps the slash-search CSS glyph identical to IconSearch', () => {
    const css = readFileSync(resolve(__dirname, '../../../../src/styles/popover-animation.css'), 'utf8');
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
