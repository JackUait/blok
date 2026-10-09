import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

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

const viewsOf = (store: DocumentStore): DatabaseViewConfig[] =>
  (store.toJSON().find((block) => block.id === 'db1')?.data.views ?? []) as DatabaseViewConfig[];

/** A view as Blok creates it: the group lists start empty, so both peers grow one array. */
const baseViews = (): DatabaseViewConfig[] => [
  {
    id: 'v1',
    name: 'Board',
    type: 'board',
    position: 'a0',
    groupBy: 'p-status',
    sorts: [],
    filters: [],
    visibleProperties: [],
    hiddenGroups: [],
    collapsedGroups: [],
  },
];

describe('database — two peers changing per-view group state at the same moment', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);

    storeA.fromJSON([{
      id: 'db1',
      type: 'database',
      data: { title: 'Tasks', schema: [], views: baseViews(), activeViewId: 'v1' },
    }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both hidden groups when two people hide a group at once', () => {
    const hiding = (id: string): DatabaseViewConfig[] => {
      const views = baseViews();

      views[0].hiddenGroups = [{ id }];

      return views;
    };

    storeA.updateBlockData('db1', 'views', hiding('o1'));
    storeB.updateBlockData('db1', 'views', hiding('o2'));
    sync(storeA, storeB);

    const ids = (viewsOf(storeA)[0].hiddenGroups ?? []).map((g) => g.id);

    expect(ids).toContain('o1');
    expect(ids).toContain('o2');
  });

  it('keeps both collapsed groups when two people collapse a group at once', () => {
    const collapsing = (id: string): DatabaseViewConfig[] => {
      const views = baseViews();

      views[0].collapsedGroups = [{ id }];

      return views;
    };

    storeA.updateBlockData('db1', 'views', collapsing('o1'));
    storeB.updateBlockData('db1', 'views', collapsing('o2'));
    sync(storeA, storeB);

    const ids = (viewsOf(storeA)[0].collapsedGroups ?? []).map((g) => g.id);

    expect(ids).toContain('o1');
    expect(ids).toContain('o2');
  });

  it('keeps a peer\'s hidden group when this peer moves the no-value group', () => {
    const views = baseViews();

    views[0].noValueGroupPosition = 'a5';
    storeA.updateBlockData('db1', 'views', views);

    const hidden = baseViews();

    hidden[0].hiddenGroups = [{ id: 'o1' }];
    storeB.updateBlockData('db1', 'views', hidden);
    sync(storeA, storeB);

    expect(viewsOf(storeA)[0].noValueGroupPosition).toBe('a5');
    expect((viewsOf(storeA)[0].hiddenGroups ?? []).map((g) => g.id)).toEqual(['o1']);
  });
});
