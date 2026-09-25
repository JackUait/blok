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


// The toggle icons shift the heading H and digit right to make room for the triangle.
const TOGGLE_OFFSET = 3;

const round = (value: number): number => Math.round(value * 1000) / 1000;

type Point = { command: string; x: number | null; y: number | null };

// Relative steps (h6, v10) keep their length; only absolute x moves.
const shifted = ({ command, x, y }: Point): Point => ({
  command,
  x: x === null || command !== command.toUpperCase() ? x : round(x + TOGGLE_OFFSET),
  y,
});

// Absolute points of a path; H/h carry only x, V/v only y (null for the other axis).
const pairsOf = (command: string, values: number[]): Point[] => {
  if ('Hh'.includes(command)) {
    return values.map(x => ({ command, x, y: null }));
  }
  if ('Vv'.includes(command)) {
    return values.map(y => ({ command, x: null, y }));
  }

  return values.flatMap((value, i) => i % 2 === 0 ? [{ command, x: value, y: values[i + 1] }] : []);
};

const pointsOf = (d: string): Point[] =>
  Array.from(d.matchAll(/([A-Za-z])([^A-Za-z]*)/g))
    .flatMap(([, command, args]) => pairsOf(command, (args.match(/-?(?:\d*\.)?\d+/g) ?? []).map(Number)));

const digitPath = (icon: string): string => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const paths = Array.from(doc.querySelectorAll('path'));
  const digit = paths[paths.length - 1];
  const d = digit.getAttribute('d');

  if (d === null) {
    throw new Error('digit path has no d');
  }

  return d;
};

const yValues = (d: string): number[] => {
  const ys: number[] = [];

  for (const match of d.matchAll(/([MLQCVH])((?:\s*-?\d+(?:\.\d+)?)+)/g)) {
    const cmd = match[1];
    const nums = match[2].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

    if (cmd === 'H') {
      continue;
    }

    if (cmd === 'V') {
      ys.push(...nums);
      continue;
    }

    ys.push(...nums.filter((_value, i) => i % 2 === 1));
  }

  return ys;
};

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
      expect(digitPath(icon)).not.toMatch(/Q/i);
    },
  );

  it('IconH4 stem is full-height from an apex shared with the diagonal', () => {
    expect(digitPath(IconH4)).toMatch(/M(\S+) 10.*M\1 10\s*V\s*15/);
  });

  it.each(Object.entries(headings))('%s digit sits in the heading digit cell (cap 10, baseline 15)', (_name, icon) => {
    const ys = yValues(digitPath(icon));

    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBe(10);
    expect(Math.max(...ys)).toBe(15);
  });

  it.each(Object.entries(toggles))(
    '%s digit is its heading icon digit moved right by the H offset',
    (name, icon) => {
      const headingIcon = headings[name.replace('Toggle', '')];

      expect(pointsOf(digitPath(icon))).toStrictEqual(
        pointsOf(digitPath(headingIcon)).map(shifted)
      );
    },
  );

  it.each(Object.entries(toggles))('%s stays on the 20-unit canvas, strokes included', (_name, icon) => {
    const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      const halfStroke = Number(p.getAttribute('stroke-width')) / 2;
      const xs = pointsOf(p.getAttribute('d') ?? '').flatMap(({ x }) => x === null ? [] : [x]);

      expect(Math.min(...xs) - halfStroke).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs) + halfStroke).toBeLessThanOrEqual(20);
    }
  });

  // Notion's toggle-heading icons: a solid disclosure triangle, then the H, then the digit.
  it.each(Object.entries(toggles))('%s leads with the toggle-list triangle, then the heading H', (name, icon) => {
    const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
    const paths = Array.from(doc.querySelectorAll('path'));
    const headingH = new DOMParser().parseFromString(headings[name.replace('Toggle', '')], 'image/svg+xml').querySelector('path');
    const listTriangle = Array.from(new DOMParser().parseFromString(IconToggleList, 'image/svg+xml').querySelectorAll('path'))
      .find(path => path.getAttribute('fill') === 'currentColor');
    const triangle = pointsOf(paths[0]?.getAttribute('d') ?? '');
    const reference = pointsOf((listTriangle?.getAttribute('d') ?? '').split('Z')[0]);
    const ys = triangle.flatMap(({ y }) => y === null ? [] : [y]);

    expect(paths).toHaveLength(3);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
    expect(paths[0]?.getAttribute('stroke-width')).toBe(listTriangle?.getAttribute('stroke-width'));
    expect(triangle.map(({ x, y }) => [round((x ?? 0) - (triangle[0].x ?? 0)), round((y ?? 0) - (triangle[0].y ?? 0))]))
      .toStrictEqual(reference.map(({ x, y }) => [round((x ?? 0) - (reference[0].x ?? 0)), round((y ?? 0) - (reference[0].y ?? 0))]));
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(10);
    expect(pointsOf(paths[1]?.getAttribute('d') ?? '')).toStrictEqual(
      pointsOf(headingH?.getAttribute('d') ?? '').map(shifted)
    );
    expect(paths[1]?.getAttribute('fill')).toBeNull();
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

  it('IconUnderline rule hugs the U bowl width', () => {
    expect(IconUnderline).toContain('M5.5 15h9');
  });

  it('IconEquation x sits centered under the radical bar', () => {
    const doc = new DOMParser().parseFromString(IconEquation, 'image/svg+xml');
    const paths = Array.from(doc.querySelectorAll('path'));
    const radical = paths[0].getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const cross = digitPath(IconEquation).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const bar = radical.slice(-4);
    const xs = cross.filter((_value, index) => index % 2 === 0);
    const ys = cross.filter((_value, index) => index % 2 === 1);
    const stroke = Number(paths[0].getAttribute('stroke-width'));

    expect(radical).toHaveLength(8);
    expect(cross).toHaveLength(8);
    expect(bar[1]).toBe(bar[3]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo((bar[0] + bar[2]) / 2, 10);
    expect(Math.min(...xs) - bar[0]).toBeGreaterThan(stroke);
    expect(bar[2] - Math.max(...xs)).toBeGreaterThan(stroke);
    expect(Math.min(...ys) - bar[1] - stroke).toBeGreaterThanOrEqual(stroke);
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

  it('all three list icons share the same row geometry', () => {
    const ROWS = 'M8.5 6.5H16.5M8.5 13.5H16.5';

    expect(IconListBulleted).toContain(ROWS);
    expect(IconListNumbered).toContain(ROWS);
    expect(IconListChecklist).toContain(ROWS);
  });
});
