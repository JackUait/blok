import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const entries = Object.entries(icons).filter(
  (entry): entry is [string, string] => entry[0].startsWith('Icon') && typeof entry[1] === 'string'
);

const overlays = new Set([
  'IconImageBroken', 'IconUploadFailed', 'IconLinkExternal', 'IconArrowDownLine',
]);

const parse = (markup: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg || doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG');
  }

  return svg;
};

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

/** Absolute end points of every subpath (M/L/H/V/A/C, curve handles left out). */
const subpathsOf = (d: string): Point[][] => {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let point: Point = [0, 0];

  for (const [, letter, args] of d.matchAll(/([MLHVACZmlhvacz])([^MLHVACZmlhvacz]*)/g)) {
    const lower = letter.toLowerCase();
    const size = SIZES[lower] ?? 0;
    const values = (args.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number);

    if (lower === 'z') {
      point = current[0] ?? point;
      continue;
    }
    if (lower === 'm') {
      current = [];
      subpaths.push(current);
    }
    for (let i = 0; i + size <= values.length; i += size) {
      point = stepTo(lower, letter === lower, values.slice(i, i + size), point);
      current.push(point);
    }
  }

  return subpaths;
};

const pathPoints = (d: string): Point[] => subpathsOf(d).flat();

const pointsOf = (markup: string): Point[] => pathPoints(parse(markup).querySelector('path')?.getAttribute('d') ?? '');

const sorted = (points: number[][]): number[][] => [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('Blok Line authoring contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(entries)('%s keeps its intrinsic grid and decorative accessibility', (name, markup) => {
    const svg = parse(markup);
    const grid = overlays.has(name) ? 24 : 20;

    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${grid} ${grid}`);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.querySelector('text, image, use, style, filter, foreignObject')).toBeNull();

    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      for (const paint of ['fill', 'stroke']) {
        expect([null, 'none', 'currentColor']).toContain(node.getAttribute(paint));
      }

      expect(node.hasAttribute('opacity')).toBe(false);
      expect(node.hasAttribute('fill-opacity')).toBe(false);
      expect(node.hasAttribute('stroke-opacity')).toBe(false);
    }
  });

  it.each(entries)('%s uses the Keyline weight: 1.25 on the 20 grid, 1.5 on 24-grid overlays and the emoji category row', (name, markup) => {
    const svg = parse(markup);
    const widths = [svg, ...svg.querySelectorAll('[stroke-width]')]
      .map(node => node.getAttribute('stroke-width'))
      .filter((width): width is string => width !== null)
      .map(Number);
    // The emoji picker's category row is read at 18-20 px only; 1.25 smudges there.
    const allowed = overlays.has(name) || name.startsWith('IconEmojiNav') ? [1.5] : [1.25];

    const solidControls = [
      'IconMenu', 'IconRowGrip', 'IconDotsHorizontal', 'IconPlacement',
      'IconPlayerPlay', 'IconPlayerPause', 'IconPlayerBackward', 'IconPlayerForward',
      // Quotation marks are printed punctuation; an outline reads as the digits "66".
      'IconQuote',
    ];

    if (!solidControls.includes(name)) {
      expect(widths.length, `${name}: outlines must not become solid silhouettes`).toBeGreaterThan(0);
    }

    for (const width of widths) {
      expect(allowed, `${name}: unexpected stroke ${width}`).toContain(width);
    }
  });

  it('uses rotationally equivalent disclosure chevrons', () => {
    const right = pointsOf(icons.IconChevronRight);

    expect(right).toEqual([[8.25, 6.5], [11.75, 10], [8.25, 13.5]]);
    // Left mirrors right across x 10; down is right turned a quarter about (10, 10).
    expect(sorted(pointsOf(icons.IconChevronLeft))).toEqual(sorted(right.map(([x, y]) => [20 - x, y])));
    expect(sorted(pointsOf(icons.IconChevronDown))).toEqual(sorted(right.map(([x, y]) => [20 - y, x])));
  });

  it('rounds the exposed ends of the rear copy sheet', () => {
    const path = parse(icons.IconCopy).querySelector('path');

    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(parse(icons.IconCopy).querySelector('rect')?.getAttribute('rx')).toBe('2');
  });

  it('keeps a full stroke of space between the trash ribs and body', () => {
    const svg = parse(icons.IconTrash);
    const body = svg.querySelector(':scope > path');
    const ribs = svg.querySelector(':scope > path:last-of-type');

    // The lid group is what the delete animation lifts.
    expect(svg.querySelector('g[data-blok-icon-lid]')).not.toBeNull();
    expect(body).not.toBe(ribs);

    const sides = [...new Set(pathPoints(body?.getAttribute('d') ?? '').map(([x]) => x))];
    const ribXs = pathPoints(ribs?.getAttribute('d') ?? '').map(([x]) => x);
    const left = Math.min(...sides);
    const right = Math.max(...sides);

    expect(ribXs).toHaveLength(4);
    for (const x of ribXs) {
      expect(Math.min(x - left, right - x) - 1.25).toBeGreaterThanOrEqual(1.25);
    }
  });
});
