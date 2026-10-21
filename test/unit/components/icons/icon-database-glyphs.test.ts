import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

type Point = [number, number];

/** Polylines of an icon's paths, for drawings made of M/L commands only. */
const polylines = (markup: string | undefined): Point[][] => {
  const doc = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml');

  return [...doc.querySelectorAll('path')].flatMap((path) =>
    (path.getAttribute('d') ?? '').split('M').filter(Boolean).map((run) =>
      run.split('L').map((pair): Point => {
        const [x, y] = pair.trim().split(/[\s,]+/).map(Number);

        return [x, y];
      })
    )
  );
};

const mirrorX = (lines: Point[][]): Point[][] => lines.map((line) => line.map(([x, y]): Point => [20 - x, y]));
const mirrorY = (lines: Point[][]): Point[][] => lines.map((line) => line.map(([x, y]): Point => [x, 20 - y]));

/** Every segment of a chevron arm runs at 45 degrees. */
const armsAt45 = (line: Point[]): boolean =>
  line.slice(1).every(([x, y], i) => Math.abs(Math.abs(x - line[i][0]) - Math.abs(y - line[i][1])) < 1e-9);

describe('database glyphs drawn after Notion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('small straight arrows (timeline off-screen chip)', () => {
    const left = polylines(icons.IconArrowLeftSmall);
    const right = polylines(icons.IconArrowRightSmall);

    it('draws a shaft and an open 45-degree head', () => {
      expect(left).toHaveLength(2);
      expect(left.find((line) => line.length === 3)).toSatisfy(armsAt45);
    });

    it('the right arrow mirrors the left about x = 10', () => {
      expect(right).toEqual(mirrorX(left));
    });

    // The chip draws it in a 14x12 box (Notion's measure), so a 20-unit
    // square renders at 0.6. Notion's arrow is about 8x7 px there.
    it('spans about 8 by 7 px at the chip size', () => {
      const points = left.flat();
      const width = Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
      const height = Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));

      expect(width * 0.6).toBeCloseTo(7.5, 0);
      expect(height * 0.6).toBeCloseTo(6.6, 0);
    });
  });

  describe('up/down chevron (select-like fields)', () => {
    const lines = polylines(icons.IconChevronUpDown);

    it('is two 45-degree chevrons, the lower one the upper turned over about y = 10', () => {
      expect(lines).toHaveLength(2);
      expect(lines.every(armsAt45)).toBe(true);
      expect(mirrorY([lines[0]])).toEqual([lines[1]]);
    });

    // Drawn 1:1 in a 20px box; Notion's measured glyph is about 9 wide and 13 tall.
    it('spans 9 by 13 units, with a 4-unit gap between the halves', () => {
      const points = lines.flat();
      const ys = points.map(([, y]) => y);

      expect(Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x))).toBe(9);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(13);
      expect(Math.min(...lines[1].map(([, y]) => y)) - Math.max(...lines[0].map(([, y]) => y))).toBe(4);
    });
  });
});
