import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { applyDateDisplayChange, formatShortDatePart, resolveHourCycle, resolveWeekStart, toIsoDay, toLocalDate } from '../../../../../src/tools/database/cells/date-format';

describe('date-format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveWeekStart', () => {
    it('reads getWeekInfo(), the only form Node 26 keeps', () => {
      expect(resolveWeekStart('de-DE', () => ({ getWeekInfo: () => ({ firstDay: 1 }) }))).toBe(1);
    });

    it('reads the weekInfo getter on engines that have only that', () => {
      expect(resolveWeekStart('de-DE', () => ({ weekInfo: { firstDay: 1 } }))).toBe(1);
    });

    it('maps Sunday (7) to 0', () => {
      expect(resolveWeekStart('en-US', () => ({ getWeekInfo: () => ({ firstDay: 7 }) }))).toBe(0);
    });

    it('falls back to Sunday when the engine has no week data', () => {
      expect(resolveWeekStart('en-US', () => ({}))).toBe(0);
    });

    it('falls back to Sunday for a tag Intl rejects', () => {
      expect(resolveWeekStart('en-US', () => {
        throw new RangeError('bad tag');
      })).toBe(0);
    });
  });

  it('resolveHourCycle gives one of the two cycles', () => {
    expect(['h12', 'h23']).toContain(resolveHourCycle('en-US'));
  });

  it('reads a stored day as local midnight', () => {
    const date = toLocalDate('2026-10-09');

    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 9, 0]);
    expect(toIsoDay(date)).toBe('2026-10-09');
  });

  it('reads a stored time as local wall time', () => {
    const date = toLocalDate('2026-10-09T14:05');

    expect([date.getHours(), date.getMinutes()]).toEqual([14, 5]);
  });

  describe('formatShortDatePart: the timeline resize readout (research/22 §9)', () => {
    it('writes a timed part as a short month, day and time in the locale', () => {
      expect(formatShortDatePart('2026-10-20T02:45', 'en-US')).toBe('Oct 20, 2:45 AM');
      expect(formatShortDatePart('2026-10-20T14:05', 'en-US', 'h23')).toBe('Oct 20, 14:05');
      expect(formatShortDatePart('2026-10-20T02:45', 'de-DE')).toBe(new Intl.DateTimeFormat('de-DE', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 9, 20, 2, 45)));
    });

    it('writes a part with no time as the short month and day', () => {
      expect(formatShortDatePart('2026-10-20', 'en-US')).toBe('Oct 20');
    });
  });

  describe('applyDateDisplayChange', () => {
    it('keeps the other settings, the default reminder included', () => {
      expect(applyDateDisplayChange({ timeZone: 'Asia/Tokyo', defaultReminder: '1_day_before' }, { dateFormat: 'relative' }))
        .toEqual({ timeZone: 'Asia/Tokyo', defaultReminder: '1_day_before', dateFormat: 'relative' });
    });

    it('"Your time zone" removes the key rather than storing undefined', () => {
      const next = applyDateDisplayChange({ timeZone: 'Asia/Tokyo', timeFormat: '24_hour' }, { timeZone: null });

      expect(next).toEqual({ timeFormat: '24_hour' });
      expect('timeZone' in next).toBe(false);
    });
  });
});
