import type { API } from '../../../types';

import { CELL_ATTR, ROW_ATTR } from './table-core';
import type { TableModel } from './table-model';
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
  model: TableModel;
  onNavigateToCell?: CellNavigationCallback;
  /** When true, handleBlockMutation defers events instead of processing immediately. */
  isStructuralOpActive?: () => boolean;
}

/**
 * Manages nested blocks within table cells.
 * Handles block lifecycle and keyboard navigation.
 */
export class TableCellBlocks {
  private api: API;
  private gridElement: HTMLElement;
  private tableBlockId: string;
  private model: TableModel;
  private _activeCellWithBlocks: CellPosition | null = null;
  private onNavigateToCell?: CellNavigationCallback;

  /**
   * Cells that need an empty-check after a block-removed event.
   * A pending microtask will call ensureCellHasBlock for each cell still in this Set.
   * If a block-added event claims a block into a cell before the microtask runs,
   * that cell is removed from the Set, cancelling the check.
   */
  private cellsPendingCheck = new Set<HTMLElement>();
  private pendingCheckScheduled = false;

  /**
   * Maps a removed block's ID to the cell it was in and its flat-list index
   * when block-removed fired.
   *
   * Used during replace operations: block-removed fires while the holder is
   * still in the cell DOM, then block-added fires at the same index after the
   * holder has been removed. This map lets the block-added handler find the
   * correct cell.
   *
   * Keyed by block ID (not flat index) to prevent two classes of bugs:
   * - Non-replace deletion + coincidental same-index insertion claiming the
   *   wrong cell.
   * - Cross-table interference when two TableCellBlocks instances both
   *   subscribe to the global "block changed" event.
   */
  private removedBlockCells = new Map<string, { cell: HTMLElement; index: number }>();

  /** Callback to check if a structural operation is active on the parent Table. */
  private isStructuralOpActive: () => boolean;

  /** Events deferred during structural operations, replayed or discarded afterward. */
  private deferredEvents: Array<unknown> = [];

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
    this.model = options.model;
    this.onNavigateToCell = options.onNavigateToCell;
    this.isStructuralOpActive = options.isStructuralOpActive ?? (() => false);

    this.api.events.on('block changed', this.handleBlockMutation);
    this.gridElement.addEventListener('click', this.handleCellBlankSpaceClick);
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
   * - If referenced blocks are missing from BlockManager, a fallback paragraph is created.
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

        const referencedBlockIds = isCellWithBlocks(cellContent) && cellContent.blocks.length > 0
          ? [...cellContent.blocks]
          : null;
        const mountedIds = referencedBlockIds
          ? this.mountBlocksInCell(container, referencedBlockIds)
          : [];

        if (mountedIds.length > 0) {
          normalizedRow.push({ blocks: referencedBlockIds ?? mountedIds });
        } else {
          const text = typeof cellContent === 'string' ? cellContent : '';
          const segments = text.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
          const textsToInsert = segments.length > 0 ? segments : [text];
          const ids: string[] = [];

          for (const segmentText of textsToInsert) {
            const block = this.api.blocks.insert('paragraph', { text: segmentText }, {}, this.api.blocks.getBlocksCount(), false);

            container.appendChild(block.holder);
            this.api.blocks.setBlockParent(block.id, this.tableBlockId);
            ids.push(block.id);
          }

          normalizedRow.push({
            blocks: referencedBlockIds === null
              ? ids
              : [...referencedBlockIds, ...ids],
          });
        }

        this.stripPlaceholders(container);
      });

      normalizedContent.push(normalizedRow);
    });

    return normalizedContent;
  }

  /**
   * Remove placeholder attributes from contenteditable elements inside a cell container.
   * Blocks in table cells should feel like plain table fields, not standalone paragraphs.
   */
  private stripPlaceholders(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>('[data-blok-placeholder-active]').forEach(el => {
      el.removeAttribute('data-blok-placeholder-active');
    });
    container.querySelectorAll<HTMLElement>('[data-placeholder]').forEach(el => {
      el.removeAttribute('data-placeholder');
    });
  }

  /**
   * Mount existing blocks into a cell container by their IDs.
   * Returns the IDs of blocks that were successfully mounted.
   */
  private mountBlocksInCell(container: HTMLElement, blockIds: string[]): string[] {
    const mountedIds: string[] = [];

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
      this.api.blocks.setBlockParent(blockId, this.tableBlockId);
      mountedIds.push(blockId);
    }

    return mountedIds;
  }

  /**
   * Move a block's DOM holder into a cell's blocks container.
   */
  public claimBlockForCell(cell: HTMLElement, blockId: string): void {
    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

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
    this.api.blocks.setBlockParent(blockId, this.tableBlockId);
    this.stripPlaceholders(container);
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

    const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), true);

    container.appendChild(block.holder);
    this.api.blocks.setBlockParent(block.id, this.tableBlockId);
    this.syncBlockToModel(cell, block.id);
    this.stripPlaceholders(container);
  }

  /**
   * Handle block mutation events from the editor.
   * When a block is added, check if it should be claimed by a cell.
   * When a block is removed, ensure no cell is left empty.
   */
  private handleBlockMutation = (data: unknown): void => {
    if (this.isStructuralOpActive()) {
      this.deferredEvents.push(data);

      return;
    }

    if (!this.isBlockMutationEvent(data)) {
      return;
    }

    const { type, detail } = data.event;

    if (type === 'block-removed') {
      this.handleBlockRemoved(detail);

      return;
    }

    if (type !== 'block-added') {
      return;
    }

    const blockIndex = detail.index;

    if (blockIndex === undefined) {
      return;
    }

    // Check if a block was just removed at this index (replace operation).
    // Use the recorded cell so the replacement lands in the correct cell.
    // The map is keyed by the removed block's ID, so we iterate to find an
    // entry whose stored index matches the newly added block's index.
    const removedEntry = this.findRemovedEntryForIndex(blockIndex);

    // For replace operations, always move the block to the recorded cell.
    // blocksStore.insert() places the holder adjacent to the previous block
    // in the DOM, which may be inside a different cell.
    // Guard: verify the new block actually belongs to this table by checking
    // that an adjacent block is either the table block itself or a block
    // mounted inside this table's grid.
    if (removedEntry && this.isAdjacentToThisTable(blockIndex)) {
      this.claimBlockForCell(removedEntry.cell, detail.target.id);
      this.syncBlockToModel(removedEntry.cell, detail.target.id);
      this.cellsPendingCheck.delete(removedEntry.cell);

      return;
    }

    // For non-replace inserts: if the holder is already in a cell (placed
    // by insertToDOM next to an adjacent cell block), just strip placeholders.
    const holder = detail.target.holder;
    const existingContainer = holder.closest<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (existingContainer) {
      this.stripPlaceholders(existingContainer);
    }

    // Sync to model if holder landed in a cell but isn't tracked yet (e.g. toolbox conversion)
    const untrackedCell = existingContainer && !this.model.findCellForBlock(detail.target.id)
      ? existingContainer.closest<HTMLElement>(`[${CELL_ATTR}]`)
      : null;

    if (untrackedCell) {
      this.syncBlockToModel(untrackedCell, detail.target.id);
    }

    if (existingContainer) {
      return;
    }

    // Only claim blocks whose holder is inside this table's grid.
    // Blocks placed outside the grid (e.g., via replaceWith during toolbox
    // insertion) should not be pulled into a cell by adjacency.
    if (!this.gridElement.contains(holder)) {
      return;
    }

    // Check if this block should be in a cell based on adjacency
    const cell = this.findCellForNewBlock(blockIndex);

    if (cell) {
      this.claimBlockForCell(cell, detail.target.id);
      this.syncBlockToModel(cell, detail.target.id);
      this.cellsPendingCheck.delete(cell);
    }
  };

  /**
   * Handle a block-removed event: update the model and schedule an empty-cell check.
   */
  private handleBlockRemoved(detail: { target: { id: string; holder: HTMLElement }; index?: number }): void {
    this.recordRemovedBlockCell(detail);
    const blockId = detail.target.id;
    const cellPos = this.model.findCellForBlock(blockId);

    if (!cellPos) {
      this.schedulePendingCellCheck();

      return;
    }

    this.model.removeBlockFromCell(cellPos.row, cellPos.col, blockId);
    const affectedCell = this.getCell(cellPos.row, cellPos.col);

    if (affectedCell) {
      this.cellsPendingCheck.add(affectedCell);
    }

    this.schedulePendingCellCheck();
  }

  /**
   * Find the DOM cell's row/col position and add the block to the model.
   */
  private syncBlockToModel(cell: HTMLElement, blockId: string): void {
    const pos = this.getCellPosition(cell);

    if (pos) {
      this.model.addBlockToCell(pos.row, pos.col, blockId);
    }
  }

  /**
   * Get the row/col position of a cell element within the grid.
   */
  private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
    const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

    if (!row) {
      return null;
    }

    const rows = Array.from(this.gridElement.querySelectorAll(`[${ROW_ATTR}]`));
    const rowIndex = rows.indexOf(row);

    if (rowIndex < 0) {
      return null;
    }

    const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
    const colIndex = cells.indexOf(cell);

    if (colIndex < 0) {
      return null;
    }

    return { row: rowIndex, col: colIndex };
  }

  /**
   * If the removed block's holder is currently inside a cell of this table,
   * record the mapping so a subsequent block-added at the same index can
   * find the correct cell.
   */
  private recordRemovedBlockCell(detail: { target: { id: string; holder: HTMLElement }; index?: number }): void {
    if (detail.index === undefined) {
      return;
    }

    const cell = detail.target.holder.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (cell && this.gridElement.contains(cell)) {
      this.removedBlockCells.set(detail.target.id, { cell, index: detail.index });
    }
  }

  /**
   * Find a removedBlockCells entry whose stored index matches the given block index.
   * Removes and returns the first match, or null if none found.
   */
  private findRemovedEntryForIndex(blockIndex: number): { cell: HTMLElement; index: number } | null {
    for (const [removedId, entry] of this.removedBlockCells) {
      if (entry.index === blockIndex) {
        this.removedBlockCells.delete(removedId);

        return entry;
      }
    }

    return null;
  }

  /**
   * Resolve a block id to a cell only when this table model explicitly tracks
   * that block in one of this table's cells.
   */
  private getOwnedCellForBlock(blockId: string): HTMLElement | null {
    const cellPos = this.model.findCellForBlock(blockId);

    if (!cellPos) {
      return null;
    }

    const cell = this.getCell(cellPos.row, cellPos.col);

    return cell && this.gridElement.contains(cell) ? cell : null;
  }

  /**
   * Check whether a block at the given flat-list index belongs to this table's
   * block range. Used to prevent cross-table interference when two
   * TableCellBlocks instances both subscribe to the global "block changed" event.
   *
   * Returns true if:
   * - An adjacent block (index-1 or index+1) is mounted inside a cell of this
   *   table's grid, OR
   * - The table block is immediately before this index AND either the index
   *   after is also within this table (block in a cell) or does not exist
   *   (the new block is the last in the flat list).
   *
   * The table block alone being adjacent is NOT sufficient — a second table
   * could immediately follow this one in the flat list, making the table
   * block adjacent to BOTH tables' blocks.
   */
  private isAdjacentToThisTable(blockIndex: number): boolean {
    const blocksCount = this.api.blocks.getBlocksCount();

    // Check if any adjacent block is explicitly tracked by this table model.
    for (const offset of [-1, 1]) {
      const adjacentIndex = blockIndex + offset;

      if (adjacentIndex < 0 || adjacentIndex >= blocksCount) {
        continue;
      }

      const block = this.api.blocks.getBlockByIndex(adjacentIndex);

      if (!block) {
        continue;
      }

      if (this.getOwnedCellForBlock(block.id)) {
        return true;
      }
    }

    // For single-block-in-cell tables: the table block is at index-1 and
    // either (a) no block follows at index+1, or (b) the block at index+1
    // is inside this table's grid. This avoids matching blocks that belong
    // to a different table immediately following this one.
    if (!this.isTableBlockAtPrevIndex(blockIndex)) {
      return false;
    }

    const nextIndex = blockIndex + 1;

    if (nextIndex >= blocksCount) {
      return true;
    }

    const nextBlock = this.api.blocks.getBlockByIndex(nextIndex);

    if (!nextBlock) {
      return true;
    }

    return this.getOwnedCellForBlock(nextBlock.id) !== null;
  }

  /**
   * Check if this table's block is at the index immediately before the given index.
   */
  private isTableBlockAtPrevIndex(blockIndex: number): boolean {
    const prevIndex = blockIndex - 1;

    if (prevIndex < 0) {
      return false;
    }

    const prevBlock = this.api.blocks.getBlockByIndex(prevIndex);

    return prevBlock?.id === this.tableBlockId;
  }

  /**
   * Schedule a microtask to run ensureCellHasBlock for all cells still pending.
   * If a block-added event removes a cell from the pending set before the microtask runs,
   * that cell's check is effectively cancelled.
   */
  private schedulePendingCellCheck(): void {
    if (this.pendingCheckScheduled) {
      return;
    }

    this.pendingCheckScheduled = true;

    queueMicrotask(() => {
      this.pendingCheckScheduled = false;

      for (const cell of this.cellsPendingCheck) {
        this.ensureCellHasBlock(cell);
      }

      this.cellsPendingCheck.clear();
      this.removedBlockCells.clear();
    });
  }

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
   * Delete all blocks managed by this table from the BlockManager.
   * Called before the table block itself is removed to prevent orphaned cell blocks.
   */
  public deleteAllBlocks(): void {
    const allCells = this.gridElement.querySelectorAll(`[${CELL_ATTR}]`);
    const blockIds = this.getBlockIdsFromCells(allCells);

    this.deleteBlocks(blockIds);
  }

  /**
   * Handle clicks on blank cell space.
   * When a click lands on the cell or blocks container (not on block content),
   * set the caret to the end of the last block in that cell.
   */
  private handleCellBlankSpaceClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;

    if (!target) {
      return;
    }

    const isCell = target.hasAttribute(CELL_ATTR);
    const isBlocksContainer = target.hasAttribute(CELL_BLOCKS_ATTR);

    if (!isCell && !isBlocksContainer) {
      return;
    }

    const cell = isCell ? target : target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    const container = isCell
      ? cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`)
      : target;

    if (!container) {
      return;
    }

    const blockHolders = container.querySelectorAll('[data-blok-id]');
    const lastHolder = blockHolders[blockHolders.length - 1];

    if (!lastHolder) {
      return;
    }

    const blockId = lastHolder.getAttribute('data-blok-id');

    if (!blockId) {
      return;
    }

    this.api.caret.setToBlock(blockId, 'end');
  };

  /**
   * Clean up event listeners
   */
  destroy(): void {
    this.gridElement.removeEventListener('click', this.handleCellBlankSpaceClick);
    this.api.events.off('block changed', this.handleBlockMutation);
    this._activeCellWithBlocks = null;
    this.cellsPendingCheck.clear();
    this.removedBlockCells.clear();
    this.deferredEvents.length = 0;
  }

  /**
   * Replay all deferred events. Called after interactive structural ops
   * (add/delete/move row/col) complete so block lifecycle events are processed.
   */
  public flushDeferredEvents(): void {
    const events = [...this.deferredEvents];

    this.deferredEvents.length = 0;

    for (const data of events) {
      this.handleBlockMutation(data);
    }
  }

  /**
   * Discard all deferred events. Called after full-rebuild ops (setData, onPaste)
   * where the entire grid is replaced and old events are meaningless.
   */
  public discardDeferredEvents(): void {
    this.deferredEvents.length = 0;
  }
}
