import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import type { DatabaseSource } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import { FILTER_OPERATORS, sortRows } from '../../../../src/tools/database/database-query';
import { calculationItems } from '../../../../src/tools/database/database-table-menus';
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

    it('shows a formula with Number and Text branches as text, the number printed plain', () => {
      const due: PropertyDefinition = { id: 'due', name: 'Due date', type: 'date', position: 'a3' };
      const days = formula('days', 'if(dateBetween({{property:due}}, now(), "days") > 0, dateBetween({{property:due}}, now(), "days"), "Overdue")', 'b0');
      const schema = [title, due, days];
      const engine = new ComputedProperties('db');
      const rows = engine.apply(schema, [row('r1', { due: '2026-10-19' }), row('r2', { due: '2026-10-01' })], { databaseId: 'db', now: NOW, timeZone: 'UTC' });

      expect(engine.valueProperty(days).type).toBe('text');
      // 9.5 days from noon: dateBetween drops the part day.
      expect(valueOf(rows, 'r1', days)).toBe('9');
      expect(valueOf(rows, 'r2', days)).toBe('Overdue');
    });

    it('prints a person branch turned into text by name, as the CSV export does', () => {
      const owner: PropertyDefinition = { id: 'owner', name: 'Owner', type: 'person', position: 'a3' };
      const who = formula('who', 'if({{property:done}}, {{property:owner}}, "Nobody")', 'b0');
      const people = [{ id: 'u1', name: 'Ada Lovelace' }, { id: 'u2', name: 'Alan Turing' }];
      const engine = new ComputedProperties('db');
      const input = [row('r1', { done: true, owner: [{ id: 'u1' }, { id: 'u2' }] }), row('r2', { done: false, owner: [{ id: 'u1' }] })];
      const rows = engine.apply([title, done, owner, who], input, { databaseId: 'db', now: NOW, people });

      expect(valueOf(rows, 'r1', who)).toBe('Ada Lovelace, Alan Turing');
      expect(valueOf(rows, 'r2', who)).toBe('Nobody');
      expect(engine.valueProperty(who).type).toBe('text');
    });

    it('prints the person id until the people directory loads, then the name', () => {
      const owner: PropertyDefinition = { id: 'owner', name: 'Owner', type: 'person', position: 'a3' };
      const who = formula('who', 'if({{property:done}}, {{property:owner}}, "Nobody")', 'b0');
      const engine = new ComputedProperties('db');
      const input = [row('r1', { done: true, owner: [{ id: 'u1' }] })];

      expect(valueOf(engine.apply([title, done, owner, who], input, { databaseId: 'db', now: NOW }), 'r1', who)).toBe('u1');
      expect(valueOf(engine.apply([title, done, owner, who], input, { databaseId: 'db', now: NOW, people: [{ id: 'u1', name: 'Ada' }] }), 'r1', who)).toBe('Ada');
    });

    it('hands a mixed-branch formula to another formula as its raw value', () => {
      const mixed = formula('mixed', 'if({{property:amount}} > 0, {{property:amount}}, "none")');
      const reader = formula('reader', '{{property:mixed}} > 1', 'b1');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, amount, mixed, reader], [row('r1', { amount: 5 }), row('r2', { amount: 0 })], { databaseId: 'db', now: NOW });

      expect(valueOf(rows, 'r1', reader)).toBe(true);
      expect(valueOf(rows, 'r2', reader)).toBe(false);
    });

    // research/35 §17: 42, 100, 4277, then the text; a text sort would put "100" before "42".
    it('sorts a mixed-branch formula\'s numbers as numbers, ahead of its text', () => {
      const mixed = formula('mixed', 'if({{property:amount}} > 40, {{property:amount}}, "low")');
      const engine = new ComputedProperties('db');
      const schema = [title, amount, mixed];
      const rows = engine.apply(schema, [
        row('big', { amount: 4277 }), row('low', { amount: 4 }), row('mid', { amount: 100 }), row('small', { amount: 42 }),
      ], { databaseId: 'db', now: NOW });
      const shown = schema.map((p) => engine.valueProperty(p));

      expect(sortRows(rows, [{ propertyId: 'mixed', direction: 'asc' }], shown).map((r) => r.id)).toEqual(['small', 'mid', 'big', 'low']);
      expect(engine.valueProperty(mixed).type).toBe('text');
    });

    // A formula changed to Text keeps its `formula` setting (so a change back restores it); it sorts as text.
    it('sorts a Text property that still carries a formula setting as text', () => {
      const converted: PropertyDefinition = { id: 'notes', name: 'Notes', type: 'text', position: 'b0', formula: { expression: '1' } };
      const engine = new ComputedProperties('db');
      const rows = [row('a', { notes: '42' }), row('b', { notes: '100' })];

      expect(sortRows(rows, [{ propertyId: 'notes', direction: 'asc' }], [title, engine.valueProperty(converted)]).map((r) => r.id)).toEqual(['b', 'a']);
    });

    // research/35 §17: left-aligned like text, the text filter conditions, and only None, Count and Percent.
    it('shows, filters and calculates a mixed-branch formula as text', () => {
      const shown = new ComputedProperties('db').valueProperty(formula('mixed', 'if({{property:amount}} > 40, {{property:amount}}, "low")'));
      const titles = calculationItems(shown, undefined, { t: (key: string) => key }, vi.fn()).map((item) => ('title' in item ? item.title : undefined));

      expect(shown.type).toBe('text');
      expect(FILTER_OPERATORS[shown.type]).toEqual(['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty']);
      expect(titles).toEqual(['tools.database.calcNone', 'tools.database.calcCount', 'tools.database.calcPercent']);
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

    // notion-spec-2 §13: Show original of a Number keeps its list value but draws with the rollup's number settings.
    it('shows Show original of a Number as text carrying the rollup\'s number settings', () => {
      const list = { ...rollup('list', 'tasks', 'hours', 'show_original'), number: { format: 'dollar' as const, decimals: 2 } };
      const bare = rollup('bare', 'tasks', 'hours', 'show_original');
      const engine = new ComputedProperties('db');
      const rows = engine.apply([title, tasks, list, bare], [row('p1', { tasks: [{ id: 't1' }, { id: 't2' }] })], ctx);

      expect(valueOf(rows, 'p1', list)).toBe('2, 5');
      expect(engine.valueProperty(list)).toMatchObject({ type: 'text', number: { format: 'dollar', decimals: 2 } });
      expect(engine.valueProperty(bare)).toMatchObject({ type: 'text', number: {} });
    });

    it('drops number settings left on a list rollup whose target is not a Number', () => {
      const names = { ...rollup('names', 'tasks', 'title', 'show_original'), number: { format: 'dollar' as const } };
      const unique = { ...rollup('unique', 'tasks', 'hours', 'show_unique'), number: { format: 'dollar' as const } };
      const engine = new ComputedProperties('db');

      engine.apply([title, tasks, names, unique], [row('p1', { tasks: [{ id: 't1' }] })], ctx);

      expect(engine.valueProperty(names)).toMatchObject({ type: 'text' });
      expect(engine.valueProperty(names).number).toBeUndefined();
      expect(engine.valueProperty(unique).number).toBeUndefined();
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
