import { describe, it, expect } from 'vitest';
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

/**
 * Digit-skeleton quality pins for the heading family.
 *
 * The stroked digit skeletons are the letterform half of every H1-H6 icon, so
 * their curve quality IS the perceived quality of the whole family:
 *
 * - Curves are cubic (C) arcs. The old hand-tuned quadratics (Q) kinked at the
 *   bowl junctions of 2/3/5/6, which read as wobble at menu size.
 * - The "4" stem runs the full cap-to-baseline height from a shared apex with
 *   the diagonal. The old stem started mid-air and looked disconnected.
 * - Every toggle digit lives in ONE cell (cap 9.03, baseline 13.75). Toggle
 *   H4-H6 used to reuse the full-size heading digits (baseline 15), so the
 *   toggle row mixed two digit sizes.
 */

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

describe('heading digit skeleton geometry', () => {
  it.each(Object.entries({ ...headings, ...toggles }))(
    '%s digit curves are cubic arcs, not kink-prone quadratics',
    (_name, icon) => {
      expect(digitPath(icon)).not.toMatch(/Q/i);
    },
  );

  it('IconH4 stem is full-height from an apex shared with the diagonal', () => {
    // both the diagonal and the vertical stem start at the same cap-height apex
    expect(digitPath(IconH4)).toMatch(/M(\S+) 9\.3.*M\1 9\.3\s*V\s*15/);
  });

  it.each(Object.entries(headings))('%s digit sits in the heading digit cell (cap 9.3, baseline 15)', (_name, icon) => {
    const ys = yValues(digitPath(icon));

    expect(Math.min(...ys)).toBeGreaterThanOrEqual(9.3);
    expect(Math.max(...ys)).toBeLessThanOrEqual(15);
  });

  it.each(Object.entries(toggles))(
    '%s digit is byte-identical to its heading icon digit',
    (name, icon) => {
      // the toggle heading mirrors the heading icon structure — [big glyph +
      // subscript digit] — with a disclosure chevron in the H slot; the digit
      // path is shared verbatim so the two families can never drift apart
      const headingIcon = headings[name.replace('Toggle', '')];

      expect(digitPath(icon)).toBe(digitPath(headingIcon));
    },
  );

  it.each(Object.entries(toggles))('%s letterforms stay inside the 3-17 content inset', (_name, icon) => {
    // the old composition let digits overflow to x=17.45 and the triangle start
    // at x=2.5 — everything now fits the house 3-17 content box
    const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      const xs = (p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

      expect(Math.max(...xs)).toBeLessThanOrEqual(17);
    }
  });

  it.each(Object.entries(toggles))('%s leads with a letterform-height stroked chevron in the H slot', (_name, icon) => {
    // two glyphs only — a chevron as tall as the heading H, stroked at the same
    // hairline as every letterform; no fills, no small accent markers
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
    // the legacy B was two CLOSED shapes carrying 24-grid conversion leftovers
    // (4.9231, .8787…) — the shared stem stroked twice and coordinates off-grid
    expect(IconBold).not.toMatch(/\d\.\d{3}/);
    expect(IconBold).not.toMatch(/Z/i);
  });

  it('IconBold carries semantic bold weight', () => {
    // a Bold glyph drawn at the 1.25 hairline does not read as "bold" — the B
    // is the one glyph whose MEANING is weight, so it renders heavier (like
    // every production toolbar); it is deliberately outside the menu-weight family
    expect(IconBold).toContain('stroke-width="1.9"');
  });

  it('IconUnderline rule hugs the U bowl width', () => {
    // the old rule ran 11 units under an 8-unit bowl — reads misaligned
    expect(IconUnderline).toContain('M5.5 16.5h9');
  });

  it('IconEquation x sits centered under the radical bar', () => {
    expect(IconEquation).toContain('M10.2 9.8');
  });

  it('IconClearFormat is a hairline T with a strike-out x', () => {
    // clear-format (Tx): T letterform + small x, house 20/1.25 spec
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
    // the checklist used to draw shorter rows starting at x=10 while bulleted and
    // numbered start at x=8 — side by side in the toolbox the family looked ragged
    const ROWS = 'M8 5h9M8 10h9M8 15h9';

    expect(IconListBulleted).toContain(ROWS);
    expect(IconListNumbered).toContain(ROWS);
    expect(IconListChecklist).toContain(ROWS);
  });
});
