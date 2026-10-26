import { parseDateValue } from './cells/date-value';
import { addToDate, parseIsoDate, wallTime, zonedToEpoch } from './formula/dates';
import { resolveDynamicValue } from './dynamic-values';
import { reminderFits, remindersFor } from '../../shared/database/reminder-fit';
import type { DatabaseRow, DateReminder, DateReminderOffset, PropertyValue } from './types';

export { reminderFits, remindersFor };

/** Days before the event; the reminder goes at 9:00 that day. */
const MORNING_DAYS: Partial<Record<DateReminderOffset, number>> = {
  on_day_of_event: 0, '1_day_before': 1, '2_days_before': 2, '1_week_before': 7,
};
const MINUTES_BEFORE: Partial<Record<DateReminderOffset, number>> = {
  at_time_of_event: 0, '5_minutes_before': 5, '10_minutes_before': 10, '15_minutes_before': 15,
  '30_minutes_before': 30, '1_hour_before': 60, '2_hours_before': 120,
};

export const REMINDER_HOUR = 9;


/** The reminder goes at 9:00 on a day, so its label carries "(9:00 AM)". */
export const remindsInTheMorning = (remind: DateReminderOffset): boolean => MORNING_DAYS[remind] !== undefined;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * A Remind choice's label. A list adds the 9:00 time to the day offsets
 * ("1 day before (9:00 AM)"); the chosen value shows without it.
 */
export const reminderLabel = (t: Translate, choice: DateReminderOffset | null, withTime: boolean, hourCycle: 'h12' | 'h23'): string => {
  if (choice === null) {
    return t('tools.database.dateRemind.none');
  }
  const label = t(`tools.database.dateRemind.${choice}`);

  if (!withTime || !remindsInTheMorning(choice)) {
    return label;
  }
  // Built by hand like the picker's times: ICU versions disagree on the space before AM.
  const time = hourCycle === 'h23' ? `${String(REMINDER_HOUR).padStart(2, '0')}:00` : `${REMINDER_HOUR}:00 AM`;

  return `${label} (${time})`;
};

/** The property's zone, or undefined (the viewer's) when absent or unknown, as the date is shown. */
const knownZone = (timeZone: string | undefined): string | undefined => {
  if (timeZone === undefined) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** When a reminder on a date value goes off, in ms, or null when the value cannot take it. A range uses its start. */
export const reminderDueAt = (value: PropertyValue | undefined, remind: DateReminderOffset, timeZone: string | undefined): number | null => {
  const parsed = parseDateValue(value);

  if (parsed === null || !reminderFits(remind, parsed.hasTime)) return null;
  const zone = knownZone(timeZone);
  const event = parseIsoDate(parsed.start, zone);

  if (event === null) return null;
  const minutes = MINUTES_BEFORE[remind];

  if (minutes !== undefined) return event.start - minutes * 60_000;
  const day = wallTime(addToDate(event.start, -(MORNING_DAYS[remind] ?? 0), 'days', zone), zone);

  return zonedToEpoch({ ...day, hour: REMINDER_HOUR, minute: 0, second: 0, ms: 0 }, zone);
};

/**
 * A row's own display context for one cell: with a reminder the date shows the
 * alarm in every view; an anonymous form answer's Created by reads "Anonymous".
 */
export const rowCellContext = (row: DatabaseRow | undefined, propertyId: string): { rowId?: string; reminder?: DateReminderOffset; anonymous?: boolean } => {
  const remind = row?.reminders?.[propertyId]?.remind;

  return {
    ...(row === undefined ? {} : { rowId: row.id }),
    ...(remind === undefined ? {} : { reminder: remind }),
    ...(row?.meta?.anonymous === true ? { anonymous: true } : {}),
  };
};

/** The viewer's IANA zone, read on each call: a reminder records it when set. */
export const viewerTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

/** When a stored reminder goes off: the property's zone, else the zone stored on the reminder, else the viewer's. */
export const storedReminderDueAt = (value: PropertyValue | undefined, reminder: DateReminder, timeZone: string | undefined): number | null =>
  reminderDueAt(value, reminder.remind, timeZone ?? reminder.timeZone);

/** The due time as an ISO string once it has come and the host has not handled it, else null. */
export const dueReminder = (
  value: PropertyValue | undefined,
  reminder: DateReminder,
  timeZone: string | undefined,
  now: Date
): string | null => {
  const due = storedReminderDueAt(value, reminder, timeZone);

  if (due === null || due > now.getTime()) return null;
  const sent = reminder.sentFor === undefined ? Number.NaN : Date.parse(reminder.sentFor);

  return sent === due ? null : new Date(due).toISOString();
};

/**
 * A copy's reminders (duplicate, template): only where the copy has a date that
 * can take one, and without `sentFor`, so the copy reminds on its own.
 */
export const copiedReminders = (
  reminders: Record<string, DateReminder> | undefined,
  properties: Record<string, PropertyValue>
): Record<string, DateReminder> | undefined => {
  const kept = Object.entries(reminders ?? {})
    // A template's @today / @now counts as the date it becomes.
    .filter(([propertyId, reminder]) => reminderDueAt(
      resolveDynamicValue(properties[propertyId] ?? null, { me: null, now: new Date() }), reminder.remind, undefined
    ) !== null)
    .map(([propertyId, { sentFor: _sent, ...reminder }]): [string, DateReminder] => [propertyId, reminder]);

  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};
