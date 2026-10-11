import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dependencyArrows, shiftDependents } from '../../../../src/tools/database/dependencies';
import type { DatabaseRow } from '../../../../src/tools/database/types';

const row = (id: string, date: string, blockedBy: string[] = []): DatabaseRow =>
  ({ id, position: id, properties: { date, blockedBy: blockedBy.map((b) => ({ id: b })) } });

// a blocks b, b blocks c
const rows = (): DatabaseRow[] => [
  row('a', '2026-10-05/2026-10-07'),
  row('b', '2026-10-08/2026-10-09', ['a']),
  row('c', '2026-10-13/2026-10-14', ['b']),
];

const shift = (mode: 'overlap' | 'maintain' | 'none', after: string, avoidWeekends = false, list = rows()): Record<string, string | undefined> =>
  Object.fromEntries(shiftDependents({
    rows: list,
    blockedBy: 'blockedBy',
    startId: 'date',
    endId: undefined,
    changedRowId: 'a',
    newValues: { start: after },
    settings: { shift: mode, avoidWeekends },
  }).map((w) => [w.rowId, w.write.start]));

describe('dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws one arrow per blocking link that names an existing row', () => {
    expect(dependencyArrows([...rows(), row('d', '2026-10-01', ['gone'])], 'blockedBy')).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
  });

  it('does not shift when shifting is off', () => {
    expect(shift('none', '2026-10-05/2026-10-12')).toEqual({});
  });

  it('pushes only the items the change overlaps, through the chain', () => {
    // a now ends on the 12th: b (8–9) must start the 13th; c (13–14) then overlaps b (13–14).
    expect(shift('overlap', '2026-10-05/2026-10-12')).toEqual({ b: '2026-10-13/2026-10-14', c: '2026-10-15/2026-10-16' });
  });

  it('leaves items alone when the change does not reach them', () => {
    expect(shift('overlap', '2026-10-05/2026-10-06')).toEqual({});
  });

  it('keeps the gaps: every item downstream moves by the same days', () => {
    expect(shift('maintain', '2026-10-05/2026-10-09')).toEqual({ b: '2026-10-10/2026-10-11', c: '2026-10-15/2026-10-16' });
    expect(shift('maintain', '2026-10-05/2026-10-06')).toEqual({ b: '2026-10-07/2026-10-08', c: '2026-10-12/2026-10-13' });
  });

  it('moves a shifted item off a weekend', () => {
    // b would land on Sat 10th–Sun 11th: it moves to Mon 12th–Tue 13th.
    expect(shift('maintain', '2026-10-05/2026-10-09', true)).toMatchObject({ b: '2026-10-12/2026-10-13' });
  });

  it.each([false, true])('keeps a diamond dependent after both blockers regardless of row order %s', (reverse) => {
    const branches = [
      row('b', '2026-10-08/2026-10-09', ['a']),
      row('c', '2026-10-08/2026-10-12', ['a']),
    ];
    const diamond = [
      row('a', '2026-10-05/2026-10-07'),
      ...(reverse ? branches.reverse() : branches),
      row('d', '2026-10-13/2026-10-14', ['b', 'c']),
    ];

    expect(shift('overlap', '2026-10-05/2026-10-12', false, diamond).d)
      .toBe('2026-10-18/2026-10-19');
  });

  it.each([false, true])('waits for blockers reached through different path lengths %s', (reverse) => {
    const diamond = [
      row('a', '2026-10-05/2026-10-07'),
      row('b', '2026-10-08/2026-10-09', ['a']),
      row('c', '2026-10-08/2026-10-12', ['a']),
      row('e', '2026-10-13/2026-10-14', ['c']),
      row('d', '2026-10-13/2026-10-14', ['b', 'e']),
    ];

    expect(shift('overlap', '2026-10-05/2026-10-12', false, reverse ? diamond.reverse() : diamond).d)
      .toBe('2026-10-20/2026-10-21');
  });

  it.each([false, true])('maintains the later weekend-adjusted blocker at a diamond %s', (reverse) => {
    const branches = [
      row('b', '2026-10-08/2026-10-09', ['a']),
      row('c', '2026-10-10/2026-10-11', ['a']),
    ];
    const diamond = [
      row('a', '2026-10-05/2026-10-07'),
      ...(reverse ? branches.reverse() : branches),
      row('d', '2026-10-20/2026-10-21', ['b', 'c']),
    ];

    expect(shift('maintain', '2026-10-05/2026-10-09', true, diamond).d)
      .toBe('2026-10-26/2026-10-27');
  });

  it.each([false, true])('moves each item once in a downstream loop regardless of row order %s', (reverse) => {
    const looped = [
      row('a', '2026-10-05/2026-10-07'),
      row('b', '2026-10-08/2026-10-09', ['a', 'c']),
      row('c', '2026-10-13/2026-10-14', ['b']),
    ];

    expect(shift('maintain', '2026-10-05/2026-10-09', false, reverse ? looped.reverse() : looped))
      .toEqual({ b: '2026-10-10/2026-10-11', c: '2026-10-15/2026-10-16' });
  });

  it.each([false, true])('does not pull a dependent before a weekend-pinned blocker %s', (reverse) => {
    const diamond = [
      row('a', '2026-10-05/2026-10-07'),
      row('b', '2026-10-12/2026-10-13', ['a']),
      row('c', '2026-10-08/2026-10-09', ['a']),
      row('d', '2026-10-14/2026-10-15', ['b', 'c']),
    ];
    const writes = shift('maintain', '2026-10-05/2026-10-06', true, reverse ? diamond.reverse() : diamond);

    expect(writes.d).toBeUndefined();
    expect(writes.c).toBe('2026-10-07/2026-10-08');
    expect(writes.b).toBeUndefined();
  });

  it.each([false, true])('keeps a zero-shift chain in downstream blocker constraints %s', (reverse) => {
    const diamond = [
      row('a', '2026-10-05/2026-10-07'),
      row('b', '2026-10-12/2026-10-13', ['a']),
      row('c', '2026-10-08/2026-10-09', ['a']),
      row('e', '2026-10-14/2026-10-15', ['b']),
      row('d', '2026-10-16/2026-10-17', ['e', 'c']),
    ];
    const writes = shift('maintain', '2026-10-05/2026-10-06', true, reverse ? diamond.reverse() : diamond);

    expect(writes.d).toBeUndefined();
    expect(writes.c).toBe('2026-10-07/2026-10-08');
    expect(writes.e).toBeUndefined();
  });

  it('stops at a loop two peers made', () => {
    const looped = [row('a', '2026-10-05/2026-10-07', ['b']), row('b', '2026-10-08/2026-10-09', ['a'])];

    expect(shift('maintain', '2026-10-06/2026-10-08', false, looped)).toEqual({ b: '2026-10-09/2026-10-10' });
  });
});
