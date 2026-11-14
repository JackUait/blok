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

  // notion-motion.md Round 31 §1: a new form view's tab reads "Form builder".
  it('names a new form view "Form builder", as the editor does', () => {
    const { doc, id, data } = make();
    const { viewId } = run(doc, id, 'addView', { type: 'form' }) as { viewId: string };

    expect(data().views.find(view => view.id === viewId)?.name).toBe('Form builder');
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
    expect(validateAgainst(argsOf('addView'), { type: 'dashboard' })).toEqual([]);
    expect(validateAgainst(argsOf('addView'), { type: 'chart', dashboardViewId: 'd', placement: { newRow: true } })).toEqual([]);
    expect(validateAgainst(argsOf('addView'), { type: 'chart', placement: { row: -1 } }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('setLayout'), { viewId: 'v', type: 'dashboard' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v', before: 'w' })).toEqual([]);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('moveView'), { viewId: 'v', before: 'w', after: 'x' }).length).toBeGreaterThan(0);
    for (const name of ['create', 'addView', 'renameView', 'duplicateView', 'deleteView', 'moveView']) {
      expect(BUILT_IN_TOOL_RUNTIMES.get('database')?.actions[name], name).toBe(handler(name));
    }
  });
});

describe('database dashboard views', () => {
  const withDashboard = (): { doc: FakeDoc; id: string; data: () => Data; dash: string; board: string } => {
    const made = make();
    const board = made.data().views[0].id;
    const { viewId } = run(made.doc, made.id, 'addView', { type: 'dashboard' }) as { viewId: string };

    return { ...made, dash: viewId, board };
  };
  const layout = (data: Data, dash: string): string[][] =>
    ((data.views.find(view => view.id === dash)?.dashboard as { rows: Array<{ widgets: Array<{ viewId: string }> }> } | undefined)?.rows ?? [])
      .map(row => row.widgets.map(widget => widget.viewId));

  it('adds a dashboard named Dashboard and opens it', () => {
    const { data, dash } = withDashboard();

    expect(data().views.find(view => view.id === dash)).toMatchObject({ type: 'dashboard', name: 'Dashboard' });
    expect(data().activeViewId).toBe(dash);
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('adds widgets to a dashboard without opening them, two to a row, or where placement says', () => {
    const { doc, id, data, dash } = withDashboard();
    const chart = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash }) as { viewId: string }).viewId;
    const table = (run(doc, id, 'addView', { type: 'table', dashboardViewId: dash }) as { viewId: string }).viewId;
    const list = (run(doc, id, 'addView', { type: 'list', dashboardViewId: dash, placement: { newRow: true } }) as { viewId: string }).viewId;
    const second = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash, placement: { row: 0 } }) as { viewId: string }).viewId;

    expect(data().activeViewId).toBe(dash);
    expect(layout(data(), dash)).toEqual([[chart, table, second], [list]]);
    expect(data().views.find(view => view.id === chart)).toMatchObject({ dashboardViewId: dash, type: 'chart' });
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });

  it('refuses a widget for a view that is not a dashboard, or of a layout a dashboard cannot draw', () => {
    const { doc, id, dash, board } = withDashboard();

    expect(() => run(doc, id, 'addView', { type: 'table', dashboardViewId: board })).toThrow(/no dashboard view/);
    expect(() => run(doc, id, 'addView', { type: 'board', dashboardViewId: dash })).toThrow(/table, list or chart/);
    expect(() => run(doc, id, 'addView', { type: 'table', dashboardViewId: dash, placement: { row: 3 } })).toThrow(/no row 3/);
  });

  it('deleting the dashboard takes its widget views; the last tab still cannot go', () => {
    const { doc, id, data, dash, board } = withDashboard();
    const chart = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash }) as { viewId: string }).viewId;

    run(doc, id, 'deleteView', { viewId: dash });
    expect(data().views.map(view => view.id)).toEqual([board]);
    expect(data().views.some(view => view.id === chart)).toBe(false);
    expect(data().activeViewId).toBe(board);
    expect(() => run(doc, id, 'deleteView', { viewId: board })).toThrow(/at least one view/);
  });

  it('a board and a dashboard full of widgets still keep the board: widgets are not tabs', () => {
    const { doc, id, dash, board } = withDashboard();

    run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash });
    run(doc, id, 'deleteView', { viewId: dash });
    expect(() => run(doc, id, 'deleteView', { viewId: board })).toThrow(/at least one view/);
  });

  it('setLayout keeps a widget to the layouts a dashboard draws, as the editor does', () => {
    const { doc, id, data, dash } = withDashboard();
    const chart = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash }) as { viewId: string }).viewId;

    expect(() => run(doc, id, 'setLayout', { viewId: chart, type: 'board' })).toThrow(/table, list or chart/);
    expect(data().views.find(view => view.id === chart)?.type).toBe('chart');
    run(doc, id, 'setLayout', { viewId: chart, type: 'table' });
    expect(data().views.find(view => view.id === chart)?.type).toBe('table');
  });

  it('deleting a widget view takes it out of the dashboard layout', () => {
    const { doc, id, data, dash } = withDashboard();
    const chart = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash }) as { viewId: string }).viewId;
    const table = (run(doc, id, 'addView', { type: 'table', dashboardViewId: dash }) as { viewId: string }).viewId;

    run(doc, id, 'deleteView', { viewId: chart });
    expect(layout(data(), dash)).toEqual([[table]]);
  });

  it('duplicating a dashboard copies its widgets; duplicating a widget puts the copy next to it', () => {
    const { doc, id, data, dash } = withDashboard();
    const chart = (run(doc, id, 'addView', { type: 'chart', dashboardViewId: dash }) as { viewId: string }).viewId;
    const { viewId: copy } = run(doc, id, 'duplicateView', { viewId: dash }) as { viewId: string };
    const copied = layout(data(), copy);

    expect(copied).toHaveLength(1);
    expect(copied[0][0]).not.toBe(chart);
    expect(data().views.find(view => view.id === copied[0][0])?.dashboardViewId).toBe(copy);

    const { viewId: twin } = run(doc, id, 'duplicateView', { viewId: chart }) as { viewId: string };

    expect(layout(data(), dash)).toEqual([[chart, twin]]);
    expect(data().activeViewId).toBe(copy);
    expect(validateAgainst(DATABASE_DATA, data())).toEqual([]);
  });
});
