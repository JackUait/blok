import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import type * as LoggerModule from '../../../../../src/components/utils/logger';

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();

  return { ...actual, logLabeled: vi.fn() };
});

import { logLabeled } from '../../../../../src/components/utils/logger';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { LOCAL_ORIGIN_TAGS, type BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';

/**
 * Several mutants here can only be seen through the two catch blocks: the one
 * that guards event classification and the one that guards subscriber calls.
 * Both swallow the throw, so the log call is the only evidence a mutant
 * produced one.
 */
const logged = (): number => vi.mocked(logLabeled).mock.calls.length;

/**
 * The Y.Array a block stores its child ids in, typed back from `unknown`.
 * Reaching it is what makes the "is this array order or content?" branch
 * testable without going through DocumentStore's own writers.
 */
const contentIdsOf = (blocksMap: Y.Map<Y.Map<unknown>>, id: string): Y.Array<unknown> => {
  const block = blocksMap.get(id);
  const array: unknown = block?.get('contentIds');

  if (!(array instanceof Y.Array)) {
    throw new Error(`${id} has no contentIds array`);
  }

  return array;
};

/**
 * The survivors here fall into four groups, none of which a test can reach:
 *
 * - **Switch-case mutants that land in `default`.** The default arm returns the
 *   origin value itself, so blanking `case 'local'` or `case 'load'` returns the
 *   same string, and dropping `case 'no-capture'`'s return falls through to
 *   `case 'move'`, which returns 'local' too. The `default` arm and its body are
 *   themselves unreachable: `isLocalOriginTag` gates entry and the switch is
 *   exhaustive over LOCAL_ORIGIN_TAGS. `typeof value === 'string'` forced true
 *   changes nothing either — `includes` on a non-string is false regardless.
 *
 * - **The `blocksMap === null` guards**, in `collectEvent` and in
 *   `walkToOwningBlock`. The deep observer that calls them is registered on
 *   those very roots and is detached before the fields are nulled, so no event
 *   can arrive while they are null.
 *
 * - **The "target never reached the blocks map" path**, and with it both
 *   recursion guards in `walkToOwningBlock` and the `collectEvent` catch with
 *   its two log strings. Observers sit on the blocks map and the root order
 *   only; the root order holds strings, which are never event targets, so every
 *   target's parent chain terminates at the blocks map in one step from its
 *   block. Nothing in `collectEvent` can throw for a document built through the
 *   typed API.
 *
 * - **`unobserve`'s remaining guards.** When `deepObserver` is null both roots
 *   are null too, so the extra detach call is a no-op; and once the deep
 *   observers are gone nothing fills a transaction's buckets, so an
 *   afterTransaction handler left registered dispatches nothing.
 *
 * One more survives without an equivalence proof: dropping the
 * `pendingBuckets.delete` before emitting. A subscriber that writes during
 * dispatch gets a NEW transaction, so the stale entry is never read again and
 * the WeakMap collects it — no reachable input through the public write path
 * makes it observable. The delete stays load-bearing if yjs ever delivers such
 * a write inside the original transaction, which is what it was written for.
 */
describe('BlockObserver mutants', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let blocksMap: Y.Map<Y.Map<unknown>>;
  let rootOrder: Y.Array<string>;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];

  const addBlocks = (ids: string[]): void => {
    store.transact(() => {
      ids.forEach((id) => store.addBlock({ id, type: 'paragraph', data: {} }));
    }, 'local');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    observer = new BlockObserver();
    store = new DocumentStore(new YBlockSerializer());
    blocksMap = store.blocksMap;
    rootOrder = store.rootOrder;
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });
    observer.observe({ blocksMap, rootOrder }, undoManager);
    observer.onBlocksChanged((event) => events.push(event));
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  describe('observe', () => {
    it('tolerates a scope whose map is not attached to a document', () => {
      const detached = new BlockObserver();

      expect(() => detached.observe(
        { blocksMap: new Y.Map<Y.Map<unknown>>(), rootOrder: new Y.Array<string>() },
        undoManager
      )).not.toThrow();
      expect(() => detached.unobserve()).not.toThrow();
    });

    it('does not emit through a callback list it never had', () => {
      addBlocks(['b1']);

      expect(logged()).toBe(0);
    });
  });

  describe('onBlocksChanged unsubscribe', () => {
    // The recording callback from beforeEach sits at index 0, so `first` is at
    // index 1 — the one position where "not found" and "found" are told apart
    // by the sign of the sentinel rather than by its value.
    it('removes only the callback it was handed', () => {
      const first = vi.fn();
      const second = vi.fn();

      const stopFirst = observer.onBlocksChanged(first);

      observer.onBlocksChanged(second);
      stopFirst();
      addBlocks(['b1']);

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('is inert when called twice', () => {
      const first = vi.fn();
      const second = vi.fn();

      const stopFirst = observer.onBlocksChanged(first);

      observer.onBlocksChanged(second);
      stopFirst();
      stopFirst();
      addBlocks(['b1']);

      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapTransactionOrigin', () => {
    it('maps every local origin tag', () => {
      expect(LOCAL_ORIGIN_TAGS.map((tag) => observer.mapTransactionOrigin(tag)))
        .toStrictEqual(['local', 'load', 'local', 'local', 'undo', 'redo']);
    });

    it('treats anything else as remote', () => {
      expect(observer.mapTransactionOrigin('something-else')).toBe('remote');
      expect(observer.mapTransactionOrigin(42)).toBe('remote');
      expect(observer.mapTransactionOrigin(null)).toBe('remote');
    });
  });

  describe('classification', () => {
    it('reports a replaced block map entry as an update, not a removal', () => {
      addBlocks(['b1']);
      events.length = 0;

      store.transact(() => {
        blocksMap.set('b1', new Y.Map<unknown>());
      }, 'local');

      expect(events).toStrictEqual([{ type: 'update', blockId: 'b1', origin: 'local' }]);
    });

    it('reports a bare order insertion as a move', () => {
      addBlocks(['b1', 'b2']);
      events.length = 0;

      store.transact(() => {
        rootOrder.insert(0, ['b2']);
      }, 'local');

      expect(events).toStrictEqual([{ type: 'move', blockId: 'b2', origin: 'local' }]);
    });

    it('reports a bare order deletion as a move', () => {
      addBlocks(['b1', 'b2']);
      events.length = 0;

      store.transact(() => {
        rootOrder.delete(1, 1);
      }, 'local');

      expect(events).toStrictEqual([{ type: 'move', blockId: 'b2', origin: 'local' }]);
    });

    it('ignores a non-string entry in an order array', () => {
      addBlocks(['b1']);
      events.length = 0;

      store.transact(() => {
        contentIdsOf(blocksMap, 'b1').insert(0, [42]);
      }, 'local');

      expect(events).toStrictEqual([]);
    });

    it('treats a non-contentIds array under a block as content, not order', () => {
      addBlocks(['b1']);
      events.length = 0;

      const grid = new Y.Array<string>();

      store.transact(() => {
        blocksMap.get('b1')?.set('grid', grid);
      }, 'local');
      events.length = 0;

      store.transact(() => {
        grid.insert(0, ['b1']);
      }, 'local');

      expect(events).toStrictEqual([{ type: 'update', blockId: 'b1', origin: 'local' }]);
    });

    it('treats a contentIds array nested deeper than a block as content, not order', () => {
      addBlocks(['b1']);

      const inner = new Y.Map<unknown>();
      const nested = new Y.Array<string>();

      store.transact(() => {
        const block = blocksMap.get('b1');
        const data: unknown = block?.get('data');

        if (data instanceof Y.Map) {
          data.set('inner', inner);
          inner.set('contentIds', nested);
        }
      }, 'local');
      events.length = 0;

      store.transact(() => {
        nested.insert(0, ['b1']);
      }, 'local');

      expect(events).toStrictEqual([{ type: 'update', blockId: 'b1', origin: 'local' }]);
    });

    it('drops a change whose target never reaches the blocks map', () => {
      const stray = new Y.Map<unknown>();

      store.transact(() => {
        rootOrder.insert(0, ['b0']);
      }, 'local');
      events.length = 0;

      store.transact(() => {
        blocksMap.set('holder', new Y.Map<unknown>());
        blocksMap.get('holder')?.set('nested', stray);
      }, 'local');
      events.length = 0;

      store.transact(() => {
        stray.set('x', 1);
      }, 'local');

      expect(logged()).toBe(0);
      expect(events).toStrictEqual([]);
    });

    it('ignores a block whose id is not a string', () => {
      const inner = new Y.Map<unknown>();

      store.transact(() => {
        const holder = new Y.Map<unknown>();

        blocksMap.set('idless', holder);
        holder.set('nested', inner);
      }, 'local');
      events.length = 0;

      store.transact(() => {
        inner.set('x', 1);
      }, 'local');

      expect(events).toStrictEqual([]);
    });
  });

  describe('per-transaction dispatch', () => {
    // A second entry carrying the same `id` is what makes an update and a
    // removal collide inside one transaction: deleting the block's own entry
    // suppresses its nested events, so the update has to arrive through the
    // shadow entry, which resolves to the same block id.
    it('does not also report a block removed in the same transaction as updated', () => {
      addBlocks(['b1']);

      const shadow = new Y.Map<unknown>();
      const shadowData = new Y.Map<unknown>();

      store.transact(() => {
        shadow.set('id', 'b1');
        shadow.set('data', shadowData);
        blocksMap.set('shadow', shadow);
      }, 'local');
      events.length = 0;

      store.transact(() => {
        shadowData.set('text', 'hello');
        blocksMap.delete('b1');
      }, 'local');

      expect(events).toStrictEqual([{ type: 'remove', blockId: 'b1', origin: 'local' }]);
    });

    // A subscriber may legally grow the document while its own event is being
    // delivered. Those writes join the SAME transaction, so its buckets are
    // re-filled and re-dispatched — anything still in them is emitted twice.
    it('does not re-emit the first batch when a subscriber writes during dispatch', () => {
      observer.onBlocksChanged((event) => {
        if (event.type === 'add' && event.blockId === 'b1') {
          store.addBlock({ id: 'b2', type: 'paragraph', data: {} });
        }
      });

      addBlocks(['b1']);

      expect(events).toStrictEqual([
        { type: 'add', blockId: 'b1', origin: 'local' },
        { type: 'add', blockId: 'b2', origin: 'local' },
      ]);
    });
  });

  describe('subscriber failures', () => {
    it('logs the failure and still calls the remaining subscribers', () => {
      const failure = new Error('subscriber exploded');
      const good = vi.fn();

      observer.onBlocksChanged(() => {
        throw failure;
      });
      observer.onBlocksChanged(good);
      addBlocks(['b1']);

      expect(good).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logLabeled)).toHaveBeenCalledWith('A block-change subscriber threw.', 'error', failure);
    });
  });

  describe('unobserve', () => {
    it('stops emitting', () => {
      observer.unobserve();
      addBlocks(['b1']);

      expect(events).toStrictEqual([]);
    });

    it('leaves exactly one observer behind when the document is re-attached', () => {
      observer.unobserve();
      observer.observe({ blocksMap, rootOrder }, undoManager);
      addBlocks(['b1']);

      expect(events).toStrictEqual([{ type: 'add', blockId: 'b1', origin: 'local' }]);
    });
  });

  describe('destroy', () => {
    it('detaches from the document, not just from its subscribers', () => {
      observer.destroy();

      const late = vi.fn();

      observer.onBlocksChanged(late);
      addBlocks(['b1']);

      expect(late).not.toHaveBeenCalled();
    });

    it('leaves a callback list that can be used again', () => {
      observer.destroy();

      const late = vi.fn();

      observer.onBlocksChanged(late);
      observer.observe({ blocksMap, rootOrder }, undoManager);
      addBlocks(['b1']);

      expect(late).toHaveBeenCalledTimes(1);
      expect(logged()).toBe(0);
    });
  });
});
