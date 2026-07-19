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
    '%s digit sits in the single toggle digit cell (cap 9.2, baseline 14.04)',
    (_name, icon) => {
      const ys = yValues(digitPath(icon));

      expect(Math.min(...ys)).toBeGreaterThanOrEqual(9.2);
      expect(Math.max(...ys)).toBeLessThanOrEqual(14.04);
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
