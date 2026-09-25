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
      manager.moveBlockTo('b4', { parentId: null, afterId: 'b1' });
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
      manager.moveBlockTo('b4', { parentId: null, afterId: 'b1' });
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
      manager.moveBlockTo('b4', { parentId: null, afterId: 'b1' });

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
      // p's first child.
      manager.moveBlockTo('c3', { parentId: 'p', afterId: null });
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
      manager.moveBlockTo('b1', { parentId: null, afterId: 'b3' });
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
      manager.moveBlockTo('c2', { parentId: 'p', afterId: null });
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

    it('keeps the pre-drag from-placement when a reparent follows a flat move', () => {
      manager.fromJSON([
        paragraph('x', 'moved'),
        paragraph('p', 'parent', { content: ['c1', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
      ]);
      expect(orderedIds()).toEqual(['x', 'p', 'c1', 'c2']);

      // Drag flow: the flat move records the entry (with the true pre-drag
      // from-placement), then the reparent records its own entry.
      manager.transactMoves(() => {
        manager.moveBlockTo('x', { parentId: null, afterId: 'p' });

        const midDragFrom = placementOf('x');
        const to: BlockPlacement = { parentId: 'p', afterId: 'c2' };

        manager.applyBlockPlacement('x', to, { capture: false });
        manager.recordParentChangeForPendingMove('x', midDragFrom, to);
      }, true);
      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x']);

      manager.undo();

      // Replaying both entries in reverse ends on the PRE-DRAG placement
      // (root, first slot), not the mid-drag one the reparent capture saw.
      expect(orderedIds()).toEqual(['x', 'p', 'c1', 'c2']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBeUndefined();

      manager.redo();

      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBe('p');
    });

    it('undoes a two-block drag into a container back to the exact prior order', () => {
      manager.fromJSON([
        paragraph('a', 'before'),
        paragraph('m1', 'first moved'),
        paragraph('m2', 'second moved'),
        paragraph('z', 'after'),
        paragraph('box', 'container', { content: ['k1', 'k2'] }),
        paragraph('k1', 'kid one', { parent: 'box' }),
        paragraph('k2', 'kid two', { parent: 'box' }),
      ]);
      const before = orderedIds();

      // Drag flow: flat moves first, then each block is reparented. The
      // reparents come AFTER the other block's flat move.
      manager.transactMoves(() => {
        manager.moveBlockTo('m2', { parentId: null, afterId: 'box' });
        manager.moveBlockTo('m1', { parentId: null, afterId: 'box' });

        for (const [id, afterId] of [['m1', 'k1'], ['m2', 'm1']] as const) {
          const from = placementOf(id);
          const to: BlockPlacement = { parentId: 'box', afterId };

          manager.applyBlockPlacement(id, to, { capture: false });
          manager.recordParentChangeForPendingMove(id, from, to);
        }
      }, true);
      const after = orderedIds();

      expect(after).toEqual(['a', 'z', 'box', 'k1', 'm1', 'm2', 'k2']);

      manager.undo();

      expect(orderedIds()).toEqual(before);

      manager.redo();

      expect(orderedIds()).toEqual(after);
    });

    it('redoes a two-block adoption group, not just its first entry', () => {
      manager.fromJSON([
        paragraph('hdr', 'Section'),
        paragraph('p1', 'first'),
        paragraph('p2', 'second'),
      ]);

      // Toggle-heading section adoption: each sibling's from-placement is read
      // right before ITS OWN write, so p2's is the one left by p1's move.
      manager.transactMoves(() => {
        let afterId: string | null = null;

        for (const id of ['p1', 'p2']) {
          const from = placementOf(id);
          const to: BlockPlacement = { parentId: 'hdr', afterId };

          manager.applyBlockPlacement(id, to, { capture: false });
          manager.recordParentChangeForPendingMove(id, from, to);
          afterId = id;
        }
      });
      expect(orderedIds()).toEqual(['hdr', 'p1', 'p2']);
      expect(manager.toJSON().find((block) => block.id === 'p2')?.parent).toBe('hdr');

      manager.undo();

      expect(manager.toJSON().find((block) => block.id === 'p1')?.parent).toBeUndefined();
      expect(manager.toJSON().find((block) => block.id === 'p2')?.parent).toBeUndefined();

      manager.redo();

      expect(manager.toJSON().find((block) => block.id === 'p1')?.parent).toBe('hdr');
      expect(manager.toJSON().find((block) => block.id === 'p2')?.parent).toBe('hdr');
    });
  });

  describe('undo of a delete made before a move', () => {
    const rawRootOrder = (): string[] => {
      const reader = new DocumentStore(new YBlockSerializer());

      reader.applyRemoteUpdate(manager.encodeStateAsUpdate());

      return reader.rootOrder.toArray();
    };

    it('puts the block back where it was after its right neighbour moved away and back', () => {
      manager.fromJSON([
        paragraph('a', 'one'),
        paragraph('b', 'two'),
        paragraph('c', 'three'),
      ]);

      manager.removeBlock('b');
      manager.stopCapturing();
      manager.moveBlockTo('c', { parentId: null, afterId: null });
      expect(orderedIds()).toEqual(['c', 'a']);

      manager.undo();
      manager.undo();

      expect(orderedIds()).toEqual(['a', 'b', 'c']);
      expect(rawRootOrder()).toEqual(['a', 'b', 'c']);

      manager.redo();

      // Peers get the raw order array: no id may be left behind in it.
      expect(orderedIds()).toEqual(['a', 'c']);
      expect(rawRootOrder()).toEqual(['a', 'c']);

      manager.undo();

      expect(orderedIds()).toEqual(['a', 'b', 'c']);
      expect(rawRootOrder()).toEqual(['a', 'b', 'c']);
    });

    it('puts several blocks deleted together back in their order', () => {
      manager.fromJSON([
        paragraph('a', 'one'),
        paragraph('b1', 'two'),
        paragraph('b2', 'three'),
        paragraph('c', 'four'),
      ]);

      manager.transact(() => {
        manager.removeBlock('b1');
        manager.removeBlock('b2');
      });
      manager.stopCapturing();
      manager.moveBlockTo('c', { parentId: null, afterId: null });

      manager.undo();
      manager.undo();

      expect(orderedIds()).toEqual(['a', 'b1', 'b2', 'c']);
      expect(rawRootOrder()).toEqual(['a', 'b1', 'b2', 'c']);
    });

    // Deleting a container lifts its child into its place in the same step.
    it('does not anchor a deleted block on a child the same delete lifted', () => {
      manager.fromJSON([
        paragraph('box', 'box', { content: ['kid'] }),
        paragraph('kid', 'kid', { parent: 'box' }),
        paragraph('c', 'after'),
      ]);

      manager.transact(() => {
        manager.applyBlockPlacement('kid', { parentId: null, afterId: null });
        manager.removeBlock('box');
      });
      manager.stopCapturing();
      expect(orderedIds()).toEqual(['kid', 'c']);

      manager.undo();

      expect(orderedIds()).toEqual(['box', 'kid', 'c']);
      expect(rawRootOrder()).toEqual(['box', 'c']);
    });
  });

  describe('placement API (moveBlockTo / addBlockAt)', () => {
    it('undo and redo of a moveBlockTo survive a remote insert that shifted flat indices', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
        paragraph('b4', 'four'),
      ]);
      syncPeerFromManager();

      manager.moveBlockTo('b4', { parentId: null, afterId: 'b1' });
      expect(orderedIds()).toEqual(['b1', 'b4', 'b2', 'b3']);

      peer.addBlock(paragraph('r1', 'remote one'), 0);
      applyPeerChangesToManager();

      manager.undo();
      expect(orderedIds()).toEqual(['r1', 'b1', 'b2', 'b3', 'b4']);

      manager.redo();
      expect(orderedIds()).toEqual(['r1', 'b1', 'b4', 'b2', 'b3']);
    });

    it('one undo reverses a cross-parent moveBlockTo: parent and slot together', () => {
      manager.fromJSON([
        paragraph('p', 'parent', { content: ['c1', 'c2'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('c2', 'child two', { parent: 'p' }),
        paragraph('x', 'moved'),
      ]);

      manager.moveBlockTo('x', { parentId: 'p', afterId: 'c1' });
      expect(orderedIds()).toEqual(['p', 'c1', 'x', 'c2']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBe('p');

      manager.undo();
      expect(orderedIds()).toEqual(['p', 'c1', 'c2', 'x']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBeUndefined();
      expect(manager.canUndo()).toBe(false);

      manager.redo();
      expect(orderedIds()).toEqual(['p', 'c1', 'x', 'c2']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBe('p');
    });

    it('undo restores a block whose moveBlockTo was refused as a cycle', () => {
      manager.fromJSON([
        paragraph('outer', 'outer', { content: ['inner'] }),
        paragraph('inner', 'inner', { parent: 'outer' }),
        paragraph('tail', 'tail'),
      ]);

      manager.moveBlockTo('outer', { parentId: 'inner', afterId: null });

      expect(orderedIds()).toEqual(['outer', 'inner', 'tail']);
      expect(manager.toJSON().find((block) => block.id === 'outer')?.parent).toBeUndefined();
      expect(manager.canUndo()).toBe(false);
    });

    it('an undo whose recorded parent became a descendant leaves the block in place', () => {
      manager.fromJSON([
        paragraph('p', 'parent', { content: ['x'] }),
        paragraph('x', 'moved', { parent: 'p' }),
        paragraph('t', 'tail'),
        paragraph('u', 'last'),
      ]);
      syncPeerFromManager();

      manager.moveBlockTo('x', { parentId: null, afterId: 't' });
      expect(orderedIds()).toEqual(['p', 't', 'x', 'u']);

      // The peer nests p under x without moving x, so the undo still runs
      // and restoring x under p would close a cycle.
      peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));
      peer.applyPlacement('p', { parentId: 'x', afterId: null }, 'local');
      applyPeerChangesToManager();
      expect(orderedIds()).toEqual(['t', 'x', 'p', 'u']);

      manager.undo();

      expect(orderedIds()).toEqual(['t', 'x', 'p', 'u']);
      expect(manager.toJSON().find((block) => block.id === 'x')?.parent).toBeUndefined();
    });

    it('redo lands where the move actually landed, not on a missing anchor', () => {
      manager.fromJSON([
        paragraph('a', 'a'),
        paragraph('b', 'b'),
        paragraph('c', 'c'),
      ]);
      syncPeerFromManager();

      // A missing anchor appends: a lands after c.
      manager.moveBlockTo('a', { parentId: null, afterId: 'gone' });
      expect(orderedIds()).toEqual(['b', 'c', 'a']);

      manager.undo();
      expect(orderedIds()).toEqual(['a', 'b', 'c']);

      peer.addBlock(paragraph('r', 'remote'));
      applyPeerChangesToManager();

      manager.redo();

      // Same as the index API: a goes back after c, not after r.
      expect(orderedIds()).toEqual(['b', 'c', 'a', 'r']);
    });

    it('a moveBlockTo anchored after the block itself records nothing', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
      ]);

      manager.moveBlockTo('b1', { parentId: null, afterId: 'b1' });

      expect(manager.canUndo()).toBe(false);
      expect(orderedIds()).toEqual(['b1', 'b2']);
    });

    it('a moveBlockTo to the placement the block already holds records nothing', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
      ]);

      manager.moveBlockTo('b2', { parentId: null, afterId: 'b1' });

      expect(manager.canUndo()).toBe(false);
    });

    it('moveBlockTo calls inside one move group undo together', () => {
      manager.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
      ]);

      manager.transactMoves(() => {
        manager.moveBlockTo('b3', { parentId: null, afterId: null });
        manager.moveBlockTo('b2', { parentId: null, afterId: 'b3' });
      });
      expect(orderedIds()).toEqual(['b3', 'b2', 'b1']);

      manager.undo();
      expect(orderedIds()).toEqual(['b1', 'b2', 'b3']);
    });

    it('addBlockAt is one undo step that removes the block, and redo puts it back in place', () => {
      manager.fromJSON([
        paragraph('p', 'parent', { content: ['c1'] }),
        paragraph('c1', 'child one', { parent: 'p' }),
        paragraph('r', 'root'),
      ]);

      manager.addBlockAt(paragraph('x', 'added'), { parentId: 'p', afterId: null });
      expect(orderedIds()).toEqual(['p', 'x', 'c1', 'r']);

      manager.undo();
      expect(orderedIds()).toEqual(['p', 'c1', 'r']);

      manager.redo();
      expect(orderedIds()).toEqual(['p', 'x', 'c1', 'r']);
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

    it('a same-parent moveBlockTo emits ONLY a local move', () => {
      store.fromJSON([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
      ]);

      events.length = 0;
      store.moveBlockTo('b1', { parentId: null, afterId: 'b2' });

      expect(events).toEqual([{ type: 'move', blockId: 'b1', origin: 'local' }]);
    });

    it('a cross-parent moveBlockTo emits a local move AND a local update (the parentId write)', () => {
      store.fromJSON([
        paragraph('p', 'parent'),
        paragraph('x', 'moved'),
      ]);

      events.length = 0;
      store.moveBlockTo('x', { parentId: 'p', afterId: null });

      expect(events).toEqual([
        { type: 'move', blockId: 'x', origin: 'local' },
        { type: 'update', blockId: 'x', origin: 'local' },
      ]);
    });
  });
});
