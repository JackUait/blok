import { addDays, daysBetween, eventSpan, moveDateValue, resizeDateValue, weekdayOf } from './calendar-dates';
import type { EventSpan } from './calendar-dates';
import { parseDateValue } from './cells/date-value';
import { formatClock, toLocalDate } from './cells/date-format';
import type { PropertyValue, TimelineZoom } from './types';
import { TIMELINE_ZOOMS } from './view-settings';

/**
 * Timeline geometry on `YYYY-MM-DD` strings. Pixel offsets come from whole
 * day counts (`daysBetween`), never from milliseconds, so a DST change cannot
 * shift a bar.
 */

/** Pixels per day, measured in Notion (notion-motion.md Round 47 A1b). Day is 24 hour cells of 52.1. */
export const TIMELINE_DAY_WIDTH: Readonly<Record<TimelineZoom, number>> = {
  hours: 7000,
  day: 1250,
  week: 180,
  bi_week: 80,
  month: 40,
  quarter: 12,
  year: 5,
  '5_years': 1,
};

/** About how wide each side of the centre day is drawn. Panning past it redraws around a new centre. */
const HALF_WINDOW_PX = 3000;
const MIN_BAR_PX = 4;

/** `1` zooms in (toward hours), `-1` zooms out. Stops at the ends. */
export const zoomStep = (zoom: TimelineZoom, direction: 1 | -1): TimelineZoom => {
  const index = TIMELINE_ZOOMS.indexOf(zoom) - direction;

  return TIMELINE_ZOOMS[Math.min(Math.max(index, 0), TIMELINE_ZOOMS.length - 1)];
};

export interface TimelineWindow {
  /** First drawn day. */
  start: string;
  days: number;
}

const ALIGN_TO_MONTH: ReadonlySet<TimelineZoom> = new Set(['bi_week', 'month', 'quarter', 'year', '5_years']);

/** The drawn days, with `center` in the middle. Far zooms start on the 1st so month labels line up. */
export const timelineWindow = (center: string, zoom: TimelineZoom): TimelineWindow => {
  const half = Math.max(1, Math.ceil(HALF_WINDOW_PX / TIMELINE_DAY_WIDTH[zoom]));
  const rough = addDays(center, -half);
  const start = ALIGN_TO_MONTH.has(zoom) ? `${rough.slice(0, 8)}01` : rough;

  return { start, days: daysBetween(start, center) * 2 + 1 };
};

/**
 * The days a bar covers. `end` undefined means one property holds the
 * range; null or any value means a second end property.
 */
export const timelineSpan = (start: PropertyValue | undefined, end: PropertyValue | undefined): EventSpan | null => {
  if (end === undefined) {
    return eventSpan(start);
  }

  const from = eventSpan(start);

  if (from === null) {
    return null;
  }

  const to = eventSpan(end)?.end ?? from.end;

  return from.start <= to ? { start: from.start, end: to } : { start: to, end: from.start };
};

export const barGeometry = (span: EventSpan, windowStart: string, zoom: TimelineZoom): { offset: number; width: number } => {
  const width = TIMELINE_DAY_WIDTH[zoom];

  return {
    offset: daysBetween(windowStart, span.start) * width,
    width: Math.max((daysBetween(span.start, span.end) + 1) * width, MIN_BAR_PX),
  };
};

/**
 * Hours zoom: a bar whose start has a time sits at that time. It ends at its
 * end time, or one hour later when there is none. Null for a value with no
 * time, which keeps the day geometry.
 */
export const hourBarGeometry = (values: BarValues, windowStart: string, dayWidth = TIMELINE_DAY_WIDTH.hours): { offset: number; width: number } | null => {
  const start = parseDateValue(values.start);
  const from = start === null ? null : minutesFrom(windowStart, start.start);

  if (start === null || from === null) {
    return null;
  }

  const endPart = values.end === undefined ? start.end : parseDateValue(values.end)?.start;
  const to = endPart === undefined ? null : minutesFrom(windowStart, endPart);
  const pxPerMinute = dayWidth / DAY_MINUTES;
  const length = to !== null && to > from ? to - from : HOUR_MINUTES;

  return { offset: from * pxPerMinute, width: Math.max(length * pxPerMinute, MIN_BAR_PX) };
};

export interface VisibleRange {
  first: string;
  last: string;
}

/** The first and last day on screen. `scrollStart` is measured from the inline start of the canvas. */
export const visibleRange = ({ scrollStart, viewport, windowStart, zoom }: {
  scrollStart: number;
  viewport: number;
  windowStart: string;
  zoom: TimelineZoom;
}): VisibleRange => {
  const width = TIMELINE_DAY_WIDTH[zoom];

  return {
    first: addDays(windowStart, Math.floor(scrollStart / width)),
    last: addDays(windowStart, Math.max(Math.ceil((scrollStart + viewport) / width) - 1, 0)),
  };
};

export const offscreenSide = (span: EventSpan, range: VisibleRange): 'before' | 'after' | null => {
  if (span.end < range.first) {
    return 'before';
  }

  return span.start > range.last ? 'after' : null;
};

export interface BarValues {
  start: PropertyValue | undefined;
  /** Undefined: one property holds the range. Otherwise the end property's value. */
  end: PropertyValue | undefined;
}

export interface BarWrite {
  start?: string;
  end?: string;
}

const firstDay = (value: PropertyValue | undefined): string | null => parseDateValue(value)?.start.slice(0, 10) ?? null;

const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;
const TIMED_PART = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** Minutes from `windowStart` to a timed part, or null when the part has no time. */
const minutesFrom = (windowStart: string, part: string): number | null => {
  const match = TIMED_PART.exec(part);

  if (match === null) {
    return null;
  }

  return daysBetween(windowStart, match[1]) * DAY_MINUTES + Number(match[2]) * HOUR_MINUTES + Number(match[3]);
};

/** Shifts a timed part by minutes as wall time; text after `HH:mm` (seconds, zone) stays. */
const shiftPartByMinutes = (part: string, minutes: number): string => {
  const match = TIMED_PART.exec(part);

  if (match === null) {
    return part;
  }

  const total = Number(match[2]) * HOUR_MINUTES + Number(match[3]) + minutes;
  const dayShift = Math.floor(total / DAY_MINUTES);
  const inDay = total - dayShift * DAY_MINUTES;
  const pad = (n: number): string => String(n).padStart(2, '0');

  return `${addDays(match[1], dayShift)}T${pad(Math.floor(inDay / HOUR_MINUTES))}:${pad(inDay % HOUR_MINUTES)}${part.slice(match[0].length)}`;
};

/** Hours zoom drags snap to this many minutes (research/22 §9). */
export const SNAP_MINUTES = 15;

/** Rounds a drag to the nearest step; half a step rounds away from zero. `+ 0` turns -0 into 0. */
export const snapMinutes = (minutes: number): number =>
  Math.sign(minutes) * Math.round(Math.abs(minutes) / SNAP_MINUTES) * SNAP_MINUTES + 0;

/**
 * Moves a bar by whole days, times and lengths kept. With `deltaMinutes`
 * (hours zoom), a value that has a time moves by minutes instead.
 */
export const moveBar = (values: BarValues, deltaDays: number, deltaMinutes?: number): BarWrite => {
  const shift = (value: PropertyValue | undefined): string | null => {
    const parsed = parseDateValue(value);

    if (parsed !== null && parsed.hasTime && deltaMinutes !== undefined) {
      return [parsed.start, parsed.end].filter((part): part is string => part !== undefined)
        .map((part) => shiftPartByMinutes(part, deltaMinutes))
        .join('/');
    }

    const day = firstDay(value);

    return day === null ? null : moveDateValue(value, addDays(day, deltaDays));
  };
  const start = shift(values.start);
  const end = values.end === undefined ? null : shift(values.end);

  return { ...(start !== null ? { start } : {}), ...(end !== null ? { end } : {}) };
};

/** An all-day part as its first midnight; a timed part as it is. */
const midnightOf = (part: string): string => (TIMED_PART.test(part) ? part : `${part.slice(0, 10)}T00:00`);

/** An all-day part as the midnight after it; a timed part as it is. */
const midnightAfter = (part: string): string => (TIMED_PART.test(part) ? part : `${addDays(part.slice(0, 10), 1)}T00:00`);

/**
 * Day zoom: where a bar's last part ends. notion-motion.md Round 54 §1: an all-day range
 * ends at its end date's 00:00 (Nov 16 → 20 is 4 days); one day keeps the whole day.
 */
const dayZoomEnd = (first: string, last: string): string =>
  (!TIMED_PART.test(last) && last.slice(0, 10) > first.slice(0, 10) ? `${last.slice(0, 10)}T00:00` : midnightAfter(last));

/**
 * Day zoom: moves a bar by minutes. An all-day bar becomes timed, from
 * midnight of its first day to midnight after its last (notion-motion.md
 * Round 48 A9: all-day Nov 18 moved 75 minutes read "Nov 18 1:15 AM → Nov 19 1:15 AM").
 */
export const moveBarByMinutes = (values: BarValues, deltaMinutes: number): BarWrite => {
  const span = timelineSpan(values.start, values.end);
  const startValue = parseDateValue(values.start);

  if (deltaMinutes === 0 || span === null || startValue === null) {
    return {};
  }

  const shift = (part: string): string => shiftPartByMinutes(part, deltaMinutes);
  const startOf = (part: string): string => shift(midnightOf(part));
  const endOf = (part: string): string => shift(dayZoomEnd(startValue.start, part));

  if (values.end === undefined) {
    if (startValue.hasTime && startValue.end === undefined) {
      return { start: shift(startValue.start) };
    }

    return { start: `${startOf(startValue.start)}/${endOf(startValue.end ?? startValue.start)}` };
  }

  const endValue = parseDateValue(values.end);

  if (startValue.hasTime && endValue === null) {
    return { start: shift(startValue.start) };
  }

  return { start: startOf(startValue.start), end: endOf(endValue?.start ?? span.end) };
};

/** A new timed bar `minutes` long from a `YYYY-MM-DDTHH:mm` start: one range value, or a start and an end. */
export const newTimedBarWrite = (start: string, minutes: number, separateEnd: boolean): BarWrite => {
  const end = shiftPartByMinutes(start, minutes);

  return separateEnd ? { start, end } : { start: `${start}/${end}` };
};

/** Both timed edges of a bar. A value with no end ends an hour later, as drawn. Null when an edge has no time. */
export const timedEdges = (values: BarValues): { start: string; end: string } | null => {
  const start = parseDateValue(values.start);
  const endPart = values.end === undefined ? start?.end : parseDateValue(values.end)?.start;

  if (start === null || !TIMED_PART.test(start.start) || (endPart !== undefined && !TIMED_PART.test(endPart))) {
    return null;
  }

  return { start: start.start, end: endPart ?? shiftPartByMinutes(start.start, HOUR_MINUTES) };
};

/**
 * Hours zoom: drags one edge of a timed bar by minutes. The edge stops one
 * step before the other edge. Null when an edge has no time, so the day
 * resize applies.
 */
export const resizeBarByMinutes = (values: BarValues, edge: 'start' | 'end', deltaMinutes: number): BarWrite | null => {
  const edges = timedEdges(values);

  if (edges === null) {
    return null;
  }

  const day = edges.start.slice(0, 10);
  const length = (minutesFrom(day, edges.end) ?? 0) - (minutesFrom(day, edges.start) ?? 0);
  const delta = edge === 'start'
    ? Math.min(deltaMinutes, Math.max(length - SNAP_MINUTES, 0))
    : Math.max(deltaMinutes, Math.min(SNAP_MINUTES - length, 0));

  if (delta === 0) {
    return {};
  }

  const start = edge === 'start' ? shiftPartByMinutes(edges.start, delta) : edges.start;
  const end = edge === 'end' ? shiftPartByMinutes(edges.end, delta) : edges.end;

  if (values.end === undefined) {
    return { start: `${start}/${end}` };
  }

  return edge === 'start' ? { start } : { end };
};

/**
 * Day zoom: drags one edge of an all-day bar by minutes. The bar turns timed
 * and both edges are written (notion-motion.md Round 50 §3, Round 51 §2).
 */
export const resizeAllDayByMinutes = (values: BarValues, edge: 'start' | 'end', deltaMinutes: number): BarWrite => {
  const span = timelineSpan(values.start, values.end);
  const startValue = parseDateValue(values.start);

  if (deltaMinutes === 0 || span === null || startValue === null) {
    return {};
  }

  const start = midnightOf(startValue.start);
  const last = values.end === undefined ? startValue.end ?? startValue.start : parseDateValue(values.end)?.start ?? span.end;
  // notion-motion.md Round 51 §2 (one day), Round 56 §9 (a range): a start-edge drag ends at 11:59 PM of the last day.
  const end = edge === 'start' && !TIMED_PART.test(last) ? `${last.slice(0, 10)}T23:59` : dayZoomEnd(start, last);
  const timed: BarValues = values.end === undefined ? { start: `${start}/${end}`, end: undefined } : { start, end };
  const write = resizeBarByMinutes(timed, edge, deltaMinutes);

  if (write === null || Object.keys(write).length === 0) {
    return {};
  }

  return values.end === undefined ? write : { start, end, ...write };
};

/** Drags one edge to `toDay`. The edge stops at the other edge. */
export const resizeBar = (values: BarValues, edge: 'start' | 'end', toDay: string): BarWrite => {
  if (values.end === undefined) {
    const start = resizeDateValue(values.start, edge, toDay);

    return start === null ? {} : { start };
  }

  const span = timelineSpan(values.start, values.end);

  if (span === null) {
    return {};
  }

  if (edge === 'start') {
    const start = moveDateValue(values.start, toDay < span.end ? toDay : span.end);

    return start === null ? {} : { start };
  }

  const day = toDay > span.start ? toDay : span.start;

  return { end: firstDay(values.end) === null ? day : moveDateValue(values.end, day) ?? day };
};

/** A new `days`-long bar from `day`: one range value, or a start and an end when the view has an end property. */
export const newBarWrite = (day: string, days: number, separateEnd: boolean): BarWrite => ({
  start: day,
  ...resizeBar({ start: day, end: separateEnd ? null : undefined }, 'end', addDays(day, days - 1)),
});

export interface HeaderUnit {
  label: string;
  /** Pixels from the canvas start. */
  offset: number;
  width: number;
  /** The unit's first day. */
  day: string;
  /** Hours zoom: the "AM"/"PM" inside `label`, drawn in its own ink. */
  period?: string;
  /** Week and Bi-week zooms: the day's narrow weekday letter, written before `label`. */
  weekday?: string;
}

/** `monday-month`: a month counted from its first Monday. */
type Unit = 'hour' | 'day' | 'week' | 'month' | 'monday-month' | 'year';

/** notion-motion.md Round 48 A1: Quarter and Year name each month from its first Monday line. */
const GROUP_OF: Record<TimelineZoom, Unit> = {
  hours: 'day', day: 'month', week: 'month', bi_week: 'month', month: 'month', quarter: 'monday-month', year: 'monday-month', '5_years': 'year',
};

const UNIT_OF: Record<TimelineZoom, Unit> = {
  hours: 'hour', day: 'hour', week: 'day', bi_week: 'day', month: 'day', quarter: 'week', year: 'week', '5_years': 'month',
};

const WEEKDAY_LETTERS: ReadonlySet<TimelineZoom> = new Set(['week', 'bi_week']);

/** Hour ticks a day: Hours zoom every 15 minutes, Day zoom every hour (notion-motion.md Round 34 §5, Round 47 A1b). */
const TICKS_PER_DAY: Partial<Record<TimelineZoom, number>> = { hours: 96, day: 24 };

const FORMAT: Record<Unit, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  day: { day: 'numeric' },
  week: { day: 'numeric' },
  month: { month: 'numeric' },
  'monday-month': { month: 'numeric' },
  year: { year: 'numeric' },
};

const GROUP_FORMAT: Partial<Record<Unit, Intl.DateTimeFormatOptions>> = {
  day: { weekday: 'short', month: 'short', day: 'numeric' },
  month: { month: 'long', year: 'numeric' },
  // notion-motion.md Round 48 A1: "November", no year.
  'monday-month': { month: 'long' },
  year: { year: 'numeric' },
};

const startsUnit = (unit: Unit, day: string): boolean => {
  const month = Number(day.slice(5, 7));
  const firstOfMonth = day.endsWith('-01');

  switch (unit) {
    case 'week': return weekdayOf(day) === 1;
    case 'month': return firstOfMonth;
    case 'monday-month': return weekdayOf(day) === 1 && Number(day.slice(8)) <= 7;
    case 'year': return firstOfMonth && month === 1;
    case 'day':
    case 'hour': return true;
  }
};

/** The hour tick's text without its minutes: "5 PM", or "17" on a 24 hour clock. */
const hourOnly = (parts: Intl.DateTimeFormatPart[]): string => {
  const minute = parts.findIndex((part) => part.type === 'minute');

  // formatToParts puts U+202F before AM/PM; format(), which the Hours ticks use, gives a plain space.
  return parts.filter((_, i) => i !== minute && i !== minute - 1).map((part) => part.value.replace(/\u202F/g, ' ')).join('');
};

const unitsOf = (window: TimelineWindow, unit: Unit, dayWidth: number, format: Intl.DateTimeFormat, ticksPerDay = 1): HeaderUnit[] => {
  // notion-motion.md Round 34 §5: Hours zoom ticks every 15 minutes, in the locale's clock. Round 47 A1b: Day zoom every hour, "5 AM".
  if (unit === 'hour') {
    const tickWidth = dayWidth / ticksPerDay;
    const minutesPerTick = DAY_MINUTES / ticksPerDay;
    const { locale } = format.resolvedOptions();
    const periodFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });

    return Array.from({ length: window.days * ticksPerDay }, (_, i) => {
      const day = addDays(window.start, Math.floor(i / ticksPerDay));
      const date = toLocalDate(day);

      date.setMinutes((i % ticksPerDay) * minutesPerTick);
      const parts = periodFormat.formatToParts(date);
      const period = parts.find((part) => part.type === 'dayPeriod')?.value;
      const label = minutesPerTick === HOUR_MINUTES ? hourOnly(parts) : formatClock(date, locale, undefined);

      return { label, offset: i * tickWidth, width: tickWidth, day, ...(period !== undefined ? { period } : {}) };
    });
  }

  // A month before its first Monday belongs to the month before, which this window does not name.
  const starts = Array.from({ length: window.days }, (_, i) => i)
    .filter((i) => (i === 0 && unit !== 'monday-month') || startsUnit(unit, addDays(window.start, i)));

  return starts.map((i, n) => {
    const day = addDays(window.start, i);

    return {
      label: format.format(toLocalDate(day)),
      offset: i * dayWidth,
      width: ((starts[n + 1] ?? window.days) - i) * dayWidth,
      day,
    };
  });
};

/** The two header rows: groups (months, years or days) over units (hours, days, weeks or months). */
export const headerUnits = (window: TimelineWindow, zoom: TimelineZoom, locale: string): { groups: HeaderUnit[]; units: HeaderUnit[] } => {
  const width = TIMELINE_DAY_WIDTH[zoom];
  const group = GROUP_OF[zoom];
  const unit = UNIT_OF[zoom];

  const units = unitsOf(window, unit, width, new Intl.DateTimeFormat(locale, FORMAT[unit]), TICKS_PER_DAY[zoom]);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });

  return {
    groups: unitsOf(window, group, width, new Intl.DateTimeFormat(locale, GROUP_FORMAT[group])),
    // notion-motion.md Round 48 A4: "M 16".
    units: WEEKDAY_LETTERS.has(zoom) ? units.map((item) => ({ ...item, weekday: weekday.format(toLocalDate(item.day)) })) : units,
  };
};
