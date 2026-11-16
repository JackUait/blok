import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  TIMELINE_DAY_WIDTH,
  barGeometry,
  headerUnits,
  hourBarGeometry,
  moveBar,
  moveBarByMinutes,
  offscreenSide,
  resizeBar,
  resizeBarByMinutes,
  snapMinutes,
  timedEdges,
  timelineSpan,
  timelineWindow,
  visibleRange,
  zoomStep,
} from '../../../../src/tools/database/timeline-dates';

describe('timeline-dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('zoom', () => {
    it('draws 40px per day at month zoom, as measured in Notion', () => {
      expect(TIMELINE_DAY_WIDTH.month).toBe(40);
    });

    // notion-motion.md Round 47 A1b: Day 52.1 per hour cell (about 1250 a day), Week 180, Year 35 per week cell.
    it('draws Day, Week and Year at Notion\'s widths', () => {
      expect(TIMELINE_DAY_WIDTH.day).toBe(1250);
      expect(TIMELINE_DAY_WIDTH.week).toBe(180);
      expect(TIMELINE_DAY_WIDTH.year).toBe(5);
    });

    it('gets wider for each closer zoom level', () => {
      const order = ['5_years', 'year', 'quarter', 'month', 'bi_week', 'week', 'day', 'hours'] as const;
      const widths = order.map((zoom) => TIMELINE_DAY_WIDTH[zoom]);

      expect(widths).toEqual([...widths].sort((a, b) => a - b));
      expect(new Set(widths).size).toBe(widths.length);
    });

    it('steps in and out through the zoom levels and stops at the ends', () => {
      expect(zoomStep('month', 1)).toBe('bi_week');
      expect(zoomStep('month', -1)).toBe('quarter');
      expect(zoomStep('hours', 1)).toBe('hours');
      expect(zoomStep('5_years', -1)).toBe('5_years');
    });
  });

  describe('timelineWindow', () => {
    it('centres the drawn days on the given day', () => {
      const window = timelineWindow('2026-10-09', 'month');

      expect(window.days * TIMELINE_DAY_WIDTH.month).toBeGreaterThanOrEqual(3000);
      expect(window.start < '2026-10-09').toBe(true);
      const startOffset = barGeometry({ start: '2026-10-09', end: '2026-10-09' }, window.start, 'month').offset;

      expect(Math.abs(startOffset - (window.days * 40) / 2)).toBeLessThanOrEqual(40);
    });

    it('starts on the first of a month so the month labels line up', () => {
      expect(timelineWindow('2026-10-09', 'year').start.endsWith('-01')).toBe(true);
      expect(timelineWindow('2026-10-09', 'month').start.endsWith('-01')).toBe(true);
    });
  });

  describe('timelineSpan', () => {
    it('reads a range from one property', () => {
      expect(timelineSpan('2026-10-05/2026-10-09', undefined)).toEqual({ start: '2026-10-05', end: '2026-10-09' });
      expect(timelineSpan('2026-10-05', undefined)).toEqual({ start: '2026-10-05', end: '2026-10-05' });
    });

    it('reads the start and end from two properties', () => {
      expect(timelineSpan('2026-10-05', '2026-10-09')).toEqual({ start: '2026-10-05', end: '2026-10-09' });
      expect(timelineSpan('2026-10-05', null)).toEqual({ start: '2026-10-05', end: '2026-10-05' });
      expect(timelineSpan('2026-10-09', '2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-09' });
    });

    it('draws nothing without a start', () => {
      expect(timelineSpan(undefined, undefined)).toBeNull();
      expect(timelineSpan(null, '2026-10-09')).toBeNull();
      expect(timelineSpan('soon', undefined)).toBeNull();
    });
  });

  describe('barGeometry', () => {
    it('places a bar by whole days from the window start, its last day included', () => {
      expect(barGeometry({ start: '2026-10-03', end: '2026-10-05' }, '2026-10-01', 'month')).toEqual({ offset: 80, width: 120 });
    });

    it('does not shift across a daylight saving change', () => {
      expect(barGeometry({ start: '2026-03-30', end: '2026-03-30' }, '2026-03-28', 'month')).toEqual({ offset: 80, width: 40 });
      expect(barGeometry({ start: '2026-11-02', end: '2026-11-02' }, '2026-10-31', 'month')).toEqual({ offset: 80, width: 40 });
    });

    it('keeps a bar at least a few pixels wide at far zoom levels', () => {
      expect(barGeometry({ start: '2026-10-03', end: '2026-10-03' }, '2026-10-01', '5_years').width).toBeGreaterThanOrEqual(4);
    });
  });

  describe('visibleRange and offscreenSide', () => {
    it('reads the first and last day on screen from the scroll position', () => {
      expect(visibleRange({ scrollStart: 400, viewport: 400, windowStart: '2026-10-01', zoom: 'month' }))
        .toEqual({ first: '2026-10-11', last: '2026-10-20' });
    });

    it('tells whether a bar lies before or after the screen', () => {
      const range = { first: '2026-10-11', last: '2026-10-20' };

      expect(offscreenSide({ start: '2026-10-01', end: '2026-10-10' }, range)).toBe('before');
      expect(offscreenSide({ start: '2026-10-21', end: '2026-10-22' }, range)).toBe('after');
      expect(offscreenSide({ start: '2026-10-01', end: '2026-10-11' }, range)).toBeNull();
    });
  });

  describe('moveBar', () => {
    it('moves a range in one property and keeps its length', () => {
      expect(moveBar({ start: '2026-10-05/2026-10-09', end: undefined }, 3)).toEqual({ start: '2026-10-08/2026-10-12' });
    });

    it('moves both properties of a two-property bar', () => {
      expect(moveBar({ start: '2026-10-05', end: '2026-10-09' }, -2)).toEqual({ start: '2026-10-03', end: '2026-10-07' });
    });

    it('keeps times on a moved value', () => {
      expect(moveBar({ start: '2026-10-05T09:30', end: undefined }, 1)).toEqual({ start: '2026-10-06T09:30' });
    });

    it('leaves an empty end empty', () => {
      expect(moveBar({ start: '2026-10-05', end: null }, 1)).toEqual({ start: '2026-10-06' });
    });
  });

  describe('hours zoom: bars move by minutes and sit by the time', () => {
    it('moves a timed value by minutes', () => {
      expect(moveBar({ start: '2026-10-05T09:30', end: undefined }, 0, 5 * 60)).toEqual({ start: '2026-10-05T14:30' });
      expect(moveBar({ start: '2026-10-05T09:30', end: undefined }, 0, 15)).toEqual({ start: '2026-10-05T09:45' });
    });

    it('carries a timed range across midnight and keeps its length', () => {
      expect(moveBar({ start: '2026-10-05T22:00/2026-10-05T23:15', end: undefined }, 0, 3 * 60)).toEqual({ start: '2026-10-06T01:00/2026-10-06T02:15' });
    });

    it('moves both timed properties of a two-property bar back by minutes', () => {
      expect(moveBar({ start: '2026-10-05T01:00', end: '2026-10-05T04:00' }, -1, -2 * 60)).toEqual({ start: '2026-10-04T23:00', end: '2026-10-05T02:00' });
      expect(moveBar({ start: '2026-10-05T00:00', end: '2026-10-05T01:00' }, 0, -15)).toEqual({ start: '2026-10-04T23:45', end: '2026-10-05T00:45' });
    });

    it('moves a value with no time by the day count only', () => {
      expect(moveBar({ start: '2026-10-05', end: undefined }, 1, 30)).toEqual({ start: '2026-10-06' });
    });

    it('keeps the zone text of an older full timestamp', () => {
      expect(moveBar({ start: '2026-10-05T15:00:00.000Z', end: undefined }, 0, 2 * 60)).toEqual({ start: '2026-10-05T17:00:00.000Z' });
    });

    // notion-motion.md Round 34 §5: 7000 px per day, so 4.861 px per minute.
    const perMinute = 7000 / 1440;
    const geometry = (offset: number, width: number): { offset: number; width: number } => ({ offset: offset * perMinute, width: width * perMinute });

    it('draws 7000 px per day, as measured in Notion', () => {
      expect(TIMELINE_DAY_WIDTH.hours).toBe(7000);
    });

    it('places a timed bar at its hour, one hour wide when it has no end time', () => {
      expect(hourBarGeometry({ start: '2026-10-01T09:30', end: undefined }, '2026-10-01')).toEqual(geometry(570, 60));
    });

    it('spans a timed range from its start time to its end time', () => {
      expect(hourBarGeometry({ start: '2026-10-01T09:00/2026-10-01T12:00', end: undefined }, '2026-10-01')).toEqual(geometry(540, 180));
      expect(hourBarGeometry({ start: '2026-10-02T01:00', end: '2026-10-02T03:00' }, '2026-10-01')).toEqual(geometry(1500, 120));
    });

    it('leaves a value with no time to the day geometry', () => {
      expect(hourBarGeometry({ start: '2026-10-02', end: undefined }, '2026-10-01')).toBeNull();
    });
  });

  // notion-motion.md Round 48 A9: Day zoom moves snap to 15 minutes, and an all-day bar becomes timed.
  describe('day zoom: moves by minutes', () => {
    it('draws a timed bar by its time at the Day width', () => {
      const perMinute = TIMELINE_DAY_WIDTH.day / 1440;

      expect(hourBarGeometry({ start: '2026-10-01T18:30/2026-10-01T21:30', end: undefined }, '2026-10-01', TIMELINE_DAY_WIDTH.day))
        .toEqual({ offset: 1110 * perMinute, width: 180 * perMinute });
    });

    it('turns an all-day bar into a timed range from its first midnight to the midnight after its last day', () => {
      expect(moveBarByMinutes({ start: '2026-11-18', end: undefined }, 75)).toEqual({ start: '2026-11-18T01:15/2026-11-19T01:15' });
      expect(moveBarByMinutes({ start: '2026-11-18/2026-11-20', end: undefined }, -30)).toEqual({ start: '2026-11-17T23:30/2026-11-20T23:30' });
    });

    it('writes timed start and end values when the view has an end property', () => {
      expect(moveBarByMinutes({ start: '2026-11-18', end: '2026-11-20' }, 75)).toEqual({ start: '2026-11-18T01:15', end: '2026-11-21T01:15' });
      expect(moveBarByMinutes({ start: '2026-11-18', end: null }, 75)).toEqual({ start: '2026-11-18T01:15', end: '2026-11-19T01:15' });
    });

    it('shifts a timed bar by the minutes, its length kept', () => {
      expect(moveBarByMinutes({ start: '2026-11-18T09:00/2026-11-18T10:00', end: undefined }, 75)).toEqual({ start: '2026-11-18T10:15/2026-11-18T11:15' });
      expect(moveBarByMinutes({ start: '2026-11-18T09:00', end: undefined }, 15)).toEqual({ start: '2026-11-18T09:15' });
    });

    it('writes nothing for a zero move', () => {
      expect(moveBarByMinutes({ start: '2026-11-18', end: undefined }, 0)).toEqual({});
    });
  });

  describe('resizeBar', () => {
    it('drags the end of a one-property bar into a range', () => {
      expect(resizeBar({ start: '2026-10-05', end: undefined }, 'end', '2026-10-09')).toEqual({ start: '2026-10-05/2026-10-09' });
    });

    it('stops an edge at the other edge', () => {
      expect(resizeBar({ start: '2026-10-05/2026-10-09', end: undefined }, 'start', '2026-10-20')).toEqual({ start: '2026-10-09' });
    });

    it('writes only the dragged property of a two-property bar', () => {
      expect(resizeBar({ start: '2026-10-05', end: '2026-10-09' }, 'end', '2026-10-12')).toEqual({ end: '2026-10-12' });
      expect(resizeBar({ start: '2026-10-05', end: '2026-10-09' }, 'start', '2026-10-01')).toEqual({ start: '2026-10-01' });
      expect(resizeBar({ start: '2026-10-05', end: null }, 'end', '2026-10-07')).toEqual({ end: '2026-10-07' });
      expect(resizeBar({ start: '2026-10-05', end: '2026-10-09' }, 'start', '2026-10-30')).toEqual({ start: '2026-10-09' });
    });
  });

  describe('snapMinutes: research/22 §9, Notion rounds a drag to the nearest 15 minutes', () => {
    it('keeps a drag under half a step and rounds a longer one, both ways', () => {
      expect(snapMinutes(4)).toBe(0);
      expect(snapMinutes(8)).toBe(15);
      expect(snapMinutes(-6)).toBe(0);
      expect(snapMinutes(-21)).toBe(-15);
      expect(snapMinutes(-8)).toBe(-15);
      expect(snapMinutes(52)).toBe(45);
    });

    it('rounds half a step away from zero on both sides', () => {
      expect(snapMinutes(7.5)).toBe(15);
      expect(snapMinutes(-7.5)).toBe(-15);
    });
  });

  describe('timedEdges', () => {
    it('reads both timed edges, giving a value with no end the hour it is drawn with', () => {
      expect(timedEdges({ start: '2026-10-20T03:00/2026-10-20T04:30', end: undefined })).toEqual({ start: '2026-10-20T03:00', end: '2026-10-20T04:30' });
      expect(timedEdges({ start: '2026-10-20T23:30', end: undefined })).toEqual({ start: '2026-10-20T23:30', end: '2026-10-21T00:30' });
      expect(timedEdges({ start: '2026-10-20T03:00', end: '2026-10-20T05:00' })).toEqual({ start: '2026-10-20T03:00', end: '2026-10-20T05:00' });
      expect(timedEdges({ start: '2026-10-20T03:00', end: null })).toEqual({ start: '2026-10-20T03:00', end: '2026-10-20T04:00' });
    });

    it('is null when an edge has no time', () => {
      expect(timedEdges({ start: '2026-10-20', end: undefined })).toBeNull();
      expect(timedEdges({ start: '2026-10-20T03:00', end: '2026-10-21' })).toBeNull();
    });
  });

  describe('resizeBarByMinutes', () => {
    it('drags the start edge of a timed range by minutes and keeps the end', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T04:00', end: undefined }, 'start', -15)).toEqual({ start: '2026-10-20T02:45/2026-10-20T04:00' });
    });

    it('drags the end edge of a timed range by minutes and keeps the start', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T04:00', end: undefined }, 'end', 15)).toEqual({ start: '2026-10-20T03:00/2026-10-20T04:15' });
    });

    it('gives a timed value with no end the hour it is drawn with, then moves the dragged edge', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: undefined }, 'start', -15)).toEqual({ start: '2026-10-20T02:45/2026-10-20T04:00' });
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: undefined }, 'end', 30)).toEqual({ start: '2026-10-20T03:00/2026-10-20T04:30' });
    });

    it('stops an edge one step before the other edge', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T04:00', end: undefined }, 'start', 120)).toEqual({ start: '2026-10-20T03:45/2026-10-20T04:00' });
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T04:00', end: undefined }, 'end', -120)).toEqual({ start: '2026-10-20T03:00/2026-10-20T03:15' });
    });

    it('never pushes an edge outward on its own when the bar is shorter than a step', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T03:10', end: undefined }, 'end', -15)).toEqual({});
    });

    it('writes only the dragged property of a two-property bar', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: '2026-10-20T04:00' }, 'start', -15)).toEqual({ start: '2026-10-20T02:45' });
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: '2026-10-20T04:00' }, 'end', 30)).toEqual({ end: '2026-10-20T04:30' });
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: null }, 'end', 15)).toEqual({ end: '2026-10-20T04:15' });
    });

    it('writes nothing when the edge does not move, so an unchanged bar keeps its stored value', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: undefined }, 'end', 0)).toEqual({});
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00/2026-10-20T03:10', end: undefined }, 'start', 15)).toEqual({});
    });

    it('crosses midnight', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20T00:00/2026-10-20T01:00', end: undefined }, 'start', -15)).toEqual({ start: '2026-10-19T23:45/2026-10-20T01:00' });
    });

    it('leaves a value with no time to the day resize', () => {
      expect(resizeBarByMinutes({ start: '2026-10-20', end: undefined }, 'start', -15)).toBeNull();
      expect(resizeBarByMinutes({ start: '2026-10-20T03:00', end: '2026-10-21' }, 'end', 15)).toBeNull();
    });
  });

  describe('headerUnits', () => {
    it('labels days under months at month zoom, each label formatted by Intl', () => {
      const { groups, units } = headerUnits({ start: '2026-10-01', days: 45 }, 'month', 'en-US');
      const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(2026, 9, 1));

      expect(groups[0]).toMatchObject({ label: monthLabel, offset: 0, width: 31 * 40 });
      expect(groups[1].offset).toBe(31 * 40);
      expect(units).toHaveLength(45);
      expect(units[0]).toMatchObject({ offset: 0, width: 40, day: '2026-10-01' });
      expect(units[0].label).toBe(new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(new Date(2026, 9, 1)));
    });

    // notion-motion.md Round 47 A1b (r47-n-tl-year-today.raw): Year ticks are weeks from Monday, 35 wide, read "3", "10".
    it('labels Monday weeks under months at year zoom', () => {
      const { units } = headerUnits({ start: '2026-08-01', days: 40 }, 'year', 'en-US');

      expect(units[1]).toMatchObject({ label: '3', day: '2026-08-03', offset: 2 * 5, width: 35 });
      expect(units[2]).toMatchObject({ label: '10', day: '2026-08-10', offset: 9 * 5 });
    });

    // notion-motion.md Round 48 A1: Quarter and Year name each month with no year, from its first Monday
    // (Year: "October" at the Oct 5 line, "November" at Nov 2, "December" at Dec 7, "January" at Jan 4).
    it.each(['quarter', 'year'] as const)('names each month from its first Monday at %s zoom', (zoom) => {
      const { groups } = headerUnits({ start: '2026-10-01', days: 120 }, zoom, 'en-US');
      const width = TIMELINE_DAY_WIDTH[zoom];

      expect(groups.map((group) => [group.label, group.day, group.offset])).toEqual([
        ['October', '2026-10-05', 4 * width],
        ['November', '2026-11-02', 32 * width],
        ['December', '2026-12-07', 67 * width],
        ['January', '2027-01-04', 95 * width],
      ]);
      expect(groups[0].width).toBe(28 * width);
    });

    // notion-motion.md Round 47 A1b (r47-n-tl-5y-today.raw): 5 Years ticks are months, read as numbers "1".."12".
    it('labels numbered months under years at 5 years zoom', () => {
      const { groups, units } = headerUnits({ start: '2026-01-01', days: 400 }, '5_years', 'en-US');

      expect(groups[0].label).toBe('2026');
      expect(units[0]).toMatchObject({ label: '1', day: '2026-01-01', offset: 0, width: 31 });
      expect(units[1]).toMatchObject({ label: '2', day: '2026-02-01', offset: 31, width: 28 });
      expect(units[11].label).toBe('12');
    });

    // notion-motion.md Round 47 A1b (r47-n-hdr-day.raw, r47-n-tl-day-today.raw): Day ticks are hours, 52.1 apart, read "5 AM".
    it('labels hours under days at day zoom, in the locale\'s clock', () => {
      const { units } = headerUnits({ start: '2026-10-01', days: 2 }, 'day', 'en-US');

      expect(units).toHaveLength(2 * 24);
      expect(units[5].offset).toBeCloseTo(5 * 52.08, 1);
      expect(units[5].width).toBeCloseTo(52.08, 1);
      expect(units[5]).toMatchObject({ day: '2026-10-01', period: 'AM' });
      // Same plain space as the Hours zoom's ticks, which come from format(), not formatToParts().
      expect(units[5].label).toBe('5 AM');
      expect(units[24].day).toBe('2026-10-02');
      expect(headerUnits({ start: '2026-10-01', days: 1 }, 'day', 'de-DE').units[17].label).toBe('17');
    });

    // notion-motion.md Round 34 §5: a tick every 15 minutes, 72.92 apart, read "h:mm PM" in en-US.
    it('labels quarter hours under days at hours zoom, in the locale\'s time', () => {
      const { groups, units } = headerUnits({ start: '2026-10-01', days: 2 }, 'hours', 'en-US');

      expect(groups).toHaveLength(2);
      expect(units).toHaveLength(2 * 96);
      expect(units[1].offset).toBeCloseTo(72.92, 2);
      expect(units[1].width).toBeCloseTo(72.92, 2);
      expect(units[1].day).toBe('2026-10-01');
      expect(units[96].day).toBe('2026-10-02');
      expect(units[69].label).toMatch(/^5:15\sPM$/);
      expect(headerUnits({ start: '2026-10-01', days: 1 }, 'hours', 'de-DE').units[69].label).toBe('17:15');
    });
  });
});
