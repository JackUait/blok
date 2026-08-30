import * as Y from 'yjs';

import { logLabeled } from '../../utils';
import {
  LOCAL_ORIGIN_TAGS,
  type BlockChangeEvent,
  type BlockChangeCallback,
  type LocalOriginTag,
  type TransactionOrigin,
} from './types';

/**
 * BlockObserver observes Yjs events and emits domain events.
 *
 * Responsibilities:
 * - Observes Yjs changes on the blocks array
 * - Maps transaction origins to domain origins
 * - Emits BlockChangeEvent to registered callbacks
 * - Detects and reports move operations
 */
export class BlockObserver {
  /**
   * Callbacks for block changes
   */
  private changeCallbacks: BlockChangeCallback[] = [];

  /**
   * Yjs blocks array being observed
   */
  private yblocks: Y.Array<Y.Map<unknown>> | null = null;

  /**
   * Undo manager reference (needed to detect undo/redo state)
   */
  private undoManager: Y.UndoManager | null = null;

  /**
   * Set up Yjs observers for change tracking.
   */
  public observe(yblocks: Y.Array<Y.Map<unknown>>, undoManager: Y.UndoManager): void {
    this.yblocks = yblocks;
    this.undoManager = undoManager;

    this.yblocks.observeDeep((events, transaction) => {
      const origin = this.mapTransactionOrigin(transaction.origin);
      // One transaction touching several maps of one block fires one event
      // per map; each 'update' drives a full downstream reconcile, so emit
      // at most one per block per dispatch. Never carried across dispatches.
      const emittedUpdates = new Set<string>();

      for (const event of events) {
        // One bad event (or a throwing subscriber) must not desync the rest
        // of the transaction's blocks — remote payloads are untrusted input.
        try {
          this.handleYjsEvent(
            event as Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>,
            origin,
            emittedUpdates
          );
        } catch (error) {
          logLabeled('Failed to process a document change event.', 'error', error);
        }
      }
    });
  }

  /**
   * Register callback for block changes.
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    this.changeCallbacks.push(callback);

    return (): void => {
      const index = this.changeCallbacks.indexOf(callback);

      if (index !== -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Map transaction origin to event origin.
   *
   * Input shapes:
   *  - `Y.UndoManager` instance → `'undo'` or `'redo'`
   *  - `LocalOriginTag` string  → mapped by the exhaustive switch below
   *  - anything else            → `'remote'` (treated as a peer update)
   *
   * IMPORTANT: the switch is exhaustive over `LOCAL_ORIGIN_TAGS`. Adding a
   * new tag there without teaching this switch is a compile error via the
   * `satisfies never` guard, and the enumeration test in
   * `block-observer.test.ts` catches any runtime drift. Do not add a local
   * origin tag that silently falls through to `'remote'` — that is the
   * exact bug class that broke `ensureCellHasBlock` → table row deletion.
   */
  public mapTransactionOrigin(origin: unknown): TransactionOrigin {
    if (this.undoManager && origin === this.undoManager) {
      return this.undoManager.undoing ? 'undo' : 'redo';
    }

    if (!this.isLocalOriginTag(origin)) {
      return 'remote';
    }

    switch (origin) {
      case 'local':
        return 'local';
      case 'load':
        return 'load';
      // `no-capture` is used by `DocumentStore.transactWithoutCapture` for
      // local writes that must bypass the undo stack (auto-repair inserts,
      // drag-move parent rewrites replayed by undo/redo, etc). They are
      // LOCAL authoring writes — mapping them to `'remote'` would make
      // `BlockYjsSync` call `setData(staleYjsData)` on the authoring block
      // mid-operation and wipe any in-memory state the tool had written
      // ahead of Yjs (e.g. Table's local model after `model.addRow()`).
      case 'no-capture':
        return 'local';
      case 'move':
        return 'local';
      case 'move-undo':
        return 'undo';
      case 'move-redo':
        return 'redo';
      default: {
        const _exhaustive: never = origin;

        return _exhaustive;
      }
    }
  }

  /**
   * Type guard for known local-authored origin tags.
   */
  private isLocalOriginTag(value: unknown): value is LocalOriginTag {
    return (
      typeof value === 'string' &&
      (LOCAL_ORIGIN_TAGS as readonly string[]).includes(value)
    );
  }

  /**
   * Handle a single Yjs event.
   */
  private handleYjsEvent(
    event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>,
    origin: TransactionOrigin,
    emittedUpdates: Set<string>
  ): void {
    if (this.yblocks === null) {
      return;
    }

    if (event.target === this.yblocks) {
      this.handleArrayEvent(event as Y.YArrayEvent<Y.Map<unknown>>, origin);
      return;
    }

    if (event.target instanceof Y.Map) {
      this.handleMapEvent(event, origin, emittedUpdates);
    }
  }

  /**
   * Handle array-level changes (add/remove/move).
   * Detects moves by finding block IDs that appear in both adds and removes.
   */
  private handleArrayEvent(
    yArrayEvent: Y.YArrayEvent<Y.Map<unknown>>,
    origin: TransactionOrigin
  ): void {
    // Collect added and removed block IDs
    const adds: string[] = [];
    const removes: string[] = [];

    // Extract IDs from added items
    yArrayEvent.changes.added.forEach((item) => {
      const content = item.content.getContent();

      for (const yblock of content) {
        if (!(yblock instanceof Y.Map)) {
          continue;
        }

        const id: unknown = yblock.get('id');

        if (typeof id === 'string') {
          adds.push(id);
        }
      }
    });

    // Extract IDs from deleted items
    yArrayEvent.changes.deleted.forEach((item) => {
      const blockId = this.extractBlockIdFromDeletedItem(item);

      if (blockId !== undefined) {
        removes.push(blockId);
      }
    });

    // Use Set for O(1) lookups
    const addSet = new Set(adds);
    const removeSet = new Set(removes);

    // Detect moves: same ID appears in both adds and removes
    const moveIds = adds.filter((id) => removeSet.has(id));
    const pureAdds = adds.filter((id) => !removeSet.has(id));
    const pureRemoves = removes.filter((id) => !addSet.has(id));

    // Emit move events first (so DOM can reposition before other changes)
    for (const blockId of moveIds) {
      this.emitChange({ type: 'move', blockId, origin });
    }

    // Emit pure adds — batch when there are multiple so that parent and
    // child blocks can be registered in BlockManager before any lifecycle
    // hooks (like Table.rendered → initializeCells) fire.
    if (pureAdds.length === 1) {
      this.emitChange({ type: 'add', blockId: pureAdds[0], origin });
    }

    if (pureAdds.length > 1) {
      this.emitChange({ type: 'batch-add', blockIds: pureAdds, origin });
    }

    // Emit pure removes
    for (const blockId of pureRemoves) {
      this.emitChange({ type: 'remove', blockId, origin });
    }
  }

  /**
   * Extract block id from a deleted Y.Map item.
   */
  private extractBlockIdFromDeletedItem(item: Y.Item): string | undefined {
    const content = item.content.getContent();

    if (content.length === 0) {
      return undefined;
    }

    const yblock: unknown = content[0];

    if (!(yblock instanceof Y.Map)) {
      return undefined;
    }

    // Access the internal _map to get the id since the Y.Map is deleted
    const idEntry: unknown = yblock._map.get('id');
    const idContent: unknown = idEntry instanceof Y.Item && idEntry.content?.getContent()[0];

    return typeof idContent === 'string' ? idContent : undefined;
  }

  /**
   * Handle map-level changes: setting a top-level yblock key (`parentId`,
   * a whole `contentIds` array, …), or a key inside `data` / `tunes` at any
   * depth.
   *
   * Known gap: in-place mutations of an EXISTING `contentIds` Y.Array target
   * a Y.Array, never reach this handler, and are dropped. Child-order
   * reconciliation belongs to doc schema v2 — Phase 1 of
   * `docs/plans/2026-08-31-multiplayer-design.md` (§2c, order as data);
   * emitting updates here would suggest coverage downstream does not act on.
   */
  private handleMapEvent(
    event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>,
    origin: TransactionOrigin,
    emittedUpdates: Set<string>
  ): void {
    const yblock = this.findOwningBlock(event);

    if (yblock === null) {
      return;
    }

    const id: unknown = yblock.get('id');

    if (typeof id !== 'string') {
      return;
    }

    if (emittedUpdates.has(id)) {
      return;
    }
    emittedUpdates.add(id);

    this.emitChange({
      type: 'update',
      blockId: id,
      origin,
    });
  }

  /**
   * Resolve the yblock that owns the changed Y.Map by identity: walk
   * `event.target` up its parent chain until the parent is `yblocks`.
   *
   * NOT by `event.path`: yjs freezes every event's path BEFORE dispatch
   * (events are sorted by path length and `YEvent.path` memoizes), while a
   * subscriber may legally grow `yblocks` mid-dispatch (yjs-sync inserts a
   * remote block → a container tool's rendered() hook inserts a child). A
   * frozen index resolved against the live array then points at the wrong
   * block. The parent chain is immune to sibling structural writes.
   *
   * Returns null when the chain never reaches `yblocks`, or when the member
   * directly under `yblocks` is not a Y.Map (hostile shapes drop silently).
   */
  private findOwningBlock(
    event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>
  ): Y.Map<unknown> | null {
    if (this.yblocks === null) {
      return null;
    }

    return this.walkToOwningBlock(event.target);
  }

  /**
   * Recursive step of the identity walk: the node directly under `yblocks`
   * is the owning block — but only if it is a Y.Map.
   */
  private walkToOwningBlock(node: unknown): Y.Map<unknown> | null {
    if (!(node instanceof Y.Map) && !(node instanceof Y.Array)) {
      return null;
    }

    const parent: unknown = node.parent;

    if (parent === this.yblocks) {
      return node instanceof Y.Map ? node : null;
    }

    return this.walkToOwningBlock(parent);
  }

  /**
   * Emit change event to all callbacks.
   *
   * Note: We do NOT skip events during undo/redo. The isPerformingUndoRedo flag
   * is only used in UndoHistory to prevent the stack-item-added listener from
   * modifying caret stacks. Change events during undo/redo must be emitted so
   * the DOM can be updated to reflect the Yjs state.
   */
  private emitChange(event: BlockChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logLabeled('A block-change subscriber threw.', 'error', error);
      }
    }
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.changeCallbacks = [];
    this.yblocks = null;
    this.undoManager = null;
  }
}
