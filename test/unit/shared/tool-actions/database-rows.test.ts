// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { DATABASE_ROW_DATA } from '../../../../src/shared/tool-descriptions/database-row';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

type Row = { properties: Record<string, unknown>; position: string; title?: string };
type Property = { id: string; type: string; config?: { options: Array<{ id: string }> } };

const handler = (name: string): ToolActionImpl => {
  const found = DATABASE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing database handler "${name}".`);
  }

  return found;
};

const make = (args: Record<string, unknown> = {}): { doc: FakeDoc; id: string; schema: () => Property[] } => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = handler('create').run(seed, args, undefined) as { id: string };

  return { doc: seed.doc, id, schema: (): Property[] => (seed.read(id)?.data as { schema: Property[] }).schema };
};

const run = (doc: FakeDoc, id: string, name: string, args: Record<string, unknown>): unknown =>
  handler(name).run(createFakeCtx(doc, id), args, undefined);

const rowOf = (doc: FakeDoc, rowId: string): Row => doc.get(rowId)?.data as Row;

const ordered = (doc: FakeDoc, ids: string[]): string[] =>
  [...ids].sort((a, b) => (rowOf(doc, a).position < rowOf(doc, b).position ? -1 : 1)).map(rowId => rowOf(doc, rowId).title ?? '');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('database rows', () => {
  it('adds rows in order and mirrors the title', () => {
    const { doc, id, schema } = make();
    const titleId = schema()[0].id;
    const add = (values: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
      (run(doc, id, 'addRow', { values, ...extra }) as { rowId: string }).rowId;
    const a = add({ [titleId]: 'A' });
    const b = add({ [titleId]: 'B' });
    const c = add({ [titleId]: 'C' }, { before: a });
    const d = add({ [titleId]: 'D' }, { after: a });

    expect(doc.get(a)).toMatchObject({ type: 'database-row', parentId: id });
    expect(rowOf(doc, a).title).toBe('A');
    expect(ordered(doc, [a, b, c, d])).toEqual(['C', 'A', 'D', 'B']);
    expect(validateAgainst(DATABASE_ROW_DATA, rowOf(doc, a))).toEqual([]);

    run(doc, id, 'setRowValues', { rowId: b, values: { [titleId]: 'Bee' } });
    expect(rowOf(doc, b)).toMatchObject({ title: 'Bee', properties: { [titleId]: 'Bee' } });
  });

  it('a new row gets an empty list for every list property, as the editor writes it', () => {
    const { doc, id } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Owner', type: 'person' }) as { propertyId: string };
    const { rowId } = run(doc, id, 'addRow', {}) as { rowId: string };

    expect(rowOf(doc, rowId).properties[propertyId]).toEqual([]);
  });

  it('group puts the row in a board column of the open view', () => {
    const { doc, id, schema } = make();
    const status = schema()[1];
    const done = status.config?.options[2]?.id;
    const { rowId } = run(doc, id, 'addRow', { group: done }) as { rowId: string };

    expect(rowOf(doc, rowId).properties[status.id]).toBe(done);
    expect(() => run(doc, id, 'addRow', { group: 'nope' })).toThrow(/no option nope/);
    const table = make({ view: 'table' });

    expect(() => run(table.doc, table.id, 'addRow', { group: done })).toThrow(FakeFailure);
  });

  it('moves a row among its siblings and into another group', () => {
    const { doc, id, schema } = make();
    const titleId = schema()[0].id;
    const status = schema()[1];
    const a = (run(doc, id, 'addRow', { values: { [titleId]: 'A' } }) as { rowId: string }).rowId;
    const b = (run(doc, id, 'addRow', { values: { [titleId]: 'B' } }) as { rowId: string }).rowId;
    const inProgress = status.config?.options[1]?.id;

    run(doc, id, 'moveRow', { rowId: b, before: a, group: inProgress });

    expect(ordered(doc, [a, b])).toEqual(['B', 'A']);
    expect(rowOf(doc, b).properties).toEqual({ [titleId]: 'B', [status.id]: inProgress });
  });

  it('refuses a block that is not a row of this database', () => {
    const { doc, id } = make();

    expect(() => run(doc, id, 'setRowValues', { rowId: id, values: {} })).toThrow(/not a row of this database/);
    expect(() => run(doc, id, 'setRowValues', { rowId: 'nope', values: {} })).toThrow(FakeFailure);
  });

  it('rows can change on a locked database', () => {
    const { doc, id, schema } = make();

    createFakeCtx(doc, id).update(id, { schema: schema().map((property, i) => (i === 0 ? { ...property, databaseLocked: true } : property)) });

    expect(() => run(doc, id, 'addRow', {})).not.toThrow();
  });
});

describe('row declarations', () => {
  const argsOf = (name: string): Record<string, unknown> => describeDatabase().actions?.find(action => action.name === name)?.args ?? {};

  it('validates the arguments', () => {
    expect(validateAgainst(argsOf('addRow'), { values: { p: 'x' }, group: 'o', before: 'r' })).toEqual([]);
    expect(validateAgainst(argsOf('moveRow'), { rowId: 'r', after: 's' })).toEqual([]);
    expect(validateAgainst(argsOf('setRowValues'), { rowId: 'r', values: { p: 1 } })).toEqual([]);
    expect(validateAgainst(argsOf('setRowValues'), { rowId: 'r' }).length).toBeGreaterThan(0);
  });
});
