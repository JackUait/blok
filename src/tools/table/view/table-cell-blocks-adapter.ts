import type { TableEventBroker, BlockLifecycleEvent } from '../ownership/table-event-broker';
import type { TableOwnershipRegistry } from '../ownership/table-ownership-registry';

/**
 * Adapter that bridges the ownership-based event broker into the existing
 * TableCellBlocks event handling.
 *
 * In shadow mode, this adapter subscribes the table to the broker and
 * forwards routed events to the table's handler. It does NOT replace the
 * existing global event listener — both paths run in parallel for validation.
 *
 * After cutover (Task 7), this adapter becomes the sole event path.
 */
export class TableCellBlocksAdapter {
  private readonly tableId: string;
  private readonly broker: TableEventBroker;
  private readonly registry: TableOwnershipRegistry;
  private readonly onEvent: (blockId: string, event: BlockLifecycleEvent) => void;

  constructor(options: {
    tableId: string;
    broker: TableEventBroker;
    registry: TableOwnershipRegistry;
    onEvent: (blockId: string, event: BlockLifecycleEvent) => void;
  }) {
    this.tableId = options.tableId;
    this.broker = options.broker;
    this.registry = options.registry;
    this.onEvent = options.onEvent;

    this.broker.subscribe(this.tableId, this.handleBrokerEvent);
  }

  /**
   * Destroy the adapter — unsubscribe from the broker.
   */
  destroy(): void {
    this.broker.unsubscribe(this.tableId);
  }

  /**
   * Handler for events routed through the broker.
   */
  private handleBrokerEvent = (blockId: string, event: BlockLifecycleEvent): void => {
    this.onEvent(blockId, event);
  };
}
