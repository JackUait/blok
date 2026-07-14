import type { API, BlockAPI } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import {
  isCaretAtStartOfInput,
  isCaretAtEndOfInput,
  isCaretAtFirstLine,
  isCaretAtLastLine,
} from '../../components/utils/caret';

import { CELL_ATTR, ROW_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from './table-core';
import { parseCellContentToBlocks } from './table-cell-paste';
import type { CellBlockInsert } from './table-cell-paste';
import { getCellPosition } from './table-operations';
import type { TableModel } from './table-model';
import type { ClipboardBlockData, LegacyCellContent, CellContent } from './types';
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

  /** When true, ensureCellHasBlock is inserting its own repair block — skip claim heuristics for it. */
  private isRepairingCell = false;

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
   * Grid-aware caret navigation for the four arrow keys, matching Notion:
   * - Up/Down move the caret to the cell directly above/below in the SAME column;
   * - Left/Right cross into the previous/next cell (reading order) at the cell's
   *   text edge;
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
      case 'ArrowRight': {
        if (caretInput !== null && !(isCaretAtEndOfInput(caretInput) && this.isCaretInLastCellBlock(caretInput))) {
          return;
        }

        const next = this.findAdjacentLogicalCell(position, 1);

        this.commitArrowNavigation(event, () => next ? this.navigateToCell(next) : this.exitTableForward());
        break;
      }
      case 'ArrowLeft': {
        if (caretInput !== null && !(isCaretAtStartOfInput(caretInput) && this.isCaretInFirstCellBlock(caretInput))) {
          return;
        }

        const previous = this.findAdjacentLogicalCell(position, -1);

        this.commitArrowNavigation(event, () => previous ? this.navigateToCell(previous, true) : this.exitTableBackward());
        break;
      }
      default:
    }
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
   * operation; a root-level table uses a plain insert positioned right after
   * the table block.
   */
  private insertBlockAfterTable(tableBlock: BlockAPI): BlockAPI {
    const tableIndex = this.api.blocks.getBlockIndex(this.tableBlockId);
    const insertIndex = (tableIndex ?? 0) + 1;

    if (tableBlock.parentId !== null && tableBlock.parentId !== '') {
      return this.api.blocks.insertInsideParent(tableBlock.parentId, insertIndex);
    }

    return this.api.blocks.insert(undefined, {}, {}, insertIndex, true);
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
  /**
   * Insert one parsed cell-content block at the end of the flat block list.
   * Falls back to a paragraph when the insert's tool is not registered in
   * this editor (e.g. no list tool), so pasted cell content is never lost.
   */
  private insertCellContentBlock(insert: CellBlockInsert): ReturnType<API['blocks']['insert']> {
    if (insert.tool !== 'paragraph') {
      try {
        return this.api.blocks.insert(insert.tool, insert.data, {}, this.api.blocks.getBlocksCount(), false);
      } catch {
        // Tool unavailable — degrade to a paragraph carrying the item text.
      }
    }

    return this.api.blocks.insert('paragraph', { text: insert.data.text }, {}, this.api.blocks.getBlocksCount(), false);
  }

  /**
   * Insert one STRUCTURED cell block (tool + data + tunes) carried by a
   * clipboard payload. Unlike {@link insertCellContentBlock} this keeps blocks
   * that have no HTML-text representation (image, code, embed) and their tunes;
   * routing them through the `text` channel dropped them entirely.
   * Falls back to a paragraph when the tool is not registered in this editor.
   */
  private insertClipboardBlock(block: ClipboardBlockData): ReturnType<API['blocks']['insert']> {
    try {
      return this.api.blocks.insert(
        block.tool,
        block.data,
        {},
        this.api.blocks.getBlocksCount(),
        false,
        false,
        undefined,
        block.tunes,
      );
    } catch {
      // Tool unavailable — degrade to a paragraph carrying whatever text it had.
      const text = typeof block.data.text === 'string' ? block.data.text : '';

      return this.api.blocks.insert('paragraph', { text }, {}, this.api.blocks.getBlocksCount(), false);
    }
  }

  public initializeCells(
    content: LegacyCellContent[][]
  ): CellContent[][] {
    const rowElements = this.gridElement.querySelectorAll(`[${ROW_ATTR}]`);
    const normalizedContent: CellContent[][] = [];
    // Every (row, col) the model-driven loop below describes. The completeness
    // sweep uses this to find rendered cells the model never covered — without
    // depending on DOM/holder state, which varies across call sites and tests.
    const visited = new Set<string>();

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
          normalizedRow.push({ blocks: [], mergedInto: [...cellContent.mergedInto] });

          return;
        }

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
        // Span + placement metadata the model round-trips but initializeCells
        // would otherwise drop on the rendered() rebuild (merge-origin colspan/
        // rowspan, vertical/horizontal placement).
        const cellMetaProps: Pick<CellContent, 'colspan' | 'rowspan' | 'placement'> = {};

        if (isCellWithBlocks(cellContent)) {
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

          normalizedRow.push({ blocks: blockIds, ...cellColorProps, ...cellMetaProps });
        } else {
          const text = typeof cellContent === 'string'
            ? cellContent
            : (cellContent.text ?? '');
          const ids: string[] = [];
          // A clipboard paste can carry blocks the `text` channel cannot express
          // (image/code/embed, or blocks with tunes). When present, seed the cell
          // from that structured payload instead of re-parsing flattened HTML.
          const seedBlocks = isCellWithBlocks(cellContent) ? cellContent.blockData : undefined;

          const inserted = seedBlocks !== undefined && seedBlocks.length > 0
            ? seedBlocks.map(block => this.insertClipboardBlock(block))
            : parseCellContentToBlocks(text).map(insert => this.insertCellContentBlock(insert));

          for (const block of inserted) {
            container.appendChild(block.holder);
            this.api.blocks.setBlockParent(block.id, this.tableBlockId);
            ids.push(block.id);
          }

          normalizedRow.push({
            blocks: referencedBlockIds === null
              ? ids
              : [...referencedBlockIds, ...ids],
            ...cellColorProps,
            ...cellMetaProps,
          });
        }

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
        const cellElements = row.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`);

        cellElements.forEach(cell => {
          const colIndex = Number(cell.getAttribute(CELL_COL_ATTR));

          if (!Number.isInteger(colIndex) || visited.has(`${rowIndex}:${colIndex}`)) {
            return;
          }

          const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

          // No container → merge-covered cell (no editable target by design).
          if (!container) {
            return;
          }

          const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), false);

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
  public reclaimReferencedBlocks(): void {
    const snapshot = this.model.snapshot();

    snapshot.content.forEach((row, rowIndex) => {
      row.forEach((cellContent, colIndex) => {
        if (!isCellWithBlocks(cellContent) || cellContent.blocks.length === 0) {
          return;
        }

        const cell = this.gridElement.querySelector<HTMLElement>(
          `[${CELL_ROW_ATTR}="${rowIndex}"][${CELL_COL_ATTR}="${colIndex}"]`
        );

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

      if ((nestedContainer !== null && !strandedInPreviousRender) || hasDifferentOwner) {
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
    //
    // isRepairingCell suppresses handleBlockMutation's claim heuristics for the
    // repair block's own block-added event: this method places the block itself,
    // and the removed-entry route would otherwise mis-claim it into whichever
    // cell recorded a removal at a coincidentally-equal flat index.
    this.isRepairingCell = true;

    try {
      this.api.blocks.transactWithoutCapture?.(() => {
        const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), true);

        container.appendChild(block.holder);
        this.api.blocks.setBlockParent(block.id, this.tableBlockId);
        this.syncBlockToModel(cell, block.id);
        this.stripPlaceholders(container);
      });
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
      if (!this.gridElement.contains(cell)) {
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
      const cellEl = this.gridElement.querySelector<HTMLElement>(
        `[${CELL_ROW_ATTR}="${recordedCellPos.row}"][${CELL_COL_ATTR}="${recordedCellPos.col}"]`
      );

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

    if (cell && this.gridElement.contains(cell)) {
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

    /**
     * A drag across several line blocks inside one cell ends with a click
     * whose target is retargeted to the blocks container (the common ancestor
     * of the mousedown/mouseup targets). That is NOT a blank-space click:
     * stealing the caret here would run Caret.setToBlock →
     * BlockSelection.clearSelection() and wipe the just-created multi-line
     * selection. Skip while any block inside this grid is selected.
     */
    if (this.gridElement.querySelector(`[${DATA_ATTR.selected}="true"]`) !== null) {
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
