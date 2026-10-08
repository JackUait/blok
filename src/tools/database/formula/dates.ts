import type { FormulaDate } from './types';

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Only numeric parts are read, so the result does not depend on the ICU data
 * that ships with a Node version. `hourCycle: 'h23'`, not `hour12: false`,
 * which can print midnight as "24".
 */
const formatterFor = (timeZone: string | undefined): Intl.DateTimeFormat => {
  const key = timeZone ?? '';
  const cached = formatters.get(key);

  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });

  formatters.set(key, created);

  return created;
};

export const wallTime = (ms: number, timeZone: string | undefined): WallTime => {
  const parts: Record<string, number> = {};

  for (const part of formatterFor(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  return {
    year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second,
    ms: ((ms % 1000) + 1000) % 1000,
  };
};

/** The wall time as if it were UTC: lets calendar math ignore offsets. */
const wallMs = (w: WallTime): number => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);

const fromWallMs = (value: number): WallTime => wallTime(value, 'UTC');

/** The instant a wall time names in a zone. In a DST gap it lands after the gap. */
export const zonedToEpoch = (w: WallTime, timeZone: string | undefined): number => {
  const guess = wallMs(w);
  const firstOffset = wallMs(wallTime(guess, timeZone)) - guess;
  const first = guess - firstOffset;
  const secondOffset = wallMs(wallTime(first, timeZone)) - first;

  return secondOffset === firstOffset ? first : guess - secondOffset;
};

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO 8601 date or date-time. A time without a zone is read in `timeZone`. */
export const parseIsoDate = (text: string, timeZone: string | undefined): FormulaDate | null => {
  const m = ISO.exec(text.trim());

  if (m === null) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const hasTime = m[4] !== undefined;
  const w: WallTime = {
    year, month, day,
    hour: hasTime ? Number(m[4]) : 0,
    minute: hasTime ? Number(m[5]) : 0,
    second: m[6] === undefined ? 0 : Number(m[6]),
    ms: m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0')),
  };

  if (w.hour > 23 || w.minute > 59 || w.second > 59) return null;
  const zone = m[8];

  if (zone === undefined) return { kind: 'date', start: zonedToEpoch(w, timeZone), hasTime };
  const sign = zone.startsWith('-') ? -1 : 1;
  const offset = zone === 'Z' ? 0 : sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * 60_000;

  return { kind: 'date', start: wallMs(w) - offset, hasTime };
};

/**
 * Reads a stored date property: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, or a range `start/end`.
 * Swap for `parseDateValue` from src/tools/database/cells/date-value.ts once p1-cells merges.
 */
export const parseStoredDate = (value: string, timeZone: string | undefined): FormulaDate | null => {
  const [startText, endText, ...rest] = value.split('/');

  if (rest.length > 0) return null;
  const start = parseIsoDate(startText, timeZone);

  if (start === null || endText === undefined) return start;
  const end = parseIsoDate(endText, timeZone);

  if (end === null) return start;

  return { kind: 'date', start: start.start, end: end.start, hasTime: start.hasTime || end.hasTime };
};

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Writes a date in the stored form `parseStoredDate` reads. */
export const formulaDateToStored = (date: FormulaDate, timeZone: string | undefined): string => {
  const one = (ms: number): string => {
    const w = wallTime(ms, timeZone);
    const day = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;

    return date.hasTime ? `${day}T${pad(w.hour)}:${pad(w.minute)}` : day;
  };

  return date.end === undefined ? one(date.start) : `${one(date.start)}/${one(date.end)}`;
};

export type DateUnit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes';

const UNITS: Record<string, DateUnit> = {
  years: 'years', year: 'years', quarters: 'quarters', quarter: 'quarters', months: 'months', month: 'months',
  weeks: 'weeks', week: 'weeks', days: 'days', day: 'days', hours: 'hours', hour: 'hours', minutes: 'minutes', minute: 'minutes',
};

export const dateUnit = (text: string): DateUnit | undefined => UNITS[text];

const addMonthsWall = (value: number, months: number): number => {
  const w = fromWallMs(value);
  const index = w.year * 12 + (w.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;

  return wallMs({ ...w, year, month, day: Math.min(w.day, daysInMonth(year, month)) });
};

const MONTHS_PER: Partial<Record<DateUnit, number>> = { years: 12, quarters: 3, months: 1 };
const DAYS_PER: Partial<Record<DateUnit, number>> = { weeks: 7, days: 1 };
const MS_PER: Partial<Record<DateUnit, number>> = { hours: 3_600_000, minutes: 60_000 };

/** Calendar units keep the local wall time across DST; hours and minutes add real time. */
export const addToDate = (ms: number, amount: number, unit: DateUnit, timeZone: string | undefined): number => {
  const msPer = MS_PER[unit];

  if (msPer !== undefined) return ms + amount * msPer;
  const wall = wallMs(wallTime(ms, timeZone));
  const months = MONTHS_PER[unit];
  const shifted = months !== undefined ? addMonthsWall(wall, Math.trunc(amount) * months) : wall + amount * (DAYS_PER[unit] ?? 0) * DAY;

  return zonedToEpoch(fromWallMs(shifted), timeZone);
};

/** moment.js `monthDiff`, which Notion's month results match on the help page examples. */
const monthDiff = (a: number, b: number): number => {
  const wa = fromWallMs(a);
  const wb = fromWallMs(b);

  if (wa.day < wb.day) return -monthDiff(b, a);
  const whole = (wb.year - wa.year) * 12 + (wb.month - wa.month);
  const anchor = addMonthsWall(a, whole);
  const after = b - anchor >= 0;
  const anchor2 = addMonthsWall(a, after ? whole + 1 : whole - 1);
  const adjust = after ? (b - anchor) / (anchor2 - anchor) : (b - anchor) / (anchor - anchor2);

  return -(whole + adjust) || 0;
};

/** `a - b` in whole units, truncated toward zero. */
export const dateDifference = (a: number, b: number, unit: DateUnit, timeZone: string | undefined): number => {
  const msPer = MS_PER[unit];

  if (msPer !== undefined) return Math.trunc((a - b) / msPer) || 0;
  const wa = wallMs(wallTime(a, timeZone));
  const wb = wallMs(wallTime(b, timeZone));
  const days = DAYS_PER[unit];

  if (days !== undefined) return Math.trunc((wa - wb) / (days * DAY)) || 0;

  return Math.trunc(monthDiff(wa, wb) / (MONTHS_PER[unit] ?? 1)) || 0;
};

/** 1 (Monday) to 7 (Sunday). */
const isoWeekday = (w: WallTime): number => {
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();

  return day === 0 ? 7 : day;
};

const isoWeek = (w: WallTime): number => {
  const date = Date.UTC(w.year, w.month - 1, w.day);
  const thursday = date + (4 - isoWeekday(w)) * DAY;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);

  return 1 + Math.floor((thursday - yearStart) / (7 * DAY));
};

export type DatePart = 'minute' | 'hour' | 'day' | 'date' | 'week' | 'month' | 'year';

export const datePart = (ms: number, part: DatePart, timeZone: string | undefined): number => {
  const w = wallTime(ms, timeZone);

  switch (part) {
    case 'minute': return w.minute;
    case 'hour': return w.hour;
    case 'day': return isoWeekday(w);
    case 'date': return w.day;
    case 'week': return isoWeek(w);
    case 'month': return w.month;
    case 'year': return w.year;
  }
};

export const startOfDay = (ms: number, timeZone: string | undefined): number =>
  zonedToEpoch({ ...wallTime(ms, timeZone), hour: 0, minute: 0, second: 0, ms: 0 }, timeZone);

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';

  return `${n}${suffix}`;
};

const TOKENS = /\[([^\]]*)\]|YYYY|YY|Y|Q|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a|WW|W/g;

/** The help page documents `h` as 0-23 ("h:mm A" gives "17:55 PM"), so `h` and `H` agree. */
export const formatDatePattern = (ms: number, pattern: string, timeZone: string | undefined): string => {
  const w = wallTime(ms, timeZone);

  return pattern.replace(TOKENS, (token: string, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY': case 'Y': return String(w.year);
      case 'YY': return pad(w.year % 100);
      case 'Q': return String(Math.ceil(w.month / 3));
      case 'MMMM': return MONTHS[w.month - 1];
      case 'MMM': return MONTHS[w.month - 1].slice(0, 3);
      case 'MM': return pad(w.month);
      case 'M': return String(w.month);
      case 'Do': return ordinal(w.day);
      case 'DD': return pad(w.day);
      case 'D': return String(w.day);
      case 'dddd': return WEEKDAYS[isoWeekday(w) - 1];
      case 'ddd': return WEEKDAYS[isoWeekday(w) - 1].slice(0, 3);
      case 'HH': case 'hh': return pad(w.hour);
      case 'H': case 'h': return String(w.hour);
      case 'mm': return pad(w.minute);
      case 'm': return String(w.minute);
      case 'ss': return pad(w.second);
      case 's': return String(w.second);
      case 'A': return w.hour < 12 ? 'AM' : 'PM';
      case 'a': return w.hour < 12 ? 'am' : 'pm';
      case 'WW': return pad(isoWeek(w));
      default: return String(isoWeek(w));
    }
  });
};

/** `format()` of a date: "August 30, 2023 17:55" per the help page; ranges join with " → ". */
export const formatDateValue = (date: FormulaDate, timeZone: string | undefined): string => {
  const one = (ms: number): string => formatDatePattern(ms, date.hasTime ? 'MMMM D, YYYY HH:mm' : 'MMMM D, YYYY', timeZone);

  return date.end === undefined ? one(date.start) : `${one(date.start)} → ${one(date.end)}`;
};
