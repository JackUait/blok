import type { TableOwnershipRegistry } from './table-ownership-registry';

/**
 * Block lifecycle event data routed through the broker.
 * Keeps the shape generic — the broker doesn't interpret event content,
 * it just routes based on block ownership.
 */
export interface BlockLifecycleEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Handler callback for routed block lifecycle events.
 */
export type BlockEventHandler = (blockId: string, event: BlockLifecycleEvent) => void;

/**
 * Ownership-based event broker for table block lifecycle events.
 *
 * Instead of every table instance listening to global `'block changed'` events
 * and using heuristics to determine if a block belongs to it, the broker:
 *
 * 1. Receives a single global event (one listener)
 * 2. Resolves the owning table via the ownership registry (O(1) lookup)
 * 3. Routes the event to the correct table subscriber
 *
 * This eliminates adjacency heuristics and cross-table interference.
 */
export class TableEventBroker {
  private readonly registry: TableOwnershipRegistry;
  private readonly subscribers = new Map<string, BlockEventHandler>();

  constructor(registry: TableOwnershipRegistry) {
    this.registry = registry;
  }

  /**
   * Subscribe a table to receive block lifecycle events for its owned blocks.
   */
  subscribe(tableId: string, handler: BlockEventHandler): void {
    this.subscribers.set(tableId, handler);
  }

  /**
   * Unsubscribe a table from block lifecycle events.
   */
  unsubscribe(tableId: string): void {
    this.subscribers.delete(tableId);
  }

  /**
   * Route a block lifecycle event to the owning table's handler.
   *
   * If the block is not owned by any table, or no subscriber exists
   * for the owning table, the event is silently dropped — no heuristic
   * claim is attempted.
   */
  routeBlockEvent(blockId: string, event: BlockLifecycleEvent): void {
    const owner = this.registry.getOwner(blockId);

    if (owner === null) {
      return;
    }

    const handler = this.subscribers.get(owner.tableId);

    if (handler === undefined) {
      return;
    }

    handler(blockId, event);
  }
}
