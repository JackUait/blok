import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  TIMELINE_DAY_WIDTH,
  barGeometry,
  headerUnits,
  moveBar,
  offscreenSide,
  resizeBar,
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

    it('labels months under years at year zoom', () => {
      const { groups, units } = headerUnits({ start: '2026-01-01', days: 400 }, 'year', 'en-US');

      expect(groups[0].label).toBe(new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(new Date(2026, 0, 1)));
      expect(units[1]).toMatchObject({ offset: 31 * TIMELINE_DAY_WIDTH.year, day: '2026-02-01' });
    });

    it('labels hours under days at hours zoom', () => {
      const { groups, units } = headerUnits({ start: '2026-10-01', days: 2 }, 'hours', 'en-US');

      expect(groups).toHaveLength(2);
      expect(units).toHaveLength(48);
      expect(units[1].offset).toBe(TIMELINE_DAY_WIDTH.hours / 24);
    });
  });
});
