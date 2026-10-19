import { addToDate } from './formula/dates';
import type { DateUnit } from './formula/dates';
import type { TemplateRepeat } from './types';

/** A row block's data is a page template, not a row. */
export const isTemplateData = (data: { template?: unknown } | undefined | null): boolean => data?.template === true;

const DAY_MS = 86_400_000;

const UNITS: Record<TemplateRepeat['frequency'], DateUnit> = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' };

/** The stored zone, or UTC when it is absent or unknown, so every client counts the same runs. */
export const repeatZone = (repeat: Pick<TemplateRepeat, 'timeZone'>): string => {
  if (repeat.timeZone === undefined) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: repeat.timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

/**
 * The k-th run of a schedule, counted from the start (never from the last run),
 * so the 31st comes back after a short month. Runs keep the wall clock of the zone.
 */
const occurrence = (start: Date, repeat: TemplateRepeat, k: number): Date =>
  new Date(addToDate(start.getTime(), (repeat.interval ?? 1) * k, UNITS[repeat.frequency], repeatZone(repeat)));

/** How many runs fit between the start and `now`, give or take a few. */
const roughIndex = (start: Date, now: Date, repeat: TemplateRepeat): number => {
  const interval = repeat.interval ?? 1;
  const days = (now.getTime() - start.getTime()) / DAY_MS;
  // Mean lengths keep the estimate within a run or two of the truth over any span.
  const perRun: Record<TemplateRepeat['frequency'], number> = { daily: 1, weekly: 7, monthly: 30.436875, yearly: 365.2425 };

  return Math.max(0, Math.floor(days / (perRun[repeat.frequency] * interval)));
};

/**
 * The repeat comes from the document, so any client may have written it. An unknown
 * frequency adds nothing per run and a bad interval gives NaN times: both have no runs.
 * An invalid start gives NaN for its year, so it fails the range check too.
 */
const validRepeat = (repeat: TemplateRepeat | undefined): repeat is TemplateRepeat =>
  repeat !== undefined
  && Object.hasOwn(UNITS, repeat.frequency)
  && (repeat.interval === undefined || (Number.isInteger(repeat.interval) && repeat.interval >= 1))
  && inDateRange(new Date(repeat.start).getUTCFullYear());

// Date math throws near the edge of the JS date range and reads years 0-99 as 19xx, so those starts have no runs.
const inDateRange = (year: number): boolean => year >= 100 && year <= 9999;

/**
 * The index of the last run at or before `now`. Only a few runs around the
 * estimate are tried: the start comes from the document and may be any date.
 */
const lastIndex = (start: Date, now: Date, repeat: TemplateRepeat): number => {
  const rough = roughIndex(start, now, repeat);
  const span = 4;
  const ks = Array.from({ length: span * 2 + 1 }, (_, i) => rough + span - i).filter((k) => k >= 0);

  return ks.find((k) => occurrence(start, repeat, k).getTime() <= now.getTime()) ?? 0;
};

/**
 * The latest run of a repeating template at or before `now` that has not
 * been made yet, as an ISO string, or null when nothing is due.
 */
export const dueRun = (repeat: TemplateRepeat | undefined, now: Date): string | null => {
  if (!validRepeat(repeat)) return null;
  const start = new Date(repeat.start);

  if (start.getTime() > now.getTime()) return null;
  const due = occurrence(start, repeat, lastIndex(start, now, repeat));
  const last = repeat.lastRunAt === undefined ? Number.NaN : new Date(repeat.lastRunAt).getTime();

  return !Number.isNaN(last) && last >= due.getTime() ? null : due.toISOString();
};

/** The first run of a repeating template after `now`, in ms, or null when it has none. */
export const nextRun = (repeat: TemplateRepeat | undefined, now: Date): number | null => {
  if (!validRepeat(repeat)) return null;
  const start = new Date(repeat.start);

  if (start.getTime() > now.getTime()) return start.getTime();
  const last = lastIndex(start, now, repeat);

  // The run after the last one is normally next; a few more steps cover zone shifts. Bounded, never a loop on bad data.
  return Array.from({ length: 8 }, (_, i) => occurrence(start, repeat, last + 1 + i).getTime())
    .find((at) => at > now.getTime()) ?? null;
};
