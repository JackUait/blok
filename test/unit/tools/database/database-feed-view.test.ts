import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseFeedView } from '../../../../src/tools/database/database-feed-view';
import type { FeedViewOptions } from '../../../../src/tools/database/database-feed-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-hidden', name: 'Hidden', type: 'text', position: 'a2' },
];

const view: DatabaseViewConfig = {
  id: 'v1',
  name: 'Feed',
  type: 'feed',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: ['p-notes'],
  properties: [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true }, { id: 'p-hidden', visible: false }],
};

const rows: DatabaseRow[] = [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Launch', 'p-notes': 'Bring cake', 'p-hidden': 'secret' }, meta: { createdBy: 'u1', createdAt: Date.parse('2026-10-09T10:00:00Z') } },
  { id: 'r2', position: 'a1', properties: { 'p-title': '' } },
];

const bodies: Record<string, Array<{ type: string; data: unknown }>> = {
  r1: [
    { type: 'header', data: { text: 'Plan', level: 2 } },
    { type: 'paragraph', data: { text: 'Step <b>one</b>' } },
    { type: 'image', data: { url: 'https://example.com/a.png' } },
    { type: 'image', data: { url: 'javascript:alert(1)' } },
  ],
};

const openRow = vi.fn();
const footer = vi.fn();

const render = (overrides: Partial<FeedViewOptions> = {}): HTMLElement => {
  const el = new DatabaseFeedView({
    view,
    schema,
    rows,
    total: rows.length,
    titlePropertyId: 'p-title',
    i18n: { t: (key: string) => key },
    locale: 'en-US',
    bodyOf: (rowId) => bodies[rowId] ?? [],
    personName: (id) => (id === 'u1' ? 'Ada' : undefined),
    handlers: { openRow, loadMore: vi.fn() },
    ...overrides,
  }).createView();

  document.body.appendChild(el);

  return el;
};

const card = (el: HTMLElement, rowId: string): HTMLElement | null => el.querySelector(`[data-blok-database-feed-card][data-row-id="${rowId}"]`);

describe('DatabaseFeedView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // research/30 B6 measured the date cell only; the feed time keeps "N days ago".
  it('writes a post time three days back as "3 days ago"', () => {
    const el = render({ rows: [{ ...rows[0], meta: { createdBy: 'u1', createdAt: Date.now() - 3 * 86_400_000 } }], total: 1 });

    expect(el.querySelector('[data-blok-database-feed-time]')?.textContent).toBe('3 days ago');
  });

  // research/35 §19: a post made about half an hour ago reads "31m"; research/33 saw "5h" on older ones.
  it.each([[31 * 60_000, '31m'], [5 * 3_600_000 + 10 * 60_000, '5h']])('writes a post %ims old as %s', (age, shown) => {
    const el = render({ rows: [{ ...rows[0], meta: { createdBy: 'u1', createdAt: Date.now() - age } }], total: 1 });

    expect(el.querySelector('[data-blok-database-feed-time]')?.textContent).toBe(shown);
  });

  // research/35 §19: hovering "31m" shows "Created October 22, 2026 at 5:43:51 AM".
  it('the post time hints when the page was made, to the second, after the hint delay', () => {
    destroyTooltip();
    vi.useFakeTimers();
    try {
      const at = new Date(2026, 9, 22, 5, 43, 51);
      const el = render({
        rows: [{ ...rows[0], meta: { createdBy: 'u1', createdAt: at.getTime() } }],
        total: 1,
        i18n: { t: (key: string, vars?: Record<string, string | number>) => `${key}|${String(vars?.date)}|${String(vars?.time)}` },
      });
      const time = el.querySelector<HTMLElement>('[data-blok-database-feed-time]');
      const date = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(at);
      const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(at);

      expect([date, clock.replace(/\s/g, ' ')]).toEqual(['October 22, 2026', '5:43:51 AM']);
      hover(time);
      vi.advanceTimersByTime(HINT_DELAY - 1);
      expect(shownHint()).toBeNull();
      vi.advanceTimersByTime(1);
      expect(shownHint()?.text).toBe(`tools.database.feedCreatedAt|${date}|${clock}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stacks one card per row in a list', () => {
    const el = render();

    expect(el.getAttribute('role')).toBe('list');
    expect([...el.querySelectorAll('[data-blok-database-feed-card]')].map((c) => c.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
  });

  // research/23 §6: an anonymous form answer has no author; its byline says so.
  it('names an anonymous form answer\'s author "Anonymous"', () => {
    const anonymous: DatabaseRow = { id: 'r3', position: 'a2', properties: { 'p-title': 'Resp' }, meta: { anonymous: true, createdAt: Date.parse('2026-10-09T10:00:00Z') } };
    const el = render({ rows: [anonymous], total: 1 });

    expect(card(el, 'r3')?.querySelector('[data-blok-database-feed-author]')?.textContent).toBe('tools.database.personAnonymous');
  });

  it('shows the title, the author byline and only the visible properties', () => {
    const first = card(render(), 'r1');

    expect(first?.querySelector('[data-blok-database-feed-title]')?.textContent).toBe('Launch');
    expect(first?.querySelector('[data-blok-database-feed-author]')?.textContent).toContain('Ada');
    expect(first?.textContent).toContain('Bring cake');
    expect(first?.textContent).not.toContain('secret');
  });

  // research/35 §4: outside the table header a value always hints its name.
  it('a property value hints its name, after the hint delay, with no native title', () => {
    destroyTooltip();
    vi.useFakeTimers();
    try {
      const el = render();
      const prop = card(el, 'r1')?.querySelector<HTMLElement>('[data-blok-database-feed-property][data-property-id="p-notes"]');

      expect(prop?.title).toBe('');
      hover(prop);
      vi.advanceTimersByTime(HINT_DELAY);
      expect(shownHint()).toEqual({ text: 'Notes', placement: 'left' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the page content read-only, as text, with safe images only', () => {
    const body = card(render(), 'r1')?.querySelector('[data-blok-database-feed-body]');

    expect(body?.querySelector('[data-level="h2"]')?.textContent).toBe('Plan');
    expect(body?.textContent).toContain('Step one');
    expect(body?.querySelector('b')).toBeNull();
    expect([...(body?.querySelectorAll('img') ?? [])].map((img) => img.getAttribute('src'))).toEqual(['https://example.com/a.png']);
    expect(body?.querySelector('[contenteditable]')).toBeNull();
  });

  it('opens the row from its title', () => {
    card(render(), 'r1')?.querySelector<HTMLElement>('[data-blok-database-feed-title]')?.click();

    expect(openRow).toHaveBeenCalledWith('r1');
  });

  it('shows a placeholder for an untitled row', () => {
    expect(card(render(), 'r2')?.querySelector('[data-blok-database-feed-title]')?.getAttribute('data-placeholder')).toBe('tools.database.cardTitlePlaceholder');
  });

  it('offers Load more when the view holds more rows than it shows', () => {
    const loadMore = vi.fn();
    const el = render({ total: 5, handlers: { openRow, loadMore } });

    el.querySelector<HTMLElement>('[data-blok-database-feed-more]')?.click();
    expect(loadMore).toHaveBeenCalled();
    expect(render().querySelector('[data-blok-database-feed-more]')).toBeNull();
  });

  it('hands each card a footer slot to the host, for comments and reactions', () => {
    const destroy = vi.fn();

    footer.mockReturnValue(destroy);
    const feed = new DatabaseFeedView({
      view, schema, rows, total: 2, titlePropertyId: 'p-title', i18n: { t: (k: string) => k }, locale: 'en-US',
      bodyOf: () => [], handlers: { openRow, loadMore: vi.fn() }, footer,
    });

    feed.createView();
    expect(footer).toHaveBeenCalledWith(expect.objectContaining({ rowId: 'r1', holder: expect.any(HTMLElement) }));
    feed.destroy();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
