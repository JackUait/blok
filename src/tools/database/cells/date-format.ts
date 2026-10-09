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
