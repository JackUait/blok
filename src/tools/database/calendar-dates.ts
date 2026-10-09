import { formatDateValue, parseDateValue } from './cells/date-value';
import type { CalendarRange, PropertyValue } from './types';

/**
 * Calendar day math on `YYYY-MM-DD` strings. Every step goes through local
 * date parts, never milliseconds, so a DST change cannot move a day.
 */

const DAY_MS = 86_400_000;

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);

  return [y, m, d];
};

const pad = (n: number): string => String(n).padStart(2, '0');

const fromParts = (y: number, m: number, d: number): string => {
  const date = new Date(y, m - 1, d);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const addDays = (day: string, n: number): string => {
  const [y, m, d] = parts(day);

  return fromParts(y, m, d + n);
};

/** UTC has no DST, so the difference is a whole number of days. */
export const daysBetween = (from: string, to: string): number => {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);

  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
};

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (day: string): number => {
  const [y, m, d] = parts(day);

  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export const startOfWeek = (day: string, weekStart: number): string =>
  addDays(day, -((weekdayOf(day) - weekStart + 7) % 7));

/** The weeks a month or week range shows, each seven days from the week start. */
export const calendarWeeks = ({ anchor, range, weekStart }: { anchor: string; range: CalendarRange; weekStart: number }): string[][] => {
  const week = (first: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(first, i));

  if (range === 'week') {
    return [week(startOfWeek(anchor, weekStart))];
  }

  const [y, m] = parts(anchor);
  const firstOfMonth = fromParts(y, m, 1);
  const lastOfMonth = fromParts(y, m + 1, 0);
  const firstShown = startOfWeek(firstOfMonth, weekStart);
  const count = Math.floor(daysBetween(firstShown, lastOfMonth) / 7) + 1;

  return Array.from({ length: count }, (_, i) => week(addDays(firstShown, i * 7)));
};

export const isWeekend = (day: string): boolean => {
  const weekday = weekdayOf(day);

  return weekday === 0 || weekday === 6;
};

export const visibleDays = (days: string[], showWeekends: boolean): string[] =>
  showWeekends ? days : days.filter((day) => !isWeekend(day));

/** The next or previous range. A month step lands on the 1st, so the 31st never skips a short month. */
export const shiftAnchor = (anchor: string, range: CalendarRange, step: number): string => {
  if (range === 'week') {
    return addDays(anchor, 7 * step);
  }

  const [y, m] = parts(anchor);

  return fromParts(y, m + step, 1);
};

export interface EventSpan {
  start: string;
  end: string;
}

/** The first and last day a date value covers. A zoned timestamp keeps its written day, as the query does. */
export const eventSpan = (value: PropertyValue | undefined): EventSpan | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const start = parsed.start.slice(0, 10);
  const end = (parsed.end ?? parsed.start).slice(0, 10);

  return start <= end ? { start, end } : { start: end, end: start };
};

export interface WeekEvent extends EventSpan {
  id: string;
}

export interface PlacedEvent {
  id: string;
  /** Index into the days passed in, inclusive. */
  startCol: number;
  endCol: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Bars for one week row. `days` may skip days (hidden weekends); an event
 * that only covers skipped days is left out. Lanes go to longer events
 * first, then each event takes the lowest free lane.
 */
export const layoutWeek = (days: string[], events: WeekEvent[]): PlacedEvent[] => {
  if (days.length === 0) {
    return [];
  }

  const first = days[0];
  const last = days[days.length - 1];
  const spans = events.flatMap((event, order) => {
    const startCol = days.findIndex((day) => day >= event.start);
    const endCol = days.length - 1 - [...days].reverse().findIndex((day) => day <= event.end);

    if (event.end < first || event.start > last || startCol === -1 || endCol >= days.length || startCol > endCol) {
      return [];
    }

    return [{ event, order, startCol, endCol }];
  });

  spans.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || a.order - b.order);

  const lanes: number[][] = [];

  return spans.map(({ event, startCol, endCol }) => {
    const free = lanes.findIndex((taken) => taken.every((col) => col < startCol || col > endCol));
    const lane = free === -1 ? lanes.length : free;

    lanes[lane] = [...(lanes[lane] ?? []), ...Array.from({ length: endCol - startCol + 1 }, (_, i) => startCol + i)];

    return {
      id: event.id,
      startCol,
      endCol,
      lane,
      continuesBefore: event.start < days[startCol],
      continuesAfter: event.end > days[endCol],
    };
  });
};

/** Sets the day of one stored part and keeps its time and zone text. */
const withDay = (part: string, day: string): string => `${day}${part.slice(10)}`;

/** Moves a date value so it starts on `toDay`. Times and the range length stay. */
export const moveDateValue = (value: PropertyValue | undefined, toDay: string): string | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const delta = daysBetween(parsed.start, toDay);
  const shift = (part: string): string => withDay(part, addDays(part, delta));

  return formatDateValue({ start: shift(parsed.start), ...(parsed.end !== undefined ? { end: shift(parsed.end) } : {}) });
};

/**
 * Drags one edge of a date value to `toDay`. The edge stops at the other
 * edge. A day range whose ends meet becomes one day; a timed one keeps both
 * times. A new end takes the start's time.
 */
export const resizeDateValue = (value: PropertyValue | undefined, edge: 'start' | 'end', toDay: string): string | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const endPart = parsed.end ?? parsed.start;
  const startDay = parsed.start.slice(0, 10);
  const endDay = endPart.slice(0, 10);
  const start = edge === 'start' ? withDay(parsed.start, toDay < endDay ? toDay : endDay) : parsed.start;
  const end = edge === 'end' ? withDay(endPart, toDay > startDay ? toDay : startDay) : endPart;

  return start === end ? start : formatDateValue({ start, end });
};
