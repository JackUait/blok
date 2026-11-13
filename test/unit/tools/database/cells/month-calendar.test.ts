import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MonthCalendar } from '../../../../../src/tools/database/cells/month-calendar';
import type { MonthCalendarOptions } from '../../../../../src/tools/database/cells/month-calendar';

const mount = (shown: string, overrides: Partial<MonthCalendarOptions> = {}): { calendar: MonthCalendar; host: HTMLElement; onPick: ReturnType<typeof vi.fn> } => {
  const host = document.createElement('div');
  const onPick = vi.fn();
  const calendar: MonthCalendar = new MonthCalendar({
    locale: 'en-US',
    weekStart: 0,
    directionOf: host,
    t: (key) => key,
    isSelected: () => false,
    onPick,
    redraw: () => host.replaceChildren(calendar.header(), calendar.grid()),
    ...overrides,
  }, shown);

  document.body.appendChild(host);
  host.replaceChildren(calendar.header(), calendar.grid());

  return { calendar, host, onPick };
};

const day = (iso: string): HTMLButtonElement | null => document.querySelector(`[data-blok-database-date-day="${iso}"]`);
const month = (): string => document.querySelector('[data-blok-database-date-month]')?.textContent ?? '';

describe('MonthCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 13, 10, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the month of the given day, six weeks, today ringed and the picked day marked', () => {
    mount('2026-11-06', { isSelected: (iso) => iso === '2026-11-06' });

    expect(month()).toBe('Nov 2026');
    expect(document.querySelectorAll('[data-blok-database-date-day]')).toHaveLength(42);
    expect(day('2026-11-13')?.hasAttribute('data-today')).toBe(true);
    expect(day('2026-11-06')?.getAttribute('aria-selected')).toBe('true');
    expect(day('2026-12-01')?.hasAttribute('data-outside')).toBe(true);
  });

  it('has no Today button unless asked for one', () => {
    mount('2026-11-06');

    expect(document.querySelector('[data-blok-database-date-today]')).toBeNull();

    document.body.replaceChildren();
    const onToday = vi.fn();

    mount('2026-11-06', { today: { label: () => 'Today', onPick: onToday } });
    document.querySelector<HTMLButtonElement>('[data-blok-database-date-today]')?.click();

    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('steps months with the arrows and picks a clicked day', () => {
    const { onPick } = mount('2026-11-06');

    document.querySelector<HTMLButtonElement>('[data-blok-database-date-next]')?.click();
    expect(month()).toBe('Dec 2026');

    day('2026-12-24')?.click();
    expect(onPick).toHaveBeenCalledWith('2026-12-24');
  });

  it('moves focus with the arrow keys into the next month and picks with Enter', () => {
    const { calendar, onPick } = mount('2026-11-30');

    calendar.show('2026-11-30');
    day('2026-11-30')?.focus();
    day('2026-11-30')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(month()).toBe('Dec 2026');
    expect(day('2026-12-01')).toHaveFocus();

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onPick).toHaveBeenCalledWith('2026-12-01');
  });
});
