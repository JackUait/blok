import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (markup: string): Document => new DOMParser().parseFromString(markup, 'image/svg+xml');

/** The shared Blok Line panel: x 3, y 4, 14 x 12, radius 2. */
const hasPanel = (markup: string): boolean => [...parse(markup).querySelectorAll('rect')].some((rect) =>
  rect.getAttribute('x') === '3' && rect.getAttribute('y') === '4'
  && rect.getAttribute('width') === '14' && rect.getAttribute('height') === '12' && rect.getAttribute('rx') === '2');

const paths = (markup: string): string[] => [...parse(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

const glyphs = {
  IconViewFeed: icons.IconViewFeed,
  IconViewCalendar: icons.IconViewCalendar,
  IconViewTimeline: icons.IconViewTimeline,
  IconViewForm: icons.IconViewForm,
  IconForm: icons.IconForm,
  IconDatabaseInline: icons.IconDatabaseInline,
  IconDatabaseLinked: icons.IconDatabaseLinked,
  IconFolderQuestion: icons.IconFolderQuestion,
  IconTemplates: icons.IconTemplates,
};

describe('database creation glyphs drawn after Notion (findings-creation N02, N08, N18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports every glyph on the 20-unit canvas', () => {
    for (const [name, markup] of Object.entries(glyphs)) {
      expect(markup, name).toContain('viewBox="0 0 20 20"');
    }
  });

  it('draws Database - Inline and Linked view apart from each other and from the cylinder', () => {
    expect(icons.IconDatabaseInline).not.toBe(icons.IconDatabaseLinked);
    expect(icons.IconDatabaseInline).not.toBe(icons.IconDatabase);
    expect(icons.IconDatabaseLinked).not.toBe(icons.IconDatabase);
  });

  it('gives the calendar a filled header band over the shared panel', () => {
    expect(hasPanel(icons.IconViewCalendar)).toBe(true);
    expect(parse(icons.IconViewCalendar).querySelector('path[fill="currentColor"]')).not.toBeNull();
  });

  // r9-addview-svgs.raw (viewCalendar): ten equal dots in rows of 3, 4 and 3; the short rows hug opposite sides.
  it('lays the calendar\'s ten dots out like Notion, centred under the band', () => {
    const dots = [...parse(icons.IconViewCalendar).querySelectorAll('circle')].map((dot) => ({
      x: Number(dot.getAttribute('cx')),
      y: Number(dot.getAttribute('cy')),
      r: Number(dot.getAttribute('r')),
    }));
    const rows = [...new Set(dots.map((dot) => dot.y))].sort((a, b) => a - b);
    const columns = [...new Set(dots.map((dot) => dot.x))].sort((a, b) => a - b);
    const inRow = (y: number): number[] => dots.filter((dot) => dot.y === y).map((dot) => dot.x).sort((a, b) => a - b);

    expect(dots).toHaveLength(10);
    expect(new Set(dots.map((dot) => dot.r)).size).toBe(1);
    expect(rows).toHaveLength(3);
    expect(inRow(rows[0] ?? 0)).toEqual(columns.slice(1));
    expect(inRow(rows[1] ?? 0)).toEqual(columns);
    expect(inRow(rows[2] ?? 0)).toEqual(columns.slice(0, 3));
    // Centred across the panel, and in the body between the band (y 8) and the frame's inner edge (y 15.375).
    expect(((columns[0] ?? 0) + (columns[3] ?? 0)) / 2).toBeCloseTo(10);
    expect(((rows[0] ?? 0) + (rows[2] ?? 0)) / 2).toBeCloseTo((8 + 15.375) / 2, 1);
    // Dots stay apart at 16px.
    const r = dots[0]?.r ?? 0;

    expect((columns[1] ?? 0) - (columns[0] ?? 0) - 2 * r).toBeGreaterThanOrEqual(0.8);
    expect((rows[0] ?? 0) - r - 8).toBeGreaterThanOrEqual(0.8);
  });

  // r9-addview-svgs.raw (newspaper): two text lines over a small picture box, inside the sheet.
  it('draws the feed sheet with two lines over a box that shares their left and right edges', () => {
    const doc = parse(icons.IconViewFeed);
    const box = doc.querySelector('rect');

    expect(paths(icons.IconViewFeed)).toContain('M9 6.5h5M9 9h5');
    expect(box?.getAttribute('x')).toBe('9');
    expect(Number(box?.getAttribute('x')) + Number(box?.getAttribute('width'))).toBe(14);
    // One stroke width of clear space between the second line and the box.
    expect(Number(box?.getAttribute('y')) - 9 - 1.25).toBeGreaterThanOrEqual(1.25);
    expect(box?.getAttribute('rx')).toBe('1');
  });

  // r9-addview-menu.png, 81-scratch-form.png (Notion "form"): a sheet, two lines, a pencil over its right edge.
  it('draws the form pencil as IconPencilLine\'s body, clear of the sheet\'s cut right edge', () => {
    const [sheet = '', lines = '', pencil = ''] = paths(icons.IconForm);
    /** Each vertex's offset from the first, so a moved copy compares equal. */
    const offsets = (d: string): number[] => {
      const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

      return nums.map((value, index) => value - (nums[index % 2] ?? 0));
    };
    const lineBody = paths(icons.IconPencilLine)[0] ?? '';

    expect(offsets(pencil)).toEqual(offsets(lineBody));
    expect(lines).toBe('M7 6.5h5M7 9.5h3');
    // The sheet's right edge (x 15) is open where the pencil crosses it, with at least
    // one and a half stroke widths of air to the pencil's edges (x + y = 23.25 and 26.75).
    expect(sheet.startsWith('M15 6.5V5')).toBe(true);
    expect(sheet.endsWith('v-1.5')).toBe(true);
    expect((23.25 - (15 + 6.5)) / Math.SQRT2).toBeGreaterThanOrEqual(1.2);
    expect(((15 + 13.5) - 26.75) / Math.SQRT2).toBeGreaterThanOrEqual(1.2);
  });

  it('draws the timeline as two staggered bars in the shared panel', () => {
    expect(hasPanel(icons.IconViewTimeline)).toBe(true);
    expect(paths(icons.IconViewTimeline)).toEqual(['M6 8.5h5M9 11.5h5']);
  });

  it('keeps the linked view on the table glyph\'s header row and first column', () => {
    const linked = paths(icons.IconDatabaseLinked).join(' ');

    expect(linked).toContain('M3 8h14');
    expect(linked).toContain('M8 4v12');
  });
});
