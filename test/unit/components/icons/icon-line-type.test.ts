import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IconBold, IconItalic, IconMarker, IconUnderline, IconClearFormat, IconStrikethrough,
  IconHeading, IconH1, IconH2, IconH3, IconH4, IconH5, IconH6,
  IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6,
  IconListBulleted, IconListNumbered, IconListChecklist, IconToggleList,
  IconQuote, IconTextSizeSmall, IconTextSizeLarge, IconSuperscript, IconSubscript,
} from '../../../../src/components/icons';

const pathsOf = (icon: string): SVGPathElement[] =>
  Array.from(new DOMParser().parseFromString(icon, 'image/svg+xml').querySelectorAll('path'));

const pathOf = (icon: string, index = 0): string => {
  const path = pathsOf(icon)[index]?.getAttribute('d');

  if (path === undefined || path === null) {
    throw new Error('Missing icon path');
  }

  return path;
};

const headings = [IconH1, IconH2, IconH3, IconH4, IconH5, IconH6];
const toggles = [IconToggleH1, IconToggleH2, IconToggleH3, IconToggleH4, IconToggleH5, IconToggleH6];
const rows = 'M8.5 6.5H16.5M8.5 13.5H16.5';

describe('Blok Line type family', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the approved B with one spine and two open bowls', () => {
    const d = pathOf(IconBold);

    expect(d).toBe('M6.5 5v10M6.5 5h3.75a2.5 2.5 0 0 1 0 5H6.5m0 0h4.25a2.5 2.5 0 0 1 0 5H6.5');
    expect(d.match(/[vV]/g)).toHaveLength(1);
    expect(d).not.toMatch(/[zZ]/);
  });

  it('uses the approved H2 construction across all six heading levels', () => {
    expect(pathOf(IconH2)).toBe('M3.75 5v10M9.75 5v10M3.75 10h6');
    expect(pathOf(IconH2, 1)).toBe('M12.75 11C12.9 10.35 13.45 10 14.15 10C15.05 10 15.65 10.55 15.65 11.35C15.65 12.05 15.25 12.5 14.5 13.15L12.75 15H16');

    for (const icon of headings) {
      expect(pathOf(icon)).toBe(pathOf(IconH2));
      expect(pathsOf(icon)[1]?.getAttribute('stroke-width')).toBe('1.1');
    }
  });

  it('keeps every toggle digit identical to its heading digit and its chevron cap-height', () => {
    for (const [index, icon] of toggles.entries()) {
      expect(pathOf(icon, 1)).toBe(pathOf(headings[index], 1));
      expect(pathOf(icon)).toBe('M5.75 5 9.75 10 5.75 15');
      expect(pathsOf(icon)[1]?.getAttribute('stroke-width')).toBe('1.1');
    }
  });

  it('uses the same cap and baseline for inline letters and the plain heading', () => {
    expect(pathOf(IconItalic)).toBe('M9 5h6m-10 10h6m1-10-4 10');
    expect(pathOf(IconUnderline)).toBe('M6 5v4a4 4 0 0 0 8 0V5');
    expect(pathOf(IconUnderline, 1)).toBe('M5.5 15h9');
    expect(pathOf(IconClearFormat)).toBe('M4 5h8M8 5v10');
    expect(pathOf(IconHeading)).toBe('M7 5v10M13 5v10M7 10h6');
  });

  it('keeps the S on the letterform cap and baseline around its centered strike', () => {
    const all = pathsOf(IconStrikethrough);

    expect(all).toHaveLength(3);
    expect(pathOf(IconStrikethrough)).toBe('M4 10h12');

    const top = pathOf(IconStrikethrough, 1);
    const bottom = pathOf(IconStrikethrough, 2);

    expect(top).toContain('10 5');
    expect(bottom).toContain('10 15');
  });

  it('contains the marker letter inside the shared panel with clear space', () => {
    const doc = new DOMParser().parseFromString(IconMarker, 'image/svg+xml');
    const rect = doc.querySelector('rect');

    expect(rect).not.toBeNull();
    expect(['x', 'y', 'width', 'height', 'rx'].map((attr) => Number(rect?.getAttribute(attr))))
      .toEqual([3, 4, 14, 12, 2]);
    const numbers = pathOf(IconMarker).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const xs = numbers.filter((_value, index) => index % 2 === 0);
    const ys = numbers.filter((_value, index) => index % 2 === 1);

    expect(Math.min(...xs) - 3).toBeGreaterThanOrEqual(2);
    expect(17 - Math.max(...xs)).toBeGreaterThanOrEqual(2);
    expect(Math.min(...ys) - 4).toBeGreaterThanOrEqual(2);
    expect(16 - Math.max(...ys)).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['bulleted', IconListBulleted],
    ['numbered', IconListNumbered],
    ['checklist', IconListChecklist],
    ['toggle', IconToggleList],
  ])('%s list shares exactly two evenly spaced rows', (_name, icon) => {
    expect(pathOf(icon)).toBe(rows);
    const rowPoints = Array.from(pathOf(icon).matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)/g))
      .map((match) => match.slice(1).map(Number));

    expect(rowPoints).toHaveLength(2);
    expect(rowPoints[1][1] - rowPoints[0][1]).toBe(7);
    expect(rowPoints.every(([left, _y, right]) => right - left === 8)).toBe(true);
  });

  it('uses the two approved numbered markers with a lighter optical weight', () => {
    expect(pathOf(IconListNumbered, 1)).toBe('M3.4 5.5 4.8 4.5v4M3 12.3C3.12 11.78 3.56 11.5 4.12 11.5C4.84 11.5 5.32 11.94 5.32 12.58C5.32 13.14 5 13.5 4.4 14.02L3 15.5H5.6');
    expect(pathsOf(IconListNumbered)[1]?.getAttribute('stroke-width')).toBe('1.05');
  });

  it('centers the two bullets beside their rows without crowding the text', () => {
    const doc = new DOMParser().parseFromString(IconListBulleted, 'image/svg+xml');
    const bullets = Array.from(doc.querySelectorAll('circle'));

    expect(bullets).toHaveLength(2);
    expect(bullets.map((bullet) => Number(bullet.getAttribute('cy')))).toEqual([6.5, 13.5]);

    for (const bullet of bullets) {
      const right = Number(bullet.getAttribute('cx')) + Number(bullet.getAttribute('r'));

      expect(8.5 - 0.625 - right).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the approved quote edge and three evenly spaced content lines', () => {
    expect(pathOf(IconQuote)).toBe('M3.5 4.5v11M8 6h8.5M8 10h8.5M8 14h5.5');
  });

  it('uses optically lighter superscript and subscript numerals', () => {
    for (const icon of [IconSuperscript, IconSubscript]) {
      expect(pathsOf(icon)[0]?.getAttribute('stroke-width')).toBe('1.25');
      expect(pathsOf(icon)[1]?.getAttribute('stroke-width')).toBe('1.05');
    }
  });

  it('makes text size choices scaled versions of the same A', () => {
    const outline = (icon: string): number[] =>
      pathOf(icon).split('M').filter(Boolean)[0].match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const large = outline(IconTextSizeLarge);
    const small = outline(IconTextSizeSmall);

    expect(large).toEqual([6, 15, 10, 5, 14, 15]);
    expect(small).toHaveLength(large.length);

    for (const [index, value] of large.entries()) {
      expect(small[index]).toBeCloseTo(10 + (value - 10) * 0.6, 10);
    }
  });
});
