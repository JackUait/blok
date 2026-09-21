import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import {
  DocumentStore,
  captureDataKeySnapshot,
  type DataKeySnapshot,
} from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { PropertyDefinition, SelectOption, DatabaseViewConfig } from '../../../../src/tools/database/types';

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

const viewsOf = (store: DocumentStore, id: string): DatabaseViewConfig[] =>
  (dataOf(store, id).views ?? []) as DatabaseViewConfig[];

const optionsOf = (store: DocumentStore, id: string, propertyId: string): SelectOption[] =>
  schemaOf(store, id).find((p) => p.id === propertyId)?.config?.options ?? [];

const option = (id: string, label: string, position: string): SelectOption => ({ id, label, position });

const baseSchema = (): PropertyDefinition[] => [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'select',
    position: 'a1',
    config: { options: [option('o1', 'Todo', 'a0'), option('o2', 'Doing', 'a1')] },
  },
];

const baseViews = (): DatabaseViewConfig[] => [
  { id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', sorts: [], filters: [], visibleProperties: [] },
];

const databaseBlock = (): { id: string; type: string; data: Record<string, unknown> } => ({
  id: 'db1',
  type: 'database',
  data: { title: 'Tasks', schema: baseSchema(), views: baseViews(), activeViewId: 'v1' },
});

/**
 * What BlockManager.syncBlockDataToYjs captures BEFORE `block.save()` runs:
 * every nested container's key set, so the flush that lands a coalescing
 * window later may not delete a key that arrived from a peer in between.
 */
const snapshotOf = (store: DocumentStore, id: string): DataKeySnapshot => {
  const ydata = store.getBlockById(id)?.get('data');

  if (!(ydata instanceof Y.Map)) {
    throw new Error(`block ${id} has no data map`);
  }

  return captureDataKeySnapshot(ydata);
};

describe('database — a save in flight while a peer adds to the schema', () => {
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

  it('keeps a column a peer added while this save was in flight', () => {
    // A starts a save: the snapshot is taken, then save() is awaited.
    const seen = snapshotOf(storeA, 'db1');

    // B's column lands in A's document during that window.
    storeB.updateBlockData('db1', 'schema', [
      ...baseSchema(),
      { id: 'pB', name: 'Owner', type: 'text', position: 'a2' } as PropertyDefinition,
    ]);
    storeA.applyRemoteUpdate(storeB.encodeStateAsUpdate(storeA.getStateVector()));

    // A's flush writes the payload captured BEFORE 'pB' existed — a rename of
    // its own column, nothing to do with B's.
    const stale = baseSchema();

    stale[0].name = 'Task';
    storeA.updateBlockData('db1', 'schema', stale, seen);

    expect(schemaOf(storeA, 'db1').map((p) => p.id)).toContain('pB');
    expect(schemaOf(storeA, 'db1').find((p) => p.id === 'p-title')?.name).toBe('Task');
  });

  it('keeps a board column a peer added while this save was in flight', () => {
    const seen = snapshotOf(storeA, 'db1');

    const withOption = baseSchema();

    withOption[1].config = { options: [...baseSchema()[1].config!.options, option('oB', 'From B', 'a2')] };
    storeB.updateBlockData('db1', 'schema', withOption);
    storeA.applyRemoteUpdate(storeB.encodeStateAsUpdate(storeA.getStateVector()));

    const stale = baseSchema();

    stale[1].config = { options: [option('o1', 'Backlog', 'a0'), option('o2', 'Doing', 'a1')] };
    storeA.updateBlockData('db1', 'schema', stale, seen);

    expect(optionsOf(storeA, 'db1', 'p-status').map((o) => o.id)).toContain('oB');
  });

  it('keeps a view a peer added while this save was in flight', () => {
    const seen = snapshotOf(storeA, 'db1');

    storeB.updateBlockData('db1', 'views', [
      ...baseViews(),
      { id: 'vB', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: [] } as DatabaseViewConfig,
    ]);
    storeA.applyRemoteUpdate(storeB.encodeStateAsUpdate(storeA.getStateVector()));

    const stale = baseViews();

    stale[0].name = 'Kanban';
    storeA.updateBlockData('db1', 'views', stale, seen);

    expect(viewsOf(storeA, 'db1').map((v) => v.id)).toContain('vB');
  });

  it('keeps a row a peer added to a table while this save was in flight', () => {
    // The same walk for a grid (a table's rows), one shape further in.
    storeA.fromJSON([{ id: 't1', type: 'table', data: { content: [['a'], ['b']] } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    const seen = snapshotOf(storeA, 't1');

    storeB.updateBlockData('t1', 'content', [['a'], ['b'], ['c']]);
    storeA.applyRemoteUpdate(storeB.encodeStateAsUpdate(storeA.getStateVector()));

    storeA.updateBlockData('t1', 'content', [['a'], ['edited']], seen);

    expect(dataOf(storeA, 't1').content).toContainEqual(['c']);
  });

  /**
   * The control for the three failures above: `deepAssignYMap` DOES consult
   * the snapshot, so a plain nested map spares a key it never saw. Identity
   * wrappers (`schema`, `views`, a select's `options`) and grid wrappers
   * (a table's rows) delete by absence alone.
   */
  it('keeps a row value a peer wrote while this save was in flight', () => {
    storeA.fromJSON([
      databaseBlock(),
      { id: 'row1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Ship it' } } },
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    const seen = snapshotOf(storeA, 'row1');

    storeB.updateBlockData('row1', 'properties', { 'p-title': 'Ship it', 'p-status': 'o2' });
    storeA.applyRemoteUpdate(storeB.encodeStateAsUpdate(storeA.getStateVector()));

    storeA.updateBlockData('row1', 'properties', { 'p-title': 'Ship it now' }, seen);

    expect((dataOf(storeA, 'row1').properties as Record<string, string>)['p-status']).toBe('o2');
  });
});

describe('database — two peers filtering one view at the same moment', () => {
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

  it('keeps both filters when two people filter one view at the same moment', () => {
    const withFilter = (value: string): DatabaseViewConfig[] => {
      const views = baseViews();

      views[0].filters = [{ propertyId: 'p-status', operator: 'is', value }];

      return views;
    };

    storeA.updateBlockData('db1', 'views', withFilter('o1'));
    storeB.updateBlockData('db1', 'views', withFilter('o2'));

    sync(storeA, storeB);

    const values = viewsOf(storeA, 'db1')[0].filters.map((f) => f.value);

    expect(values).toContain('o1');
    expect(values).toContain('o2');
  });

  it('keeps both sorts when two people sort one view at the same moment', () => {
    const withSort = (propertyId: string): DatabaseViewConfig[] => {
      const views = baseViews();

      views[0].sorts = [{ propertyId, direction: 'asc' }];

      return views;
    };

    storeA.updateBlockData('db1', 'views', withSort('p-title'));
    storeB.updateBlockData('db1', 'views', withSort('p-status'));

    sync(storeA, storeB);

    const ids = viewsOf(storeA, 'db1')[0].sorts.map((s) => s.propertyId);

    expect(ids).toContain('p-title');
    expect(ids).toContain('p-status');
  });

  /**
   * The control: the loss above is the BIRTH of the array, not the diff. A
   * view is created with `filters: []`, and an empty array is stored as a
   * plain leaf — so each peer's first filter `set`s a whole fresh Y.Array
   * over the key and the later set wins. Once the array exists, two more
   * concurrent filters merge as two inserts.
   */
  it('keeps both filters added to a view that already carries one', () => {
    const seeded = baseViews();

    seeded[0].filters = [{ propertyId: 'p-title', operator: 'is', value: 'seed' }];
    storeA.updateBlockData('db1', 'views', seeded);
    sync(storeA, storeB);

    const plus = (value: string): DatabaseViewConfig[] => {
      const views = baseViews();

      views[0].filters = [...seeded[0].filters, { propertyId: 'p-status', operator: 'is', value }];

      return views;
    };

    storeA.updateBlockData('db1', 'views', plus('o1'));
    storeB.updateBlockData('db1', 'views', plus('o2'));

    sync(storeA, storeB);

    const values = viewsOf(storeA, 'db1')[0].filters.map((f) => f.value);

    expect(values).toContain('o1');
    expect(values).toContain('o2');
  });
});
