import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Two things the structural repair in `DocumentStore.reconcileStructure`
 * stands on, and neither is visible from the repair's own tests:
 *
 * 1. a yjs INTERNAL the tombstone probe reads, pinned here so a dependency
 *    bump that moves it fails loudly instead of silently;
 * 2. the repair converging — applying the same update twice, and two peers
 *    repairing the same damage on their own, must not stack.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string): YjsOutputBlockData => ({ id,
  type: 'paragraph',
  data: { text } });

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const twoPeers = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

/**
 * `DocumentStore.isTombstonedBlock` asks yjs a question yjs has no public API
 * for: was this map key DELETED, or has this peer simply never seen it? It
 * answers by reading `Y.Map`'s internal key index (`_map`), where a deleted
 * key keeps its Item — marked deleted — while a never-set key has no Item.
 *
 * MEASURED ON yjs 13.6.32. `_map` is declared on the publicly exported
 * `AbstractType`, so a version that REMOVES it breaks the build. The risk this
 * file exists for is the quieter one: a version that keeps `_map` but changes
 * what it holds for a deleted key. The probe would not throw — it would start
 * answering "never seen" for everything, and the ghost-id repair (a deleted
 * block's id left forever in a container's `content`) would go inert with no
 * test failing and nothing in any log.
 *
 * IF A TEST HERE FAILS AFTER A DEPENDENCY BUMP: `isTombstonedBlock` needs
 * rewriting, and the tombstone half of the structural repair is inert until
 * it is. Do not delete these — re-measure and re-pin.
 */
describe('yjs internal that DocumentStore.isTombstonedBlock depends on (pinned at yjs 13.6.32)', () => {
  const keyIndexEntry = (map: Y.Map<unknown>, key: string): { deleted: boolean } | undefined =>
    map._map.get(key);

  it('keeps a DELETED map key in the internal key index, marked deleted', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<unknown>('blocks');

    doc.transact(() => {
      blocks.set('x', new Y.Map<unknown>());
    });
    doc.transact(() => {
      blocks.delete('x');
    });

    expect(keyIndexEntry(blocks, 'x')?.deleted).toBe(true);
    expect(blocks.has('x')).toBe(false);
  });

  it('holds NO key-index entry for a key that was never set', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<unknown>('blocks');

    expect(keyIndexEntry(blocks, 'never-written')).toBeUndefined();
  });

  it('marks a key NOT deleted once a peer concurrently re-adds it', () => {
    const owner = new Y.Doc();
    const peer = new Y.Doc();

    owner.transact(() => {
      owner.getMap<unknown>('blocks').set('x', new Y.Map<unknown>());
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(owner));

    // Concurrent: the delete and the re-add are made against the same state.
    owner.transact(() => {
      owner.getMap<unknown>('blocks').delete('x');
    });
    peer.transact(() => {
      peer.getMap<unknown>('blocks').set('x', new Y.Map<unknown>());
    });
    Y.applyUpdate(owner, Y.encodeStateAsUpdate(peer));

    const blocks = owner.getMap<unknown>('blocks');

    expect(keyIndexEntry(blocks, 'x')?.deleted).toBe(false);
    expect(blocks.has('x')).toBe(true);
  });

  /**
   * Garbage collection is the other way this could have rotted quietly: yjs
   * runs it by default and collapses a deleted item's CONTENT. It does not
   * drop the key-index entry, so a tombstone stays readable for the life of
   * the document — including on a peer that only ever loads the collected
   * state.
   */
  it('keeps the tombstone after garbage collection, on a peer that only loads the collected state', () => {
    const owner = new Y.Doc();
    const blocks = owner.getMap<unknown>('blocks');

    expect(owner.gc).toBe(true);

    owner.transact(() => {
      blocks.set('x', new Y.Map<unknown>());
    });
    owner.transact(() => {
      blocks.delete('x');
    });
    Y.tryGc(Y.createDeleteSetFromStructStore(owner.store), owner.store, () => true);

    const loader = new Y.Doc();

    Y.applyUpdate(loader, Y.encodeStateAsUpdate(owner));

    expect(keyIndexEntry(loader.getMap<unknown>('blocks'), 'x')?.deleted).toBe(true);
  });
});

describe('structural repair — converges instead of stacking', () => {
  it('changes nothing when the same remote update is applied twice', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);

    a.moveBlock('b3', 0);
    b.moveBlock('b3', 1);

    const updateForA = b.encodeStateAsUpdate(a.getStateVector());

    a.applyRemoteUpdate(updateForA);

    const order = a.rootOrder.toArray();
    const json = a.toJSON();

    a.applyRemoteUpdate(updateForA);

    expect(a.rootOrder.toArray()).toEqual(order);
    expect(a.toJSON()).toEqual(json);
  });

  /**
   * Each peer repairs its own copy and the repair is never broadcast, but a
   * later full exchange still carries it — so each peer meets the other's
   * repair. Deletes are idempotent; a re-attach is a fresh item per peer, and
   * the duplicate that makes is what the compaction pass takes back out.
   */
  it('reaches the same document on both peers, and stays there, when each repaired a duplicated drag alone', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);

    a.moveBlock('b3', 0);
    b.moveBlock('b3', 1);

    sync(a, b);
    sync(a, b);

    expect(a.rootOrder.toArray()).toEqual(b.rootOrder.toArray());
    expect(a.toJSON()).toEqual(b.toJSON());

    const settled = a.rootOrder.toArray();

    sync(a, b);

    expect(a.rootOrder.toArray()).toEqual(settled);
    expect(b.rootOrder.toArray()).toEqual(settled);
  });

  /**
   * The re-attach half: both peers put the same block back into the root
   * order on their own, each with their OWN Yjs item. Exchanging those must
   * settle on ONE entry, not two.
   */
  it('settles on one root entry when both peers re-attach a block whose parent was deleted', () => {
    const a = createStore();
    const b = createStore();

    pinClientId(a, 1);
    pinClientId(b, 2);
    a.fromJSON([
      { id: 'C',
        type: 'toggle',
        data: {},
        content: [] },
      paragraph('X', 'ex'),
      paragraph('tail', 'tail'),
    ]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    a.applyPlacement('X', { parentId: 'C',
      afterId: null }, 'local');
    b.removeBlock('C');

    sync(a, b);
    sync(a, b);

    expect(a.rootOrder.toArray().filter((id) => id === 'X')).toHaveLength(1);
    expect(a.rootOrder.toArray()).toEqual(b.rootOrder.toArray());
    expect(a.toJSON()).toEqual(b.toJSON());

    const settled = a.rootOrder.toArray();

    sync(a, b);

    expect(a.rootOrder.toArray()).toEqual(settled);
    expect(b.rootOrder.toArray()).toEqual(settled);
  });
});
