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
  private _activeCellWithBlocks: CellPosition | null = null;
  private onNavigateToCell?: CellNavigationCallback;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.onNavigateToCell = options.onNavigateToCell;

    this.api.events.on('block changed', this.handleBlockMutation);
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
   * @param position - The current cell position
   */
  handleKeyDown(event: KeyboardEvent, position: CellPosition): void {
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
      this.navigateToCell({ row: position.row, col: prevCol }, true);

      return;
    }

    // Wrap to last column of previous row
    const prevRow = position.row - 1;

    if (prevRow >= 0) {
      this.navigateToCell({ row: prevRow, col: this.getColumnCount() - 1 }, true);
    }
  }

  /**
   * Navigate to a different cell, focusing the appropriate contenteditable element
   * @param position - Target cell position
   * @param focusLast - If true, focus the last contenteditable; otherwise focus the first
   */
  private navigateToCell(position: CellPosition, focusLast = false): void {
    this.clearActiveCellWithBlocks();

    const cell = this.getCell(position.row, position.col);

    if (!cell) {
      return;
    }

    const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const editables = container.querySelectorAll<HTMLElement>('[contenteditable="true"]');

    if (editables.length === 0) {
      return;
    }

    const target = focusLast ? editables[editables.length - 1] : editables[0];

    target.focus();
    this.onNavigateToCell?.(position);
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
   * Get a cell element by row and column index
   */
  private getCell(row: number, col: number): HTMLElement | null {
    const rows = this.gridElement.querySelectorAll('[data-blok-table-row]');
    const rowEl = rows[row];

    if (!rowEl) {
      return null;
    }

    const cells = rowEl.querySelectorAll('[data-blok-table-cell]');

    return (cells[col] as HTMLElement | undefined) ?? null;
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

        const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

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
   * Move a block's DOM holder into a cell's blocks container.
   */
  public claimBlockForCell(cell: HTMLElement, blockId: string): void {
    const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const index = this.api.blocks.getBlockIndex(blockId);

    if (index === undefined) {
      return;
    }

    const block = this.api.blocks.getBlockByIndex(index);

    if (!block) {
      return;
    }

    container.appendChild(block.holder);
  }

  /**
   * Given a new block's index, find which cell it should belong to
   * by checking if the previous or next block in the flat list is mounted in a cell.
   */
  public findCellForNewBlock(blockIndex: number): HTMLElement | null {
    // Check the previous block — if it's in a cell, the new block belongs there too
    const prevCell = this.findCellForAdjacentBlock(blockIndex - 1);

    if (prevCell) {
      return prevCell;
    }

    // Also check the next block (for insert-before cases)
    return this.findCellForAdjacentBlock(blockIndex + 1);
  }

  /**
   * Check if a block at the given index is mounted inside a cell in this grid.
   * Returns the cell element if found, null otherwise.
   */
  private findCellForAdjacentBlock(adjacentIndex: number): HTMLElement | null {
    if (adjacentIndex < 0 || adjacentIndex >= this.api.blocks.getBlocksCount()) {
      return null;
    }

    const block = this.api.blocks.getBlockByIndex(adjacentIndex);
    const cell = block?.holder.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (cell && this.gridElement.contains(cell)) {
      return cell;
    }

    return null;
  }

  /**
   * Ensure a cell has at least one block.
   * If the blocks container is empty, insert an empty paragraph.
   */
  public ensureCellHasBlock(cell: HTMLElement): void {
    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const hasBlocks = container.querySelector('[data-blok-id]') !== null;

    if (hasBlocks) {
      return;
    }

    const block = this.api.blocks.insert('paragraph', { text: '' }, {}, undefined, true);

    container.appendChild(block.holder);
  }

  /**
   * Handle block mutation events from the editor.
   * When a block is added, check if it should be claimed by a cell.
   * When a block is removed, ensure no cell is left empty.
   */
  private handleBlockMutation = (data: unknown): void => {
    if (!this.isBlockMutationEvent(data)) {
      return;
    }

    const { type, detail } = data.event;

    if (type === 'block-removed') {
      // Check all cells in grid for empty containers
      const cells = this.gridElement.querySelectorAll(`[${CELL_ATTR}]`);

      cells.forEach(cell => {
        this.ensureCellHasBlock(cell as HTMLElement);
      });

      return;
    }

    if (type !== 'block-added') {
      return;
    }

    const blockIndex = detail.index;

    if (blockIndex === undefined) {
      return;
    }

    // Check if new block's holder is already in a cell (no action needed)
    const holder = detail.target.holder;

    if (holder.closest(`[${CELL_BLOCKS_ATTR}]`)) {
      return;
    }

    // Check if this block should be in a cell
    const cell = this.findCellForNewBlock(blockIndex);

    if (cell) {
      this.claimBlockForCell(cell, detail.target.id);
    }
  };

  /**
   * Type guard for block mutation event payload
   */
  private isBlockMutationEvent(data: unknown): data is {
    event: {
      type: string;
      detail: {
        target: { id: string; holder: HTMLElement };
        index?: number;
      };
    };
  } {
    return (
      typeof data === 'object' &&
      data !== null &&
      'event' in data &&
      typeof (data as Record<string, unknown>).event === 'object' &&
      (data as Record<string, unknown>).event !== null
    );
  }

  /**
   * Collect all block IDs from the given cell elements
   */
  public getBlockIdsFromCells(cells: NodeListOf<Element> | Element[]): string[] {
    const blockIds: string[] = [];
    const cellArray = Array.from(cells);

    cellArray.forEach(cell => {
      const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

      if (!container) {
        return;
      }

      container.querySelectorAll('[data-blok-id]').forEach(block => {
        const id = block.getAttribute('data-blok-id');

        if (id) {
          blockIds.push(id);
        }
      });
    });

    return blockIds;
  }

  /**
   * Delete blocks by their IDs (in reverse index order to avoid shifting issues)
   */
  public deleteBlocks(blockIds: string[]): void {
    const blockIndices = blockIds
      .map(id => this.api.blocks.getBlockIndex(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => b - a);

    blockIndices.forEach(index => {
      void this.api.blocks.delete(index);
    });
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.api.events.off('block changed', this.handleBlockMutation);
    this._activeCellWithBlocks = null;
  }
}
