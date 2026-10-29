import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTimelineView } from '../../../../src/tools/database/database-timeline-view';
import type { DatabaseTimelineViewOptions, TimelineGroup, TimelineHandlers } from '../../../../src/tools/database/database-timeline-view';
import { TIMELINE_DAY_WIDTH, timelineWindow } from '../../../../src/tools/database/timeline-dates';
import { daysBetween } from '../../../../src/tools/database/calendar-dates';
import { IconArrowLeftSmall, IconArrowRightSmall, IconChevronDoubleRight } from '../../../../src/components/icons';
import { hide, showReadout } from '../../../../src/components/utils/tooltip';
import type * as Tooltip from '../../../../src/components/utils/tooltip';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';

/** An icon string as the DOM serializes it once it is set as innerHTML. */
const markup = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  showReadout: vi.fn(),
  hide: vi.fn(),
}));

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-end', name: 'End', type: 'date', position: 'a2' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a3' },
];

const row = (id: string, title: string, due: string | null, extra: DatabaseRow['properties'] = {}): DatabaseRow =>
  ({ id, position: id, properties: { 'p-title': title, 'p-due': due, ...extra } });

const timelineView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Timeline', type: 'timeline', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const makeHandlers = (): TimelineHandlers => ({
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
});

const i18n = { t: (key: string) => key } as unknown as DatabaseTimelineViewOptions['i18n'];

const CENTER = '2026-10-09';

const rows = (): DatabaseRow[] => [
  row('r1', 'Launch', '2026-10-09'),
  row('r2', 'Trip', '2026-10-12/2026-10-14', { 'p-notes': 'Bring snacks' }),
  row('r3', 'Someday', null),
];

const single = (list: DatabaseRow[]): TimelineGroup[] => [{ key: '', label: '', rows: list, total: list.length }];

interface Mounted {
  root: HTMLElement;
  handlers: TimelineHandlers;
  view: DatabaseTimelineView;
}

const mount = (overrides: Partial<DatabaseTimelineViewOptions> = {}): Mounted => {
  const handlers = makeHandlers();
  const view = new DatabaseTimelineView({
    readOnly: false,
    i18n,
    view: timelineView(),
    schema,
    groups: single(rows()),
    grouped: false,
    titlePropertyId: 'p-title',
    startPropertyId: 'p-due',
    endPropertyId: undefined,
    center: CENTER,
    today: CENTER,
    locale: 'en-US',
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers, view };
};

const bars = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-bar]')];
const bar = (root: HTMLElement, rowId: string): HTMLElement => {
  const found = bars(root).find((el) => el.getAttribute('data-row-id') === rowId);

  if (found === undefined) {
    throw new Error(`no bar ${rowId}`);
  }

  return found;
};
const canvas = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>('[data-blok-database-timeline-canvas]');

  if (el === null) {
    throw new Error('no canvas');
  }

  return el;
};
const scroller = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>('[data-blok-database-timeline-scroller]');

  if (el === null) {
    throw new Error('no scroller');
  }

  return el;
};

const rect = (el: HTMLElement, left: number, top: number, width: number, height: number): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  });
};

const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
};

const key = (target: EventTarget, name: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

const shiftKey = (target: EventTarget, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey: true, bubbles: true, cancelable: true }));
};

const windowStart = timelineWindow(CENTER, 'month').start;
/** Pixels from the canvas start to the start of `day` at month zoom. */
const px = (day: string): number => daysBetween(windowStart, day) * TIMELINE_DAY_WIDTH.month;

describe('DatabaseTimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('layout', () => {
    it('draws one row per dated item with the table hidden, and a bar sized by its days', () => {
      const { root } = mount();
      const width = TIMELINE_DAY_WIDTH.month;

      // findings C03: an undated item has no lane while the table is hidden.
      expect([...root.querySelectorAll('[data-blok-database-timeline-row]')].map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
      expect(bars(root).map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
      // findings C23: 1.5px in from each day edge.
      expect(bar(root, 'r2').style.width).toBe(`${3 * width - 3}px`);
      expect(bar(root, 'r2').style.insetInlineStart).toBe(`${px('2026-10-12') + 1.5}px`);
    });

    it('marks the zoom level and draws the canvas as wide as the window', () => {
      const { root } = mount({ view: timelineView({ timelineZoom: 'year' }) });
      const window = timelineWindow(CENTER, 'year');

      expect(root.getAttribute('data-zoom')).toBe('year');
      expect(canvas(root).style.width).toBe(`${window.days * TIMELINE_DAY_WIDTH.year}px`);
    });

    it('places bars from a start and a separate end property', () => {
      const { root } = mount({
        endPropertyId: 'p-end',
        groups: single([row('r1', 'Build', '2026-10-05', { 'p-end': '2026-10-08' })]),
      });

      expect(bar(root, 'r1').style.width).toBe(`${4 * TIMELINE_DAY_WIDTH.month - 3}px`);
    });

    it('shows the title and the visible properties on a bar, and skips empty ones', () => {
      const { root } = mount({ view: timelineView({ properties: [{ id: 'p-notes', visible: true }] }) });

      expect(bar(root, 'r2').querySelector('[data-blok-database-timeline-bar-title]')?.textContent).toBe('Trip');
      expect(bar(root, 'r2').querySelector('[data-property-id="p-notes"]')?.textContent).toContain('Bring snacks');
      expect(bar(root, 'r1').querySelector('[data-property-id="p-notes"]')).toBeNull();
    });

    // notion-spec-2 §21.9 (timeline-bar.png): after a bar a person is the avatar alone, as in a list row.
    it('shows a person after a bar as the avatar alone, the name kept for screen readers', () => {
      const withOwner: PropertyDefinition[] = [...schema, { id: 'p-own', name: 'Owner', type: 'person', position: 'a4' }];
      const { root } = mount({
        schema: withOwner,
        view: timelineView({ properties: [{ id: 'p-own', visible: true }] }),
        groups: single([row('r1', 'Launch', '2026-10-09', { 'p-own': [{ id: 'u1' }] })]),
        cellContext: { people: [{ id: 'u1', name: 'Ada' }] },
      });
      const chip = bar(root, 'r1').querySelector('[data-property-id="p-own"] [data-blok-database-person-chip]');

      expect(chip?.querySelector('[data-blok-database-sr-only]')?.textContent).toBe('Ada');
      expect([...(chip?.childNodes ?? [])].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')).toBe(false);
    });

    // notion-spec-2 §21.9 (timeline-bar.png): a file chip after a bar starts with the page glyph.
    it('starts a file chip after a bar with the page glyph', () => {
      const withFiles: PropertyDefinition[] = [...schema, { id: 'p-files', name: 'Files', type: 'files', position: 'a4' }];
      const { root } = mount({
        schema: withFiles,
        view: timelineView({ properties: [{ id: 'p-files', visible: true }] }),
        groups: single([row('r1', 'Launch', '2026-10-09', { 'p-files': [{ id: 'f1', name: 'notes.pdf', url: 'https://example.com/notes.pdf' }] })]),
      });
      const chip = bar(root, 'r1').querySelector('[data-property-id="p-files"] [data-blok-database-file-chip]');

      expect(chip?.firstElementChild?.hasAttribute('data-blok-database-file-chip-icon')).toBe(true);
    });

    it('labels today\'s dot with the locale\'s day number', () => {
      const { root } = mount({ locale: 'ar-EG' });

      expect(root.querySelector('[data-blok-database-timeline-today-dot]')?.textContent)
        .toBe(new Intl.DateTimeFormat('ar-EG', { day: 'numeric' }).format(new Date(2026, 9, 9)));
    });

    it('marks today on the date axis', () => {
      const { root } = mount();
      const marker = root.querySelector<HTMLElement>('[data-blok-database-timeline-today-line]');

      expect(marker?.style.insetInlineStart).toBe(`${px(CENTER) + 20}px`);
    });

    it('shades weekends at day-level zoom and not at year zoom', () => {
      expect(mount().root.querySelectorAll('[data-blok-database-timeline-weekend]').length).toBeGreaterThan(0);
      document.body.innerHTML = '';
      expect(mount({ view: timelineView({ timelineZoom: 'year' }) }).root.querySelectorAll('[data-blok-database-timeline-weekend]')).toHaveLength(0);
    });

    it('says so when the database has no date property', () => {
      const { root } = mount({ startPropertyId: undefined });

      expect(root.querySelector('[data-blok-database-timeline-empty]')?.textContent).toBe('tools.database.timelineNoDateProperty');
      expect(bars(root)).toHaveLength(0);
    });

    it('draws a group header with its count before each group\'s rows', () => {
      const option: SelectOption = { id: 'o1', label: 'Doing', color: 'blue', position: 'a0' };
      const { root } = mount({
        grouped: true,
        groups: [
          { key: 'o1', label: 'Doing', option, rows: [row('r1', 'Launch', CENTER)], total: 1 },
          { key: 'none', label: 'No Status', rows: [], total: 0 },
        ],
      });
      const headers = [...root.querySelectorAll('[data-blok-database-timeline-group]')];

      expect(headers.map((h) => h.getAttribute('data-group-key'))).toEqual(['o1', 'none']);
      expect(headers[0].querySelector('[data-blok-database-timeline-group-count]')?.textContent).toBe('1');
    });

    it('offers "Load more" when a group has more rows than shown', () => {
      const { root, handlers } = mount({ groups: [{ key: '', label: '', rows: rows().slice(0, 2), total: 5 }] });
      const more = root.querySelector<HTMLElement>('[data-blok-database-timeline-load-more]');

      more?.click();
      expect(handlers.loadMore).toHaveBeenCalledWith('');
    });
  });

  describe('table panel', () => {
    it('keeps an undated item\'s empty lane while the table shows, so panel rows and lanes line up (findings C03)', () => {
      const { root } = mount({ view: timelineView({ showTimelineTable: true }) });

      expect([...root.querySelectorAll('[data-blok-database-timeline-row]')].map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2', 'r3']);
    });

    // findings C14: "Aa Name" headers, page icons on the rows, "+ New" as the panel's last row.
    it('draws each header with its type glyph and each title with its page icon', () => {
      const { root } = mount({ view: timelineView({ showTimelineTable: true }) });
      const header = root.querySelector('[data-blok-database-timeline-table-header] [data-property-id="p-title"]');
      const title = root.querySelector('[data-blok-database-timeline-table-row][data-row-id="r1"] [data-blok-database-timeline-table-title]');

      expect(header?.querySelector('[data-blok-database-timeline-table-header-icon] svg')).not.toBeNull();
      expect(header?.textContent?.trim()).toBe('Name');
      expect(title?.firstElementChild?.hasAttribute('data-blok-database-page-icon-placeholder')).toBe(true);
    });

    it('ends the panel with "+ New", and the canvas lane beside it stays empty', () => {
      const { root, handlers } = mount({ view: timelineView({ showTimelineTable: true }) });
      const add = root.querySelector<HTMLElement>('[data-blok-database-timeline-table] [data-blok-database-timeline-table-new]');

      expect(add?.nextElementSibling?.hasAttribute('data-blok-database-timeline-table-footer')).toBe(true);
      expect(root.querySelector('[data-blok-database-timeline-new-lane] [data-blok-database-timeline-new]')).toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-new-lane]')).not.toBeNull();
      add?.click();
      expect(handlers.addRow).toHaveBeenCalledWith(null, { start: '2026-10-09/2026-10-13' });
    });

    it('is hidden by default and its toggle asks to show it', () => {
      const { root, handlers } = mount();
      const toggle = root.querySelector<HTMLElement>('[data-blok-database-timeline-table-toggle]');

      expect(root.querySelector('[data-blok-database-timeline-table]')).toBeNull();
      expect(toggle?.getAttribute('aria-pressed')).toBe('false');
      toggle?.click();
      expect(handlers.toggleTable).toHaveBeenCalled();
    });

    it('lists the table properties, not the bar properties, with one row per item', () => {
      const { root } = mount({
        view: timelineView({
          showTimelineTable: true,
          properties: [{ id: 'p-notes', visible: true }],
          tableProperties: [{ id: 'p-due', visible: true }],
        }),
      });
      const table = root.querySelector('[data-blok-database-timeline-table]');
      const headers = [...(table?.querySelectorAll('[data-blok-database-timeline-table-header] [data-property-id]') ?? [])];

      expect(headers.map((h) => h.getAttribute('data-property-id'))).toEqual(['p-title', 'p-due']);
      expect(table?.querySelectorAll('[data-blok-database-timeline-table-row]')).toHaveLength(3);
      expect(root.querySelector('[data-blok-database-timeline-table-toggle]')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('ends with a calculation footer that reuses the table footer cells', () => {
      const { root } = mount({ view: timelineView({ showTimelineTable: true, calculations: [{ id: 'p-title', fn: 'count' }] }) });
      const footer = root.querySelector('[data-blok-database-timeline-table] [data-blok-database-timeline-table-footer]');
      const title = footer?.querySelector('[data-blok-database-table-calc][data-property-id="p-title"]');

      expect(title?.querySelector('[data-blok-database-table-calc-label]')?.textContent).toBe('tools.database.calcCountAll');
      expect(title?.querySelector('[data-blok-database-table-calc-value]')?.textContent).toBe('3');
    });

    it('asks to pick a calculation from an empty footer cell, and not when read-only', () => {
      const { root, handlers } = mount({ view: timelineView({ showTimelineTable: true, tableProperties: [{ id: 'p-due', visible: true }] }) });
      const cell = root.querySelector<HTMLElement>('[data-blok-database-timeline-table-footer] [data-property-id="p-due"]');

      expect(cell?.querySelector('[data-blok-database-table-calc-placeholder]')?.textContent).toBe('tools.database.tableCalculate');
      cell?.click();
      expect(handlers.openCalculationMenu).toHaveBeenCalledWith(cell, 'p-due');

      const readOnly = mount({ readOnly: true, view: timelineView({ showTimelineTable: true }) });

      expect(readOnly.root.querySelector('[data-blok-database-timeline-table-footer] button')).toBeNull();
    });

    it('opens a row from its title in the table panel', () => {
      const { root, handlers } = mount({ view: timelineView({ showTimelineTable: true }) });

      root.querySelector<HTMLElement>('[data-blok-database-timeline-table-row][data-row-id="r2"] [data-blok-database-timeline-table-title]')?.click();
      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });

    it('opens a row from anywhere in its title cell, and renames it without dropping its comment badge', () => {
      const commentBadges = { databaseId: 'db', count: (rowId: string) => (rowId === 'r2' ? 1 : 0), open: vi.fn() };
      const { root, handlers, view } = mount({ view: timelineView({ showTimelineTable: true }), commentBadges });
      const cell = root.querySelector<HTMLElement>('[data-blok-database-timeline-table-row][data-row-id="r2"] [data-property-id="p-title"]');

      cell?.click();
      expect(handlers.openRow).toHaveBeenCalledWith('r2');

      view.updateRowTitle(root, 'r2', 'Holiday');
      expect(cell?.textContent).toContain('Holiday');
      expect(cell?.querySelector('[data-blok-database-comment-badge]')).not.toBeNull();
    });
  });

  describe('toolbar', () => {
    it('opens the zoom menu and goes to today', () => {
      const { root, handlers } = mount();
      const zoom = root.querySelector<HTMLElement>('[data-blok-database-timeline-zoom]');

      expect(zoom?.textContent?.trim()).toBe('tools.database.timelineZoomMonth');
      zoom?.click();
      expect(handlers.openZoomMenu).toHaveBeenCalledWith(zoom);
      root.querySelector<HTMLElement>('[data-blok-database-timeline-today]')?.click();
      expect(handlers.navigate).toHaveBeenCalledWith(CENTER);
    });

    it('shows "Manage in Calendar" before the zoom when the host gives it, and calls it on click (research/26 §4d)', () => {
      const manage = vi.fn();
      const { root } = mount({ readOnly: true, handlers: undefined, manageInCalendar: { label: 'Manage in Calendar', onClick: manage } });
      const button = root.querySelector<HTMLElement>('[data-blok-database-timeline-manage-calendar]');

      expect(button?.textContent?.trim()).toBe('Manage in Calendar');
      // research/30 B4: the calendar icon only; the "leaves this app" arrow is on the View settings row alone.
      expect(button?.querySelectorAll('svg')).toHaveLength(1);
      expect(button?.nextElementSibling?.hasAttribute('data-blok-database-timeline-zoom')).toBe(true);
      button?.click();
      expect(manage).toHaveBeenCalledTimes(1);
    });

    // findings C05: » toggle, the shown month, then Month ⌄ · ‹ · Today · ›.
    it('draws Notion\'s parts in order: » toggle, the month, the zoom with a chevron, ‹ Today ›', () => {
      const { root } = mount();
      const bar = root.querySelector('[data-blok-database-timeline-toolbar]');
      const order = [...(bar?.children ?? [])].map((el) => [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-blok-database-timeline-')));

      expect(order).toEqual([
        'data-blok-database-timeline-table-toggle',
        'data-blok-database-timeline-month',
        'data-blok-database-timeline-toolbar-spacer',
        'data-blok-database-timeline-zoom',
        'data-blok-database-timeline-prev',
        'data-blok-database-timeline-today',
        'data-blok-database-timeline-next',
      ]);
      expect(root.querySelector('[data-blok-database-timeline-table-toggle]')?.innerHTML).toBe(markup(IconChevronDoubleRight));
      expect(root.querySelector('[data-blok-database-timeline-zoom] svg')).not.toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-prev]')?.getAttribute('aria-label')).toBe('tools.database.timelinePrevious');
      expect(root.querySelector('[data-blok-database-timeline-next]')?.getAttribute('aria-label')).toBe('tools.database.timelineNext');
    });

    it('names the month at the screen\'s start, and follows a scroll', () => {
      const { root, view } = mount();
      const month = (): string | null | undefined => root.querySelector('[data-blok-database-timeline-month]')?.textContent;

      expect(month()).toBe('October 2026');
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = px('2026-11-02');
      view.refreshOffscreen();
      expect(month()).toBe('November 2026');
    });

    it('‹ and › scroll by one screen', () => {
      const { root } = mount();
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = 1000;
      root.querySelector<HTMLElement>('[data-blok-database-timeline-next]')?.click();
      expect(el.scrollLeft).toBe(1400);
      root.querySelector<HTMLElement>('[data-blok-database-timeline-prev]')?.click();
      expect(el.scrollLeft).toBe(1000);
    });

    it('has no month row in the header at day-level zooms, and keeps it at quarter zoom (findings C06)', () => {
      expect(mount().root.querySelector('[data-blok-database-timeline-groups]')).toBeNull();
      document.body.innerHTML = '';
      expect(mount({ view: timelineView({ timelineZoom: 'quarter' }) }).root.querySelector('[data-blok-database-timeline-groups]')).not.toBeNull();
    });

    it('has no "Manage in Calendar" without the host lever', () => {
      const { root } = mount();

      expect(root.querySelector('[data-blok-database-timeline-manage-calendar]')).toBeNull();
    });

    // findings C07: "+ New" is the canvas's last lane and makes a 5-day bar.
    it('puts "+ New" in a lane at the end of the canvas, and adds a 5-day bar from it', () => {
      const { root, handlers } = mount();
      const button = root.querySelector<HTMLElement>('[data-blok-database-timeline-new]');

      expect(canvas(root).lastElementChild?.hasAttribute('data-blok-database-timeline-new-lane')).toBe(true);
      expect(button?.closest('[data-blok-database-timeline-new-lane]')).not.toBeNull();
      button?.click();
      expect(handlers.addRow).toHaveBeenCalledWith(null, { start: '2026-10-09/2026-10-13' });
    });

    it('names a new bar in place: Enter keeps it selected, Escape keeps the name and drops the selection', () => {
      const renameRow = vi.fn();
      const pickRow = vi.fn();
      const { root, view } = mount({ handlers: { ...makeHandlers(), renameRow, pickRow } });

      view.editTitle('r1');
      const input = bar(root, 'r1').querySelector('input');

      expect(input?.placeholder).toBe('tools.database.cardNamePlaceholder');
      expect(input).toHaveFocus();
      if (input === null) throw new Error('no input');
      input.value = 'Kappa';
      key(input, 'Enter');
      expect(renameRow).toHaveBeenCalledWith('r1', 'Kappa');
      expect(pickRow).toHaveBeenCalledWith('r1', false);

      view.editTitle('r2');
      const second = bar(root, 'r2').querySelector('input');

      if (second === null) throw new Error('no input');
      second.value = 'Lambda';
      key(second, 'Escape');
      expect(renameRow).toHaveBeenCalledWith('r2', 'Lambda');
      expect(pickRow).toHaveBeenCalledTimes(1);
    });

    it('has no "+ New", resize handles or drag handles when read-only', () => {
      const { root } = mount({ readOnly: true });

      expect(root.querySelector('[data-blok-database-timeline-new]')).toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-resize]')).toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-row-handle]')).toBeNull();
    });
  });

  describe('opening and keyboard', () => {
    it('opens a bar on click and on Enter', () => {
      const { root, handlers } = mount();

      bar(root, 'r1').click();
      expect(handlers.openRow).toHaveBeenCalledWith('r1');
      key(bar(root, 'r2'), 'Enter');
      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });

    it('owns its keyboard and makes one bar tabbable', () => {
      const { root } = mount();

      expect(scroller(root).hasAttribute('data-blok-keyboard-owner')).toBe(true);
      expect(bars(root).map((el) => el.tabIndex)).toEqual([0, -1]);
    });

    it('moves between bars with Up and Down', () => {
      const { root } = mount();

      bar(root, 'r1').focus();
      key(bar(root, 'r1'), 'ArrowDown');
      expect(bar(root, 'r2')).toHaveFocus();
      key(bar(root, 'r2'), 'ArrowUp');
      expect(bar(root, 'r1')).toHaveFocus();
    });

    it('selects the bar Up and Down reach, and Shift extends the selection, as the list does (findings K10)', () => {
      const lassoRows = vi.fn();
      const { root } = mount({ handlers: { ...makeHandlers(), lassoRows } });

      bar(root, 'r1').focus();
      key(bar(root, 'r1'), 'ArrowDown');
      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);
      shiftKey(bar(root, 'r2'), 'ArrowUp');
      expect(bar(root, 'r1')).toHaveFocus();
      expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2']);
      key(bar(root, 'r1'), 'ArrowDown');
      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);
    });

    it('selects nothing in a read-only timeline', () => {
      const lassoRows = vi.fn();
      const { root } = mount({ readOnly: true, handlers: { ...makeHandlers(), lassoRows } });

      key(bar(root, 'r1'), 'ArrowDown');
      expect(bar(root, 'r2')).toHaveFocus();
      expect(lassoRows).not.toHaveBeenCalled();
    });

    it('leaves the canvas and the selection alone on Left and Right: panning is Shift+wheel and drag (findings K10)', () => {
      const lassoRows = vi.fn();
      const { root } = mount({ handlers: { ...makeHandlers(), lassoRows } });
      const el = scroller(root);

      el.scrollLeft = 500;
      expect(key(el, 'ArrowRight').defaultPrevented).toBe(true);
      expect(el.scrollLeft).toBe(500);
      expect(key(bar(root, 'r1'), 'ArrowLeft').defaultPrevented).toBe(true);
      expect(el.scrollLeft).toBe(500);
      expect(lassoRows).not.toHaveBeenCalled();
    });

    it('zooms in with + or = and out with -', () => {
      const { root, handlers } = mount();

      key(scroller(root), '+');
      expect(handlers.setZoom).toHaveBeenLastCalledWith('bi_week');
      key(scroller(root), '=');
      expect(handlers.setZoom).toHaveBeenLastCalledWith('bi_week');
      key(scroller(root), '-');
      expect(handlers.setZoom).toHaveBeenLastCalledWith('quarter');
    });

    it('leaves keys alone with a modifier, so browser zoom still works', () => {
      const { root, handlers } = mount();
      const event = new KeyboardEvent('keydown', { key: '+', metaKey: true, bubbles: true, cancelable: true });

      scroller(root).dispatchEvent(event);
      expect(handlers.setZoom).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('"No date" (findings C03)', () => {
    const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid="database-no-date"]');
    const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-no-date-row]')];
    const openPanel = (view: DatabaseTimelineView): void => {
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);
      view.noDateControl()?.open(anchor);
    };
    /** The screen starts on Oct 14, as in the measured Notion timeline. */
    const showFrom = (root: HTMLElement, view: DatabaseTimelineView): void => {
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 720, configurable: true });
      el.scrollLeft = px('2026-10-14');
      view.refreshOffscreen();
    };

    it('counts the undated items for the database toolbar, and has none when read-only or when all are dated', () => {
      expect(mount().view.noDateControl()?.count).toBe(1);
      expect(mount().view.noDateControl()?.label).toBe('tools.database.calendarNoDate');
      expect(mount({ readOnly: true }).view.noDateControl()).toBeUndefined();
      expect(mount({ groups: single([row('r1', 'Launch', CENTER)]) }).view.noDateControl()).toBeUndefined();
    });

    it('lists them with the timeline hint, and "Open" opens one', () => {
      const { view, handlers } = mount();

      openPanel(view);
      expect(panel()?.textContent).toContain('tools.database.timelineNoDateHint');
      expect(items().map((el) => el.getAttribute('data-row-id'))).toEqual(['r3']);
      items()[0].querySelector<HTMLElement>('[data-blok-database-no-date-open]')?.click();
      expect(handlers.openRow).toHaveBeenCalledWith('r3');
    });

    it('a click puts the item on the timeline as a 5-day bar from the second shown day', () => {
      const { root, view, handlers } = mount();

      showFrom(root, view);
      openPanel(view);
      items()[0].click();
      expect(handlers.writeDates).toHaveBeenCalledWith('r3', { start: '2026-10-15/2026-10-19' });
    });

    it('writes the start and end properties when the bar has both', () => {
      const { root, view, handlers } = mount({ endPropertyId: 'p-end' });

      showFrom(root, view);
      openPanel(view);
      items()[0].click();
      expect(handlers.writeDates).toHaveBeenCalledWith('r3', { start: '2026-10-15', end: '2026-10-19' });
    });
  });

  describe('off-screen arrows', () => {
    it('shows an arrow on a row whose bar is before or after the screen, and jumps to it', () => {
      const { root, handlers, view } = mount({
        groups: single([row('r1', 'Early', '2026-09-02'), row('r2', 'Late', '2027-03-01'), row('r3', 'Now', CENTER)]),
      });
      const start = px('2026-10-05');
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = start;
      view.refreshOffscreen();

      const arrow = (rowId: string, side: string): HTMLElement | null =>
        root.querySelector<HTMLElement>(`[data-blok-database-timeline-row][data-row-id="${rowId}"] [data-blok-database-timeline-offscreen="${side}"]`);

      expect(arrow('r1', 'before')?.hidden).toBe(false);
      expect(arrow('r2', 'after')?.hidden).toBe(false);
      expect(arrow('r3', 'before')?.hidden).toBe(true);
      expect(arrow('r3', 'after')?.hidden).toBe(true);

      arrow('r1', 'before')?.click();
      expect(el.scrollLeft).toBeLessThan(start);

      arrow('r2', 'after')?.click();
      expect(handlers.navigate).toHaveBeenCalledWith('2027-03-01');
    });

    // findings C17: a bar cut by the screen's start keeps a "←" chip before its title.
    it('marks a bar that starts before the screen and still shows, and its chip jumps to its start', () => {
      const { root, view } = mount();
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = px('2026-10-13');
      view.refreshOffscreen();

      expect(bar(root, 'r2').hasAttribute('data-clipped-start')).toBe(true);
      expect(bar(root, 'r1').hasAttribute('data-clipped-start')).toBe(false);
      const chip = bar(root, 'r2').querySelector<HTMLElement>('[data-blok-database-timeline-bar-chip]');

      expect(chip?.nextElementSibling?.hasAttribute('data-blok-database-timeline-bar-title')).toBe(true);
      chip?.click();
      expect(el.scrollLeft).toBeLessThan(px('2026-10-13'));
    });

    // research/26 §4d: Notion draws a straight arrow in the chip, not a chevron.
    it('draws a straight arrow pointing to the side the bar is on', () => {
      const { root } = mount({ groups: single([row('r1', 'Early', '2026-09-02')]) });
      const glyph = (side: string): string | undefined =>
        root.querySelector(`[data-blok-database-timeline-offscreen="${side}"]`)?.innerHTML;

      expect(glyph('before')).toBe(markup(IconArrowLeftSmall));
      expect(glyph('after')).toBe(markup(IconArrowRightSmall));
    });
  });

  describe('dragging bars', () => {
    const layOut = (root: HTMLElement): void => {
      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
    };
    const xOf = (day: string): number => px(day) + 20;

    it('moves a bar by the days it is dragged', () => {
      const { root, handlers } = mount();

      layOut(root);
      pointer('pointerdown', bar(root, 'r2'), xOf('2026-10-12'), 50);
      pointer('pointermove', document, xOf('2026-10-14'), 50);
      pointer('pointerup', document, xOf('2026-10-14'), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r2', { start: '2026-10-14/2026-10-16' });
    });

    it('moves a timed bar by the hours it is dragged when zoomed to hours', () => {
      const hoursStart = timelineWindow(CENTER, 'hours').start;
      const hourPx = TIMELINE_DAY_WIDTH.hours / 24;
      const xAt = (hour: number): number => daysBetween(hoursStart, CENTER) * TIMELINE_DAY_WIDTH.hours + hour * hourPx + 5;
      const { root, handlers } = mount({
        view: timelineView({ timelineZoom: 'hours' }),
        groups: single([row('r1', 'Call', '2026-10-09T09:00')]),
      });

      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'hours').days * TIMELINE_DAY_WIDTH.hours, 400);

      expect(bar(root, 'r1').style.insetInlineStart).toBe(`${daysBetween(hoursStart, CENTER) * TIMELINE_DAY_WIDTH.hours + 9 * hourPx}px`);

      pointer('pointerdown', bar(root, 'r1'), xAt(9), 50);
      pointer('pointermove', document, xAt(12), 50);
      pointer('pointerup', document, xAt(12), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T12:00' });
    });

    it('drags the end edge to a later day', () => {
      const { root, handlers } = mount();
      const handle = bar(root, 'r1').querySelector('[data-blok-database-timeline-resize="end"]');

      layOut(root);
      if (handle === null) throw new Error('no handle');
      pointer('pointerdown', handle, xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-11'), 50);
      pointer('pointerup', document, xOf('2026-10-11'), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09/2026-10-11' });
    });

    it('drags the start edge of a two-property bar and writes only the start', () => {
      const { root, handlers } = mount({
        endPropertyId: 'p-end',
        groups: single([row('r1', 'Build', '2026-10-05', { 'p-end': '2026-10-08' })]),
      });
      const handle = bar(root, 'r1').querySelector('[data-blok-database-timeline-resize="start"]');

      layOut(root);
      if (handle === null) throw new Error('no handle');
      pointer('pointerdown', handle, xOf('2026-10-05'), 50);
      pointer('pointermove', document, xOf('2026-10-03'), 50);
      pointer('pointerup', document, xOf('2026-10-03'), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-03' });
    });

    it('does not open the bar after a drag, and still opens on the next click', async () => {
      const { root, handlers } = mount();

      layOut(root);
      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-10'), 50);
      expect(root.hasAttribute('data-dragging')).toBe(true);
      pointer('pointerup', document, xOf('2026-10-10'), 50);
      bar(root, 'r1').click();
      expect(handlers.openRow).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 0));
      bar(root, 'r1').click();
      expect(handlers.openRow).toHaveBeenCalledWith('r1');
    });

    it('writes nothing after Escape, and reports a drag as interacting', () => {
      const { root, handlers, view } = mount();

      layOut(root);
      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-12'), 50);
      expect(view.interacting).toBe(true);
      key(document, 'Escape');
      pointer('pointerup', document, xOf('2026-10-12'), 50);

      expect(handlers.writeDates).not.toHaveBeenCalled();
      expect(view.interacting).toBe(false);
    });

    it('keeps Cmd+Z from the editor while a bar is dragged', () => {
      const { root } = mount();

      layOut(root);
      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-12'), 50);
      const undo = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true });

      document.dispatchEvent(undo);
      pointer('pointerup', document, xOf('2026-10-12'), 50);

      expect(undo.defaultPrevented).toBe(true);
    });

    it('does not drag when read-only', () => {
      const { root, handlers } = mount({ readOnly: true });

      layOut(root);
      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-12'), 50);
      pointer('pointerup', document, xOf('2026-10-12'), 50);
      expect(handlers.writeDates).not.toHaveBeenCalled();
    });
  });

  describe('drag feedback (findings C15)', () => {
    const layOut = (root: HTMLElement): void => {
      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
    };
    const xOf = (day: string): number => px(day) + 20;
    const range = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-blok-database-timeline-range]');
    const edges = (root: HTMLElement): Array<string | null> =>
      [...root.querySelectorAll('[data-blok-database-timeline-units] > [data-range-edge]')].map((el) => el.getAttribute('data-day'));

    it('marks the resized range in the header and reads the moving edge beside it', () => {
      const { root } = mount();
      const handle = bar(root, 'r1').querySelector('[data-blok-database-timeline-resize="end"]');

      layOut(root);
      if (handle === null) throw new Error('no handle');
      pointer('pointerdown', handle, xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-11'), 50);

      expect(range(root)?.style.insetInlineStart).toBe(`${px('2026-10-09')}px`);
      expect(range(root)?.style.width).toBe(`${3 * TIMELINE_DAY_WIDTH.month}px`);
      expect(edges(root)).toEqual(['2026-10-09', '2026-10-11']);
      expect(bar(root, 'r1').querySelector('[data-blok-database-timeline-edge-readout="end"]')?.textContent).toBe('Oct 11');

      pointer('pointerup', document, xOf('2026-10-11'), 50);
      expect(range(root)).toBeNull();
      expect(edges(root)).toEqual([]);
      expect(root.querySelector('[data-blok-database-timeline-edge-readout]')).toBeNull();
    });

    it('marks the moved range too, with no readout', () => {
      const { root } = mount();

      layOut(root);
      pointer('pointerdown', bar(root, 'r2'), xOf('2026-10-12'), 50);
      pointer('pointermove', document, xOf('2026-10-14'), 50);

      expect(range(root)?.style.insetInlineStart).toBe(`${px('2026-10-14')}px`);
      expect(edges(root)).toEqual(['2026-10-14', '2026-10-16']);
      expect(root.querySelector('[data-blok-database-timeline-edge-readout]')).toBeNull();
      key(document, 'Escape');
      expect(range(root)).toBeNull();
    });
  });

  describe('hours zoom: 15-minute snap (research/22 §9)', () => {
    const hoursStart = timelineWindow(CENTER, 'hours').start;
    /** Canvas pixels to midnight of CENTER; hours zoom draws one pixel per minute. */
    const midnight = daysBetween(hoursStart, CENTER) * TIMELINE_DAY_WIDTH.hours;
    const at = (minutes: number): number => midnight + minutes;
    const mountHours = (overrides: Partial<DatabaseTimelineViewOptions> = {}): Mounted => {
      const mounted = mount({
        view: timelineView({ timelineZoom: 'hours' }),
        groups: single([row('r1', 'Call', '2026-10-09T03:00/2026-10-09T04:00')]),
        ...overrides,
      });

      rect(canvas(mounted.root), 0, 0, timelineWindow(CENTER, 'hours').days * TIMELINE_DAY_WIDTH.hours, 400);

      return mounted;
    };
    const handleOf = (root: HTMLElement, edge: 'start' | 'end'): HTMLElement => {
      const handle = bar(root, 'r1').querySelector<HTMLElement>(`[data-blok-database-timeline-resize="${edge}"]`);

      if (handle === null) throw new Error('no handle');

      return handle;
    };

    it('rounds a move to the nearest 15 minutes on drop', () => {
      const { root, handlers } = mountHours();

      pointer('pointerdown', bar(root, 'r1'), at(200), 50);
      pointer('pointermove', document, at(208), 50);
      pointer('pointerup', document, at(208), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T03:15/2026-10-09T04:15' });
    });

    it('writes nothing for a move under half a step, and moves back a step past half', () => {
      const { root, handlers } = mountHours();

      pointer('pointerdown', bar(root, 'r1'), at(200), 50);
      pointer('pointermove', document, at(194), 50);
      pointer('pointerup', document, at(194), 50);
      expect(handlers.writeDates).not.toHaveBeenCalled();

      pointer('pointerdown', bar(root, 'r1'), at(200), 50);
      pointer('pointermove', document, at(179), 50);
      pointer('pointerup', document, at(179), 50);
      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T02:45/2026-10-09T03:45' });
    });

    it('drags a move as a ghost that follows the pointer unsnapped, with no readout', () => {
      const { root } = mountHours();

      pointer('pointerdown', bar(root, 'r1'), at(200), 50);
      pointer('pointermove', document, at(208), 50);

      expect(bar(root, 'r1').style.insetInlineStart).toBe(`${at(188)}px`);
      expect(bar(root, 'r1').style.width).toBe('60px');
      expect(bar(root, 'r1').hasAttribute('data-dragging')).toBe(true);
      expect(showReadout).not.toHaveBeenCalled();
    });

    it('snaps a left-edge resize live and shows the new start beside the edge', () => {
      const { root, handlers } = mountHours();
      const handle = handleOf(root, 'start');

      pointer('pointerdown', handle, at(181), 50);
      pointer('pointermove', document, at(173), 50);

      expect(bar(root, 'r1').style.insetInlineStart).toBe(`${at(165)}px`);
      expect(bar(root, 'r1').style.width).toBe('75px');
      expect(showReadout).toHaveBeenLastCalledWith(handle, 'Oct 9, 2:45 AM', expect.objectContaining({ placement: 'left' }));

      pointer('pointerup', document, at(173), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T02:45/2026-10-09T04:00' });
      expect(hide).toHaveBeenCalled();
    });

    it('reads the unchanged start while a left-edge resize is under half a step', () => {
      const { root, handlers } = mountHours();
      const handle = handleOf(root, 'start');

      pointer('pointerdown', handle, at(181), 50);
      pointer('pointermove', document, at(176), 50);

      expect(showReadout).toHaveBeenLastCalledWith(handle, 'Oct 9, 3:00 AM', expect.anything());
      pointer('pointerup', document, at(176), 50);
      expect(handlers.writeDates).not.toHaveBeenCalled();
    });

    it('snaps a right-edge resize the same way and reads the new end', () => {
      const { root, handlers } = mountHours();
      const handle = handleOf(root, 'end');

      pointer('pointerdown', handle, at(239), 50);
      pointer('pointermove', document, at(247), 50);

      expect(bar(root, 'r1').style.width).toBe('75px');
      expect(showReadout).toHaveBeenLastCalledWith(handle, 'Oct 9, 4:15 AM', expect.objectContaining({ placement: 'right' }));
      pointer('pointerup', document, at(247), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T03:00/2026-10-09T04:15' });
    });

    it('puts the bar back and hides the readout on Escape', () => {
      const { root, handlers } = mountHours();

      pointer('pointerdown', handleOf(root, 'start'), at(181), 50);
      pointer('pointermove', document, at(150), 50);
      key(document, 'Escape');

      expect(bar(root, 'r1').style.insetInlineStart).toBe(`${at(180)}px`);
      expect(bar(root, 'r1').style.width).toBe('60px');
      expect(hide).toHaveBeenCalled();
      expect(handlers.writeDates).not.toHaveBeenCalled();
    });

    it('shows no readout for a resize at other zooms', () => {
      const { root } = mount();
      const handle = bar(root, 'r1').querySelector<HTMLElement>('[data-blok-database-timeline-resize="end"]');

      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
      if (handle === null) throw new Error('no handle');
      pointer('pointerdown', handle, px('2026-10-09') + 20, 50);
      pointer('pointermove', document, px('2026-10-11') + 20, 50);
      pointer('pointerup', document, px('2026-10-11') + 20, 50);

      expect(showReadout).not.toHaveBeenCalled();
    });
  });

  describe('reordering rows', () => {
    const layOutRows = (root: HTMLElement): void => {
      [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-row]')].forEach((el, i) => rect(el, 0, 100 + i * 36, 2000, 36));
    };
    const handle = (root: HTMLElement, rowId: string): HTMLElement => {
      const el = root.querySelector<HTMLElement>(`[data-blok-database-timeline-row][data-row-id="${rowId}"] [data-blok-database-timeline-row-handle]`);

      if (el === null) throw new Error('no handle');

      return el;
    };

    it('drops a row below another by its handle', () => {
      const { root, handlers } = mount();

      layOutRows(root);
      pointer('pointerdown', handle(root, 'r1'), 5, 110);
      pointer('pointermove', document, 5, 100 + 36 + 30);
      pointer('pointerup', document, 5, 100 + 36 + 30);

      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r1', afterRowId: 'r2', beforeRowId: null, groupKey: '', fromGroupKey: '' });
    });

    it('has no row handles in a sorted view', () => {
      const { root } = mount({ view: timelineView({ sorts: [{ propertyId: 'p-due', direction: 'asc' }] }) });

      expect(root.querySelector('[data-blok-database-timeline-row-handle]')).toBeNull();
    });
  });

  // Ledger D27: arrows ship (72b7c159). The tool turns `arrowsBy` into pairs (database-dependencies-tool.test.ts:91); the view draws the pairs.
  describe('dependency arrows', () => {
    const arrows = (root: HTMLElement): string[] => [...root.querySelectorAll('[data-blok-database-timeline-arrow]')]
      .map((arrow) => `${arrow.getAttribute('data-from') ?? ''}>${arrow.getAttribute('data-to') ?? ''}${arrow.hasAttribute('data-conflict') ? '!' : ''}`);

    it('draws one arrow per dependency it is given, marking one into an item that starts before its blocker ends', () => {
      const { root } = mount({
        view: timelineView({ arrowsBy: 'p-notes' }),
        arrows: [{ from: 'r1', to: 'r2' }, { from: 'r2', to: 'r1' }],
      });

      expect(arrows(root)).toEqual(['r1>r2', 'r2>r1!']);
    });

    it('skips an arrow whose end has no dates', () => {
      const { root } = mount({ arrows: [{ from: 'r1', to: 'r3' }, { from: 'r1', to: 'r2' }] });

      expect(arrows(root)).toEqual(['r1>r2']);
    });

    it('reads no arrowsBy itself: with no pairs given, it draws no arrow layer', () => {
      const { root } = mount({ view: timelineView({ arrowsBy: 'p-notes' }) });

      expect(root.querySelector('[data-blok-database-timeline-arrows]')).toBeNull();
    });
  });

  it('drops its document listeners on destroy', () => {
    const { root, view, handlers } = mount();

    rect(canvas(root), 0, 0, 10_000, 400);
    pointer('pointerdown', bar(root, 'r1'), 1500, 50);
    view.destroy();
    pointer('pointermove', document, 1700, 50);
    pointer('pointerup', document, 1700, 50);
    expect(handlers.writeDates).not.toHaveBeenCalled();
  });
});
