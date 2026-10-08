import { describe, it, expect, beforeEach } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

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

const dateOf = (store: DocumentStore): unknown =>
  (store.toJSON().find((block) => block.id === 'row1')?.data.properties as Record<string, unknown>)['p-date'];

/**
 * A range is one string, not a {start, end} object: the serializer merges an
 * object per key, so one peer moving the start and another moving the end
 * would end as a range neither picked, with end before start.
 */
describe('database date range — two peers set one cell at the same moment', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
    storeA.fromJSON([
      { id: 'row1', type: 'database-row', data: { position: 'a0', properties: { 'p-date': '2026-10-01/2026-10-05' } } },
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('ends with one range a peer picked, never a mix of both', () => {
    const picked = [
      '2026-10-10/2026-10-12',
      '2026-09-01/2026-09-03',
    ];

    storeA.updateBlockData('row1', 'properties', { 'p-date': picked[0] });
    storeB.updateBlockData('row1', 'properties', { 'p-date': picked[1] });
    sync(storeA, storeB);

    expect(dateOf(storeA)).toEqual(dateOf(storeB));
    expect(picked).toContainEqual(dateOf(storeA));
  });

  it('never mixes one peer moving the start with another moving the end', () => {
    const picked = [
      '2026-10-04/2026-10-05',
      '2026-10-01/2026-10-02',
    ];

    storeA.updateBlockData('row1', 'properties', { 'p-date': picked[0] });
    storeB.updateBlockData('row1', 'properties', { 'p-date': picked[1] });
    sync(storeA, storeB);

    expect(dateOf(storeA)).toEqual(dateOf(storeB));
    expect(picked).toContainEqual(dateOf(storeA));
  });
});
