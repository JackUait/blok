/**
 * The database toolbar's Filter and Sort icons (research/07:53 draws both as
 * 28px icon buttons). Filter: three centred rules that narrow, on the list
 * rows. Sort: an up and a down arrow, one skeleton mirrored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconChevronDoubleRight, IconChevronRight, IconFilter, IconSigma, IconSort } from '../../../../src/components/icons';

const paths = (markup: string): string[] =>
  [ ...markup.matchAll(/<path d="([^"]+)"/g) ].map((m) => m[1]);

/** [x1, y, x2] of a horizontal "Mx yHx2" rule. */
const rule = (d: string): number[] => {
  const m = /^M([\d.]+) ([\d.]+)H([\d.]+)$/.exec(d);

  if (m === null) throw new Error(`not a rule: ${d}`);

  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

describe('database toolbar icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Filter: three rules centred on x 10, each shorter, from the first to the last list row', () => {
    const rules = paths(IconFilter).map(rule);

    expect(rules).toHaveLength(3);
    for (const [x1, , x2] of rules) {
      expect((x1 + x2) / 2).toBe(10);
    }
    const widths = rules.map(([x1, , x2]) => x2 - x1);

    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(rules.map(([, y]) => y)).toEqual([6.5, 10, 13.5]);
  });

  it('Sort: the down arrow is the up arrow turned over, same arm length', () => {
    const [up, down] = paths(IconSort);
    const points = (d: string): number[][] => [ ...d.matchAll(/([\d.]+) ([\d.]+)/g) ].map((m) => [Number(m[1]), Number(m[2])]);
    const upPoints = points(up);
    const downPoints = points(down);
    const flipped = upPoints.map(([x, y]) => [x + 6, 20 - y]);

    expect(new Set(downPoints.map((p) => p.join()))).toEqual(new Set(flipped.map((p) => p.join())));
  });

  it('Sigma: one stroke on the type cap and baseline, centred on x 10, its halves mirrored', () => {
    const all = paths(IconSigma);
    const at = { x: 0, y: 0 };
    const points = [ ...all[0].matchAll(/([MLH])([\d.]+)(?: ([\d.]+))?/g) ].map(([, cmd, a, b]) => {
      at.x = Number(a);
      at.y = cmd === 'H' ? at.y : Number(b);

      return [at.x, at.y];
    });
    const key = (list: number[][]): string[] => list.map((p) => p.join()).sort();

    expect(all).toHaveLength(1);
    expect([Math.min(...points.map(([, y]) => y)), Math.max(...points.map(([, y]) => y))]).toEqual([5, 15]);
    expect((Math.min(...points.map(([x]) => x)) + Math.max(...points.map(([x]) => x))) / 2).toBe(10);
    expect(key(points.map(([x, y]) => [x, 20 - y]))).toEqual(key(points));
  });
  it('Minimize: two copies of IconChevronRight\'s skeleton, 5 units apart and centred on the canvas', () => {
    const shift = (d: string, dx: number): string => d.replace(/M([\d.]+) /, (_, x: string) => `M${Number(x) + dx} `)
      .replace(/L([\d.]+) ([\d.]+)L([\d.]+)/, (_, a: string, b: string, c: string) => `L${Number(a) + dx} ${b}L${Number(c) + dx}`);
    const [single] = paths(IconChevronRight);
    const [left, right] = paths(IconChevronDoubleRight);

    expect(left).toBe(shift(single, -2.5));
    expect(right).toBe(shift(single, 2.5));
  });
});
