import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import {
  LOCAL_ORIGIN_TAGS,
  type BlockChangeEvent,
  type LocalOriginTag,
} from '../../../../../src/components/modules/yjs/types';

type SingleBlockEvent = Extract<BlockChangeEvent, { blockId: string }>;
type BatchBlockEvent = Extract<BlockChangeEvent, { blockIds: string[] }>;

const createBlockObserver = (): BlockObserver => {
  return new BlockObserver();
};

describe('BlockObserver', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let blocksMap: Y.Map<Y.Map<unknown>>;
  let rootOrder: Y.Array<string>;
  let undoManager: Y.UndoManager;

  /**
   * Add root-level paragraph blocks through the real write path
   * (DocumentStore.addBlock), all in one transaction.
   */
  const addBlocks = (ids: string[]): void => {
    store.transact(() => {
      for (const id of ids) {
        store.addBlock({ id, type: 'paragraph', data: {} });
      }
    }, 'local');
  };

  /**
   * Add one block under a parent through the real write path.
   */
  const addChild = (id: string, parent: string): void => {
    store.addBlock({ id, type: 'paragraph', data: {}, parent });
  };

  const moveBlock = (id: string, toIndex: number): void => {
    store.moveBlock(id, toIndex, 'local');
  };

  const removeBlock = (id: string): void => {
    store.removeBlock(id);
  };

  beforeEach(() => {
    observer = createBlockObserver();
    store = new DocumentStore(new YBlockSerializer());
    blocksMap = store.blocksMap;
    rootOrder = store.rootOrder;
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe({ blocksMap, rootOrder }, undoManager);
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    store.destroy();
  });

  describe('initialization', () => {
    it('creates observer without errors', () => {
      expect(observer).toBeDefined();
    });
  });

  describe('onBlocksChanged', () => {
    it('registers callback and returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = observer.onBlocksChanged(callback);

      expect(typeof unsubscribe).toBe('function');

      // Trigger an event
      addBlocks(['b1']);

      expect(callback).toHaveBeenCalled();

      // Unsubscribe
      unsubscribe();

      // Reset and trigger again
      callback.mockClear();
      addBlocks(['b2']);

      // Should not be called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });

    it('emits add event when block is added', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      addBlocks(['b1']);

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('add');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits remove event when block is removed', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      removeBlock('b1');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits move event when block is moved', () => {
      addBlocks(['b1', 'b2']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move block: root-order edit only, the Y.Map stays put
      moveBlock('b1', 1);

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('move');
      expect(event.blockId).toBe('b1');
    });

    it('emits update event when block data changes', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockData('b1', 'text', 'Updated');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });
  });

  describe('mapTransactionOrigin', () => {
    it('maps "local" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('local')).toBe('local');
    });

    it('maps "load" origin to "load"', () => {
      expect(observer.mapTransactionOrigin('load')).toBe('load');
    });

    it('maps undoManager origin to "undo" when undoing', () => {
      undoManager.undoing = true;
      expect(observer.mapTransactionOrigin(undoManager)).toBe('undo');
      undoManager.undoing = false;
    });

    it('maps undoManager origin to "redo" when not undoing', () => {
      expect(observer.mapTransactionOrigin(undoManager)).toBe('redo');
    });

    it('maps "move" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('move')).toBe('local');
    });

    it('maps "move-undo" origin to "undo"', () => {
      expect(observer.mapTransactionOrigin('move-undo')).toBe('undo');
    });

    it('maps "move-redo" origin to "redo"', () => {
      expect(observer.mapTransactionOrigin('move-redo')).toBe('redo');
    });

    // Regression: 'no-capture' is used by DocumentStore.transactWithoutCapture
    // for local auto-repair writes (e.g. Table.ensureCellHasBlock inserting a
    // placeholder paragraph after Insert Row Below). Before the fix this
    // origin fell through to the `'remote'` default, which made BlockYjsSync
    // call `Table.setData(staleYjsData)` mid-operation and clobbered the
    // just-inserted row, making the row undeletable afterwards.
    it('maps "no-capture" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('no-capture')).toBe('local');
    });

    it('maps unknown origin to "remote"', () => {
      expect(observer.mapTransactionOrigin('unknown')).toBe('remote');
    });

    // Regression guard: every tag in LOCAL_ORIGIN_TAGS must map to a
    // non-'remote' classification. If a future dev adds a new origin string
    // without teaching the mapper, this test fails in CI before the silent
    // `setData(staleYjsData)` clobber bug can reappear. See block-observer.ts
    // and the original table-row-removal regression for context.
    it('maps every LOCAL_ORIGIN_TAGS entry away from "remote"', () => {
      for (const tag of LOCAL_ORIGIN_TAGS) {
        const mapped = observer.mapTransactionOrigin(tag satisfies LocalOriginTag);

        expect(mapped, `tag "${tag}" must not fall through to "remote"`).not.toBe('remote');
      }
    });
  });

  describe('destroy', () => {
    it('clears callbacks and references', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      observer.destroy();

      // Trigger an event after destroy
      addBlocks(['b1']);

      // Callback should not be called after destroy
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('multiple callbacks', () => {
    it('calls all registered callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);

      addBlocks(['b1']);

      // Both callbacks should be called with the same event
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      // Verify the observable behavior: the document state
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');
      expect(rootOrder.toArray()).toEqual(['b1']);

      // Verify both callbacks received the same event data
      const event1 = callback1.mock.calls[0]?.[0] as SingleBlockEvent;
      const event2 = callback2.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event1.type).toBe('add');
      expect(event2.type).toBe('add');
      expect(event1.blockId).toBe('b1');
      expect(event2.blockId).toBe('b1');
    });

    it('allows unregistering individual callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);
      observer.onBlocksChanged(callback3);

      // Unsubscribe callback1
      unsubscribe1();

      addBlocks(['b1']);

      // Verify the observable behavior: the document state
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');

      // Verify callback registration/unregistration behavior
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(callback3).toHaveBeenCalled();

      // Verify the remaining callbacks received the correct event data
      const event2 = callback2.mock.calls[0]?.[0] as SingleBlockEvent;
      const event3 = callback3.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event2.type).toBe('add');
      expect(event3.type).toBe('add');
      expect(event2.blockId).toBe('b1');
      expect(event3.blockId).toBe('b1');
    });
  });

  describe('move detection edge cases', () => {
    it('emits move event for an order-array edit whose id was not added or removed', () => {
      addBlocks(['b1', 'b2', 'b3']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      moveBlock('b3', 0);

      const moveEvent = callback.mock.calls.find(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      )?.[0] as SingleBlockEvent;

      expect(moveEvent).toBeDefined();
      expect(moveEvent.type).toBe('move');
      expect(moveEvent.blockId).toBe('b3');
    });

    it('correctly handles multiple moves in a single transaction', () => {
      addBlocks(['b1', 'b2', 'b3', 'b4', 'b5']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move multiple blocks in one transaction
      store.transact(() => {
        store.moveBlock('b5', 0, 'local');
        store.moveBlock('b4', 1, 'local');
      }, 'local');

      const moveEvents = callback.mock.calls.filter(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      );

      // Should have 2 move events
      expect(moveEvents.length).toBe(2);
    });

    it('emits both move and pure add/remove in same transaction', () => {
      addBlocks(['b1', 'b2', 'b3']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move b3, add b4, remove b2 — one transaction
      store.transact(() => {
        store.moveBlock('b3', 0, 'local');
        store.addBlock({ id: 'b4', type: 'paragraph', data: {} });
        store.removeBlock('b2');
      }, 'local');

      const events = callback.mock.calls.map((call) => call[0] as BlockChangeEvent);
      const types = events.map((e) => e.type);

      // Should have move, add, and remove events
      expect(types).toContain('move');
      expect(types).toContain('add');
      expect(types).toContain('remove');

      // The moved id must not surface as an add or a remove
      const moveIds = events
        .filter((e): e is SingleBlockEvent => e.type === 'move')
        .map((e) => e.blockId);

      expect(moveIds).toEqual(['b3']);
    });

    it('emits move for an in-place contentIds reorder', () => {
      addBlocks(['parent-1']);
      addChild('child-a', 'parent-1');
      addChild('child-b', 'parent-1');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Reorder within the parent: child-b takes child-a's flat slot.
      moveBlock('child-b', store.findBlockIndex('child-a'));

      const moveEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => event.type === 'move');

      expect(moveEvents.map((event) => event.blockId)).toEqual(['child-b']);
    });
  });

  describe('top-level yblock key updates', () => {
    it('emits a remote update when a peer reparents the block (parentId key write)', () => {
      addBlocks(['callout-1', 'child-1']);

      // Second peer receives the doc through the binary seam, reparents
      // child-1, and its diff comes back as ONE remote transaction.
      const mirror = new DocumentStore(new YBlockSerializer());

      mirror.applyRemoteUpdate(store.encodeStateAsUpdate());

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      mirror.applyPlacement('child-1', { parentId: 'callout-1', afterId: null }, 'local');
      store.applyRemoteUpdate(mirror.encodeStateAsUpdate(store.getStateVector()));
      mirror.destroy();

      const updateEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => event.type === 'update');

      const childUpdate = updateEvents.find((event) => event.blockId === 'child-1');

      expect(childUpdate).toBeDefined();
      expect(childUpdate?.origin).toBe('remote');
    });

    it('emits update event when the contentIds KEY is overwritten on the yblock', () => {
      addBlocks(['toggle-1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // A raw key overwrite (plain-array contentIds) cannot be produced by
      // the store API — this pins the classification of hostile/legacy
      // shapes: a key change on the block map is an update for that block.
      store.transact(() => {
        blocksMap.get('toggle-1')?.set('contentIds', ['child-a', 'child-b']);
      }, 'local');

      const updateEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event) => event.type === 'update');

      expect(updateEvents.length).toBeGreaterThanOrEqual(1);
      const event = updateEvents[0] as SingleBlockEvent;

      expect(event.blockId).toBe('toggle-1');
    });
  });

  describe('nested map updates', () => {
    it('emits update event when tunes change', () => {
      addBlocks(['b1']);

      store.updateBlockTune('b1', 'alignment', 'left');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockTune('b1', 'alignment', 'center');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
    });
  });

  describe('owning-block resolution', () => {
    it('finds the owning block for a nested data map', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockData('b1', 'text', 'Updated');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.blockId).toBe('b1');
    });
  });

  describe('batch-add events', () => {
    it('emits batch-add when multiple blocks are added in a single transaction', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.transact(() => {
        store.addBlock({ id: 'table-1', type: 'paragraph', data: {} });
        store.addBlock({ id: 'child-1', type: 'paragraph', data: {}, parent: 'table-1' });
        store.addBlock({ id: 'child-2', type: 'paragraph', data: {}, parent: 'table-1' });
      }, 'local');

      // Should emit a single batch-add event instead of individual add events
      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0]?.[0] as BatchBlockEvent;
      expect(event.type).toBe('batch-add');
      expect(event.blockIds).toEqual(['table-1', 'child-1', 'child-2']);
    });

    it('emits regular add for a single block', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      addBlocks(['single-1']);

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('add');
      expect(event.blockId).toBe('single-1');
    });
  });

  describe('edge cases', () => {
    it('handles a block value without an id field during remove (the key IS the id)', () => {
      // Store a block whose VALUE carries no 'id' key — a shape the store
      // API cannot produce (hostile/legacy payload); the map key names it.
      store.transact(() => {
        const bare = new Y.Map<unknown>();

        bare.set('type', 'paragraph');
        bare.set('data', new Y.Map<unknown>());
        blocksMap.set('keyed-block', bare);
        rootOrder.push(['keyed-block']);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Remove the block - should not throw
      expect(() => {
        removeBlock('keyed-block');
      }).not.toThrow();

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('keyed-block');
    });

    it('emits remove with correct data after deletion', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Verify initial state - block exists
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');

      // Delete should work without errors
      removeBlock('b1');

      // Verify observable behavior: the document state after deletion
      expect(blocksMap.size).toBe(0);
      expect(rootOrder.length).toBe(0);

      // Verify the event was emitted with correct data
      expect(callback).toHaveBeenCalled();
      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('b1');
    });

    it('does not emit update for changes to unrelated maps', () => {
      // Create a separate unrelated Y.Map (never integrated into the doc)
      const unrelatedMap = new Y.Map<unknown>();
      unrelatedMap.set('key', 'value');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Modify unrelated map - should not trigger callback
      store.transact(() => {
        unrelatedMap.set('key', 'updated');
      }, 'local');

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles rapid successive changes without errors', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Rapid changes
      for (let i = 0; i < 10; i++) {
        addBlocks([`b${i}`]);
      }

      // Verify observable behavior: the document state after all changes
      expect(blocksMap.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(blocksMap.get(`b${i}`)?.get('id')).toBe(`b${i}`);
      }
      expect(rootOrder.toArray()).toEqual(
        Array.from({ length: 10 }, (_, i) => `b${i}`)
      );

      // Verify all events were emitted with correct data
      expect(callback).toHaveBeenCalledTimes(10);
      const eventTypes = callback.mock.calls.map((call) => (call[0] as BlockChangeEvent).type);
      expect(eventTypes.every((type) => type === 'add')).toBe(true);

      // Verify specific events contain correct block IDs
      const blockIds = callback.mock.calls.map((call) => {
        const event = call[0] as BlockChangeEvent;

        return event.type === 'batch-add' ? event.blockIds : [event.blockId];
      }).flat();

      for (let i = 0; i < 10; i++) {
        expect(blockIds).toContain(`b${i}`);
      }
    });
  });
});

/**
 * Emission-order CONTRACT (Task 3a pin): within ONE transaction the observer
 * emits moves → add/batch-add → removes → updates, regardless of which root
 * (blocks map or root order) each change came through. The reconciler relies
 * on this so the DOM can reposition before other changes land.
 *
 * Fixtures are built through DocumentStore APIs so the writes are the real
 * write shapes, not hand-rolled pushes.
 */
describe('BlockObserver — emission order contract', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];

  const eventTypes = (): string[] => events.map((event) => event.type);

  const singleIds = (type: 'add' | 'remove' | 'update' | 'move'): string[] =>
    events
      .filter((event): event is Extract<BlockChangeEvent, { blockId: string }> => event.type === type)
      .map((event) => event.blockId);

  beforeEach(() => {
    observer = new BlockObserver();
    store = new DocumentStore(new YBlockSerializer());
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe(
      { blocksMap: store.blocksMap, rootOrder: store.rootOrder },
      undoManager
    );

    events = [];
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    store.destroy();
  });

  const collectEvents = (): void => {
    observer.onBlocksChanged((event) => events.push(event));
  };

  it('emits moves → add → removes → updates for one transaction touching all four', () => {
    store.fromJSON([
      { id: 'b1', type: 'paragraph', data: { text: '1' } },
      { id: 'b2', type: 'paragraph', data: { text: '2' } },
      { id: 'b3', type: 'paragraph', data: { text: '3' } },
      { id: 'b4', type: 'paragraph', data: { text: '4' } },
    ]);
    collectEvents();

    store.transact(() => {
      store.moveBlock('b4', 0, 'local');
      store.addBlock({ id: 'b5', type: 'paragraph', data: { text: '5' } });
      store.removeBlock('b2');
      store.updateBlockData('b3', 'text', 'changed');
    }, 'local');

    expect(eventTypes()).toEqual(['move', 'add', 'remove', 'update']);
    expect(singleIds('move')).toEqual(['b4']);
    expect(singleIds('add')).toEqual(['b5']);
    expect(singleIds('remove')).toEqual(['b2']);
    expect(singleIds('update')).toEqual(['b3']);
  });

  it('emits the root-order move BEFORE the blocks-map add when both land in the SAME transaction', () => {
    store.fromJSON([
      { id: 'parent-1', type: 'paragraph', data: { text: 'p' } },
      { id: 'b1', type: 'paragraph', data: { text: '1' } },
      { id: 'b2', type: 'paragraph', data: { text: '2' } },
    ]);
    collectEvents();

    store.transact(() => {
      // Move comes from the ROOT ORDER array …
      store.moveBlock('b2', 0, 'local');
      // … while the add's membership goes into a parent's contentIds, so the
      // add is visible only through the blocks map.
      store.addBlock({ id: 'child-1', type: 'paragraph', data: { text: 'c' }, parent: 'parent-1' });
    }, 'local');

    expect(singleIds('move')).toEqual(['b2']);
    expect(singleIds('add')).toEqual(['child-1']);
    // Creating the parent's contentIds key is an update to the parent —
    // and it must still come AFTER the cross-dispatch move and add.
    expect(singleIds('update')).toEqual(['parent-1']);
    expect(eventTypes()).toEqual(['move', 'add', 'update']);
  });

  it('holds for root + contentIds moves, batch adds, removes, and updates combined', () => {
    store.fromJSON([
      { id: 'p1', type: 'paragraph', data: { text: 'p1' } },
      { id: 'p2', type: 'paragraph', data: { text: 'p2' } },
      { id: 'parent-1', type: 'paragraph', data: { text: 'p' }, content: ['c1', 'c2'] },
      { id: 'c1', type: 'paragraph', data: { text: 'c1' }, parent: 'parent-1' },
      { id: 'c2', type: 'paragraph', data: { text: 'c2' }, parent: 'parent-1' },
    ]);
    collectEvents();

    store.transact(() => {
      // contentIds-array move: swap c1 after c2 (flat target = c2's slot).
      store.moveBlock('c1', store.findBlockIndex('c2'), 'local');
      // Root-order move.
      store.moveBlock('p2', 0, 'local');
      // Two adds in one transaction → batch-add.
      store.addBlock({ id: 'n1', type: 'paragraph', data: { text: 'n1' } });
      store.addBlock({ id: 'n2', type: 'paragraph', data: { text: 'n2' } });
      store.removeBlock('p1');
      store.updateBlockData('c2', 'text', 'edited');
    }, 'local');

    expect(eventTypes()).toEqual(['move', 'move', 'batch-add', 'remove', 'update']);
    expect(new Set(singleIds('move'))).toEqual(new Set(['c1', 'p2']));
    expect(singleIds('remove')).toEqual(['p1']);
    expect(singleIds('update')).toEqual(['c2']);

    const batch = events.find(
      (event): event is Extract<BlockChangeEvent, { blockIds: string[] }> => event.type === 'batch-add'
    );

    expect(batch?.blockIds).toEqual(['n1', 'n2']);
  });
});
