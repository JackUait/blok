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

  it('Select\'s mark is a line chevron, not a filled caret', () => {
    const mark = svg(icons.IconSelectCircle).querySelector('path');

    expect(mark?.getAttribute('fill')).toBeNull();
    expect(mark?.getAttribute('d')).toBe('M7.75 9L10 11.25L12.25 9');
  });

  it('Clock and user circle sit on the standalone circle', () => {
    for (const icon of [icons.IconClock, icons.IconUserCircle]) {
      const ring = svg(icon).querySelector('circle');

      expect([num(ring, 'cx'), num(ring, 'cy'), num(ring, 'r')]).toEqual([10, 10, 6.5]);
    }
  });

  it('the user circle keeps a full stroke between head, ring and shoulders, and the shoulders meet the ring', () => {
    const [ring, head] = [...svg(icons.IconUserCircle).querySelectorAll('circle')];
    const d = svg(icons.IconUserCircle).querySelector('path')?.getAttribute('d') ?? '';
    const ends = [d.match(/^M([\d.]+) ([\d.]+)/), d.match(/([\d.]+) ([\d.]+)$/)].map((m) => [Number(m?.[1]), Number(m?.[2])]);
    const shoulderTop = Number(d.match(/C[\d. ]+ ([\d.]+) 10 ([\d.]+)C/)?.[2]);

    for (const [x, y] of ends) {
      expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(6.5, 1);
    }
    expect(num(head, 'cy') - num(head, 'r') - (num(ring, 'cy') - num(ring, 'r')) - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(shoulderTop - (num(head, 'cy') + num(head, 'r')) - 1.25).toBeGreaterThanOrEqual(1.25);
  });

  it('the checkbox is the 13-unit box as a line, with a line check', () => {
    const root = svg(icons.IconCheckbox);
    const frame = root.querySelector('rect');

    expect([num(frame, 'x'), num(frame, 'y'), num(frame, 'width'), num(frame, 'height')]).toEqual([3.5, 3.5, 13, 13]);
    expect(root.querySelector('[fill="currentColor"]')).toBeNull();
    expect(root.querySelector('path')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('the numero N stands on the type grid (cap 5, baseline 15)', () => {
    const d = svg(icons.IconNumero).querySelector('path')?.getAttribute('d') ?? '';

    expect(d).toBe('M3.5 15V5L9.5 15V5');
  });

  it('the button cursor is IconCursor at 0.6 scale, a full stroke clear of the button', () => {
    const points = (markup: string, index: number): number[][] =>
      [...(svg(markup).querySelectorAll('path')[index]?.getAttribute('d') ?? '').matchAll(/([\d.]+) ([\d.]+)/g)]
        .map((m) => [Number(m[1]), Number(m[2])]);
    const base = points(icons.IconCursor, 0);
    const cursor = points(icons.IconCursorButton, 1);

    expect(cursor).toHaveLength(base.length);
    cursor.forEach(([x, y], i) => {
      expect(x - cursor[0][0]).toBeCloseTo((base[i][0] - base[0][0]) * 0.6, 5);
      expect(y - cursor[0][1]).toBeCloseTo((base[i][1] - base[0][1]) * 0.6, 5);
    });
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

describe('toolbar bolt (Automations)', () => {
  it('turns onto itself a half turn about the centre', () => {
    const d = svg(icons.IconBolt).querySelector('path')?.getAttribute('d') ?? '';
    const vertices: string[] = [];
    let y = 0;

    for (const [, cmd, args] of d.matchAll(/([MLH])([^MLHZ]+)/g)) {
      const nums = args.trim().split(/\s+/).map(Number);
      const x = nums[0];

      y = cmd === 'H' ? y : nums[1];
      vertices.push(`${x} ${y}`);
    }
    const turned = vertices.map((v) => v.split(' ').map((n) => 20 - Number(n)).join(' '));

    expect(vertices.length).toBeGreaterThanOrEqual(6);
    expect(new Set(turned)).toEqual(new Set(vertices));
  });
});
