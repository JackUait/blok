/**
 * Page icons in the calendar, timeline and feed (research/16 §2): the row's
 * icon sits right before its title, "Show page icon" off drops it, and a row
 * with no icon gets no placeholder.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseCalendarView } from '../../../../src/tools/database/database-calendar-view';
import type { DatabaseCalendarViewOptions } from '../../../../src/tools/database/database-calendar-view';
import { DatabaseTimelineView } from '../../../../src/tools/database/database-timeline-view';
import { DatabaseFeedView } from '../../../../src/tools/database/database-feed-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
];

const rows = (): DatabaseRow[] => [
  { id: 'r1', position: 'a0', icon: '🥌', properties: { 'p-title': 'Alpha', 'p-due': '2026-10-09' } },
  { id: 'r2', position: 'a1', properties: { 'p-title': 'Beta', 'p-due': '2026-10-10' } },
];

const viewOf = (type: DatabaseViewConfig['type'], overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const i18n = { t: (key: string) => key } as unknown as DatabaseCalendarViewOptions['i18n'];

const calendar = (overrides: Partial<DatabaseViewConfig> = {}): HTMLElement => {
  const root = new DatabaseCalendarView({
    readOnly: false,
    i18n,
    view: viewOf('calendar', overrides),
    schema,
    rows: rows(),
    titlePropertyId: 'p-title',
    datePropertyId: 'p-due',
    anchor: '2026-10-09',
    today: '2026-10-09',
    weekStart: 0,
    locale: 'en-US',
    handlers: { openRow: vi.fn(), addRow: vi.fn(), setDate: vi.fn(), navigate: vi.fn() },
  }).createView();

  document.body.appendChild(root);

  return root;
};

const timeline = (overrides: Partial<DatabaseViewConfig> = {}): HTMLElement => {
  const list = rows();
  const root = new DatabaseTimelineView({
    readOnly: false,
    i18n,
    view: viewOf('timeline', overrides),
    schema,
    groups: [{ key: '', label: '', rows: list, total: list.length }],
    grouped: false,
    titlePropertyId: 'p-title',
    startPropertyId: 'p-due',
    endPropertyId: undefined,
    center: '2026-10-09',
    today: '2026-10-09',
    locale: 'en-US',
    handlers: {
      openRow: vi.fn(),
      addRow: vi.fn(),
      writeDates: vi.fn(),
      moveRow: vi.fn(),
      setZoom: vi.fn(),
      openZoomMenu: vi.fn(),
      navigate: vi.fn(),
      toggleTable: vi.fn(),
      loadMore: vi.fn(),
      openCalculationMenu: vi.fn(),
    },
  }).createView();

  document.body.appendChild(root);

  return root;
};

const feed = (overrides: Partial<DatabaseViewConfig> = {}): HTMLElement => {
  const list = rows();
  const root = new DatabaseFeedView({
    view: viewOf('feed', overrides),
    schema,
    rows: list,
    total: list.length,
    titlePropertyId: 'p-title',
    i18n: { t: (key: string) => key },
    locale: 'en-US',
    bodyOf: () => [],
    handlers: { openRow: vi.fn(), loadMore: vi.fn() },
  }).createView();

  document.body.appendChild(root);

  return root;
};

const VIEWS = [
  { name: 'calendar', render: calendar, item: '[data-blok-database-calendar-event]', title: '[data-blok-database-calendar-event-title]' },
  { name: 'timeline', render: timeline, item: '[data-blok-database-timeline-bar]', title: '[data-blok-database-timeline-bar-title]' },
  { name: 'feed', render: feed, item: '[data-blok-database-feed-card]', title: '[data-blok-database-feed-title]' },
];

const itemOf = (root: HTMLElement, selector: string, rowId: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`${selector}[data-row-id="${rowId}"]`);

  if (found === null) {
    throw new Error(`no ${selector} for ${rowId}`);
  }

  return found;
};

describe('page icons in calendar, timeline and feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(VIEWS)('$name shows the row icon right before its title by default', ({ render, item, title }) => {
    const el = itemOf(render(), item, 'r1');
    const icon = el.querySelector<HTMLElement>('[data-blok-database-page-icon]');

    expect(icon?.textContent).toBe('🥌');
    expect(icon?.nextElementSibling).toBe(el.querySelector(title));
  });

  it.each(VIEWS)('$name drops the icon when "Show page icon" is off', ({ render, item }) => {
    const el = itemOf(render({ showPageIcon: false }), item, 'r1');

    expect(el.querySelector('[data-blok-database-page-icon]')).toBeNull();
  });

  it.each(VIEWS)('$name puts no placeholder icon on a row without one', ({ render, item }) => {
    const el = itemOf(render(), item, 'r2');

    expect(el.querySelector('[data-blok-database-page-icon]')).toBeNull();
  });
});
