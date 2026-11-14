import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconEmojiSmile, IconHelp, IconInfo, IconWarning } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
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

const HALF_STROKE = 1.25 / 2;

describe('IconInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The (i) is the warning's stem and dot, flipped, inside the keyline circle.
  it('draws the warning stem and dot, flipped, inside the standard circle', () => {
    const svg = svgOf(IconInfo);
    const [ring, dot] = [...svg.querySelectorAll('circle')];
    const [stem] = subpathsOf(svg.querySelector('path')?.getAttribute('d') ?? '');
    const standard = svgOf(IconEmojiSmile).querySelector('circle');
    const warningDot = svgOf(IconWarning).querySelector('circle');

    expect(['cx', 'cy', 'r', 'stroke-width'].map((a) => ring?.getAttribute(a))).toEqual(['cx', 'cy', 'r', 'stroke-width'].map((a) => standard?.getAttribute(a)));
    expect(['cx', 'cy', 'r'].map((a) => ring?.getAttribute(a))).toEqual(['10', '10', '7']);
    expect(dot?.getAttribute('r')).toBe(warningDot?.getAttribute('r'));
    expect(dot?.getAttribute('cx')).toBe('10');
    expect(stem).toEqual([[10, 9.25], [10, 13.5]]);
    // The dot sits above the stem, one clear unit from its round cap.
    expect(stem[0][1] - HALF_STROKE - (Number(dot?.getAttribute('cy')) + Number(dot?.getAttribute('r')))).toBeGreaterThanOrEqual(1);
  });
});

describe('IconHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The (?) shares the (i)'s ring and dot size, so the two read as one pair.
  it('draws a hook and dot inside the same circle as IconInfo', () => {
    const svg = svgOf(IconHelp);
    const [ring, dot] = [...svg.querySelectorAll('circle')];
    const [infoRing, infoDot] = [...svgOf(IconInfo).querySelectorAll('circle')];
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    const [hook] = subpathsOf(d);
    const hookEnd = hook[hook.length - 1];

    expect(['cx', 'cy', 'r', 'stroke-width'].map((a) => ring?.getAttribute(a))).toEqual(['cx', 'cy', 'r', 'stroke-width'].map((a) => infoRing?.getAttribute(a)));
    expect(dot?.getAttribute('r')).toBe(infoDot?.getAttribute('r'));
    expect(dot?.getAttribute('cx')).toBe('10');
    // The hook's arc starts at (8, 8) around (10, 8) and its tail ends over the dot.
    expect(d).toMatch(/^M8 8a2 2 /);
    expect(hookEnd[0]).toBeCloseTo(10, 5);
    // The dot clears the hook's round cap by one clear unit.
    expect(Number(dot?.getAttribute('cy')) - Number(dot?.getAttribute('r')) - (hookEnd[1] + HALF_STROKE)).toBeGreaterThanOrEqual(1);
  });
});
