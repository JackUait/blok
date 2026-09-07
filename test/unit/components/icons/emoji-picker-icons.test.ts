import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconEmojiBall, IconEmojiLightbulb, IconEmojiSmile, IconEmojiUtensils,
} from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');
const pathsOf = (icon: string): string[] => Array.from(svgOf(icon).querySelectorAll('path'))
  .map(path => path.getAttribute('d') ?? '');
const valuesOf = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('emoji category icon relationships', () => {
  it('gives the fork three evenly spaced tines with a full stroke of clear space', () => {
    const paths = pathsOf(IconEmojiUtensils);

    expect(paths).toContain('M6 3.5v13');
    expect(paths[0]).toBe('M3.5 3.5V6.5a2.5 2.5 0 0 0 5 0V3.5');
    const bowl = valuesOf(paths[0]);
    const stem = valuesOf(paths[1]);
    const left = bowl[0];
    const right = left + bowl[8];
    const center = stem[0];

    expect(center - left).toBe(right - center);
    expect(center - left - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(stem[1]).toBe(bowl[1]);
    expect(stem[1] + stem[2]).toBe(16.5);
  });

  it('gives the tennis ball two opposed seams that meet the shared circular frame', () => {
    const paths = pathsOf(IconEmojiBall).flatMap(path => path.match(/M[^M]+/g) ?? []);

    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/^M[\d. ]+C[\d. ]+$/);
    expect(paths[1]).toMatch(/^M[\d. ]+C[\d. ]+$/);
    const first = valuesOf(paths[0]);
    const second = valuesOf(paths[1]);

    expect(first).toHaveLength(8);
    expect(second).toHaveLength(8);
    first.forEach((value, index) => {
      expect(value + second[index]).toBe(20);
    });
    for (const seam of [first, second]) {
      expect(Math.hypot(seam[0] - 10, seam[1] - 10)).toBeCloseTo(6.5);
      expect(Math.hypot(seam[6] - 10, seam[7] - 10)).toBeCloseTo(6.5);
    }

    const midpointX = (first[0] + 3 * first[2] + 3 * first[4] + first[6]) / 8;
    const midpointY = (first[1] + 3 * first[3] + 3 * first[5] + first[7]) / 8;

    expect(Math.hypot(20 - 2 * midpointX, 20 - 2 * midpointY) - 1.25).toBeGreaterThanOrEqual(1.25);
    const frame = svgOf(IconEmojiBall).querySelector('circle');
    const face = svgOf(IconEmojiSmile).querySelector('circle');

    for (const attribute of ['cx', 'cy', 'r']) {
      expect(frame?.getAttribute(attribute)).toBe(face?.getAttribute(attribute));
    }
  });

  it('centers a tapered bulb socket under the neck with a full stroke of clear space', () => {
    const paths = pathsOf(IconEmojiLightbulb);

    expect(paths[1]).toBe('M8 15.5l.5 1h3l.5-1');
    const neck = valuesOf(paths[0]);
    const socket = valuesOf(paths[1]);
    const socketRight = socket[0] + socket[2] + socket[4] + socket[5];

    expect(socket[0]).toBe(neck[0]);
    expect((socket[0] + socketRight) / 2).toBe(10);
    expect(socket[2]).toBe(socket[5]);
    expect(socket[3]).toBe(-socket[6]);
    expect(socket[1] - neck[1] - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(socket[1] + socket[3]).toBe(16.5);
  });
});
