import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dueRun, nextRun } from '../../../../src/tools/database/templates';
import type { TemplateRepeat } from '../../../../src/tools/database/types';

const due = (repeat: TemplateRepeat, now: string): string | null => dueRun(repeat, new Date(now));

describe('repeating template schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('month end', () => {
    it('runs a monthly template from the 31st on the last day of a shorter month', () => {
      expect(due({ frequency: 'monthly', start: '2026-01-31T09:00:00.000Z' }, '2026-02-28T10:00:00.000Z')).toBe('2026-02-28T09:00:00.000Z');
    });

    it('goes back to the 31st after a short month', () => {
      expect(due({ frequency: 'monthly', start: '2026-01-31T09:00:00.000Z', lastRunAt: '2026-02-28T09:00:00.000Z' }, '2026-03-31T10:00:00.000Z')).toBe('2026-03-31T09:00:00.000Z');
    });

    it('runs a yearly template from Feb 29 on Feb 28 of a common year', () => {
      expect(due({ frequency: 'yearly', start: '2028-02-29T09:00:00.000Z', lastRunAt: '2028-02-29T09:00:00.000Z' }, '2029-02-28T10:00:00.000Z')).toBe('2029-02-28T09:00:00.000Z');
    });

    it('counts the interval in months from the start', () => {
      const repeat: TemplateRepeat = { frequency: 'monthly', interval: 2, start: '2026-01-31T09:00:00.000Z' };

      expect(due(repeat, '2026-03-30T10:00:00.000Z')).toBe('2026-01-31T09:00:00.000Z');
      expect(due(repeat, '2026-03-31T10:00:00.000Z')).toBe('2026-03-31T09:00:00.000Z');
    });
  });

  describe('daylight saving time in the stored time zone', () => {
    it('keeps 9:00 on the wall clock after clocks go back', () => {
      // 2026-10-30 09:00 EDT is 13:00Z; after Nov 1 the zone is EST, so 09:00 is 14:00Z.
      const repeat: TemplateRepeat = { frequency: 'daily', start: '2026-10-30T13:00:00.000Z', timeZone: 'America/New_York' };

      expect(due(repeat, '2026-11-02T15:00:00.000Z')).toBe('2026-11-02T14:00:00.000Z');
    });

    it('keeps 9:00 on the wall clock after clocks go forward, weekly', () => {
      // 2027-03-08 09:00 EST is 14:00Z; after Mar 14 the zone is EDT, so 09:00 is 13:00Z.
      const repeat: TemplateRepeat = { frequency: 'weekly', start: '2027-03-08T14:00:00.000Z', timeZone: 'America/New_York' };

      expect(due(repeat, '2027-03-15T13:30:00.000Z')).toBe('2027-03-15T13:00:00.000Z');
    });

    it('moves a run inside the spring-forward gap forward by the gap', () => {
      // 02:30 does not exist on 2027-03-14 in New York; it runs at 03:30 EDT (07:30Z).
      const repeat: TemplateRepeat = { frequency: 'daily', start: '2027-03-13T07:30:00.000Z', timeZone: 'America/New_York' };

      expect(due(repeat, '2027-03-14T12:00:00.000Z')).toBe('2027-03-14T07:30:00.000Z');
      expect(due({ ...repeat, lastRunAt: '2027-03-14T07:30:00.000Z' }, '2027-03-15T12:00:00.000Z')).toBe('2027-03-15T06:30:00.000Z');
    });

    it('runs once, at the first 01:30, in the fall-back overlap', () => {
      // 01:30 happens twice on 2027-11-07 in New York: 05:30Z (EDT) and 06:30Z (EST).
      const repeat: TemplateRepeat = { frequency: 'daily', start: '2027-11-06T05:30:00.000Z', timeZone: 'America/New_York' };

      expect(due(repeat, '2027-11-07T05:45:00.000Z')).toBe('2027-11-07T05:30:00.000Z');
      expect(due({ ...repeat, lastRunAt: '2027-11-07T05:30:00.000Z' }, '2027-11-07T06:45:00.000Z')).toBeNull();
    });

    it('agrees on the run whatever zone the client runs in', () => {
      const repeat: TemplateRepeat = { frequency: 'daily', start: '2026-10-30T13:00:00.000Z', timeZone: 'America/New_York' };

      vi.stubEnv('TZ', 'Asia/Tokyo');
      const tokyo = due(repeat, '2026-11-02T15:00:00.000Z');

      vi.stubEnv('TZ', 'Europe/London');

      expect(due(repeat, '2026-11-02T15:00:00.000Z')).toBe(tokyo);
    });
  });

  describe('a schedule with no time zone', () => {
    it('keeps its runs on UTC whatever zone the client runs in', () => {
      vi.stubEnv('TZ', 'America/New_York');

      expect(due({ frequency: 'daily', start: '2026-10-30T13:00:00.000Z' }, '2026-11-02T15:00:00.000Z')).toBe('2026-11-02T13:00:00.000Z');
    });

    it('falls back to UTC when the stored zone is not a real zone', () => {
      expect(due({ frequency: 'daily', start: '2026-10-30T13:00:00.000Z', timeZone: 'Mars/Olympus' }, '2026-11-02T15:00:00.000Z')).toBe('2026-11-02T13:00:00.000Z');
    });
  });

  describe('next run', () => {
    const next = (repeat: TemplateRepeat, now: string): string | null => {
      const at = nextRun(repeat, new Date(now));

      return at === null ? null : new Date(at).toISOString();
    };

    it('is the next month, not one the 28-day estimate skips to', () => {
      // Two years of months: a 28-day month estimate lands about two runs ahead.
      expect(next({ frequency: 'monthly', start: '2025-01-15T09:00:00.000Z' }, '2027-01-14T10:00:00.000Z')).toBe('2027-01-15T09:00:00.000Z');
    });
    it('is the start while the start is ahead', () => {
      expect(next({ frequency: 'daily', start: '2026-10-09T09:00:00.000Z' }, '2026-10-01T00:00:00.000Z')).toBe('2026-10-09T09:00:00.000Z');
    });
    it('is strictly after now when now is a run', () => {
      expect(next({ frequency: 'weekly', start: '2026-10-05T09:00:00.000Z' }, '2026-10-12T09:00:00.000Z')).toBe('2026-10-19T09:00:00.000Z');
    });
  });

  describe('weekdays', () => {
    const next = (repeat: TemplateRepeat, now: string): string | null => {
      const at = nextRun(repeat, new Date(now));

      return at === null ? null : new Date(at).toISOString();
    };

    it('every 2 weeks on Monday from a Wednesday start skips the start\'s week (research/21 shot 61: Nov 2)', () => {
      // Tomorrow, Wed Oct 21, around midnight in Berlin; the Monday of that week is before the start.
      const repeat: TemplateRepeat = { frequency: 'weekly', interval: 2, weekdays: [1], start: '2026-10-20T22:00:00.000Z', timeZone: 'Europe/Berlin' };

      // Berlin leaves summer time on Oct 25: midnight Nov 2 is 23:00Z.
      expect(next(repeat, '2026-10-20T12:00:00.000Z')).toBe('2026-11-01T23:00:00.000Z');
    });

    it('Monday to Friday from a Wednesday start runs on the start (research/21 shot 73: Tomorrow)', () => {
      const repeat: TemplateRepeat = { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: '2026-10-20T22:00:00.000Z', timeZone: 'Europe/Berlin' };

      expect(next(repeat, '2026-10-20T12:00:00.000Z')).toBe('2026-10-20T22:00:00.000Z');
    });

    it('has nothing due before the first day in the set', () => {
      const repeat: TemplateRepeat = { frequency: 'weekly', weekdays: [1], start: '2026-10-21T09:00:00.000Z', timeZone: 'UTC' };

      expect(due(repeat, '2026-10-23T12:00:00.000Z')).toBeNull();
      expect(due(repeat, '2026-10-26T12:00:00.000Z')).toBe('2026-10-26T09:00:00.000Z');
    });

    it('runs on each day in the set, every other week', () => {
      const repeat: TemplateRepeat = { frequency: 'weekly', interval: 2, weekdays: [4, 1], start: '2026-10-05T09:00:00.000Z', timeZone: 'UTC' };

      expect(due(repeat, '2026-10-07T12:00:00.000Z')).toBe('2026-10-05T09:00:00.000Z');
      expect(due(repeat, '2026-10-15T12:00:00.000Z')).toBe('2026-10-08T09:00:00.000Z');
      expect(next(repeat, '2026-10-09T12:00:00.000Z')).toBe('2026-10-19T09:00:00.000Z');
      expect(next(repeat, '2026-10-19T09:00:00.000Z')).toBe('2026-10-22T09:00:00.000Z');
    });

    it('reads the weekday on the stored zone\'s calendar, not the UTC one', () => {
      // 08:00 in Tokyo is 23:00Z the day before: Monday in Tokyo is Sunday in UTC.
      const repeat: TemplateRepeat = { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: '2026-10-18T23:00:00.000Z', timeZone: 'Asia/Tokyo' };

      expect(due(repeat, '2026-10-19T00:00:00.000Z')).toBe('2026-10-18T23:00:00.000Z');
      // Saturday 10:00 in Tokyo: the last run was Friday.
      expect(due(repeat, '2026-10-24T01:00:00.000Z')).toBe('2026-10-22T23:00:00.000Z');
      expect(next(repeat, '2026-10-23T00:00:00.000Z')).toBe('2026-10-25T23:00:00.000Z');
    });

    it('keeps 9:00 on the wall clock across both DST changes', () => {
      const fall: TemplateRepeat = { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: '2026-10-26T13:00:00.000Z', timeZone: 'America/New_York' };
      const spring: TemplateRepeat = { ...fall, start: '2027-03-08T14:00:00.000Z' };

      expect(next(fall, '2026-10-30T15:00:00.000Z')).toBe('2026-11-02T14:00:00.000Z');
      expect(due({ ...fall, lastRunAt: '2026-10-30T13:00:00.000Z' }, '2026-11-02T15:00:00.000Z')).toBe('2026-11-02T14:00:00.000Z');
      expect(next(spring, '2027-03-12T15:00:00.000Z')).toBe('2027-03-15T13:00:00.000Z');
    });

    it('with no days set steps whole weeks from the start, as before', () => {
      const wednesday: TemplateRepeat = { frequency: 'weekly', start: '2026-10-21T09:00:00.000Z', timeZone: 'UTC' };

      expect(next({ ...wednesday, weekdays: [] }, '2026-10-21T10:00:00.000Z')).toBe('2026-10-28T09:00:00.000Z');
      expect(next(wednesday, '2026-10-21T10:00:00.000Z')).toBe('2026-10-28T09:00:00.000Z');
    });

    it('only counts for weekly schedules', () => {
      expect(next({ frequency: 'daily', weekdays: [1], start: '2026-10-21T09:00:00.000Z' }, '2026-10-21T10:00:00.000Z')).toBe('2026-10-22T09:00:00.000Z');
    });

    it('finds the run in a set started 1000 years ago without walking the weeks', () => {
      const fromSpy = vi.spyOn(Array, 'from');
      const repeat: TemplateRepeat = { frequency: 'weekly', weekdays: [1, 3], start: '1026-01-05T09:00:00.000Z', timeZone: 'UTC' };

      expect(due(repeat, '2026-10-09T12:00:00.000Z')).toBe('2026-10-07T09:00:00.000Z');
      expect(next(repeat, '2026-10-09T12:00:00.000Z')).toBe('2026-10-12T09:00:00.000Z');
      expect(fromSpy.mock.calls.every(([source]) => (source as ArrayLike<unknown>).length <= 16)).toBe(true);
    });
  });

  describe('ending', () => {
    const daily: TemplateRepeat = { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', end: '2026-10-05T12:00:00.000Z' };

    it('makes no run after the end', () => {
      expect(due(daily, '2026-10-09T12:00:00.000Z')).toBe('2026-10-05T09:00:00.000Z');
      expect(due({ ...daily, lastRunAt: '2026-10-05T09:00:00.000Z' }, '2026-10-09T12:00:00.000Z')).toBeNull();
      expect(nextRun(daily, new Date('2026-10-05T10:00:00.000Z'))).toBeNull();
    });

    it('runs as before until the end', () => {
      expect(due(daily, '2026-10-03T12:00:00.000Z')).toBe('2026-10-03T09:00:00.000Z');
      expect(nextRun(daily, new Date('2026-10-03T12:00:00.000Z'))).toBe(Date.parse('2026-10-04T09:00:00.000Z'));
    });

    it('ends weekday runs too', () => {
      const repeat: TemplateRepeat = { frequency: 'weekly', weekdays: [1, 5], start: '2026-10-05T09:00:00.000Z', end: '2026-10-12T00:00:00.000Z', timeZone: 'UTC' };

      expect(due(repeat, '2026-10-20T12:00:00.000Z')).toBe('2026-10-09T09:00:00.000Z');
      expect(nextRun(repeat, new Date('2026-10-10T12:00:00.000Z'))).toBeNull();
    });
  });

  describe('a malformed repeat from the document', () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const bad: Array<[string, TemplateRepeat]> = [
      ['interval 0', { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', interval: 0 }],
      ['interval NaN', { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', interval: Number.NaN }],
      ['negative interval', { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', interval: -3 }],
      ['unknown frequency', { frequency: 'hourly' as TemplateRepeat['frequency'], start: '2026-10-01T09:00:00.000Z' }],
    ];

    it.each(bad)('%s has no due run and no next run', (_, repeat) => {
      expect(dueRun(repeat, now)).toBeNull();
      expect(nextRun(repeat, now)).toBeNull();
    });

    const weekly = { frequency: 'weekly' as const, start: '2026-10-01T09:00:00.000Z' };
    const weekdays: Array<[string, unknown]> = [
      ['not a list', '1,2'],
      ['more than seven days', [1, 2, 3, 4, 5, 6, 7, 1]],
      ['a day 0', [0]],
      ['a day 8', [8]],
      ['a fraction', [1.5]],
      ['NaN', [Number.NaN]],
      ['a text day', ['1']],
      ['a huge sparse list', new Array(1_000_000_000)],
      ['a list-like object', { length: 1_000_000_000 }],
      ['a list with a hole', [1, , 3]],
      ['a short list of holes', new Array(3)],
    ];

    it.each(weekdays)('weekdays as %s give no runs and allocate nothing per day', (_, value) => {
      const fromSpy = vi.spyOn(Array, 'from');
      const repeat = { ...weekly, weekdays: value } as TemplateRepeat;

      expect(dueRun(repeat, now)).toBeNull();
      expect(nextRun(repeat, now)).toBeNull();
      expect(fromSpy.mock.calls.every(([source]) => (source as ArrayLike<unknown>).length <= 16)).toBe(true);
    });

    const ends: Array<[string, unknown]> = [
      ['not a date', 'soon'],
      ['a number', 42],
      ['outside years 100-9999', '-271000-01-01T00:00:00.000Z'],
      ['an object', { at: '2026-10-05' }],
    ];

    it.each(ends)('an end that is %s gives no runs', (_, value) => {
      const repeat = { ...weekly, end: value } as TemplateRepeat;

      expect(dueRun(repeat, now)).toBeNull();
      expect(nextRun(repeat, now)).toBeNull();
    });

    it('a start 1000 years ago still gives the next run', () => {
      expect(nextRun({ frequency: 'daily', start: '1026-10-01T09:00:00.000Z' }, now)).toBe(Date.parse('2026-10-10T09:00:00.000Z'));
    });

    it('a start outside years 100-9999 has no runs and does not throw', () => {
      const repeat: TemplateRepeat = { frequency: 'daily', start: '-271000-01-01T09:00:00.000Z' };

      expect(dueRun(repeat, now)).toBeNull();
      expect(nextRun(repeat, now)).toBeNull();
    });

    it('a start in year 100 does not allocate per past run', () => {
      const fromSpy = vi.spyOn(Array, 'from');
      const repeat: TemplateRepeat = { frequency: 'daily', start: '0100-01-01T09:00:00.000Z', timeZone: 'UTC' };

      expect(dueRun(repeat, now)).toBe('2026-10-09T09:00:00.000Z');
      expect(nextRun(repeat, now)).toBe(Date.parse('2026-10-10T09:00:00.000Z'));
      expect(fromSpy.mock.calls.every(([source]) => (source as ArrayLike<unknown>).length <= 16)).toBe(true);
    });

    it('a monthly schedule 1000 years old lands on the right month', () => {
      const repeat: TemplateRepeat = { frequency: 'monthly', start: '1026-01-31T09:00:00.000Z', timeZone: 'UTC' };

      expect(dueRun(repeat, now)).toBe('2026-09-30T09:00:00.000Z');
      expect(nextRun(repeat, now)).toBe(Date.parse('2026-10-31T09:00:00.000Z'));
    });
  });
});
