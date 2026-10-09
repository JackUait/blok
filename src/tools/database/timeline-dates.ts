import { addDays, daysBetween, eventSpan, moveDateValue, resizeDateValue, weekdayOf } from './calendar-dates';
import type { EventSpan } from './calendar-dates';
import { parseDateValue } from './cells/date-value';
import { toLocalDate } from './cells/date-format';
import type { PropertyValue, TimelineZoom } from './types';
import { TIMELINE_ZOOMS } from './view-settings';

/**
 * Timeline geometry on `YYYY-MM-DD` strings. Pixel offsets come from whole
 * day counts (`daysBetween`), never from milliseconds, so a DST change cannot
 * shift a bar.
 */

/** Pixels per day. Month (40) is measured in Notion (research/08); the rest are unmeasured. */
export const TIMELINE_DAY_WIDTH: Readonly<Record<TimelineZoom, number>> = {
  hours: 1440,
  day: 280,
  week: 140,
  bi_week: 80,
  month: 40,
  quarter: 12,
  year: 4,
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

/** Moves a bar by whole days. Times and lengths stay. */
export const moveBar = (values: BarValues, deltaDays: number): BarWrite => {
  const shift = (value: PropertyValue | undefined): string | null => {
    const day = firstDay(value);

    return day === null ? null : moveDateValue(value, addDays(day, deltaDays));
  };
  const start = shift(values.start);
  const end = values.end === undefined ? null : shift(values.end);

  return { ...(start !== null ? { start } : {}), ...(end !== null ? { end } : {}) };
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

export interface HeaderUnit {
  label: string;
  /** Pixels from the canvas start. */
  offset: number;
  width: number;
  /** The unit's first day. */
  day: string;
}

type Unit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

const GROUP_OF: Record<TimelineZoom, Unit> = {
  hours: 'day', day: 'month', week: 'month', bi_week: 'month', month: 'month', quarter: 'month', year: 'year', '5_years': 'year',
};

const UNIT_OF: Record<TimelineZoom, Unit> = {
  hours: 'hour', day: 'day', week: 'day', bi_week: 'day', month: 'day', quarter: 'week', year: 'month', '5_years': 'quarter',
};

const FORMAT: Record<Unit, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  day: { day: 'numeric' },
  week: { day: 'numeric' },
  month: { month: 'short' },
  quarter: { month: 'short' },
  year: { year: 'numeric' },
};

const GROUP_FORMAT: Partial<Record<Unit, Intl.DateTimeFormatOptions>> = {
  day: { weekday: 'short', month: 'short', day: 'numeric' },
  month: { month: 'long', year: 'numeric' },
  year: { year: 'numeric' },
};

const startsUnit = (unit: Unit, day: string): boolean => {
  const month = Number(day.slice(5, 7));
  const firstOfMonth = day.endsWith('-01');

  switch (unit) {
    case 'week': return weekdayOf(day) === 1;
    case 'month': return firstOfMonth;
    case 'quarter': return firstOfMonth && month % 3 === 1;
    case 'year': return firstOfMonth && month === 1;
    case 'day':
    case 'hour': return true;
  }
};

const unitsOf = (window: TimelineWindow, unit: Unit, dayWidth: number, format: Intl.DateTimeFormat): HeaderUnit[] => {
  if (unit === 'hour') {
    const hourWidth = dayWidth / 24;

    return Array.from({ length: window.days * 24 }, (_, i) => {
      const day = addDays(window.start, Math.floor(i / 24));
      const date = toLocalDate(day);

      date.setHours(i % 24);

      return { label: format.format(date), offset: i * hourWidth, width: hourWidth, day };
    });
  }

  const starts = Array.from({ length: window.days }, (_, i) => i).filter((i) => i === 0 || startsUnit(unit, addDays(window.start, i)));

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

  return {
    groups: unitsOf(window, group, width, new Intl.DateTimeFormat(locale, GROUP_FORMAT[group])),
    units: unitsOf(window, unit, width, new Intl.DateTimeFormat(locale, FORMAT[unit])),
  };
};
