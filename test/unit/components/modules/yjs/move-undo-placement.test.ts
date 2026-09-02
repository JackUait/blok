import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { YjsManager } from '../../../../../src/components/modules/yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { BlockChangeEvent, BlockPlacement } from '../../../../../src/components/modules/yjs/types';

/**
 * Placement-based move undo/redo (Task 6): the move stacks record
 * {parentId, afterId} placements, not flat indices, so replay survives
 * concurrent remote edits that shift flat indices.
 */
const createYjsManager = (): YjsManager => {
  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  return new YjsManager({
    config: {},
    eventsDispatcher,
  });
};

const paragraph = (
  id: string,
  text: string,
  extra: { parent?: string; content?: string[] } = {}
): { id: string; type: string; data: { text: string }; parent?: string; content?: string[] } => ({
  id,
  type: 'paragraph',
  data: { text },
  ...extra,
});

describe('placement-based move undo/redo', () => {
  let manager: YjsManager;
  let peer: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createYjsManager();
    peer = new DocumentStore(new YBlockSerializer());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sync the peer up to the manager's current state. */
  const syncPeerFromManager = (): void => {
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate());
  };

  /** Apply the peer's concurrent changes to the manager via the seam. */
  const applyPeerChangesToManager = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));
  };

  const orderedIds = (): string[] => manager.toJSON().map((block) => block.id ?? '');

  describe('remote index-shifting interleave (acceptance)', () => {
    it('undo lands the block after its original sibling even after a remote insert shifted flat indices', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
        paragraph('b4', 'four'),
      ]);
      syncPeerFromManager();

      // Local move: b4 leaves its slot after b3 and lands after b1.
      manager.moveBlock('b4', 1);
      expect(orderedIds()).toEqual(['b1', 'b4', 'b2', 'b3']);

      // Concurrent remote inserts at the head shift every flat index by 2.
      peer.addBlock(paragraph('r1', 'remote one'), 0);
      peer.addBlock(paragraph('r2', 'remote two'), 1);
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['r1', 'r2', 'b1', 'b4', 'b2', 'b3']);

      manager.undo();

      // Neighbor identity, not index: b4 must sit right after b3, at root.
      const ids = orderedIds();

      expect(ids.indexOf('b4')).toBe(ids.indexOf('b3') + 1);
      expect(manager.toJSON().find((block) => block.id === 'b4')?.parent).toBeUndefined();
      expect(ids).toEqual(['r1', 'r2', 'b1', 'b2', 'b3', 'b4']);
    });

    it('redo lands the block after its target sibling even after a remote insert shifted flat indices', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
        paragraph('b4', 'four'),
      ]);
      syncPeerFromManager();

      // Local move (b4 → after b1), then undo it back.
      manager.moveBlock('b4', 1);
      manager.undo();
      expect(orderedIds()).toEqual(['b1', 'b2', 'b3', 'b4']);

      // Remote inserts at the head shift flat indices before the redo.
      peer.addBlock(paragraph('r1', 'remote one'), 0);
      peer.addBlock(paragraph('r2', 'remote two'), 1);
      applyPeerChangesToManager();

      manager.redo();

      const ids = orderedIds();

      expect(ids.indexOf('b4')).toBe(ids.indexOf('b1') + 1);
      expect(ids).toEqual(['r1', 'r2', 'b1', 'b4', 'b2', 'b3']);
    });
  });

  describe('degradation laws (undo direction)', () => {
    it('appends to the original parent when the recorded sibling was remotely deleted', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
        paragraph('b4', 'four'),
      ]);
      syncPeerFromManager();

      // b4's recorded from-placement points after b3.
      manager.moveBlock('b4', 1);

      // The sibling the undo would restore after dies remotely.
      peer.removeBlock('b3');
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['b1', 'b4', 'b2']);

      manager.undo();

      // Missing afterId → append to the parent's order array (root here).
      expect(orderedIds()).toEqual(['b1', 'b2', 'b4']);
    });

    it('keeps the block in the doc as an orphan when the recorded parent was remotely deleted', () => {
      manager.fromJSON([
        paragraph('r', 'root'),
        paragraph('p', 'parent', { content: ['c1', 'c2', 'c3'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
        paragraph('c3', 'child three', { parent: 'p' }),
      ]);
      syncPeerFromManager();

      // Same-parent move inside p: c3 leaves its slot after c2 and becomes
      // p's first child (flat index 2 = right after p).
      manager.moveBlock('c3', 2);
      expect(orderedIds()).toEqual(['r', 'p', 'c3', 'c1', 'c2']);

      // The parent the undo would restore into dies remotely; its children
      // become orphans (they keep the dangling parentId).
      peer.removeBlock('p');
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['r', 'c1', 'c2', 'c3']);

      expect(() => manager.undo()).not.toThrow();

      // Orphan tolerance: c3 stays in the doc (rendered at the end among the
      // sorted orphans), still claiming its dead parent.
      expect(orderedIds()).toEqual(['r', 'c1', 'c2', 'c3']);
      expect(manager.toJSON().find((block) => block.id === 'c3')?.parent).toBe('p');
    });
  });

  describe('degradation laws (redo direction)', () => {
    it('appends to the target parent when the recorded sibling was remotely deleted', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
        paragraph('b4', 'four'),
      ]);
      syncPeerFromManager();

      // b1's recorded to-placement points after b3.
      manager.moveBlock('b1', 2);
      expect(orderedIds()).toEqual(['b2', 'b3', 'b1', 'b4']);

      manager.undo();
      expect(orderedIds()).toEqual(['b1', 'b2', 'b3', 'b4']);

      // The sibling the redo would restore after dies remotely.
      peer.removeBlock('b3');
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['b1', 'b2', 'b4']);

      manager.redo();

      // Missing afterId → append to the parent's order array (root here).
      expect(orderedIds()).toEqual(['b2', 'b4', 'b1']);
    });

    it('keeps the block in the doc as an orphan when the target parent was remotely deleted', () => {
      manager.fromJSON([
        paragraph('r', 'root'),
        paragraph('p', 'parent', { content: ['c1', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
      ]);
      syncPeerFromManager();

      // Same-parent move inside p: c2 becomes p's first child.
      manager.moveBlock('c2', 2);
      expect(orderedIds()).toEqual(['r', 'p', 'c2', 'c1']);

      manager.undo();
      expect(orderedIds()).toEqual(['r', 'p', 'c1', 'c2']);

      // The parent the redo would restore into dies remotely; its children
      // become orphans (they keep the dangling parentId).
      peer.removeBlock('p');
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['r', 'c1', 'c2']);

      // The redo entry is consumed, not skipped — the degraded placement is
      // what the replay produced, not a no-op.
      expect(manager.canRedo()).toBe(true);
      expect(() => manager.redo()).not.toThrow();
      expect(manager.canRedo()).toBe(false);

      // Orphan tolerance: c2 stays in the doc (rendered at the end among the
      // sorted orphans), still claiming its dead parent.
      expect(orderedIds()).toEqual(['r', 'c1', 'c2']);
      expect(manager.toJSON().find((block) => block.id === 'c2')?.parent).toBe('p');
    });
  });

  describe('drag-reparent placement recording', () => {
    const placementOf = (id: string): BlockPlacement => {
      const placement = manager.getBlockPlacement(id);

      if (placement === null) {
        throw new Error(`block ${id} has no placement`);
      }

      return placement;
    };

    it('undoes a parent-only entry to the exact recorded slot, not the parent first slot', () => {
      manager.fromJSON([
        paragraph('p', 'parent', { content: ['c1', 'x', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('x', 'moved', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
        paragraph('q', 'root tail'),
      ]);
      expect(orderedIds()).toEqual(['p', 'c1', 'x', 'c2', 'q']);

      // Drag-style reparent with no prior flat move (same-slot reparent):
      // the capture point reads the from-placement BEFORE the write.
      manager.transactMoves(() => {
        const from = placementOf('x');
        const to: BlockPlacement = { parentId: null, afterId: 'p' };

        manager.applyBlockPlacement('x', to, { capture: false });
        manager.recordParentChangeForPendingMove('x', from, to);
      }, true);
      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x', 'q']);

      manager.undo();

      // x returns BETWEEN c1 and c2 — the Wave 2 flat-index stacks landed
      // parent-only entries at the parent's FIRST slot ([p, x, c1, c2, q]).
      expect(orderedIds()).toEqual(['p', 'c1', 'x', 'c2', 'q']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBe('p');

      manager.redo();

      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x', 'q']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBeUndefined();
    });

    it('keeps the pre-drag from-placement when a reparent follows a flat move (first write wins)', () => {
      manager.fromJSON([
        paragraph('x', 'moved'),
        paragraph('p', 'parent', { content: ['c1', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
      ]);
      expect(orderedIds()).toEqual(['x', 'p', 'c1', 'c2']);

      // Drag flow: the flat move records the entry (with the true pre-drag
      // from-placement), then the reparent merges into it.
      manager.transactMoves(() => {
        manager.moveBlock('x', 3);

        const midDragFrom = placementOf('x');
        const to: BlockPlacement = { parentId: 'p', afterId: 'c2' };

        manager.applyBlockPlacement('x', to, { capture: false });
        manager.recordParentChangeForPendingMove('x', midDragFrom, to);
      }, true);
      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x']);

      manager.undo();

      // The entry's from side is the PRE-DRAG placement (root, first slot) —
      // not the mid-drag one the reparent capture saw.
      expect(orderedIds()).toEqual(['x', 'p', 'c1', 'c2']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBeUndefined();

      manager.redo();

      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBe('p');
    });
  });

  describe('replay event profile', () => {
    let store: DocumentStore;
    let observer: BlockObserver;
    let events: BlockChangeEvent[];

    beforeEach(() => {
      store = new DocumentStore(new YBlockSerializer());
      observer = new BlockObserver();
      observer.observe(
        { blocksMap: store.blocksMap, rootOrder: store.rootOrder },
        new Y.UndoManager(store.undoScope, {
          captureTimeout: 500,
          trackedOrigins: new Set(['local']),
        })
      );
      events = [];
      observer.onBlocksChanged((event) => events.push(event));
    });

    afterEach(() => {
      observer.destroy();
    });

    it('applyPlacement with an agreeing parentId emits ONLY a move (never an update)', () => {
      // The replay's visible pass depends on this: a spurious parentId item
      // would emit an 'update' whose undo-origin handling re-runs setData on
      // the block mid-replay.
      store.fromJSON([
        paragraph('p', 'parent', { content: ['c1', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
      ]);

      events.length = 0;
      store.applyPlacement('c2', { parentId: 'p', afterId: null }, 'move-undo');

      expect(events).toEqual([{ type: 'move', blockId: 'c2', origin: 'undo' }]);
    });

    it('applyPlacement to root with an already-absent parentId key emits ONLY a move', () => {
      store.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
      ]);

      events.length = 0;
      store.applyPlacement('b1', { parentId: null, afterId: 'b2' }, 'move-redo');

      expect(events).toEqual([{ type: 'move', blockId: 'b1', origin: 'redo' }]);
    });
  });
});
