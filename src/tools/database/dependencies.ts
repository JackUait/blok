import { addDays, daysBetween, isWeekend } from './calendar-dates';
import { moveBar, timelineSpan } from './timeline-dates';
import type { BarValues, BarWrite } from './timeline-dates';
import { relationIdsOf } from './relation-values';
import type { DatabaseRow, DependencySettings } from './types';
import type { EventSpan } from './calendar-dates';

/**
 * Dependencies are a self-relation pair, "Blocked by" / "Blocking"
 * (research/05 §11.2). Each blocking link is a timeline arrow, and a date
 * change can move the items it blocks.
 */

/** One arrow per link: from the blocking row to the row it blocks. Rows that no longer exist draw none. */
export const dependencyArrows = (rows: DatabaseRow[], blockedById: string): Array<{ from: string; to: string }> => {
  const ids = new Set(rows.map((row) => row.id));

  return rows.flatMap((row) => relationIdsOf(row.properties[blockedById])
    .filter((id) => id !== row.id && ids.has(id))
    .map((id) => ({ from: id, to: row.id })));
};

export interface ShiftInput {
  rows: DatabaseRow[];
  blockedBy: string;
  startId: string;
  /** A separate end property, or undefined when the start property holds the range. */
  endId: string | undefined;
  changedRowId: string;
  /** The changed row's new date values. */
  newValues: BarWrite;
  settings: DependencySettings;
}

/** Days to add so neither end of a moved item lands on a Saturday or Sunday. */
const offWeekend = (start: string, end: string, delta: number): number =>
  isWeekend(addDays(start, delta)) || isWeekend(addDays(end, delta)) ? offWeekend(start, end, delta + 1) : delta;

interface Moved {
  id: string;
  before: EventSpan;
  after: EventSpan;
}

/**
 * The date writes a change to one row causes downstream, per Notion's
 * shifting rule. "Overlap" pushes a blocked item just past its blocker's
 * new end when they overlap. "Maintain" moves every blocked item by as
 * many days as its blocker's end moved, so the gaps stay. Each row moves
 * once, so a loop two peers made ends.
 */
export const shiftDependents = (input: ShiftInput): Array<{ rowId: string; write: BarWrite }> => {
  const mode = input.settings.shift ?? 'none';
  const { rows, startId, endId } = input;
  const valuesOf = (row: DatabaseRow): BarValues => ({
    start: row.properties[startId],
    end: endId === undefined ? undefined : row.properties[endId] ?? null,
  });
  const spanAfter = (values: BarValues, write: BarWrite): EventSpan | null =>
    timelineSpan(write.start ?? values.start, values.end === undefined ? undefined : write.end ?? values.end);
  const changed = rows.find((row) => row.id === input.changedRowId);
  const before = changed === undefined ? null : timelineSpan(valuesOf(changed).start, valuesOf(changed).end);
  const after = changed === undefined ? null : spanAfter(valuesOf(changed), input.newValues);

  if (mode === 'none' || before === null || after === null) return [];
  const moved = new Map<string, Moved>([[input.changedRowId, { id: input.changedRowId, before, after }]]);
  const out: Array<{ rowId: string; write: BarWrite }> = [];
  const wantedDelta = (span: EventSpan, blocker: Moved): number => {
    if (mode === 'maintain') return daysBetween(blocker.before.end, blocker.after.end);

    return span.start <= blocker.after.end ? daysBetween(span.start, addDays(blocker.after.end, 1)) : 0;
  };
  const seen = new Set([input.changedRowId]);
  const order: DatabaseRow[] = [];
  // Stable traversal cuts cycle back edges the same way in every row order.
  const sortedRows = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const visit = (blockerId: string): void => {
    for (const row of sortedRows) {
      if (seen.has(row.id) || !relationIdsOf(row.properties[input.blockedBy]).includes(blockerId)) continue;
      seen.add(row.id);
      visit(row.id);
      order.push(row);
    }
  };

  visit(input.changedRowId);
  // Both arms of a diamond must settle before their shared row moves.
  for (const row of order.reverse()) {
    const values = valuesOf(row);
    const span = timelineSpan(values.start, values.end);
    const blockers = relationIdsOf(row.properties[input.blockedBy])
      .map((id) => moved.get(id))
      .filter((blocker): blocker is Moved => blocker !== undefined);

    if (span === null || blockers.length === 0) continue;
    const wanted = Math.max(...blockers.map((blocker) => wantedDelta(span, blocker)));
    const delta = wanted !== 0 && input.settings.avoidWeekends === true ? offWeekend(span.start, span.end, wanted) : wanted;

    if (delta === 0) {
      // A weekend-pinned blocker still constrains earlier shifts.
      if (mode === 'maintain') moved.set(row.id, { id: row.id, before: span, after: span });
      continue;
    }
    const write = moveBar(values, delta);
    const next = spanAfter(values, write);

    out.push({ rowId: row.id, write });
    if (next !== null) moved.set(row.id, { id: row.id, before: span, after: next });
  }

  return out;
};
