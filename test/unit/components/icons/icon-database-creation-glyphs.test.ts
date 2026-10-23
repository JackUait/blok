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
