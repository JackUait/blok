import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  addDays,
  calendarWeeks,
  daysBetween,
  eventSpan,
  layoutWeek,
  moveDateValue,
  resizeDateValue,
  shiftAnchor,
  startOfWeek,
  visibleDays,
} from '../../../../src/tools/database/calendar-dates';

describe('calendar-dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('day arithmetic', () => {
    it('adds days across month, year and DST edges by calendar day', () => {
      expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      // Clocks change in late March and late October in Europe, early March and November in the US.
      expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
      expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    });

    it('counts whole days between two days', () => {
      expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
      expect(daysBetween('2026-10-12', '2026-10-09')).toBe(-3);
      expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    });

    it('finds the first day of the week for any week start', () => {
      // 2026-10-09 is a Friday.
      expect(startOfWeek('2026-10-09', 0)).toBe('2026-10-04');
      expect(startOfWeek('2026-10-09', 1)).toBe('2026-10-05');
      expect(startOfWeek('2026-10-09', 5)).toBe('2026-10-09');
      expect(startOfWeek('2026-10-09', 6)).toBe('2026-10-03');
    });
  });

  describe('calendarWeeks', () => {
    it('covers the whole month in full weeks from the week start', () => {
      const weeks = calendarWeeks({ anchor: '2026-10-09', range: 'month', weekStart: 0 });

      expect(weeks).toHaveLength(5);
      expect(weeks[0][0]).toBe('2026-09-27');
      expect(weeks[4][6]).toBe('2026-10-31');
      expect(weeks.every((week) => week.length === 7)).toBe(true);
    });

    it('adds a week when the month starts late in a Monday week', () => {
      const weeks = calendarWeeks({ anchor: '2026-08-15', range: 'month', weekStart: 1 });

      expect(weeks[0][0]).toBe('2026-07-27');
      expect(weeks[weeks.length - 1][6]).toBe('2026-09-06');
      expect(weeks).toHaveLength(6);
    });

    it('shows one week in week range', () => {
      expect(calendarWeeks({ anchor: '2026-10-09', range: 'week', weekStart: 1 })).toEqual([[
        '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
      ]]);
    });

    it('drops Saturday and Sunday when weekends are hidden', () => {
      expect(visibleDays(['2026-10-04', '2026-10-05', '2026-10-09', '2026-10-10'], false)).toEqual(['2026-10-05', '2026-10-09']);
      expect(visibleDays(['2026-10-04', '2026-10-05'], true)).toEqual(['2026-10-04', '2026-10-05']);
    });

    it('moves the anchor by one month or one week', () => {
      expect(shiftAnchor('2026-10-31', 'month', 1)).toBe('2026-11-01');
      expect(shiftAnchor('2026-01-15', 'month', -1)).toBe('2025-12-01');
      expect(shiftAnchor('2026-10-09', 'week', 1)).toBe('2026-10-16');
    });
  });

  describe('eventSpan', () => {
    it('reads a day, a timed day, a range and a legacy timestamp', () => {
      expect(eventSpan('2026-10-09')).toEqual({ start: '2026-10-09', end: '2026-10-09' });
      expect(eventSpan('2026-10-09T15:30')).toEqual({ start: '2026-10-09', end: '2026-10-09' });
      expect(eventSpan('2026-10-09/2026-10-12')).toEqual({ start: '2026-10-09', end: '2026-10-12' });
      expect(eventSpan('2026-10-09T15:00:00.000Z')).toEqual({ start: '2026-10-09', end: '2026-10-09' });
    });

    it('gives null for no date and orders a reversed range', () => {
      expect(eventSpan(null)).toBeNull();
      expect(eventSpan('soon')).toBeNull();
      expect(eventSpan('2026-10-12/2026-10-09')).toEqual({ start: '2026-10-09', end: '2026-10-12' });
    });
  });

  describe('layoutWeek', () => {
    const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];

    it('places a single-day event in its column on the first lane', () => {
      expect(layoutWeek(week, [{ id: 'a', start: '2026-10-06', end: '2026-10-06' }])).toEqual([
        { id: 'a', startCol: 2, endCol: 2, lane: 0, continuesBefore: false, continuesAfter: false },
      ]);
    });

    it('clips an event that runs past the week and marks both ends', () => {
      expect(layoutWeek(week, [{ id: 'a', start: '2026-10-01', end: '2026-10-20' }])).toEqual([
        { id: 'a', startCol: 0, endCol: 6, lane: 0, continuesBefore: true, continuesAfter: true },
      ]);
    });

    it('stacks overlapping events on separate lanes, longer first, and reuses a free lane', () => {
      const placed = layoutWeek(week, [
        { id: 'short', start: '2026-10-05', end: '2026-10-05' },
        { id: 'long', start: '2026-10-05', end: '2026-10-08' },
        { id: 'later', start: '2026-10-09', end: '2026-10-09' },
        { id: 'mid', start: '2026-10-06', end: '2026-10-06' },
      ]);
      const lanes = Object.fromEntries(placed.map((p) => [p.id, p.lane]));

      expect(lanes).toEqual({ long: 0, short: 1, mid: 1, later: 0 });
    });

    it('skips events outside the week', () => {
      expect(layoutWeek(week, [{ id: 'a', start: '2026-10-11', end: '2026-10-12' }])).toEqual([]);
    });

    it('lays out against visible days only, skipping an event that sits on a hidden weekend', () => {
      const weekdays = visibleDays(week, false);
      const placed = layoutWeek(weekdays, [
        { id: 'weekend', start: '2026-10-10', end: '2026-10-11' },
        { id: 'across', start: '2026-10-03', end: '2026-10-06' },
      ]);

      expect(placed).toEqual([{ id: 'across', startCol: 0, endCol: 1, lane: 0, continuesBefore: true, continuesAfter: false }]);
    });
  });

  describe('moveDateValue', () => {
    it('moves a day', () => {
      expect(moveDateValue('2026-10-09', '2026-10-12')).toBe('2026-10-12');
    });

    it('keeps the time of day', () => {
      expect(moveDateValue('2026-10-09T15:30', '2026-10-01')).toBe('2026-10-01T15:30');
    });

    it('keeps the length of a range', () => {
      expect(moveDateValue('2026-10-09/2026-10-12', '2026-10-30')).toBe('2026-10-30/2026-11-02');
      expect(moveDateValue('2026-10-09T09:00/2026-10-10T18:00', '2026-10-11')).toBe('2026-10-11T09:00/2026-10-12T18:00');
    });

    it('keeps the time and zone of a legacy timestamp', () => {
      expect(moveDateValue('2026-10-09T15:00:00.000Z', '2026-10-10')).toBe('2026-10-10T15:00:00.000Z');
    });

    it('gives null for a value that is not a date', () => {
      expect(moveDateValue('soon', '2026-10-10')).toBeNull();
    });
  });

  describe('resizeDateValue', () => {
    it('turns a day into a range when its end edge is dragged later', () => {
      expect(resizeDateValue('2026-10-09', 'end', '2026-10-11')).toBe('2026-10-09/2026-10-11');
    });

    it('moves the start edge earlier and keeps the end', () => {
      expect(resizeDateValue('2026-10-09/2026-10-11', 'start', '2026-10-07')).toBe('2026-10-07/2026-10-11');
    });

    it('collapses to a single day when both edges meet', () => {
      expect(resizeDateValue('2026-10-09/2026-10-11', 'end', '2026-10-09')).toBe('2026-10-09');
      expect(resizeDateValue('2026-10-09/2026-10-11', 'start', '2026-10-11')).toBe('2026-10-11');
    });

    it('clamps an edge dragged past the other one', () => {
      expect(resizeDateValue('2026-10-09/2026-10-11', 'end', '2026-10-01')).toBe('2026-10-09');
      expect(resizeDateValue('2026-10-09/2026-10-11', 'start', '2026-10-20')).toBe('2026-10-11');
    });

    it('keeps the times of each end', () => {
      expect(resizeDateValue('2026-10-09T09:00/2026-10-10T18:00', 'end', '2026-10-12')).toBe('2026-10-09T09:00/2026-10-12T18:00');
      expect(resizeDateValue('2026-10-09T09:00', 'end', '2026-10-10')).toBe('2026-10-09T09:00/2026-10-10T09:00');
    });

    it('keeps a same-day range that has times', () => {
      expect(resizeDateValue('2026-10-09T09:00/2026-10-11T18:00', 'end', '2026-10-09')).toBe('2026-10-09T09:00/2026-10-09T18:00');
    });
  });
});
