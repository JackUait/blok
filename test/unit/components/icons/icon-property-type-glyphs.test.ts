import { describe, expect, it } from 'vitest';
import * as icons from '../../../../src/components/icons';

const svg = (markup: string | undefined): SVGSVGElement => {
  const node = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml').querySelector('svg');

  if (node === null) throw new Error('no svg');

  return node;
};

const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr));

describe('property type glyphs (Notion shapes on the Blok Line grid)', () => {
  it('Select and Status share the standalone circle: centre (10, 10), radius 6.5', () => {
    const select = svg(icons.IconSelectCircle).querySelector('circle');

    expect([num(select, 'cx'), num(select, 'cy'), num(select, 'r')]).toEqual([10, 10, 6.5]);

    // Status is that circle as eight dashes: each ends on radius 6.5, so its
    // round cap reaches the same outer edge as Select's stroke.
    const dashes = (svg(icons.IconStatusCircle).querySelector('path')?.getAttribute('d') ?? '')
      .split('M').filter(Boolean)
      .map((run) => run.split('L').map((pair) => pair.trim().split(/\s+/).map(Number)));

    expect(dashes).toHaveLength(8);
    for (const [, [x, y]] of dashes) {
      expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(6.5, 1);
    }
  });

  it('Text is three rules, the last one shorter, like Notion', () => {
    const d = svg(icons.IconTextLines).querySelector('path')?.getAttribute('d') ?? '';
    const rules = [...d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);

    expect(rules).toHaveLength(3);
    expect(rules[0][2]).toBe(rules[1][2]);
    expect(rules[2][2]).toBeLessThan(rules[1][2]);
    expect(new Set(rules.map(([x]) => x)).size).toBe(1);
  });

  it('Title draws "Aa" from strokes, with the cap on the type grid (cap 5, baseline 15)', () => {
    const d = svg(icons.IconLetterCase).querySelector('path')?.getAttribute('d') ?? '';

    expect(d).toMatch(/^M3 15L6\.5 5L10 15/);
  });

  it('the two people heads keep a full stroke of space between them', () => {
    const [front, back] = [...svg(icons.IconPeople).querySelectorAll('circle')];
    const gap = Math.hypot(num(back, 'cx') - num(front, 'cx'), num(back, 'cy') - num(front, 'cy'))
      - num(front, 'r') - num(back, 'r') - 1.25;

    expect(gap).toBeGreaterThanOrEqual(1.25);
  });

  it('the checked box is the 13-unit box, filled, with the check cut out', () => {
    const root = svg(icons.IconCheckboxFilled);
    const frame = root.querySelector('rect');
    const fill = root.querySelector('path');

    expect([num(frame, 'x'), num(frame, 'y'), num(frame, 'width'), num(frame, 'height')]).toEqual([3.5, 3.5, 13, 13]);
    expect(fill?.getAttribute('fill')).toBe('currentColor');
    expect(fill?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('the handset is symmetric about the anti-diagonal', () => {
    const d = svg(icons.IconPhone).querySelector('path')?.getAttribute('d') ?? '';

    // The end point of every command: its last two numbers.
    const points = d.split(/[MLAZ]/).map((run) => run.trim().split(/\s+/).slice(-2).map(Number).join(' '));
    const earpiece = [[7.7, 3.5], [8.9, 6.7], [7.3, 8.1]];

    for (const [x, y] of earpiece) {
      expect(points).toContain(`${x} ${y}`);
      expect(points).toContain(`${Math.round((20 - y) * 10) / 10} ${Math.round((20 - x) * 10) / 10}`);
    }
  });
});
