// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputedProperties } from '../../../../src/shared/database/computed-properties';
import { createComputedReader } from '../../../../src/shared/database/computed-read';

import type { ComputedReadBlock } from '../../../../src/shared/database/computed-read';

import type { PropertyDefinition } from '../../../../src/shared/database/types';

const formula = (id: string, expression: string, position: string): PropertyDefinition =>
  ({ id, name: id, type: 'formula', position, formula: { expression } });

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
  formula('broken', 'prop("Missing")', 'a2'),
  formula('readsBroken', 'prop("broken")', 'a3'),
  formula('check', 'test(prop("Notes"), "(a+" + ")+$")', 'a4'),
  formula('fine', 'length(prop("Notes"))', 'a5'),
  formula('blank', '', 'a6'),
  formula('spaces', '   ', 'a7'),
];

const rows = [{ id: 'r1', position: 'a0', properties: { t: 'One', notes: 'aaa' } }];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('why a formula cell has no value', () => {
  const applied = (): ComputedProperties => {
    const engine = new ComputedProperties('db');

    engine.apply(schema, rows, { databaseId: 'db', now: new Date(0) });

    return engine;
  };
  const byId = (id: string): PropertyDefinition => schema.find((p) => p.id === id) ?? schema[0];

  it('a formula that does not compile reports its compile error', () => {
    expect(applied().problem('r1', byId('broken'))).toEqual({ kind: 'error', code: 'unknownProperty', params: { name: 'Missing' } });
  });

  it('a formula past a limit reports the limit', () => {
    expect(applied().problem('r1', byId('check'))).toEqual({ kind: 'limit' });
  });

  it('a formula that reads a broken one reports a problem too', () => {
    expect(applied().problem('r1', byId('readsBroken'))).toBeDefined();
  });

  it('a working formula, a blank one and a property that is no formula report none', () => {
    const engine = applied();

    expect(['fine', 'blank', 'spaces', 'notes'].map((id) => engine.problem('r1', byId(id)))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('an agent read says the cell shows a warning mark, not nothing', () => {
    const blocks = new Map<string, ComputedReadBlock>([
      ['db', { type: 'database', content: ['r1'], data: { schema } }],
      ['r1', { type: 'database-row', content: [], data: { position: 'a0', properties: rows[0].properties } }],
    ]);
    const values = createComputedReader(id => blocks.get(id))('r1', 'db');

    ['broken', 'check'].forEach((id) => {
      expect(values?.[id], id).toEqual({ unavailable: expect.stringContaining('The cell shows a warning mark') });
    });
  });
});
