import type { API } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';

import { CELL_ATTR, ROW_ATTR, CELL_COL_ATTR } from './table-core';
import type { TableModel } from './table-model';
import type { LegacyCellContent, CellContent } from './types';
import { isCellWithBlocks } from './types';

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

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

  /** When true, handleBlockMutation skips claiming so exitTableForward's new block stays outside the grid. */
  private isExitingTable = false;

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

    // ArrowDown at last row -> exit table (skip if already handled by block-level navigation)
    if (event.key === 'ArrowDown' && !event.defaultPrevented && position.row === this.getRowCount() - 1) {
      event.preventDefault();
      this.exitTableForward();
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

      return;
    }

    // At the very last cell — exit the table by focusing or creating a block below
    this.exitTableForward();
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

      return;
    }

    // At the very first cell — exit the table by focusing the block above
    this.exitTableBackward();
  }

  /**
   * Exit the table by focusing the first block after it, or creating one if none exists.
   */
  private exitTableForward(): void {
    const tableIndex = this.api.blocks.getBlockIndex(this.tableBlockId);

    if (tableIndex === undefined) {
      return;
    }

    const blockAfterTable = this.findFirstBlockAfterTable(tableIndex);

    if (blockAfterTable !== null) {
      this.api.caret.setToBlock(blockAfterTable.id, 'start');

      return;
    }

    /**
     * No block after the table — create a new default block.
     * Set isExitingTable so handleBlockMutation does not claim the new block
     * into a cell (the block-added event fires synchronously during insert).
     */
    this.isExitingTable = true;

    try {
      const totalBlocks = this.api.blocks.getBlocksCount();
      const newBlock = this.api.blocks.insert(undefined, {}, {}, totalBlocks, true);

      /**
       * insertToDOM places the new block's holder adjacent (afterend) to the last
       * block in the flat array, which is a cell paragraph inside the table grid.
       * Move the holder out of the grid so focus lands outside the table.
       */
      const tableBlockApi = this.gridElement.contains(newBlock.holder)
        ? this.api.blocks.getBlockByIndex(tableIndex)
        : null;

      if (tableBlockApi) {
        tableBlockApi.holder.after(newBlock.holder);
      }

      this.api.caret.setToBlock(newBlock.id, 'start');
    } finally {
      this.isExitingTable = false;
    }
  }

  /**
   * Exit the table backward by focusing the block before the table.
   * If no block exists before the table, do nothing.
   */
  private exitTableBackward(): void {
    const tableIndex = this.api.blocks.getBlockIndex(this.tableBlockId);

    if (tableIndex === undefined || tableIndex === 0) {
      return;
    }

    // The block immediately before the table in the flat array
    const blockBefore = this.api.blocks.getBlockByIndex(tableIndex - 1);

    if (blockBefore) {
      this.api.caret.setToBlock(blockBefore.id, 'end');
    }
  }

  /**
   * Scan the flat block array starting after the table block, skipping all blocks
   * whose holder is inside the table grid, and return the first non-child block.
   * Returns null if no such block exists.
   */
  private findFirstBlockAfterTable(tableIndex: number): { id: string } | null {
    const totalBlocks = this.api.blocks.getBlocksCount();
    const candidates = Array.from({ length: totalBlocks - tableIndex - 1 }, (_, offset) =>
      this.api.blocks.getBlockByIndex(tableIndex + 1 + offset)
    );

    return candidates.find(block =>
      block !== null && block !== undefined && !this.gridElement.contains(block.holder)
    ) ?? null;
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
    const colgroup = this.gridElement.querySelector('colgroup');

    if (colgroup) {
      return colgroup.querySelectorAll('col').length;
    }

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

    return rowEl.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${col}"]`) ?? null;
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

      const normalizedRow: CellContent[] = [];

      rowData.forEach((cellContent, colIndex) => {
        const cell = row.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${colIndex}"]`);

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
        const { mountedIds, replacements } = referencedBlockIds
          ? this.mountBlocksInCell(container, referencedBlockIds)
          : { mountedIds: [] as string[], replacements: new Map<string, string>() };

        const cellColorProps: Pick<CellContent, 'color' | 'textColor'> = {};

        if (isCellWithBlocks(cellContent)) {
          if (cellContent.color !== undefined) {
            cellColorProps.color = cellContent.color;
          }
          if (cellContent.textColor !== undefined) {
            cellColorProps.textColor = cellContent.textColor;
          }
        }

        if (mountedIds.length > 0) {
          const baseIds = referencedBlockIds ?? mountedIds;
          const blockIds = replacements.size > 0
            ? baseIds.map(id => replacements.get(id) ?? id)
            : baseIds;

          normalizedRow.push({ blocks: blockIds, ...cellColorProps });
        } else {
          const text = typeof cellContent === 'string'
            ? cellContent
            : (cellContent.text ?? '');
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
            ...cellColorProps,
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
   * Returns the IDs of blocks that were successfully mounted and a map of
   * original→duplicate IDs for blocks that were already in another cell.
   */
  private mountBlocksInCell(
    container: HTMLElement,
    blockIds: string[]
  ): { mountedIds: string[]; replacements: Map<string, string> } {
    const mountedIds: string[] = [];
    const replacements = new Map<string, string>();

    for (const blockId of blockIds) {
      const index = this.api.blocks.getBlockIndex(blockId);

      if (index === undefined) {
        continue;
      }

      const block = this.api.blocks.getBlockByIndex(index);

      if (!block) {
        continue;
      }

      // Guard: if the block is already mounted in another nested container
      // (table cell, toggle, callout, header), OR its parentId already points
      // to a different owner (race window where another table has claimed it
      // via flat-list parent field but has not yet mounted its DOM), create a
      // duplicate with the same tool name and data rather than stealing.
      const hasDifferentOwner = block.parentId != null
        && block.parentId !== ''
        && block.parentId !== this.tableBlockId;

      if (block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`) || hasDifferentOwner) {
        const duplicate = this.api.blocks.insert(
          block.name,
          block.preservedData,
          {},
          this.api.blocks.getBlocksCount(),
          false
        );

        container.appendChild(duplicate.holder);
        this.api.blocks.setBlockParent(duplicate.id, this.tableBlockId);
        mountedIds.push(duplicate.id);
        replacements.set(blockId, duplicate.id);
        continue;
      }

      container.appendChild(block.holder);
      this.api.blocks.setBlockParent(blockId, this.tableBlockId);
      mountedIds.push(blockId);
    }
    return { mountedIds, replacements };
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

    // Guard against circular DOM: never append the table block's own holder
    // into one of its descendant cell containers.
    if (block.holder.contains(container)) {
      return;
    }

    // Guard: skip blocks already mounted in another nested container, or whose
    // parentId already points to a different owner (race window where another
    // table has claimed the block via flat-list parent field but has not yet
    // mounted its DOM). Without this, insertBefore would steal the DOM node.
    const hasDifferentOwner = block.parentId != null
      && block.parentId !== ''
      && block.parentId !== this.tableBlockId;

    if (block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`) || hasDifferentOwner) {
      return;
    }

    // Insert at the correct DOM position based on the flat array order,
    // so that pressing Enter on a non-last paragraph inserts the new block
    // right after the current one instead of always at the end of the cell.
    const blocksCount = this.api.blocks.getBlocksCount();
    const nextSiblingHolder = Array.from(
      { length: blocksCount - index - 1 },
      (_, offset) => this.api.blocks.getBlockByIndex(index + 1 + offset)
    ).find(
      candidate => candidate?.holder.parentElement === container
    )?.holder ?? null;

    // insertBefore(el, null) is equivalent to appendChild
    container.insertBefore(block.holder, nextSiblingHolder);
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

    // Wrap in transactWithoutCapture so this auto-repair insertion does not
    // pollute the undo history. If a drag or other operation causes a cell to
    // temporarily lose its block, the repair should be invisible to undo/redo.
    this.api.blocks.transactWithoutCapture?.(() => {
      const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), true);

      container.appendChild(block.holder);
      this.api.blocks.setBlockParent(block.id, this.tableBlockId);
      this.syncBlockToModel(cell, block.id);
      this.stripPlaceholders(container);
    });
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

    if (this.isExitingTable) {
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

    if (type === 'block-moved') {
      this.handleBlockMoved(detail);

      return;
    }

    if (type !== 'block-added') {
      return;
    }

    // Never claim the table block itself as a cell content block.
    // This can happen when rendered() creates cell blocks synchronously,
    // polluting currentBlockIndex before the table's own block-added fires.
    if (detail.target.id === this.tableBlockId) {
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
    // Blocks placed outside the grid (e.g., via undo/restore or API inserts)
    // should not be pulled into a cell by adjacency alone.
    //
    // However, blocks created while the editor's focus is inside this table
    // (e.g., via Enter key or paste in a cell) land outside the grid because
    // insertToDOM walks up from cell blocks to the table holder level.
    // For those, check that the current block at the time of insertion belongs
    // to this table — indicating the user was editing inside a cell.
    if (!this.gridElement.contains(holder)) {
      // If the holder is outside the table block's own wrapper (e.g. placed
      // directly in the editor working area via appendToWorkingArea), it is
      // a top-level block and must not be claimed into a cell.
      const tableBlockIdx = this.api.blocks.getBlockIndex(this.tableBlockId);
      const tableBlockApi = tableBlockIdx !== undefined
        ? this.api.blocks.getBlockByIndex(tableBlockIdx)
        : null;

      if (tableBlockApi && !tableBlockApi.holder.contains(holder)) {
        return;
      }

      const currentIndex = this.api.blocks.getCurrentBlockIndex();
      const currentBlock = currentIndex >= 0
        ? this.api.blocks.getBlockByIndex(currentIndex)
        : null;
      const currentBlockInOurTable = currentBlock !== null
        && currentBlock !== undefined
        && this.getOwnedCellForBlock(currentBlock.id) !== null;

      if (!currentBlockInOurTable) {
        return;
      }

      const cell = this.findCellForNewBlock(blockIndex);

      if (cell) {
        this.claimBlockForCell(cell, detail.target.id);
        this.syncBlockToModel(cell, detail.target.id);
        this.cellsPendingCheck.delete(cell);
      }

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
   * Handle a block-moved event: if the block left this table (its holder is
   * no longer inside our grid), remove the stale reference from the model.
   *
   * Without this, cross-table moves leave ghost entries in the source table's
   * model, causing the same block ID to appear in two tables' saved data.
   */
  private handleBlockMoved(detail: { target: { id: string; holder: HTMLElement } }): void {
    const blockId = detail.target.id;
    const cellPos = this.model.findCellForBlock(blockId);

    if (!cellPos) {
      return;
    }

    // If the holder is still inside our grid, the block was moved within
    // this table — nothing to clean up.
    if (this.gridElement.contains(detail.target.holder)) {
      return;
    }

    this.model.removeBlockFromCell(cellPos.row, cellPos.col, blockId);
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

      // During a Yjs undo/redo sync, cell blocks are restored by initializeCells()
      // which runs shortly after. Inserting a phantom block here would race with
      // that restoration and leave the cell with a duplicate/wrong block.
      if (!this.api.blocks.isSyncingFromYjs) {
        for (const cell of this.cellsPendingCheck) {
          this.ensureCellHasBlock(cell);
        }
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
   * Delete blocks by their IDs (in reverse index order to avoid shifting issues).
   * Preserves scroll position because api.blocks.delete() is async — its internal
   * `await` defers Caret.setToBlock() to microtasks that run AFTER this method returns,
   * causing unwanted page jumps via element.focus() and window.scrollBy().
   * We use Promise.all().then() to schedule the scroll restore after all those microtasks.
   */
  public deleteBlocks(blockIds: string[]): void {
    const blockIndices = blockIds
      .map(id => this.api.blocks.getBlockIndex(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => b - a);

    const savedScrollY = window.scrollY;

    const deletePromises = blockIndices.map(index => {
      return this.api.blocks.delete(index);
    });

    void Promise.all(deletePromises).then(() => {
      if (window.scrollY !== savedScrollY) {
        window.scrollTo(0, savedScrollY);
      }
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
