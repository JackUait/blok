import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { resolveHourCycle, resolveWeekStart, toIsoDay, toLocalDate } from '../../../../../src/tools/database/cells/date-format';

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
});
