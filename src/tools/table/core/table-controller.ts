import type { TableModel } from '../table-model';
import type { TableData } from '../types';
import type { TableCommand } from './table-commands';
import type { TableDomainEvent } from './table-events';

/**
 * Listener callback for domain events emitted by the controller.
 */
export type TableEventListener = (event: TableDomainEvent) => void;

/**
 * Central command executor for table mutations.
 *
 * All model mutations flow through `execute()`, which:
 * 1. Applies the command to the model
 * 2. Emits a corresponding domain event
 *
 * This is the sole mutation entrypoint — no direct model mutation
 * should happen outside of the controller in the final architecture.
 */
export class TableController {
  private readonly model: TableModel;
  private readonly listener: TableEventListener | undefined;

  constructor(model: TableModel, listener?: TableEventListener) {
    this.model = model;
    this.listener = listener;
  }

  /**
   * Execute a typed command against the model and emit the resulting event.
   */
  execute(command: TableCommand): void {
    const event = this.applyCommand(command);

    if (event !== null && this.listener) {
      this.listener(event);
    }
  }

  /**
   * Apply a command to the model and return the domain event to emit.
   * Returns null if the command was a no-op (e.g., out-of-bounds).
   */
  private applyCommand(command: TableCommand): TableDomainEvent | null {
    switch (command.type) {
      case 'insert-row':
        return this.handleInsertRow(command.index);

      case 'delete-row':
        return this.handleDeleteRow(command.index);

      case 'move-row':
        return this.handleMoveRow(command.fromIndex, command.toIndex);

      case 'insert-column':
        return this.handleInsertColumn(command.index, command.width);

      case 'delete-column':
        return this.handleDeleteColumn(command.index);

      case 'move-column':
        return this.handleMoveColumn(command.fromIndex, command.toIndex);

      case 'toggle-heading':
        return this.handleToggleHeading();

      case 'toggle-heading-column':
        return this.handleToggleHeadingColumn();

      case 'set-stretched':
        return this.handleSetStretched(command.value);

      case 'add-block-to-cell':
        return this.handleAddBlockToCell(command.row, command.col, command.blockId);

      case 'remove-block-from-cell':
        return this.handleRemoveBlockFromCell(command.row, command.col, command.blockId);

      case 'set-cell-blocks':
        return this.handleSetCellBlocks(command.row, command.col, [...command.blockIds]);

      case 'set-col-widths':
        return this.handleSetColWidths(command.widths ? [...command.widths] : undefined);

      case 'replace-all':
        return this.handleReplaceAll(command.data);
    }
  }

  // ─── Command handlers ──────────────────────────────────────────

  private handleInsertRow(index: number): TableDomainEvent {
    const result = this.model.addRow(index);

    return {
      type: 'row-inserted',
      index: result.index,
      cellsToPopulate: result.cellsToPopulate,
    };
  }

  private handleDeleteRow(index: number): TableDomainEvent {
    const result = this.model.deleteRow(index);

    return {
      type: 'row-deleted',
      index: result.index,
      blocksToDelete: result.blocksToDelete,
    };
  }

  private handleMoveRow(fromIndex: number, toIndex: number): TableDomainEvent {
    this.model.moveRow(fromIndex, toIndex);

    return {
      type: 'row-moved',
      fromIndex,
      toIndex,
    };
  }

  private handleInsertColumn(index: number, width?: number): TableDomainEvent {
    const result = this.model.addColumn(index, width);

    return {
      type: 'column-inserted',
      index: result.index,
      cellsToPopulate: result.cellsToPopulate,
    };
  }

  private handleDeleteColumn(index: number): TableDomainEvent {
    const result = this.model.deleteColumn(index);

    return {
      type: 'column-deleted',
      index: result.index,
      blocksToDelete: result.blocksToDelete,
    };
  }

  private handleMoveColumn(fromIndex: number, toIndex: number): TableDomainEvent {
    this.model.moveColumn(fromIndex, toIndex);

    return {
      type: 'column-moved',
      fromIndex,
      toIndex,
    };
  }

  private handleToggleHeading(): TableDomainEvent {
    const newValue = !this.model.withHeadings;

    this.model.setWithHeadings(newValue);

    return {
      type: 'heading-toggled',
      withHeadings: newValue,
    };
  }

  private handleToggleHeadingColumn(): TableDomainEvent {
    const newValue = !this.model.withHeadingColumn;

    this.model.setWithHeadingColumn(newValue);

    return {
      type: 'heading-column-toggled',
      withHeadingColumn: newValue,
    };
  }

  private handleSetStretched(value: boolean): TableDomainEvent {
    this.model.setStretched(value);

    return {
      type: 'stretched-changed',
      stretched: value,
    };
  }

  private handleAddBlockToCell(row: number, col: number, blockId: string): TableDomainEvent {
    this.model.addBlockToCell(row, col, blockId);

    return {
      type: 'block-added-to-cell',
      row,
      col,
      blockId,
    };
  }

  private handleRemoveBlockFromCell(row: number, col: number, blockId: string): TableDomainEvent {
    this.model.removeBlockFromCell(row, col, blockId);

    return {
      type: 'block-removed-from-cell',
      row,
      col,
      blockId,
    };
  }

  private handleSetCellBlocks(row: number, col: number, blockIds: string[]): TableDomainEvent {
    this.model.setCellBlocks(row, col, blockIds);

    return {
      type: 'cell-blocks-set',
      row,
      col,
      blockIds,
    };
  }

  private handleSetColWidths(widths: number[] | undefined): TableDomainEvent {
    this.model.setColWidths(widths);

    return {
      type: 'col-widths-changed',
      widths,
    };
  }

  private handleReplaceAll(data: TableData): TableDomainEvent {
    this.model.replaceAll(data);

    return { type: 'model-replaced' };
  }
}
