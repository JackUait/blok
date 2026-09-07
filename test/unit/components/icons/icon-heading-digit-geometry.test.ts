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
  IconListBulleted,
  IconListNumbered,
  IconListChecklist,
  IconBold,
  IconEquation,
  IconUnderline,
  IconClearFormat,
} from '../../../../src/components/icons';


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
    '%s digit is byte-identical to its heading icon digit',
    (name, icon) => {
      const headingIcon = headings[name.replace('Toggle', '')];

      expect(digitPath(icon)).toBe(digitPath(headingIcon));
    },
  );

  it.each(Object.entries(toggles))('%s letterforms stay inside the 3-17 content inset', (_name, icon) => {
    const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      const xs = (p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

      expect(Math.max(...xs)).toBeLessThanOrEqual(17);
    }
  });

  it.each(Object.entries(toggles))('%s leads with a letterform-height stroked chevron in the H slot', (_name, icon) => {
    const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
    const paths = Array.from(doc.querySelectorAll('path'));

    expect(paths.length).toBe(2);

    const chevron = paths[0];

    expect(chevron.getAttribute('fill')).toBeNull();
    expect(chevron.getAttribute('stroke')).toBe('currentColor');

    const ys = (chevron.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.filter((_v, i) => i % 2 === 1).map(Number) ?? [];

    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(8.5);
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
