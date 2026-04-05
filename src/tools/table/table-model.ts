import type { CellContent, CellPlacement, LegacyCellContent, TableData } from './types';
import { isCellWithBlocks } from './types';

export interface SelectionRect {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export interface MergeResult {
  /** Block IDs that were moved from absorbed cells into the origin cell. */
  blocksToRelocate: string[];
}

/**
 * Validate that a string is a safe CSS color value.
 *
 * Accepts:
 * - 3/4/6/8-digit hex: #rgb, #rgba, #rrggbb, #rrggbbaa
 * - rgb/rgba: rgb(r, g, b) / rgba(r, g, b, a)
 * - hsl/hsla: hsl(h, s%, l%) / hsla(h, s%, l%, a)
 * - The keyword "transparent"
 */
const isValidCssColor = (value: string): boolean => {
  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (/^#[0-9a-f]{3,4}$/i.test(value) || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
    return true;
  }

  // rgb/rgba
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(value)) {
    return true;
  }

  // hsl/hsla
  if (/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+\s*)?\)$/i.test(value)) {
    return true;
  }

  // Keywords
  if (value === 'transparent') {
    return true;
  }

  return false;
};

/**
 * Pure data model for table state.
 *
 * Holds the 2D grid of cells, column widths, and metadata flags.
 * Provides O(1) block-to-cell reverse lookup via an internal map.
 *
 * No DOM, no API — just data.
 */
export class TableModel {
  private contentGrid: CellContent[][];
  private withHeadingsValue: boolean;
  private withHeadingColumnValue: boolean;
  private stretchedValue: boolean;
  private colWidthsValue: number[] | undefined;
  private initialColWidthValue: number | undefined;

  /** O(1) reverse lookup: blockId -> { row, col } */
  private blockCellMap: Map<string, { row: number; col: number }>;

  constructor(data?: Partial<TableData>) {
    this.withHeadingsValue = data?.withHeadings ?? false;
    this.withHeadingColumnValue = data?.withHeadingColumn ?? false;
    this.stretchedValue = data?.stretched ?? false;
    this.colWidthsValue = data?.colWidths ? [...data.colWidths] : undefined;
    this.initialColWidthValue = data?.initialColWidth;

    this.contentGrid = this.normalizeContent(data?.content);
    this.blockCellMap = new Map();
    this.rebuildBlockCellMap();
  }

  // ─── Dimension getters ──────────────────────────────────────────

  get rows(): number {
    return this.contentGrid.length;
  }

  get cols(): number {
    return this.contentGrid.length > 0 ? this.contentGrid[0].length : 0;
  }

  // ─── Metadata getters ────────────────────────────────────────────

  get withHeadings(): boolean {
    return this.withHeadingsValue;
  }

  get withHeadingColumn(): boolean {
    return this.withHeadingColumnValue;
  }

  get stretched(): boolean {
    return this.stretchedValue;
  }

  get colWidths(): number[] | undefined {
    return this.colWidthsValue ? [...this.colWidthsValue] : undefined;
  }

  get initialColWidth(): number | undefined {
    return this.initialColWidthValue;
  }

  // ─── Snapshot ───────────────────────────────────────────────────

  /**
   * Return a deep copy of the current state. Mutations to the returned
   * object do not affect the model.
   */
  snapshot(): TableData {
    const base: TableData = {
      withHeadings: this.withHeadingsValue,
      withHeadingColumn: this.withHeadingColumnValue,
      stretched: this.stretchedValue,
      content: this.contentGrid.map(row =>
        row.map(c => {
          const cell: CellContent = { blocks: [...c.blocks] };

          if (c.color !== undefined) {
            cell.color = c.color;
          }

          if (c.textColor !== undefined) {
            cell.textColor = c.textColor;
          }

          if (c.placement !== undefined) {
            cell.placement = c.placement;
          }

          if (c.colspan !== undefined && c.colspan > 1) {
            cell.colspan = c.colspan;
          }

          if (c.rowspan !== undefined && c.rowspan > 1) {
            cell.rowspan = c.rowspan;
          }

          if (c.mergedInto !== undefined) {
            cell.mergedInto = [...c.mergedInto];
          }

          return cell;
        })
      ),
    };

    if (this.colWidthsValue !== undefined) {
      base.colWidths = [...this.colWidthsValue];
    }

    if (this.initialColWidthValue !== undefined) {
      base.initialColWidth = this.initialColWidthValue;
    }

    return base;
  }

  // ─── Cell operations ────────────────────────────────────────────

  /**
   * O(1) lookup of the cell containing a given block.
   */
  findCellForBlock(blockId: string): { row: number; col: number } | null {
    return this.blockCellMap.get(blockId) ?? null;
  }

  /**
   * Append a block to the given cell.
   */
  addBlockToCell(row: number, col: number, blockId: string): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    // Enforce invariant 5: no block in more than one cell
    const existing = this.blockCellMap.get(blockId);

    if (existing) {
      const oldCell = this.contentGrid[existing.row][existing.col];

      oldCell.blocks = oldCell.blocks.filter(id => id !== blockId);
    }

    this.contentGrid[row][col].blocks.push(blockId);
    this.blockCellMap.set(blockId, { row, col });
  }

  /**
   * Remove a specific block from the given cell.
   */
  removeBlockFromCell(row: number, col: number, blockId: string): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    const cell = this.contentGrid[row][col];
    const idx = cell.blocks.indexOf(blockId);

    if (idx === -1) {
      return;
    }

    cell.blocks.splice(idx, 1);
    this.blockCellMap.delete(blockId);
  }

  /**
   * Replace all blocks in a cell at once.
   */
  setCellBlocks(row: number, col: number, blockIds: string[]): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    // Remove old entries from map
    for (const oldId of this.contentGrid[row][col].blocks) {
      this.blockCellMap.delete(oldId);
    }

    this.contentGrid[row][col].blocks = [...blockIds];

    // Add new entries to map
    for (const id of blockIds) {
      this.blockCellMap.set(id, { row, col });
    }
  }

  /**
   * Get a copy of block IDs in a cell.
   */
  getCellBlocks(row: number, col: number): string[] {
    if (!this.isInBounds(row, col)) {
      return [];
    }

    return [...this.contentGrid[row][col].blocks];
  }

  /**
   * Set the background color for a cell. Pass undefined to remove.
   */
  setCellColor(row: number, col: number, color: string | undefined): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    if (color === undefined) {
      delete this.contentGrid[row][col].color;
    } else if (isValidCssColor(color)) {
      this.contentGrid[row][col].color = color;
    }
  }

  /**
   * Get the background color for a cell, or undefined if none set.
   */
  getCellColor(row: number, col: number): string | undefined {
    if (!this.isInBounds(row, col)) {
      return undefined;
    }

    return this.contentGrid[row][col].color;
  }

  /**
   * Set the text color for a cell. Pass undefined to remove.
   */
  setCellTextColor(row: number, col: number, color: string | undefined): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    if (color === undefined) {
      delete this.contentGrid[row][col].textColor;
    } else if (isValidCssColor(color)) {
      this.contentGrid[row][col].textColor = color;
    }
  }

  /**
   * Get the text color for a cell, or undefined if none set.
   */
  getCellTextColor(row: number, col: number): string | undefined {
    if (!this.isInBounds(row, col)) {
      return undefined;
    }

    return this.contentGrid[row][col].textColor;
  }

  setCellPlacement(row: number, col: number, placement: CellPlacement | undefined): void {
    if (!this.isInBounds(row, col)) {
      return;
    }
    if (placement === undefined) {
      delete this.contentGrid[row][col].placement;
    } else {
      this.contentGrid[row][col].placement = placement;
    }
  }

  getCellPlacement(row: number, col: number): CellPlacement | undefined {
    if (!this.isInBounds(row, col)) {
      return undefined;
    }

    return this.contentGrid[row][col].placement;
  }

  // ─── Row operations ─────────────────────────────────────────────

  /**
   * Insert an empty row. Returns instruction for the caller.
   */
  addRow(index?: number): { type: 'add-row'; index: number; cellsToPopulate: number } {
    const clampedIndex = index === undefined
      ? this.contentGrid.length
      : Math.min(Math.max(0, index), this.contentGrid.length);

    const colCount = this.cols;
    const newRow: CellContent[] = Array.from({ length: colCount }, () => ({ blocks: [] }));

    this.contentGrid.splice(clampedIndex, 0, newRow);
    this.shiftMergedIntoRows(clampedIndex, 1);
    this.expandSpansForInsertedRow(clampedIndex);
    this.rebuildBlockCellMap();

    return {
      type: 'add-row',
      index: clampedIndex,
      cellsToPopulate: colCount,
    };
  }

  /**
   * Remove a row. Returns the block IDs that were in it for cleanup.
   */
  deleteRow(index: number): { type: 'delete-row'; index: number; blocksToDelete: string[] } {
    if (!this.isRowInBounds(index)) {
      return { type: 'delete-row', index, blocksToDelete: [] };
    }

    this.contractSpansForDeletedRow(index);

    const blocksToDelete = this.collectBlocksInRow(index);

    this.contentGrid.splice(index, 1);

    for (const id of blocksToDelete) {
      this.blockCellMap.delete(id);
    }

    this.shiftMergedIntoRows(index, -1);
    this.rebuildBlockCellMap();

    return { type: 'delete-row', index, blocksToDelete };
  }

  /**
   * Reorder a row. Returns instruction for the caller.
   */
  moveRow(from: number, to: number): { type: 'move-row'; index: number; toIndex: number } {
    if (!this.isRowInBounds(from) || !this.isRowInBounds(to) || from === to) {
      return { type: 'move-row', index: from, toIndex: to };
    }

    if (this.isRowInvolvedInMerge(from)) {
      return { type: 'move-row', index: from, toIndex: to };
    }

    const [moved] = this.contentGrid.splice(from, 1);

    this.contentGrid.splice(to, 0, moved);
    this.rebuildMergedIntoRowCoordinates(from, to);
    this.rebuildBlockCellMap();

    return { type: 'move-row', index: from, toIndex: to };
  }

  // ─── Column operations ──────────────────────────────────────────

  /**
   * Insert an empty column. Returns instruction with cells to populate.
   */
  addColumn(index?: number, width?: number): {
    type: 'add-column';
    index: number;
    cellsToPopulate: Array<{ row: number; col: number }>;
  } {
    const clampedIndex = index === undefined
      ? this.cols
      : Math.min(Math.max(0, index), this.cols);

    const cellsToPopulate: Array<{ row: number; col: number }> = [];

    this.contentGrid.forEach((row, r) => {
      row.splice(clampedIndex, 0, { blocks: [] });
      cellsToPopulate.push({ row: r, col: clampedIndex });
    });

    if (this.colWidthsValue !== undefined) {
      const insertWidth = width ?? 0;

      this.colWidthsValue.splice(clampedIndex, 0, insertWidth);
    }

    this.shiftMergedIntoCols(clampedIndex, 1);
    this.expandSpansForInsertedCol(clampedIndex);
    this.rebuildBlockCellMap();

    return {
      type: 'add-column',
      index: clampedIndex,
      cellsToPopulate,
    };
  }

  /**
   * Remove a column. Returns block IDs for cleanup.
   */
  deleteColumn(index: number): { type: 'delete-column'; index: number; blocksToDelete: string[] } {
    if (!this.isColInBounds(index)) {
      return { type: 'delete-column', index, blocksToDelete: [] };
    }

    this.contractSpansForDeletedCol(index);

    const blocksToDelete = this.collectBlocksInColumn(index);

    for (const row of this.contentGrid) {
      row.splice(index, 1);
    }

    for (const id of blocksToDelete) {
      this.blockCellMap.delete(id);
    }

    if (this.colWidthsValue !== undefined) {
      this.colWidthsValue.splice(index, 1);
    }

    if (this.colWidthsValue?.length === 0) {
      this.colWidthsValue = undefined;
    }

    this.shiftMergedIntoCols(index, -1);
    this.rebuildBlockCellMap();

    return { type: 'delete-column', index, blocksToDelete };
  }

  /**
   * Reorder a column. Returns instruction for the caller.
   */
  moveColumn(from: number, to: number): { type: 'move-column'; index: number; toIndex: number } {
    if (!this.isColInBounds(from) || !this.isColInBounds(to) || from === to) {
      return { type: 'move-column', index: from, toIndex: to };
    }

    if (this.isColInvolvedInMerge(from)) {
      return { type: 'move-column', index: from, toIndex: to };
    }

    for (const row of this.contentGrid) {
      const [moved] = row.splice(from, 1);

      row.splice(to, 0, moved);
    }

    if (this.colWidthsValue !== undefined) {
      const [movedWidth] = this.colWidthsValue.splice(from, 1);

      this.colWidthsValue.splice(to, 0, movedWidth);
    }

    this.rebuildMergedIntoColCoordinates(from, to);
    this.rebuildBlockCellMap();

    return { type: 'move-column', index: from, toIndex: to };
  }

  // ─── replaceAll ─────────────────────────────────────────────────

  /**
   * Replace the entire model state. Used for setData / undo / redo.
   */
  replaceAll(data: TableData): void {
    this.withHeadingsValue = data.withHeadings;
    this.withHeadingColumnValue = data.withHeadingColumn;
    this.stretchedValue = data.stretched ?? false;
    this.colWidthsValue = data.colWidths ? [...data.colWidths] : undefined;
    this.initialColWidthValue = data.initialColWidth;

    this.contentGrid = this.normalizeContent(data.content);
    this.blockCellMap.clear();
    this.rebuildBlockCellMap();
  }

  // ─── Merge / Split ──────────────────────────────────────────────

  /**
   * Check whether the given rectangle of cells can be merged.
   * Returns true when the selection contains at least 2 grid positions,
   * is fully in-bounds, and no existing merged cell partially overlaps
   * the selection boundary.
   */
  canMergeCells(rect: SelectionRect): boolean {
    const { minRow, maxRow, minCol, maxCol } = rect;

    // Must span at least 2 cells
    if (minRow === maxRow && minCol === maxCol) {
      return false;
    }

    // Bounds check
    if (minRow < 0 || maxRow >= this.rows || minCol < 0 || maxCol >= this.cols) {
      return false;
    }

    // Check that no merged cell partially overlaps the selection boundary.
    // A merged cell is allowed if it's fully inside the selection.
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = this.contentGrid[r][c];

        // Check origin cells whose span extends beyond the selection
        const colspan = cell.colspan ?? 1;
        const rowspan = cell.rowspan ?? 1;

        if (colspan > 1 || rowspan > 1) {
          if (r + rowspan - 1 > maxRow || c + colspan - 1 > maxCol) {
            return false;
          }
        }

        // Check spanned cells whose origin is outside the selection
        if (cell.mergedInto !== undefined) {
          const [originRow, originCol] = cell.mergedInto;

          if (originRow < minRow || originCol < minCol) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Merge cells in the given rectangle. The top-left cell becomes the
   * origin with colspan/rowspan set. All other cells in the rectangle
   * become spanned (mergedInto pointing to origin, blocks emptied).
   *
   * Blocks from absorbed cells are concatenated into the origin cell
   * in row-major order.
   */
  mergeCells(rect: SelectionRect): MergeResult {
    const { minRow, maxRow, minCol, maxCol } = rect;
    const result: MergeResult = { blocksToRelocate: [] };

    if (!this.canMergeCells(rect)) {
      return result;
    }

    const origin = this.contentGrid[minRow][minCol];

    // First, if any cell in the selection is itself an origin of a merge,
    // split it so we work with flat cells
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (r === minRow && c === minCol) {
          continue;
        }

        const cell = this.contentGrid[r][c];

        if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
          this.splitCellInternal(r, c);
        }
      }
    }

    // Also split the origin if it was previously merged
    if ((origin.colspan ?? 1) > 1 || (origin.rowspan ?? 1) > 1) {
      this.splitCellInternal(minRow, minCol);
    }

    // Collect blocks from all cells in row-major order and move to origin
    const collectedBlocks: string[] = [];

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = this.contentGrid[r][c];

        for (const blockId of cell.blocks) {
          collectedBlocks.push(blockId);

          if (r !== minRow || c !== minCol) {
            result.blocksToRelocate.push(blockId);
          }
        }

        // Clear non-origin cells
        if (r !== minRow || c !== minCol) {
          cell.blocks = [];
          cell.mergedInto = [minRow, minCol];
          delete cell.colspan;
          delete cell.rowspan;
        }
      }
    }

    // Set origin cell
    origin.blocks = collectedBlocks;
    origin.colspan = maxCol - minCol + 1;
    origin.rowspan = maxRow - minRow + 1;
    delete origin.mergedInto;

    // Normalize: remove colspan/rowspan if 1
    if (origin.colspan === 1) {
      delete origin.colspan;
    }

    if (origin.rowspan === 1) {
      delete origin.rowspan;
    }

    this.rebuildBlockCellMap();

    return result;
  }

  /**
   * Split a merged cell at (row, col) back into individual cells.
   * All content stays in the origin cell; freed cells become empty.
   * No-op if the cell is not a merge origin.
   */
  splitCell(row: number, col: number): void {
    if (!this.isInBounds(row, col)) {
      return;
    }

    const cell = this.contentGrid[row][col];

    if ((cell.colspan ?? 1) <= 1 && (cell.rowspan ?? 1) <= 1) {
      return;
    }

    this.splitCellInternal(row, col);
    this.rebuildBlockCellMap();
  }

  /**
   * Returns true if the cell at (row, col) is the origin of a merge
   * (has colspan > 1 or rowspan > 1).
   */
  isMergedCell(row: number, col: number): boolean {
    if (!this.isInBounds(row, col)) {
      return false;
    }

    const cell = this.contentGrid[row][col];

    return (cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1;
  }

  /**
   * Returns true if the cell at (row, col) is covered by another cell's merge
   * (has mergedInto set).
   */
  isSpannedCell(row: number, col: number): boolean {
    if (!this.isInBounds(row, col)) {
      return false;
    }

    return this.contentGrid[row][col].mergedInto !== undefined;
  }

  /**
   * Get the colspan and rowspan of the cell at (row, col).
   * Returns {colspan: 1, rowspan: 1} for regular/spanned cells.
   */
  getCellSpan(row: number, col: number): { colspan: number; rowspan: number } {
    if (!this.isInBounds(row, col)) {
      return { colspan: 1, rowspan: 1 };
    }

    const cell = this.contentGrid[row][col];

    return {
      colspan: cell.colspan ?? 1,
      rowspan: cell.rowspan ?? 1,
    };
  }

  /**
   * Internal split that doesn't rebuild the block cell map.
   * Used by mergeCells to flatten existing merges before re-merging.
   */
  private splitCellInternal(row: number, col: number): void {
    const cell = this.contentGrid[row][col];
    const colspan = cell.colspan ?? 1;
    const rowspan = cell.rowspan ?? 1;

    // Clear spanned cells
    for (let r = row; r < row + rowspan && r < this.rows; r++) {
      for (let c = col; c < col + colspan && c < this.cols; c++) {
        if (r === row && c === col) {
          continue;
        }

        const spanned = this.contentGrid[r][c];

        delete spanned.mergedInto;
        spanned.blocks = [];
      }
    }

    // Reset origin
    delete cell.colspan;
    delete cell.rowspan;
  }

  // ─── Metadata setters ──────────────────────────────────────────

  setWithHeadings(value: boolean): void {
    this.withHeadingsValue = value;
  }

  setWithHeadingColumn(value: boolean): void {
    this.withHeadingColumnValue = value;
  }

  setStretched(value: boolean): void {
    this.stretchedValue = value;
  }

  setColWidths(widths: number[] | undefined): void {
    this.colWidthsValue = widths ? [...widths] : undefined;
  }

  setInitialColWidth(value: number | undefined): void {
    this.initialColWidthValue = value;
  }

  // ─── Invariant validation ───────────────────────────────────────

  /**
   * Validate all model invariants. Throws if any invariant is violated.
   * Useful for debugging and test assertions.
   *
   * Invariants checked:
   * 1. Rectangular grid: all rows have the same length
   * 2. colWidths sync: colWidths length matches column count when defined
   * 3. blockCellMap consistency: map matches grid contents
   * 4. No duplicate blocks: each block ID appears in exactly one cell
   */
  validateInvariants(): void {
    // Invariant 1: Rectangular grid
    if (this.contentGrid.length > 0) {
      const expectedCols = this.contentGrid[0].length;

      this.contentGrid.forEach((row, r) => {
        if (row.length !== expectedCols) {
          throw new Error(
            `Invariant violation: row ${r} has ${row.length} columns, expected ${expectedCols}`
          );
        }
      });
    }

    // Invariant 2: colWidths sync
    if (
      this.colWidthsValue !== undefined &&
      this.contentGrid.length > 0 &&
      this.colWidthsValue.length !== this.contentGrid[0].length
    ) {
      throw new Error(
        `Invariant violation: colWidths has ${this.colWidthsValue.length} entries but grid has ${this.contentGrid[0].length} columns`
      );
    }

    // Invariant 3 + 4: blockCellMap consistency and no duplicates
    const seenBlocks = new Set<string>();

    this.contentGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        for (const blockId of cell.blocks) {
          if (seenBlocks.has(blockId)) {
            throw new Error(
              `Invariant violation: block "${blockId}" appears in multiple cells`
            );
          }
          seenBlocks.add(blockId);

          const mapped = this.blockCellMap.get(blockId);

          if (!mapped) {
            throw new Error(
              `Invariant violation: block "${blockId}" at [${r},${c}] not in blockCellMap`
            );
          }
          if (mapped.row !== r || mapped.col !== c) {
            throw new Error(
              `Invariant violation: block "${blockId}" at [${r},${c}] mapped to [${mapped.row},${mapped.col}]`
            );
          }
        }
      });
    });

    // Invariant 5: merge spans in bounds
    this.contentGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        const colspan = cell.colspan ?? 1;
        const rowspan = cell.rowspan ?? 1;

        if (colspan > 1 || rowspan > 1) {
          if (r + rowspan > this.contentGrid.length || c + colspan > (this.contentGrid[0]?.length ?? 0)) {
            throw new Error(
              `Invariant violation: origin [${r},${c}] span extends beyond grid bounds (colspan=${colspan}, rowspan=${rowspan}, rows=${this.contentGrid.length}, cols=${this.contentGrid[0]?.length ?? 0})`
            );
          }
        }
      });
    });

    // Invariant 6: mergedInto references are valid
    this.contentGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell.mergedInto === undefined) {
          return;
        }

        const [originRow, originCol] = cell.mergedInto;

        // Must be in bounds
        if (originRow < 0 || originRow >= this.contentGrid.length ||
            originCol < 0 || originCol >= (this.contentGrid[0]?.length ?? 0)) {
          throw new Error(
            `Invariant violation: mergedInto at [${r},${c}] points to out-of-bounds [${originRow},${originCol}]`
          );
        }

        // Must point to a merge origin
        const origin = this.contentGrid[originRow][originCol];
        const oColspan = origin.colspan ?? 1;
        const oRowspan = origin.rowspan ?? 1;

        if (oColspan <= 1 && oRowspan <= 1) {
          throw new Error(
            `Invariant violation: mergedInto at [${r},${c}] points to [${originRow},${originCol}] which is not a merge origin`
          );
        }

        // Must be within the origin's span
        if (r < originRow || r >= originRow + oRowspan ||
            c < originCol || c >= originCol + oColspan) {
          throw new Error(
            `Invariant violation: mergedInto at [${r},${c}] is outside the span of origin [${originRow},${originCol}] (colspan=${oColspan}, rowspan=${oRowspan})`
          );
        }
      });
    });

    // Invariant 7: every cell within an origin's span has mergedInto (except the origin itself)
    this.contentGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        const colspan = cell.colspan ?? 1;
        const rowspan = cell.rowspan ?? 1;

        if (colspan <= 1 && rowspan <= 1) {
          return;
        }

        for (let dr = r; dr < r + rowspan; dr++) {
          for (let dc = c; dc < c + colspan; dc++) {
            if (dr === r && dc === c) {
              continue;
            }

            const spanned = this.contentGrid[dr]?.[dc];

            if (!spanned?.mergedInto) {
              throw new Error(
                `Invariant violation: cell [${dr},${dc}] is within span of origin [${r},${c}] but has no mergedInto`
              );
            }
          }
        }
      });
    });

    // Check map doesn't have extra entries
    if (this.blockCellMap.size !== seenBlocks.size) {
      throw new Error(
        `Invariant violation: blockCellMap has ${this.blockCellMap.size} entries but grid has ${seenBlocks.size} blocks`
      );
    }
  }

  // ─── Merge-aware structural helpers ─────────────────────────────

  /**
   * Shift mergedInto row coordinates for all cells where mergedInto[0] >= startRow.
   * Called after inserting (delta=1) or deleting (delta=-1) a row.
   */
  private shiftMergedIntoRows(startRow: number, delta: number): void {
    for (const row of this.contentGrid) {
      for (const cell of row) {
        if (cell.mergedInto !== undefined && cell.mergedInto[0] >= startRow) {
          cell.mergedInto = [cell.mergedInto[0] + delta, cell.mergedInto[1]];
        }
      }
    }
  }

  /**
   * Shift mergedInto col coordinates for all cells where mergedInto[1] >= startCol.
   * Called after inserting (delta=1) or deleting (delta=-1) a column.
   */
  private shiftMergedIntoCols(startCol: number, delta: number): void {
    for (const row of this.contentGrid) {
      for (const cell of row) {
        if (cell.mergedInto !== undefined && cell.mergedInto[1] >= startCol) {
          cell.mergedInto = [cell.mergedInto[0], cell.mergedInto[1] + delta];
        }
      }
    }
  }

  /**
   * After inserting a row at insertedRow, find origin cells above whose rowspan
   * crosses the insertion point, increment their rowspan, and mark new cells as covered.
   */
  private expandSpansForInsertedRow(insertedRow: number): void {
    for (let r = 0; r < this.contentGrid.length; r++) {
      for (let c = 0; c < this.contentGrid[r].length; c++) {
        const cell = this.contentGrid[r][c];
        const rowspan = cell.rowspan ?? 1;
        const colspan = cell.colspan ?? 1;

        if (rowspan <= 1 && colspan <= 1) {
          continue;
        }

        // Origin must be above the inserted row and its span must cross it.
        // The origin is at row r (which is the post-insert index).
        // If r < insertedRow and the origin was originally at r (not shifted),
        // its span originally ended at r + rowspan - 1 (in post-insert coords, the
        // original spanned rows below insertedRow were shifted down by 1).
        // The insertion point is crossed when the original span end >= insertedRow,
        // i.e., the origin is strictly above the insertion and its span extends into or past it.
        // After insert: origin at r, cells it used to cover are at r..r+rowspan-1 but
        // with a gap at insertedRow. We need to check: r < insertedRow and
        // the span (which has already been shifted) reaches past insertedRow.
        // Since mergedInto coords were already shifted, the covered cells below
        // insertedRow now point correctly, but the new row at insertedRow is uncovered.
        // Condition: origin at r < insertedRow and r + rowspan > insertedRow
        // (rowspan is still the old value, but rows below were shifted, so
        // the old span of rowspan rows now has a gap at insertedRow).
        if (r < insertedRow && r + rowspan > insertedRow) {
          // Increment rowspan to absorb the new row
          cell.rowspan = rowspan + 1;

          // Mark the new row's cells within the colspan as covered
          for (let dc = c; dc < c + colspan; dc++) {
            if (dc < this.contentGrid[insertedRow].length) {
              const newCell = this.contentGrid[insertedRow][dc];

              if (dc === c && r === insertedRow) {
                // This would be the origin itself — skip (shouldn't happen since r < insertedRow)
                continue;
              }
              newCell.mergedInto = [r, c];
              newCell.blocks = [];
            }
          }
        }
      }
    }
  }

  /**
   * After inserting a column at insertedCol, find origin cells to the left whose colspan
   * crosses the insertion point, increment their colspan, and mark new cells as covered.
   */
  private expandSpansForInsertedCol(insertedCol: number): void {
    for (let r = 0; r < this.contentGrid.length; r++) {
      for (let c = 0; c < this.contentGrid[r].length; c++) {
        const cell = this.contentGrid[r][c];
        const rowspan = cell.rowspan ?? 1;
        const colspan = cell.colspan ?? 1;

        if (rowspan <= 1 && colspan <= 1) {
          continue;
        }

        if (c < insertedCol && c + colspan > insertedCol) {
          cell.colspan = colspan + 1;

          for (let dr = r; dr < r + rowspan; dr++) {
            if (dr < this.contentGrid.length) {
              const newCell = this.contentGrid[dr][insertedCol];

              if (dr === r && insertedCol === c) {
                continue;
              }
              newCell.mergedInto = [r, c];
              newCell.blocks = [];
            }
          }
        }
      }
    }
  }

  /**
   * Before deleting a row, handle merge origins and covered cells in that row.
   * - If a cell is a merge origin with rowspan > 1: transfer to the row below.
   * - If a cell has mergedInto pointing to a different row: decrement origin's rowspan.
   */
  private contractSpansForDeletedRow(rowIndex: number): void {
    const row = this.contentGrid[rowIndex];

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];

      if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
        // This cell is a merge origin
        const rowspan = cell.rowspan ?? 1;
        const colspan = cell.colspan ?? 1;

        if (rowspan > 1) {
          const newRowspan = rowspan - 1;
          const nextRow = rowIndex + 1;

          if (nextRow < this.contentGrid.length) {
            const newOrigin = this.contentGrid[nextRow][c];

            // Transfer blocks and merge metadata to the new origin
            newOrigin.blocks = [...cell.blocks];
            cell.blocks = [];

            if (newRowspan === 1 && colspan === 1) {
              // Dissolve the merge entirely
              delete newOrigin.mergedInto;
              delete newOrigin.colspan;
              delete newOrigin.rowspan;

              // Clear mergedInto from all cells that pointed to this origin
              for (let dr = nextRow; dr < rowIndex + rowspan; dr++) {
                for (let dc = c; dc < c + colspan; dc++) {
                  if (dr === nextRow && dc === c) {
                    continue;
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto?.[0] === rowIndex && spanned?.mergedInto?.[1] === c) {
                    delete spanned.mergedInto;
                  }
                }
              }
            } else {
              // Set new origin's merge metadata
              delete newOrigin.mergedInto;
              if (newRowspan > 1) {
                newOrigin.rowspan = newRowspan;
              } else {
                delete newOrigin.rowspan;
              }
              if (colspan > 1) {
                newOrigin.colspan = colspan;
              } else {
                delete newOrigin.colspan;
              }

              // Update mergedInto references to point to new origin
              for (let dr = nextRow; dr < rowIndex + rowspan; dr++) {
                for (let dc = c; dc < c + colspan; dc++) {
                  if (dr === nextRow && dc === c) {
                    continue;
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto?.[0] === rowIndex && spanned?.mergedInto?.[1] === c) {
                    spanned.mergedInto = [nextRow, c];
                  }
                }
              }
            }
          }

          // Clear the old origin's merge metadata
          delete cell.colspan;
          delete cell.rowspan;
        }
      } else if (cell.mergedInto !== undefined) {
        // This cell is covered by a merge from a different row
        const [originRow, originCol] = cell.mergedInto;

        if (originRow !== rowIndex) {
          const origin = this.contentGrid[originRow]?.[originCol];

          if (origin) {
            const oRowspan = origin.rowspan ?? 1;
            const oColspan = origin.colspan ?? 1;
            const newRowspan = oRowspan - 1;

            if (newRowspan === 1 && oColspan === 1) {
              // Dissolve the merge
              delete origin.colspan;
              delete origin.rowspan;

              // Clear mergedInto from all remaining cells in the span
              for (let dr = originRow; dr < originRow + oRowspan; dr++) {
                for (let dc = originCol; dc < originCol + oColspan; dc++) {
                  if (dr === originRow && dc === originCol) {
                    continue;
                  }
                  if (dr === rowIndex) {
                    continue; // This row is being deleted
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto) {
                    delete spanned.mergedInto;
                  }
                }
              }
            } else {
              if (newRowspan > 1) {
                origin.rowspan = newRowspan;
              } else {
                delete origin.rowspan;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Before deleting a column, handle merge origins and covered cells in that column.
   * Symmetric to contractSpansForDeletedRow.
   */
  private contractSpansForDeletedCol(colIndex: number): void {
    for (let r = 0; r < this.contentGrid.length; r++) {
      const cell = this.contentGrid[r][colIndex];

      if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
        // This cell is a merge origin
        const rowspan = cell.rowspan ?? 1;
        const colspan = cell.colspan ?? 1;

        if (colspan > 1) {
          const newColspan = colspan - 1;
          const nextCol = colIndex + 1;

          if (nextCol < this.contentGrid[r].length) {
            const newOrigin = this.contentGrid[r][nextCol];

            // Transfer blocks to the new origin
            newOrigin.blocks = [...cell.blocks];
            cell.blocks = [];

            if (newColspan === 1 && rowspan === 1) {
              // Dissolve the merge entirely
              delete newOrigin.mergedInto;
              delete newOrigin.colspan;
              delete newOrigin.rowspan;

              for (let dr = r; dr < r + rowspan; dr++) {
                for (let dc = nextCol; dc < colIndex + colspan; dc++) {
                  if (dr === r && dc === nextCol) {
                    continue;
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto?.[0] === r && spanned?.mergedInto?.[1] === colIndex) {
                    delete spanned.mergedInto;
                  }
                }
              }
            } else {
              delete newOrigin.mergedInto;
              if (newColspan > 1) {
                newOrigin.colspan = newColspan;
              } else {
                delete newOrigin.colspan;
              }
              if (rowspan > 1) {
                newOrigin.rowspan = rowspan;
              } else {
                delete newOrigin.rowspan;
              }

              // Update mergedInto references
              for (let dr = r; dr < r + rowspan; dr++) {
                for (let dc = nextCol; dc < colIndex + colspan; dc++) {
                  if (dr === r && dc === nextCol) {
                    continue;
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto?.[0] === r && spanned?.mergedInto?.[1] === colIndex) {
                    spanned.mergedInto = [r, nextCol];
                  }
                }
              }
            }
          }

          // Clear old origin's merge metadata
          delete cell.colspan;
          delete cell.rowspan;
        }
      } else if (cell.mergedInto !== undefined) {
        const [originRow, originCol] = cell.mergedInto;

        if (originCol !== colIndex) {
          const origin = this.contentGrid[originRow]?.[originCol];

          if (origin) {
            const oColspan = origin.colspan ?? 1;
            const oRowspan = origin.rowspan ?? 1;
            const newColspan = oColspan - 1;

            if (newColspan === 1 && oRowspan === 1) {
              delete origin.colspan;
              delete origin.rowspan;

              for (let dr = originRow; dr < originRow + oRowspan; dr++) {
                for (let dc = originCol; dc < originCol + oColspan; dc++) {
                  if (dr === originRow && dc === originCol) {
                    continue;
                  }
                  if (dc === colIndex) {
                    continue;
                  }
                  const spanned = this.contentGrid[dr]?.[dc];

                  if (spanned?.mergedInto) {
                    delete spanned.mergedInto;
                  }
                }
              }
            } else {
              if (newColspan > 1) {
                origin.colspan = newColspan;
              } else {
                delete origin.colspan;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Check if any cell in a row is involved in a merge that extends beyond the row.
   */
  private isRowInvolvedInMerge(rowIndex: number): boolean {
    const row = this.contentGrid[rowIndex];

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];

      // Origin with rowspan > 1 means it extends to other rows
      if ((cell.rowspan ?? 1) > 1) {
        return true;
      }

      // Covered by a merge from a different row
      if (cell.mergedInto !== undefined && cell.mergedInto[0] !== rowIndex) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if any cell in a column is involved in a merge that extends beyond the column.
   */
  private isColInvolvedInMerge(colIndex: number): boolean {
    for (let r = 0; r < this.contentGrid.length; r++) {
      const cell = this.contentGrid[r][colIndex];

      // Origin with colspan > 1 means it extends to other columns
      if ((cell.colspan ?? 1) > 1) {
        return true;
      }

      // Covered by a merge from a different column
      if (cell.mergedInto !== undefined && cell.mergedInto[1] !== colIndex) {
        return true;
      }
    }

    return false;
  }

  /**
   * After a row move (splice from, splice to), rebuild mergedInto row coordinates
   * by computing the index remapping.
   */
  private rebuildMergedIntoRowCoordinates(from: number, to: number): void {
    // Build the mapping: for each old row index, what is its new index?
    const rowCount = this.contentGrid.length;
    const mapping = new Array<number>(rowCount);

    // After splice(from, 1) then splice(to, 0, moved):
    // The row that was at `from` is now at `to`.
    // Other rows shift to fill the gap and accommodate the insertion.
    for (let oldIdx = 0; oldIdx < rowCount; oldIdx++) {
      let newIdx = oldIdx;

      // First: remove from `from` — rows above `from` stay, rows below shift up
      if (oldIdx === from) {
        newIdx = to;
        mapping[oldIdx] = newIdx;
        continue;
      }

      if (oldIdx > from) {
        newIdx = oldIdx - 1;
      }

      // Then: insert at `to` — rows at/below `to` shift down
      if (newIdx >= to) {
        newIdx = newIdx + 1;
      }

      mapping[oldIdx] = newIdx;
    }

    // Now remap mergedInto coordinates using the inverse mapping.
    // We need: for each current row position, what was the old row index?
    // Then use the mapping to figure out the new origin position.
    // But actually, since the splice already happened, the grid is in its final position.
    // We need to map old mergedInto values through the mapping.
    // The cells are already in their new positions, but their mergedInto values
    // still reference old row indices. We need to update them.
    for (const row of this.contentGrid) {
      for (const cell of row) {
        if (cell.mergedInto !== undefined) {
          const oldOriginRow = cell.mergedInto[0];

          cell.mergedInto = [mapping[oldOriginRow], cell.mergedInto[1]];
        }
      }
    }
  }

  /**
   * After a column move (splice from, splice to), rebuild mergedInto col coordinates
   * by computing the index remapping.
   */
  private rebuildMergedIntoColCoordinates(from: number, to: number): void {
    const colCount = this.cols;
    const mapping = new Array<number>(colCount);

    for (let oldIdx = 0; oldIdx < colCount; oldIdx++) {
      let newIdx = oldIdx;

      if (oldIdx === from) {
        newIdx = to;
        mapping[oldIdx] = newIdx;
        continue;
      }

      if (oldIdx > from) {
        newIdx = oldIdx - 1;
      }

      if (newIdx >= to) {
        newIdx = newIdx + 1;
      }

      mapping[oldIdx] = newIdx;
    }

    for (const row of this.contentGrid) {
      for (const cell of row) {
        if (cell.mergedInto !== undefined) {
          const oldOriginCol = cell.mergedInto[1];

          cell.mergedInto = [cell.mergedInto[0], mapping[oldOriginCol]];
        }
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────

  /**
   * Normalize legacy content (strings) into CellContent objects.
   */
  private normalizeContent(content?: LegacyCellContent[][]): CellContent[][] {
    if (!content || !Array.isArray(content)) {
      return [];
    }

    return content.map(row =>
      (row ?? []).map(c => this.normalizeCell(c))
    );
  }

  /**
   * Normalize a single cell: legacy strings become empty blocks arrays.
   */
  private normalizeCell(cell: LegacyCellContent): CellContent {
    if (isCellWithBlocks(cell)) {
      const normalized: CellContent = { blocks: [...cell.blocks] };

      if (cell.color !== undefined && isValidCssColor(cell.color)) {
        normalized.color = cell.color;
      }

      if (cell.textColor !== undefined && isValidCssColor(cell.textColor)) {
        normalized.textColor = cell.textColor;
      }

      if (cell.placement !== undefined) {
        normalized.placement = cell.placement;
      }

      if (cell.colspan !== undefined && cell.colspan > 1) {
        normalized.colspan = cell.colspan;
      }

      if (cell.rowspan !== undefined && cell.rowspan > 1) {
        normalized.rowspan = cell.rowspan;
      }

      if (cell.mergedInto !== undefined) {
        normalized.mergedInto = [...cell.mergedInto];
      }

      return normalized;
    }

    return { blocks: [] };
  }

  /**
   * Rebuild the blockCellMap from the content grid.
   * Called after any structural operation that shifts row/col indices.
   */
  private rebuildBlockCellMap(): void {
    this.blockCellMap.clear();

    this.contentGrid.forEach((row, r) => {
      row.forEach((cell, c) => {
        for (const blockId of cell.blocks) {
          this.blockCellMap.set(blockId, { row: r, col: c });
        }
      });
    });
  }

  private isInBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.contentGrid.length &&
      col >= 0 && (this.contentGrid.length === 0 || col < this.contentGrid[row].length);
  }

  private isRowInBounds(index: number): boolean {
    return index >= 0 && index < this.contentGrid.length;
  }

  private isColInBounds(index: number): boolean {
    return index >= 0 && this.contentGrid.length > 0 && index < this.contentGrid[0].length;
  }

  private collectBlocksInRow(rowIndex: number): string[] {
    const blocks: string[] = [];

    for (const cell of this.contentGrid[rowIndex]) {
      blocks.push(...cell.blocks);
    }

    return blocks;
  }

  private collectBlocksInColumn(colIndex: number): string[] {
    const blocks: string[] = [];

    for (const row of this.contentGrid) {
      if (colIndex < row.length) {
        blocks.push(...row[colIndex].blocks);
      }
    }

    return blocks;
  }
}
