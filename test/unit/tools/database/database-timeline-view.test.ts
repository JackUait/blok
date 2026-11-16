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

    // notion-motion.md Round 48 A5: in Quarter, Year and 5 Years a bar starts 2px into its span and is max(span - 3, 11) wide.
    it.each([
      ['quarter', 3, 33],
      ['quarter', 1, 11],
      ['year', 3, 12],
      ['5_years', 3, 11],
    ] as const)('%s zoom insets a %i-day bar to Notion\'s %ipx, 2px in', (zoom, days, width) => {
      const end = days === 1 ? '2026-10-12' : `2026-10-12/2026-10-${String(11 + days)}`;
      const { root } = mount({ view: timelineView({ timelineZoom: zoom }), groups: single([row('r1', 'Trip', end)]) });
      const start = daysBetween(timelineWindow(CENTER, zoom).start, '2026-10-12') * TIMELINE_DAY_WIDTH[zoom];

      expect(bar(root, 'r1').style.width).toBe(`${width}px`);
      expect(bar(root, 'r1').style.insetInlineStart).toBe(`${start + 2}px`);
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

    // notion-spec-2 §24.1 (113-timeline-url.png): the table's cut after a bar, scheme hidden.
    it('cuts a URL after a bar as the table does', () => {
      const withSite: PropertyDefinition[] = [...schema, { id: 'p-site', name: 'Site', type: 'url', position: 'a4' }];
      const { root } = mount({
        schema: withSite,
        view: timelineView({ properties: [{ id: 'p-site', visible: true }] }),
        groups: single([row('r1', 'Launch', '2026-10-09', { 'p-site': 'https://example.com/abc/defg/hijk/lmno' })]),
      });
      const link = bar(root, 'r1').querySelector('[data-property-id="p-site"] a[href]');

      expect(link?.textContent).toBe('example.com/abc…k/lmno');
      expect(link?.querySelector('[data-blok-database-url-path]')?.textContent).toBe('/abc…k/lmno');
    });

    it('labels today\'s dot with the locale\'s day number', () => {
      const { root } = mount({ locale: 'ar-EG' });

      expect(root.querySelector('[data-blok-database-timeline-today-dot]')?.textContent)
        .toBe(new Intl.DateTimeFormat('ar-EG', { day: 'numeric' }).format(new Date(2026, 9, 9)));
    });

    // notion-motion.md Round 33 §4 (r33-timeline-*.raw): at 15:11 the line sits 25/40 into today's column,
    // and it moves with the clock, a minute at a time.
    describe('today line', () => {
      const lineAt = (root: HTMLElement): number =>
        parseFloat(root.querySelector<HTMLElement>('[data-blok-database-timeline-today-line]')?.style.insetInlineStart ?? '');

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(new Date(2026, 9, 9, 15, 11));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('marks the time of day in today\'s column', () => {
        expect(lineAt(mount().root)).toBeCloseTo(px(CENTER) + 40 * (15 * 60 + 11) / 1440, 3);
      });

      it('moves as the minutes pass', () => {
        const { root } = mount();

        vi.advanceTimersByTime(2 * 60_000);

        expect(lineAt(root)).toBeCloseTo(px(CENTER) + 40 * (15 * 60 + 13) / 1440, 3);
      });

      it('stops its clock on destroy', () => {
        const { view } = mount();

        expect(vi.getTimerCount()).toBeGreaterThan(0);
        view.destroy();

        expect(vi.getTimerCount()).toBe(0);
      });
    });

    // notion-motion.md Round 34 §5 (r34-timeline-hours-nowlabel.raw, r33-timeline-nowline-hours-1.raw): Hours zoom
    // names the time on the now-line in the tick row, centres each tick on its time, has no day pill,
    // and drops the ticks the label would cover.
    describe('hours zoom now label', () => {
      const NOW_LABEL = '[data-blok-database-timeline-now-label]';
      const hours = (): HTMLElement => mount({ view: timelineView({ timelineZoom: 'hours' }) }).root;
      const hoursStart = timelineWindow(CENTER, 'hours').start;
      const tickAt = (root: HTMLElement, hour: number, minute: number): HTMLElement => {
        const index = daysBetween(hoursStart, CENTER) * 96 + hour * 4 + minute / 15;
        const tick = root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]')[index];

        if (tick === undefined) throw new Error('no tick');

        return tick;
      };
      const xOf = (el: HTMLElement | null): number => parseFloat(el?.style.insetInlineStart ?? '');

      /** Lays out the label 48.58 wide on its x and each tick's text 44 wide on its time. */
      const layout = (): void => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
          const owner = this.parentElement;
          const isLabel = owner?.matches(NOW_LABEL) === true;

          // A hidden tick has no box.
          if (owner?.hidden === true) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
          const center = owner === null ? 0 : xOf(owner) + (isLabel ? 0 : parseFloat(owner.style.width) / 2);
          const width = isLabel ? 48.58 : 44;

          return { left: center - width / 2, right: center + width / 2, top: 0, bottom: 14, width, height: 14, x: center - width / 2, y: 0, toJSON: () => ({}) };
        });
      };

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'queueMicrotask'] });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('reads the time in the locale\'s clock, on the now-line, with no day pill', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 17, 38));
        const root = hours();
        const label = root.querySelector<HTMLElement>(`[data-blok-database-timeline-units] > ${NOW_LABEL}`);

        expect(label?.textContent).toMatch(/^5:38\sPM$/);
        expect(xOf(label)).toBeCloseTo(xOf(root.querySelector<HTMLElement>('[data-blok-database-timeline-today-line]')), 5);
        expect(root.querySelector('[data-blok-database-timeline-today-dot]')).toBeNull();
        vi.advanceTimersByTime(60_000);
        expect(label?.textContent).toMatch(/^5:39\sPM$/);
      });

      it('centres each tick on its time', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 17, 38));
        const tick = tickAt(hours(), 17, 15);
        const time = (daysBetween(hoursStart, CENTER) + (17 * 60 + 15) / 1440) * TIMELINE_DAY_WIDTH.hours;

        expect(xOf(tick) + parseFloat(tick.style.width) / 2).toBeCloseTo(time, 5);
        expect(tick.textContent).toMatch(/^5:15\sPM$/);
      });

      // At 5:38 Notion drops 5:30 and 5:45 (39 and 34 px away) and keeps 5:15 and 6:00 (112 and 107).
      it('hides the ticks the label covers, and keeps the rest', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 17, 38));
        layout();
        const root = hours();

        vi.runAllTicks();
        expect([[17, 15], [17, 30], [17, 45], [18, 0]].map(([h, m]) => tickAt(root, h, m).hidden)).toEqual([false, true, true, false]);
      });

      // At 3:29 Notion drops 3:30 and keeps 3:15 and 3:45 (68 and 78 px away).
      it('keeps a tick 68 px away', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 15, 29));
        layout();
        const root = hours();

        vi.runAllTicks();
        expect([[15, 15], [15, 30], [15, 45]].map(([h, m]) => tickAt(root, h, m).hidden)).toEqual([false, true, false]);
      });

      it('keeps a tick hidden while the label still covers it', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 17, 38));
        layout();
        const root = hours();

        vi.runAllTicks();
        vi.advanceTimersByTime(60_000);
        expect(tickAt(root, 17, 30).hidden).toBe(true);
      });

      it('brings a tick back once the line has moved off it', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 17, 38));
        layout();
        const root = hours();

        vi.runAllTicks();
        vi.advanceTimersByTime(3 * 60_000);
        expect(tickAt(root, 17, 30).hidden).toBe(false);
      });
    });

    // notion-motion.md Round 47 A1b (r47-n-tl-day-today.raw): Day zoom names the time on the now-line ("2:58 PM"),
    // centres each hour tick on its hour, and draws no 22px day pill.
    it('day zoom names the time on the now-line, centres hour ticks and draws no day pill', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'queueMicrotask'] });
      vi.setSystemTime(new Date(2026, 9, 9, 14, 58));
      const root = mount({ view: timelineView({ timelineZoom: 'day' }) }).root;
      const ticks = root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]');
      const width = TIMELINE_DAY_WIDTH.day / 24;

      expect(root.querySelector('[data-blok-database-timeline-units] > [data-blok-database-timeline-now-label]')?.textContent).toMatch(/^2:58\sPM$/);
      expect(root.querySelector('[data-blok-database-timeline-today-dot]')).toBeNull();
      expect(parseFloat(ticks[1].style.insetInlineStart)).toBeCloseTo(width - width / 2, 5);
      vi.useRealTimers();
    });

    // notion-motion.md Round 48 A1, A2, A4 (r48-n-<zoom>-hdr.raw): Quarter, Year and 5 Years put each label on its
    // unit's start line, the today circle on today's start, hide the ticks the circle covers, and draw month lines in the body.
    describe('far zoom header (Round 48)', () => {
      const MONDAY = '2026-11-16';
      const xOf = (el: Element | null | undefined): number => parseFloat((el as HTMLElement | null)?.style.insetInlineStart ?? '');
      const far = (zoom: 'quarter' | 'year' | '5_years' | 'month'): HTMLElement =>
        mount({ view: timelineView({ timelineZoom: zoom }), center: MONDAY, today: MONDAY }).root;
      const ticks = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]')];
      const tickOn = (root: HTMLElement, day: string): HTMLElement => {
        const tick = ticks(root).find((el) => el.getAttribute('data-day') === day);

        if (tick === undefined) throw new Error(`no tick ${day}`);

        return tick;
      };
      const px = (root: HTMLElement, day: string, zoom: 'quarter' | 'year' | '5_years' | 'month'): number =>
        daysBetween(timelineWindow(MONDAY, zoom).start, day) * TIMELINE_DAY_WIDTH[zoom];

      /** The dot is 22 wide on its x; a tick's text is 7 a digit, centred in its box. */
      const layout = (): void => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
          const owner = this.parentElement;
          const isDot = this.hasAttribute('data-blok-database-timeline-today-dot');
          const hidden = owner?.hidden === true;
          const tickCenter = owner === null ? 0 : xOf(owner) + parseFloat(owner.style.width) / 2;
          const center = isDot ? xOf(this) : tickCenter;
          const textWidth = isDot ? 22 : 7 * (this.textContent ?? '').length;
          const width = hidden ? 0 : textWidth;

          return { left: center - width / 2, right: center + width / 2, top: 0, bottom: 14, width, height: 14, x: center - width / 2, y: 0, toJSON: () => ({}) };
        });
      };

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'queueMicrotask'] });
        vi.setSystemTime(new Date(2026, 10, 16, 18, 27));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        ['quarter', '2026-11-02'],
        ['year', '2026-11-02'],
        ['5_years', '2026-12-01'],
      ] as const)('%s zoom centres each tick label on its start line', (zoom, day) => {
        const root = far(zoom);
        const tick = tickOn(root, day);

        expect(xOf(tick) + parseFloat(tick.style.width) / 2).toBeCloseTo(px(root, day, zoom), 5);
      });

      it.each(['quarter', 'year', '5_years'] as const)('%s zoom keeps the today circle, on the start of today, and has no now label', (zoom) => {
        const root = far(zoom);

        expect(xOf(root.querySelector('[data-blok-database-timeline-today-dot]'))).toBeCloseTo(px(root, MONDAY, zoom), 5);
        expect(root.querySelector('[data-blok-database-timeline-now-label]')).toBeNull();
      });

      it('month zoom keeps the circle in the middle of today', () => {
        const root = far('month');

        expect(xOf(root.querySelector('[data-blok-database-timeline-today-dot]'))).toBe(px(root, MONDAY, 'month') + TIMELINE_DAY_WIDTH.month / 2);
      });

      it.each([
        ['quarter', ['2026-11-16'], ['2026-11-09', '2026-11-23']],
        ['year', ['2026-11-16'], ['2026-11-09', '2026-11-23']],
        ['5_years', ['2026-11-01', '2026-12-01'], ['2026-10-01', '2027-01-01']],
      ] as const)('%s zoom hides the tick labels the today circle covers', (zoom, covered, kept) => {
        layout();
        const root = far(zoom);

        vi.runAllTicks();
        expect(covered.map((day) => tickOn(root, day).hidden)).toEqual(covered.map(() => true));
        expect(kept.map((day) => tickOn(root, day).hidden)).toEqual(kept.map(() => false));
      });

      it.each(['quarter', 'year', '5_years'] as const)('%s zoom draws a body line on the 1st of every month', (zoom) => {
        const root = far(zoom);
        const window = timelineWindow(MONDAY, zoom);
        const firsts = Array.from({ length: window.days }, (_, i) => i).filter((i) => {
          const date = new Date(2026, 0, 1);

          date.setFullYear(Number(window.start.slice(0, 4)), Number(window.start.slice(5, 7)) - 1, Number(window.start.slice(8)) + i);

          return date.getDate() === 1;
        });
        const lines = [...root.querySelectorAll('[data-blok-database-timeline-background] > [data-blok-database-timeline-month-line]')];

        expect(lines.map(xOf)).toEqual(firsts.map((i) => i * TIMELINE_DAY_WIDTH[zoom]));
      });

      // notion-motion.md Round 48 A1 (fitted to four reads): the toolbar names the tick unit under the chart's
      // left edge, by its start. At 18:27 in a 708 view: Year "August 2026" (the week of Aug 31), Quarter
      // "October 2026" (the week of Oct 12), 5 Years "2025" (the year alone).
      it.each([
        ['year', 'August 2026'],
        ['quarter', 'October 2026'],
        ['5_years', '2025'],
      ] as const)('%s zoom names the unit under the left edge in the toolbar', (zoom, label) => {
        const root = far(zoom);

        Object.defineProperty(scroller(root), 'clientWidth', { value: 708, configurable: true });
        vi.runAllTicks();

        expect(root.querySelector('[data-blok-database-timeline-month]')?.textContent).toBe(label);
      });

      it('draws no month lines at month zoom', () => {
        expect(far('month').querySelector('[data-blok-database-timeline-month-line]')).toBeNull();
      });
    });

    // notion-motion.md Round 35 Part B (r35-timeline-hours-open.raw, r35-timeline-hours-grid.raw).
    describe('hours zoom opens at now (Round 35)', () => {
      const VIEWPORT = 708;
      const hoursStart = timelineWindow(CENTER, 'hours').start;
      const nowX = (hour: number, minute: number): number =>
        (daysBetween(hoursStart, CENTER) + (hour * 60 + minute) / 1440) * TIMELINE_DAY_WIDTH.hours;
      /** Mounts, gives the scroller a width, then lets the first draw scroll. */
      const open = (overrides: Partial<DatabaseTimelineViewOptions> = {}): HTMLElement => {
        const { root } = mount(overrides);

        Object.defineProperty(scroller(root), 'clientWidth', { value: VIEWPORT, configurable: true });
        vi.runAllTicks();

        return root;
      };

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'queueMicrotask'] });
        vi.setSystemTime(new Date(2026, 9, 9, 19, 46));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('centres the now-line in the viewport, and again when the view opens a second time', () => {
        const first = open({ view: timelineView({ timelineZoom: 'hours' }) });
        const line = first.querySelector<HTMLElement>('[data-blok-database-timeline-today-line]');

        expect(scroller(first).scrollLeft).toBeCloseTo(nowX(19, 46) - VIEWPORT / 2, 5);
        expect(parseFloat(line?.style.insetInlineStart ?? '')).toBeCloseTo(nowX(19, 46), 5);
        document.body.innerHTML = '';
        expect(scroller(open({ view: timelineView({ timelineZoom: 'hours' }) })).scrollLeft).toBeCloseTo(nowX(19, 46) - VIEWPORT / 2, 5);
      });

      it('centres on the stored day\'s start when that day is not today', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }), today: '2026-10-08' });

        expect(scroller(root).scrollLeft).toBeCloseTo(nowX(0, 0) - VIEWPORT / 2, 5);
      });

      // notion-motion.md Round 46 B "Initial scroll": at 12:50 the now-line sits at the scroller centre, today's column 21.4 left of it.
      it('month zoom also centres the now-line, not the start of today', () => {
        vi.setSystemTime(new Date(2026, 9, 9, 12, 50));
        const root = open();
        const start = timelineWindow(CENTER, 'month').start;

        expect(scroller(root).scrollLeft).toBeCloseTo((daysBetween(start, CENTER) + 770 / 1440) * TIMELINE_DAY_WIDTH.month - VIEWPORT / 2, 5);
      });

      it('month zoom centres the stored day\'s start when that day is not today', () => {
        const root = open({ today: '2026-10-08' });
        const start = timelineWindow(CENTER, 'month').start;

        expect(scroller(root).scrollLeft).toBe(daysBetween(start, CENTER) * TIMELINE_DAY_WIDTH.month - VIEWPORT / 2);
      });

      // notion-motion.md Round 47 A1: Notion centres the now moment in every zoom, on open and on Today.
      // 5 Years was too coarse to tell apart in Notion; it takes the same rule.
      it.each(['day', 'week', 'bi_week', 'quarter', 'year', '5_years'] as const)('%s zoom centres the now-line too', (zoom) => {
        vi.setSystemTime(new Date(2026, 9, 9, 12, 50));
        const root = open({ view: timelineView({ timelineZoom: zoom }) });
        const start = timelineWindow(CENTER, zoom).start;

        expect(scroller(root).scrollLeft).toBeCloseTo((daysBetween(start, CENTER) + 770 / 1440) * TIMELINE_DAY_WIDTH[zoom] - VIEWPORT / 2, 5);
      });

      it('draws a line every 15 minutes in the body, on the ticks, and none at other zooms', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }) });
        const lines = [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-background] > [data-blok-database-timeline-tick-line]')];
        const ticks = [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]')];

        expect(lines).toHaveLength(timelineWindow(CENTER, 'hours').days * 96);
        expect(lines.map((el) => parseFloat(el.style.insetInlineStart))).toEqual(
          ticks.map((el) => parseFloat(el.style.insetInlineStart) + parseFloat(el.style.width) / 2)
        );
        document.body.innerHTML = '';
        expect(open().querySelector('[data-blok-database-timeline-tick-line]')).toBeNull();
      });

      // notion-motion.md Round 48 A3: Day has a line every hour, Week every day; Bi-week and Month none.
      it('draws a line every hour in Day and every day in Week, on the ticks', () => {
        const linesOf = (root: HTMLElement): number[] =>
          [...root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-background] > [data-blok-database-timeline-tick-line]')]
            .map((el) => parseFloat(el.style.insetInlineStart));
        const day = open({ view: timelineView({ timelineZoom: 'day' }) });
        const ticks = [...day.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]')];

        expect(linesOf(day)).toHaveLength(timelineWindow(CENTER, 'day').days * 24);
        expect(linesOf(day)).toEqual(ticks.map((el) => parseFloat(el.style.insetInlineStart) + parseFloat(el.style.width) / 2));

        document.body.innerHTML = '';
        const week = open({ view: timelineView({ timelineZoom: 'week' }) });

        expect(linesOf(week)).toEqual(Array.from({ length: timelineWindow(CENTER, 'week').days }, (_, i) => i * TIMELINE_DAY_WIDTH.week));

        document.body.innerHTML = '';
        expect(linesOf(open({ view: timelineView({ timelineZoom: 'bi_week' }) }))).toEqual([]);
      });

      it('has one tick row under a toolbar that reads the full date', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }) });

        expect(root.querySelector('[data-blok-database-timeline-groups]')).toBeNull();
        expect(root.style.getPropertyValue('--blok-database-timeline-header-rows')).toBe('1');
        expect(root.querySelector('[data-blok-database-timeline-month]')?.textContent).toBe('October 9, 2026');
        document.body.innerHTML = '';
        expect(open().querySelector('[data-blok-database-timeline-month]')?.textContent).toMatch(/^[A-Z][a-z]+ 2026$/);
      });

      it('reads the full date in the editor\'s locale', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }), locale: 'de-DE' });

        expect(root.querySelector('[data-blok-database-timeline-month]')?.textContent).toBe('9. Oktober 2026');
      });

      it('sets the day period of a tick apart, inside the text the now label measures', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }) });
        const index = daysBetween(hoursStart, CENTER) * 96 + 17 * 4 + 1;
        const tick = root.querySelectorAll<HTMLElement>('[data-blok-database-timeline-units] > [data-day]')[index];
        const period = tick?.firstElementChild?.querySelector('[data-blok-database-timeline-day-period]');

        expect(period?.textContent).toBe('PM');
        expect(tick?.textContent).toMatch(/^5:15\sPM$/);
      });

      it('has no day period span in a 24-hour locale', () => {
        const root = open({ view: timelineView({ timelineZoom: 'hours' }), locale: 'de-DE' });

        expect(root.querySelector('[data-blok-database-timeline-day-period]')).toBeNull();
      });
    });

    it('shades weekends at day-level zoom and not at year zoom', () => {
      expect(mount().root.querySelectorAll('[data-blok-database-timeline-weekend]').length).toBeGreaterThan(0);
      document.body.innerHTML = '';
      expect(mount({ view: timelineView({ timelineZoom: 'year' }) }).root.querySelectorAll('[data-blok-database-timeline-weekend]')).toHaveLength(0);
    });

    // notion-motion.md Round 35 Part B: on a Sunday, Notion's Hours body is rgb(253), the bare canvas.
    it('does not shade a Sunday in Hours zoom', () => {
      const sunday = '2026-11-15';
      const { root } = mount({ view: timelineView({ timelineZoom: 'hours' }), center: sunday, today: sunday });

      expect(root.querySelectorAll('[data-blok-database-timeline-weekend]')).toHaveLength(0);
      expect(root.querySelector('[data-blok-database-timeline-background]')).not.toBeNull();
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

    // timeline.png / tlcollapse.png: the days keep their x when the table toggles.
    it('hands the toggle where the first day sits on the window', () => {
      const { root, handlers } = mount({ view: timelineView({ showTimelineTable: true }) });
      const el = scroller(root);

      rect(root, 100, 0, 1000, 400);
      rect(el, 380, 0, 720, 400);
      el.scrollLeft = 600;
      root.querySelector<HTMLElement>('[data-blok-database-timeline-table-toggle]')?.click();
      expect(handlers.toggleTable).toHaveBeenCalledWith({ start: '2026-07-01', at: -220 });
    });

    it('a draw handed that place scrolls so the first day sits there again', async () => {
      const { root } = mount({ origin: { start: '2026-07-01', at: -220 } });
      const el = scroller(root);

      rect(root, 100, 0, 1000, 400);
      rect(el, 100, 0, 1000, 400);
      await Promise.resolve();
      expect(el.scrollLeft).toBe(320);
    });

    // notion-motion.md Round 46 B "Opening the panel": dates keep their window x. The view's own box moves when the panel opens.
    it.each([
      { name: 'opening', before: { root: 531, chart: 531 }, after: { root: 270, chart: 646 }, expected: 2686 + 115 },
      { name: 'closing', before: { root: 270, chart: 646 }, after: { root: 531, chart: 531 }, expected: 2686 - 115 },
    ])('$name the table keeps every day at the same window x, though the view\'s box moves', async ({ before, after, expected }) => {
      const first = mount();

      rect(first.root, before.root, 0, 1230, 400);
      rect(scroller(first.root), before.chart, 0, 708, 400);
      await Promise.resolve();
      scroller(first.root).scrollLeft = 2686;
      first.root.querySelector<HTMLElement>('[data-blok-database-timeline-table-toggle]')?.click();
      const handed = vi.mocked(first.handlers.toggleTable).mock.calls[0]?.[0];
      const second = mount({ origin: handed });

      rect(second.root, after.root, 0, 1230, 400);
      rect(scroller(second.root), after.chart, 0, 708, 400);
      await Promise.resolve();
      expect(scroller(second.root).scrollLeft).toBe(expected);
    });

    it('a place from another window is ignored: the draw centres as usual', async () => {
      const handed = mount({ origin: { start: '2026-08-01', at: -320 } }).root;
      const plain = mount().root;

      await Promise.resolve();
      expect(scroller(handed).scrollLeft).toBe(scroller(plain).scrollLeft);
      expect(scroller(handed).scrollLeft).not.toBe(320);
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

      expect(title?.querySelector('[data-blok-database-table-calc-label]')?.textContent).toBe('tools.database.calcCount');
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
      // notion-motion.md Round 11 "Read-only database": no "Calculate" node at all.
      expect(readOnly.root.querySelector('[data-blok-database-timeline-table-footer] [data-blok-database-table-calc-placeholder]')).toBeNull();
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

    // notion-motion.md Timeline: after a table toggle the old chevron shrinks out over the new one.
    it('keeps the old chevron, mirrored and hidden from readers, on the draw after a table toggle', () => {
      const { root } = mount({ tableSwapped: true });
      const toggle = root.querySelector('[data-blok-database-timeline-table-toggle]');
      const old = toggle?.querySelector('[data-blok-database-timeline-toggle-out]');

      expect(old?.innerHTML).toBe(markup(IconChevronDoubleRight));
      expect(old?.getAttribute('aria-hidden')).toBe('true');
      expect(toggle?.hasAttribute('data-swapped')).toBe(true);
    });

    it('draws one chevron when the table was not just toggled', () => {
      const { root } = mount();

      expect(root.querySelector('[data-blok-database-timeline-toggle-out]')).toBeNull();
      expect(root.querySelector('[data-blok-database-timeline-table-toggle]')?.hasAttribute('data-swapped')).toBe(false);
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

    // notion-motion.md Round 24 §4 Timeline: hovering the "+ New" lane shows a 197x34 ghost bar at the hovered day.
    describe('"+ New" lane ghost bar', () => {
      const lane = (root: HTMLElement): HTMLElement => {
        const el = root.querySelector<HTMLElement>('[data-blok-database-timeline-new-lane]');

        if (el === null) throw new Error('no lane');

        return el;
      };
      const ghost = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-blok-database-timeline-new-ghost]');
      const range = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-blok-database-timeline-range]');

      it('puts a 5-day ghost bar at the hovered day and pills those days in the header', () => {
        const { root } = mount();

        rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
        pointer('pointermove', lane(root), px('2026-10-20') + 20, 390);

        expect(ghost(root)?.style.insetInlineStart).toBe(`${px('2026-10-20') + 1.5}px`);
        expect(ghost(root)?.style.width).toBe('197px');
        expect(ghost(root)?.getAttribute('data-day')).toBe('2026-10-20');
        expect(range(root)?.style.insetInlineStart).toBe(`${px('2026-10-20')}px`);
        expect(range(root)?.style.width).toBe(`${5 * TIMELINE_DAY_WIDTH.month}px`);
      });

      it('drops the header pill when the pointer leaves the lane', () => {
        const { root } = mount();

        rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
        pointer('pointermove', lane(root), px('2026-10-20') + 20, 390);
        lane(root).dispatchEvent(new PointerEvent('pointerleave'));

        expect(range(root)).toBeNull();
        expect(ghost(root)?.hasAttribute('data-day')).toBe(false);
      });

      // notion-motion.md Round 25 §4: the click makes a 5-day bar from the hovered day.
      it('adds a 5-day bar starting on the hovered day when the ghost is clicked', () => {
        const { root, handlers } = mount();

        rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
        pointer('pointermove', lane(root), px('2026-10-20') + 20, 390);
        ghost(root)?.click();
        expect(handlers.addRow).toHaveBeenCalledWith(null, { start: '2026-10-20/2026-10-24' });
      });

      // notion-motion.md Round 48 A9: at Day zoom the ghost is 3 hours (153.3 = 3h - 3) and the click writes a timed range.
      // Notion started it at 6:30 with the pointer near 6:45; why is unread, so Blok takes the hovered 15-minute slot.
      it('puts a 3-hour ghost on the hovered 15-minute slot at Day zoom, and adds that timed bar', () => {
        const dayStart = timelineWindow(CENTER, 'day').start;
        const perMinute = TIMELINE_DAY_WIDTH.day / 1440;
        const slot = daysBetween(dayStart, CENTER) * TIMELINE_DAY_WIDTH.day + (18 * 60 + 30) * perMinute;
        const { root, handlers } = mount({ view: timelineView({ timelineZoom: 'day' }) });

        rect(canvas(root), 0, 0, timelineWindow(CENTER, 'day').days * TIMELINE_DAY_WIDTH.day, 400);
        pointer('pointermove', lane(root), slot + 10 * perMinute, 390);

        expect(parseFloat(ghost(root)?.style.insetInlineStart ?? '')).toBeCloseTo(slot + 1.5, 5);
        expect(parseFloat(ghost(root)?.style.width ?? '')).toBeCloseTo(180 * perMinute - 3, 5);

        pointer('pointermove', lane(root), slot + 20 * perMinute, 390);
        expect(parseFloat(ghost(root)?.style.insetInlineStart ?? '')).toBeCloseTo(slot + 15 * perMinute + 1.5, 5);

        pointer('pointermove', lane(root), slot + 10 * perMinute, 390);
        ghost(root)?.click();
        expect(handlers.addRow).toHaveBeenCalledWith(null, { start: '2026-10-09T18:30/2026-10-09T21:30' });
      });

      it('writes a timed start and end for a Day-zoom ghost when the view has an end property', () => {
        const dayStart = timelineWindow(CENTER, 'day').start;
        const perMinute = TIMELINE_DAY_WIDTH.day / 1440;
        const { root, handlers } = mount({ view: timelineView({ timelineZoom: 'day' }), endPropertyId: 'p-end' });

        rect(canvas(root), 0, 0, timelineWindow(CENTER, 'day').days * TIMELINE_DAY_WIDTH.day, 400);
        pointer('pointermove', lane(root), daysBetween(dayStart, CENTER) * TIMELINE_DAY_WIDTH.day + (22 * 60 + 50) * perMinute, 390);
        ghost(root)?.click();
        expect(handlers.addRow).toHaveBeenCalledWith(null, { start: '2026-10-09T22:45', end: '2026-10-10T01:45' });
      });

      it('has no ghost when read-only', () => {
        expect(ghost(mount({ readOnly: true }).root)).toBeNull();
      });
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

    // notion-motion.md Timeline (tlcollapse.png, Gamma): a bar cut by the screen's end shows a "→" chip at that end.
    it('marks a bar that runs past the screen\'s end, and its "→" chip jumps to it', () => {
      const { root, view } = mount();
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = px('2026-10-04');
      view.refreshOffscreen();

      expect(bar(root, 'r2').hasAttribute('data-clipped-end')).toBe(true);
      expect(bar(root, 'r1').hasAttribute('data-clipped-end')).toBe(false);
      const chip = bar(root, 'r2').querySelector<HTMLElement>('[data-blok-database-timeline-bar-chip="end"]');

      expect(chip?.innerHTML).toBe(markup(IconArrowRightSmall));
      chip?.click();
      expect(el.scrollLeft).toBeGreaterThan(px('2026-10-04'));
    });

    it('scrolls a bar cut at both ends forward from its "→" chip, to its end', () => {
      const { root, view } = mount({ groups: single([row('r1', 'Long', '2026-10-01/2026-10-20')]) });
      const el = scroller(root);

      Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
      el.scrollLeft = px('2026-10-05');
      view.refreshOffscreen();

      expect(bar(root, 'r1').hasAttribute('data-clipped-start')).toBe(true);
      expect(bar(root, 'r1').hasAttribute('data-clipped-end')).toBe(true);
      bar(root, 'r1').querySelector<HTMLElement>('[data-blok-database-timeline-bar-chip="end"]')?.click();

      // The end day, with one day of room after it.
      expect(el.scrollLeft).toBe(px('2026-10-22') - 400);
    });

    // A Day zoom day (1250) is wider than the screen: a jump lands the bar's edge on the screen edge, with no day of room.
    it('brings a bar onto the screen at day zoom, where a day is wider than the screen', () => {
      const view = timelineView({ timelineZoom: 'day' });
      const { root, view: timeline } = mount({ view, groups: single([row('r1', 'Early', '2026-10-07'), row('r2', 'Long', '2026-10-06/2026-10-11')]) });
      const el = scroller(root);
      const start = timelineWindow(CENTER, 'day').start;
      const at = (day: string): number => daysBetween(start, day) * TIMELINE_DAY_WIDTH.day;

      Object.defineProperty(el, 'clientWidth', { value: 708, configurable: true });
      el.scrollLeft = at('2026-10-09');
      timeline.refreshOffscreen();
      root.querySelector<HTMLElement>('[data-blok-database-timeline-row][data-row-id="r1"] [data-blok-database-timeline-offscreen="before"]')?.click();
      expect(el.scrollLeft).toBe(at('2026-10-07'));

      el.scrollLeft = at('2026-10-09');
      timeline.refreshOffscreen();
      bar(root, 'r2').querySelector<HTMLElement>('[data-blok-database-timeline-bar-chip="end"]')?.click();
      expect(el.scrollLeft).toBe(at('2026-10-12') - 708);
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

    // notion-motion.md Round 48 A9: a 60px Day-zoom drag moved an all-day bar 1h15m, and it stayed 24 hours wide.
    it('moves a bar at Day zoom by 15-minute steps, an all-day bar becoming timed', () => {
      const dayStart = timelineWindow(CENTER, 'day').start;
      const midnight = daysBetween(dayStart, CENTER) * TIMELINE_DAY_WIDTH.day;
      const { root, handlers } = mount({
        view: timelineView({ timelineZoom: 'day' }),
        groups: single([row('r1', 'Gamma', CENTER)]),
      });

      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'day').days * TIMELINE_DAY_WIDTH.day, 400);
      pointer('pointerdown', bar(root, 'r1'), midnight + 300, 50);
      pointer('pointermove', document, midnight + 360, 50);

      expect(parseFloat(bar(root, 'r1').style.insetInlineStart)).toBeCloseTo(midnight + 75 * (TIMELINE_DAY_WIDTH.day / 1440) + 1.5, 5);
      expect(parseFloat(bar(root, 'r1').style.width)).toBeCloseTo(TIMELINE_DAY_WIDTH.day - 3, 5);

      pointer('pointerup', document, midnight + 360, 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T01:15/2026-10-10T01:15' });
    });

    // notion-motion.md Round 46 B: after a move the bar is left selected. Round 47 A3: a resized bar is selected mid-drag.
    it('leaves a moved bar selected, and not an unmoved one', () => {
      const landRow = vi.fn();
      const { root } = mount({ handlers: { ...makeHandlers(), landRow } });

      layOut(root);
      pointer('pointerdown', bar(root, 'r2'), xOf('2026-10-12'), 50);
      pointer('pointermove', document, xOf('2026-10-14'), 50);
      pointer('pointerup', document, xOf('2026-10-14'), 50);
      expect(landRow).toHaveBeenCalledWith('r2');
      expect(landRow).toHaveBeenCalledTimes(1);

      pointer('pointerdown', bar(root, 'r1'), xOf('2026-10-09'), 50);
      pointer('pointerup', document, xOf('2026-10-09'), 50);
      expect(landRow).toHaveBeenCalledTimes(1);
    });

    // notion-motion.md Round 48 A8: an edge press selects the bar at once, before any move, and it stays selected.
    it('selects a bar when its edge is pressed', () => {
      const landRow = vi.fn();
      const { root } = mount({ handlers: { ...makeHandlers(), landRow } });
      const end = bar(root, 'r1').querySelector('[data-blok-database-timeline-resize="end"]');

      layOut(root);
      if (end === null) throw new Error('no handle');
      pointer('pointerdown', end, xOf('2026-10-09'), 50);
      expect(landRow).toHaveBeenCalledWith('r1');
      pointer('pointermove', document, xOf('2026-10-11'), 50);
      pointer('pointermove', document, xOf('2026-10-12'), 50);
      pointer('pointerup', document, xOf('2026-10-12'), 50);
      expect(landRow).toHaveBeenCalledTimes(1);
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

  // notion-motion.md Timeline (tlhover.png): hovering a bar marks its days in the header at once.
  describe('bar hover marks its days in the header', () => {
    const range = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-blok-database-timeline-range]');
    const edges = (root: HTMLElement): Array<string | null> =>
      [...root.querySelectorAll('[data-blok-database-timeline-units] > [data-range-edge]')].map((el) => el.getAttribute('data-day'));
    const over = (target: Element, related: Element | null = null): void => {
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: related }));
    };
    const out = (target: Element, related: Element | null): void => {
      target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: related }));
    };

    it('shows the pill over the bar\'s days, with its first and last day in ink', () => {
      const { root } = mount();

      over(bar(root, 'r2'));

      expect(range(root)?.hasAttribute('data-hover')).toBe(true);
      expect(range(root)?.style.insetInlineStart).toBe(`${px('2026-10-12')}px`);
      expect(range(root)?.style.width).toBe(`${3 * TIMELINE_DAY_WIDTH.month}px`);
      expect(edges(root)).toEqual(['2026-10-12', '2026-10-14']);
    });

    it('keeps the pill while the pointer moves inside the bar, and drops it when the pointer leaves', () => {
      const { root } = mount();
      const title = bar(root, 'r2').querySelector('[data-blok-database-timeline-bar-title]');

      if (title === null) throw new Error('no title');
      over(bar(root, 'r2'));
      out(bar(root, 'r2'), title);
      expect(range(root)).not.toBeNull();

      out(title, canvas(root));
      expect(range(root)).toBeNull();
      expect(edges(root)).toEqual([]);
    });

    it('moves the pill to the next bar hovered', () => {
      const { root } = mount();

      over(bar(root, 'r2'));
      out(bar(root, 'r2'), bar(root, 'r1'));
      over(bar(root, 'r1'), bar(root, 'r2'));

      expect(range(root)?.style.insetInlineStart).toBe(`${px('2026-10-09')}px`);
      expect(edges(root)).toEqual(['2026-10-09']);
    });

    it('leaves a drag\'s pill alone when the pointer leaves the bar mid-drag', () => {
      const { root } = mount();

      rect(canvas(root), 0, 0, timelineWindow(CENTER, 'month').days * 40, 400);
      over(bar(root, 'r1'));
      pointer('pointerdown', bar(root, 'r1'), px('2026-10-09') + 20, 50);
      pointer('pointermove', document, px('2026-10-12') + 20, 50);
      out(bar(root, 'r1'), canvas(root));

      expect(range(root)?.hasAttribute('data-hover')).toBe(false);
      expect(edges(root)).toEqual(['2026-10-12']);
      pointer('pointerup', document, px('2026-10-12') + 20, 50);
    });
  });

  describe('hours zoom: 15-minute snap (research/22 §9)', () => {
    const hoursStart = timelineWindow(CENTER, 'hours').start;
    /** Canvas pixels to midnight of CENTER. */
    const midnight = daysBetween(hoursStart, CENTER) * TIMELINE_DAY_WIDTH.hours;
    const perMinute = TIMELINE_DAY_WIDTH.hours / 1440;
    const at = (minutes: number): number => midnight + minutes * perMinute;
    const startOf = (el: HTMLElement): number => parseFloat(el.style.insetInlineStart);
    const widthOf = (el: HTMLElement): number => parseFloat(el.style.width);
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

      expect(startOf(bar(root, 'r1'))).toBeCloseTo(at(188), 5);
      expect(widthOf(bar(root, 'r1'))).toBeCloseTo(60 * perMinute, 5);
      expect(bar(root, 'r1').hasAttribute('data-dragging')).toBe(true);
      expect(showReadout).not.toHaveBeenCalled();
    });

    it('snaps a left-edge resize live and shows the new start beside the edge', () => {
      const { root, handlers } = mountHours();
      const handle = handleOf(root, 'start');

      pointer('pointerdown', handle, at(181), 50);
      pointer('pointermove', document, at(173), 50);

      expect(startOf(bar(root, 'r1'))).toBeCloseTo(at(165), 5);
      expect(widthOf(bar(root, 'r1'))).toBeCloseTo(75 * perMinute, 5);
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

      expect(widthOf(bar(root, 'r1'))).toBeCloseTo(75 * perMinute, 5);
      expect(showReadout).toHaveBeenLastCalledWith(handle, 'Oct 9, 4:15 AM', expect.objectContaining({ placement: 'right' }));
      pointer('pointerup', document, at(247), 50);

      expect(handlers.writeDates).toHaveBeenCalledWith('r1', { start: '2026-10-09T03:00/2026-10-09T04:15' });
    });

    it('puts the bar back and hides the readout on Escape', () => {
      const { root, handlers } = mountHours();

      pointer('pointerdown', handleOf(root, 'start'), at(181), 50);
      pointer('pointermove', document, at(150), 50);
      key(document, 'Escape');

      expect(startOf(bar(root, 'r1'))).toBeCloseTo(at(180), 5);
      expect(widthOf(bar(root, 'r1'))).toBeCloseTo(60 * perMinute, 5);
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
