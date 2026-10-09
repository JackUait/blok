import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DatabaseCalendarView } from '../../../../src/tools/database/database-calendar-view';
import type { CalendarHandlers, DatabaseCalendarViewOptions } from '../../../../src/tools/database/database-calendar-view';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

    it('opens an event on click', () => {
      const { root, handlers } = mount();

      events(root, 'r1')[0].click();

      expect(handlers.openRow).toHaveBeenCalledWith('r1');
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
  });

  describe('adding a row on a day', () => {
    it('offers "+" on each day that adds a row on that date', () => {
      const { root, handlers } = mount();

      day(root, '2026-10-20').querySelector<HTMLElement>('[data-blok-database-calendar-add]')?.click();

      expect(handlers.addRow).toHaveBeenCalledWith('2026-10-20');
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

    it('drags the start edge earlier', () => {
      const { root, handlers } = mount();

      layOut(root);
      const handle = events(root, 'r1')[0].querySelector<HTMLElement>('[data-blok-database-calendar-resize="start"]');

      pointer('pointerdown', handle ?? root, 505, 110);
      pointer('pointermove', document, 250, 110);
      pointer('pointerup', document, 250, 110);

      expect(handlers.setDate).toHaveBeenCalledWith('r1', '2026-10-06/2026-10-09');
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
});
