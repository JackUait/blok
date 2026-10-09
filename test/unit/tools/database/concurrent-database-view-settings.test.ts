import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
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
});
