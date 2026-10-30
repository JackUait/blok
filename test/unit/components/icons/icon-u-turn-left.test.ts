/**
 * Edit formula's ↩ (Notion's `arrowUTurnDownLeft`): a left arrow whose shaft turns up and back
 * on the right. `32-formula-typed.png` and `54-dark-formula.png` (pixels): its ink is 12x8.
 */
import { describe, expect, it } from 'vitest';

import { IconReturn, IconUTurnLeft } from '../../../../src/components/icons';

const STROKE = 1.25;

const paths = (markup: string): string[] =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => path.getAttribute('d') ?? '');

const points = (d: string): Array<[number, number]> =>
  [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

const isHead = (d: string): boolean => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+$/.test(d);

describe('IconUTurnLeft', () => {
  const [head, shaft] = [paths(IconUTurnLeft).find(isHead) ?? '', paths(IconUTurnLeft).find((d) => !isHead(d)) ?? ''];

  it('is a new drawing, not the Enter arrow', () => {
    expect(IconUTurnLeft).not.toBe(IconReturn);
    expect(paths(IconUTurnLeft)).toHaveLength(2);
  });

  it('ends its shaft at the arrowhead\'s tip, which points left', () => {
    const [a, tip, b] = points(head);

    expect(shaft.endsWith(`H${tip[0]}`)).toBe(true);
    expect(a[0]).toBeGreaterThan(tip[0]);
    expect(b[0]).toBeGreaterThan(tip[0]);
    expect(a[1] + b[1]).toBe(2 * tip[1]);
  });

  it('turns its shaft back with a half circle, so the top stroke sits one diameter above it', () => {
    const arc = /a([\d.]+) ([\d.]+) 0 0 1 0 (-?[\d.]+)/.exec(shaft);
    const [, start] = /^M[\d.]+ ([\d.]+)/.exec(shaft) ?? [];

    expect(arc).not.toBeNull();
    expect(Number(arc?.[3])).toBe(2 * Number(arc?.[1]));
    expect(Number(start) + Number(arc?.[3])).toBe(points(head)[1][1]);
  });

  it('draws ink 12 wide and 8 tall, centred on the 20 canvas', () => {
    const [a, tip, b] = points(head);
    const arc = /H([\d.]+)a([\d.]+)/.exec(shaft);
    const right = Number(arc?.[1]) + Number(arc?.[2]) + STROKE / 2;
    const left = tip[0] - STROKE / 2;
    const top = Math.min(a[1], points(shaft)[0][1]) - STROKE / 2;
    const bottom = b[1] + STROKE / 2;

    expect(right - left).toBeCloseTo(12, 1);
    expect(bottom - top).toBeCloseTo(8.25, 1);
    expect((left + right) / 2).toBeCloseTo(10, 1);
    expect((top + bottom) / 2).toBeCloseTo(10, 1);
  });
});
