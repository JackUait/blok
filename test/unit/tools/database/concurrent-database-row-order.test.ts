import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];

const viewsOf = (store: DocumentStore): DatabaseViewConfig[] =>
  ((store.toJSON().find((block) => block.id === 'db1')?.data ?? {}).views ?? []) as DatabaseViewConfig[];

/** Each peer writes the whole views list, the way the database block saves. */
const edit = (store: DocumentStore, change: (view: DatabaseViewConfig) => Partial<DatabaseViewConfig>): void => {
  store.updateBlockData('db1', 'views', viewsOf(store).map((view) => (view.id === 'v2' ? { ...view, ...change(view) } : view)));
};

const seed = (): [DocumentStore, DocumentStore] => {
  const storeA = createStore();
  const storeB = createStore();
  const views: DatabaseViewConfig[] = [
    { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
    { id: 'v2', name: 'Gallery', type: 'gallery', position: 'a1', sorts: [], filters: [], visibleProperties: [], rowOrder: { r1: 'a0', r2: 'a1', r3: 'a2' } },
  ];

  pinClientId(storeA, 1);
  pinClientId(storeB, 2);
  storeA.fromJSON([{ id: 'db1', type: 'database', data: { title: 'Tasks', schema, views, activeViewId: 'v1' } }]);
  storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

  return [storeA, storeB];
};

describe('a view\'s own row order — two peers reordering at once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both moves when two people drag different rows in the same view', () => {
    const [storeA, storeB] = seed();

    edit(storeA, (view) => ({ rowOrder: { ...view.rowOrder, r3: 'Zz' } }));
    edit(storeB, (view) => ({ rowOrder: { ...view.rowOrder, r1: 'a5' } }));
    sync(storeA, storeB);

    const expected = { r1: 'a5', r2: 'a1', r3: 'Zz' };

    expect(viewsOf(storeA).find((view) => view.id === 'v2')?.rowOrder).toEqual(expected);
    expect(viewsOf(storeB).find((view) => view.id === 'v2')?.rowOrder).toEqual(expected);
  });
});
