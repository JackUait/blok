/**
 * Lineage/epoch reset (Phase 3, task C4).
 *
 * The room was reset server-side, so our history no longer belongs to it. The
 * ONE thing that must never happen is "discard local state" implemented as
 * `fromJSON([])`: that keeps the CRDT history, so the stale items merge straight
 * back into the reset room and re-poison it. The reset therefore swaps in a
 * genuinely FRESH Y.Doc, and everything bound at construction — the undo
 * manager, the block observer, the seam's update handlers, the Awareness — has
 * to be rebuilt around it.
 */
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';
import type { BlokConfig } from '../../../../../types';

const stores: DocumentStore[] = [];

/** A tracked store, torn down by the shared afterEach. */
const createStore = (): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  stores.push(store);

  return store;
};

const createManager = (): YjsManager => {
  const config: BlokConfig = {};
  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  return new YjsManager({ config, eventsDispatcher });
};

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

/** The client ids a document's state vector accounts for. */
const clientsIn = (stateVector: Uint8Array): number[] =>
  Array.from(Y.decodeStateVector(stateVector).keys());

/** The block ids an encoded update materialises in a peer that has never seen it. */
const idsCarriedBy = (update: Uint8Array): (string | undefined)[] => {
  const virgin = createStore();

  virgin.applyRemoteUpdate(update, { source: 'virgin-peer' });

  return virgin.toJSON().map((block) => block.id);
};

describe('lineage reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('DocumentStore.resetForRelineage', () => {
    it('swaps in a document with a different client id', () => {
      const store = createStore();

      store.addBlock(paragraph('b1', 'before'));

      const before = clientsIn(store.getStateVector());

      store.resetForRelineage();
      store.addBlock(paragraph('b2', 'after'));

      const after = clientsIn(store.getStateVector());

      expect(before).toHaveLength(1);
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before[0]);
    });

    it('carries none of the pre-reset history in encodeStateAsUpdate', () => {
      const store = createStore();

      store.addBlock(paragraph('b1', 'stale history'));
      store.resetForRelineage();

      expect(store.toJSON()).toEqual([]);
      expect(idsCarriedBy(store.encodeStateAsUpdate())).toEqual([]);
      expect(clientsIn(store.getStateVector())).toEqual([]);
    });

    it('points the observable roots at the fresh document', () => {
      const store = createStore();
      const oldBlocksMap = store.blocksMap;
      const oldRootOrder = store.rootOrder;

      store.resetForRelineage();

      expect(store.blocksMap).not.toBe(oldBlocksMap);
      expect(store.rootOrder).not.toBe(oldRootOrder);
      expect(store.blocksMap.doc).toBe(store.rootOrder.doc);
      expect(store.blocksMap.doc).not.toBe(oldBlocksMap.doc);

      store.addBlock(paragraph('b1', 'fresh'));

      expect(store.blocksMap.has('b1')).toBe(true);
      expect(store.rootOrder.toArray()).toEqual(['b1']);
      expect(store.undoScope).toEqual([store.blocksMap, store.rootOrder]);
    });

    it('re-attaches the seam update handlers to the fresh document', () => {
      const store = createStore();
      const updates: Uint8Array[] = [];
      const unsubscribe = store.onUpdate((update) => updates.push(update));

      store.resetForRelineage();
      store.addBlock(paragraph('b1', 'after the swap'));

      expect(updates).toHaveLength(1);

      unsubscribe();
      store.addBlock(paragraph('b2', 'after the unsubscribe'));

      expect(updates).toHaveLength(1);
    });

    it('still suppresses the echo of a remote update after the reset', () => {
      const store = createStore();
      const peer = createStore();
      const origin = { provider: 'test' };
      const updates: Uint8Array[] = [];

      store.onUpdate((update) => updates.push(update));
      store.resetForRelineage();

      peer.addBlock(paragraph('p1', 'from the reset room'));
      store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()), origin);

      expect(store.toJSON().map((block) => block.id)).toEqual(['p1']);
      expect(updates).toEqual([]);
    });

    it('recreates awareness when it was enabled, with a new client id', () => {
      const store = createStore();

      store.enableAwareness();
      store.setAwarenessField('user', { name: 'Ada' });

      const before = Array.from(store.getAwarenessStates().keys());

      store.resetForRelineage();

      const after = Array.from(store.getAwarenessStates().keys());

      expect(before).toHaveLength(1);
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before[0]);
      expect(store.getAwarenessStates().get(after[0])).toEqual({ user: { name: 'Ada' } });
      expect(() => store.encodeAwarenessUpdate()).not.toThrow();
    });

    it('leaves awareness OFF when it was never enabled', () => {
      const store = createStore();

      store.resetForRelineage();

      expect(store.getAwarenessStates().size).toBe(0);
      expect(() => store.encodeAwarenessUpdate()).toThrow(/awareness not enabled/);
    });

    it('converges with a fresh peer carrying none of its own pre-reset content', () => {
      const store = createStore();
      const room = createStore();

      store.addBlock(paragraph('old-1', 'poison'));
      store.addBlock(paragraph('old-2', 'more poison'));
      room.addBlock(paragraph('room-1', 'the reset room'));

      store.resetForRelineage();

      // Exactly the exchange a fresh connection performs: our state vector out,
      // the room's diff back, then our answer to the room's SyncStep1.
      store.applyRemoteUpdate(room.encodeStateAsUpdate(store.getStateVector()), { source: 'room' });
      room.applyRemoteUpdate(store.encodeStateAsUpdate(room.getStateVector()), { source: 'client' });

      expect(store.toJSON().map((block) => block.id)).toEqual(['room-1']);
      expect(room.toJSON().map((block) => block.id)).toEqual(['room-1']);
    });
  });

  describe('YjsManager.resetForRelineage', () => {
    it('flushes buffered typing writes BEFORE the swap, and lands none in the fresh doc', () => {
      vi.useFakeTimers();

      try {
        const manager = createManager();
        const flushes: ReadonlyMap<string, unknown>[] = [];
        const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
          flushes.push(new Map(entries));

          return Array.from(entries).reduce(
            (wrote, [key, value]) => manager.updateBlockData('b1', key, value) || wrote,
            false
          );
        };

        manager.addBlock(paragraph('b1', 'a'));
        // Leading edge dispatches at once; the second enqueue coalesces into the
        // window's pending map and would otherwise land 400ms later.
        manager.enqueueBlockDataWrite('b1', { text: 'b' }, flush);
        manager.enqueueBlockDataWrite('b1', { text: 'c' }, flush);

        expect(flushes).toHaveLength(1);

        manager.resetForRelineage();

        expect(flushes).toHaveLength(2);
        expect(manager.toJSON()).toEqual([]);

        vi.advanceTimersByTime(2000);

        expect(flushes).toHaveLength(2);
        expect(manager.toJSON()).toEqual([]);

        manager.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('empties the undo history', () => {
      const manager = createManager();

      manager.addBlock(paragraph('b1', 'one'));
      manager.updateBlockData('b1', 'text', 'two');

      expect(manager.canUndo()).toBe(true);

      manager.resetForRelineage();

      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
      expect(manager.toJSON()).toEqual([]);

      manager.destroy();
    });

    it('keeps block-change subscribers and re-observes the fresh document', () => {
      const manager = createManager();
      const peer = createStore();
      const events: BlockChangeEvent[] = [];

      manager.onBlocksChanged((event) => events.push(event));
      manager.addBlock(paragraph('b1', 'pre-reset'));
      manager.resetForRelineage();

      events.length = 0;
      peer.addBlock(paragraph('p1', 'post-reset remote'));
      manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()), { source: 'room' });

      expect(events).toContainEqual({ type: 'add', blockId: 'p1', origin: 'remote' });

      manager.destroy();
    });

    it('rebinds the observer to the NEW undo manager, so a post-reset undo is classified as undo', () => {
      const manager = createManager();
      const events: BlockChangeEvent[] = [];

      manager.resetForRelineage();
      manager.onBlocksChanged((event) => events.push(event));

      manager.addBlock(paragraph('b1', 'local'));
      events.length = 0;
      manager.undo();

      expect(manager.toJSON()).toEqual([]);
      expect(events).toContainEqual({ type: 'remove', blockId: 'b1', origin: 'undo' });

      manager.destroy();
    });

    it('keeps a seam subscription alive across the reset', () => {
      const manager = createManager();
      const updates: Uint8Array[] = [];

      manager.onDocUpdate((update) => updates.push(update));
      manager.resetForRelineage();
      manager.addBlock(paragraph('b1', 'after'));

      expect(updates).toHaveLength(1);

      manager.destroy();
    });

    it('transmits no pre-reset history through the seam', () => {
      const manager = createManager();

      manager.addBlock(paragraph('secret', 'history nobody may resend'));
      manager.resetForRelineage();

      expect(idsCarriedBy(manager.encodeStateAsUpdate())).toEqual([]);
      expect(clientsIn(manager.getStateVector())).toEqual([]);

      manager.destroy();
    });

    it('recreates awareness through the manager seam when it was enabled', () => {
      const manager = createManager();

      manager.enableAwareness();
      manager.setAwarenessField('user', { name: 'Grace' });

      const before = Array.from(manager.getAwarenessStates().keys());

      manager.resetForRelineage();

      const after = Array.from(manager.getAwarenessStates().keys());

      expect(after[0]).not.toBe(before[0]);
      expect(manager.getAwarenessStates().get(after[0])).toEqual({ user: { name: 'Grace' } });

      manager.destroy();
    });

    it('lands no stale typing in the fresh doc when the reset runs INSIDE a flush body', () => {
      vi.useFakeTimers();

      try {
        const manager = createManager();
        const room = createStore();
        const localWritesAfterReset: unknown[] = [];
        const flushInto = (blockId: string) => (entries: ReadonlyMap<string, unknown>): boolean =>
          Array.from(entries).reduce(
            (wrote, [key, value]) => manager.updateBlockData(blockId, key, value) || wrote,
            false
          );

        manager.addBlock(paragraph('b1', 'a'));
        manager.addBlock(paragraph('b2', 'x'));
        // b1: leading write, then a pending trailing write with its timer armed.
        manager.enqueueBlockDataWrite('b1', { text: 'b' }, flushInto('b1'));
        manager.enqueueBlockDataWrite('b1', { text: 'c' }, flushInto('b1'));

        // b2's leading flush performs the reset from inside the dispatch,
        // where the buffer's own flushAll barrier is a no-op.
        manager.enqueueBlockDataWrite('b2', { text: 'y' }, (entries) => {
          const wrote = flushInto('b2')(entries);

          manager.resetForRelineage();

          return wrote;
        });

        manager.onDocUpdate((update) => localWritesAfterReset.push(update));

        // The reset room re-seeds the same block id through the ordinary sync path.
        room.addBlock(paragraph('b1', 'from the reset room'));
        manager.applyRemoteUpdate(room.encodeStateAsUpdate(), { source: 'room' });

        vi.advanceTimersByTime(2000);

        expect(localWritesAfterReset).toEqual([]);
        expect(manager.toJSON()).toEqual([paragraph('b1', 'from the reset room')]);

        manager.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
