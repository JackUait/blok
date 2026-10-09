import type { DateDisplay } from '../types';
import { parseDateValue } from './date-value';

/** Local wall-clock time of one stored date part. A part with a zone keeps its instant. */
export const toLocalDate = (part: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(part);

  if (match === null) {
    return new Date(part);
  }

  const [, y, m, d, hh, mm] = match;

  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a local date. */
export const toIsoDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** `HH:mm` of a local date. */
export const toIsoTime = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const resolveLocale = (locale: string | undefined): string =>
  locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

/** A stored part as display text: "October 9, 2026", plus the time when it has one. */
export const formatDatePart = (part: string, locale: string, hourCycle?: 'h12' | 'h23'): string => {
  const date = toLocalDate(part);
  const day = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);

  if (!part.includes('T')) {
    return day;
  }

  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(hourCycle !== undefined ? { hourCycle } : {}),
  }).format(date);

  return `${day} ${time}`;
};

/** Display text of a stored date value, or null when the value is not a date. */
export const formatDateText = (value: unknown, locale: string, hourCycle?: 'h12' | 'h23'): string | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const start = formatDatePart(parsed.start, locale, hourCycle);

  return parsed.end === undefined ? start : `${start} → ${formatDatePart(parsed.end, locale, hourCycle)}`;
};

interface WeekInfo {
  firstDay?: number;
}

interface LocaleWithWeekInfo {
  baseName?: string;
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
}

/**
 * First weekday of a locale, 0 = Sunday. Node 26 dropped the `weekInfo`
 * getter and kept `getWeekInfo()`; older engines have only the getter, and
 * Firefox has neither, so the fallback is Sunday.
 */
export const resolveWeekStart = (locale: string, createLocale: (tag: string) => LocaleWithWeekInfo = (tag) => new Intl.Locale(tag)): number => {
  try {
    const loc = createLocale(locale);
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    const firstDay = info?.firstDay;

    return typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7 ? firstDay % 7 : 0;
  } catch {
    return 0;
  }
};

/** Whether a locale writes 12-hour time. */
export const resolveHourCycle = (locale: string): 'h12' | 'h23' => {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;

    return cycle === 'h11' || cycle === 'h12' ? 'h12' : 'h23';
  } catch {
    return 'h23';
  }
};

/** Days within this distance of today read as relative words; further ones as the full date. */
const RELATIVE_DAY_LIMIT = 6;

const DAY_MS = 86_400_000;

/** A part with a zone (`Z` or an offset) is an instant; a bare part is wall time. */
const isInstant = (part: string): boolean => /(?:Z|[+-]\d{2}:?\d{2})$/.test(part);

interface DayParts {
  year: number;
  month: number;
  day: number;
}

/** Calendar parts of a stored part, read in `timeZone` when the part is an instant. */
const dayPartsOf = (part: string, timeZone: string | undefined): DayParts => {
  const date = toLocalDate(part);

  if (!isInstant(part) || timeZone === undefined) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }

  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const num = (type: string): number => Number(parts.find((p) => p.type === type)?.value);

  return { year: num('year'), month: num('month'), day: num('day') };
};

const zoneOption = (part: string, timeZone: string | undefined): Intl.DateTimeFormatOptions =>
  isInstant(part) && timeZone !== undefined ? { timeZone } : {};

const formatDay = (part: string, locale: string, display: DateDisplay, now: Date): string => {
  const { year, month, day } = dayPartsOf(part, display.timeZone);

  switch (display.dateFormat ?? 'full') {
    case 'month_day_year': return [pad(month), pad(day), String(year)].join('/');
    case 'day_month_year': return [pad(day), pad(month), String(year)].join('/');
    case 'year_month_day': return [String(year), pad(month), pad(day)].join('/');
    case 'short':
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', ...zoneOption(part, display.timeZone) }).format(toLocalDate(part));
    case 'relative': {
      const diff = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);

      if (Math.abs(diff) <= RELATIVE_DAY_LIMIT) {
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day');
      }

      return formatDay(part, locale, { ...display, dateFormat: 'full' }, now);
    }
    case 'full':
    default:
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', ...zoneOption(part, display.timeZone) }).format(toLocalDate(part));
  }
};

const HOUR_CYCLES: Record<string, 'h12' | 'h23'> = { '12_hour': 'h12', '24_hour': 'h23' };

const formatPart = (part: string, locale: string, display: DateDisplay, now: Date, hourCycle?: 'h12' | 'h23'): string => {
  const day = formatDay(part, locale, display, now);

  if (!part.includes('T') || display.timeFormat === 'hidden') {
    return day;
  }

  const cycle = (display.timeFormat !== undefined ? HOUR_CYCLES[display.timeFormat] : undefined) ?? hourCycle;
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(cycle !== undefined ? { hourCycle: cycle } : {}),
    ...zoneOption(part, display.timeZone),
  }).format(toLocalDate(part));

  return `${day} ${time}`;
};

/**
 * Display text of a stored date value under a property's date settings, or
 * null when the value is not a date. `now` anchors the relative format.
 */
export const formatDateDisplay = (
  value: unknown,
  locale: string,
  display: DateDisplay = {},
  now: Date = new Date(),
  hourCycle?: 'h12' | 'h23'
): string | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const start = formatPart(parsed.start, locale, display, now, hourCycle);

  return parsed.end === undefined ? start : `${start} → ${formatPart(parsed.end, locale, display, now, hourCycle)}`;
};
