import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';
import en from '../../../../../src/components/i18n/locales/en.json';
import type { DateReminderOffset, PropertyDefinition } from '../../../../../src/tools/database/types';

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = editorRoot()?.querySelector<T>(selector);

  if (el === null || el === undefined) {
    throw new Error(`missing ${selector}`);
  }

  return el;
};

const day = (iso: string): HTMLElement => q(`[data-blok-database-date-day="${iso}"]`);
const monthLabel = (): string => q('[data-blok-database-date-month]').textContent ?? '';
const weekdays = (): string[] =>
  [...(editorRoot()?.querySelectorAll('[data-blok-database-date-weekday]') ?? [])].map((w) => w.getAttribute('data-day') ?? '');
const firstGridDay = (): string =>
  editorRoot()?.querySelector('[data-blok-database-date-day]')?.getAttribute('data-blok-database-date-day') ?? '';

const typeInto = (input: HTMLInputElement, text: string): void => {
  Object.assign(input, { value: text });
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const openDate = (value: string | null, overrides: Partial<CellEditorContext> = {}, anchor = makeAnchor()): CellEditorContext => {
  const ctx = makeEditorContext(overrides);

  openCellEditor(makeProperty('date'), value, anchor, ctx);

  return ctx;
};

describe('date cell editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 10, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens on the month of the value with that day selected', () => {
    openDate('2026-03-14');

    expect(monthLabel()).toBe('March 2026');
    expect(day('2026-03-14').getAttribute('aria-selected')).toBe('true');
    expect(day('2026-03-15').getAttribute('aria-selected')).toBe('false');
  });

  it('opens on the current month when empty, and marks today', () => {
    openDate(null);

    expect(monthLabel()).toBe('October 2026');
    expect(day('2026-10-09').hasAttribute('data-today')).toBe(true);
  });

  it('starts the week on the given day', () => {
    openDate('2026-10-09', { weekStart: 1 });

    expect(weekdays()[0]).toBe('1');
    expect(firstGridDay()).toBe('2026-09-28');
  });

  it('starts the week on Sunday when told to', () => {
    openDate('2026-10-09', { weekStart: 0 });

    expect(weekdays()[0]).toBe('0');
    expect(firstGridDay()).toBe('2026-09-27');
  });

  it('clicking a day commits it as YYYY-MM-DD and keeps the picker open', () => {
    const ctx = openDate('2026-10-09');

    day('2026-10-20').click();

    expect(ctx.onCommit).toHaveBeenCalledWith('2026-10-20');
    expect(editorRoot()).not.toBeNull();
    expect(day('2026-10-20').getAttribute('aria-selected')).toBe('true');
  });

  it('previous and next move by a month', () => {
    openDate('2026-01-15');

    q('[data-blok-database-date-prev]').click();
    expect(monthLabel()).toBe('December 2025');
    q('[data-blok-database-date-next]').click();
    q('[data-blok-database-date-next]').click();
    expect(monthLabel()).toBe('February 2026');
  });

  it('Today picks today and shows its month', () => {
    const ctx = openDate('2025-05-01');

    q('[data-blok-database-date-today]').click();

    expect(ctx.onCommit).toHaveBeenCalledWith('2026-10-09');
    expect(monthLabel()).toBe('October 2026');
  });

  it('a typed date commits on Enter and moves the calendar', () => {
    const ctx = openDate('2026-10-09');
    const input = q<HTMLInputElement>('[data-blok-database-date-input="start"]');

    typeInto(input, '2026-12-25');
    press(input, 'Enter');

    expect(ctx.onCommit).toHaveBeenCalledWith('2026-12-25');
    expect(monthLabel()).toBe('December 2026');
  });

  it('a typed entry that is not a date is rejected', () => {
    const ctx = openDate('2026-10-09');
    const input = q<HTMLInputElement>('[data-blok-database-date-input="start"]');

    typeInto(input, 'soon');
    press(input, 'Enter');

    expect(ctx.onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('typing alone commits nothing until Enter or leaving the field', () => {
    const ctx = openDate('2026-10-09');

    typeInto(q<HTMLInputElement>('[data-blok-database-date-input="start"]'), '2026-11-01');

    expect(ctx.onCommit).not.toHaveBeenCalled();
  });

  it('Clear commits null and closes', () => {
    const ctx = openDate('2026-10-09');

    q('[data-blok-database-date-clear]').click();

    expect(ctx.onCommit).toHaveBeenCalledWith(null);
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes and keeps what was picked', () => {
    const ctx = openDate('2026-10-09');

    day('2026-10-11').click();
    press(day('2026-10-11'), 'Escape');

    expect(ctx.onCommit).toHaveBeenCalledTimes(1);
    expect(ctx.onCancel).not.toHaveBeenCalled();
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
  });

  describe('range', () => {
    it('turning End date on makes a one-day range, and the next click sets the end', () => {
      const ctx = openDate('2026-10-09');

      q('[data-blok-database-date-end-toggle]').click();
      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09/2026-10-09');

      day('2026-10-12').click();
      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09/2026-10-12');
      expect(day('2026-10-10').hasAttribute('data-in-range')).toBe(true);
      expect(q<HTMLInputElement>('[data-blok-database-date-input="end"]')).toBeTruthy();
    });

    it('a click before the start moves the start', () => {
      const ctx = openDate('2026-10-09/2026-10-12');

      day('2026-10-02').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-02/2026-10-12');
    });

    it('turning End date off keeps only the start', () => {
      const ctx = openDate('2026-10-09/2026-10-12');

      expect(q('[data-blok-database-date-end-toggle]').getAttribute('aria-checked')).toBe('true');
      q('[data-blok-database-date-end-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09');
    });
  });

  describe('time', () => {
    it('Include time adds a time to the value', () => {
      const ctx = openDate('2026-10-12');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-12T09:00');
    });

    // research/27 §4b: today decides, not empty vs set. A set date that is today got 8:00 PM at 19:01.
    it('Include time gives a set date that is today the next whole hour', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 19, 1, 49));
      const ctx = openDate('2026-10-20');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-20T20:00');
    });

    it('Include time on an empty cell at 19:01 takes 20:00', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 19, 1, 31));
      const ctx = openDate(null);

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-20').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-20T20:00');
    });

    // research/26 §5d, 27 §4b: a set date on another day gets 9:00 AM.
    it('Include time gives a set date on another day 9:00', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 13, 58));
      const ctx = openDate('2026-10-12');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-12T09:00');
    });

    // research/26 §5d: an empty cell gets the next whole hour (1:58 PM gave 2:00 PM, 5:49 AM gave 6:00 AM).
    it('Include time on an empty cell takes the next whole hour', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 13, 58));
      const ctx = openDate(null, { hourCycle: 'h23' });

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-20').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-20T14:00');
      expect(q<HTMLInputElement>('[data-blok-database-date-time="start"]').value).toBe('14:00');
    });

    it('Include time on an empty cell at 5:49 takes 6:00', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 5, 49));
      const ctx = openDate(null);

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-22').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-22T06:00');
    });

    // Unmeasured edges (research/27 §4b): on the hour still moves to the next one; after 23:00 it wraps to 00:00 on the picked day.
    it('the next whole hour after 14:00 is 15:00, and after 23:30 is 00:00 on the picked day', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 14, 0));
      const onHour = openDate(null);

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-20').click();
      expect(onHour.onCommit).toHaveBeenLastCalledWith('2026-10-20T15:00');

      document.body.innerHTML = '';
      PopoverRegistry.resetForTests();
      vi.setSystemTime(new Date(2026, 9, 20, 23, 30));
      const late = openDate(null);

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-20').click();
      expect(late.onCommit).toHaveBeenLastCalledWith('2026-10-20T00:00');

      document.body.innerHTML = '';
      PopoverRegistry.resetForTests();
      const lateSet = openDate('2026-10-20');

      q('[data-blok-database-date-time-toggle]').click();
      expect(lateSet.onCommit).toHaveBeenLastCalledWith('2026-10-20T00:00');
    });

    // The bulk picker opens on the first selected row's value: an empty one counts as today, another day takes 9:00.
    it('the bulk picker follows the first row: empty takes the next hour, a set date 9:00', () => {
      vi.setSystemTime(new Date(2026, 9, 20, 13, 58));
      const empty = openDate(null, { bulk: true });

      q('[data-blok-database-date-time-toggle]').click();
      day('2026-10-21').click();
      expect(empty.onCommit).toHaveBeenLastCalledWith('2026-10-21T14:00');

      document.body.innerHTML = '';
      PopoverRegistry.resetForTests();
      const set = openDate('2026-10-12', { bulk: true });

      q('[data-blok-database-date-time-toggle]').click();
      expect(set.onCommit).toHaveBeenLastCalledWith('2026-10-12T09:00');
    });

    it('a typed 24-hour time commits', () => {
      const ctx = openDate('2026-10-09T09:00', { hourCycle: 'h23' });
      const time = q<HTMLInputElement>('[data-blok-database-date-time="start"]');

      expect(time.value).toBe('09:00');
      typeInto(time, '17:45');
      press(time, 'Enter');

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09T17:45');
    });

    it('shows and reads 12-hour time when the locale uses it', () => {
      const ctx = openDate('2026-10-09T14:30', { hourCycle: 'h12' });
      const time = q<HTMLInputElement>('[data-blok-database-date-time="start"]');

      expect(time.value).toBe('2:30 PM');
      typeInto(time, '12:15 am');
      press(time, 'Enter');

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09T00:15');
    });

    it('picking a day keeps the time', () => {
      const ctx = openDate('2026-10-09T14:30');

      day('2026-10-10').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-10T14:30');
    });

    // research/23 §1: with Include time on, the calendar's "Today" reads "Now".
    it('with a time, Today reads Now and sets the current time', () => {
      const dict = en as Record<string, string>;
      const ctx = openDate('2025-05-01T14:30', { i18n: { t: (key: string) => dict[key] ?? key } });
      const button = q('[data-blok-database-date-today]');

      expect(button.textContent).toBe('Now');
      button.click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09T10:30');
      expect(monthLabel()).toBe('October 2026');
      expect(q<HTMLInputElement>('[data-blok-database-date-time="start"]').value).toBe('10:30');
      q('[data-blok-database-date-time-toggle]').click();
      expect(q('[data-blok-database-date-today]').textContent).toBe('Today');
    });

    it('turning Include time off drops the time', () => {
      const ctx = openDate('2026-10-09T14:30');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09');
    });
  });

  describe('keyboard', () => {
    it('arrows move the focused day; Enter picks it', () => {
      const ctx = openDate('2026-10-09');
      const grid = q('[data-blok-database-date-grid]');

      day('2026-10-09').focus();
      press(document.activeElement ?? grid, 'ArrowRight');
      press(document.activeElement ?? grid, 'ArrowDown');
      expect(document.activeElement?.getAttribute('data-blok-database-date-day')).toBe('2026-10-17');
      press(document.activeElement ?? grid, 'Enter');

      expect(ctx.onCommit).toHaveBeenCalledWith('2026-10-17');
    });

    it('moving past the month edge turns the page', () => {
      openDate('2026-10-31');

      day('2026-10-31').focus();
      press(document.activeElement ?? document.body, 'ArrowDown');

      expect(monthLabel()).toBe('November 2026');
      expect(document.activeElement?.getAttribute('data-blok-database-date-day')).toBe('2026-11-07');
    });

    it('left and right swap in right-to-left text', () => {
      const anchor = makeAnchor();

      anchor.style.direction = 'rtl';
      openDate('2026-10-09', {}, anchor);
      day('2026-10-09').focus();
      press(document.activeElement ?? document.body, 'ArrowLeft');

      expect(document.activeElement?.getAttribute('data-blok-database-date-day')).toBe('2026-10-10');
    });

    it('only the focused day is a tab stop', () => {
      openDate('2026-10-09');

      const stops = [...(editorRoot()?.querySelectorAll('[data-blok-database-date-day]') ?? [])].filter((d) => d.getAttribute('tabindex') === '0');

      expect(stops.map((d) => d.getAttribute('data-blok-database-date-day'))).toEqual(['2026-10-09']);
    });
  });

  describe('Remind (research/17 §1)', () => {
    const dict = en as Record<string, string>;
    const i18n = { t: (key: string, vars?: Record<string, string | number>): string =>
      Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), dict[key] ?? key) };
    const remindRow = (): HTMLButtonElement => q<HTMLButtonElement>('[data-blok-database-date-remind]');
    const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-date-remind-menu]');
    const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? '';
    const rowText = (): string => text(remindRow());
    const menuLabels = (): string[] => [...(menu()?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((item) => text(item));
    const pick = (label: string): void => {
      [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])].find((item) => text(item) === label)?.click();
    };
    const openRemind = (
      value: string | null,
      reminder?: DateReminderOffset,
      overrides: Partial<CellEditorContext> = {},
      property: PropertyDefinition = makeProperty('date')
    ): CellEditorContext => {
      const ctx = makeEditorContext({ i18n, hourCycle: 'h12', onReminderChange: vi.fn(), ...(reminder !== undefined ? { reminder } : {}), ...overrides });

      openCellEditor(property, value, makeAnchor(), ctx);

      return ctx;
    };

    it('has no Remind row when the host cannot store a reminder', () => {
      openDate('2026-10-09');

      expect(editorRoot()?.querySelector('[data-blok-database-date-remind]')).toBeNull();
    });

    it('sits just above Clear and reads None by default', () => {
      openRemind('2026-10-09');

      const options = [...q('[data-blok-database-date-options]').children];

      expect(options.indexOf(remindRow())).toBeLessThan(options.indexOf(q('[data-blok-database-date-clear]')));
      expect(rowText()).toBe('RemindNone');
    });

    it('lists the date-only reminders, with the 9:00 AM time', () => {
      openRemind('2026-10-09');
      remindRow().click();

      expect(menuLabels()).toEqual(['None', 'On day of event (9:00 AM)', '1 day before (9:00 AM)', '2 days before (9:00 AM)', '1 week before (9:00 AM)']);
    });

    it('lists the date-and-time reminders when the value has a time', () => {
      openRemind('2026-10-09T14:00');
      remindRow().click();

      expect(menuLabels()).toEqual([
        'None', 'At time of event', '5 minutes before', '10 minutes before', '15 minutes before', '30 minutes before',
        '1 hour before', '2 hours before', '1 day before (9:00 AM)', '2 days before (9:00 AM)',
      ]);
    });

    it('writes the 9:00 time on the 24-hour clock', () => {
      openRemind('2026-10-09', undefined, { hourCycle: 'h23' });
      remindRow().click();

      expect(menuLabels()[1]).toBe('On day of event (09:00)');
    });

    it('checks the current reminder', () => {
      openRemind('2026-10-09', '2_days_before');
      remindRow().click();

      const checked = menu()?.querySelectorAll('[aria-checked="true"]');

      expect([...(checked ?? [])].map((item) => text(item))).toEqual(['2 days before (9:00 AM)']);
    });

    it('a pick stores the reminder, closes the menu and shows it without the time', () => {
      const ctx = openRemind('2026-10-09');

      remindRow().click();
      pick('1 day before (9:00 AM)');

      expect(ctx.onReminderChange).toHaveBeenCalledWith('1_day_before', true);
      expect(menu()).toBeNull();
      expect(rowText()).toBe('Remind1 day before');
      expect(ctx.onCommit).not.toHaveBeenCalled();
    });

    it('None removes the reminder', () => {
      const ctx = openRemind('2026-10-09', '1_day_before');

      remindRow().click();
      pick('None');

      expect(ctx.onReminderChange).toHaveBeenCalledWith(null, true);
    });

    it('Escape closes the menu first, then the picker', () => {
      const ctx = openRemind('2026-10-09');

      remindRow().click();
      press(document.activeElement ?? document.body, 'Escape');

      expect(menu()).toBeNull();
      expect(ctx.onClose).not.toHaveBeenCalled();
      press(document.activeElement ?? document.body, 'Escape');
      expect(ctx.onClose).toHaveBeenCalledTimes(1);
    });

    // The host drops a cleared date's reminder in the same write, so one undo restores both.
    it('Clear leaves the reminder to the host that clears the date', () => {
      const ctx = openRemind('2026-10-09', '1_day_before');

      q('[data-blok-database-date-clear]').click();

      expect(ctx.onReminderChange).not.toHaveBeenCalled();
      expect(ctx.onCommit).toHaveBeenCalledWith(null);
    });

    it('turning Include time on drops a reminder the timed list has not got', () => {
      const ctx = openRemind('2026-10-09', '1_week_before');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onReminderChange).toHaveBeenCalledWith(null, false);
      expect(rowText()).toBe('RemindNone');
    });

    it('turning Include time on keeps a reminder both lists have', () => {
      const ctx = openRemind('2026-10-09', '1_day_before');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onReminderChange).not.toHaveBeenCalled();
      expect(rowText()).toBe('Remind1 day before');
    });

    describe('the property default (research/17 §1d)', () => {
      const withDefault = (): PropertyDefinition => ({ ...makeProperty('date'), date: { defaultReminder: '1_week_before' } });

      it('an empty cell starts on the default and the first date stores it', () => {
        const ctx = openRemind(null, undefined, {}, withDefault());

        expect(rowText()).toBe('Remind1 week before');
        day('2026-10-20').click();

        expect(ctx.onCommit).toHaveBeenCalledWith('2026-10-20');
        expect(ctx.onReminderChange).toHaveBeenCalledWith('1_week_before', false);
      });

      it('a pick made before the first date arrives with it as the user\'s pick', () => {
        const ctx = openRemind(null, undefined, {}, withDefault());

        remindRow().click();
        pick('1 day before (9:00 AM)');
        expect(ctx.onReminderChange).not.toHaveBeenCalled();
        day('2026-10-20').click();

        expect(ctx.onReminderChange).toHaveBeenCalledWith('1_day_before', true);
      });

      it('leaves a date that already has a value alone', () => {
        const ctx = openRemind('2026-10-09', undefined, {}, withDefault());

        expect(rowText()).toBe('RemindNone');
        day('2026-10-20').click();

        expect(ctx.onReminderChange).not.toHaveBeenCalled();
      });
    });
  });

  // research/22 §4, notion-measure12/17-date-edit and notion-measure8/16-time-on: Notion's picker
  // rows top to bottom are End date, Date format, Include time, [Time format, Timezone], Remind, Clear.
  // research/26 §5e: the field shows the date in the property's Date format ("Oct 12" for Short date).
  describe('field follows the Date format', () => {
    const openFormat = (value: string, dateFormat: NonNullable<PropertyDefinition['date']>['dateFormat']): CellEditorContext => {
      const ctx = makeEditorContext({ onDateDisplayChange: vi.fn() });

      openCellEditor({ ...makeProperty('date'), date: { dateFormat } }, value, makeAnchor(), ctx);

      return ctx;
    };
    const field = (): HTMLInputElement => q<HTMLInputElement>('[data-blok-database-date-input="start"]');

    it.each([
      // research/27 §4a: the field writes Full date with the short month; the cell keeps the long one.
      ['full', '2026-06-05', 'Jun 5, 2026'],
      ['full', '2027-03-04', 'Mar 4, 2027'],
      ['short', '2026-06-05', 'Jun 5'],
      ['short', '2025-10-12', 'Oct 12'],
      ['short', '2027-03-04', 'Mar 4'],
      ['month_day_year', '2026-06-05', '06/05/2026'],
      ['day_month_year', '2026-06-05', '05/06/2026'],
      ['year_month_day', '2026-06-05', '2026/06/05'],
      ['relative', '2026-10-10', 'Tomorrow'],
      ['relative', '2026-06-05', 'Jun 5, 2026'],
    ] as const)('%s shows %s as %s', (format, value, shown) => {
      openFormat(value, format);

      expect(field().value).toBe(shown);
    });

    it.each([
      ['full', '2026-06-05'],
      ['short', '2025-10-12'],
      ['short', '2026-06-05'],
      ['short', '2027-03-04'],
      ['relative', '2026-06-05'],
      ['month_day_year', '2026-06-05'],
      ['day_month_year', '2026-06-05'],
      ['year_month_day', '2026-06-05'],
      ['relative', '2026-10-08'],
    ] as const)('%s: Enter on the shown text keeps %s', (format, value) => {
      const ctx = openFormat(value, format);

      press(field(), 'Enter');

      expect(field().getAttribute('aria-invalid')).toBeNull();
      for (const [written] of vi.mocked(ctx.onCommit).mock.calls) {
        expect(written).toBe(value);
      }
    });

    it.each([
      ['short', '2025-10-12', 'Oct 20', '2025-10-20'],
      ['month_day_year', '2026-06-05', '07/04/2026', '2026-07-04'],
      ['day_month_year', '2026-06-05', '04/07/2026', '2026-07-04'],
      ['year_month_day', '2026-06-05', '2026/07/04', '2026-07-04'],
      ['relative', '2026-06-05', 'Yesterday', '2026-10-08'],
      ['day_month_year', '2026-06-05', '2026-07-04', '2026-07-04'],
    ] as const)('%s: typing %s back reads it in that format', (format, value, typed, written) => {
      const ctx = openFormat(value, format);

      typeInto(field(), typed);
      press(field(), 'Enter');

      expect(ctx.onCommit).toHaveBeenCalledWith(written);
    });

    it('Enter on the shown text keeps the day in a locale Date.parse cannot read', () => {
      const ctx = makeEditorContext({ locale: 'de-DE', onDateDisplayChange: vi.fn() });

      openCellEditor({ ...makeProperty('date'), date: { dateFormat: 'short' } }, '2025-03-12', makeAnchor(), ctx);
      expect(Number.isFinite(Date.parse(field().value))).toBe(false);
      press(field(), 'Enter');

      expect(field().getAttribute('aria-invalid')).toBeNull();
      for (const [written] of vi.mocked(ctx.onCommit).mock.calls) {
        expect(written).toBe('2025-03-12');
      }
    });

    it('rejects a day that does not exist in the format', () => {
      const ctx = openFormat('2026-06-05', 'day_month_year');

      typeInto(field(), '31/02/2026');
      press(field(), 'Enter');

      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(field().getAttribute('aria-invalid')).toBe('true');
    });

    it('a Date format pick in the picker redraws the field at once', () => {
      openFormat('2026-06-05', 'full');

      q('[data-blok-database-date-setting="dateFormat"]').click();
      [...document.querySelectorAll<HTMLElement>('[data-blok-database-date-setting-menu] [role="menuitemradio"]')]
        .find((item) => item.textContent?.trim() === 'tools.database.dateFormat.year_month_day')?.click();

      expect(field().value).toBe('2026/06/05');
    });
  });

  describe('format rows', () => {
    const dict = en as Record<string, string>;
    const i18n = { t: (key: string, vars?: Record<string, string | number>): string =>
      Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), dict[key] ?? key) };
    const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? '';
    const setting = (name: string): HTMLButtonElement => q<HTMLButtonElement>(`[data-blok-database-date-setting="${name}"]`);
    const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-date-setting-menu]');
    const menuLabels = (): string[] => [...(menu()?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((item) => text(item));
    const checked = (): string[] => [...(menu()?.querySelectorAll('[aria-checked="true"]') ?? [])].map((item) => text(item));
    const pick = (label: string): void => {
      [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])].find((item) => text(item) === label)?.click();
    };
    const rowNames = (): string[] => [...q('[data-blok-database-date-options]').children].map((row) =>
      row.getAttribute('data-blok-database-date-setting')
      ?? ['end-toggle', 'time-toggle', 'remind', 'clear'].find((name) => row.hasAttribute(`data-blok-database-date-${name}`))
      ?? '?');
    const openRows = (
      value: string | null,
      date: PropertyDefinition['date'] = undefined,
      overrides: Partial<CellEditorContext> = {}
    ): CellEditorContext => {
      const ctx = makeEditorContext({ i18n, hourCycle: 'h12', onReminderChange: vi.fn(), onDateDisplayChange: vi.fn(), ...overrides });

      openCellEditor({ ...makeProperty('date'), ...(date !== undefined ? { date } : {}) }, value, makeAnchor(), ctx);

      return ctx;
    };

    it('has no format rows when the host cannot change the property (a form answer, a locked database)', () => {
      openRows('2026-10-09', undefined, { onDateDisplayChange: undefined });

      expect(editorRoot()?.querySelector('[data-blok-database-date-setting]')).toBeNull();
    });

    it('a date: End date, Date format, Include time, Remind, Clear', () => {
      openRows('2026-10-09');

      expect(rowNames()).toEqual(['end-toggle', 'dateFormat', 'time-toggle', 'remind', 'clear']);
      expect(text(setting('dateFormat'))).toBe('Date formatFull date');
    });

    it('with a time: Time format and Time zone follow Include time', () => {
      openRows('2026-10-09T14:00');

      expect(rowNames()).toEqual(['end-toggle', 'dateFormat', 'time-toggle', 'timeFormat', 'timeZone', 'remind', 'clear']);
      expect(text(setting('timeFormat'))).toBe('Time format12 hour');
      expect(text(setting('timeZone'))).toBe('Time zoneYour time zone');
    });

    it('turning Include time on shows the time rows', () => {
      openRows('2026-10-09');
      q('[data-blok-database-date-time-toggle]').click();

      expect(rowNames()).toContain('timeFormat');
    });

    it('Date format lists the property menu formats and checks the current one', () => {
      openRows('2026-10-09', { dateFormat: 'day_month_year' });

      expect(text(setting('dateFormat'))).toBe('Date formatDay/Month/Year');
      setting('dateFormat').click();

      expect(menuLabels()).toEqual(['Full date', 'Short date', 'Month/Day/Year', 'Day/Month/Year', 'Year/Month/Day', 'Relative']);
      expect(checked()).toEqual(['Day/Month/Year']);
    });

    it('a format pick writes the property, closes the menu, keeps the picker open and writes no value', () => {
      const ctx = openRows('2026-10-09');

      setting('dateFormat').click();
      pick('Relative');

      expect(ctx.onDateDisplayChange).toHaveBeenCalledWith({ dateFormat: 'relative' });
      expect(menu()).toBeNull();
      expect(text(setting('dateFormat'))).toBe('Date formatRelative');
      expect(ctx.onCommit).not.toHaveBeenCalled();
      expect(ctx.onClose).not.toHaveBeenCalled();
      expect(setting('dateFormat')).toHaveFocus();
    });

    it('picking 24 hour writes it and shows the time and the reminder times on that clock', () => {
      const ctx = openRows('2026-10-09T14:00');

      expect(q<HTMLInputElement>('[data-blok-database-date-time="start"]').value).toBe('2:00 PM');
      setting('timeFormat').click();
      expect(menuLabels()).toEqual(['Hidden', '12 hour', '24 hour']);
      pick('24 hour');

      expect(ctx.onDateDisplayChange).toHaveBeenCalledWith({ timeFormat: '24_hour' });
      expect(q<HTMLInputElement>('[data-blok-database-date-time="start"]').value).toBe('14:00');
      q('[data-blok-database-date-remind]').click();
      expect(text(document.querySelector('[data-blok-database-date-remind-option="1_day_before"]'))).toBe('1 day before (09:00)');
    });

    it('the property time format wins over the host clock', () => {
      openRows('2026-10-09T14:00', { timeFormat: '24_hour' });

      expect(q<HTMLInputElement>('[data-blok-database-date-time="start"]').value).toBe('14:00');
      expect(text(setting('timeFormat'))).toBe('Time format24 hour');
    });

    describe('Time zone menu (research/23 §1)', () => {
      const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const zoneMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-date-setting-menu="timeZone"]');
      const search = (): HTMLInputElement => {
        const el = zoneMenu()?.querySelector<HTMLInputElement>('[data-blok-database-date-zone-search]');

        if (el === null || el === undefined) {
          throw new Error('missing zone search');
        }

        return el;
      };
      const zoneRow = (id: string): HTMLElement | null => zoneMenu()?.querySelector<HTMLElement>(`[data-blok-database-date-setting-option="${id}"]`) ?? null;
      const headings = (): string[] => [...(zoneMenu()?.querySelectorAll('[data-blok-database-date-zone-heading]') ?? [])].map((h) => text(h));
      const active = (): string | null => zoneMenu()?.querySelector('[data-active]')?.getAttribute('data-blok-database-date-setting-option') ?? null;
      const selected = (): string[] => [...(zoneMenu()?.querySelectorAll('[aria-selected="true"]') ?? [])]
        .map((row) => row.getAttribute('data-blok-database-date-setting-option') ?? '');

      it('opens with a focused search field, the current timezone pinned on top, then every other zone', () => {
        openRows('2026-10-09T14:00');
        setting('timeZone').click();

        expect(search()).toHaveFocus();
        expect(search().placeholder).toBe('Search cities, timezones…');
        expect(headings()).toEqual(['Current timezone', 'Select a timezone']);
        expect(selected()).toEqual(['local']);
        expect(text(zoneRow('local')?.querySelector('[data-blok-database-date-zone-city]'))).toBe(localZone.split('/').pop()?.replace(/_/g, ' '));
        expect(zoneRow(localZone)).toBeNull();
        expect(zoneRow('Asia/Tokyo')).not.toBeNull();
      });

      it('each zone row has the city on the first line and its GMT offset on the second', () => {
        openRows('2026-10-09T14:00');
        setting('timeZone').click();

        expect(text(zoneRow('Asia/Tokyo')?.querySelector('[data-blok-database-date-zone-city]'))).toBe('Tokyo');
        expect(text(zoneRow('Asia/Tokyo')?.querySelector('[data-blok-database-date-zone-offset]'))).toBe('GMT+9:00');
        expect(text(zoneRow('Asia/Colombo')?.querySelector('[data-blok-database-date-zone-offset]'))).toBe('GMT+5:30');
        expect(text(zoneRow('America/Los_Angeles')?.querySelector('[data-blok-database-date-zone-city]'))).toBe('Los Angeles');
      });

      it('the stored zone carries the check; picking a zone stores it, the current timezone removes it', () => {
        const ctx = openRows('2026-10-09T14:00', { timeZone: 'Asia/Tokyo' });

        setting('timeZone').click();
        expect(selected()).toEqual(['Asia/Tokyo']);
        expect(zoneRow('Asia/Tokyo')?.querySelector('[data-blok-database-date-remind-check] svg')).not.toBeNull();
        zoneRow('Europe/Paris')?.click();
        expect(ctx.onDateDisplayChange).toHaveBeenLastCalledWith({ timeZone: 'Europe/Paris' });
        expect(zoneMenu()).toBeNull();
        setting('timeZone').click();
        zoneRow('local')?.click();
        expect(ctx.onDateDisplayChange).toHaveBeenLastCalledWith({ timeZone: null });
        expect(text(setting('timeZone'))).toBe('Time zoneYour time zone');
      });

      it('a stored zone that is the browser zone checks the pinned current row', () => {
        const real = Intl.DateTimeFormat.prototype.resolvedOptions;

        vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
          return { ...real.call(this), timeZone: 'Asia/Tokyo' };
        });
        openRows('2026-10-09T14:00', { timeZone: 'Asia/Tokyo' });
        setting('timeZone').click();

        expect(selected()).toEqual(['local']);
        expect(zoneRow('Asia/Tokyo')).toBeNull();
      });

      // A zone saved in another browser can be an alias the list names differently (Kolkata, Calcutta).
      it('a stored alias checks the listed zone it names', () => {
        const listed = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata' }).resolvedOptions().timeZone;

        openRows('2026-10-09T14:00', { timeZone: 'Asia/Kolkata' });
        setting('timeZone').click();

        expect(selected()).toEqual([listed]);
      });

      it('typing filters by city, and "No results" shows when nothing matches', () => {
        openRows('2026-10-09T14:00');
        setting('timeZone').click();
        typeInto(search(), 'tokyo');

        expect(zoneRow('Asia/Tokyo')).not.toBeNull();
        expect(zoneRow('Europe/Paris')).toBeNull();
        typeInto(search(), 'zzqx');
        expect(zoneMenu()?.querySelectorAll('[data-blok-database-date-setting-option]')).toHaveLength(0);
        expect(text(zoneMenu()?.querySelector('[data-blok-database-date-zone-empty]'))).toBe('No results');
      });

      it('arrows move through the list while focus stays in the search, and Enter picks', () => {
        const ctx = openRows('2026-10-09T14:00');

        setting('timeZone').click();
        typeInto(search(), 'tokyo');
        expect(active()).toBe('Asia/Tokyo');
        press(search(), 'ArrowDown');
        press(search(), 'ArrowUp');
        expect(active()).toBe('Asia/Tokyo');
        expect(search()).toHaveFocus();
        expect(search().getAttribute('aria-activedescendant')).toBe(zoneMenu()?.querySelector('[data-active]')?.id);
        press(search(), 'Enter');

        expect(ctx.onDateDisplayChange).toHaveBeenLastCalledWith({ timeZone: 'Asia/Tokyo' });
        expect(zoneMenu()).toBeNull();
      });

      it('ArrowDown from the search starts on the current timezone', () => {
        openRows('2026-10-09T14:00');
        setting('timeZone').click();
        press(search(), 'ArrowDown');

        expect(active()).toBe('local');
      });

      it('Escape in the search closes only the menu', () => {
        const ctx = openRows('2026-10-09T14:00');

        setting('timeZone').click();
        press(search(), 'Escape');

        expect(zoneMenu()).toBeNull();
        expect(ctx.onClose).not.toHaveBeenCalled();
        expect(setting('timeZone')).toHaveFocus();
      });
    });

    it('Escape closes the format menu first, then the picker', () => {
      const ctx = openRows('2026-10-09');

      setting('dateFormat').click();
      press(document.activeElement ?? document.body, 'Escape');

      expect(menu()).toBeNull();
      expect(ctx.onClose).not.toHaveBeenCalled();
      expect(setting('dateFormat')).toHaveFocus();
    });

    it('one menu at a time: opening Remind closes Date format', () => {
      openRows('2026-10-09');

      setting('dateFormat').click();
      q('[data-blok-database-date-remind]').click();

      expect(menu()).toBeNull();
      expect(document.querySelector('[data-blok-database-date-remind-menu]')).not.toBeNull();
    });
  });
});
