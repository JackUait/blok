import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { renderCellValue } from '../../../../../src/tools/database/cells';
import type { CellContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';

const ctx = (overrides: Partial<CellContext> = {}): CellContext => ({
  i18n: { t: (key: string) => key },
  locale: 'en-US',
  readOnly: false,
  ...overrides,
});

const url = (extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({ id: 'p', name: 'URL', type: 'url', position: 'a0', ...extra });

const pathOf = (el: HTMLElement): string | undefined => el.querySelector('a [data-blok-database-url-path]')?.textContent ?? undefined;

// notion-spec-2 §18.1, §20.7: the table cell hides the scheme and greys the path; Show full URL draws the path in ink.
describe('URL cell path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the path after the host as the grey part, inside the one link', () => {
    const el = renderCellValue(url(), 'example.com/page', ctx({ shortUrls: true }));

    expect(pathOf(el)).toBe('/page');
    expect(el.querySelector('a')?.textContent).toBe('example.com/page');
  });

  it('keeps a query with the path', () => {
    expect(pathOf(renderCellValue(url(), 'https://example.com/a/b?q=1', ctx({ shortUrls: true })))).toBe('/a/b?q=1');
  });

  it('has no grey part for a bare host', () => {
    expect(pathOf(renderCellValue(url(), 'https://example.com', ctx({ shortUrls: true })))).toBeUndefined();
  });

  // notion-spec-2 §22.1: `www.example.com/` shows as `example.com/`.
  it('drops www. and keeps a lone trailing slash as the grey part', () => {
    const el = renderCellValue(url(), 'https://www.example.com/', ctx({ shortUrls: true }));

    expect(el.querySelector('a')?.textContent).toBe('example.com/');
    expect(pathOf(el)).toBe('/');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://www.example.com/');
  });

  // notion-spec-2 §22.1: a path of 13+ characters shows its first 4, "…", its last 6. The host is never cut.
  it.each([
    ['https://example.com/abc/defg', 'example.com/abc/defg'],
    ['https://example.com/abc/defghij', 'example.com/abc/defghij'],
    ['https://example.com/abc/defghijk', 'example.com/abc…fghijk'],
    ['https://example.com/abc/defg/hijk', 'example.com/abc…g/hijk'],
    ['https://example.com/abc/defg/hijk/lmno/pqrs/tuvw', 'example.com/abc…s/tuvw'],
    ['https://example.com/search?q=notion+database&page=2', 'example.com/sea…page=2'],
    ['https://subdomain.very-long-hostname-for-testing.example.com/a', 'subdomain.very-long-hostname-for-testing.example.com/a'],
    ['https://subdomain.very-long-hostname-for-testing.example.com/abc/defghijk', 'subdomain.very-long-hostname-for-testing.example.com/abc…fghijk'],
  ])('shows %s as %s, the cut path grey, the href whole', (value, shown) => {
    const el = renderCellValue(url(), value, ctx({ shortUrls: true }));
    const link = el.querySelector('a');

    expect(link?.textContent).toBe(shown);
    expect(pathOf(el)).toBe(shown.slice(shown.indexOf('/')));
    expect(link?.getAttribute('href')).toBe(value);
  });

  it('with Show full URL on, draws the whole address in ink, scheme still hidden', () => {
    const el = renderCellValue(url({ url: { showFullUrl: true } }), 'https://example.com/page', ctx({ shortUrls: true }));

    expect(pathOf(el)).toBeUndefined();
    expect(el.querySelector('a')?.textContent).toBe('example.com/page');
  });

  it('leaves a full address outside the table as it is', () => {
    expect(pathOf(renderCellValue(url(), 'https://example.com/page', ctx({ shortUrls: false })))).toBeUndefined();
  });
});
