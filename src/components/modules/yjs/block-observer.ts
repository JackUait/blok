import * as Y from 'yjs';
import type {
  BlockChangeEvent,
  BlockChangeCallback,
  TransactionOrigin,
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

      for (const event of events) {
        this.handleYjsEvent(event, origin);
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
   */
  public mapTransactionOrigin(origin: unknown): TransactionOrigin {
    if (origin === 'local') {
      return 'local';
    }

    if (origin === 'load') {
      return 'load';
    }

    if (this.undoManager && origin === this.undoManager) {
      return this.undoManager.undoing ? 'undo' : 'redo';
    }

    // Handle custom move origins for our application-level move undo/redo
    if (origin === 'move') {
      return 'local';
    }

    if (origin === 'move-undo') {
      return 'undo';
    }

    if (origin === 'move-redo') {
      return 'redo';
    }

    return 'remote';
  }

  /**
   * Handle a single Yjs event.
   */
  private handleYjsEvent(
    event: Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>,
    origin: TransactionOrigin
  ): void {
    if (this.yblocks === null) {
      return;
    }

    if (event.target === this.yblocks) {
      this.handleArrayEvent(event as Y.YArrayEvent<Y.Map<unknown>>, origin);
      return;
    }

    if (event.target instanceof Y.Map) {
      this.handleMapEvent(event.target, origin);
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

        const id = yblock.get('id');

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

    // Emit pure adds
    for (const blockId of pureAdds) {
      this.emitChange({ type: 'add', blockId, origin });
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

    const yblock = content[0];

    if (!(yblock instanceof Y.Map)) {
      return undefined;
    }

    // Access the internal _map to get the id since the Y.Map is deleted
    const idEntry = yblock._map.get('id');
    const idContent = idEntry?.content?.getContent()[0];

    return typeof idContent === 'string' ? idContent : undefined;
  }

  /**
   * Handle map-level changes (data update).
   */
  private handleMapEvent(ymap: Y.Map<unknown>, origin: TransactionOrigin): void {
    if (this.yblocks === null) {
      return;
    }

    const yblock = this.findParentBlock(ymap);

    if (yblock === undefined) {
      return;
    }

    this.emitChange({
      type: 'update',
      blockId: yblock.get('id') as string,
      origin,
    });
  }

  /**
   * Find the parent block Y.Map for a nested Y.Map (data or tunes).
   */
  private findParentBlock(ymap: Y.Map<unknown>): Y.Map<unknown> | undefined {
    if (this.yblocks === null) {
      return undefined;
    }

    return this.yblocks.toArray().find((yblock) => {
      const ydata = yblock.get('data');
      const ytunes = yblock.get('tunes');

      return ydata === ymap || ytunes === ymap;
    });
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
      callback(event);
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
