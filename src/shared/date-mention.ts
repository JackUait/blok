import { parseDateValue } from './database/date-value';
import { formatDateDisplay } from '../tools/database/cells/date-format';
import type { DateDisplay, DateFormat, TimeFormat } from './database/types';

/** Fixed date value and per-mention display settings, shared with the database date editor. */
export const DATE_MENTION_ATTR = 'data-blok-date-mention';
export const DATE_MENTION_VALUE_ATTR = 'data-blok-date-value';
export const DATE_MENTION_FORMAT_ATTR = 'data-blok-date-format';
export const DATE_MENTION_TIME_FORMAT_ATTR = 'data-blok-date-time-format';
export const DATE_MENTION_TIME_ZONE_ATTR = 'data-blok-date-time-zone';

const DATE_FORMATS: readonly DateFormat[] = ['full', 'short', 'month_day_year', 'day_month_year', 'year_month_day', 'relative'];
const TIME_FORMATS: readonly TimeFormat[] = ['hidden', '12_hour', '24_hour'];

export const readDateMention = (value: string | null): Date | null => {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);

  if (year < 1000) return null;
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date : null;
};

export const localDateIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const readDateMentionValue = (time: Element): string | null => {
  const value = time.getAttribute(DATE_MENTION_VALUE_ATTR) ?? time.getAttribute('datetime');
  const parsed = parseDateValue(value);

  if (parsed === null) return null;
  const parts = [parsed.start, parsed.end].filter((part): part is string => part !== undefined);

  return parts.every((part) => readDateMention(part.slice(0, 10)) !== null &&
    (part.length === 10 || /^T(?:[01]\d|2[0-3]):[0-5]\d$/.test(part.slice(10)))) ? value : null;
};

export const readDateMentionDisplay = (time: Element): DateDisplay => {
  const format = time.getAttribute(DATE_MENTION_FORMAT_ATTR);
  const timeFormat = time.getAttribute(DATE_MENTION_TIME_FORMAT_ATTR);
  const zone = time.getAttribute(DATE_MENTION_TIME_ZONE_ATTR);
  let timeZone: string | undefined;

  if (zone !== null) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      timeZone = zone;
    } catch { /* Invalid or pasted zones use the viewer's local zone. */ }
  }

  return {
    dateFormat: DATE_FORMATS.includes(format as DateFormat) ? format as DateFormat : 'relative',
    ...(TIME_FORMATS.includes(timeFormat as TimeFormat) ? { timeFormat: timeFormat as TimeFormat } : {}),
    ...(timeZone !== undefined ? { timeZone } : {}),
  };
};

export const dateMentionText = (time: Element, now: Date, locale?: string): string | null => {
  const value = readDateMentionValue(time);

  return value === null ? null : formatDateDisplay(value, locale ?? (typeof navigator === 'undefined' ? 'en-US' : navigator.language), readDateMentionDisplay(time), now);
};

export const dateMentionLabel = (iso: string, now: Date, locale?: string): string | null => {
  return readDateMention(iso) === null ? null
    : formatDateDisplay(iso, locale ?? (typeof navigator === 'undefined' ? 'en-US' : navigator.language), { dateFormat: 'relative' }, now);
};
