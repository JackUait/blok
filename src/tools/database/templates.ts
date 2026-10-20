import { addToDate, wallTime, zonedToEpoch } from './formula/dates';
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

/** A weekly schedule's days, deduped and sorted, or undefined when it steps whole weeks. Null: malformed. */
const weekdaySet = (repeat: TemplateRepeat): number[] | undefined | null => {
  const days: unknown = repeat.weekdays;

  if (repeat.frequency !== 'weekly' || days === undefined) return undefined;
  // Length first: a sparse list of any length costs nothing until it is walked.
  if (!Array.isArray(days) || days.length > 7) return null;
  if (!days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) return null;

  return days.length === 0 ? undefined : [...new Set(days as number[])].sort((a, b) => a - b);
};

/** The end in ms, Infinity when there is none, null when it is malformed. */
const endOf = (repeat: TemplateRepeat): number | null => {
  const end: unknown = repeat.end;

  if (end === undefined) return Number.POSITIVE_INFINITY;
  if (typeof end !== 'string') return null;
  const at = new Date(end);

  return inDateRange(at.getUTCFullYear()) ? at.getTime() : null;
};

/**
 * The repeat comes from the document, so any client may have written it. An unknown
 * frequency adds nothing per run and a bad interval gives NaN times: both have no runs.
 * An invalid start gives NaN for its year, so it fails the range check too. So do bad weekdays or end.
 */
const validRepeat = (repeat: TemplateRepeat | undefined): repeat is TemplateRepeat =>
  repeat !== undefined
  && Object.hasOwn(UNITS, repeat.frequency)
  && (repeat.interval === undefined || (Number.isInteger(repeat.interval) && repeat.interval >= 1))
  && inDateRange(new Date(repeat.start).getUTCFullYear())
  && weekdaySet(repeat) !== null
  && endOf(repeat) !== null;

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

/** Runs on set weekdays: day numbers count whole days on the zone's wall calendar. */
interface WeekdayPlan {
  start: number;
  zone: string;
  days: number[];
  /** Wall day number of the Monday of the start's week. */
  monday: number;
  step: number;
  time: { hour: number; minute: number; second: number; ms: number };
}

const wallDay = (ms: number, zone: string): number => {
  const w = wallTime(ms, zone);

  return Date.UTC(w.year, w.month - 1, w.day) / DAY_MS;
};

const weekdayPlan = (start: Date, repeat: TemplateRepeat, days: number[]): WeekdayPlan => {
  const zone = repeatZone(repeat);
  const w = wallTime(start.getTime(), zone);
  const day = wallDay(start.getTime(), zone);
  // getUTCDay is 0 for Sunday; Monday-first weeks need Sunday as 6.
  const sinceMonday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;

  return {
    start: start.getTime(), zone, days, monday: day - sinceMonday, step: 7 * (repeat.interval ?? 1),
    time: { hour: w.hour, minute: w.minute, second: w.second, ms: w.ms },
  };
};

/** The runs of the week `k` steps after the start's week, in order. Runs before the start are left out. */
const weekRuns = (plan: WeekdayPlan, k: number): number[] => plan.days
  .map((weekday) => {
    const d = new Date((plan.monday + k * plan.step + weekday - 1) * DAY_MS);

    return zonedToEpoch({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), ...plan.time }, plan.zone);
  })
  .filter((at) => at >= plan.start);

/** The step index of the week holding `ms`, never below 0. */
const weekIndex = (plan: WeekdayPlan, ms: number): number =>
  Math.max(0, Math.floor((wallDay(ms, plan.zone) - plan.monday) / plan.step));

/** The last run at or before `now`, or null. Only the weeks next to `now` are tried. */
const lastWeekdayRun = (plan: WeekdayPlan, now: number): number | null => {
  const k = weekIndex(plan, now);
  const runs = [k - 1, k, k + 1].filter((i) => i >= 0).flatMap((i) => weekRuns(plan, i)).filter((at) => at <= now);

  return runs.length === 0 ? null : runs[runs.length - 1];
};

const nextWeekdayRun = (plan: WeekdayPlan, now: number): number | null => {
  const k = weekIndex(plan, Math.max(now, plan.start));

  return [k, k + 1, k + 2].flatMap((i) => weekRuns(plan, i)).find((at) => at > now) ?? null;
};

/** The last run at or before `now`, or null before the first run. */
const lastRunBy = (repeat: TemplateRepeat, now: Date): number | null => {
  const start = new Date(repeat.start);
  const days = weekdaySet(repeat);

  if (days !== undefined && days !== null) return lastWeekdayRun(weekdayPlan(start, repeat, days), now.getTime());
  if (start.getTime() > now.getTime()) return null;

  return occurrence(start, repeat, lastIndex(start, now, repeat)).getTime();
};

/**
 * The latest run of a repeating template at or before `now` that has not
 * been made yet, as an ISO string, or null when nothing is due. Runs after the end do not count.
 */
export const dueRun = (repeat: TemplateRepeat | undefined, now: Date): string | null => {
  if (!validRepeat(repeat)) return null;
  const due = lastRunBy(repeat, new Date(Math.min(now.getTime(), endOf(repeat) ?? Number.NaN)));
  const last = repeat.lastRunAt === undefined ? Number.NaN : new Date(repeat.lastRunAt).getTime();

  if (due === null) return null;

  return !Number.isNaN(last) && last >= due ? null : new Date(due).toISOString();
};

/** The first run of a repeating template after `now`, in ms, or null when it has none. */
export const nextRun = (repeat: TemplateRepeat | undefined, now: Date): number | null => {
  if (!validRepeat(repeat)) return null;
  const start = new Date(repeat.start);
  const days = weekdaySet(repeat);
  const end = endOf(repeat) ?? Number.NaN;
  const upcoming = ((): number | null => {
    if (days !== undefined && days !== null) return nextWeekdayRun(weekdayPlan(start, repeat, days), now.getTime());
    if (start.getTime() > now.getTime()) return start.getTime();
    const last = lastIndex(start, now, repeat);

    // The run after the last one is normally next; a few more steps cover zone shifts. Bounded, never a loop on bad data.
    return Array.from({ length: 8 }, (_, i) => occurrence(start, repeat, last + 1 + i).getTime())
      .find((at) => at > now.getTime()) ?? null;
  })();

  return upcoming !== null && upcoming <= end ? upcoming : null;
};
