import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseRowData } from '../../../../src/tools/database/types';
import type { DatabaseAdapter, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  (store.toJSON().find((block) => block.id === id)?.data ?? {});

const schemaOf = (store: DocumentStore, id: string): PropertyDefinition[] =>
  (dataOf(store, id).schema ?? []) as PropertyDefinition[];

const optionsOf = (store: DocumentStore, id: string, propertyId: string): SelectOption[] =>
  schemaOf(store, id).find((p) => p.id === propertyId)?.config?.options ?? [];

const option = (id: string, label: string, position: string): SelectOption => ({ id, label, position });

/** The schema shape DatabaseTool saves: title property + a grouping select. */
const baseSchema = (): PropertyDefinition[] => [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'select',
    position: 'a1',
    config: { options: [option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1'), option('o3', 'Done', 'a2')] },
  },
];

const databaseBlock = (): { id: string; type: string; data: Record<string, unknown> } => ({
  id: 'db1',
  type: 'database',
  data: {
    title: 'Tasks',
    schema: baseSchema(),
    views: [
      { id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', sorts: [], filters: [], visibleProperties: [] },
    ],
    activeViewId: 'v1',
  },
});

const createMockAdapter = (): DatabaseAdapter => ({
  loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
  createRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  updateRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  moveRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  deleteRow: vi.fn().mockResolvedValue(undefined),
  createProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  updateProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  deleteProperty: vi.fn().mockResolvedValue(undefined),
  createView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  updateView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  deleteView: vi.fn().mockResolvedValue(undefined),
});

describe('database — two peers editing the same database block', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);

    storeA.fromJSON([databaseBlock()]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps both board columns when two people add one at the same moment', () => {
    const optsA = [...baseSchema()[1].config!.options, option('oA', 'From A', 'a3')];
    const optsB = [...baseSchema()[1].config!.options, option('oB', 'From B', 'a3')];

    const schemaA = baseSchema();
    schemaA[1].config = { options: optsA };
    const schemaB = baseSchema();
    schemaB[1].config = { options: optsB };

    storeA.updateBlockData('db1', 'schema', schemaA);
    storeB.updateBlockData('db1', 'schema', schemaB);

    sync(storeA, storeB);

    const labels = optionsOf(storeA, 'db1', 'p-status').map((o) => o.label);

    expect(labels).toContain('From A');
    expect(labels).toContain('From B');
    expect(optionsOf(storeB, 'db1', 'p-status').map((o) => o.label)).toEqual(labels);
  });

  it('keeps both properties when two people add a column at the same moment', () => {
    const schemaA = [...baseSchema(), { id: 'pA', name: 'Owner', type: 'text', position: 'a2' } as PropertyDefinition];
    const schemaB = [...baseSchema(), { id: 'pB', name: 'Due', type: 'date', position: 'a2' } as PropertyDefinition];

    storeA.updateBlockData('db1', 'schema', schemaA);
    storeB.updateBlockData('db1', 'schema', schemaB);

    sync(storeA, storeB);

    const ids = schemaOf(storeA, 'db1').map((p) => p.id);

    expect(ids).toContain('pA');
    expect(ids).toContain('pB');
  });

  it('keeps a column rename that lands while the other person reorders the columns', () => {
    // B renames the third column. A drags it to the front, which rewrites the
    // stored options array in the new position order.
    const renamed = baseSchema();

    renamed[1].config = {
      options: [option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1'), option('o3', 'Shipped', 'a2')],
    };

    const reordered = baseSchema();

    reordered[1].config = {
      options: [option('o3', 'Done', 'Zz'), option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1')],
    };

    storeB.updateBlockData('db1', 'schema', renamed);
    storeA.updateBlockData('db1', 'schema', reordered);

    sync(storeA, storeB);

    const merged = optionsOf(storeA, 'db1', 'p-status');

    expect(merged.find((o) => o.id === 'o3')?.label).toBe('Shipped');
    // ...and the rename must not land on whichever column took index 2.
    expect(merged.find((o) => o.id === 'o2')?.label).toBe('Doing');
    expect(merged.map((o) => o.id).sort()).toEqual(['o1', 'o2', 'o3']);
    expect(optionsOf(storeB, 'db1', 'p-status')).toEqual(merged);
  });

  it('gives two people who add a board column at the same moment different positions', () => {
    // What handleAddColumn computes on each peer: a key after the last option.
    const last = baseSchema()[1].config!.options.slice(-1)[0].position;
    const positionA = DatabaseModel.positionBetween(last, null);
    const positionB = DatabaseModel.positionBetween(last, null);

    expect(positionA).not.toBe(positionB);
  });

  it('keeps both views when two people add a view at the same moment', () => {
    const base = databaseBlock().data.views as unknown[];
    const viewsA = [...base, { id: 'vA', name: 'List A', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] }];
    const viewsB = [...base, { id: 'vB', name: 'List B', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] }];

    storeA.updateBlockData('db1', 'views', viewsA);
    storeB.updateBlockData('db1', 'views', viewsB);

    sync(storeA, storeB);

    const ids = (dataOf(storeA, 'db1').views as { id: string }[]).map((v) => v.id);

    expect(ids).toContain('vA');
    expect(ids).toContain('vB');
  });

  it('keeps a filter added while the other person adds a sort to the same view', () => {
    const withFilter = [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', sorts: [], filters: [{ propertyId: 'p-status', operator: 'is', value: 'o1' }], visibleProperties: [] }];
    const withSort = [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', sorts: [{ propertyId: 'p-title', direction: 'asc' }], filters: [], visibleProperties: [] }];

    storeA.updateBlockData('db1', 'views', withFilter);
    storeB.updateBlockData('db1', 'views', withSort);

    sync(storeA, storeB);

    const view = (dataOf(storeA, 'db1').views as { filters: unknown[]; sorts: unknown[] }[])[0];

    expect(view.filters).toHaveLength(1);
    expect(view.sorts).toHaveLength(1);
  });
});

describe('database — fractional positions minted concurrently', () => {
  it('gives two people who add a row at the same moment different positions', () => {
    const modelA = new DatabaseModel({ schema: baseSchema(), views: [], activeViewId: '' });
    const modelB = new DatabaseModel({ schema: baseSchema(), views: [], activeViewId: '' });
    const existing = [{ id: 'r1', position: 'a0', properties: {} }];

    modelA.setRows(existing);
    modelB.setRows(existing);

    const rowA = modelA.createRowData({});
    const rowB = modelB.createRowData({});

    expect(rowA.position).not.toBe(rowB.position);
  });

  it('can still order two rows a pointer drop lands between', () => {
    // Both peers added a row at the same moment, so both rows carry the key
    // generated after 'a0'. A third person then drags a card between them.
    const modelA = new DatabaseModel({ schema: baseSchema(), views: [], activeViewId: '' });

    modelA.setRows([{ id: 'r1', position: 'a0', properties: {} }]);

    const collided = modelA.createRowData({}).position;

    expect(() => DatabaseModel.positionBetween(collided, collided)).not.toThrow();
  });
});

describe('database — backend adapter under concurrent writes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not push a stale options array over a column added while the rename was debounced', async () => {
    const adapter = createMockAdapter();
    const sync = new DatabaseBackendSync(adapter);
    const before = [option('o1', 'Renamed', 'a0'), option('o2', 'Doing', 'a1')];
    const after = [...before, option('o3', 'Added', 'a2')];

    // Column title committed — persisted on a 500ms debounce.
    sync.syncUpdatePropertyDebounced({ propertyId: 'p-status', changes: { config: { options: before } } });
    // A new column lands before the debounce fires — this one is immediate.
    await sync.syncUpdateProperty({ propertyId: 'p-status', changes: { config: { options: after } } });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    const calls = (adapter.updateProperty as ReturnType<typeof vi.fn>).mock.calls;
    const last = calls[calls.length - 1][0] as { changes: { config: { options: SelectOption[] } } };

    expect(last.changes.config.options.map((o) => o.id)).toContain('o3');
  });

  it('does not send a row update for a row that was deleted first', async () => {
    const adapter = createMockAdapter();
    const sync = new DatabaseBackendSync(adapter);

    sync.syncUpdateRow({ rowId: 'r1', properties: { 'p-title': 'typed' } });
    await sync.syncDeleteRow({ rowId: 'r1' });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(adapter.updateRow).not.toHaveBeenCalled();
  });
});

describe('database — a column deleted while the other person is still using it', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);

    storeA.fromJSON([databaseBlock()]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps a column rename that lands while the other person deletes a different column', () => {
    const renamed = baseSchema();

    renamed[1].config = { options: [option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1'), option('o3', 'Shipped', 'a2')] };

    const deleted = baseSchema();

    deleted[1].config = { options: [option('o2', 'Doing', 'a1'), option('o3', 'Done', 'a2')] };

    storeB.updateBlockData('db1', 'schema', renamed);
    storeA.updateBlockData('db1', 'schema', deleted);

    sync(storeA, storeB);

    const merged = optionsOf(storeA, 'db1', 'p-status');

    expect(merged.find((o) => o.id === 'o3')?.label).toBe('Shipped');
    expect(merged.map((o) => o.id)).toEqual(['o2', 'o3']);
  });

  it('keeps a property rename that lands while the other person deletes another property', () => {
    const wide = [...baseSchema(), { id: 'pC', name: 'Owner', type: 'text', position: 'a2' } as PropertyDefinition];

    storeA.updateBlockData('db1', 'schema', wide);
    sync(storeA, storeB);

    const renamed = wide.map((p) => (p.id === 'pC' ? { ...p, name: 'Assignee' } : p));
    const deleted = wide.filter((p) => p.id !== 'p-status');

    storeB.updateBlockData('db1', 'schema', renamed);
    storeA.updateBlockData('db1', 'schema', deleted);

    sync(storeA, storeB);

    expect(schemaOf(storeA, 'db1').find((p) => p.id === 'pC')?.name).toBe('Assignee');
    expect(schemaOf(storeA, 'db1').map((p) => p.id)).toEqual(['p-title', 'pC']);
  });

  it('keeps every column when two people reorder the board at the same moment', () => {
    // A drags 'Done' to the front, B drags 'Todo' to the end. Both write the
    // whole options array, re-sorted by the new fractional positions.
    const aMoves = baseSchema();

    aMoves[1].config = { options: [option('o3', 'Done', 'Zz'), option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1')] };

    const bMoves = baseSchema();

    bMoves[1].config = { options: [option('o2', 'Doing', 'a1'), option('o3', 'Done', 'a2'), option('o1', 'Todo', 'a3')] };

    storeA.updateBlockData('db1', 'schema', aMoves);
    storeB.updateBlockData('db1', 'schema', bMoves);

    sync(storeA, storeB);

    const ids = optionsOf(storeA, 'db1', 'p-status').map((o) => o.id);

    expect([...ids].sort()).toEqual(['o1', 'o2', 'o3']);
    expect(optionsOf(storeB, 'db1', 'p-status').map((o) => o.id)).toEqual(ids);
  });
});

/** The stored Y value under a block's top-level data key, before any read-back. */
const storedDataValue = (store: DocumentStore, id: string, key: string): unknown => {
  const yblock = store.getBlockById(id);
  const ydata = yblock?.get('data');

  if (!(ydata instanceof Y.Map)) {
    throw new Error(`block ${id} has no data map`);
  }

  return ydata.get(key);
};

describe('database-row — two peers editing one row', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const TITLE_PROP = 'p-title';

  /** A row as the tool writes it TODAY: a top-level `title` beside the mirror. */
  const newRowBlock = (title: string): { id: string; type: string; data: Record<string, unknown> } => ({
    id: 'row1',
    type: 'database-row',
    data: { position: 'a0', title, properties: { [TITLE_PROP]: title, 'p-status': 'o1' } },
  });

  /** A row saved BEFORE the top-level key existed — no `title` anywhere. */
  const legacyRowBlock = (title: string): { id: string; type: string; data: Record<string, unknown> } => ({
    id: 'row1',
    type: 'database-row',
    data: { position: 'a0', properties: { [TITLE_PROP]: title, 'p-status': 'o1' } },
  });

  /** The real row tool, built from what the document currently holds. */
  const rowToolFrom = (store: DocumentStore, id: string): DatabaseRowTool =>
    new DatabaseRowTool({ data: dataOf(store, id) as unknown as DatabaseRowData } as never);

  /** What flushBlockDataWrites does: one updateBlockData per key save() emits. */
  const flushSave = (store: DocumentStore, id: string, tool: DatabaseRowTool): void => {
    const saved = tool.save(document.createElement('div')) as unknown as Record<string, unknown>;

    for (const [key, value] of Object.entries(saved)) {
      store.updateBlockData(id, key, value);
    }
  };

  /** One person typing a whole burst into the row title, through the real tool. */
  const typeTitle = (store: DocumentStore, id: string, title: string): void => {
    const tool = rowToolFrom(store, id);

    tool.updateTitle({ title, titlePropertyId: TITLE_PROP });
    flushSave(store, id, tool);
  };

  const titleOf = (store: DocumentStore, id: string): string =>
    dataOf(store, id).title as string;

  const mirrorOf = (store: DocumentStore, id: string): string =>
    (dataOf(store, id).properties as Record<string, string>)[TITLE_PROP];

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);

    storeA.fromJSON([databaseBlock(), newRowBlock('Ship the release')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  /**
   * The row title merges because it lives in a TOP-LEVEL `title` key, which is
   * already a `DIFFABLE_TEXT_KEYS` member and so stored as a `Y.Text`.
   *
   * What must NOT be done instead: promote nested strings under `properties`.
   * The same map holds a select's option id, a date and a url, property ids are
   * `nanoid()`, and per-character merging those invents a value neither peer
   * picked (measured: `o1` → `o2` and `o3` merges to `o23`, matching no option;
   * `2026-09-21` → Sep 22 and Oct 21 merges to `2026-10-22`). The only signal
   * separating them is the property type, which lives in the parent database
   * block's concurrently-edited `data.schema` — see `DIFFABLE_TEXT_KEYS`.
   */
  it('keeps both bursts when two people type into one row title', () => {
    typeTitle(storeA, 'row1', 'Ship the release today');
    typeTitle(storeB, 'row1', 'Ship the BBB release');

    sync(storeA, storeB);

    expect(titleOf(storeA, 'row1')).toContain('BBB');
    expect(titleOf(storeA, 'row1')).toContain('today');
    expect(titleOf(storeB, 'row1')).toBe(titleOf(storeA, 'row1'));
  });

  it('converges the properties mirror on the merged title once the dust settles', () => {
    typeTitle(storeA, 'row1', 'Ship the release today');
    typeTitle(storeB, 'row1', 'Ship the BBB release');

    sync(storeA, storeB);

    const merged = titleOf(storeA, 'row1');

    // The heal DatabaseTool.syncRowsFromBlocks performs on each peer: rewrite
    // the mirror FROM the merged title. Pinned as the parent's behaviour by
    // database.test.ts → 'rewrites a stale properties mirror'.
    for (const store of [storeA, storeB]) {
      const tool = rowToolFrom(store, 'row1');

      tool.updateProperties({ [TITLE_PROP]: titleOf(store, 'row1') });
      flushSave(store, 'row1', tool);
    }

    sync(storeA, storeB);

    expect(mirrorOf(storeA, 'row1')).toBe(merged);
    expect(mirrorOf(storeB, 'row1')).toBe(merged);
    expect(mirrorOf(storeA, 'row1')).toContain('BBB');
    expect(mirrorOf(storeA, 'row1')).toContain('today');
    expect(titleOf(storeB, 'row1')).toBe(merged);
  });

  it('keeps writing the properties mirror a consumer reads', () => {
    typeTitle(storeA, 'row1', 'Ship it');

    expect(mirrorOf(storeA, 'row1')).toBe('Ship it');
    expect((dataOf(storeA, 'row1').properties as Record<string, string>)['p-status']).toBe('o1');
  });

  it('reads the title of a row saved before the top-level key existed', () => {
    storeA = createStore();
    storeA.fromJSON([databaseBlock(), legacyRowBlock('Old row')]);

    const tool = rowToolFrom(storeA, 'row1');

    expect(tool.getProperties()[TITLE_PROP]).toBe('Old row');
    expect(tool.getTitle()).toBeUndefined();
  });

  it('does not promote a row saved before the top-level key existed', () => {
    storeA = createStore();
    storeA.fromJSON([databaseBlock(), legacyRowBlock('Old row')]);

    // Loading the row and saving it back — a block flush with no user edit.
    const tool = rowToolFrom(storeA, 'row1');

    flushSave(storeA, 'row1', tool);

    expect(dataOf(storeA, 'row1')).not.toHaveProperty('title');
    expect(storedDataValue(storeA, 'row1', 'title')).toBeUndefined();
    expect(mirrorOf(storeA, 'row1')).toBe('Old row');
  });

  it('stores a brand-new row title as a Y.Text', () => {
    expect(storedDataValue(storeA, 'row1', 'title')).toBeInstanceOf(Y.Text);
    expect(storedDataValue(storeB, 'row1', 'title')).toBeInstanceOf(Y.Text);
  });

  it('mints a Y.Text the first time someone types into an old row title', () => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
    storeA.fromJSON([databaseBlock(), legacyRowBlock('Old row')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    typeTitle(storeA, 'row1', 'Old row edited');

    expect(storedDataValue(storeA, 'row1', 'title')).toBeInstanceOf(Y.Text);

    sync(storeA, storeB);

    expect(storedDataValue(storeB, 'row1', 'title')).toBeInstanceOf(Y.Text);
    expect(titleOf(storeB, 'row1')).toBe('Old row edited');
  });

  it('keeps merging a row that arrived from a peer and is then typed into', () => {
    // storeB only ever saw row1 over the wire.
    typeTitle(storeB, 'row1', 'Ship the release now');

    expect(storedDataValue(storeB, 'row1', 'title')).toBeInstanceOf(Y.Text);

    typeTitle(storeA, 'row1', 'Please ship the release');
    sync(storeA, storeB);

    expect(titleOf(storeA, 'row1')).toContain('now');
    expect(titleOf(storeA, 'row1')).toContain('Please');
  });

  it('keeps a row value written while the other person moves the row', () => {
    storeA.updateBlockData('row1', 'properties', { [TITLE_PROP]: 'Ship the release', 'p-status': 'o2' });
    storeB.updateBlockData('row1', 'position', 'a5');

    sync(storeA, storeB);

    expect((dataOf(storeA, 'row1').properties as Record<string, string>)['p-status']).toBe('o2');
    expect(dataOf(storeA, 'row1').position).toBe('a5');
  });

  it('keeps a value written into a column the other person is deleting', () => {
    storeB.updateBlockData('row1', 'properties', { [TITLE_PROP]: 'Ship the release', 'p-status': 'o1', 'p-note': 'important' });
    storeA.updateBlockData('db1', 'schema', baseSchema().filter((p) => p.id !== 'p-status'));

    sync(storeA, storeB);

    expect((dataOf(storeA, 'row1').properties as Record<string, string>)['p-note']).toBe('important');
  });
});

describe('database — a card lands in a group the other person is removing', () => {
  it('still shows a row whose group the other person deleted', () => {
    const model = new DatabaseModel({ schema: baseSchema(), views: [], activeViewId: '' });

    // The peer moved this card into 'Doing' — it arrives after the delete.
    model.setRows([{ id: 'r1', position: 'a0', properties: { 'p-status': 'o2' } }]);
    model.updateProperty('p-status', { config: { options: [option('o1', 'Todo', 'a0'), option('o3', 'Done', 'a2')] } });

    // What renderBoardView draws: one group per remaining select option.
    const groups = model.getRowsGroupedBy('p-status');
    const rendered = model
      .getSelectOptions('p-status')
      .flatMap((o) => groups.get(o.id) ?? []);

    expect(rendered.map((r) => r.id)).toContain('r1');
  });
});

describe('database — backend load racing a live edit', () => {
  it('keeps a column added while the backend load was still in flight', async () => {
    const model = new DatabaseModel({ schema: baseSchema(), views: [], activeViewId: '' });
    const backendSchema = baseSchema();

    // The load started before this column existed.
    model.addProperty('Owner', 'text');
    model.hydrate({ schema: backendSchema });

    expect(model.getSchema().map((p) => p.name)).toContain('Owner');
  });
});

describe('database — text values typed by two people at once', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);

    storeA.fromJSON([databaseBlock()]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps both bursts when two people type in the database title', () => {
    storeA.updateBlockData('db1', 'title', 'Tasks for AAA');
    storeB.updateBlockData('db1', 'title', 'BBB Tasks');

    sync(storeA, storeB);

    const title = dataOf(storeA, 'db1').title as string;

    expect(title).toContain('AAA');
    expect(title).toContain('BBB');
  });
});
