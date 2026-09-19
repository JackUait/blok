import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * `updateBlockData` is per-key by signature, so it can set but never unset: a
 * full save() that drops a transient field (Callout's __importedText) used to
 * leave it in the shared document forever. `pruneBlockData` is the missing
 * unset, and the FULL-SAVE flush (BlockManager.flushBlockDataWrites) is its one
 * caller — the patch path takes a partial patch and must never prune.
 */
describe('collaborative data writes and removed keys', () => {
  let store: DocumentStore;
  let peer: DocumentStore;

  /** Bring `peer` up to `store`'s state, the way a first sync does. */
  const syncPeerUp = (): void => {
    peer.applyRemoteUpdate(store.encodeStateAsUpdate(peer.getStateVector()));
  };

  /** Exchange everything each side did while they were apart, both ways. */
  const exchange = (): void => {
    const fromStore = store.encodeStateAsUpdate(peer.getStateVector());
    const fromPeer = peer.encodeStateAsUpdate(store.getStateVector());

    peer.applyRemoteUpdate(fromStore);
    store.applyRemoteUpdate(fromPeer);
  };

  const dataOf = (source: DocumentStore, id: string): Record<string, unknown> | undefined =>
    source.toJSON().find(block => block.id === id)?.data;

  beforeEach(() => {
    store = new DocumentStore(new YBlockSerializer());
    peer = new DocumentStore(new YBlockSerializer());
  });

  afterEach(() => {
    store.destroy();
    peer.destroy();
  });

  it('carries a removed top-level key to a peer that edited the block meanwhile', () => {
    store.addBlock({
      id: 'callout1',
      type: 'callout',
      data: { emoji: '💡', __importedText: 'Hey. Meet the new Blok.' },
    });
    syncPeerUp();

    // Apart from here: the peer writes a key of its own, and this side runs
    // one full-save flush — write every saved key, then drop the top-level
    // keys the save no longer carries.
    peer.updateBlockData('callout1', 'title', 'Meet Blok');

    const savedData: Record<string, unknown> = { emoji: '💡' };

    for (const [key, value] of Object.entries(savedData)) {
      store.updateBlockData('callout1', key, value);
    }

    store.pruneBlockData('callout1', new Set(Object.keys(savedData)));

    // Really apart: neither has seen the other's write.
    expect(dataOf(store, 'callout1')).not.toHaveProperty('title');
    expect(dataOf(peer, 'callout1')).toHaveProperty('__importedText');

    exchange();

    // The peer's own write survives the prune, and the prune reaches the peer.
    expect(dataOf(store, 'callout1')?.title).toBe('Meet Blok');
    expect(dataOf(peer, 'callout1')?.title).toBe('Meet Blok');
    expect(dataOf(store, 'callout1')).not.toHaveProperty('__importedText');
    expect(dataOf(peer, 'callout1')).not.toHaveProperty('__importedText');
  });

  // Characterisation: the nested path deletes on its own, which is why the
  // top-level prune had to be added beside updateBlockData rather than inside it.
  it('already removes a nested sub-key the new value omits, and the peer follows', () => {
    store.addBlock({
      id: 'row1',
      type: 'database-row',
      data: { properties: { status: 'done', owner: 'kim' } },
    });
    syncPeerUp();

    peer.updateBlockData('row1', 'text', 'row one');
    store.updateBlockData('row1', 'properties', { status: 'done' });

    // Really apart: neither has seen the other's write.
    expect(dataOf(store, 'row1')).not.toHaveProperty('text');
    expect(dataOf(peer, 'row1')?.properties).toHaveProperty('owner');

    exchange();

    expect(dataOf(store, 'row1')?.text).toBe('row one');
    expect(dataOf(peer, 'row1')?.text).toBe('row one');
    expect(dataOf(store, 'row1')?.properties).not.toHaveProperty('owner');
    expect(dataOf(peer, 'row1')?.properties).not.toHaveProperty('owner');
    expect(dataOf(store, 'row1')?.properties).toHaveProperty('status', 'done');
  });
});
