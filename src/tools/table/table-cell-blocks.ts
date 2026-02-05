import type { API } from '../../../types';

import { CELL_ATTR, ROW_ATTR } from './table-core';
import type { LegacyCellContent, CellContent } from './types';
import { isCellWithBlocks } from './types';

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

/**
 * Check if an element is inside a block-based table cell
 */
export const isInCellBlock = (element: HTMLElement): boolean => {
  const cellBlocksContainer = element.closest(`[${CELL_BLOCKS_ATTR}]`);

  return cellBlocksContainer !== null;
};

/**
 * Get the cell element that contains the given element
 */
export const getCellFromElement = (element: HTMLElement): HTMLElement | null => {
  return element.closest<HTMLElement>(`[${CELL_ATTR}]`);
};

interface CellPosition {
  row: number;
  col: number;
}

interface CellNavigationCallback {
  (position: CellPosition): void;
}

interface TableCellBlocksOptions {
  api: API;
  gridElement: HTMLElement;
  tableBlockId: string;
  onNavigateToCell?: CellNavigationCallback;
}

/**
 * Manages nested blocks within table cells.
 * Handles block lifecycle and keyboard navigation.
 */
export class TableCellBlocks {
  private api: API;
  private gridElement: HTMLElement;
  private tableBlockId: string;
  private _activeCellWithBlocks: CellPosition | null = null;
  private onNavigateToCell?: CellNavigationCallback;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
    this.onNavigateToCell = options.onNavigateToCell;
  }

  /**
   * Get the currently active cell that contains blocks
   */
  get activeCellWithBlocks(): CellPosition | null {
    return this._activeCellWithBlocks;
  }

  /**
   * Set the active cell with blocks (when focus enters a nested block)
   */
  setActiveCellWithBlocks(position: CellPosition): void {
    this._activeCellWithBlocks = position;
  }

  /**
   * Clear the active cell tracking (when focus leaves nested blocks)
   */
  clearActiveCellWithBlocks(): void {
    this._activeCellWithBlocks = null;
  }

  /**
   * Handle keyboard navigation within cell blocks
   * @param event - The keyboard event
   * @param _cell - The cell element (unused but available for future use)
   */
  handleKeyDown(event: KeyboardEvent, _cell: HTMLElement): void {
    const position = this._activeCellWithBlocks;

    if (!position) {
      return;
    }

    // Tab -> next cell
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.handleTabNavigation(position);

      return;
    }

    // Shift+Tab -> previous cell
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      this.handleShiftTabNavigation(position);

      return;
    }

    // Shift+Enter -> exit to cell below
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      this.exitListToNextCell(position);

      return;
    }
  }

  /**
   * Handle Tab navigation to next cell
   */
  private handleTabNavigation(position: CellPosition): void {
    const nextCol = position.col + 1;
    const totalCols = this.getColumnCount();

    // Navigate to next column in same row
    if (nextCol < totalCols) {
      this.navigateToCell({ row: position.row, col: nextCol });

      return;
    }

    // Wrap to first column of next row
    const nextRow = position.row + 1;

    if (nextRow < this.getRowCount()) {
      this.navigateToCell({ row: nextRow, col: 0 });
    }
  }

  /**
   * Handle Shift+Tab navigation to previous cell
   */
  private handleShiftTabNavigation(position: CellPosition): void {
    const prevCol = position.col - 1;

    // Navigate to previous column in same row
    if (prevCol >= 0) {
      this.navigateToCell({ row: position.row, col: prevCol });

      return;
    }

    // Wrap to last column of previous row
    const prevRow = position.row - 1;

    if (prevRow >= 0) {
      this.navigateToCell({ row: prevRow, col: this.getColumnCount() - 1 });
    }
  }

  /**
   * Handle Enter key in a list item within a cell
   * @param isEmpty - whether the list item content is empty
   * @returns true if handled (exit list), false if not handled (let default behavior)
   */
  handleEnterInList(isEmpty: boolean): boolean {
    if (!this._activeCellWithBlocks) {
      return false;
    }

    // If empty, exit list and navigate to cell below
    if (isEmpty) {
      this.exitListToNextCell(this._activeCellWithBlocks);

      return true;
    }

    // Not empty - let default list behavior (create new item) occur
    return false;
  }

  /**
   * Navigate to a different cell
   */
  private navigateToCell(position: CellPosition): void {
    this.clearActiveCellWithBlocks();
    this.onNavigateToCell?.(position);
  }

  /**
   * Exit list and navigate to the cell below
   */
  private exitListToNextCell(currentPosition: CellPosition): void {
    const nextRow = currentPosition.row + 1;

    if (nextRow < this.getRowCount()) {
      this.navigateToCell({ row: nextRow, col: currentPosition.col });
    } else {
      this.clearActiveCellWithBlocks();
    }
  }

  /**
   * Get the number of rows in the table
   */
  private getRowCount(): number {
    return this.gridElement.querySelectorAll('[data-blok-table-row]').length;
  }

  /**
   * Get the number of columns in the table (based on first row)
   */
  private getColumnCount(): number {
    const firstRow = this.gridElement.querySelector('[data-blok-table-row]');

    return firstRow?.querySelectorAll('[data-blok-table-cell]').length ?? 0;
  }

  /**
   * Initialize all cells with blocks.
   * - Empty cells or legacy string cells get a new paragraph block.
   * - Cells that already have block references get those blocks mounted.
   */
  public initializeCells(content: LegacyCellContent[][]): CellContent[][] {
    const rowElements = this.gridElement.querySelectorAll(`[${ROW_ATTR}]`);
    const normalizedContent: CellContent[][] = [];

    content.forEach((rowData, rowIndex) => {
      const row = rowElements[rowIndex];

      if (!row) {
        return;
      }

      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const normalizedRow: CellContent[] = [];

      rowData.forEach((cellContent, colIndex) => {
        const cell = cells[colIndex] as HTMLElement | undefined;

        if (!cell) {
          return;
        }

        const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`) as HTMLElement | null;

        if (!container) {
          return;
        }

        if (isCellWithBlocks(cellContent)) {
          this.mountBlocksInCell(container, cellContent.blocks);
          normalizedRow.push(cellContent);
        } else {
          const text = typeof cellContent === 'string' ? cellContent : '';
          const block = this.api.blocks.insert('paragraph', { text }, {}, undefined, false);

          container.appendChild(block.holder);
          normalizedRow.push({ blocks: [block.id] });
        }
      });

      normalizedContent.push(normalizedRow);
    });

    return normalizedContent;
  }

  /**
   * Mount existing blocks into a cell container by their IDs
   */
  private mountBlocksInCell(container: HTMLElement, blockIds: string[]): void {
    for (const blockId of blockIds) {
      const index = this.api.blocks.getBlockIndex(blockId);

      if (index === undefined) {
        continue;
      }

      const block = this.api.blocks.getBlockByIndex(index);

      if (!block) {
        continue;
      }

      container.appendChild(block.holder);
    }
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this._activeCellWithBlocks = null;
  }
}
