// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputedProperties } from '../../../../src/shared/database/computed-properties';
import { createComputedReader } from '../../../../src/shared/database/computed-read';

import type { ComputedReadBlock } from '../../../../src/shared/database/computed-read';
import type { PropertyDefinition } from '../../../../src/shared/database/types';

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'check', name: 'Check', type: 'formula', position: 'a2', formula: { expression: 'test(prop("Notes"), "(a+" + ")+$")' } },
  { id: 'big', name: 'Big', type: 'formula', position: 'a3', formula: { expression: 'repeat(prop("Notes"), 100000)' } },
  { id: 'usesBig', name: 'Uses big', type: 'formula', position: 'a4', formula: { expression: 'empty(prop("Big"))' } },
  { id: 'fine', name: 'Fine', type: 'formula', position: 'a5', formula: { expression: 'length(prop("Notes"))' } },
];

const rows = [{ id: 'r1', position: 'a0', properties: { t: 'One', notes: 'aaa' } }];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a formula past a limit', () => {
  it('stores no value, not a false checkbox or an empty text, and says which ones hit a limit', () => {
    const engine = new ComputedProperties('db');
    const [row] = engine.apply(schema, rows, { databaseId: 'db', now: new Date(0) });

    expect(row.computed).toMatchObject({ check: null, big: null, usesBig: null, fine: 3 });
    expect(['check', 'big', 'usesBig', 'fine'].map(id => engine.limited('r1', id))).toEqual([true, true, true, false]);
  });

  it('remembers the limit when the row is served from the memo', () => {
    const engine = new ComputedProperties('db');

    engine.apply(schema, rows, { databaseId: 'db', now: new Date(0) });
    engine.apply(schema, rows, { databaseId: 'db', now: new Date(0) });

    expect(engine.limited('r1', 'big')).toBe(true);
  });

  it('reads as unavailable with a reason on an agent read', () => {
    const blocks = new Map<string, ComputedReadBlock>([
      ['db', { type: 'database', content: ['r1'], data: { schema } }],
      ['r1', { type: 'database-row', content: [], data: { position: 'a0', properties: rows[0].properties } }],
    ]);
    const values = createComputedReader(id => blocks.get(id))('r1', 'db');

    expect(values?.fine).toBe(3);
    ['check', 'big', 'usesBig'].forEach((id) => {
      expect(values?.[id], id).toEqual({ unavailable: expect.stringContaining('limit') });
    });
  });
});

describe('the work of one pass over the database', () => {
  const formulaRows = (expression: string, count: number): { schema: PropertyDefinition[]; rows: typeof rows } => ({
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'f', name: 'F', type: 'formula', position: 'a1', formula: { expression } },
    ],
    rows: Array.from({ length: count }, (_, i) => ({ id: `r${i}`, position: `a${i}`, properties: { t: `Row ${i}` } })),
  });

  it('is capped for all rows together: rows past the cap read as a limit hit', () => {
    // Each row costs just under one evaluation's regex cap.
    const db = formulaRows('test(repeat("a", 106), "a*a*a*b")', 40);
    const engine = new ComputedProperties('db');
    const out = engine.apply(db.schema, db.rows, { databaseId: 'db', now: new Date(0) });

    expect(engine.limited('r39', 'f')).toBe(true);
    expect(out[39].computed?.f).toBeNull();
    expect(engine.limited('r0', 'f')).toBe(false);
    expect(out[0].computed?.f).toBe(false);
  });

  it('never caps a cheap formula on many rows', () => {
    const db = formulaRows('length(prop("Name")) + 1', 2000);
    const engine = new ComputedProperties('db');

    engine.apply(db.schema, db.rows, { databaseId: 'db', now: new Date(0) });

    expect(db.rows.filter((row) => engine.limited(row.id, 'f'))).toEqual([]);
  });
});
