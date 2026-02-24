import type { TableModel } from '../table-model';
import type { CellContent } from '../types';

/**
 * Ownership entry for a block within a table cell.
 */
export interface BlockOwnership {
  readonly tableId: string;
  readonly row: number;
  readonly col: number;
}

/**
 * Deterministic block-to-table-cell ownership registry.
 *
 * Provides O(1) lookup: given a block ID, determine which table and cell
 * owns it. This replaces adjacency heuristics in `TableCellBlocks` with
 * a single source of truth for block ownership.
 *
 * The registry is global — all table instances share one registry so that
 * multi-table ownership conflicts are detected immediately.
 */
export class TableOwnershipRegistry {
  /** blockId → ownership info */
  private readonly owners = new Map<string, BlockOwnership>();

  /**
   * Set or update ownership for a block.
   * A block can only be owned by one table cell at a time.
   */
  setOwner(blockId: string, ownership: BlockOwnership): void {
    this.owners.set(blockId, ownership);
  }

  /**
   * Get the ownership info for a block.
   * Returns null if the block is not tracked.
   */
  getOwner(blockId: string): BlockOwnership | null {
    return this.owners.get(blockId) ?? null;
  }

  /**
   * Remove ownership tracking for a block.
   */
  removeOwner(blockId: string): void {
    this.owners.delete(blockId);
  }

  /**
   * Check if a block is owned by a specific table.
   */
  isOwnedByTable(blockId: string, tableId: string): boolean {
    const owner = this.owners.get(blockId);

    return owner !== null && owner !== undefined && owner.tableId === tableId;
  }

  /**
   * Get all block IDs owned by a specific table.
   */
  getBlocksForTable(tableId: string): string[] {
    const result: string[] = [];

    for (const [blockId, ownership] of this.owners) {
      if (ownership.tableId === tableId) {
        result.push(blockId);
      }
    }

    return result;
  }

  /**
   * Reconcile the registry with a model snapshot for a specific table.
   *
   * After this call, the registry will exactly match the model's block-cell
   * mapping for the given table. Stale entries for the table are removed,
   * and entries for other tables are left untouched.
   */
  reconcileWithModel(tableId: string, model: TableModel): void {
    // Remove all existing entries for this table
    const toRemove: string[] = [];

    for (const [blockId, ownership] of this.owners) {
      if (ownership.tableId === tableId) {
        toRemove.push(blockId);
      }
    }

    for (const blockId of toRemove) {
      this.owners.delete(blockId);
    }

    // Re-populate from model snapshot
    const snapshot = model.snapshot();

    for (let r = 0; r < snapshot.content.length; r++) {
      for (let c = 0; c < snapshot.content[r].length; c++) {
        const cellContent = snapshot.content[r][c] as CellContent;

        for (const blockId of cellContent.blocks) {
          this.owners.set(blockId, { tableId, row: r, col: c });
        }
      }
    }
  }

  /**
   * Remove all blocks owned by a specific table.
   * Used when a table is destroyed.
   */
  removeTable(tableId: string): void {
    const toRemove: string[] = [];

    for (const [blockId, ownership] of this.owners) {
      if (ownership.tableId === tableId) {
        toRemove.push(blockId);
      }
    }

    for (const blockId of toRemove) {
      this.owners.delete(blockId);
    }
  }
}
