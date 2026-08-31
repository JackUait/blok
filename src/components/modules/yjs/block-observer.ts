import * as Y from 'yjs';

import { logLabeled } from '../../utils';
import {
  LOCAL_ORIGIN_TAGS,
  type BlockChangeEvent,
  type BlockChangeCallback,
  type DocumentScope,
  type LocalOriginTag,
  type TransactionOrigin,
} from './types';

/**
 * Per-transaction classification buckets.
 */
interface ChangeBuckets {
  adds: string[];
  removes: string[];
  orderTouched: Set<string>;
  updates: Set<string>;
}

/**
 * Event type observed on either root. The union is nominal — every branch
 * narrows by identity/instanceof, never by this annotation.
 */
type ObservedEvent = Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>;

/**
 * BlockObserver observes Yjs events and emits domain events.
 *
 * Doc schema v2 mapping:
 * - blocks-map key add/delete → 'add'/'remove' (the key IS the block id)
 * - order-array edits (root order or a contentIds array) whose id was not
 *   added/removed in the same transaction → 'move'
 * - any other nested event — nested Y.Maps AND nested Y.Arrays (per-cell
 *   grids) — → 'update' on the owning block via the identity walk
 *
 * EMISSION-ORDER CONTRACT: within one transaction, events are emitted
 * moves → add/batch-add → removes → updates, regardless of which root each
 * change came through. Both roots' deep observers only CLASSIFY into a
 * per-transaction buffer; the ordered dispatch runs once per transaction
 * from the doc's 'afterTransaction' hook (still synchronous, inside the
 * same transaction cleanup). This replaces the earlier two-dispatch design
 * whose cross-root ordering rested on yjs firing plain observers before
 * deep ones — an internal, not a contract.
 */
export class BlockObserver {
  /**
   * Callbacks for block changes
   */
  private changeCallbacks: BlockChangeCallback[] = [];

  /**
   * Blocks map being observed (id → block Y.Map)
   */
  private blocksMap: Y.Map<Y.Map<unknown>> | null = null;

  /**
   * Root order array being observed (top-level ids)
   */
  private rootOrder: Y.Array<string> | null = null;

  /**
   * Undo manager reference (needed to detect undo/redo state)
   */
  private undoManager: Y.UndoManager | null = null;

  /**
   * The observed doc — source of the 'afterTransaction' dispatch hook.
   */
  private doc: Y.Doc | null = null;

  /**
   * Classifications buffered per transaction between the deep-observer
   * callbacks and the 'afterTransaction' dispatch. WeakMap so a
   * transaction whose dispatch never runs (doc torn down mid-cleanup)
   * cannot leak its buckets.
   */
  private readonly pendingBuckets = new WeakMap<Y.Transaction, ChangeBuckets>();

  /**
   * The single deep observer registered on BOTH roots (kept for detach).
   */
  private deepObserver:
    | ((events: ObservedEvent[], transaction: Y.Transaction) => void)
    | null = null;

  /**
   * The per-transaction dispatch hook (kept for detach).
   */
  private afterTransactionHandler: ((transaction: Y.Transaction) => void) | null = null;

  /**
   * Set up Yjs observers for change tracking.
   */
  public observe(scope: DocumentScope, undoManager: Y.UndoManager): void {
    this.blocksMap = scope.blocksMap;
    this.rootOrder = scope.rootOrder;
    this.undoManager = undoManager;
    this.doc = scope.blocksMap.doc;

    const deepObserver = (events: ObservedEvent[], transaction: Y.Transaction): void => {
      this.collectTransactionEvents(events, transaction);
    };

    this.deepObserver = deepObserver;
    scope.blocksMap.observeDeep(deepObserver);
    scope.rootOrder.observeDeep(deepObserver);

    this.afterTransactionHandler = (transaction: Y.Transaction): void => {
      this.dispatchTransaction(transaction);
    };
    this.doc?.on('afterTransaction', this.afterTransactionHandler);
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
   * Deep-observer callback for either root: classify this root's events
   * into the transaction's buckets. Emits nothing — the ordered dispatch
   * runs once per transaction in `dispatchTransaction`.
   */
  private collectTransactionEvents(
    events: ObservedEvent[],
    transaction: Y.Transaction
  ): void {
    const buckets = this.pendingBuckets.get(transaction) ?? {
      adds: [],
      removes: [],
      orderTouched: new Set<string>(),
      updates: new Set<string>(),
    };

    this.pendingBuckets.set(transaction, buckets);

    for (const event of events) {
      // One bad event must not desync the rest of the transaction's blocks
      // — remote payloads are untrusted input.
      try {
        this.collectEvent(event, buckets);
      } catch (error) {
        logLabeled('Failed to process a document change event.', 'error', error);
      }
    }
  }

  /**
   * Sort one event into the buckets:
   * - target === blocksMap → key adds/deletes/updates (the key is the id)
   * - target === rootOrder, or a block's contentIds Y.Array → the id
   *   STRINGS in its delta are move candidates
   * - any other target reachable from a block — nested Y.Maps AND nested
   *   Y.Arrays (grid rows/cells) — → 'update' for the owning block
   * - targets that never reach a block Y.Map (hostile shapes) drop silently
   */
  private collectEvent(event: ObservedEvent, buckets: ChangeBuckets): void {
    if (this.blocksMap === null || this.rootOrder === null) {
      return;
    }

    // Widen before comparing: the nominal event annotation says nothing
    // about which shared type actually changed.
    const target: unknown = event.target;

    if (target === this.blocksMap) {
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add') {
          buckets.adds.push(key);
        } else if (change.action === 'delete') {
          buckets.removes.push(key);
        } else {
          buckets.updates.add(key);
        }
      });

      return;
    }

    const isOrderArray =
      target === this.rootOrder ||
      (target instanceof Y.Array && this.isContentIdsArray(target));

    if (isOrderArray) {
      for (const id of this.extractStrings(event.changes.added)) {
        buckets.orderTouched.add(id);
      }

      for (const id of this.extractStrings(event.changes.deleted)) {
        buckets.orderTouched.add(id);
      }

      return;
    }

    const yblock = this.walkToOwningBlock(target);

    if (yblock === null) {
      return;
    }

    const id: unknown = yblock.get('id');

    if (typeof id === 'string') {
      buckets.updates.add(id);
    }
  }

  /**
   * Whether the array is a block's `contentIds` — the array directly under
   * a block Y.Map, stored under the 'contentIds' key. Any other nested
   * Y.Array (grid rows/cells, tool data) is block content, not order.
   */
  private isContentIdsArray(target: Y.Array<unknown>): boolean {
    const parentBlock: unknown = target.parent;

    return (
      parentBlock instanceof Y.Map &&
      parentBlock.parent === this.blocksMap &&
      parentBlock.get('contentIds') === target
    );
  }

  /**
   * Ordered dispatch for one transaction: moves → adds → removes → updates,
   * so the DOM can reposition before other changes land. Runs from the
   * doc's 'afterTransaction' hook — after BOTH roots' deep observers have
   * classified, still synchronously inside the transaction cleanup.
   */
  private dispatchTransaction(transaction: Y.Transaction): void {
    const buckets = this.pendingBuckets.get(transaction);

    if (buckets === undefined) {
      return;
    }

    // Pop BEFORE emitting: a subscriber may legally grow the doc
    // mid-dispatch (yjs-sync inserts a remote block → a container tool's
    // rendered() hook inserts a child); those writes open a NEW transaction
    // that must classify into fresh buckets.
    this.pendingBuckets.delete(transaction);

    const origin = this.mapTransactionOrigin(transaction.origin);
    const addSet = new Set(buckets.adds);
    const removeSet = new Set(buckets.removes);
    const moves = [...buckets.orderTouched]
      .filter((id) => !addSet.has(id) && !removeSet.has(id));

    for (const blockId of moves) {
      this.emitChange({ type: 'move', blockId, origin });
    }

    // Emit pure adds — batch when there are multiple so that parent and
    // child blocks can be registered in BlockManager before any lifecycle
    // hooks (like Table.rendered → initializeCells) fire.
    if (buckets.adds.length === 1) {
      this.emitChange({ type: 'add', blockId: buckets.adds[0], origin });
    }

    if (buckets.adds.length > 1) {
      this.emitChange({ type: 'batch-add', blockIds: buckets.adds, origin });
    }

    for (const blockId of buckets.removes) {
      this.emitChange({ type: 'remove', blockId, origin });
    }

    const updates = [...buckets.updates]
      .filter((id) => !addSet.has(id) && !removeSet.has(id));

    for (const blockId of updates) {
      this.emitChange({ type: 'update', blockId, origin });
    }
  }

  /**
   * Extract string values from an event delta's item set. Deleted items
   * keep their content readable via `getContent()`.
   */
  private extractStrings(items: Set<Y.Item>): string[] {
    const result: string[] = [];

    items.forEach((item) => {
      for (const value of item.content.getContent()) {
        if (typeof value === 'string') {
          result.push(value);
        }
      }
    });

    return result;
  }

  /**
   * Resolve the yblock owning a changed nested type BY IDENTITY: walk the
   * node up its parent chain until the parent is the blocks map.
   *
   * NOT by `event.path`: yjs freezes every event's path BEFORE dispatch
   * (events are sorted by path length and `YEvent.path` memoizes), while a
   * subscriber may legally grow the doc mid-dispatch (yjs-sync inserts a
   * remote block → a container tool's rendered() hook inserts a child). A
   * frozen key resolved against the live map then points at the wrong
   * block. The parent chain is immune to sibling structural writes.
   *
   * Returns null when the chain never reaches the blocks map, or when the
   * member directly under it is not a Y.Map (hostile shapes drop silently).
   */
  private walkToOwningBlock(node: unknown): Y.Map<unknown> | null {
    if (this.blocksMap === null) {
      return null;
    }

    if (!(node instanceof Y.Map) && !(node instanceof Y.Array)) {
      return null;
    }

    const parent: unknown = node.parent;

    if (parent === this.blocksMap) {
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
   * Detach from the observed document, KEEPING the change subscribers.
   *
   * This is the half of `destroy` a lineage reset needs: the Y.Doc is being
   * swapped, but every subscriber (BlockYjsSync above all) must survive the
   * swap — re-registering them would mean reaching into BlockManager to rebuild
   * a subscription that never had to break. Pair it with a fresh `observe`.
   */
  public unobserve(): void {
    if (this.deepObserver !== null) {
      this.blocksMap?.unobserveDeep(this.deepObserver);
      this.rootOrder?.unobserveDeep(this.deepObserver);
    }

    if (this.afterTransactionHandler !== null) {
      this.doc?.off('afterTransaction', this.afterTransactionHandler);
    }

    this.blocksMap = null;
    this.rootOrder = null;
    this.undoManager = null;
    this.doc = null;
    this.deepObserver = null;
    this.afterTransactionHandler = null;
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.unobserve();

    this.changeCallbacks = [];
  }
}
