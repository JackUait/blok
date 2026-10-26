// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { DATABASE_DATA, describeDatabase } from '../../../../src/shared/tool-descriptions/database';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

type View = Record<string, unknown> & { id: string; name: string; type: string; position: string; groupBy?: string; filterTree?: { id: string } };
type Data = { views: View[]; activeViewId: string; schema: Array<{ id: string; type: string; databaseLocked?: boolean }>; title?: string };

const handler = (name: string): ToolActionImpl => {
  const found = DATABASE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing database handler "${name}".`);
  }

  return found;
};

const make = (args: Record<string, unknown> = { title: 'Tasks' }): { doc: FakeDoc; id: string; data: () => Data } => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = handler('create').run(seed, args, undefined) as { id: string };

  return { doc: seed.doc, id, data: (): Data => seed.read(id)?.data as Data };
};

const run = (doc: FakeDoc, id: string, name: string, args: Record<string, unknown>): unknown =>
  handler(name).run(createFakeCtx(doc, id), args, undefined);

const byPosition = (views: View[]): View[] => [...views].sort((a, b) => (a.position < b.position ? -1 : 1));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('database.create', () => {
  it('creates a database with the default schema and one board view, as the editor builds it', () => {
    const { data } = make();
    const model = new DatabaseModel(undefined, { idSeed: 'x' });

    expect(data().title).toBe('Tasks');
    expect(data().schema.map(property => property.type)).toEqual(['title', 'select']);
    expect(data().views).toHaveLength(1);
    expect(data().activeViewId).toBe(data().views[0].id);
    expect(Object.keys(data().views[0]).sort()).toEqual(Object.keys(model.getViews()[0]).sort());
    expect(data().views[0]).toMatchObject({ type: 'board', name: 'Board', groupBy: data().schema[1].id });
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it.each([['table', 'Table'], ['list', 'List']])('starts with a %s view', (view, name) => {
    const { data } = make({ view });

    expect(data().views[0]).toMatchObject({ type: view, name });
    expect(data().views[0]).not.toHaveProperty('groupBy');
  });
});

describe('database view actions', () => {
  it('adds a list view at the end and activates it', () => {
    const { doc, id, data } = make();
    const { viewId } = run(doc, id, 'addView', { type: 'list' }) as { viewId: string };

    expect(byPosition(data().views).map(view => view.type)).toEqual(['board', 'list']);
    expect(data().views[1].name).toBe('List');
    expect(data().activeViewId).toBe(viewId);
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('a new board groups by the first select property, as the editor does, or by the one given', () => {
    const { doc, id, data } = make();
    const status = data().schema[1].id;

    run(doc, id, 'addView', { type: 'board', name: 'Kanban' });
    expect(data().views[1]).toMatchObject({ type: 'board', name: 'Kanban', groupBy: status });
    expect(() => run(doc, id, 'addView', { type: 'board', groupBy: data().schema[0].id })).toThrow(FakeFailure);
    expect(() => run(doc, id, 'addView', { type: 'board', groupBy: 'nope' })).toThrow(/no property nope/);
  });

  it('renames, moves and deletes by id, keeping one view', () => {
    const { doc, id, data } = make();
    const first = data().views[0].id;
    const { viewId } = run(doc, id, 'addView', { type: 'list' }) as { viewId: string };

    run(doc, id, 'renameView', { viewId, name: 'Mine' });
    run(doc, id, 'moveView', { viewId, before: first });
    expect(byPosition(data().views).map(view => view.name)).toEqual(['Mine', 'Board']);
    run(doc, id, 'moveView', { viewId, after: first });
    expect(byPosition(data().views).map(view => view.name)).toEqual(['Board', 'Mine']);
    run(doc, id, 'deleteView', { viewId });
    expect(data().activeViewId).toBe(first);
    expect(() => run(doc, id, 'deleteView', { viewId: first })).toThrow(/at least one view/);
    expect(() => run(doc, id, 'renameView', { viewId: 'nope', name: 'x' })).toThrow(/no view nope/);
  });

  it('deleting an inactive view keeps the active one', () => {
    const { doc, id, data } = make();
    const { viewId } = run(doc, id, 'addView', { type: 'list' }) as { viewId: string };

    run(doc, id, 'addView', { type: 'table' });
    const active = data().activeViewId;

    run(doc, id, 'deleteView', { viewId });

    expect(data().activeViewId).toBe(active);
  });

  it('duplicates a view like the UI: same name and settings, last, active', () => {
    const { doc, id, data } = make();
    const source = data().views[0];
    const { viewId } = run(doc, id, 'duplicateView', { viewId: source.id }) as { viewId: string };
    const copy = data().views.find(view => view.id === viewId);
    const { id: _sourceId, position: _sourcePosition, ...settings } = source;

    expect(copy).toMatchObject(settings);
    expect((copy?.position ?? '') > source.position).toBe(true);
    expect(data().activeViewId).toBe(viewId);
  });

  // The action writes sharing settings; the executor asks the person first (database-share-approval.test.ts).
  it.each([
    [{ form: { public: true } }, { form: { public: true } }],
    [{ form: { submitLabel: 'Go', anonymous: true } }, { form: { submitLabel: 'Go', anonymous: true } }],
    [{ calendarSync: { enabled: true } }, { calendarSync: { enabled: true } }],
  ])('updateView writes a sharing setting as the Share panel does: %j', (changes, saved) => {
    const { doc, id, data } = make();

    run(doc, id, 'updateView', { viewId: data().views[0].id, changes });

    expect(data().views[0]).toMatchObject(saved);
  });

  it.each([
    [{ form: null }, /form cannot be removed/],
    [{ calendarSync: { enabled: true, calendarId: 'team\u202E@x' } }, /one plain line/],
    [{ calendarSync: { enabled: true, calendarId: ' team' } }, /one plain line/],
  ])('updateView refuses %j', (changes, message) => {
    const { doc, id, data } = make();

    expect(() => run(doc, id, 'updateView', { viewId: data().views[0].id, changes })).toThrow(FakeFailure);
    expect(() => run(doc, id, 'updateView', { viewId: data().views[0].id, changes })).toThrow(message);
  });

  it('refuses view changes on a locked database', () => {
    const { doc, id, data } = make();
    const ctx = createFakeCtx(doc, id);

    ctx.update(id, { schema: data().schema.map((property, i) => (i === 0 ? { ...property, databaseLocked: true } : property)) });

    expect(() => run(doc, id, 'addView', { type: 'list' })).toThrow(/locked/);
  });
});

describe('database view declarations', () => {
  const argsOf = (name: string): Record<string, unknown> => describeDatabase().actions?.find(action => action.name === name)?.args ?? {};

  it('validates the arguments and wires every handler', () => {
    expect(validateAgainst(argsOf('create'), { title: 'T', view: 'table' })).toEqual([]);
    expect(validateAgainst(argsOf('create'), { view: 'chart' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('addView'), { type: 'calendar', name: 'C' })).toEqual([]);
    expect(validateAgainst(argsOf('addView'), { type: 'dashboard' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v', before: 'w' })).toEqual([]);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v', before: 'w', after: 'x' }).length).toBeGreaterThan(0);
    for (const name of ['create', 'addView', 'renameView', 'duplicateView', 'deleteView', 'moveView']) {
      expect(BUILT_IN_TOOL_RUNTIMES.get('database')?.actions[name], name).toBe(handler(name));
    }
  });
});
