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
 * The number of afterTransaction listeners a document carries. `unobserve`
 * has to give its own back, and nothing it emits afterwards can show that.
 */
const afterTransactionListenersOf = (target: Y.Doc): number =>
  target._observers.get('afterTransaction')?.size ?? 0;

/**
 * The listener set a document currently holds for afterTransaction, as plain
 * values, so a freshly added one can be told from the ones already there.
 */
const afterTransactionHandlersOf = (target: Y.Doc): unknown[] =>
  [...(target._observers.get('afterTransaction') ?? [])] as unknown[];

/**
 * What is left alive on this file is alive for one of two reasons, both
 * measured: the mutated expression cannot change an answer, or the state it
 * guards cannot exist.
 *
 * - **Switch arms that fall into `default`.** The default arm returns the
 *   origin value itself, so blanking `case 'local'` or `case 'load'` returns
 *   the same string, and dropping `case 'no-capture'`'s return falls through to
 *   `case 'move'`, which returns 'local' too. The enumeration test above asserts
 *   all six results, and they hold under every one of those mutants. Forcing
 *   `typeof value === 'string'` to true changes nothing either — `includes` on
 *   a non-string is false regardless, which the "anything else is remote" test
 *   measures.
 *
 * - **The two roots are never half-null.** `observe` assigns `blocksMap` and
 *   `rootOrder` together and `unobserve` nulls them together, so
 *   `blocksMap === null || rootOrder === null` is false with both set and true
 *   with both null, whichever operand or operator a mutant replaces. The
 *   replay test below drives the both-null state — it kills the guard when the
 *   whole condition is forced false — and the operand mutants stay alive there.
 *   `walkToOwningBlock`'s own `blocksMap === null` guard is unreachable for the
 *   same reason: `collectEvent` returns before the walk when the map is null.
 *
 * - **`unobserve`'s remaining guards.** `deepObserver` is null exactly when
 *   both roots are, and `afterTransactionHandler` is null exactly when `doc`
 *   is, so forcing either guard open runs a body of optional calls that all
 *   short-circuit, and dropping the `?.` never dereferences null.
 */
describe('BlockObserver mutants', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let blocksMap: Y.Map<Y.Map<unknown>>;
  let rootOrder: Y.Array<string>;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];
  let doc: Y.Doc;
  let spare: BlockObserver[];

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
    const attachedDoc = blocksMap.doc;

    if (attachedDoc === null) {
      throw new Error("the store map is not attached to a document");
    }

    doc = attachedDoc;
    spare = [];
    observer.observe({ blocksMap, rootOrder }, undoManager);
    observer.onBlocksChanged((event) => events.push(event));
  });

  afterEach(() => {
    spare.forEach((extra) => extra.destroy());
    observer.destroy();
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  /**
   * A second observer on the same roots, plus the two callbacks it registered:
   * the deep observer yjs would call with events, and the document hook that
   * dispatches a transaction. Holding them directly is what lets a test hand
   * the observer a target from outside its roots, or one that arrives after
   * `unobserve` — inputs the public writers cannot produce.
   */
  const attach = (): {
    observer: BlockObserver;
    emitted: BlockChangeEvent[];
    deliver: (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void;
    dispatch: (transaction: Y.Transaction, target: Y.Doc) => void;
  } => {
    const fresh = new BlockObserver();
    const emitted: BlockChangeEvent[] = [];
    const before = new Set<unknown>(afterTransactionHandlersOf(doc));
    const deepSpy = vi.spyOn(blocksMap, 'observeDeep');

    spare.push(fresh);
    fresh.observe({ blocksMap, rootOrder }, undoManager);
    fresh.onBlocksChanged((event) => emitted.push(event));

    const deliver = deepSpy.mock.calls[0]?.[0];

    deepSpy.mockRestore();

    const dispatch = afterTransactionHandlersOf(doc).find((handler) => !before.has(handler));

    if (typeof deliver !== 'function' || typeof dispatch !== 'function') {
      throw new Error('BlockObserver did not register its observers');
    }

    return {
      observer: fresh,
      emitted,
      deliver,
      dispatch: dispatch as (transaction: Y.Transaction, target: Y.Doc) => void,
    };
  };

  /**
   * A change in a document the observer knows nothing about, captured as the
   * (events, transaction) pair yjs hands a deep observer. The holder map is
   * top-level, so its parent chain ends at null.
   */
  const foreignChange = (
    setUp: (holder: Y.Map<unknown>) => void,
    mutate: (holder: Y.Map<unknown>) => void
  ): { events: Y.YEvent<Y.AbstractType<unknown>>[]; transaction: Y.Transaction } => {
    const foreignDoc = new Y.Doc();
    const holder = foreignDoc.getMap<unknown>('holder');

    foreignDoc.transact(() => setUp(holder), 'local');

    const captured: Y.YEvent<Y.AbstractType<unknown>>[] = [];
    const transactions: Y.Transaction[] = [];

    // Touch `changes` while the transaction is still live: yjs computes it
    // lazily off the transaction, and a real deep observer reads it during
    // delivery, not after the document has merged the transaction away.
    holder.observeDeep((events) => {
      events.forEach((event) => event.changes);
      captured.push(...events);
    });
    foreignDoc.on('afterTransaction', (transaction) => transactions.push(transaction));
    foreignDoc.transact(() => mutate(holder), 'local');

    const transaction = transactions[transactions.length - 1];

    if (captured.length === 0 || transaction === undefined) {
      throw new Error('the foreign change produced no event');
    }

    return { events: captured, transaction };
  };

  /**
   * A real blocks-map event and its transaction, taken from an ordinary add so
   * a replay can carry something the observer must still classify.
   */
  const realBlocksMapChange = (id: string): {
    event: Y.YEvent<Y.AbstractType<unknown>>;
    transaction: Y.Transaction;
  } => {
    const captured: Y.YEvent<Y.AbstractType<unknown>>[] = [];
    const transactions: Y.Transaction[] = [];
    const collect = (incoming: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
      captured.push(...incoming.filter((event) => event.target === blocksMap));
    };
    const record = (transaction: Y.Transaction): void => {
      transactions.push(transaction);
    };

    blocksMap.observeDeep(collect);
    doc.on('afterTransaction', record);
    addBlocks([id]);
    blocksMap.unobserveDeep(collect);
    doc.off('afterTransaction', record);
    events.length = 0;

    const event = captured[0];
    const transaction = transactions[transactions.length - 1];

    if (event === undefined || transaction === undefined) {
      throw new Error('the add produced no blocks-map event');
    }

    return { event, transaction };
  };

  const afterTransactionListeners = (): number => afterTransactionListenersOf(doc);

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

  describe('events from outside the two roots', () => {
    // A target whose parent chain never reaches the blocks map must drop
    // silently. Both recursion guards in the walk are what makes it silent:
    // without them the walk dereferences `null.parent`, or `collectEvent`
    // dereferences a null block, and the transaction's catch logs.
    it('drops a target that never reaches the blocks map without logging', () => {
      const foreign = foreignChange(
        (holder) => holder.set('nested', new Y.Map<unknown>()),
        (holder) => {
          const nested = holder.get('nested');

          if (nested instanceof Y.Map) {
            nested.set('k', 'v');
          }
        }
      );
      const attached = attach();

      attached.deliver(foreign.events, foreign.transaction);
      attached.dispatch(foreign.transaction, doc);

      expect(vi.mocked(logLabeled)).not.toHaveBeenCalled();
      expect(attached.emitted).toStrictEqual([]);
    });

    // Remote payloads are untrusted: one event that throws must not cost the
    // transaction the blocks carried by the events after it.
    it('logs a throwing event and still classifies the ones after it', () => {
      const failure = new Error('hostile event');
      const hostile = {
        get target(): never {
          throw failure;
        },
      } as unknown as Y.YEvent<Y.AbstractType<unknown>>;

      const real = realBlocksMapChange('b9');
      const attached = attach();

      attached.deliver([hostile, real.event], real.transaction);
      attached.dispatch(real.transaction, doc);

      expect(vi.mocked(logLabeled)).toHaveBeenCalledWith(
        'Failed to process a document change event.',
        'error',
        failure
      );
      expect(vi.mocked(logLabeled)).toHaveBeenCalledTimes(1);
      expect(attached.emitted).toStrictEqual([{ type: 'add', blockId: 'b9', origin: 'local' }]);
    });

    // yjs hands a deep observer the listener list it captured, so an event can
    // still arrive after `unobserve` nulled the roots. Classifying it would
    // emit a move for an id this observer no longer knows anything about.
    it('ignores an order-shaped event replayed after the roots are detached', () => {
      const foreign = foreignChange(
        (holder) => holder.set('contentIds', new Y.Array<string>()),
        (holder) => {
          const contentIds = holder.get('contentIds');

          if (contentIds instanceof Y.Array) {
            contentIds.insert(0, ['x']);
          }
        }
      );
      const attached = attach();

      attached.observer.unobserve();
      attached.deliver(foreign.events, foreign.transaction);
      attached.dispatch(foreign.transaction, doc);

      expect(attached.emitted).toStrictEqual([]);
    });
  });

  describe('repeated dispatch', () => {
    // The buckets are popped before emitting, so a second delivery of the same
    // transaction has nothing left to re-emit.
    it('emits nothing when the same transaction is dispatched twice', () => {
      const seen: Y.Transaction[] = [];

      doc.on('afterTransaction', (transaction) => seen.push(transaction));
      addBlocks(['b1']);
      events.length = 0;

      const last = seen[seen.length - 1];

      doc.emit('afterTransaction', [last, doc]);

      expect(events).toStrictEqual([]);
    });
  });

  describe('unobserve listener release', () => {
    it('takes its afterTransaction listener off the document', () => {
      const before = afterTransactionListeners();
      const fresh = new BlockObserver();

      spare.push(fresh);
      fresh.observe({ blocksMap, rootOrder }, undoManager);

      const attached = afterTransactionListeners();

      fresh.unobserve();

      expect(afterTransactionListeners()).toBe(before);
      expect(attached).toBe(before + 1);
    });
  });

  describe('mapTransactionOrigin exhaustiveness', () => {
    // The `default` arm is the runtime half of the compile-time exhaustiveness
    // guard: a tag registered in LOCAL_ORIGIN_TAGS but never taught to the
    // switch comes back as itself, so the drift is visible to the caller
    // instead of arriving as `undefined`.
    it('returns a registered tag the switch does not handle', () => {
      const tags = LOCAL_ORIGIN_TAGS as unknown as string[];

      tags.push('future-tag');

      try {
        expect(observer.mapTransactionOrigin('future-tag')).toBe('future-tag');
      } finally {
        tags.pop();
      }
    });
  });
});
