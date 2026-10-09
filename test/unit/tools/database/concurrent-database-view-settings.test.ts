import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as Y from 'yjs';

import { DocumentStore, captureDataKeySnapshot } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { resolveCalculations, resolveViewProperties, withCalculation, withPropertyOrder, withPropertySetting } from '../../../../src/tools/database/view-settings';

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

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
];

const viewsOf = (store: DocumentStore): DatabaseViewConfig[] =>
  ((store.toJSON().find((block) => block.id === 'db1')?.data ?? {}).views ?? []) as DatabaseViewConfig[];

/** A view as the model writes it today: born with `properties` and `calculations`. */
const bornView = (): DatabaseViewConfig => {
  const model = new DatabaseModel({ schema, views: [], activeViewId: '' }, { defaultViewType: 'table' });

  return { ...model.getViews()[0], id: 'v1' };
};

/** A view as v1.16.1 wrote it. */
const legacyView = (): DatabaseViewConfig =>
  ({ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] });

/** Each peer writes the whole views list, the way the database block saves. */
const edit = (store: DocumentStore, change: (view: DatabaseViewConfig) => Partial<DatabaseViewConfig>): void => {
  const views = viewsOf(store);

  store.updateBlockData('db1', 'views', views.map((view) => ({ ...view, ...change(view) })));
};

const seed = (view: DatabaseViewConfig): [DocumentStore, DocumentStore] => {
  const storeA = createStore();
  const storeB = createStore();

  pinClientId(storeA, 1);
  pinClientId(storeB, 2);
  storeA.fromJSON([{ id: 'db1', type: 'database', data: { title: 'Tasks', schema, views: [view], activeViewId: 'v1' } }]);
  storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

  return [storeA, storeB];
};

const widths = (store: DocumentStore): Record<string, number | undefined> =>
  Object.fromEntries(resolveViewProperties(viewsOf(store)[0], schema).map((p) => [p.id, p.width]));

describe('database view settings — two peers editing one view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both widths when two people resize different columns at the same moment', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ properties: withPropertySetting(view, schema, 'p-status', { width: 180 }) }));
    edit(storeB, (view) => ({ properties: withPropertySetting(view, schema, 'p-due', { width: 240 }) }));
    sync(storeA, storeB);

    expect(widths(storeA)).toMatchObject({ 'p-status': 180, 'p-due': 240 });
    expect(widths(storeB)).toEqual(widths(storeA));
  });

  it('keeps a width set while the other person moves a column', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ properties: withPropertyOrder(view, schema, 'p-due', 'p-status') }));
    edit(storeB, (view) => ({ properties: withPropertySetting(view, schema, 'p-status', { width: 300 }) }));
    sync(storeA, storeB);

    expect(resolveViewProperties(viewsOf(storeA)[0], schema).map((p) => p.id)).toEqual(['p-title', 'p-due', 'p-status']);
    expect(widths(storeA)['p-status']).toBe(300);
  });

  it('keeps both calculations when two people add the first one at the same moment', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ calculations: withCalculation(view, 'p-status', 'count_values') }));
    edit(storeB, (view) => ({ calculations: withCalculation(view, 'p-due', 'earliest_date') }));
    sync(storeA, storeB);

    expect([...resolveCalculations(viewsOf(storeA)[0], schema)]).toEqual(expect.arrayContaining([
      ['p-status', 'count_values'],
      ['p-due', 'earliest_date'],
    ]));
    expect(viewsOf(storeB)[0].calculations).toEqual(viewsOf(storeA)[0].calculations);
  });

  it('settles on one calculation when two people pick one for the same column', () => {
    const [storeA, storeB] = seed(bornView());

    edit(storeA, (view) => ({ calculations: withCalculation(view, 'p-due', 'latest_date') }));
    edit(storeB, (view) => ({ calculations: withCalculation(view, 'p-due', 'earliest_date') }));
    sync(storeA, storeB);

    const onA = resolveCalculations(viewsOf(storeA)[0], schema);

    expect(onA.size).toBe(1);
    expect(resolveCalculations(viewsOf(storeB)[0], schema)).toEqual(onA);
  });

  // Known gap: a view saved before `properties` existed has no key to merge
  // into, so two first writes race on creating it.
  it.fails('keeps both widths on a view written before properties existed', () => {
    const [storeA, storeB] = seed(legacyView());

    edit(storeA, (view) => ({ properties: withPropertySetting(view, schema, 'p-status', { width: 180 }) }));
    edit(storeB, (view) => ({ properties: withPropertySetting(view, schema, 'p-due', { width: 240 }) }));
    sync(storeA, storeB);

    expect(widths(storeA)).toMatchObject({ 'p-status': 180, 'p-due': 240 });
  });

  /**
   * A toolbox insert leaves only `{ initialView }` in the document until the
   * author's save lands, and every client that renders it saves its own
   * default schema and view. Those must be the same, or the id-keyed lists
   * merge into two title columns and two views.
   */
  it('gives every client that fills in a seeded insert the same schema and view', () => {
    const storeA = createStore();
    const storeB = createStore();

    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
    storeA.fromJSON([{ id: 'db1', type: 'database', data: { initialView: 'table' } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    const fill = (): ReturnType<DatabaseModel['snapshot']> =>
      new DatabaseModel({ initialView: 'table' }, { defaultViewType: 'table', idSeed: 'db1' }).snapshot();
    const ydataOf = (store: DocumentStore): Y.Map<unknown> => {
      const ydata = store.getBlockById('db1')?.get('data');

      if (!(ydata instanceof Y.Map)) {
        throw new Error('db1 has no data map');
      }

      return ydata;
    };

    // B starts its save while it still sees only the seed; A's save lands first.
    const seenByB = captureDataKeySnapshot(ydataOf(storeB));
    const fromA = fill();

    storeA.updateBlockData('db1', 'schema', fromA.schema);
    storeA.updateBlockData('db1', 'views', fromA.views);
    sync(storeA, storeB);

    const fromB = fill();

    storeB.updateBlockData('db1', 'schema', fromB.schema, seenByB);
    storeB.updateBlockData('db1', 'views', fromB.views, seenByB);
    sync(storeA, storeB);

    const data = storeA.toJSON().find((block) => block.id === 'db1')?.data as { schema: PropertyDefinition[]; views: DatabaseViewConfig[] };

    expect(data.schema.filter((p) => p.type === 'title')).toHaveLength(1);
    expect(data.views).toHaveLength(1);
    expect(storeB.toJSON()).toEqual(storeA.toJSON());
  });
});
