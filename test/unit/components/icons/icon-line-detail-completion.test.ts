import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconClearFormat, IconCode, IconCodeBlock, IconDatabase,
  IconEmojiFlag, IconEmojiSmile, IconEmojiSprout, IconEmojiStar, IconEquation,
  IconMergeCells, IconSplitCell, IconText,
} from '../../../../src/components/icons';

const svgOf = (icon: string): Document => new DOMParser().parseFromString(icon, 'image/svg+xml');
const pathOf = (icon: string, index = 0): string => {
  const path = svgOf(icon).querySelectorAll('path').item(index)?.getAttribute('d');

  if (!path) {
    throw new Error('Missing path');
  }

  return path;
};
const valuesOf = (path: string): number[] => path.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
const attributesOf = (element: Element, names: string[]): number[] =>
  names.map(name => Number(element.getAttribute(name)));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Blok Line small-detail geometry', () => {
  it('gives the text cap short matching shoulders without a baseline serif', () => {
    const d = pathOf(IconText);

    expect(d).toBe('M5 6.5V5h10v1.5M10 5v10');
    const cap = valuesOf(d);

    expect(cap[1] - cap[2]).toBe(cap[4]);
  });

  it('aligns the radical with the type cap and baseline, leaving space above the radicand', () => {
    const radical = valuesOf(pathOf(IconEquation));
    const radicand = valuesOf(pathOf(IconEquation, 1));

    expect(radical).toStrictEqual([3.5, 10, 6, 15, 9, 5, 16.5, 5]);
    const clearCross = valuesOf(pathOf(IconClearFormat, 1));

    expect(radicand[2] - radicand[0]).toBeCloseTo(clearCross[2] - clearCross[0]);
    expect(radicand[3] - radicand[1]).toBeCloseTo(clearCross[3] - clearCross[1]);
    expect((radicand[0] + radicand[2]) / 2).toBe((radical[4] + radical[6]) / 2);
    expect(radicand[1] - radical[5] - 1.25).toBeGreaterThan(1.25);
  });

  it('uses mirrored four-unit 45-degree inline code chevrons', () => {
    const d = pathOf(IconCode);

    expect(d).toBe('M7.5 6 3.5 10 7.5 14M12.5 6 16.5 10 12.5 14');
    const points = valuesOf(d);

    expect(points[0] - points[2]).toBe(points[3] - points[1]);
  });

  it('opens the code-block brackets around a narrower, centered slash', () => {
    expect(pathOf(IconCodeBlock)).toBe('M6.5 6.5 3 10 6.5 13.5M13.5 6.5 17 10 13.5 13.5');
    expect(pathOf(IconCodeBlock, 1)).toBe('M11.5 5 8.5 15');
    const brackets = valuesOf(pathOf(IconCodeBlock));
    const slash = valuesOf(pathOf(IconCodeBlock, 1));
    const slashAtTop = slash[0] + (slash[2] - slash[0]) * (brackets[7] - slash[1]) / (slash[3] - slash[1]);

    expect(brackets[6] - slashAtTop - 1.25).toBeGreaterThan(1);
  });

  it('balances the rounded star around its vertical axis with open lower notches', () => {
    const outline = pathOf(IconEmojiStar);
    const coordinates = valuesOf(outline);
    const points = coordinates.filter((_value, index) => index % 2 === 0)
      .map((x, index) => [x, coordinates[index * 2 + 1]]);

    expect(outline).toMatch(/^[MLQZ\d. ]+$/);
    expect(outline.endsWith('Z')).toBe(true);
    for (const [x, y] of points) {
      expect(points.some(([otherX, otherY]) => Math.abs(x + otherX - 20) < 0.001 && y === otherY)).toBe(true);
    }
    const corners = Array.from(outline.matchAll(/[ML][\d. ]+Q[\d. ]+/g), match => {
      const values = valuesOf(match[0]);

      expect(values).toHaveLength(6);

      return [(values[0] + 2 * values[2] + values[4]) / 4, (values[1] + 2 * values[3] + values[5]) / 4];
    });

    expect(corners).toHaveLength(10);
    const lowerNotch = corners.find(([x, y]) => x === 10 && y > 10);

    if (lowerNotch === undefined) {
      throw new Error('Missing lower star notch');
    }
    const lowerTips = corners.filter(([, y]) => y - lowerNotch[1] >= 1.25);

    expect(lowerTips).toHaveLength(2);
    expect(Math.abs(lowerTips[0][0] - lowerTips[1][0])).toBeGreaterThan(6);
  });

  it('keeps the smile centered and separated from the eyes', () => {
    const eyes = Array.from(svgOf(IconEmojiSmile).querySelectorAll('circle')).slice(1);

    expect(eyes.map(eye => attributesOf(eye, ['cx', 'cy', 'r']))).toStrictEqual([[7.5, 8, 0.75], [12.5, 8, 0.75]]);
    const outline = pathOf(IconEmojiSmile);

    expect(outline).toMatch(/^M[\d. ]+L[\d. ]+C[\d. ]+Z$/);
    const mouth = valuesOf(outline);

    expect(mouth).toHaveLength(10);
    expect((mouth[0] + mouth[2]) / 2).toBe(10);
    expect(mouth[1]).toBe(mouth[3]);
    expect(mouth[4] + mouth[6]).toBe(20);
    expect(mouth[5]).toBe(mouth[7]);
    expect(mouth.slice(8)).toStrictEqual(mouth.slice(0, 2));
    for (const eye of eyes) {
      const [cy, radius] = attributesOf(eye, ['cy', 'r']);

      expect(mouth[1] - cy - radius - 0.625).toBeGreaterThan(1.25);
    }
  });

  it('gives the single nature leaf room on both sides of its uninterrupted diagonal vein', () => {
    expect(svgOf(IconEmojiSprout).querySelectorAll('path')).toHaveLength(2);
    expect(pathOf(IconEmojiSprout)).toMatch(/^M[\d. ]+C[\d. ]+C[\d. ]+Z$/);
    expect(pathOf(IconEmojiSprout, 1)).toMatch(/^M[\d. ]+L[\d. ]+$/);
    const leaf = valuesOf(pathOf(IconEmojiSprout));
    const vein = valuesOf(pathOf(IconEmojiSprout, 1));

    expect(leaf).toHaveLength(14);
    expect(vein).toHaveLength(4);
    expect(leaf.slice(12)).toStrictEqual(leaf.slice(0, 2));
    expect(vein[0] + vein[1]).toBe(20);
    expect(vein[2] + vein[3]).toBe(20);
    expect(vein[0]).toBeLessThan(leaf[0]);
    expect(vein[2]).toBeGreaterThan(leaf[0]);
    expect(vein[2]).toBeLessThan(leaf[6]);
    // Signed, because the vein lies on x + y = 20: an unsigned distance is
    // also satisfied by a second curve that retraces the first, leaving no
    // leaf body at all.
    const clearances = [leaf.slice(0, 8), leaf.slice(6)].map(side => {
      const x = (side[0] + 3 * side[2] + 3 * side[4] + side[6]) / 8;
      const y = (side[1] + 3 * side[3] + 3 * side[5] + side[7]) / 8;

      return (x + y - 20) / Math.SQRT2;
    });

    expect(clearances[0] * clearances[1]).toBeLessThan(0);
    for (const clearance of clearances) {
      expect(Math.abs(clearance) - 1.25).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('uses matching flag waves with constant cloth height around the swallowtail', () => {
    expect(pathOf(IconEmojiFlag)).toBe('M4.5 16.5v-13');
    expect(pathOf(IconEmojiFlag, 1)).toMatch(/^M[\d. ]+C[\d. ]+L[\d. ]+L[\d. ]+C[\d. ]+$/);
    const wave = valuesOf(pathOf(IconEmojiFlag, 1));

    expect(wave).toHaveLength(18);
    const height = wave[17] - wave[1];

    expect(height).toBeGreaterThanOrEqual(7.5);
    for (const [top, bottom] of [[0, 16], [2, 14], [4, 12], [6, 10]]) {
      expect(wave[top]).toBe(wave[bottom]);
      expect(wave[bottom + 1] - wave[top + 1]).toBe(height);
    }
    expect(wave[0]).toBe(valuesOf(pathOf(IconEmojiFlag))[0]);
    expect(wave[6] - wave[8]).toBeGreaterThanOrEqual(1.25);
    expect(wave[9]).toBe((wave[7] + wave[11]) / 2);
  });

  it('gives the database three evenly spaced shallow shelves', () => {
    const svg = svgOf(IconDatabase);
    const ellipse = svg.querySelector('ellipse');

    expect(ellipse).not.toBeNull();
    expect(ellipse && attributesOf(ellipse, ['cx', 'cy', 'rx', 'ry'])).toStrictEqual([10, 5.5, 6.5, 2]);
    expect(pathOf(IconDatabase)).toBe('M3.5 5.5v9c0 1.1 2.9 2 6.5 2s6.5-.9 6.5-2v-9');
    expect(pathOf(IconDatabase, 1)).toBe('M3.5 10c0 1.1 2.9 2 6.5 2s6.5-.9 6.5-2');
    const body = valuesOf(pathOf(IconDatabase));
    const middle = valuesOf(pathOf(IconDatabase, 1));

    expect(middle[1] - body[1]).toBe(body[1] + body[2] - middle[1]);
  });

  it('makes merge and split a mirrored pair of shafted arrows', () => {
    expect(pathOf(IconMergeCells)).toBe(pathOf(IconSplitCell));
    expect(pathOf(IconMergeCells, 1)).toBe('M3 10h4M5 8l2 2-2 2');
    expect(pathOf(IconMergeCells, 2)).toBe('M17 10h-4M15 8l-2 2 2 2');
    expect(pathOf(IconSplitCell, 1)).toBe('M7 10H3M5 8l-2 2 2 2');
    expect(pathOf(IconSplitCell, 2)).toBe('M13 10h4M15 8l2 2-2 2');
  });
});
