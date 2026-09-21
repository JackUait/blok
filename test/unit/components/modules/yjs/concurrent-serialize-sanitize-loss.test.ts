import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/** Pin the Yjs client id so a tie between two concurrent writes resolves the same way every run. */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

/** One peer seeds, the other receives — the shape a provider produces. */
const twoPeers = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.data ?? {};

/** The live CRDT container under one top-level data key — the representation, not the read-back. */
const yValueOf = (store: DocumentStore, id: string, key: string): unknown =>
  (store.getBlockById(id)?.get('data') as Y.Map<unknown>).get(key);

type Column = { id: string; name: string };

/**
 * `plainToYValue` routes every non-array object through `objectToYMap`, which
 * walks `Object.entries`. A Date (or a Map, or a Set) has no own enumerable
 * entries, so it becomes an EMPTY Y.Map — the value is gone before the update
 * leaves the peer that wrote it.
 */
describe('a data value the serializer does not understand', () => {
  it('keeps a Date a peer stored in block data', () => {
    const when = new Date('2026-09-21T10:00:00.000Z');
    const { a, b } = twoPeers([{ id: 'card', type: 'myCard', data: { when } }]);

    expect(dataOf(b, 'card').when).not.toEqual({});
    expect(dataOf(a, 'card').when).not.toEqual({});
  });

  it('keeps a Map and a Set a peer stored in block data', () => {
    const { b } = twoPeers([{
      id: 'card',
      type: 'myCard',
      data: { tags: new Set(['red']), byId: new Map([['k', 'v']]) },
    }]);

    expect(dataOf(b, 'card').tags).not.toEqual({});
    expect(dataOf(b, 'card').byId).not.toEqual({});
  });
});

/**
 * The identity rule (`isIdentityArray`) gives a database's `schema`/`views` and
 * a select's options a KEYED wrapper so a reorder is a new order array instead
 * of delete+insert. It is a BIRTH shape only: `assignYMapEntry`/`updateBlockData`
 * drop straight back to `set(key, plainToYValue(value))` the moment one written
 * value fails the predicate — one element without a string `id` (a draft column,
 * or a legacy entry) is enough — and nothing ever promotes it back.
 */
describe('the keyed identity wrapper is one-way', () => {
  const schema = (): YjsOutputBlockData[] => [{
    id: 'db',
    type: 'database',
    data: { schema: [{ id: 'c1', name: 'Name' }, { id: 'c2', name: 'Status' }] },
  }];

  it('applies a rename to the column the peer renamed while the wrapper is intact', () => {
    const { a, b } = twoPeers(schema());

    a.updateBlockData('db', 'schema', [{ id: 'c2', name: 'Status' }, { id: 'c1', name: 'Name' }]);
    b.updateBlockData('db', 'schema', [{ id: 'c1', name: 'Renamed' }, { id: 'c2', name: 'Status' }]);
    sync(a, b);

    const columns = dataOf(a, 'db').schema as Column[];

    expect(columns.find((column) => column.id === 'c1')?.name).toBe('Renamed');
  });

  /**
   * FLOOR, not a defect that is fixed. Promoting the plain array back to the
   * wrapper on the first id-bearing write was tried and REVERTED: the
   * promotion is `set(key, plainToYValue(value))`, last-writer-wins on the
   * WHOLE array, and it fires on both peers from an ordinary save. Measured
   * with it in place: a legacy id-less `schema`, A appends `Owner` and B
   * appends `Due` concurrently → both peers converge on
   * `[Name, Status, Owner]`; B's column is gone. Element-wise diffing keeps
   * all four. Losing a whole column to recover a wrapper is a worse trade than
   * the mis-applied rename below, so the plain array stays plain.
   */
  it.fails('still applies a rename to the right column after a column was added without an id first', () => {
    const { a, b } = twoPeers(schema());

    // A draft column exists for one write before its id is minted.
    a.updateBlockData('db', 'schema', [{ id: 'c1', name: 'Name' }, { id: 'c2', name: 'Status' }, { name: 'Draft' }]);
    a.updateBlockData('db', 'schema', [{ id: 'c1', name: 'Name' }, { id: 'c2', name: 'Status' }, { id: 'c3', name: 'Draft' }]);
    sync(a, b);

    // A reorders, B renames c1 — the exact pair the identity rule exists for.
    a.updateBlockData('db', 'schema', [{ id: 'c2', name: 'Status' }, { id: 'c1', name: 'Name' }, { id: 'c3', name: 'Draft' }]);
    b.updateBlockData('db', 'schema', [{ id: 'c1', name: 'Renamed' }, { id: 'c2', name: 'Status' }, { id: 'c3', name: 'Draft' }]);
    sync(a, b);

    const columns = dataOf(a, 'db').schema as Column[];

    expect(columns.find((column) => column.id === 'c1')?.name).toBe('Renamed');
    expect(columns.find((column) => column.id === 'c2')?.name).toBe('Status');
    expect(yValueOf(a, 'db', 'schema')).toBeInstanceOf(Y.Map);
  });
});

/**
 * Two tabs of the same document boot from the same server snapshot. Each
 * editor seeds its own Y.Doc through `fromJSON` before the provider has
 * exchanged anything, so each mints its OWN block `Y.Map` under the same id.
 * `yBlocksMap.set(id, …)` is last-writer-wins, so on the first exchange one
 * peer's whole block container — with every character typed into its `Y.Text`
 * — is discarded.
 */
describe('two tabs that both seed the same document', () => {
  const seed = (): YjsOutputBlockData[] => [
    { id: 'p', type: 'paragraph', data: { text: 'seed' } },
  ];

  it.fails('keeps what both people typed before the two tabs first synced', () => {
    const a = createStore();
    const b = createStore();

    pinClientId(a, 1);
    pinClientId(b, 2);

    a.fromJSON(seed());
    b.fromJSON(seed());

    a.updateBlockData('p', 'text', 'seed from Ann');
    b.updateBlockData('p', 'text', 'seed from Bob');

    sync(a, b);

    expect(dataOf(a, 'p').text).toContain('Ann');
    expect(dataOf(a, 'p').text).toContain('Bob');
  });

  it.fails('keeps a tune only one of the two tabs wrote', () => {
    const a = createStore();
    const b = createStore();

    pinClientId(a, 1);
    pinClientId(b, 2);

    a.fromJSON(seed());
    b.fromJSON(seed());

    a.updateBlockTune('p', 'alignment', { align: 'center' });

    sync(a, b);

    expect(a.toJSON().find((block) => block.id === 'p')?.tunes?.alignment).toEqual({ align: 'center' });
  });
});
