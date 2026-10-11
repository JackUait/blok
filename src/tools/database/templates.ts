import type { TemplateRepeat } from './types';

/** A row block's data is a page template, not a row. */
export const isTemplateData = (data: { template?: unknown } | undefined | null): boolean => data?.template === true;

const DAY_MS = 86_400_000;

/** The k-th run of a schedule, from its start. Months and years keep the day of the month where they can. */
const occurrence = (start: Date, repeat: TemplateRepeat, k: number): Date => {
  const step = Math.max(1, Math.floor(repeat.interval ?? 1)) * k;
  const at = new Date(start.getTime());

  switch (repeat.frequency) {
    case 'daily':
      return new Date(start.getTime() + step * DAY_MS);
    case 'weekly':
      return new Date(start.getTime() + step * 7 * DAY_MS);
    case 'monthly':
      at.setUTCMonth(at.getUTCMonth() + step);

      return at;
    case 'yearly':
      at.setUTCFullYear(at.getUTCFullYear() + step);

      return at;
  }
};

/** How many runs fit between the start and `now`, give or take one. */
const roughIndex = (start: Date, now: Date, repeat: TemplateRepeat): number => {
  const interval = Math.max(1, Math.floor(repeat.interval ?? 1));
  const days = (now.getTime() - start.getTime()) / DAY_MS;
  const perRun: Record<TemplateRepeat['frequency'], number> = { daily: 1, weekly: 7, monthly: 28, yearly: 365 };

  return Math.max(0, Math.floor(days / (perRun[repeat.frequency] * interval)) + 1);
};

/**
 * The latest run of a repeating template at or before `now` that has not
 * been made yet, as an ISO string, or null when nothing is due.
 */
export const dueRun = (repeat: TemplateRepeat | undefined, now: Date): string | null => {
  if (repeat === undefined) return null;
  const start = new Date(repeat.start);

  if (Number.isNaN(start.getTime()) || start.getTime() > now.getTime()) return null;
  const index = Array.from({ length: roughIndex(start, now, repeat) + 1 }, (_, k) => k)
    .reverse()
    .find((k) => occurrence(start, repeat, k).getTime() <= now.getTime()) ?? 0;
  const due = occurrence(start, repeat, index);
  const last = repeat.lastRunAt === undefined ? Number.NaN : new Date(repeat.lastRunAt).getTime();

  return !Number.isNaN(last) && last >= due.getTime() ? null : due.toISOString();
};
