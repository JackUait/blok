// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { DATABASE_DATA, describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

type Option = { id: string; label: string; position: string; color?: string; groupId?: string };
type Property = Record<string, unknown> & { id: string; name: string; type: string; position: string; config?: { options: Option[] } };

const handler = (name: string): ToolActionImpl => {
  const found = DATABASE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing database handler "${name}".`);
  }

  return found;
};

const make = (): { doc: FakeDoc; id: string; schema: () => Property[]; status: () => Property; data: () => Record<string, unknown> } => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = handler('create').run(seed, {}, undefined) as { id: string };
  const data = (): Record<string, unknown> => {
    const value = seed.read(id)?.data;

    return typeof value === 'object' && value !== null ? { ...value } : {};
  };
  const schema = (): Property[] => data().schema as Property[];

  return { doc: seed.doc, id, schema, data, status: (): Property => schema()[1] };
};

const run = (doc: FakeDoc, id: string, name: string, args: Record<string, unknown>): unknown =>
  handler(name).run(createFakeCtx(doc, id), args, undefined);

const optionOf = (property: Property, index: number): Option => {
  const option = property.config?.options[index];

  if (option === undefined) {
    throw new Error('Expected an option.');
  }

  return option;
};

const row = (doc: FakeDoc, databaseId: string, rowId: string, properties: Record<string, unknown>): void => {
  doc.set(rowId, { id: rowId, type: 'database-row', data: { properties, position: 'a0' }, parentId: databaseId, children: [] });
  doc.get(databaseId)?.children.push(rowId);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('database properties', () => {
  it('adds a select property with options, after the last property', () => {
    const { doc, id, schema, data } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Priority', type: 'select', options: [{ label: 'High', color: 'red' }, { label: 'Low' }] }) as { propertyId: string };
    const priority = schema()[2];

    expect(priority).toMatchObject({ id: propertyId, name: 'Priority', type: 'select', config: { options: [{ label: 'High', color: 'red' }, { label: 'Low' }] } });
    expect(priority.position > schema()[1].position).toBe(true);
    expect(optionOf(priority, 0).position < optionOf(priority, 1).position).toBe(true);
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('a status property starts with the three default options and groups, as the editor builds it', () => {
    const { doc, id, schema } = make();

    run(doc, id, 'addProperty', { name: 'State', type: 'status' });

    expect(schema()[2].config?.options.map(option => [option.label, option.groupId])).toEqual([
      ['Not started', 'todo'], ['In progress', 'inProgress'], ['Done', 'complete'],
    ]);
    expect((schema()[2].status as { groups: Array<{ id: string }> }).groups.map(group => group.id)).toEqual(['todo', 'inProgress', 'complete']);
  });

  it('a relation starts as a self-relation, and a list property gives existing rows an empty list', () => {
    const { doc, id, schema } = make();

    row(doc, id, 'r1', {});
    run(doc, id, 'addProperty', { name: 'Related', type: 'relation' });

    expect(schema()[2].relation).toEqual({ targetDatabaseId: id });
    expect((doc.get('r1')?.data.properties as Record<string, unknown>)[schema()[2].id]).toEqual([]);
  });

  // research/14 §1-§2a: as the editor's add, a taken name gets the lowest free " N".
  it('names a taken name "<name> N", and a duplicate of a duplicate too', () => {
    const { doc, id, schema } = make();
    const add = (name: string): string => (run(doc, id, 'addProperty', { name, type: 'text' }) as { propertyId: string }).propertyId;
    const nameOf = (propertyId: string): string | undefined => schema().find(property => property.id === propertyId)?.name;
    const first = add('Notes');

    expect(nameOf(add('Notes'))).toBe('Notes 1');
    expect(nameOf(add('notes'))).toBe('notes');
    run(doc, id, 'duplicateProperty', { propertyId: first });
    const { propertyId } = run(doc, id, 'duplicateProperty', { propertyId: first }) as { propertyId: string };

    expect(nameOf(propertyId)).toBe('Notes (copy) 1');
  });

  /** The v1.16.1 shape: `visibleProperties` lists the columns, no `properties`. */
  const legacyViews = (doc: FakeDoc, id: string, views: Array<Record<string, unknown>>): void => {
    const block = doc.get(id);

    if (block === undefined) throw new Error('no database');
    const base = { position: 'a0', sorts: [], filters: [] };

    block.data = { ...block.data, views: views.map(view => ({ ...base, ...view })), activeViewId: 'v1' };
  };
  type SavedView = { id: string; visibleProperties: string[]; properties?: Array<{ id: string; visible: boolean }> };
  const viewOf = (data: Record<string, unknown>, viewId: string): SavedView | undefined =>
    (data.views as SavedView[]).find(view => view.id === viewId);

  // A legacy list reads every unlisted property as hidden; in Notion a new property shows in a table.
  it('a property added to a database shows in its legacy table views', () => {
    const { doc, id, schema, data } = make();
    const statusId = schema()[1].id;

    legacyViews(doc, id, [
      { id: 'v1', name: 'Table', type: 'table', visibleProperties: [statusId] },
      { id: 'v2', name: 'Board', type: 'board', visibleProperties: [statusId] },
    ]);
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Notes', type: 'text' }) as { propertyId: string };

    expect(viewOf(data(), 'v1')?.visibleProperties).toEqual([statusId, propertyId]);
    expect(viewOf(data(), 'v1')?.properties?.find(entry => entry.id === propertyId)?.visible).toBe(true);
    expect(viewOf(data(), 'v2')).toMatchObject({ visibleProperties: [statusId] });
    expect(viewOf(data(), 'v2')?.properties).toBeUndefined();
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('a duplicated property shows in a legacy table view', () => {
    const { doc, id, schema, data } = make();
    const statusId = schema()[1].id;

    legacyViews(doc, id, [{ id: 'v1', name: 'Table', type: 'table', visibleProperties: [statusId] }]);
    const { propertyId } = run(doc, id, 'duplicateProperty', { propertyId: statusId }) as { propertyId: string };

    expect(viewOf(data(), 'v1')?.visibleProperties).toEqual([statusId, propertyId]);
  });

  it('leaves a view that already shows unlisted properties as it is', () => {
    const { doc, id, data } = make();
    const before = JSON.stringify(data().views);

    run(doc, id, 'addProperty', { name: 'Notes', type: 'text' });

    expect(JSON.stringify(data().views)).toBe(before);
  });

  it('refuses options on a text property and a second title', () => {
    const { doc, id } = make();

    expect(() => run(doc, id, 'addProperty', { name: 'N', type: 'text', options: [{ label: 'x' }] })).toThrow(FakeFailure);
    expect(() => run(doc, id, 'addProperty', { name: 'T', type: 'title' })).toThrow(FakeFailure);
  });
});

describe('database select options', () => {
  it('adds, renames and moves an option by id', () => {
    const { doc, id, status } = make();
    const { optionId } = run(doc, id, 'addOption', { propertyId: status().id, label: 'Blocked', color: 'red' }) as { optionId: string };
    const first = optionOf(status(), 0).id;

    expect(status().config?.options.at(-1)).toMatchObject({ id: optionId, label: 'Blocked', color: 'red' });
    run(doc, id, 'renameOption', { propertyId: status().id, optionId, label: 'Stuck' });
    run(doc, id, 'moveOption', { propertyId: status().id, optionId, before: first });

    const ordered = [...(status().config?.options ?? [])].sort((a, b) => (a.position < b.position ? -1 : 1));

    expect(ordered.map(option => option.label)).toEqual(['Stuck', 'Not started', 'In progress', 'Done']);
  });

  it('deleting an option keeps its rows with the value emptied, as the editor does', () => {
    const { doc, id, status } = make();
    const option = optionOf(status(), 0);

    row(doc, id, 'r1', { [status().id]: option.id });
    row(doc, id, 'r2', { [status().id]: optionOf(status(), 1).id });
    run(doc, id, 'deleteOption', { propertyId: status().id, optionId: option.id, rows: 'keep' });

    expect(status().config?.options.map(o => o.id)).not.toContain(option.id);
    expect((doc.get('r1')?.data.properties as Record<string, unknown>)[status().id]).toBeNull();
    expect((doc.get('r2')?.data.properties as Record<string, unknown>)[status().id]).toBe(optionOf(status(), 0).id);
  });

  it('deleting a multi-select option with rows: delete removes the rows that hold it', () => {
    const { doc, id, schema } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'Tags', type: 'multiSelect', options: [{ label: 'a' }, { label: 'b' }] }) as { propertyId: string };
    const [a, b] = schema()[2].config?.options ?? [];

    row(doc, id, 'r1', { [propertyId]: [a?.id, b?.id] });
    row(doc, id, 'r2', { [propertyId]: [b?.id] });
    run(doc, id, 'deleteOption', { propertyId, optionId: a?.id, rows: 'delete' });

    expect(doc.has('r1')).toBe(false);
    expect(doc.has('r2')).toBe(true);
  });

  it('keeps at least one option and refuses unknown ids', () => {
    const { doc, id, schema } = make();
    const { propertyId } = run(doc, id, 'addProperty', { name: 'One', type: 'select', options: [{ label: 'only' }] }) as { propertyId: string };

    expect(() => run(doc, id, 'deleteOption', { propertyId, optionId: optionOf(schema()[2], 0).id, rows: 'keep' })).toThrow(/at least one option/);
    expect(() => run(doc, id, 'renameOption', { propertyId, optionId: 'nope', label: 'x' })).toThrow(/no option nope/);
    expect(() => run(doc, id, 'addOption', { propertyId: schema()[0].id, label: 'x' })).toThrow(/not a select/);
  });
});

describe('property and option declarations', () => {
  const argsOf = (name: string): Record<string, unknown> => describeDatabase().actions?.find(action => action.name === name)?.args ?? {};

  it('validates the arguments', () => {
    expect(validateAgainst(argsOf('addProperty'), { name: 'P', type: 'select', options: [{ label: 'a', color: 'red' }] })).toEqual([]);
    expect(validateAgainst(argsOf('addProperty'), { name: 'P', type: 'title' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('addOption'), { propertyId: 'p', label: 'a' })).toEqual([]);
    expect(validateAgainst(argsOf('deleteOption'), { propertyId: 'p', optionId: 'o', rows: 'keep' })).toEqual([]);
    expect(validateAgainst(argsOf('deleteOption'), { propertyId: 'p', optionId: 'o' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('moveOption'), { propertyId: 'p', optionId: 'o', after: 'q' })).toEqual([]);
    expect(validateAgainst(argsOf('moveOption'), { propertyId: 'p', optionId: 'o' }).length).toBeGreaterThan(0);
  });
});
