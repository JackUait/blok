import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import type { DatabaseSource } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

const NOW = new Date('2026-10-09T12:00:00Z');

const title: PropertyDefinition = { id: 'title', name: 'Name', type: 'title', position: 'a0' };
const amount: PropertyDefinition = { id: 'amount', name: 'Amount', type: 'number', position: 'a1' };
const done: PropertyDefinition = { id: 'done', name: 'Done', type: 'checkbox', position: 'a2' };
const formula = (id: string, expression: string, position = 'b0'): PropertyDefinition =>
  ({ id, name: id, type: 'formula', position, formula: { expression } });
const relation = (id: string, targetDatabaseId: string, extra: Partial<NonNullable<PropertyDefinition['relation']>> = {}): PropertyDefinition =>
  ({ id, name: id, type: 'relation', position: 'c0', relation: { targetDatabaseId, ...extra } });
const rollup = (id: string, relationPropertyId: string, targetPropertyId: string, fn: NonNullable<PropertyDefinition['rollup']>['function']): PropertyDefinition =>
  ({ id, name: id, type: 'rollup', position: 'd0', rollup: { relationPropertyId, targetPropertyId, function: fn } });

const row = (id: string, properties: Record<string, PropertyValue>): DatabaseRow => ({ id, position: id, properties });

const valueOf = (rows: DatabaseRow[], rowId: string, property: PropertyDefinition): PropertyValue | undefined => {
  const found = rows.find((r) => r.id === rowId);

  if (found === undefined) throw new Error(`no row ${rowId}`);

  return readPropertyValue(found, property);
};

describe('ComputedProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formula', () => {
    it('computes a value per row and never writes it into properties', () => {
      const double = formula('double', '{{property:amount}} * 2');
      const schema = [title, amount, double];
      const engine = new ComputedProperties('db');
      const rows = engine.apply(schema, [row('r1', { amount: 3 }), row('r2', {})], { databaseId: 'db', now: NOW });

      expect(valueOf(rows, 'r1', double)).toBe(6);
      expect(valueOf(rows, 'r2', double)).toBeNull();
      expect(rows[0].properties).toEqual({ amount: 3 });
    });

    it('keeps working after the referenced property is renamed', () => {
      const double = formula('double', '{{property:amount}} * 2');
      const engine = new ComputedProperties('db');
      const renamed = { ...amount, name: 'Price' };
      const rows = engine.apply([title, renamed, double], [row('r1', { amount: 4 })], { databaseId: 'db', now: NOW });

      expect(valueOf(rows, 'r1', double)).toBe(8);
    });

    it('shows each result type as the property type that holds it', () => {
      const schema = [
        title, amount, done,
        formula('n', '1 + 1'), formula('t', '"a" + "b"'), formula('b', 'true'), formula('d', 'parseDate("2026-01-02")'),
        formula('people', '[1, 2].map(format(current))'),
      ];
      const engine = new ComputedProperties('db');
      const rows = engine.apply(schema, [row('r1', {})], { databaseId: 'db', now: NOW, timeZone: 'UTC' });
      const typeOf = (id: string): string => engine.valueProperty(schema.find((p) => p.id === id) ?? title).type;

      expect([typeOf('n'), typeOf('t'), typeOf('b'), typeOf('d'), typeOf('people')]).toEqual(['number', 'text', 'checkbox', 'date', 'text']);
      expect(valueOf(rows, 'r1', schema[6])).toBe('2026-01-02');
      expect(valueOf(rows, 'r1', schema[7])).toBe('1, 2');
    });

    it('reads another formula of the same row', () => {
      const a = formula('a', '{{property:amount}} + 1');
      const b = formula('b', '{{property:a}} * 10', 'b1');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, amount, a, b], [row('r1', { amount: 1 })], { databaseId: 'db', now: NOW });

      expect(valueOf(rows, 'r1', b)).toBe(20);
    });

    it('refuses a formula that refers back to itself through another', () => {
      const a = formula('a', '{{property:b}} + 1');
      const b = formula('b', '{{property:a}} + 1', 'b1');
      const engine = new ComputedProperties('db');
      const schema = [title, a, b];
      const rows = engine.apply(schema, [row('r1', {})], { databaseId: 'db', now: NOW });

      expect(engine.compile(a, schema)).toMatchObject({ ok: false, error: { code: 'circularReference' } });
      expect(valueOf(rows, 'r1', a)).toBeNull();
    });

    it('refuses a chain of formulas deeper than 15 layers', () => {
      const chain = Array.from({ length: 17 }, (_, i) => formula(`f${i}`, i === 0 ? '1' : `{{property:f${i - 1}}} + 1`, `b${String(i).padStart(2, '0')}`));
      const engine = new ComputedProperties('db');
      const schema = [title, ...chain];

      expect(engine.compile(chain[15], schema).ok).toBe(true);
      expect(engine.compile(chain[16], schema)).toMatchObject({ ok: false, error: { code: 'tooDeep' } });
    });

    it('memoizes a row whose inputs did not change', () => {
      const double = formula('double', '{{property:amount}} * 2');
      const schema = [title, amount, double];
      const engine = new ComputedProperties('db');
      const first = engine.apply(schema, [row('r1', { amount: 3 }), row('r2', { amount: 1 })], { databaseId: 'db', now: NOW });
      const second = engine.apply(schema, [row('r1', { amount: 3 }), row('r2', { amount: 5 })], { databaseId: 'db', now: NOW });

      expect(second[0].computed).toBe(first[0].computed);
      expect(second[1].computed).not.toBe(first[1].computed);
      expect(valueOf(second, 'r2', double)).toBe(10);
    });

    it('recomputes a clock formula when the clock moves', () => {
      const year = formula('year', 'year(now())');
      const engine = new ComputedProperties('db');
      const first = engine.apply([title, year], [row('r1', {})], { databaseId: 'db', now: NOW, timeZone: 'UTC' });
      const later = engine.apply([title, year], [row('r1', {})], { databaseId: 'db', now: new Date('2027-02-01T00:00:00Z'), timeZone: 'UTC' });

      expect(valueOf(first, 'r1', year)).toBe(2026);
      expect(valueOf(later, 'r1', year)).toBe(2027);
    });
  });

  describe('relation', () => {
    it('leaves out related rows that no longer exist', () => {
      const tasks = relation('tasks', 'db');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks], [row('r1', { tasks: [{ id: 'r2' }, { id: 'gone' }] }), row('r2', {})], {
        databaseId: 'db', now: NOW,
      });

      expect(valueOf(rows, 'r1', tasks)).toEqual([{ id: 'r2' }]);
      expect(rows[0].properties.tasks).toEqual([{ id: 'r2' }, { id: 'gone' }]);
    });

    it('shows a one-way self-relation both ways, as Notion does', () => {
      const related = relation('related', 'db');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, related], [row('alpha', { related: [{ id: 'bravo' }] }), row('bravo', {})], {
        databaseId: 'db', now: NOW,
      });

      expect(valueOf(rows, 'bravo', related)).toEqual([{ id: 'alpha' }]);
    });

    it('keeps a two-way self-relation one-directional: the synced property mirrors it', () => {
      const next = relation('next', 'db', { twoWay: true, syncedPropertyId: 'prev' });
      const prev = relation('prev', 'db', { twoWay: true, syncedPropertyId: 'next' });
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, next, prev], [row('alpha', { next: [{ id: 'bravo' }] }), row('bravo', { prev: [{ id: 'alpha' }] })], {
        databaseId: 'db', now: NOW,
      });

      expect(valueOf(rows, 'bravo', next)).toEqual([]);
      expect(valueOf(rows, 'bravo', prev)).toEqual([{ id: 'alpha' }]);
    });

    it('reads rows of another database in the document', () => {
      const tasks = relation('tasks', 'db-tasks');
      const other: DatabaseSource = { schema: [title], rows: [row('t1', {})] };
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks], [row('p1', { tasks: [{ id: 't1' }, { id: 'gone' }] })], {
        databaseId: 'db', now: NOW, resolveDatabase: (id) => (id === 'db-tasks' ? other : undefined),
      });

      expect(valueOf(rows, 'p1', tasks)).toEqual([{ id: 't1' }]);
    });
  });

  describe('rollup', () => {
    const tasks = relation('tasks', 'db-tasks');
    const hours: PropertyDefinition = { id: 'hours', name: 'Hours', type: 'number', position: 'a1' };
    const doubleHours = formula('double', '{{property:hours}} * 2');
    const otherEngine = new ComputedProperties('db-tasks');
    const otherSchema = [title, hours, doubleHours];
    const other: DatabaseSource = {
      schema: otherSchema,
      rows: otherEngine.apply(otherSchema, [row('t1', { hours: 2 }), row('t2', { hours: 5 })], { databaseId: 'db-tasks', now: NOW }),
      valueProperty: (p) => otherEngine.valueProperty(p),
    };
    const ctx = { databaseId: 'db', now: NOW, resolveDatabase: (id: string): DatabaseSource | undefined => (id === 'db-tasks' ? other : undefined) };

    it('sums a number of the related rows', () => {
      const total = rollup('total', 'tasks', 'hours', 'sum');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks, total], [row('p1', { tasks: [{ id: 't1' }, { id: 't2' }] })], ctx);

      expect(valueOf(rows, 'p1', total)).toBe(7);
      expect(engine.valueProperty(total).type).toBe('number');
    });

    it('rolls up a formula of the related database', () => {
      const total = rollup('total', 'tasks', 'double', 'max');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks, total], [row('p1', { tasks: [{ id: 't1' }, { id: 't2' }] })], ctx);

      expect(valueOf(rows, 'p1', total)).toBe(10);
    });

    it('rolls up over a self-relation', () => {
      const related = relation('related', 'db');
      const total = rollup('total', 'related', 'amount', 'sum');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, amount, related, total], [
        row('a', { amount: 1, related: [{ id: 'b' }, { id: 'c' }] }), row('b', { amount: 2 }), row('c', { amount: 4 }),
      ], { databaseId: 'db', now: NOW });

      expect(valueOf(rows, 'a', total)).toBe(6);
    });

    it('refuses a rollup of a rollup: the value stays empty', () => {
      const inner = rollup('inner', 'related', 'amount', 'sum');
      const related = relation('related', 'db');
      const outer = rollup('outer', 'related', 'inner', 'sum');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, amount, related, inner, outer], [row('a', { related: [{ id: 'b' }] }), row('b', { amount: 1 })], {
        databaseId: 'db', now: NOW,
      });

      expect(valueOf(rows, 'a', outer)).toBeNull();
    });

    it('lets a formula read a rollup', () => {
      const total = rollup('total', 'tasks', 'hours', 'sum');
      const label = formula('label', '"Total: " + format({{property:total}})');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks, total, label], [row('p1', { tasks: [{ id: 't1' }] })], ctx);

      expect(valueOf(rows, 'p1', label)).toBe('Total: 2');
    });

    it('lets a formula read a property of each related page', () => {
      const open = formula('open', '{{property:tasks}}.filter(current.prop("Hours") > 3).length()');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks, open], [row('p1', { tasks: [{ id: 't1' }, { id: 't2' }] })], ctx);

      expect(valueOf(rows, 'p1', open)).toBe(1);
    });
  });
});
