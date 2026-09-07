import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconChevronRightSmall, IconClearFormat, IconCode, IconCodeBlock, IconDatabase, IconDice,
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

  it('balances the star around its vertical axis with open lower notches', () => {
    const points = valuesOf(pathOf(IconEmojiStar));

    expect(points).toStrictEqual([10, 3.5, 12, 7.5, 16.5, 8.25, 13.25, 11.5, 14, 16, 10, 13.75, 6, 16, 6.75, 11.5, 3.5, 8.25, 8, 7.5]);
    expect(points[8] - points[6]).toBe(points[14] - points[12]);
  });

  it('keeps the smile centered and separated from the eyes', () => {
    const eyes = Array.from(svgOf(IconEmojiSmile).querySelectorAll('circle')).slice(1);

    expect(eyes.map(eye => attributesOf(eye, ['cx', 'cy', 'r']))).toStrictEqual([[7.5, 8, 0.75], [12.5, 8, 0.75]]);
    expect(pathOf(IconEmojiSmile)).toBe('M7 11.5c.75 2 5.25 2 6 0');
    const mouth = valuesOf(pathOf(IconEmojiSmile));
    const eye = eyes.map(element => attributesOf(element, ['cy', 'r']))[0];

    expect(mouth[1] - eye[0] - eye[1] - 0.625).toBeGreaterThan(1.25);
  });

  it('gives the sprout two roomy leaves on one uninterrupted stem', () => {
    expect(pathOf(IconEmojiSprout)).toBe('M10 16.5v-7');
    expect(pathOf(IconEmojiSprout, 1)).toBe('M10 12C6 12 3.5 9.5 3.5 6c4 0 6.5 2.5 6.5 6Z');
    expect(pathOf(IconEmojiSprout, 2)).toBe('M10 9.5C10 5.5 12.5 3.5 16.5 3.5c0 4-2.5 6-6.5 6Z');
  });

  it('uses matching flag waves with constant cloth height', () => {
    expect(pathOf(IconEmojiFlag)).toBe('M4.5 16.5v-13');
    expect(pathOf(IconEmojiFlag, 1)).toBe('M4.5 4C8 1.5 12.5 6.5 16 4v7.5C12.5 14 8 9 4.5 11.5');
    const wave = valuesOf(pathOf(IconEmojiFlag, 1));

    expect(wave[10] - wave[5]).toBe(wave[8]);
    expect(wave[12] - wave[3]).toBe(wave[8]);
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

  it('keeps the dice pips clear of its softer inset frame', () => {
    const svg = svgOf(IconDice);
    const frame = svg.querySelector('rect');

    expect(frame && attributesOf(frame, ['x', 'y', 'width', 'height', 'rx'])).toStrictEqual([2, 2, 10, 10, 2.25]);
    expect(Array.from(svg.querySelectorAll('circle')).map(pip => attributesOf(pip, ['cx', 'cy', 'r']))).toStrictEqual([[4.5, 4.5, 0.8], [7, 7, 0.8], [9.5, 9.5, 0.8]]);
  });

  it('centers the micro disclosure around a 45-degree three-unit skeleton', () => {
    expect(pathOf(IconChevronRightSmall)).toBe('M4.5 3L7.5 6L4.5 9');
  });
});
