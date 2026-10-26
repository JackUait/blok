import type { I18n } from '../../../../types';
import type { DateDisplay, DateFormat, TimeFormat } from '../types';
import { parseDateValue, toIsoDay, toIsoTime } from './date-value';
import { TIME_ZONE_NAMES } from './time-zone-names';

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

export { toIsoDay, toIsoTime };

export const resolveLocale = (locale: string | undefined): string =>
  locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

const baseLanguage = (tag: string): string => tag.split('-')[0].toLowerCase();

/**
 * The locale for dates and numbers next to the editor's words: the editor's
 * language, but the browser's tag when it speaks that language, so an en-GB
 * browser under an `en` editor keeps its 24 hour clock.
 */
export const editorLocale = (i18n: { getLocale?: () => string } | undefined): string => {
  const browser = resolveLocale(undefined);
  const editor = i18n?.getLocale?.();

  if (editor === undefined || baseLanguage(editor) === baseLanguage(browser)) return browser;

  return editor;
};

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

/** A stored part as short text: "Oct 20, 2:45 AM", or "Oct 20" when it has no time. */
export const formatShortDatePart = (part: string, locale: string, hourCycle?: 'h12' | 'h23'): string =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(part.includes('T') ? { hour: 'numeric', minute: '2-digit', ...(hourCycle !== undefined ? { hourCycle } : {}) } : {}),
  }).format(toLocalDate(part));

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

/**
 * The date picker's weekday names, Sunday first: Notion's two letters ("Su", "Mo").
 * Cut by grapheme, and only when the seven cuts stay distinct; else the short names
 * ("qua."/"qui." would both read "qu").
 */
export const pickerWeekdayNames = (locale: string): string[] => {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  // 1 January 2023 was a Sunday.
  const names = Array.from({ length: 7 }, (_, dow) => format.format(new Date(2023, 0, 1 + dow)));
  const cut = names.map((name) => [...segmenter.segment(name)].slice(0, 2).map((part) => part.segment).join(''));

  return new Set(cut).size === 7 ? cut : names;
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

/** How far typed relative words reach: Monday of last week to Sunday of next week. */
const RELATIVE_DAY_LIMIT = 13;

/** Literal keys, Monday first, so the i18n checks see each one. One key per weekday: the adjective agrees with it. */
const LAST_WEEKDAY_KEYS = [
  'tools.database.dateRelative.lastMonday',
  'tools.database.dateRelative.lastTuesday',
  'tools.database.dateRelative.lastWednesday',
  'tools.database.dateRelative.lastThursday',
  'tools.database.dateRelative.lastFriday',
  'tools.database.dateRelative.lastSaturday',
  'tools.database.dateRelative.lastSunday',
] as const;

const NEXT_WEEKDAY_KEYS = [
  'tools.database.dateRelative.nextMonday',
  'tools.database.dateRelative.nextTuesday',
  'tools.database.dateRelative.nextWednesday',
  'tools.database.dateRelative.nextThursday',
  'tools.database.dateRelative.nextFriday',
  'tools.database.dateRelative.nextSaturday',
  'tools.database.dateRelative.nextSunday',
] as const;

const capitalize = (text: string, locale: string): string => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

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

/**
 * Relative words for a day `diff` days from today (research/30 B6): ±1 day as
 * Today / Tomorrow / Yesterday, the rest of this Monday–Sunday week as the
 * weekday, the weeks around it as "Last" / "Next" <weekday>. null further out,
 * or for those two weeks when there is no `i18n`. Monday is fixed: Notion's
 * grid starts on Sunday and the rule still splits weeks on Monday.
 */
const relativeDay = (diff: number, date: Date, now: Date, locale: string, i18n?: Pick<I18n, 't'>): string | null => {
  if (Math.abs(diff) <= 1) {
    // research/23 §1: Notion writes "Today".
    return capitalize(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day'), locale);
  }
  const todayFromMonday = (now.getDay() + 6) % 7;
  const week = Math.floor((todayFromMonday + diff) / 7);
  const weekday = todayFromMonday + diff - week * 7;

  if (week === 0) return capitalize(new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date), locale);
  if (i18n === undefined || Math.abs(week) > 1) return null;

  return i18n.t((week < 0 ? LAST_WEEKDAY_KEYS : NEXT_WEEKDAY_KEYS)[weekday]);
};

interface DayOptions {
  /** The date picker's field: Full date with the short month (research/27 §4a), never relative words (research/30 B6). */
  field?: boolean;
  i18n?: Pick<I18n, 't'>;
  /** Feed and row-menu times: "3 days ago" within a week, as before research/30 (unmeasured there). */
  stamp?: boolean;
}

/** Days within this distance of today read as "N days ago" / "In N days" in a stamp. */
const STAMP_DAY_LIMIT = 6;

const formatDay = (part: string, locale: string, display: DateDisplay, now: Date, options: DayOptions = {}): string => {
  const { year, month, day } = dayPartsOf(part, display.timeZone);
  const field = options.field === true;

  switch (display.dateFormat ?? 'full') {
    case 'month_day_year': return [pad(month), pad(day), String(year)].join('/');
    case 'day_month_year': return [pad(day), pad(month), String(year)].join('/');
    case 'year_month_day': return [String(year), pad(month), pad(day)].join('/');
    // research/23 §1, 26 §5e, 27 §4a: "Oct 20" with no year, for any year. CSV export writes the full date.
    case 'short':
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...zoneOption(part, display.timeZone) }).format(toLocalDate(part));
    case 'relative': {
      const diff = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);
      const words = (): string | null => {
        if (field) return null;
        if (options.stamp !== true) return relativeDay(diff, new Date(year, month - 1, day), now, locale, options.i18n);

        return Math.abs(diff) <= STAMP_DAY_LIMIT
          ? capitalize(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day'), locale)
          : null;
      };

      return words() ?? formatDay(part, locale, { ...display, dateFormat: 'full' }, now, options);
    }
    case 'full':
    default:
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: field ? 'short' : 'long', day: 'numeric', ...zoneOption(part, display.timeZone) }).format(toLocalDate(part));
  }
};

/** A bare `YYYY-MM-DD` day as the date picker's field shows it: the property's Date format, no time. */
export const formatDayField = (day: string, locale: string, display: DateDisplay, now: Date = new Date()): string =>
  formatDay(day, locale, display, now, { field: true });

const NUMERIC_ORDER: Partial<Record<DateFormat, ReadonlyArray<'y' | 'm' | 'd'>>> = {
  month_day_year: ['m', 'd', 'y'],
  day_month_year: ['d', 'm', 'y'],
  year_month_day: ['y', 'm', 'd'],
};

/** A day from its numbers, or null when it is not on the calendar (31/02). */
const dayFrom = (year: number, month: number, day: number): string | null => {
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? toIsoDay(date) : null;
};

/**
 * Text typed in the date picker's field as `YYYY-MM-DD`, or null. Reads the
 * property's Date format, then ISO, then what the engine's Date.parse reads.
 * `yearOf` is the year a Short date without one belongs to.
 */
export const parseDayField = (text: string, locale: string, display: DateDisplay, yearOf: number, now: Date = new Date()): string | null => {
  const trimmed = text.trim();

  if (trimmed === '') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (iso !== null) return dayFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const format = display.dateFormat ?? 'full';
  const order = NUMERIC_ORDER[format];
  const numbers = /^(\d{1,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,4})$/.exec(trimmed);

  if (order !== undefined && numbers !== null) {
    const value = (key: 'y' | 'm' | 'd'): number => Number(numbers[order.indexOf(key) + 1]);

    return dayFrom(value('y'), value('m'), value('d'));
  }
  // Relative words typed by hand ("Yesterday", "Friday"); the field itself shows the full date.
  const near = format === 'relative'
    ? Array.from({ length: RELATIVE_DAY_LIMIT * 2 + 1 }, (_, i) => toIsoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i - RELATIVE_DAY_LIMIT)))
      .find((day) => formatDay(day, locale, display, now).toLocaleLowerCase(locale) === trimmed.toLocaleLowerCase(locale))
    : undefined;

  if (near !== undefined) return near;
  // Date.parse reads a yearless "Oct 12" as 2001.
  const withYear = format === 'short' && !/\d{4}/.test(trimmed) ? `${trimmed} ${yearOf}` : trimmed;
  const ms = Date.parse(withYear);

  return Number.isFinite(ms) ? toIsoDay(new Date(ms)) : null;
};

export const HOUR_CYCLES: Partial<Record<string, 'h12' | 'h23'>> = { '12_hour': 'h12', '24_hour': 'h23' };

/** The choices of Date format and Time format, shared by the property menu and the date picker. */
export const DATE_FORMATS: readonly DateFormat[] = ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day', 'relative'];
export const TIME_FORMATS: readonly TimeFormat[] = ['hidden', '12_hour', '24_hour'];

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

const offsetFormat = (zone: string): Intl.DateTimeFormat => {
  const format = offsetFormats.get(zone) ?? new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });

  offsetFormats.set(zone, format);

  return format;
};

/**
 * "GMT+2:00", "GMT", "GMT+05:30" (research/23 §1). Notion drops the hour's
 * leading zero on whole hours but kept it for Kolkata (one sample).
 */
export const zoneOffsetText = (zone: string, at: Date): string => {
  const name = offsetFormat(zone).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';

  // Chromium writes a zero offset as "GMT+00:00"; Notion shows "GMT".
  return /^GMT[+-]00:00$/.test(name) ? 'GMT' : name.replace(/([+-])0(\d:00)$/, '$1$2');
};

/** Notion's labels that no rule gives (research/37 §1.3). */
const ZONE_LABELS: Record<string, string> = {
  'America/Argentina/ComodRivadavia': 'Comod Rivadavia',
  'Antarctica/DumontDUrville': 'Dumont d\'Urville',
  'Chile/EasterIsland': 'Easter Island',
  'Europe/Kiev': 'Kyiv',
  'Mexico/BajaNorte': 'Baja Norte',
  'Mexico/BajaSur': 'Baja Sur',
  'Mexico/General': 'Mexico General',
};

/** Notion keeps "_" in these four (research/37 §1.3). */
const KEEPS_UNDERSCORE = ['America/Buenos_Aires', 'America/Indiana/Tell_City', 'America/North_Dakota/New_Salem', 'America/Santo_Domingo'];

/** Names two areas share get the area in brackets (research/37 §1.3). */
const CLASHING = /^(?:(US|Canada)\/(Central|Eastern|Mountain|Pacific)|(Brazil|Australia)\/(West))$/;

/** "Addis Ababa", "Knox", "Kentucky/Louisville", "St. Johns", "Mountain (US)" (research/37 §1.3). */
export const zoneCity = (zone: string): string => {
  const clash = CLASHING.exec(zone);

  if (clash !== null) {
    return `${clash[2] ?? clash[4]} (${clash[1] ?? clash[3]})`;
  }

  const last = zone.startsWith('America/Kentucky/') ? zone.slice(8) : zone.slice(zone.lastIndexOf('/') + 1);

  return ZONE_LABELS[zone] ?? (KEEPS_UNDERSCORE.includes(zone) ? last : last.replace(/^St_/, 'St. ').replace(/_/g, ' '));
};

const supported = { zones: null as string[] | null };

/** Notion's list, less any name this engine's time zone data does not know yet. */
export const timeZones = (): string[] => {
  supported.zones ??= TIME_ZONE_NAMES.filter((zone) => {
    try {
      offsetFormat(zone);

      return true;
    } catch {
      return false;
    }
  });

  return [...supported.zones];
};

/** One pick in the date picker's format rows. `timeZone: null` is "Your time zone". */
export type DateDisplayChange = { dateFormat: DateFormat } | { timeFormat: TimeFormat } | { timeZone: string | null };

/** The property's date settings after a picker pick. "Your time zone" drops the key, as the property menu does. */
export const applyDateDisplayChange = (date: DateDisplay, change: DateDisplayChange): DateDisplay => {
  if (!('timeZone' in change)) {
    return { ...date, ...change };
  }
  const { timeZone: _old, ...rest } = date;

  return change.timeZone === null ? rest : { ...rest, timeZone: change.timeZone };
};

const formatPart = (part: string, locale: string, display: DateDisplay, now: Date, hourCycle: 'h12' | 'h23' | undefined, options: DayOptions): string => {
  const day = formatDay(part, locale, display, now, options);

  if (!part.includes('T') || display.timeFormat === 'hidden') {
    return day;
  }

  const cycle = (display.timeFormat !== undefined ? HOUR_CYCLES[display.timeFormat] : undefined) ?? hourCycle;

  return `${day} ${formatClock(toLocalDate(part), locale, cycle, zoneOption(part, display.timeZone))}`;
};

/** "4:54 AM", or "6:00" in 24 hour time. */
export const formatClock = (date: Date, locale: string, cycle: 'h12' | 'h23' | undefined, zone: Intl.DateTimeFormatOptions = {}): string => {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(cycle !== undefined ? { hourCycle: cycle } : {}),
    ...zone,
  });

  // research/23 §1: Notion writes 24 hour time as "6:00"; en-US pads the hour to "06".
  // Only 24 hour goes through parts: their AM/PM gap is U+202F, where format() gives a plain space.
  return cycle === 'h23'
    ? formatter.formatToParts(date).map((p) => (p.type === 'hour' ? p.value.replace(/^0(?=\d)/, '') : p.value)).join('')
    : formatter.format(date);
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
  hourCycle?: 'h12' | 'h23',
  /** Relative format: the "Last Monday" / "Next Monday" words. Without it those weeks show the full date. */
  i18n?: Pick<I18n, 't'>
): string | null => {
  const parsed = parseDateValue(value);

  if (parsed === null) {
    return null;
  }

  const start = formatPart(parsed.start, locale, display, now, hourCycle, { i18n });

  return parsed.end === undefined ? start : `${start} → ${formatPart(parsed.end, locale, display, now, hourCycle, { i18n })}`;
};

/** A feed or row-menu time: Relative, but "3 days ago" / "In 3 days" within a week. */
export const formatRelativeStamp = (at: number, locale: string, display: Omit<DateDisplay, 'dateFormat'> = {}, now: Date = new Date(), hourCycle?: 'h12' | 'h23'): string =>
  formatPart(new Date(at).toISOString(), locale, { ...display, dateFormat: 'relative' }, now, hourCycle, { stamp: true });
