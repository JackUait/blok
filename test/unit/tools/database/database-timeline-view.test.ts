import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseTimelineView } from '../../../../src/tools/database/database-timeline-view';
import type { DatabaseTimelineViewOptions, TimelineGroup, TimelineHandlers } from '../../../../src/tools/database/database-timeline-view';
import { TIMELINE_DAY_WIDTH, timelineWindow } from '../../../../src/tools/database/timeline-dates';
import { daysBetween } from '../../../../src/tools/database/calendar-dates';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';

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
    it('draws one row per item and a bar for each dated item, sized by its days', () => {
      const { root } = mount();
      const width = TIMELINE_DAY_WIDTH.month;

      expect(root.querySelectorAll('[data-blok-database-timeline-row]')).toHaveLength(3);
      expect(bars(root).map((el) => el.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
      expect(bar(root, 'r2').style.width).toBe(`${3 * width}px`);
      expect(bar(root, 'r2').style.insetInlineStart).toBe(`${px('2026-10-12')}px`);
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

      expect(bar(root, 'r1').style.width).toBe(`${4 * TIMELINE_DAY_WIDTH.month}px`);
    });

    it('shows the title and the visible properties on a bar, and skips empty ones', () => {
      const { root } = mount({ view: timelineView({ properties: [{ id: 'p-notes', visible: true }] }) });

      expect(bar(root, 'r2').querySelector('[data-blok-database-timeline-bar-title]')?.textContent).toBe('Trip');
      expect(bar(root, 'r2').querySelector('[data-property-id="p-notes"]')?.textContent).toContain('Bring snacks');
      expect(bar(root, 'r1').querySelector('[data-property-id="p-notes"]')).toBeNull();
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

    it('opens a row from its title in the table panel', () => {
      const { root, handlers } = mount({ view: timelineView({ showTimelineTable: true }) });

      root.querySelector<HTMLElement>('[data-blok-database-timeline-table-row][data-row-id="r2"] [data-blok-database-timeline-table-title]')?.click();
      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });
  });

  describe('toolbar', () => {
    it('opens the zoom menu and goes to today', () => {
      const { root, handlers } = mount();
      const zoom = root.querySelector<HTMLElement>('[data-blok-database-timeline-zoom]');

      expect(zoom?.textContent).toBe('tools.database.timelineZoomMonth');
      zoom?.click();
      expect(handlers.openZoomMenu).toHaveBeenCalledWith(zoom);
      root.querySelector<HTMLElement>('[data-blok-database-timeline-today]')?.click();
      expect(handlers.navigate).toHaveBeenCalledWith(CENTER);
    });

    it('adds a row from "+ New"', () => {
      const { root, handlers } = mount();

      root.querySelector<HTMLElement>('[data-blok-database-timeline-new]')?.click();
      expect(handlers.addRow).toHaveBeenCalledWith(null);
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

    it('pans with Left and Right, flipped in a right-to-left editor', () => {
      const { root } = mount();
      const el = scroller(root);

      el.scrollLeft = 500;
      key(el, 'ArrowRight');
      expect(el.scrollLeft).toBeGreaterThan(500);
      key(el, 'ArrowLeft');
      key(el, 'ArrowLeft');
      expect(el.scrollLeft).toBeLessThan(500);

      document.body.innerHTML = '';
      const rtl = mount();

      rtl.root.setAttribute('dir', 'rtl');
      scroller(rtl.root).scrollLeft = -500;
      key(scroller(rtl.root), 'ArrowRight');
      expect(scroller(rtl.root).scrollLeft).toBeGreaterThan(-500);
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

    it('does not drag when read-only', () => {
      const { root, handlers } = mount({ readOnly: true });

      layOut(root);
      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointermove', document, xOf('2026-10-12'), 50);
      pointer('pointerup', document, xOf('2026-10-12'), 50);
      expect(handlers.writeDates).not.toHaveBeenCalled();
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
      pointer('pointermove', document, 5, 100 + 2 * 36 + 30);
      pointer('pointerup', document, 5, 100 + 2 * 36 + 30);

      expect(handlers.moveRow).toHaveBeenCalledWith({ rowId: 'r1', afterRowId: 'r3', beforeRowId: null, groupKey: '', fromGroupKey: '' });
    });

    it('has no row handles in a sorted view', () => {
      const { root } = mount({ view: timelineView({ sorts: [{ propertyId: 'p-due', direction: 'asc' }] }) });

      expect(root.querySelector('[data-blok-database-timeline-row-handle]')).toBeNull();
    });
  });

  describe('dependency arrows', () => {
    it('draws nothing yet, even with arrowsBy set', () => {
      const { root } = mount({ view: timelineView({ arrowsBy: 'p-notes' }) });

      expect(root.querySelector('[data-blok-database-timeline-arrow]')).toBeNull();
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
