import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseCalendarView } from '../../../../src/tools/database/database-calendar-view';
import type { CalendarHandlers, DatabaseCalendarViewOptions } from '../../../../src/tools/database/database-calendar-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a2' },
];

const row = (id: string, title: string, due: string | null, extra: DatabaseRow['properties'] = {}): DatabaseRow =>
  ({ id, position: id, properties: { 'p-title': title, 'p-due': due, ...extra } });

const calendarView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Calendar', type: 'calendar', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const makeHandlers = (): CalendarHandlers => ({
  openRow: vi.fn(),
  addRow: vi.fn(),
  setDate: vi.fn(),
  navigate: vi.fn(),
});

const i18n = { t: (key: string) => key } as unknown as DatabaseCalendarViewOptions['i18n'];

interface Mounted {
  root: HTMLElement;
  handlers: CalendarHandlers;
  view: DatabaseCalendarView;
}

const mount = (overrides: Partial<DatabaseCalendarViewOptions> = {}): Mounted => {
  const handlers = makeHandlers();
  const view = new DatabaseCalendarView({
    readOnly: false,
    i18n,
    view: calendarView(),
    schema,
    rows: [row('r1', 'Launch', '2026-10-09'), row('r2', 'Trip', '2026-10-12/2026-10-14'), row('r3', 'Someday', null)],
    titlePropertyId: 'p-title',
    datePropertyId: 'p-due',
    anchor: '2026-10-09',
    today: '2026-10-09',
    weekStart: 0,
    locale: 'en-US',
    handlers,
    ...overrides,
  });
  const root = view.createView();

  document.body.appendChild(root);

  return { root, handlers, view };
};

const days = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-blok-database-calendar-day]')];
const day = (root: HTMLElement, iso: string): HTMLElement => {
  const found = days(root).find((el) => el.getAttribute('data-day') === iso);

  if (found === undefined) {
    throw new Error(`no day ${iso}`);
  }

  return found;
};
const events = (root: HTMLElement, rowId?: string): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('[data-blok-database-calendar-event]')]
    .filter((el) => rowId === undefined || el.getAttribute('data-row-id') === rowId);

const rect = (el: HTMLElement, left: number, top: number, width = 100, height = 100): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  });
};

/** Lays the grid out 100px a day, 100px a week, from the first shown day. */
const layOut = (root: HTMLElement): void => {
  const columns = root.querySelectorAll('[data-blok-database-calendar-week]')[0]?.querySelectorAll('[data-blok-database-calendar-day]').length ?? 7;

  days(root).forEach((el, i) => rect(el, (i % columns) * 100, Math.floor(i / columns) * 100));
};

const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
};

const key = (target: EventTarget, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
};

describe('DatabaseCalendarView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('month grid', () => {
    it('shows every week of the month from the week start, as a grid of days', () => {
      const { root } = mount();
      const all = days(root);

      expect(root.getAttribute('data-range')).toBe('month');
      expect(root.querySelector('[data-blok-database-calendar-grid]')?.getAttribute('role')).toBe('grid');
      expect(all).toHaveLength(35);
      expect(all[0].getAttribute('data-day')).toBe('2026-09-27');
      expect(all[34].getAttribute('data-day')).toBe('2026-10-31');
      expect(all[0].getAttribute('role')).toBe('gridcell');
    });

    it('starts the week on the configured day', () => {
      const { root } = mount({ weekStart: 1 });

      expect(days(root)[0].getAttribute('data-day')).toBe('2026-09-28');
      expect(root.querySelectorAll('[role="columnheader"]')).toHaveLength(7);
    });

    it('marks today, the days outside the month and the weekends', () => {
      const { root } = mount();

      expect(day(root, '2026-10-09').hasAttribute('data-today')).toBe(true);
      expect(day(root, '2026-10-08').hasAttribute('data-today')).toBe(false);
      expect(day(root, '2026-09-30').hasAttribute('data-outside')).toBe(true);
      expect(day(root, '2026-10-01').hasAttribute('data-outside')).toBe(false);
      expect(day(root, '2026-10-10').hasAttribute('data-weekend')).toBe(true);
      expect(day(root, '2026-10-09').hasAttribute('data-weekend')).toBe(false);
    });

    it('hides Saturday and Sunday when weekends are off', () => {
      const { root } = mount({ view: calendarView({ showWeekends: false }) });

      expect(days(root)).toHaveLength(25);
      expect(days(root).some((el) => el.hasAttribute('data-weekend'))).toBe(false);
      expect(root.querySelectorAll('[role="columnheader"]')).toHaveLength(5);
    });

    it('shows one week in week range', () => {
      const { root } = mount({ view: calendarView({ calendarRange: 'week' }) });

      expect(root.getAttribute('data-range')).toBe('week');
      expect(days(root).map((el) => el.getAttribute('data-day'))).toEqual([
        '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
      ]);
    });
  });

  describe('events', () => {
    it('puts each event in the cell of its first day, with its title', () => {
      const { root } = mount();
      const [launch] = events(root, 'r1');

      expect(launch.closest('[data-blok-database-calendar-day]')?.getAttribute('data-day')).toBe('2026-10-09');
      expect(launch.querySelector('[data-blok-database-calendar-event-title]')?.textContent).toBe('Launch');
    });

    it('leaves out rows with no date', () => {
      const { root } = mount();

      expect(events(root, 'r3')).toHaveLength(0);
    });

    it('spans a range across its days', () => {
      const { root } = mount();
      const [trip] = events(root, 'r2');

      expect(trip.style.getPropertyValue('--blok-database-calendar-span')).toBe('3');
      expect(trip.style.getPropertyValue('--blok-database-calendar-lane')).toBe('0');
    });

    it('splits a range at the end of a week row and marks the cut ends', () => {
      const { root } = mount({ rows: [row('r1', 'Long', '2026-10-09/2026-10-13')] });
      const parts = events(root, 'r1');

      expect(parts).toHaveLength(2);
      expect(parts[0].style.getPropertyValue('--blok-database-calendar-span')).toBe('2');
      expect(parts[0].hasAttribute('data-continues-after')).toBe(true);
      expect(parts[1].closest('[data-blok-database-calendar-day]')?.getAttribute('data-day')).toBe('2026-10-11');
      expect(parts[1].hasAttribute('data-continues-before')).toBe(true);
    });

    it('stacks overlapping events on lanes and makes the week tall enough', () => {
      const { root } = mount({ rows: [row('a', 'A', '2026-10-12/2026-10-14'), row('b', 'B', '2026-10-13')] });
      const week = day(root, '2026-10-13').closest<HTMLElement>('[data-blok-database-calendar-week]');

      expect(events(root, 'b')[0].style.getPropertyValue('--blok-database-calendar-lane')).toBe('1');
      expect(week?.style.getPropertyValue('--blok-database-calendar-lanes')).toBe('2');
    });

    it('shows visible properties on the event card and skips empty ones', () => {
      const properties = [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true }];
      const { root } = mount({
        view: calendarView({ properties }),
        rows: [row('r1', 'Launch', '2026-10-09', { 'p-notes': 'Bring cake' }), row('r2', 'Quiet', '2026-10-10')],
      });

      expect(events(root, 'r1')[0].querySelector('[data-blok-database-calendar-event-property]')?.textContent).toBe('Bring cake');
      expect(events(root, 'r2')[0].querySelector('[data-blok-database-calendar-event-property]')).toBeNull();
    });

    // Each shown property is its own card line, so lanes must grow by that many lines.
    it('tells the grid how many property lines a card can have', () => {
      const properties = [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true }];
      const lines = (root: HTMLElement): string => root.style.getPropertyValue('--blok-database-calendar-event-lines');

      expect(lines(mount({ view: calendarView({ properties }) }).root)).toBe('1');
      expect(lines(mount({ view: calendarView({ properties: [{ id: 'p-title', visible: true }] }) }).root)).toBe('0');
    });

    it('opens an event on click', () => {
      const { root, handlers } = mount();

      events(root, 'r1')[0].click();

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
    });

    // research/22 §1: Shift picks, Cmd/Ctrl does nothing.
    it('picks an event on Shift-click instead of opening it, and ignores Cmd/Ctrl-click', () => {
      const pickRow = vi.fn();
      const { root, handlers } = mount();

      handlers.pickRow = pickRow;
      events(root, 'r1')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      events(root, 'r1')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      events(root, 'r1')[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

      expect(pickRow).toHaveBeenCalledTimes(1);
      expect(pickRow).toHaveBeenCalledWith('r1');
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('marks its grid as picking its own items, so core leaves a Shift-click on an event to it', () => {
      const { root } = mount();

      expect(events(root, 'r1')[0].closest('[data-blok-selection-owner]')).toBe(root.querySelector('[data-blok-database-calendar-grid]'));
    });

    describe('a lasso core hands over (blok-lasso)', () => {
      const lasso = (root: HTMLElement, band: { left: number; top: number; right: number; bottom: number } | null): CustomEvent => {
        const event = new CustomEvent('blok-lasso', { cancelable: true, detail: { rect: band } });

        root.querySelector('[data-blok-database-calendar-grid]')?.dispatchEvent(event);

        return event;
      };

      it('picks every event the band touches, across days, and takes the band', () => {
        const lassoRows = vi.fn();
        const { root } = mount({ handlers: { ...makeHandlers(), lassoRows } });

        rect(events(root, 'r1')[0], 0, 0, 90, 20);
        events(root, 'r2').forEach((el) => rect(el, 300, 100, 290, 20));

        const event = lasso(root, { left: -50, top: 10, right: 320, bottom: 110 });

        expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2']);
        expect(event.defaultPrevented).toBe(true);

        lasso(root, { left: -50, top: 10, right: 50, bottom: 15 });
        expect(lassoRows).toHaveBeenLastCalledWith(['r1']);
      });

      it('drops its picks when the band leaves for other blocks', () => {
        const lassoRows = vi.fn();
        const { root } = mount({ handlers: { ...makeHandlers(), lassoRows } });

        lasso(root, null);

        expect(lassoRows).toHaveBeenLastCalledWith([]);
      });

      it('leaves the band to core when read-only', () => {
        const { root } = mount();

        expect(lasso(root, { left: 0, top: 0, right: 500, bottom: 500 }).defaultPrevented).toBe(false);
      });
    });

    describe('a drag box started inside the grid (research/23 §2c)', () => {
      const band = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-blok-database-calendar-lasso]');
      const setUp = (): Mounted & { lassoRows: ReturnType<typeof vi.fn> } => {
        const lassoRows = vi.fn();
        const mounted = mount({ handlers: { ...makeHandlers(), lassoRows } });

        layOut(mounted.root);
        rect(events(mounted.root, 'r1')[0], 505, 175, 90, 20);
        events(mounted.root, 'r2').forEach((el) => rect(el, 105, 230, 290, 20));

        return { ...mounted, lassoRows };
      };

      it('picks every event it touches across days, creates nothing, and the click after it opens nothing', () => {
        const { root, handlers, lassoRows } = setUp();
        const start = day(root, '2026-10-10');

        pointer('pointerdown', start, 650, 180);
        pointer('pointermove', document, 400, 200);
        expect(band(root)).not.toBeNull();
        pointer('pointermove', document, 150, 240);
        pointer('pointerup', document, 150, 240);
        start.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect([...(lassoRows.mock.lastCall?.[0] ?? [])].sort()).toEqual(['r1', 'r2']);
        expect(band(root)).toBeNull();
        expect(handlers.addRow).not.toHaveBeenCalled();
        expect(handlers.openRow).not.toHaveBeenCalled();
        expect(handlers.setDate).not.toHaveBeenCalled();
      });

      it('stops the text selection a drag in the grid would start', () => {
        const { root } = setUp();

        pointer('pointerdown', day(root, '2026-10-10'), 650, 180);
        const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });

        day(root, '2026-10-10').dispatchEvent(selectStart);
        pointer('pointerup', document, 650, 180);

        expect(selectStart.defaultPrevented).toBe(true);
      });

      it('a box that touches no event replaces the picks with nothing', () => {
        const { root, lassoRows } = setUp();

        pointer('pointerdown', day(root, '2026-10-24'), 650, 380);
        pointer('pointermove', document, 620, 360);
        pointer('pointerup', document, 620, 360);

        expect(lassoRows).toHaveBeenCalledExactlyOnceWith([]);
      });

      it('a press without a drag picks nothing', () => {
        const { root, lassoRows } = setUp();

        pointer('pointerdown', day(root, '2026-10-10'), 650, 180);
        pointer('pointerup', document, 651, 181);

        expect(lassoRows).not.toHaveBeenCalled();
        expect(band(root)).toBeNull();
      });

      it('read-only: draws no box', () => {
        const { root } = mount({ readOnly: true });

        layOut(root);
        pointer('pointerdown', day(root, '2026-10-10'), 650, 180);
        pointer('pointermove', document, 150, 240);

        expect(band(root)).toBeNull();
        pointer('pointerup', document, 150, 240);
      });
    });

    it('shows a comment badge after the title, out of the tab order', () => {
      const { root } = mount({ commentBadges: { databaseId: 'db', count: (rowId) => (rowId === 'r1' ? 3 : 0), open: vi.fn() } });
      const badge = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-calendar-event-title] + [data-blok-database-comment-badge]');

      expect(badge?.querySelector('[data-blok-database-comment-count]')?.textContent).toBe('3');
      expect(badge?.tabIndex).toBe(-1);
      expect(events(root, 'r2')[0].querySelector('[data-blok-database-comment-badge]')).toBeNull();
    });

    it('does not start a move from the comment badge', () => {
      const { root, handlers } = mount({ commentBadges: { databaseId: 'db', count: () => 1, open: vi.fn() } });
      const badge = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-comment-badge]');

      if (badge === null) throw new Error('no badge');
      layOut(root);
      pointer('pointerdown', badge, 550, 110);
      pointer('pointermove', document, 650, 110);
      pointer('pointerup', document, 650, 110);

      expect(handlers.setDate).not.toHaveBeenCalled();
    });

    it('shows a message instead of a grid when the database has no date property', () => {
      const { root } = mount({ datePropertyId: undefined });

      expect(root.querySelector('[data-blok-database-calendar-grid]')).toBeNull();
      expect(root.querySelector('[data-blok-database-calendar-empty]')?.textContent).toBe('tools.database.calendarNoDateProperty');
    });
  });

  describe('navigation', () => {
    it('goes to the previous and next month and back to today', () => {
      const { root, handlers } = mount({ anchor: '2026-12-20' });

      root.querySelector<HTMLElement>('[data-blok-database-calendar-prev]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-calendar-next]')?.click();
      root.querySelector<HTMLElement>('[data-blok-database-calendar-today]')?.click();

      expect(handlers.navigate).toHaveBeenNthCalledWith(1, '2026-11-01');
      expect(handlers.navigate).toHaveBeenNthCalledWith(2, '2027-01-01');
      expect(handlers.navigate).toHaveBeenNthCalledWith(3, '2026-10-09');
    });

    it('steps a week at a time in week range', () => {
      const { root, handlers } = mount({ view: calendarView({ calendarRange: 'week' }) });

      root.querySelector<HTMLElement>('[data-blok-database-calendar-next]')?.click();

      expect(handlers.navigate).toHaveBeenCalledWith('2026-10-16');
    });

    it('still navigates when read-only', () => {
      const { root, handlers } = mount({ readOnly: true });

      root.querySelector<HTMLElement>('[data-blok-database-calendar-next]')?.click();

      expect(handlers.navigate).toHaveBeenCalledWith('2026-11-01');
    });

    // research/28:129, pal/L-calendar.png: the button sits right before the previous arrow.
    it('shows "Manage in Calendar" before the previous arrow when the host gives it, and calls it on click, read-only too', () => {
      const manage = vi.fn();
      const { root } = mount({ readOnly: true, handlers: undefined, manageInCalendar: { label: 'Manage in Calendar', onClick: manage } });
      const button = root.querySelector<HTMLElement>('[data-blok-database-calendar-manage-calendar]');

      expect(button?.textContent?.trim()).toBe('Manage in Calendar');
      // research/30 B4: the calendar icon only; the "leaves this app" arrow is on the View settings row alone.
      expect(button?.querySelectorAll('svg')).toHaveLength(1);
      expect(button?.nextElementSibling?.hasAttribute('data-blok-database-calendar-prev')).toBe(true);
      button?.click();
      expect(manage).toHaveBeenCalledTimes(1);
    });

    it('has no "Manage in Calendar" without the host lever', () => {
      const { root } = mount();

      expect(root.querySelector('[data-blok-database-calendar-manage-calendar]')).toBeNull();
    });
  });

  describe('adding a row on a day', () => {
    // research/35 §6: "+" opens the new page in the view's open mode.
    it('offers "+" on each day that adds a row on that date and opens it', () => {
      const { root, handlers } = mount();

      day(root, '2026-10-20').querySelector<HTMLElement>('[data-blok-database-calendar-add]')?.click();

      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-20', true);
    });

    // research/31 §6: only a real double-click made a page dated that day, and opened it.
    const doubleClick = (target: HTMLElement, init: MouseEventInit = {}): void => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2, ...init }));
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2, ...init }));
    };

    it('a single click in a day cell adds nothing', () => {
      const { root, handlers } = mount();

      day(root, '2026-10-20').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      day(root, '2026-10-20').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

      expect(handlers.addRow).not.toHaveBeenCalled();
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('a double-click in a day cell adds one row on that date and opens it', () => {
      const { root, handlers } = mount();

      doubleClick(day(root, '2026-10-20'));

      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-20', true);
      expect(handlers.openRow).not.toHaveBeenCalled();
    });

    it('a double-click on the day number adds a row on that date too', () => {
      const { root, handlers } = mount();
      const number = day(root, '2026-10-08').querySelector<HTMLElement>('[data-blok-database-calendar-day-number]');

      if (number === null) throw new Error('no day number');
      doubleClick(number);

      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-08', true);
    });

    it('with events selected, a single click on an empty day clears the selection and adds nothing', () => {
      const lassoRows = vi.fn();
      const handlers = { ...makeHandlers(), lassoRows };
      const { root } = mount({ handlers });

      day(root, '2026-10-20').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

      expect(lassoRows).toHaveBeenCalledExactlyOnceWith([]);
      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    it('with events selected, a double-click on an empty day clears the selection and adds a row', () => {
      const lassoRows = vi.fn();
      const handlers = { ...makeHandlers(), lassoRows };
      const { root } = mount({ handlers });

      doubleClick(day(root, '2026-10-20'));

      expect(lassoRows).toHaveBeenCalledWith([]);
      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-20', true);
    });

    it('a double-click on an event opens it and adds nothing', () => {
      const { root, handlers } = mount();

      doubleClick(events(root, 'r1')[0]);

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    // Notion's double-click on "+" is unmeasured: only its clicks add.
    it('the dblclick event on "+" adds nothing of its own', () => {
      const { root, handlers } = mount();
      const add = day(root, '2026-10-20').querySelector<HTMLElement>('[data-blok-database-calendar-add]');

      if (add === null) throw new Error('no +');
      add.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));

      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    // research/35 §6: Shift and Alt double-clicks act as plain ones.
    it.each([
      ['Shift', { shiftKey: true }],
      ['Alt', { altKey: true }],
    ])('a %s-double-click in a day cell adds one row on that date and opens it', (_name, modifiers) => {
      const { root, handlers } = mount();

      doubleClick(day(root, '2026-10-20'), modifiers);

      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-20', true);
    });

    // Unmeasured in Notion (Cmd untried, Ctrl not read): kept as before.
    it.each([
      ['Cmd', { metaKey: true }],
      ['Ctrl', { ctrlKey: true }],
    ])('a %s-double-click in a day cell adds nothing', (_name, modifiers) => {
      const { root, handlers } = mount();

      doubleClick(day(root, '2026-10-20'), modifiers);

      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    it('a double-click whose first press closes an open menu only closes it', () => {
      const { root, handlers } = mount();
      const cell = day(root, '2026-10-20');
      const press = (detail: number): void => {
        cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
      };

      vi.spyOn(PopoverRegistry.instance, 'hasOpenPopovers').mockReturnValue(true);
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      vi.mocked(PopoverRegistry.instance.hasOpenPopovers).mockReturnValue(false);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      press(2);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));

      expect(handlers.addRow).not.toHaveBeenCalled();

      press(1);
      press(2);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));

      expect(handlers.addRow).toHaveBeenCalledExactlyOnceWith('2026-10-20', true);
    });

    it('read-only: a double-click in a day cell adds nothing', () => {
      const { root, handlers } = mount({ readOnly: true });

      doubleClick(day(root, '2026-10-20'));

      expect(handlers.addRow).not.toHaveBeenCalled();
    });

    it('has no "+" when read-only', () => {
      const { root } = mount({ readOnly: true });

      expect(root.querySelector('[data-blok-database-calendar-add]')).toBeNull();
    });
  });

  describe('keyboard', () => {
    it('makes one day tabbable: today when shown', () => {
      const { root } = mount();

      expect(days(root).filter((el) => el.tabIndex === 0).map((el) => el.getAttribute('data-day'))).toEqual(['2026-10-09']);
      expect(root.querySelector('[data-blok-database-calendar-grid]')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('moves between days with the arrow keys', () => {
      const { root } = mount();

      day(root, '2026-10-09').focus();
      key(document.activeElement ?? root, 'ArrowRight');
      expect(document.activeElement?.getAttribute('data-day')).toBe('2026-10-10');
      key(document.activeElement ?? root, 'ArrowDown');
      expect(document.activeElement?.getAttribute('data-day')).toBe('2026-10-17');
      key(document.activeElement ?? root, 'ArrowLeft');
      key(document.activeElement ?? root, 'ArrowUp');
      expect(document.activeElement?.getAttribute('data-day')).toBe('2026-10-09');
      expect(day(root, '2026-10-09').tabIndex).toBe(0);
      expect(day(root, '2026-10-17').tabIndex).toBe(-1);
    });

    it('flips Left and Right in a right-to-left editor', () => {
      const { root } = mount();

      root.setAttribute('dir', 'rtl');
      root.style.direction = 'rtl';
      day(root, '2026-10-09').focus();
      key(document.activeElement ?? root, 'ArrowRight');

      expect(document.activeElement?.getAttribute('data-day')).toBe('2026-10-08');
    });

    it('asks for the next range when an arrow leaves the grid', () => {
      const { root, handlers } = mount();

      day(root, '2026-10-31').focus();
      key(document.activeElement ?? root, 'ArrowRight');

      expect(handlers.navigate).toHaveBeenCalledWith('2026-11-01', '2026-11-01');
    });

    it('opens the first item of the day on Enter', () => {
      const { root, handlers } = mount();

      day(root, '2026-10-13').focus();
      key(document.activeElement ?? root, 'Enter');
      day(root, '2026-10-15').focus();
      key(document.activeElement ?? root, 'Enter');

      expect(handlers.openRow).toHaveBeenCalledTimes(1);
      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });

    it('focuses a day after a redraw when asked', async () => {
      const { root } = mount({ focusDay: '2026-10-21' });

      await Promise.resolve();

      expect(day(root, '2026-10-21')).toHaveFocus();
    });
  });

  describe('drag', () => {
    /** Sunday 2026-10-04 is column 0 of week row 1 (top 100). */
    it('moves an event to the day it is dropped on', () => {
      const { root, handlers } = mount();

      layOut(root);
      const launch = events(root, 'r1')[0];

      pointer('pointerdown', launch, 550, 110);
      pointer('pointermove', document, 350, 210);
      expect(day(root, '2026-10-14').getAttribute('data-drop')).toBe('');
      pointer('pointerup', document, 350, 210);

      expect(handlers.setDate).toHaveBeenCalledWith('r1', '2026-10-14');
      expect(handlers.openRow).not.toHaveBeenCalled();
      expect(day(root, '2026-10-14').hasAttribute('data-drop')).toBe(false);
    });

    it('keeps Cmd+Z from the editor while an event is dragged', () => {
      const { root } = mount();

      layOut(root);
      pointer('pointerdown', events(root, 'r1')[0], 550, 110);
      pointer('pointermove', document, 350, 210);
      const undo = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true });

      document.dispatchEvent(undo);
      pointer('pointerup', document, 350, 210);

      expect(undo.defaultPrevented).toBe(true);
    });

    it('keeps the range length and the grabbed day under the pointer', () => {
      const { root, handlers } = mount();

      layOut(root);
      // Trip is Mon 12 → Wed 14 (row 2). Grab it on Tue 13 and drop on Fri 23.
      pointer('pointerdown', events(root, 'r2')[0], 250, 210);
      pointer('pointermove', document, 550, 310);
      pointer('pointerup', document, 550, 310);

      expect(handlers.setDate).toHaveBeenCalledWith('r2', '2026-10-22/2026-10-24');
    });

    it('drags the end edge to span more days', () => {
      const { root, handlers } = mount();

      layOut(root);
      const handle = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-calendar-resize="end"]');

      expect(handle).not.toBeNull();
      pointer('pointerdown', handle ?? root, 595, 110);
      pointer('pointermove', document, 150, 210);
      pointer('pointerup', document, 150, 210);

      expect(handlers.setDate).toHaveBeenCalledWith('r1', '2026-10-09/2026-10-12');
    });

    it('stretches the event live while its edge is dragged, with no day tint, and snaps back on Escape', () => {
      const { root } = mount();

      layOut(root);
      const handle = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-calendar-resize="end"]');

      pointer('pointerdown', handle ?? root, 595, 110);
      pointer('pointermove', document, 150, 210);

      // Fri 9 → Mon 12 crosses the week break: two parts of two days.
      const parts = events(root, 'r1');

      expect(parts.map((el) => el.style.getPropertyValue('--blok-database-calendar-span'))).toEqual(['2', '2']);
      expect(parts[0].hasAttribute('data-continues-after')).toBe(true);
      expect(root.querySelector('[data-drop]')).toBeNull();
      expect(root.getAttribute('data-dragging')).toBe('end');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(events(root, 'r1').map((el) => el.style.getPropertyValue('--blok-database-calendar-span'))).toEqual(['1']);
    });

    it('a move keeps the event in place and drags a ghost copy that follows the pointer', () => {
      const { root } = mount();

      layOut(root);
      const grid = root.querySelector<HTMLElement>('[data-blok-database-calendar-grid]');

      if (grid !== null) rect(grid, 0, 0, 700, 600);
      const launch = events(root, 'r1')[0];

      rect(launch, 504, 132, 92, 28);
      launch.setAttribute('data-blok-database-row-selected', '');
      pointer('pointerdown', launch, 550, 140);
      pointer('pointermove', document, 357, 213);

      const ghost = root.querySelector<HTMLElement>('[data-blok-database-calendar-ghost]');

      expect(ghost).not.toBeNull();
      expect(ghost?.getAttribute('aria-hidden')).toBe('true');
      expect(ghost?.hasAttribute('data-blok-database-row-selected')).toBe(false);
      expect(ghost?.hasAttribute('data-blok-database-calendar-event')).toBe(false);
      // Unsnapped: the grab point stays under the pointer.
      expect(ghost?.style.left).toBe('311px');
      expect(ghost?.style.top).toBe('205px');
      expect(events(root, 'r1')).toEqual([launch]);
      expect(day(root, '2026-10-14').getAttribute('data-drop')).toBe('');

      pointer('pointerup', document, 357, 213);
      expect(root.querySelector('[data-blok-database-calendar-ghost]')).toBeNull();
    });

    it('drags the start edge earlier', () => {
      const { root, handlers } = mount();

      layOut(root);
      const handle = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-calendar-resize="start"]');

      pointer('pointerdown', handle ?? root, 505, 110);
      pointer('pointermove', document, 250, 110);
      pointer('pointerup', document, 250, 110);

      expect(handlers.setDate).toHaveBeenCalledWith('r1', '2026-10-06/2026-10-09');
    });

    it('still opens the next clicked event after a drag that ended outside the calendar', async () => {
      const { root, handlers } = mount();

      layOut(root);
      pointer('pointerdown', events(root, 'r1')[0], 550, 110);
      pointer('pointermove', document, 350, 210);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      pointer('pointerup', document, 2000, 2000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events(root, 'r2')[0].click();

      expect(handlers.openRow).toHaveBeenCalledWith('r2');
    });

    it('has no resize handle on a cut end', () => {
      const { root } = mount({ rows: [row('r1', 'Long', '2026-10-09/2026-10-13')] });
      const [first, second] = events(root, 'r1');

      expect(first.querySelector('[data-blok-database-calendar-resize="end"]')).toBeNull();
      expect(first.querySelector('[data-blok-database-calendar-resize="start"]')).not.toBeNull();
      expect(second.querySelector('[data-blok-database-calendar-resize="start"]')).toBeNull();
    });

    it('writes nothing when dropped on the day it started on, or after Escape', () => {
      const { root, handlers } = mount();

      layOut(root);
      const launch = events(root, 'r1')[0];

      pointer('pointerdown', launch, 550, 110);
      pointer('pointermove', document, 560, 120);
      pointer('pointerup', document, 560, 120);
      pointer('pointerdown', launch, 550, 110);
      pointer('pointermove', document, 350, 210);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      pointer('pointerup', document, 350, 210);

      expect(handlers.setDate).not.toHaveBeenCalled();
    });

    it('does not drag when read-only, and reports a drag as interacting', () => {
      const readOnly = mount({ readOnly: true });

      layOut(readOnly.root);
      expect(readOnly.root.querySelector('[data-blok-database-calendar-resize]')).toBeNull();
      pointer('pointerdown', events(readOnly.root, 'r1')[0], 550, 110);
      pointer('pointermove', document, 350, 210);
      pointer('pointerup', document, 350, 210);
      expect(readOnly.handlers.setDate).not.toHaveBeenCalled();

      const { root, view } = mount();

      layOut(root);
      pointer('pointerdown', events(root, 'r1')[0], 550, 110);
      pointer('pointermove', document, 350, 210);
      expect(view.interacting).toBe(true);
      view.destroy();
      expect(view.interacting).toBe(false);
    });
  });
  describe('"No date" (research/08, findings C04)', () => {
    const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid="database-no-date"]');
    const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-no-date-row]')];
    const openPanel = (view: DatabaseCalendarView): HTMLElement => {
      const anchor = document.createElement('button');

      document.body.appendChild(anchor);
      view.noDateControl()?.open(anchor);

      return anchor;
    };

    it('leaves the month bar to the arrows: the count is a control for the database toolbar', () => {
      const { root, view } = mount();

      expect(root.querySelector('[data-blok-database-calendar-no-date]')).toBeNull();
      expect(view.noDateControl()?.count).toBe(1);
      expect(view.noDateControl()?.label).toBe('tools.database.calendarNoDate');
    });

    it('has no control when every row has a date, or when read-only', () => {
      expect(mount({ rows: [row('r1', 'Launch', '2026-10-09')] }).view.noDateControl()).toBeUndefined();
      expect(mount({ readOnly: true }).view.noDateControl()).toBeUndefined();
    });

    it('opens a 320px popover with a focused search, the hint and each undated page with "Open"', () => {
      const { view, handlers } = mount();

      openPanel(view);
      const search = panel()?.querySelector<HTMLInputElement>('input');

      expect(panel()?.style.width).toBe('320px');
      expect(search).toHaveFocus();
      expect(search?.placeholder).toBe('tools.database.noDateSearch');
      expect(panel()?.textContent).toContain('tools.database.calendarNoDateHint');
      expect(items().map((el) => el.querySelector('[data-blok-database-no-date-title]')?.textContent)).toEqual(['Someday']);
      expect(items()[0].querySelector('[data-blok-database-page-icon-placeholder]')).not.toBeNull();
      items()[0].querySelector<HTMLElement>('[data-blok-database-no-date-open]')?.click();
      expect(handlers.openRow).toHaveBeenCalledWith('r3');
      expect(handlers.setDate).not.toHaveBeenCalled();
    });

    it('filters the pages by the search', () => {
      const { view } = mount({ rows: [row('r3', 'Someday', null), row('r4', 'Maybe', null)] });

      openPanel(view);
      const search = panel()?.querySelector<HTMLInputElement>('input');

      if (search === null || search === undefined) throw new Error('no search');
      search.value = 'may';
      search.dispatchEvent(new Event('input'));
      expect(items().map((el) => el.querySelector('[data-blok-database-no-date-title]')?.textContent)).toEqual(['Maybe']);
    });

    it('dates a clicked page today', () => {
      const { view, handlers } = mount();

      openPanel(view);
      items()[0].click();
      expect(handlers.setDate).toHaveBeenCalledWith('r3', '2026-10-09');
      expect(panel()).toBeNull();
    });

    it('dates a page dragged from the popover onto a day, and closes the popover as the drag starts', () => {
      const { root, view, handlers } = mount();

      layOut(root);
      openPanel(view);
      pointer('pointerdown', items()[0], 900, 10);
      pointer('pointermove', document, 350, 210);
      expect(panel()).toBeNull();
      expect(day(root, '2026-10-14').getAttribute('data-drop')).toBe('');
      pointer('pointerup', document, 350, 210);

      expect(handlers.setDate).toHaveBeenCalledWith('r3', '2026-10-14');
      expect(handlers.openRow).not.toHaveBeenCalled();
    });
  });
});
