/**
 * Relative dates for date filters. Names follow the Notion API
 * (developers.notion.com/reference/filter-data-source-entries): operators
 * without a value, and relative values for the compare operators. Everything
 * resolves against `now` at query time, in local time.
 */

/** Operators that need no value: the window is the condition. */
export const RELATIVE_DATE_OPERATORS = [
  'past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year', 'this_week', 'relative_to_today',
] as const;

/** Values `equals`, `before`, `after`, `on_or_before` and `on_or_after` accept besides a date. */
export const RELATIVE_DATE_VALUES = [
  'today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now',
] as const;

export type RelativeDateUnit = 'day' | 'week' | 'month' | 'year';

export const RELATIVE_DATE_UNITS: readonly RelativeDateUnit[] = ['day', 'week', 'month', 'year'];

/** The value of `relative_to_today`: `past:3:day` or `next:2:week`. */
export interface RelativeSpan {
  direction: 'past' | 'next';
  count: number;
  unit: RelativeDateUnit;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export const toLocalDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const shift = (now: Date, unit: RelativeDateUnit, amount: number): Date => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (unit) {
    case 'day': date.setDate(date.getDate() + amount); break;
    case 'week': date.setDate(date.getDate() + amount * 7); break;
    case 'month': date.setMonth(date.getMonth() + amount); break;
    case 'year': date.setFullYear(date.getFullYear() + amount); break;
  }

  return date;
};

const VALUE_SHIFT: Record<typeof RELATIVE_DATE_VALUES[number], [RelativeDateUnit, number]> = {
  today: ['day', 0],
  tomorrow: ['day', 1],
  yesterday: ['day', -1],
  one_week_ago: ['week', -1],
  one_week_from_now: ['week', 1],
  one_month_ago: ['month', -1],
  one_month_from_now: ['month', 1],
};

const isRelativeValue = (value: unknown): value is typeof RELATIVE_DATE_VALUES[number] =>
  typeof value === 'string' && (RELATIVE_DATE_VALUES as readonly string[]).includes(value);

/** The day a filter value names, or `undefined` when it names none. */
export const resolveDay = (value: unknown, now: Date): string | undefined => {
  if (isRelativeValue(value)) {
    const [unit, amount] = VALUE_SHIFT[value];

    return toLocalDay(shift(now, unit, amount));
  }

  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
};

export const parseRelativeSpan = (value: unknown): RelativeSpan | undefined => {
  if (typeof value !== 'string') return undefined;
  const [direction, count, unit] = value.split(':');
  const n = Number(count);

  if ((direction !== 'past' && direction !== 'next') || !Number.isInteger(n) || n < 1) return undefined;
  if (!(RELATIVE_DATE_UNITS as readonly string[]).includes(unit)) return undefined;

  return { direction, count: n, unit: unit as RelativeDateUnit };
};

export const formatRelativeSpan = (span: RelativeSpan): string => `${span.direction}:${span.count}:${span.unit}`;

/**
 * The inclusive day window a relative operator covers, or `undefined` for
 * any other operator. A week starts on Sunday, Notion's default.
 */
export const relativeWindow = (operator: string, value: unknown, now: Date): { from: string; to: string } | undefined => {
  const today = toLocalDay(now);
  const past = (unit: RelativeDateUnit, count: number): { from: string; to: string } =>
    ({ from: toLocalDay(shift(now, unit, -count)), to: today });
  const next = (unit: RelativeDateUnit, count: number): { from: string; to: string } =>
    ({ from: today, to: toLocalDay(shift(now, unit, count)) });

  switch (operator) {
    case 'past_week': return past('week', 1);
    case 'past_month': return past('month', 1);
    case 'past_year': return past('year', 1);
    case 'next_week': return next('week', 1);
    case 'next_month': return next('month', 1);
    case 'next_year': return next('year', 1);
    case 'this_week': {
      const start = shift(now, 'day', -now.getDay());

      return { from: toLocalDay(start), to: toLocalDay(shift(start, 'day', 6)) };
    }
    case 'relative_to_today': {
      const span = parseRelativeSpan(value);

      if (span === undefined) return undefined;

      return span.direction === 'past' ? past(span.unit, span.count) : next(span.unit, span.count);
    }
    default: return undefined;
  }
};
