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

    it('a start 1000 years ago still gives the next run', () => {
      expect(nextRun({ frequency: 'daily', start: '1026-10-01T09:00:00.000Z' }, now)).toBe(Date.parse('2026-10-10T09:00:00.000Z'));
    });
  });
});
