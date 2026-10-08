import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';

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
      const ctx = openDate('2026-10-09');

      q('[data-blok-database-date-time-toggle]').click();

      expect(ctx.onCommit).toHaveBeenLastCalledWith('2026-10-09T09:00');
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
});
