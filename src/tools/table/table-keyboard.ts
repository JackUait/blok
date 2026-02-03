import type { TableGrid } from './table-core';

interface CellPosition {
  row: number;
  col: number;
  addRow?: boolean;
}

/**
 * Handles keyboard navigation within the table grid.
 */
export class TableKeyboard {
  private grid: TableGrid;
  private gridElement: HTMLElement;

  constructor(grid: TableGrid, gridElement: HTMLElement) {
    this.grid = grid;
    this.gridElement = gridElement;
  }

  /**
   * Calculate target cell for a key press from current position.
   * Returns null if navigation should leave the table.
   */
  public getTargetCell(row: number, col: number, key: string): CellPosition | null {
    if (key === 'Tab') {
      return this.getNextCellForTab(row, col);
    }

    if (key === 'Enter') {
      return this.getNextCellForEnter(row, col);
    }

    return null;
  }

  private getNextCellForTab(row: number, col: number): CellPosition | null {
    const totalRows = this.grid.getRowCount(this.gridElement);
    const totalCols = this.grid.getColumnCount(this.gridElement);
    const nextCol = col + 1;

    if (nextCol < totalCols) {
      return { row, col: nextCol };
    }

    const nextRow = row + 1;

    if (nextRow < totalRows) {
      return { row: nextRow, col: 0 };
    }

    return null;
  }

  private getNextCellForEnter(row: number, col: number): CellPosition {
    const totalRows = this.grid.getRowCount(this.gridElement);
    const nextRow = row + 1;

    if (nextRow < totalRows) {
      return { row: nextRow, col };
    }

    return { row: nextRow, col, addRow: true };
  }

  /**
   * Handle keydown event on a cell
   */
  public handleKeyDown(event: KeyboardEvent, position: CellPosition): void {
    const isNavigationKey = event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey);

    if (!isNavigationKey) {
      return;
    }

    const target = this.getTargetCell(position.row, position.col, event.key);

    if (target === null) {
      return;
    }

    event.preventDefault();

    if (target.addRow) {
      this.grid.addRow(this.gridElement);
    }

    const cell = this.grid.getCell(this.gridElement, target.row, target.col);

    cell?.focus();
  }
}
