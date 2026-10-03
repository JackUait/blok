import type { API, BlockAPI } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { hasCrossHostSelectionWithin } from '../../components/selection/cross-block-range';
import { getElementDirection, logicalArrow } from '../../components/utils/direction';
import {
  isCaretAtStartOfInput,
  isCaretAtEndOfInput,
  isCaretAtFirstLine,
  isCaretAtLastLine,
  focus,
} from '../../components/utils/caret';

import { CELL_ATTR, ROW_ATTR, CELL_COL_ATTR, ownCells, ownRows } from './table-core';
import { cellBlockFallbackText, parseCellContentToBlocks } from './table-cell-paste';
import type { CellBlockInsert } from './table-cell-paste';
import { getCellPosition } from './table-operations';
import type { TableModel } from './table-model';
import type { ClipboardBlockData, LegacyCellContent, CellContent } from './types';
import { isCellWithBlocks } from './types';
import { cellKey, pickTableIds } from './table-ids';

/**
 * A cell as initializeCells reads it. `leadingText` is a text-only origin's
 * own legacy text, shown before blocks the merge repair moved into it.
 */
export type InitCellContent = LegacyCellContent | (CellContent & { leadingText?: string });

export const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

/**
 * A block and its nested children as clipboard data, read from the live tree.
 */
export const toClipboardBlock = (api: API, block: BlockAPI): ClipboardBlockData => {
  const children = api.blocks.getChildren(block.id).map(child => toClipboardBlock(api, child));

  return {
    tool: block.name,
    data: block.preservedData,
    ...(Object.keys(block.preservedTunes).length > 0 ? { tunes: block.preservedTunes } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
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
  /**
   * Called when a cell stops referencing a block — the one table data change
   * nothing else announces. See {@link TableCellBlocks.signalCellReferenceDropped}.
   */
  onCellReferenceDropped?: () => void;
  /**
   * Ids of the stand-ins this editor put in emptied cells. Owned by the table,
   * not by this object: a setData rebuild replaces this object.
   */
  repairIds?: Set<string>;
  /** Stand-ins this editor put in cells a merge padded. Owned by the table, like `repairIds`. */
  paddedFillIds?: Set<string>;
  /** Blocks this editor made from legacy cell text, by id. Owned by the table, like `repairIds`. */
  convertedBlocks?: Map<string, ConvertedBlock>;
}

/** Where a block made from legacy cell text was put, and the data it was made with. */
export interface ConvertedBlock {
  row: number;
  col: number;
  index: number;
  minted: string;
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

  /** Set by destroy so a frame queued before it cannot repair a table that is gone. */
  private isDestroyed = false;

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

  /** Tells the parent Table its cell references changed. */
  private onCellReferenceDropped?: () => void;

  /** Events deferred during structural operations, replayed or discarded afterward. */
  private deferredEvents: Array<unknown> = [];

  /** When true, handleBlockMutation skips claiming so exitTableForward's new block stays outside the grid. */
  private isExitingTable = false;

  /**
   * Synced children of this table whose cell the table data has not named
   * yet. save() must not harvest them into the cell they happen to sit in.
   */
  private readonly blocksAwaitingCell = new Set<string>();

  /** When true, ensureCellHasBlock is inserting its own repair block — skip claim heuristics for it. */
  private isRepairingCell = false;

  /** Ids the running initializeCells pass has mounted, so a second reference to one is not a park. */
  private readonly mountedThisPass = new Set<string>();

  /** Saved text of cells whose block ids had not arrived, by their ids; used if they never do. */
  private readonly fallbackTexts = new Map<string, string>();

  /** Keys like fallbackTexts, for a peer's cell: that peer writes the text, so this editor adds nothing. */
  private readonly peerFallbackCells = new Set<string>();

  private readonly repairIds: Set<string>;

  private readonly convertedBlocks: Map<string, ConvertedBlock>;

  private readonly paddedFillIds: Set<string>;

  constructor(options: TableCellBlocksOptions) {
    this.api = options.api;
    this.gridElement = options.gridElement;
    this.tableBlockId = options.tableBlockId;
    this.model = options.model;
    this.onNavigateToCell = options.onNavigateToCell;
    this.isStructuralOpActive = options.isStructuralOpActive ?? (() => false);
    this.onCellReferenceDropped = options.onCellReferenceDropped;
    this.repairIds = options.repairIds ?? new Set();
    this.convertedBlocks = options.convertedBlocks ?? new Map<string, ConvertedBlock>();
    this.paddedFillIds = options.paddedFillIds ?? new Set();

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
   * Grid-aware caret navigation for the four arrow keys, matching Notion:
   * - Up/Down move the caret to the cell directly above/below in the SAME column;
   * - Left/Right cross into the cell visually on the arrow's side (grid order)
   *   once the caret is at that edge of the cell's text (text direction);
   * - at the outer grid edge the caret exits the table (forward/backward).
   *
   * Runs in the CAPTURE phase (registered by setupKeyboardNavigation) so it acts
   * BEFORE core's block-level keydown handler — which otherwise bails out of the
   * whole table at a cell boundary. Only the boundary case is intercepted:
   * mid-cell moves (another line or another block still inside the cell) fall
   * through untouched so core/native handle within-cell movement.
   *
   * @param event - the keydown event (capture phase)
   * @param position - the logical position of the cell holding the caret
   */
  handleArrowNavigation(event: KeyboardEvent, position: CellPosition): void {
    // Modified arrows are native gestures (word/line/doc moves, selection) — leave them.
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const caretInput = this.resolveCaretInput();
    const lastRow = this.getRowCount() - 1;

    switch (event.key) {
      case 'ArrowDown': {
        // Not yet at the cell's bottom edge — let core/native move within the cell.
        if (caretInput !== null && !(isCaretAtLastLine(caretInput) && this.isCaretInLastCellBlock(caretInput))) {
          return;
        }

        const below = position.row < lastRow ? this.findCellInColumn(position, 1) : null;

        this.commitArrowNavigation(event, () => below ? this.navigateToCell(below) : this.exitTableForward());
        break;
      }
      case 'ArrowUp': {
        if (caretInput !== null && !(isCaretAtFirstLine(caretInput) && this.isCaretInFirstCellBlock(caretInput))) {
          return;
        }

        const above = position.row > 0 ? this.findCellInColumn(position, -1) : null;

        this.commitArrowNavigation(event, () => above ? this.navigateToCell(above, true) : this.exitTableBackward());
        break;
      }
      case 'ArrowRight':
      case 'ArrowLeft':
        this.handleInlineArrow(event, position, caretInput);
        break;
      default:
    }
  }

  /**
   * Left/Right at the cell's text edge. The edge follows the caret text's
   * direction; the neighbour follows the grid's, so the caret always lands on
   * the cell that is visually on the arrow's side (RTL table, English text).
   */
  private handleInlineArrow(event: KeyboardEvent, position: CellPosition, caretInput: HTMLElement | null): void {
    const source = caretInput ?? (event.target instanceof Element ? event.target : null);
    const textStep = logicalArrow(event.key, getElementDirection(source));
    const gridStep = logicalArrow(event.key, getElementDirection(this.gridElement));

    if (caretInput !== null) {
      const atEdge = textStep === 'forward'
        ? isCaretAtEndOfInput(caretInput) && this.isCaretInLastCellBlock(caretInput)
        : isCaretAtStartOfInput(caretInput) && this.isCaretInFirstCellBlock(caretInput);

      if (!atEdge) {
        return;
      }
    }

    // The caret enters the neighbour on the visual edge facing the cell it left.
    const facingEdge = event.key === 'ArrowLeft' ? 'right' : 'left';

    if (gridStep === 'forward') {
      const next = this.findAdjacentLogicalCell(position, 1);

      this.commitArrowNavigation(event, () => next ? this.navigateToCell(next, false, facingEdge) : this.exitTableForward());

      return;
    }

    const previous = this.findAdjacentLogicalCell(position, -1);

    this.commitArrowNavigation(event, () => previous ? this.navigateToCell(previous, true, facingEdge) : this.exitTableBackward());
  }

  /**
   * Suppress the native caret move AND core's block-level handler (which would
   * exit the table), then run the grid navigation. stopPropagation is safe here
   * because we only reach this after confirming the caret is at a cell edge.
   */
  private commitArrowNavigation(event: KeyboardEvent, navigate: () => void): void {
    event.preventDefault();
    event.stopPropagation();
    navigate();
  }

  /**
   * Resolve the contenteditable that currently holds the caret, or null when no
   * live selection is resolvable (e.g. unit tests dispatching synthetic events).
   * A null result makes the boundary checks degrade to "act on position alone".
   */
  private resolveCaretInput(): HTMLElement | null {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const fromSelection = anchor instanceof Element
      ? anchor.closest<HTMLElement>('[contenteditable="true"]')
      : anchor?.parentElement?.closest<HTMLElement>('[contenteditable="true"]') ?? null;

    if (fromSelection !== null && this.gridElement.contains(fromSelection)) {
      return fromSelection;
    }

    const active = document.activeElement;

    if (active instanceof HTMLElement && this.gridElement.contains(active)) {
      return active.closest<HTMLElement>('[contenteditable="true"]');
    }

    return null;
  }

  /**
   * The top-level cell block (direct child of the cell's blocks container) that
   * holds the given caret input, or null if the input is not inside a cell.
   */
  private cellBlockOf(caretInput: HTMLElement): HTMLElement | null {
    const container = caretInput.closest<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (container === null) {
      return null;
    }

    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.contains(caretInput)) {
        return child;
      }
    }

    return null;
  }

  /** True when the caret is inside the FIRST block of its cell (or unknowable). */
  private isCaretInFirstCellBlock(caretInput: HTMLElement): boolean {
    const block = this.cellBlockOf(caretInput);

    return block === null || block.previousElementSibling === null;
  }

  /** True when the caret is inside the LAST block of its cell (or unknowable). */
  private isCaretInLastCellBlock(caretInput: HTMLElement): boolean {
    const block = this.cellBlockOf(caretInput);

    return block === null || block.nextElementSibling === null;
  }

  /**
   * Walk the grid vertically from `position` in the SAME column (direction +1 =
   * down, -1 = up), skipping merge-covered rows, and return the first non-spanned
   * cell. Returns null when the walk runs past the top/bottom edge.
   */
  private findCellInColumn(position: CellPosition, direction: 1 | -1): CellPosition | null {
    const totalRows = this.getRowCount();
    const nextRow = position.row + direction;

    if (nextRow < 0 || nextRow >= totalRows) {
      return null;
    }

    if (this.model.isSpannedCell(nextRow, position.col)) {
      return this.findCellInColumn({ row: nextRow, col: position.col }, direction);
    }

    return { row: nextRow, col: position.col };
  }

  /**
   * Handle Tab navigation to next cell
   */
  private handleTabNavigation(position: CellPosition): void {
    const target = this.findAdjacentLogicalCell(position, 1);

    if (target) {
      this.navigateToCell(target);

      return;
    }

    // At the very last cell — exit the table by focusing or creating a block below
    this.exitTableForward();
  }

  /**
   * Handle Shift+Tab navigation to previous cell
   */
  private handleShiftTabNavigation(position: CellPosition): void {
    const target = this.findAdjacentLogicalCell(position, -1);

    if (target) {
      this.navigateToCell(target, true);

      return;
    }

    // At the very first cell — exit the table by focusing the block above
    this.exitTableBackward();
  }

  /**
   * Walk the logical grid from `position` in reading order (direction +1) or
   * reverse (-1), skipping merge-covered columns, and return the first
   * non-spanned cell. Returns null when the walk runs past the grid edge,
   * signalling the caller to exit the table.
   */
  private findAdjacentLogicalCell(position: CellPosition, direction: 1 | -1): CellPosition | null {
    const totalCols = this.getColumnCount();
    const totalRows = this.getRowCount();
    const next = this.stepLogicalCell(position, direction, totalCols);

    if (next.row < 0 || next.row >= totalRows) {
      return null;
    }

    if (this.model.isSpannedCell(next.row, next.col)) {
      return this.findAdjacentLogicalCell(next, direction);
    }

    return next;
  }

  /**
   * Advance a logical cursor by one cell in reading order (direction +1) or
   * reverse (-1), wrapping across row boundaries.
   */
  private stepLogicalCell(position: CellPosition, direction: 1 | -1, totalCols: number): CellPosition {
    const col = position.col + direction;

    if (col >= totalCols) {
      return { row: position.row + 1, col: 0 };
    }

    if (col < 0) {
      return { row: position.row - 1, col: totalCols - 1 };
    }

    return { row: position.row, col };
  }

  /**
   * Exit the table by focusing the next SIBLING of the table (the next block in
   * the table's own container), or creating one inside that container if the
   * table is the last child.
   *
   * Both lookups are resolved in TREE terms — the table's parentId and its
   * position among its siblings — never by scanning the flat array or the DOM.
   * A flat/DOM scan is container-blind: for a table nested in a column it walks
   * straight past the column boundary and lands on the NEXT column's blocks
   * (caret teleport), and it appends the new block at the end of the flat array
   * with no parent, so it renders inside the column but saves at root.
   */
  private exitTableForward(): void {
    const tableBlock = this.getTableBlock();

    if (tableBlock === null) {
      return;
    }

    const nextSibling = this.findTableSibling(1);

    if (nextSibling !== null) {
      this.api.caret.setToBlock(nextSibling.id, 'start');

      return;
    }

    /**
     * The table is the last block in its container — create a new default block
     * as its next sibling, inside the same container.
     * Set isExitingTable so handleBlockMutation does not claim the new block
     * into a cell (the block-added event fires synchronously during insert).
     */
    this.isExitingTable = true;

    try {
      const newBlock = this.insertBlockAfterTable(tableBlock);

      /**
       * Safety net: if the new holder still landed inside the grid (a cell
       * paragraph happened to be its DOM anchor), move it out so it sits right
       * after the table — inside whatever container the table lives in.
       */
      if (this.gridElement.contains(newBlock.holder)) {
        tableBlock.holder.after(newBlock.holder);
      }

      this.api.caret.setToBlock(newBlock.id, 'start');
    } finally {
      this.isExitingTable = false;
    }
  }

  /**
   * Insert a new default block as the table's next sibling, in the table's own
   * container. A parented table (column, toggle, callout…) uses
   * insertInsideParent so the parent link and the insert form a single atomic
   * operation; a root-level table uses a plain insert. Both land after the
   * table's cell blocks, not between the table and them.
   */
  private insertBlockAfterTable(tableBlock: BlockAPI): BlockAPI {
    const insertIndex = this.indexAfterTableSubtree();

    if (tableBlock.parentId !== null && tableBlock.parentId !== '') {
      return this.api.blocks.insertInsideParent(tableBlock.parentId, insertIndex);
    }

    return this.api.blocks.insert(undefined, {}, {}, insertIndex, true);
  }

  /**
   * The flat index right after this table's last descendant. Cell blocks and
   * the table's next sibling are inserted here: the saver requires the flat
   * array to list a block's descendants right after it (depth-first), and
   * core never moves a table's children for it (tables are self-placing).
   */
  public indexAfterTableSubtree(): number {
    return this.indexAfterSubtreeOf(this.tableBlockId);
  }

  /**
   * Flat index for a new block of `cell`: right after the blocks of the
   * nearest earlier cell that has any, or right after the table. The table's
   * children then stay in grid order, which rebuildTableBody's reorder needs:
   * it can only move blocks inside a cell.
   */
  private indexForCell(cell: HTMLElement): number {
    // A cell's child block may contain another table; its cells are not siblings.
    const cells = Array.from(this.gridElement.querySelectorAll<HTMLElement>(
      `:scope > tbody > [${ROW_ATTR}] > [${CELL_ATTR}], :scope > [${ROW_ATTR}] > [${CELL_ATTR}]`
    ));
    const at = cells.indexOf(cell);

    if (at === -1) {
      return this.indexAfterTableSubtree();
    }

    const lastBefore = cells.slice(0, at).reverse()
      .map(candidate => Array.from(candidate.querySelector(`[${CELL_BLOCKS_ATTR}]`)?.children ?? [])
        .map(child => child.getAttribute('data-blok-id'))
        .filter(id => id !== null)
        .pop())
      .find(id => id !== undefined);

    if (lastBefore !== undefined) {
      return this.indexAfterSubtreeOf(lastBefore);
    }

    const tableIndex = this.api.blocks.getBlockIndex(this.tableBlockId);

    return tableIndex === undefined ? this.api.blocks.getBlocksCount() : tableIndex + 1;
  }

  /**
   * The flat index right after `blockId` and its descendants.
   * @param blockId - the block
   */
  private indexAfterSubtreeOf(blockId: string): number {
    const count = this.api.blocks.getBlocksCount();
    const rootIndex = this.api.blocks.getBlockIndex(blockId);

    if (rootIndex === undefined) {
      return count;
    }

    const inside = new Set<string>([blockId]);
    const firstOutside = Array.from({ length: count - rootIndex - 1 }, (_, i) => rootIndex + 1 + i)
      .find(index => {
        const block = this.api.blocks.getBlockByIndex(index);

        if (block?.parentId == null || !inside.has(block.parentId)) {
          return true;
        }
        inside.add(block.id);

        return false;
      });

    return firstOutside ?? count;
  }

  /**
   * Exit the table backward by focusing the previous SIBLING of the table.
   * If the table is the first block in its container, do nothing — stepping to
   * whatever precedes the table in the flat array would leave the container
   * (e.g. jump into the previous column).
   */
  private exitTableBackward(): void {
    const previousSibling = this.findTableSibling(-1);

    if (previousSibling !== null) {
      this.api.caret.setToBlock(previousSibling.id, 'end');
    }
  }

  /**
   * The table's own block, or null when it is no longer in the document.
   */
  private getTableBlock(): BlockAPI | null {
    const tableIndex = this.api.blocks.getBlockIndex(this.tableBlockId);

    if (tableIndex === undefined) {
      return null;
    }

    return this.api.blocks.getBlockByIndex(tableIndex) ?? null;
  }

  /**
   * The block adjacent to the table AMONG ITS SIBLINGS (same parent), in
   * document order: offset 1 → the next sibling, -1 → the previous one.
   * Returns null when the table is the last (resp. first) child of its parent.
   */
  private findTableSibling(offset: 1 | -1): BlockAPI | null {
    const tableBlock = this.getTableBlock();

    if (tableBlock === null) {
      return null;
    }

    const siblings = this.getSiblingsOf(tableBlock);
    const position = siblings.findIndex(block => block.id === this.tableBlockId);

    if (position === -1) {
      return null;
    }

    return siblings[position + offset] ?? null;
  }

  /**
   * All blocks sharing the table's parent, in document order. Root-level tables
   * have no parent block to ask, so their siblings are the flat array's
   * top-level blocks.
   */
  private getSiblingsOf(tableBlock: BlockAPI): BlockAPI[] {
    const parentId = tableBlock.parentId;

    if (parentId !== null && parentId !== '') {
      return this.api.blocks.getChildren(parentId);
    }

    const totalBlocks = this.api.blocks.getBlocksCount();

    return Array.from({ length: totalBlocks }, (_, index) => this.api.blocks.getBlockByIndex(index))
      .filter((block): block is BlockAPI =>
        block !== null && block !== undefined && (block.parentId === null || block.parentId === '')
      );
  }

  /**
   * Navigate to a different cell, focusing the appropriate contenteditable element
   * @param position - Target cell position
   * @param focusLast - If true, focus the last contenteditable; otherwise focus the first
   * @param facingEdge - visual edge of the target that faces the cell the caret came from
   */
  private navigateToCell(position: CellPosition, focusLast = false, facingEdge?: 'left' | 'right'): void {
    this.clearActiveCellWithBlocks();

    const cell = this.getCell(position.row, position.col);

    if (!cell) {
      return;
    }

    const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const editables = container.querySelectorAll<HTMLElement>('[contenteditable="true"]:not([data-blok-mutation-free])');

    if (editables.length === 0) {
      return;
    }

    const target = focusLast ? editables[editables.length - 1] : editables[0];

    if (facingEdge !== undefined) {
      // The edge facing the source cell is the text's start or end by its own direction.
      const atStart = (facingEdge === 'left') === (getElementDirection(target) === 'ltr');

      focus(atStart ? editables[0] : editables[editables.length - 1], atStart);
    } else {
      target.focus();
    }

    this.onNavigateToCell?.(position);
  }

  /**
   * Get the number of rows in the table
   */
  private getRowCount(): number {
    return ownRows(this.gridElement).length;
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

  /** A nested table's cell is inside this grid but belongs to that table. */
  private isOwnCell(cell: HTMLElement): boolean {
    return Array.from(ownRows(this.gridElement)).some(row => row === cell.parentElement);
  }

  /**
   * Get a cell element by row and column index
   */
  private getCell(row: number, col: number): HTMLElement | null {
    const rowEl = ownRows(this.gridElement)[row];

    if (!rowEl) {
      return null;
    }

    return rowEl.querySelector<HTMLElement>(`:scope > [${CELL_ATTR}][${CELL_COL_ATTR}="${col}"]`);
  }

  /**
   * Initialize all cells with blocks.
   * - Empty cells or legacy string cells get a new paragraph block.
   * - Cells that already have block references get those blocks mounted.
   * - If referenced blocks are missing from BlockManager, a fallback paragraph is created.
   */
  /**
   * Insert one parsed cell-content block after the table's subtree.
   * Falls back to a paragraph when the insert's tool is not registered in
   * this editor (e.g. no list tool), so pasted cell content is never lost.
   */
  private insertCellContentBlock(
    insert: CellBlockInsert,
    index: number = this.indexAfterTableSubtree()
  ): ReturnType<API['blocks']['insert']> {
    if (insert.tool !== 'paragraph') {
      try {
        return this.api.blocks.insert(insert.tool, insert.data, {}, index, false);
      } catch {
        // Tool unavailable — degrade to a paragraph carrying the item text.
      }
    }

    return this.api.blocks.insert('paragraph', { text: cellBlockFallbackText(insert.data) }, {}, index, false);
  }

  /**
   * Insert one STRUCTURED cell block (tool + data + tunes) carried by a
   * clipboard payload. Unlike {@link insertCellContentBlock} this keeps blocks
   * that have no HTML-text representation (image, code, embed) and their tunes;
   * routing them through the `text` channel dropped them entirely.
   * Falls back to a paragraph when the tool is not registered in this editor.
   */
  public insertClipboardBlock(
    block: ClipboardBlockData,
    index: number = this.indexAfterTableSubtree()
  ): ReturnType<API['blocks']['insert']> {
    try {
      // 8th arg = tunes; omit it and copied cells lose them.
      return this.api.blocks.insert(
        block.tool,
        block.data,
        {},
        index,
        false,
        false,
        undefined,
        block.tunes,
      );
    } catch {
      // Tool unavailable — degrade to a paragraph carrying whatever text it had.
      return this.api.blocks.insert('paragraph', { text: cellBlockFallbackText(block.data) }, {}, index, false);
    }
  }

  /**
   * Rebuild a clipboard block's nested children under `parentId`, depth-first.
   * Call it only after the parent is placed in the table, or the flat index
   * lands outside the table's subtree.
   */
  public insertClipboardChildren(parentId: string, children: ClipboardBlockData[] | undefined): void {
    children?.forEach(child => {
      const block = this.insertClipboardBlock(child, this.indexAfterSubtreeOf(parentId));

      this.api.blocks.setBlockParent(block.id, parentId);
      this.insertClipboardChildren(block.id, child.children);
    });
  }

  /**
   * Insert blocks parsed from cell HTML into a cell container, before the
   * block `beforeId` (undefined appends). Returns their ids in order.
   */
  private mountTextBlocks(container: HTMLElement, text: string, beforeId?: string): string[] {
    const before = beforeId === undefined ? null : this.api.blocks.getById(beforeId)?.holder ?? null;

    return parseCellContentToBlocks(text).map(insert => {
      // Appending: land right after the cell's last block, not at the table's end,
      // so the table's children stay in grid order.
      const lastId = before === null ? container.lastElementChild?.getAttribute('data-blok-id') ?? null : null;
      const block = lastId === null
        ? this.insertCellContentBlock(insert)
        : this.insertCellContentBlock(insert, this.indexAfterSubtreeOf(lastId));

      container.insertBefore(block.holder, before);
      this.api.blocks.setBlockParent(block.id, this.tableBlockId);

      // The table's child order must match the cell order, or save reorders the cell.
      if (before !== null && beforeId !== undefined) {
        this.api.blocks.moveTo(block.id, { parentId: this.tableBlockId, position: { before: beforeId } });
      }

      return block.id;
    });
  }

  public initializeCells(
    content: InitCellContent[][]
  ): CellContent[][] {
    this.mountedThisPass.clear();

    try {
      return this.initializeCellsPass(content);
    } finally {
      this.mountedThisPass.clear();
    }
  }

  private initializeCellsPass(
    content: InitCellContent[][]
  ): CellContent[][] {
    const rowElements = ownRows(this.gridElement);
    const normalizedContent: CellContent[][] = [];
    // Every (row, col) the model-driven loop below describes. The completeness
    // sweep uses this to find rendered cells the model never covered — without
    // depending on DOM/holder state, which varies across call sites and tests.
    const visited = new Set<string>();
    // Rendered cells by `row:col`, so a claimed cell's text can join its origin.
    const origins = new Map<string, { container: HTMLElement; entry: CellContent }>();

    content.forEach((rowData, rowIndex) => {
      const row = rowElements[rowIndex];

      if (!row) {
        return;
      }

      const normalizedRow: CellContent[] = [];

      rowData.forEach((cellContent, colIndex) => {
        visited.add(`${rowIndex}:${colIndex}`);

        // A merge-covered cell has no rendered <td> (createGridFromModel skips
        // spanned cells). Preserve its placeholder so the rebuilt model keeps
        // the merge structure and column count — otherwise loading a saved
        // merged table flattens the merge out of the model while the DOM still
        // carries the colspan/rowspan, desyncing the two.
        if (isCellWithBlocks(cellContent) && cellContent.mergedInto !== undefined) {
          const origin = origins.get(cellContent.mergedInto.join(':'));

          // Legacy text of a claimed cell shows in its origin, after the
          // origin's own content, as the view renders it. A peer's text is
          // left to that peer, like an empty cell below.
          if (origin !== undefined && cellContent.text !== undefined && !this.api.blocks.isApplyingRemoteChange) {
            origin.entry.blocks.push(...this.mountTextBlocks(origin.container, cellContent.text));
          }

          normalizedRow.push({ blocks: [], mergedInto: [...cellContent.mergedInto], ...pickTableIds(cellContent) });

          return;
        }

        const cell = row.querySelector<HTMLElement>(`:scope > [${CELL_ATTR}][${CELL_COL_ATTR}="${colIndex}"]`);

        if (!cell) {
          return;
        }

        const container = cell.querySelector<HTMLElement>(`:scope > [${CELL_BLOCKS_ATTR}]`);

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
        // Span + placement metadata the model round-trips but initializeCells
        // would otherwise drop on the rendered() rebuild (merge-origin colspan/
        // rowspan, vertical/horizontal placement).
        const cellMetaProps: Pick<CellContent, 'colspan' | 'rowspan' | 'placement' | 'id' | 'rowId'> = {};

        if (isCellWithBlocks(cellContent)) {
          Object.assign(cellMetaProps, pickTableIds(cellContent));
          if (cellContent.color !== undefined) {
            cellColorProps.color = cellContent.color;
          }
          if (cellContent.textColor !== undefined) {
            cellColorProps.textColor = cellContent.textColor;
          }
          if (cellContent.colspan !== undefined && cellContent.colspan > 1) {
            cellMetaProps.colspan = cellContent.colspan;
          }
          if (cellContent.rowspan !== undefined && cellContent.rowspan > 1) {
            cellMetaProps.rowspan = cellContent.rowspan;
          }
          if (cellContent.placement !== undefined) {
            cellMetaProps.placement = cellContent.placement;
          }
        }

        if (mountedIds.length > 0) {
          const baseIds = referencedBlockIds ?? mountedIds;
          const blockIds = replacements.size > 0
            ? baseIds.map(id => replacements.get(id) ?? id)
            : baseIds;
          const leading = isCellWithBlocks(cellContent) && 'leadingText' in cellContent
            && cellContent.leadingText !== undefined && !this.api.blocks.isApplyingRemoteChange
            ? this.mountTextBlocks(container, cellContent.leadingText, mountedIds[0])
            : [];

          normalizedRow.push({ blocks: [...leading, ...blockIds], ...cellColorProps, ...cellMetaProps });
        } else if (referencedBlockIds !== null && this.api.blocks.isSyncingFromYjs) {
          // The referenced blocks have not arrived yet (a peer's adds, or an
          // undo that restores them later in the same replay). They are
          // placed by id when they land; a fabricated stand-in would outlive them.
          // A peer's text is left to that peer: every receiver writing it
          // would put one copy per peer into the shared cell.
          const fallbackText = isCellWithBlocks(cellContent) && cellContent.text !== '' ? cellContent.text : undefined;
          const key = JSON.stringify(referencedBlockIds);

          if (fallbackText !== undefined && this.api.blocks.isApplyingRemoteChange) {
            this.peerFallbackCells.add(key);
          } else if (fallbackText !== undefined) {
            this.fallbackTexts.set(key, fallbackText);
          }
          normalizedRow.push({ blocks: referencedBlockIds, ...cellColorProps, ...cellMetaProps });
        } else if (this.api.blocks.isApplyingRemoteChange && isCellWithBlocks(cellContent)) {
          // A peer's empty cell: that peer fills it and sends the block. A
          // stand-in minted here reaches the shared doc too, so the cell
          // would end with one block per peer.
          normalizedRow.push({ blocks: [], ...cellColorProps, ...cellMetaProps });
        } else {
          const text = typeof cellContent === 'string'
            ? cellContent
            : (cellContent.text ?? '');
          const ids: string[] = [];
          // A clipboard paste can carry blocks the `text` channel cannot express
          // (image/code/embed, or blocks with tunes). When present, seed the cell
          // from that structured payload instead of re-parsing flattened HTML.
          const seedBlocks = isCellWithBlocks(cellContent) ? cellContent.blockData : undefined;

          const mount = (block: ReturnType<API['blocks']['insert']>): void => {
            container.appendChild(block.holder);
            this.api.blocks.setBlockParent(block.id, this.tableBlockId);
            ids.push(block.id);
          };

          if (seedBlocks !== undefined && seedBlocks.length > 0) {
            seedBlocks.forEach(seed => {
              const block = this.insertClipboardBlock(seed);

              mount(block);
              this.insertClipboardChildren(block.id, seed.children);
            });
          } else {
            parseCellContentToBlocks(text).forEach(insert => {
              const block = this.insertCellContentBlock(insert);

              if (typeof cellContent === 'string' && !this.api.blocks.isApplyingRemoteChange) {
                this.convertedBlocks.set(block.id, {
                  row: rowIndex,
                  col: colIndex,
                  index: ids.length,
                  minted: JSON.stringify(block.preservedData),
                });
              }
              mount(block);
            });
          }

          normalizedRow.push({
            blocks: referencedBlockIds === null
              ? ids
              : [...referencedBlockIds, ...ids],
            ...cellColorProps,
            ...cellMetaProps,
          });
        }

        origins.set(`${rowIndex}:${colIndex}`, { container, entry: normalizedRow[normalizedRow.length - 1] });
        this.stripPlaceholders(container);
      });

      normalizedContent.push(normalizedRow);
    });

    // ── Model==grid completeness sweep ──────────────────────────────────
    // The loop above is driven by the STORED model, so it only touches cells
    // the model actually describes. When the rendered grid is WIDER (ragged
    // rows) or has columns the model never had (empty rows that make
    // createFlatGrid fall back to DEFAULT_COLS), those extra DOM cells get no
    // block → zero contenteditable target → impossible to click into or type.
    // Walk every rendered cell and synthesize a paragraph for any still-empty,
    // non-merge cell, recording it into the returned model so save/reload stays
    // rectangular. This is the invariant enforcer that makes the non-editable
    // cell bug impossible regardless of HOW the model and grid widths diverged
    // — it backstops rectangularizeContent at the consuming layer and also
    // covers any future code path that bypasses it.
    //
    // Skipped during a Yjs sync replay: fabricating blocks there orphans the
    // blocks Yjs is about to restore via separate ops (regression:
    // table-undo-redo-orphans). That path reconciles empty cells on its own.
    //
    // Skipped for merge tables: their rows are already full-width via mergedInto
    // placeholders (so the bug cannot occur), and CELL_COL_ATTR is physical- vs
    // logical-column ambiguous under merges — driving a model write off it would
    // corrupt colspan/rowspan/mergedInto metadata.
    if (!this.api.blocks.isSyncingFromYjs && !this.model.hasMerges()) {
      rowElements.forEach((row, rowIndex) => {
        const normalizedRow = normalizedContent[rowIndex] ?? (normalizedContent[rowIndex] = []);
        const cellElements = row.querySelectorAll<HTMLElement>(`:scope > [${CELL_ATTR}]`);

        cellElements.forEach(cell => {
          const colIndex = Number(cell.getAttribute(CELL_COL_ATTR));

          if (!Number.isInteger(colIndex) || visited.has(`${rowIndex}:${colIndex}`)) {
            return;
          }

          const container = cell.querySelector<HTMLElement>(`:scope > [${CELL_BLOCKS_ATTR}]`);

          // No container → merge-covered cell (no editable target by design).
          if (!container) {
            return;
          }

          const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.indexAfterTableSubtree(), false);

          container.appendChild(block.holder);
          this.api.blocks.setBlockParent(block.id, this.tableBlockId);
          this.stripPlaceholders(container);

          normalizedRow[colIndex] = { blocks: [block.id] };
        });

        // A covered/skipped column can leave an undefined hole between filled
        // cells; rebuild the row dense so the persisted width matches the
        // rendered grid and no index is left undefined.
        normalizedContent[rowIndex] = Array.from(
          { length: normalizedRow.length },
          (_, col) => normalizedRow[col] ?? { blocks: [] }
        );
      });
    }

    return normalizedContent;
  }

  /**
   * After a setData/render rebuild, reclaim any blocks the model references
   * whose holders are not yet mounted in their model cell. This catches blocks
   * that were restored via separate Yjs ops in a different transaction order
   * — without it the restored block would float at the top level as an orphan
   * (regression: table-undo-redo-orphans, multi-cell undo restoration).
   */
  /**
   * After a sync replay has settled, give an editable block to every cell
   * whose referenced blocks have not arrived (a peer's content write that won
   * over a delete). Only then: during the replay they may still land.
   * @param paddedCells - `rowId:columnId` of cells no peer's write holds; see `mergePaddedCells`
   */
  public fillCellsWithUnresolvedBlocks(paddedCells: ReadonlySet<string> = new Set()): void {
    this.gridElement.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`).forEach(cell => {
      const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);
      const pos = this.getCellPosition(cell);

      if (!container || !pos || container.querySelector('[data-blok-id]') !== null) {
        return;
      }

      const ids = this.model.getCellBlocks(pos.row, pos.col);

      if (ids.length === 0 && paddedCells.has(this.cellKeyAt(pos.row, pos.col))) {
        // A stand-in: every peer that padded the cell fills it, and `yieldRepairsToPeers` keeps one.
        this.ensureCellHasBlock(cell, { padded: true });

        return;
      }

      // A cell the replay left empty on purpose (undo to an empty table) is
      // not ours to fill: its blocks may still be restored by later ops.
      if (ids.length === 0 || ids.some(id => this.api.blocks.getById?.(id) != null)) {
        return;
      }

      // The dangling ids stay in the model: save() drops ids with no block,
      // and a block that still lands late is routed back to this cell by them.
      const key = JSON.stringify(ids);
      const text = this.fallbackTexts.get(key);

      if (this.peerFallbackCells.has(key)) {
        return;
      }

      if (text === undefined) {
        this.ensureCellHasBlock(cell);

        return;
      }

      // The saved text is the cell's only content left; an empty stand-in would erase it on save.
      this.fallbackTexts.delete(key);
      this.isRepairingCell = true;

      try {
        this.api.blocks.transactWithoutCapture?.(() => {
          this.mountTextBlocks(container, text).forEach(id => this.syncBlockToModel(cell, id));
        });
      } finally {
        this.isRepairingCell = false;
      }
    });
  }

  /**
   * After a sync settles, a local undo's restored block replaces its stand-in.
   * Competing peer stand-ins still use the lowest id so both peers agree.
   * A stand-in the user typed into is content and stays.
   */
  public yieldRepairsToPeers(restoredIds: ReadonlySet<string> = new Set()): void {
    // Peers that padded the same cell each write it as a new key, so one
    // stand-in loses and no cell names it any more.
    const named = new Set(this.model.snapshot().content.flat().flatMap(cell => (isCellWithBlocks(cell) ? cell.blocks : [])));
    const unnamed = [...this.paddedFillIds].filter(id => {
      const block = this.api.blocks.getById?.(id);

      if (block?.isEmpty !== true || block.parentId !== this.tableBlockId) {
        this.paddedFillIds.delete(id);

        return false;
      }

      return !named.has(id);
    });

    unnamed.forEach(id => {
      this.repairIds.delete(id);
      this.paddedFillIds.delete(id);
    });
    if (unnamed.length > 0) {
      this.api.blocks.transactWithoutCapture?.(() => this.deleteBlocks(unnamed, false));
    }

    this.yieldNamedRepairs(restoredIds);
  }

  private yieldNamedRepairs(restoredIds: ReadonlySet<string>): void {
    if (this.repairIds.size === 0) {
      return;
    }

    const losers: string[] = [];

    this.gridElement.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`).forEach(cell => {
      const pos = this.getCellPosition(cell);
      const ids = pos ? this.model.getCellBlocks(pos.row, pos.col) : [];

      ids.forEach(id => {
        if (!this.repairIds.has(id)) {
          return;
        }

        // Once typed into, it is the user's block even if emptied again.
        if (this.api.blocks.getById?.(id)?.isEmpty !== true) {
          this.repairIds.delete(id);

          return;
        }

        if (ids.some(other => (other < id || (restoredIds.has(other) && !this.repairIds.has(other)))
          && this.api.blocks.getById?.(other) != null)) {
          losers.push(id);
        }
      });
    });

    if (losers.length === 0) {
      return;
    }

    losers.forEach(id => this.repairIds.delete(id));
    this.api.blocks.transactWithoutCapture?.(() => this.deleteBlocks(losers, false));
  }

  /**
   * After a sync settles, hand over this editor's legacy conversion when a
   * peer's concurrent conversion won the table data. Its untouched blocks go;
   * a block the user edited takes the place of the peer's untouched twin, or
   * sits right after a twin the peer edited too.
   *
   * Only the editor that made a block deletes it. A twin that looks untouched
   * here may hold typing whose frame has not arrived, so it is only unnamed;
   * its own editor runs this same pass and keeps it if it was edited.
   */
  public yieldLostConversion(): void {
    if (this.convertedBlocks.size === 0) {
      return;
    }

    const named = new Set(this.model.snapshot().content.flat().flatMap(cell => (isCellWithBlocks(cell) ? cell.blocks : [])));
    const dataOf = (block: { preservedData: unknown }): string => JSON.stringify(block.preservedData);
    const dropped: string[] = [];
    const kept: Array<{ id: string; twin: string | undefined; replace: boolean; record: ConvertedBlock }> = [];

    [...this.convertedBlocks].forEach(([id, record]) => {
      if (named.has(id)) {
        return;
      }

      this.convertedBlocks.delete(id);

      const block = this.api.blocks.getById?.(id);

      if (block == null || block.parentId !== this.tableBlockId) {
        return;
      }

      if (dataOf(block) === record.minted) {
        dropped.push(id);

        return;
      }

      const twin = this.model.getCellBlocks(record.row, record.col)[record.index];
      const twinBlock = twin === undefined ? null : this.api.blocks.getById?.(twin);
      const replace = twinBlock != null && twinBlock.name === block.name && dataOf(twinBlock) === record.minted;

      kept.push({ id, twin, replace, record });
    });

    if (dropped.length === 0 && kept.length === 0) {
      return;
    }

    this.api.blocks.transactWithoutCapture?.(() => {
      kept.forEach(({ id, twin, replace, record }) => this.placeInCell(id, record, twin, replace));
      // Out of the model and the cell first: a removal of a cell's block
      // otherwise saves the table as a tracked change and records a refill.
      dropped.forEach(id => {
        const pos = this.model.findCellForBlock(id);

        if (pos !== null) {
          this.model.removeBlockFromCell(pos.row, pos.col, id);
        }
        this.api.blocks.getById?.(id)?.holder.remove();
      });
      this.deleteBlocks(dropped, false);
    });
  }

  /**
   * Mount a table child into a cell in place of `twin`, or after it (last
   * when there is no twin).
   */
  private placeInCell(id: string, record: ConvertedBlock, twin: string | undefined, replace: boolean): void {
    const cell = this.getCell(record.row, record.col);
    const container = cell?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);
    const block = this.api.blocks.getById?.(id);

    if (cell == null || container == null || block == null) {
      return;
    }

    const ids = this.model.getCellBlocks(record.row, record.col);
    const twinAt = twin === undefined ? -1 : ids.indexOf(twin);
    const replaced = replace && twinAt !== -1 ? twin : undefined;
    const at = twinAt === -1 ? ids.length : twinAt + (replaced === undefined ? 1 : 0);
    const rest = replaced === undefined ? ids : ids.filter(other => other !== replaced);
    const before = rest[at];
    const beforeHolder = before === undefined ? null : this.api.blocks.getById?.(before)?.holder ?? null;
    const last = rest.at(-1);
    const anchor = [
      replaced !== undefined ? { before: replaced } : null,
      before !== undefined ? { before } : null,
      last !== undefined ? { after: last } : null,
    ].find(candidate => candidate !== null) ?? null;

    container.insertBefore(block.holder, beforeHolder?.parentElement === container ? beforeHolder : null);
    // The table's child order must match the cell order, or save reorders the
    // cell. The move is also what writes the table data, untracked.
    if (anchor !== null) {
      this.api.blocks.moveTo(id, { parentId: this.tableBlockId, position: anchor });
    }
    this.model.setCellBlocks(record.row, record.col, [...rest.slice(0, at), id, ...rest.slice(at)]);
    if (replaced !== undefined) {
      this.api.blocks.getById?.(replaced)?.holder.remove();
    }
    this.stripPlaceholders(container);
  }

  private cellKeyAt(row: number, col: number): string {
    const cell = this.model.snapshot().content[row]?.[col];

    return isCellWithBlocks(cell) ? cellKey(cell.rowId ?? '', cell.id ?? '') : '';
  }

  public reclaimReferencedBlocks(): void {
    const snapshot = this.model.snapshot();

    snapshot.content.forEach((row, rowIndex) => {
      row.forEach((cellContent, colIndex) => {
        if (!isCellWithBlocks(cellContent) || cellContent.blocks.length === 0) {
          return;
        }

        const cell = this.getCell(rowIndex, colIndex);

        if (!cell) {
          return;
        }

        const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

        if (!container) {
          return;
        }

        for (const blockId of cellContent.blocks) {
          const getIndex = this.api.blocks.getBlockIndex;
          const getByIndex = this.api.blocks.getBlockByIndex;

          if (typeof getIndex !== 'function' || typeof getByIndex !== 'function') {
            return;
          }

          const index = getIndex(blockId);

          if (index === undefined) {
            continue;
          }
          const block = getByIndex(index);

          if (!block) {
            continue;
          }
          if (container.contains(block.holder)) {
            continue;
          }
          this.claimBlockForCell(cell, blockId);
        }
      });
    });
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
      //
      // EXCEPTION — our own block stranded in a previous render's grid: a
      // setData rebuild (undo/redo replay, remote sync) replaces the table
      // element while the cell blocks' holders are still mounted in the OLD,
      // detached grid's containers. Those blocks belong to THIS table
      // (parentId === tableBlockId) and must be re-mounted, not duplicated —
      // duplicating pointed the grid at fresh ids and left the originals as
      // invisible orphan children that resurfaced under the table after a
      // save → re-render round trip (regression: table-undo-setdata-duplication).
      const hasDifferentOwner = block.parentId != null
        && block.parentId !== ''
        && block.parentId !== this.tableBlockId;
      const nestedContainer = block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`);
      const strandedInPreviousRender = nestedContainer !== null
        && !this.gridElement.contains(nestedContainer)
        && block.parentId === this.tableBlockId;
      // A synced child of ours that DOM adjacency dropped into another of our
      // cells: the table data being applied is where it belongs. A duplicate
      // here is broadcast, and each peer then mints its own.
      // Not when this pass mounted it into an earlier cell: the content names
      // it twice, and moving it would leave that cell with no block.
      const parkedBySync = this.api.blocks.isSyncingFromYjs
        && nestedContainer !== null
        && this.gridElement.contains(nestedContainer)
        && block.parentId === this.tableBlockId
        && !this.mountedThisPass.has(blockId);

      if ((nestedContainer !== null && !strandedInPreviousRender && !parkedBySync) || hasDifferentOwner) {
        const duplicate = this.api.blocks.insert(
          block.name,
          block.preservedData,
          {},
          this.indexAfterTableSubtree(),
          false,
          false,
          undefined,
          block.preservedTunes,
        );

        container.appendChild(duplicate.holder);
        this.api.blocks.setBlockParent(duplicate.id, this.tableBlockId);
        this.insertClipboardChildren(duplicate.id, this.api.blocks.getChildren(blockId).map(child => toClipboardBlock(this.api, child)));
        mountedIds.push(duplicate.id);
        replacements.set(blockId, duplicate.id);
        continue;
      }

      const previous = container.lastElementChild === block.holder
        ? block.holder.previousElementSibling
        : container.lastElementChild;

      container.appendChild(block.holder);
      this.api.blocks.setBlockParent(blockId, this.tableBlockId);

      // setBlockParent re-sorts a holder in its cell by flat order, which can
      // disagree with the data (a peer's doc order). The data orders the cell.
      const resorted = block.holder.parentElement === container && block.holder.previousElementSibling !== previous;

      if (resorted && previous === null) {
        container.prepend(block.holder);
      } else if (resorted) {
        previous?.after(block.holder);
      }
      this.blocksAwaitingCell.delete(blockId);
      this.mountedThisPass.add(blockId);
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
    //
    // EXCEPTION — our own block stranded in a previous render's grid: after a
    // setData rebuild the holder may still sit in the OLD, detached grid's
    // container. It belongs to this table (parentId === tableBlockId), so
    // reclaim it instead of skipping (regression: table-undo-setdata-duplication).
    const hasDifferentOwner = block.parentId != null
      && block.parentId !== ''
      && block.parentId !== this.tableBlockId;
    const nestedContainer = block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`);
    const strandedInPreviousRender = nestedContainer !== null
      && !this.gridElement.contains(nestedContainer)
      && block.parentId === this.tableBlockId;

    if ((nestedContainer !== null && !strandedInPreviousRender) || hasDifferentOwner) {
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

    if (cell && this.isOwnCell(cell)) {
      return cell;
    }

    return null;
  }

  /**
   * True for a synced child whose cell the table data has not named yet.
   */
  public isAwaitingCell(blockId: string): boolean {
    return this.blocksAwaitingCell.has(blockId);
  }

  /**
   * Ensure a cell has at least one block.
   * If the blocks container is empty, insert an empty paragraph.
   * @param options.track - true when the fill is part of a user gesture (add
   *   row/column, or the fill after a local removal empties a cell): the new
   *   block joins the gesture's undo step. Otherwise it is an invisible
   *   repair, kept out of undo.
   * @param options.standIn - the block only fills the emptied cell, so a
   *   peer's stand-in may replace it (see `yieldRepairsToPeers`). Defaults to
   *   true when the fill is untracked.
   * @param options.padded - the cell is one a merge padded (see `mergePaddedCells`)
   */
  public ensureCellHasBlock(cell: HTMLElement, options: { track?: boolean; standIn?: boolean; padded?: boolean } = {}): void {
    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const hasBlocks = container.querySelector('[data-blok-id]') !== null;

    if (hasBlocks) {
      return;
    }

    // Untracked fills stay out of undo; tracked ones join the current step.
    //
    // isRepairingCell suppresses handleBlockMutation's claim heuristics for the
    // repair block's own block-added event: this method places the block itself,
    // and the removed-entry route would otherwise mis-claim it into whichever
    // cell recorded a removal at a coincidentally-equal flat index.
    this.isRepairingCell = true;

    const fill = (): void => {
      const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.indexForCell(cell), true);

      if (options.standIn ?? options.track !== true) {
        this.repairIds.add(block.id);
      }
      if (options.padded === true) {
        this.paddedFillIds.add(block.id);
      }
      container.appendChild(block.holder);
      this.api.blocks.setBlockParent(block.id, this.tableBlockId);
      this.syncBlockToModel(cell, block.id);
      this.stripPlaceholders(container);
    };

    try {
      if (options.track === true) {
        fill();
      } else {
        this.api.blocks.transactWithoutCapture?.(fill);
      }
    } finally {
      this.isRepairingCell = false;
    }
  }

  /**
   * Place the caret inside a cell after its content has been cleared.
   *
   * Clearing a multi-cell selection deletes every block those cells owned via
   * async `api.blocks.delete()`. When the deleted blocks were the table's only
   * blocks, the editor has no sibling to move the caret to and focus falls onto
   * <body>. We restore focus into the given cell once the async deletion and the
   * empty-cell repair (ensureCellHasBlock) have settled — scheduled on the next
   * frame so it runs after those microtasks and wins the caret.
   */
  public focusClearedCell(cell: HTMLElement): void {
    requestAnimationFrame(() => {
      if (this.isDestroyed || !this.gridElement.contains(cell)) {
        return;
      }

      this.ensureCellHasBlock(cell);

      const firstHolder = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}] [data-blok-id]`);
      const blockId = firstHolder?.getAttribute('data-blok-id');

      if (blockId) {
        this.api.caret.setToBlock(blockId, 'start');
      }
    });
  }

  /**
   * Handle block mutation events from the editor.
   * When a block is added, check if it should be claimed by a cell.
   * When a block is removed, ensure no cell is left empty.
   */
  private handleBlockMutation = (data: unknown): void => {
    // While a structural op (setData / paste / row-col change) is rebuilding
    // the table, defer events so they don't operate on stale DOM. EXCEPT for
    // Yjs replay: an undo/redo that restores a previously-owned cell block
    // fires block-added DURING the table's own setData, and discarding it
    // would leave the restored block as a top-level orphan
    // (regression: table-undo-redo-orphans). Process those immediately —
    // recordedCellPos lookup below will route the block back to its cell.
    if (this.isStructuralOpActive() && !this.api.blocks.isSyncingFromYjs) {
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

    // ensureCellHasBlock is inserting its own repair block and places it
    // itself — claim heuristics (especially the removed-entry route) would
    // mis-claim the repair into a different cell that recorded a removal at
    // the same flat index.
    if (this.isRepairingCell) {
      return;
    }

    // Never claim the table block itself as a cell content block.
    // This can happen when rendered() creates cell blocks synchronously,
    // polluting currentBlockIndex before the table's own block-added fires.
    if (detail.target.id === this.tableBlockId) {
      return;
    }

    // Yjs undo replay: a block this table previously owned is being restored.
    // The model's contentGrid still references its id from a prior render but
    // the DOM is empty (we deliberately did not fabricate a replacement, see
    // table-undo-redo-orphans regression). Reattach it to the recorded cell
    // before falling through to adjacency-based heuristics, otherwise the
    // restored block lands as a top-level orphan.
    const recordedCellPos = this.model.findCellForBlock(detail.target.id);

    if (recordedCellPos) {
      const cellEl = this.getCell(recordedCellPos.row, recordedCellPos.col);

      if (cellEl) {
        this.claimBlockForCell(cellEl, detail.target.id);
        this.cellsPendingCheck.delete(cellEl);

        return;
      }
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

    // A replayed or remote child the model does not reference yet. Its cell
    // comes with the table's own data write (setData mounts it then). Its
    // holder sits next to its flat neighbour, so adjacency (and save()'s
    // harvest) would claim the neighbour's cell and send it to every peer.
    // A peer's add can land before its parent write, so its block with no
    // parent yet is held too. Not our own: a local split in the sync window
    // adds one the same way, and save() is what puts it in its cell.
    if (this.api.blocks.isSyncingFromYjs) {
      const parentId = this.api.blocks.getById?.(detail.target.id)?.parentId ?? null;
      const peerBlockAwaitingParent = this.api.blocks.isApplyingRemoteChange
        && (parentId === null || parentId === '')
        && this.gridElement.contains(detail.target.holder);

      if (parentId === this.tableBlockId || peerBlockAwaitingParent) {
        this.blocksAwaitingCell.add(detail.target.id);
      }

      // A peer's child of ours, shown in a cell no data names, would take
      // typing that a reload drops. Mounting from the data puts it back.
      if (parentId === this.tableBlockId
        && this.api.blocks.isApplyingRemoteChange
        && this.gridElement.contains(detail.target.holder)) {
        detail.target.holder.remove();
      }

      return;
    }

    // For non-replace inserts: if the holder is already in a cell (placed
    // by insertToDOM next to an adjacent cell block), just strip placeholders.
    const holder = detail.target.holder;
    const existingContainer = holder.closest<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (existingContainer) {
      this.stripPlaceholders(existingContainer);
    }

    // Sync to model if holder landed in a cell but isn't tracked yet (e.g.
    // toolbox conversion, or Enter at the start of a cell block where
    // insertToDOM already placed the holder next to its sibling).
    const untrackedCell = existingContainer && !this.model.findCellForBlock(detail.target.id)
      ? existingContainer.closest<HTMLElement>(`[${CELL_ATTR}]`)
      : null;

    if (untrackedCell && this.gridElement.contains(untrackedCell)) {
      this.syncBlockToModel(untrackedCell, detail.target.id);

      // Claim parentage too (mirrors claimBlockForCell). Without it the block
      // is tracked by the model but save() filters it out of the cell — its
      // parentId never points at this table — so visible cell content is
      // silently unparented into a top-level orphan on save.
      const blockApi = this.api.blocks.getById?.(detail.target.id);
      const ownedElsewhere = blockApi?.parentId != null
        && blockApi.parentId !== ''
        && blockApi.parentId !== this.tableBlockId;

      if (!ownedElsewhere) {
        this.api.blocks.setBlockParent(detail.target.id, this.tableBlockId);
      }
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

      // If the holder is outside the table block's own wrapper (e.g. placed
      // directly in the editor working area via appendToWorkingArea), it is
      // a top-level block and must not be claimed into a cell.
      //
      // EXCEPTION — Enter at the start of a cell's FIRST block: the new
      // block's flat predecessor is the TABLE block itself, so insertToDOM
      // anchors the holder 'afterend' the whole table wrapper. It still
      // belongs in the cell, right above the block the caret stayed on.
      // Recognized precisely by "the next flat block IS the current cell
      // block" — a plain insert below/next to the table never has that shape
      // (there the caret moves to the new block itself). Without this claim
      // the block is mounted into the cell later by setBlockParent's silent
      // DOM move, the model never records it, and save() unparents the
      // visible content into a top-level orphan (images-drift regression).
      const tableBlockIdx = this.api.blocks.getBlockIndex(this.tableBlockId);
      const tableBlockApi = tableBlockIdx !== undefined
        ? this.api.blocks.getBlockByIndex(tableBlockIdx)
        : null;

      const holderOutsideWrapper = tableBlockApi != null && !tableBlockApi.holder.contains(holder);
      const nextBlock = holderOutsideWrapper
        ? this.api.blocks.getBlockByIndex(blockIndex + 1)
        : undefined;
      const isInsertAboveCurrentCellBlock = nextBlock != null && nextBlock.id === currentBlock.id;

      if (holderOutsideWrapper && !isInsertAboveCurrentCellBlock) {
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
    this.blocksAwaitingCell.delete(detail.target.id);
    this.recordRemovedBlockCell(detail);
    const blockId = detail.target.id;
    const cellPos = this.model.findCellForBlock(blockId);

    if (!cellPos) {
      this.schedulePendingCellCheck();

      return;
    }

    this.model.removeBlockFromCell(cellPos.row, cellPos.col, blockId);
    this.signalCellReferenceDropped();
    const affectedCell = this.getCell(cellPos.row, cellPos.col);

    if (affectedCell) {
      this.cellsPendingCheck.add(affectedCell);
    }

    this.schedulePendingCellCheck();
  }

  /**
   * Nested table cells are inside the outer grid, but belong to another table.
   */
  private handleBlockMoved(detail: { target: { id: string; holder: HTMLElement } }): void {
    const blockId = detail.target.id;
    const cellPos = this.model.findCellForBlock(blockId);
    const cell = detail.target.holder.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cellPos) {
      if (cell !== null && this.getCellPosition(cell) !== null
        && this.api.blocks.getById?.(blockId)?.parentId === this.tableBlockId) {
        this.syncBlockToModel(cell, blockId);
      }

      return;
    }

    // The holder is still inside our grid: the block was moved within this
    // table. Re-sync the model to the holder's new cell AND position — the
    // model order is what save() persists, so skipping this silently reverts
    // the user's reorder on the next save (images-drift-to-cell-bottom
    // regression).
    if (this.gridElement.contains(detail.target.holder)
      && (cell === null || this.getCellPosition(cell) !== null)) {
      if (cell) {
        this.syncBlockToModel(cell, blockId);
      }

      // Drag moves nested holders after block-moved fires.
      queueMicrotask(() => {
        const settledCell = detail.target.holder.closest<HTMLElement>(`[${CELL_ATTR}]`);
        const currentPos = this.model.findCellForBlock(blockId);

        if (!currentPos) {
          return;
        }
        if (settledCell !== null && this.getCellPosition(settledCell) !== null) {
          this.syncBlockToModel(settledCell, blockId);
        } else {
          this.model.removeBlockFromCell(currentPos.row, currentPos.col, blockId);
          this.signalCellReferenceDropped();
        }
      });

      return;
    }

    this.model.removeBlockFromCell(cellPos.row, cellPos.col, blockId);
    this.signalCellReferenceDropped();
  }

  /**
   * Tell the table its own data changed.
   *
   * Dropping a cell reference is the one table data change nothing else
   * announces: `onParentChanged` → `scheduleParentSync` only fires when a block
   * GAINS a parent, so an add or an in-table reorder is covered and a removal is
   * not. It used to ride the cell container's childList record reaching the
   * table's mutation observer, but that container is `data-blok-mutation-free`
   * (see table-core) so the record is scored inert. The table answers with
   * `block.dispatchChange()`, which is exempt from that scoring by design.
   */
  private signalCellReferenceDropped(): void {
    this.onCellReferenceDropped?.();
  }

  /**
   * Find the DOM cell's row/col position and add the block to the model at
   * the position the user actually sees (derived from the holder's DOM
   * position within the cell). Appending instead would diverge model order
   * from DOM order for any non-tail insert, and save() persists model order.
   */
  private syncBlockToModel(cell: HTMLElement, blockId: string): void {
    const pos = this.getCellPosition(cell);

    if (pos) {
      this.model.addBlockToCell(pos.row, pos.col, blockId, this.getModelInsertIndex(cell, pos, blockId));
    }
  }

  /**
   * Compute the model insertion index for a block from its holder's DOM
   * position: insert before the first already-tracked cell block whose holder
   * comes after it in the DOM. Returns undefined (append) when the holder or
   * container can't be resolved — e.g. transitional states where the DOM
   * hasn't been mounted yet.
   */
  private getModelInsertIndex(cell: HTMLElement, pos: CellPosition, blockId: string): number | undefined {
    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return undefined;
    }

    const targetHolder = this.findHolderInContainer(container, blockId);

    if (!targetHolder) {
      return undefined;
    }

    const trackedIds = this.model.getCellBlocks(pos.row, pos.col).filter(id => id !== blockId);

    const insertBeforeIndex = trackedIds.findIndex(id => {
      const holder = this.findHolderInContainer(container, id);

      return holder !== null
        && (targetHolder.compareDocumentPosition(holder) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });

    return insertBeforeIndex === -1 ? undefined : insertBeforeIndex;
  }

  private findHolderInContainer(container: HTMLElement, blockId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-blok-id="${CSS.escape(blockId)}"]`);
  }

  /**
   * Get the LOGICAL row/col position of a cell element within the grid.
   *
   * Delegates to the shared helper, which reads the cell's stamped logical
   * coordinate. A physical NodeList index would diverge from the model column
   * in any row touched by a merge, dropping blocks added to post-merge cells.
   */
  private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
    return getCellPosition(this.gridElement, cell);
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

    if (cell && this.isOwnCell(cell)) {
      this.removedBlockCells.set(detail.target.id, { cell, index: detail.index });

      return;
    }

    /**
     * The holder may already be detached when block-removed fires (typing over
     * a block selection deletes the DOM before emitting the event). The model
     * still maps the block to its cell at this point (handleBlockRemoved clears
     * it right after this call), so fall back to it — otherwise the replacement
     * block is never claimed into the cell and lands after the table.
     */
    const cellPos = this.model.findCellForBlock(detail.target.id);
    const cellEl = cellPos ? this.getCell(cellPos.row, cellPos.col) : null;

    if (cellEl) {
      this.removedBlockCells.set(detail.target.id, { cell: cellEl, index: detail.index });
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
        // Tracked: the fill must join the step that emptied the cell, or undo cannot restore it.
        for (const cell of this.cellsPendingCheck) {
          this.ensureCellHasBlock(cell, { track: true, standIn: true });
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
   * @param blockIds - blocks to delete
   * @param setCaret - false for gestures that reshape the table without the user
   *   typing in it (the corner and +/- drags): the caret would otherwise land in
   *   whichever cell became current, painting a focus box mid-drag.
   */
  public deleteBlocks(blockIds: string[], setCaret = true): void {
    // A slotless block's children sit beside it in the cell, and deleting only
    // the parent re-homes them into the table. The Set also keeps one index
    // from being deleted twice when a caller lists a child and its parent.
    const withSubtrees = new Set<string>();
    const collect = (id: string): void => {
      if (withSubtrees.has(id) || this.api.blocks.getBlockIndex(id) === undefined) {
        return;
      }
      withSubtrees.add(id);
      this.api.blocks.getChildren(id).forEach(child => collect(child.id));
    };

    blockIds.forEach(collect);

    const blockIndices = Array.from(withSubtrees)
      .map(id => this.api.blocks.getBlockIndex(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => b - a);

    const savedScrollY = window.scrollY;

    const deletePromises = blockIndices.map(index => {
      return this.api.blocks.delete(index, setCaret);
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
   * Delete the blocks mounted in the grid except the kept ones and everything
   * nested inside a kept one: new content names only a cell's top-level blocks.
   */
  public deleteBlocksExcept(keepIds: ReadonlySet<string>): void {
    // A kept list item's children are its siblings in the cell, not nested in its holder.
    const kept = new Set<string>();
    const keep = (id: string): void => {
      if (kept.has(id)) {
        return;
      }
      kept.add(id);
      if (this.api.blocks.getBlockIndex(id) !== undefined) {
        this.api.blocks.getChildren(id).forEach(child => keep(child.id));
      }
    };

    keepIds.forEach(keep);

    const isKept = (holder: Element | null | undefined, container: Element): boolean =>
      holder !== null && holder !== undefined && container.contains(holder) && (
        kept.has(holder.getAttribute('data-blok-id') ?? '')
        || isKept(holder.parentElement?.closest('[data-blok-id]'), container)
      );
    // Own cells only: a nested table's cells sit inside ours and its blocks are
    // reached through the outer container, under the kept nested table.
    const blockIds = Array.from(
      this.gridElement.querySelectorAll(ownCells(` > [${CELL_BLOCKS_ATTR}]`)),
      container => Array.from(container.querySelectorAll('[data-blok-id]'))
        .filter(holder => !isKept(holder, container))
        .map(holder => holder.getAttribute('data-blok-id') ?? '')
        .filter(id => id !== '')
    ).flat();

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

    /**
     * A drag across several line blocks inside one cell ends with a click
     * whose target is retargeted to the blocks container (the common ancestor
     * of the mousedown/mouseup targets). That is NOT a blank-space click:
     * stealing the caret here would run Caret.setToBlock →
     * BlockSelection.clearSelection() and wipe the just-created multi-line
     * selection. Skip while the user has a selection of their own inside this
     * grid — either block-level, or the cross-line TEXT range the same gesture
     * produces (which carries no data-blok-selected marker at all).
     */
    if (
      this.gridElement.querySelector(`[${DATA_ATTR.selected}="true"]`) !== null ||
      hasCrossHostSelectionWithin(this.gridElement)
    ) {
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
    this.isDestroyed = true;
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
