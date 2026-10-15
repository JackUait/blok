import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dueReminder, reminderDueAt, reminderFits, remindersFor } from '../../../../src/tools/database/reminders';
import type { DateReminderOffset } from '../../../../src/tools/database/types';

const NY = 'America/New_York';
const dueIso = (value: string, remind: DateReminderOffset, zone: string | undefined): string | null => {
  const ms = reminderDueAt(value, remind, zone);

  return ms === null ? null : new Date(ms).toISOString();
};

describe('date reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('options (research/17 §1b)', () => {
    it('offers the four date-only reminders in order', () => {
      expect(remindersFor(false)).toEqual(['on_day_of_event', '1_day_before', '2_days_before', '1_week_before']);
    });

    it('offers the nine date-and-time reminders in order, without 1 week before', () => {
      expect(remindersFor(true)).toEqual([
        'at_time_of_event', '5_minutes_before', '10_minutes_before', '15_minutes_before', '30_minutes_before',
        '1_hour_before', '2_hours_before', '1_day_before', '2_days_before',
      ]);
      expect(reminderFits('1_week_before', true)).toBe(false);
      expect(reminderFits('at_time_of_event', false)).toBe(false);
    });
  });

  describe('due time in the property time zone', () => {
    it('reminds at 9:00 on the day of a date-only event', () => {
      expect(dueIso('2027-06-15', 'on_day_of_event', NY)).toBe('2027-06-15T13:00:00.000Z');
    });

    it('reminds at 9:00 one day, two days and one week before a date-only event', () => {
      expect(dueIso('2027-06-15', '1_day_before', NY)).toBe('2027-06-14T13:00:00.000Z');
      expect(dueIso('2027-06-15', '2_days_before', NY)).toBe('2027-06-13T13:00:00.000Z');
      expect(dueIso('2027-06-15', '1_week_before', NY)).toBe('2027-06-08T13:00:00.000Z');
    });

    it('subtracts minutes and hours from a timed event', () => {
      expect(dueIso('2027-06-16T09:00', 'at_time_of_event', NY)).toBe('2027-06-16T13:00:00.000Z');
      expect(dueIso('2027-06-16T09:00', '5_minutes_before', NY)).toBe('2027-06-16T12:55:00.000Z');
      expect(dueIso('2027-06-16T09:00', '30_minutes_before', NY)).toBe('2027-06-16T12:30:00.000Z');
      expect(dueIso('2027-06-16T09:00', '2_hours_before', NY)).toBe('2027-06-16T11:00:00.000Z');
    });

    it('reminds a timed event one day before at 9:00, not at the event time', () => {
      expect(dueIso('2027-06-16T17:30', '1_day_before', NY)).toBe('2027-06-15T13:00:00.000Z');
    });

    it('keeps 9:00 on the wall clock when the days before cross a DST change', () => {
      // Clocks go back on 2027-11-07: the event day is EST, the week before is EDT.
      expect(dueIso('2027-11-10', 'on_day_of_event', NY)).toBe('2027-11-10T14:00:00.000Z');
      expect(dueIso('2027-11-10', '1_week_before', NY)).toBe('2027-11-03T13:00:00.000Z');
    });

    it('uses the start of a range', () => {
      expect(dueIso('2027-06-15/2027-06-20', '1_day_before', NY)).toBe('2027-06-14T13:00:00.000Z');
    });

    it('reads a date without a property zone on the viewer clock', () => {
      expect(reminderDueAt('2027-06-15', '1_day_before', undefined)).toBe(new Date(2027, 5, 14, 9, 0).getTime());
    });

    it('falls back to the viewer clock for an unknown zone', () => {
      expect(reminderDueAt('2027-06-15', '1_day_before', 'Not/AZone')).toBe(new Date(2027, 5, 14, 9, 0).getTime());
    });

    it('has no due time for an empty value or a reminder the value cannot take', () => {
      expect(reminderDueAt(null, '1_day_before', NY)).toBeNull();
      expect(reminderDueAt('2027-06-15', '5_minutes_before', NY)).toBeNull();
      expect(reminderDueAt('2027-06-16T09:00', '1_week_before', NY)).toBeNull();
    });
  });

  describe('when the host is told', () => {
    const value = '2027-06-15';

    it('is due once its time has come', () => {
      expect(dueReminder(value, { remind: '1_day_before' }, NY, new Date('2027-06-14T12:59:00.000Z'))).toBeNull();
      expect(dueReminder(value, { remind: '1_day_before' }, NY, new Date('2027-06-14T13:00:00.000Z'))).toBe('2027-06-14T13:00:00.000Z');
    });

    it('is not offered again once the host marked that due time sent', () => {
      expect(dueReminder(value, { remind: '1_day_before', sentFor: '2027-06-14T13:00:00.000Z' }, NY, new Date('2027-06-20T00:00:00.000Z'))).toBeNull();
    });

    it('uses the zone stored on the reminder when the property has none', () => {
      const tokyo = { remind: '1_day_before' as const, timeZone: 'Asia/Tokyo' };

      expect(dueReminder(value, tokyo, undefined, new Date('2027-06-20T00:00:00.000Z'))).toBe('2027-06-14T00:00:00.000Z');
      expect(dueReminder(value, { ...tokyo, sentFor: '2027-06-14T00:00:00.000Z' }, undefined, new Date('2027-06-20T00:00:00.000Z'))).toBeNull();
    });

    it('lets the property zone win over the zone stored on the reminder', () => {
      expect(dueReminder(value, { remind: '1_day_before', timeZone: 'Asia/Tokyo' }, NY, new Date('2027-06-20T00:00:00.000Z'))).toBe('2027-06-14T13:00:00.000Z');
    });

    it('is offered again after the date moves', () => {
      const moved = dueReminder('2027-06-17', { remind: '1_day_before', sentFor: '2027-06-14T13:00:00.000Z' }, NY, new Date('2027-06-20T00:00:00.000Z'));

      expect(moved).toBe('2027-06-16T13:00:00.000Z');
    });
  });
});
