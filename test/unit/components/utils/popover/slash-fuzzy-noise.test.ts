import { describe, it, expect } from 'vitest';
import { matchesSearchQuery } from '../../../../../src/components/utils/popover/components/search-input';

// Titles and aliases copied from the real "/" entries (tool toolbox configs and block-color.ts).
const items = {
  boardView: { title: 'Board view', searchTerms: ['board view', 'board', 'kanban', 'database', 'view'] },
  mapView: { title: 'Map view', searchTerms: ['map view', 'map', 'place', 'location', 'database', 'view'] },
  linkedView: { title: 'Linked view', searchTerms: ['linked', 'linked view', 'database', 'view'] },
  databaseInline: { title: 'Database - Inline', searchTerms: ['database', 'inline', 'database inline'] },
  brownBackground: { title: 'Brown background', searchTerms: ['color', 'background', 'brown'] },
  spacer: { title: 'Spacer', searchTerms: ['spacer', 'space', 'gap', 'blank', 'whitespace', 'margin', 'padding'] },
  divider: { title: 'Divider', searchTerms: ['hr', 'line', 'separator', 'rule', '---', 'divider', 'delimiter', 'splitter'] },
  bookmark: { title: 'Bookmark', searchTerms: ['bookmark', 'link', 'url', 'preview', 'card'] },
};

describe('"/" fuzzy search keeps unrelated blocks out', () => {
  it('"/board" does not show Brown background', () => {
    expect(matchesSearchQuery(items.brownBackground, 'board')).toBe(false);
    expect(matchesSearchQuery(items.boardView, 'board')).toBe(true);
  });

  it('"/map" does not show Spacer', () => {
    expect(matchesSearchQuery(items.spacer, 'map')).toBe(false);
    expect(matchesSearchQuery(items.mapView, 'map')).toBe(true);
  });

  it('"/linked" does not show Divider', () => {
    expect(matchesSearchQuery(items.divider, 'linked')).toBe(false);
    expect(matchesSearchQuery(items.linkedView, 'linked')).toBe(true);
    // Notion shows Web bookmark for "/linked" (research/28 §2).
    expect(matchesSearchQuery(items.bookmark, 'linked')).toBe(true);
  });

  it('"/inline" does not show Divider', () => {
    expect(matchesSearchQuery(items.divider, 'inline')).toBe(false);
    expect(matchesSearchQuery(items.databaseInline, 'inline')).toBe(true);
  });

  it('a subsequence may still jump to the start of the next word', () => {
    expect(matchesSearchQuery({ title: 'Table view' }, 'tabvi')).toBe(true);
  });
});
