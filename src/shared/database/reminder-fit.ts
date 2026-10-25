import { parseDateValue } from './date-value';
import { resolveDynamicValue } from './dynamic-values';

import type { DateReminder, DateReminderOffset } from './types';

/** Notion's lists, in order (research/17 §1b). None is the absence of a reminder. */
const DATE_ONLY: readonly DateReminderOffset[] = ['on_day_of_event', '1_day_before', '2_days_before', '1_week_before'];
const TIMED: readonly DateReminderOffset[] = [
  'at_time_of_event', '5_minutes_before', '10_minutes_before', '15_minutes_before', '30_minutes_before',
  '1_hour_before', '2_hours_before', '1_day_before', '2_days_before',
];

export const remindersFor = (hasTime: boolean): readonly DateReminderOffset[] => hasTime ? TIMED : DATE_ONLY;

export const reminderFits = (remind: DateReminderOffset, hasTime: boolean): boolean => remindersFor(hasTime).includes(remind);

/**
 * A copy's reminders (a row made from a template): only where the copy holds a
 * date that can take one, and without `sentFor`. Like the editor's
 * copiedReminders, without its time zone math: Jint has no Intl zones.
 */
export const copiedReminders = (
  reminders: Record<string, DateReminder> | undefined,
  properties: Record<string, unknown>,
  now: Date
): Record<string, DateReminder> | undefined => {
  const kept = Object.entries(reminders ?? {}).filter(([propertyId, reminder]) => {
    const parsed = parseDateValue(resolveDynamicValue(properties[propertyId] ?? null, { me: null, now }));

    return parsed !== null && reminderFits(reminder.remind, parsed.hasTime);
  }).map(([propertyId, { sentFor: _sent, ...reminder }]): [string, DateReminder] => [propertyId, reminder]);

  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};
