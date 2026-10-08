/**
 * How a date property value is stored: one string, always.
 *
 * - A day: `YYYY-MM-DD`.
 * - A day with a time: `YYYY-MM-DDTHH:mm` (local wall time, no zone).
 * - A range: `start/end`, each part one of the above (ISO 8601 interval).
 *
 * A range stays a string and not a `{start, end}` object: the CRDT merges an
 * object key by key, so two people moving the start and the end at once would
 * end with a range neither picked. Older values may hold a full ISO timestamp
 * (`2026-10-09T15:00:00.000Z`); they read as a day with a time.
 */
export const DATE_VALUE_FORMAT = 'YYYY-MM-DD[THH:mm][/YYYY-MM-DD[THH:mm]]';

/** A parsed date value. `start` and `end` keep their stored ISO text. */
export interface ParsedDateValue {
  start: string;
  end?: string;
  hasTime: boolean;
}

const ISO_PART = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+\-Z]+)?$/;

/** Reads a stored date value, or gives null when it is not one. */
export const parseDateValue = (value: unknown): ParsedDateValue | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value.split('/');

  if (parts.length > 2 || !parts.every((part) => ISO_PART.test(part))) {
    return null;
  }

  const [start, end] = parts;

  return {
    start,
    ...(end !== undefined ? { end } : {}),
    hasTime: start.includes('T'),
  };
};

/** Writes a date value back to its stored string. */
export const formatDateValue = (value: { start: string; end?: string }): string =>
  value.end === undefined ? value.start : `${value.start}/${value.end}`;
