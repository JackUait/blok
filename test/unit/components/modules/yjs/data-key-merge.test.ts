import { describe, it, expect, beforeEach } from 'vitest';
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

  beforeEach(() => {
    store = new DocumentStore(new YBlockSerializer());
  });

  it('removes a top-level key the new data omits', () => {
    store.addBlock({
      id: 'callout1',
      type: 'callout',
      data: { emoji: '💡', __importedText: 'Hey. Meet the new Blok.' },
    });

    // The shape of one full-save flush: write every saved key, then drop the
    // top-level keys the save no longer carries.
    const savedData: Record<string, unknown> = { emoji: '💡' };

    for (const [key, value] of Object.entries(savedData)) {
      store.updateBlockData('callout1', key, value);
    }

    store.pruneBlockData('callout1', new Set(Object.keys(savedData)));

    const block = store.toJSON().find(b => b.id === 'callout1');

    expect(block?.data).not.toHaveProperty('__importedText');
  });

  // Characterisation: the nested path deletes on its own, which is why the
  // top-level prune had to be added beside updateBlockData rather than inside it.
  it('already removes a nested sub-key the new value omits', () => {
    store.addBlock({
      id: 'row1',
      type: 'database-row',
      data: { properties: { status: 'done', owner: 'kim' } },
    });

    store.updateBlockData('row1', 'properties', { status: 'done' });

    const row = store.toJSON().find(b => b.id === 'row1');

    expect(row?.data.properties).not.toHaveProperty('owner');
  });
});
