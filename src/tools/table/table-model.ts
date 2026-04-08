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

    if (this.isSpannedCell(row, col)) {
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
    return this.contentGrid.slice(minRow, maxRow + 1).every((row, ri) => {
      const r = minRow + ri;

      return row.slice(minCol, maxCol + 1).every((cell, ci) => {
        const c = minCol + ci;

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

        return true;
      });
    });
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
    this.contentGrid.slice(minRow, maxRow + 1).forEach((row, ri) => {
      const r = minRow + ri;

      row.slice(minCol, maxCol + 1).forEach((cell, ci) => {
        const c = minCol + ci;

        if (r === minRow && c === minCol) {
          return;
        }

        if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
          this.splitCellInternal(r, c);
        }
      });
    });

    // Also split the origin if it was previously merged
    if ((origin.colspan ?? 1) > 1 || (origin.rowspan ?? 1) > 1) {
      this.splitCellInternal(minRow, minCol);
    }

    // Collect blocks from all cells in row-major order and move to origin
    const collectedBlocks: string[] = [];

    this.contentGrid.slice(minRow, maxRow + 1).forEach((_row, ri) => {
      const r = minRow + ri;

      this.contentGrid[r].slice(minCol, maxCol + 1).forEach((_cell, ci) => {
        const c = minCol + ci;
        const gridCell = this.contentGrid[r][c];

        for (const blockId of gridCell.blocks) {
          collectedBlocks.push(blockId);

          if (r !== minRow || c !== minCol) {
            result.blocksToRelocate.push(blockId);
          }
        }

        // Clear non-origin cells
        if (r !== minRow || c !== minCol) {
          gridCell.blocks = [];
          gridCell.mergedInto = [minRow, minCol];
          delete gridCell.colspan;
          delete gridCell.rowspan;
        }
      });
    });

    // Set origin cell
    origin.blocks = collectedBlocks;
    origin.colspan = maxCol - minCol + 1;
    origin.rowspan = maxRow - minRow + 1;
    delete origin.mergedInto;
    // Reset placement to default (top-left) on merge
    delete origin.placement;

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
    this.contentGrid.slice(row, Math.min(row + rowspan, this.rows)).forEach((_gridRow, ri) => {
      const r = row + ri;

      this.contentGrid[r].slice(col, Math.min(col + colspan, this.cols)).forEach((_spanned, ci) => {
        const c = col + ci;

        if (r === row && c === col) {
          return;
        }

        const spanned = this.contentGrid[r][c];

        delete spanned.mergedInto;
        spanned.blocks = [];
        delete spanned.placement;
      });
    });

    // Reset origin
    delete cell.colspan;
    delete cell.rowspan;
    delete cell.placement;
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

        this.contentGrid.slice(r, r + rowspan).forEach((spanRow, dri) => {
          const dr = r + dri;

          spanRow.slice(c, c + colspan).forEach((spanned, dci) => {
            const dc = c + dci;

            if (dr === r && dc === c) {
              return;
            }

            if (!spanned?.mergedInto) {
              throw new Error(
                `Invariant violation: cell [${dr},${dc}] is within span of origin [${r},${c}] but has no mergedInto`
              );
            }
          });
        });
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
    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];

        if (gridCell.mergedInto !== undefined && gridCell.mergedInto[0] >= startRow) {
          gridCell.mergedInto = [gridCell.mergedInto[0] + delta, gridCell.mergedInto[1]];
        }
      });
    });
  }

  /**
   * Shift mergedInto col coordinates for all cells where mergedInto[1] >= startCol.
   * Called after inserting (delta=1) or deleting (delta=-1) a column.
   */
  private shiftMergedIntoCols(startCol: number, delta: number): void {
    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];

        if (gridCell.mergedInto !== undefined && gridCell.mergedInto[1] >= startCol) {
          gridCell.mergedInto = [gridCell.mergedInto[0], gridCell.mergedInto[1] + delta];
        }
      });
    });
  }

  /**
   * After inserting a row at insertedRow, find origin cells above whose rowspan
   * crosses the insertion point, increment their rowspan, and mark new cells as covered.
   */
  private expandSpansForInsertedRow(insertedRow: number): void {
    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];
        const rowspan = gridCell.rowspan ?? 1;
        const colspan = gridCell.colspan ?? 1;

        if (rowspan <= 1 && colspan <= 1) {
          return;
        }

        if (r >= insertedRow || r + rowspan <= insertedRow) {
          return;
        }

        // Increment rowspan to absorb the new row
        gridCell.rowspan = rowspan + 1;

        // Mark the new row's cells within the colspan as covered
        this.markInsertedRowCells(insertedRow, r, c, colspan);
      });
    });
  }

  private markInsertedRowCells(insertedRow: number, originRow: number, originCol: number, colspan: number): void {
    this.contentGrid[insertedRow].slice(originCol, originCol + colspan).forEach((_newCell, ci) => {
      const dc = originCol + ci;

      if (dc === originCol && originRow === insertedRow) {
        return;
      }
      const gridCell = this.contentGrid[insertedRow][dc];

      gridCell.mergedInto = [originRow, originCol];
      gridCell.blocks = [];
    });
  }

  /**
   * After inserting a column at insertedCol, find origin cells to the left whose colspan
   * crosses the insertion point, increment their colspan, and mark new cells as covered.
   */
  private expandSpansForInsertedCol(insertedCol: number): void {
    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];
        const rowspan = gridCell.rowspan ?? 1;
        const colspan = gridCell.colspan ?? 1;

        if (rowspan <= 1 && colspan <= 1) {
          return;
        }

        if (c >= insertedCol || c + colspan <= insertedCol) {
          return;
        }

        gridCell.colspan = colspan + 1;

        // Mark the new column's cells within the rowspan as covered
        this.markInsertedColCells(insertedCol, r, c, rowspan);
      });
    });
  }

  private markInsertedColCells(insertedCol: number, originRow: number, originCol: number, rowspan: number): void {
    this.contentGrid.slice(originRow, originRow + rowspan).forEach((_gridRow, ri) => {
      const dr = originRow + ri;

      if (dr === originRow && insertedCol === originCol) {
        return;
      }
      const gridCell = this.contentGrid[dr][insertedCol];

      gridCell.mergedInto = [originRow, originCol];
      gridCell.blocks = [];
    });
  }

  /**
   * Before deleting a row, handle merge origins and covered cells in that row.
   * - If a cell is a merge origin with rowspan > 1: transfer to the row below.
   * - If a cell has mergedInto pointing to a different row: decrement origin's rowspan.
   */
  private contractSpansForDeletedRow(rowIndex: number): void {
    const row = this.contentGrid[rowIndex];

    row.forEach((_cell, c) => {
      const gridCell = this.contentGrid[rowIndex][c];

      if ((gridCell.colspan ?? 1) > 1 || (gridCell.rowspan ?? 1) > 1) {
        this.handleOriginInDeletedRow(rowIndex, c);
      } else if (gridCell.mergedInto !== undefined) {
        this.handleCoveredInDeletedRow(rowIndex, c);
      }
    });
  }

  private handleOriginInDeletedRow(rowIndex: number, c: number): void {
    const cell = this.contentGrid[rowIndex][c];
    const rowspan = cell.rowspan ?? 1;
    const colspan = cell.colspan ?? 1;

    if (rowspan <= 1) {
      return;
    }

    const newRowspan = rowspan - 1;
    const nextRow = rowIndex + 1;

    if (nextRow < this.contentGrid.length) {
      this.transferOriginToNextRow(rowIndex, c, nextRow, rowspan, colspan, newRowspan);
    }

    delete cell.colspan;
    delete cell.rowspan;
  }

  private transferOriginToNextRow(
    rowIndex: number, c: number, nextRow: number,
    rowspan: number, colspan: number, newRowspan: number
  ): void {
    const cell = this.contentGrid[rowIndex][c];
    const newOrigin = this.contentGrid[nextRow][c];

    newOrigin.blocks = [...cell.blocks];
    cell.blocks = [];

    delete newOrigin.mergedInto;

    if (newRowspan === 1 && colspan === 1) {
      delete newOrigin.colspan;
      delete newOrigin.rowspan;
      this.clearMergedIntoRefs(nextRow, rowIndex + rowspan, c, c + colspan, rowIndex, c, nextRow, c, undefined);

      return;
    }

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
    this.clearMergedIntoRefs(nextRow, rowIndex + rowspan, c, c + colspan, rowIndex, c, nextRow, c, [nextRow, c]);
  }

  private handleCoveredInDeletedRow(rowIndex: number, c: number): void {
    const cell = this.contentGrid[rowIndex][c];
    const [originRow, originCol] = cell.mergedInto as [number, number];

    if (originRow === rowIndex) {
      return;
    }

    const origin = this.contentGrid[originRow]?.[originCol];

    if (!origin) {
      return;
    }

    const oRowspan = origin.rowspan ?? 1;
    const oColspan = origin.colspan ?? 1;
    const newRowspan = oRowspan - 1;

    if (newRowspan === 1 && oColspan === 1) {
      delete origin.colspan;
      delete origin.rowspan;

      this.clearMergedIntoRefsForDissolve(originRow, originRow + oRowspan, originCol, originCol + oColspan, originRow, originCol, rowIndex);
    } else {
      if (newRowspan > 1) {
        origin.rowspan = newRowspan;
      } else {
        delete origin.rowspan;
      }
    }
  }

  private clearMergedIntoRefs(
    startRow: number, endRow: number, startCol: number, endCol: number,
    oldOriginRow: number, oldOriginCol: number,
    skipRow: number, skipCol: number,
    newRef: [number, number] | undefined
  ): void {
    this.contentGrid.slice(startRow, endRow).forEach((_gridRow, ri) => {
      const dr = startRow + ri;

      this.contentGrid[dr].slice(startCol, endCol).forEach((_spanned, ci) => {
        const dc = startCol + ci;

        if (dr === skipRow && dc === skipCol) {
          return;
        }

        const spanned = this.contentGrid[dr]?.[dc];

        if (spanned?.mergedInto?.[0] === oldOriginRow && spanned?.mergedInto?.[1] === oldOriginCol) {
          if (newRef === undefined) {
            delete spanned.mergedInto;
          } else {
            spanned.mergedInto = newRef;
          }
        }
      });
    });
  }

  private clearMergedIntoRefsForDissolve(
    startRow: number, endRow: number, startCol: number, endCol: number,
    skipOriginRow: number, skipOriginCol: number, deletedRow: number
  ): void {
    this.contentGrid.slice(startRow, endRow).forEach((_gridRow, ri) => {
      const dr = startRow + ri;

      if (dr === deletedRow) {
        return;
      }

      this.contentGrid[dr].slice(startCol, endCol).forEach((_spanned, ci) => {
        const dc = startCol + ci;

        if (dr === skipOriginRow && dc === skipOriginCol) {
          return;
        }

        const spanned = this.contentGrid[dr]?.[dc];

        if (spanned?.mergedInto) {
          delete spanned.mergedInto;
        }
      });
    });
  }

  /**
   * Before deleting a column, handle merge origins and covered cells in that column.
   * Symmetric to contractSpansForDeletedRow.
   */
  private contractSpansForDeletedCol(colIndex: number): void {
    this.contentGrid.forEach((_row, r) => {
      const gridCell = this.contentGrid[r][colIndex];

      if ((gridCell.colspan ?? 1) > 1 || (gridCell.rowspan ?? 1) > 1) {
        this.handleOriginInDeletedCol(colIndex, r);
      } else if (gridCell.mergedInto !== undefined) {
        this.handleCoveredInDeletedCol(colIndex, r);
      }
    });
  }

  private handleOriginInDeletedCol(colIndex: number, r: number): void {
    const cell = this.contentGrid[r][colIndex];
    const rowspan = cell.rowspan ?? 1;
    const colspan = cell.colspan ?? 1;

    if (colspan <= 1) {
      return;
    }

    const newColspan = colspan - 1;
    const nextCol = colIndex + 1;

    if (nextCol < (this.contentGrid[r]?.length ?? 0)) {
      this.transferOriginToNextCol(colIndex, r, nextCol, rowspan, colspan, newColspan);
    }

    delete cell.colspan;
    delete cell.rowspan;
  }

  private transferOriginToNextCol(
    colIndex: number, r: number, nextCol: number,
    rowspan: number, colspan: number, newColspan: number
  ): void {
    const cell = this.contentGrid[r][colIndex];
    const newOrigin = this.contentGrid[r][nextCol];

    newOrigin.blocks = [...cell.blocks];
    cell.blocks = [];
    delete newOrigin.mergedInto;

    if (newColspan === 1 && rowspan === 1) {
      delete newOrigin.colspan;
      delete newOrigin.rowspan;
      this.clearMergedIntoRefs(r, r + rowspan, nextCol, colIndex + colspan, r, colIndex, r, nextCol, undefined);

      return;
    }

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
    this.clearMergedIntoRefs(r, r + rowspan, nextCol, colIndex + colspan, r, colIndex, r, nextCol, [r, nextCol]);
  }

  private handleCoveredInDeletedCol(colIndex: number, r: number): void {
    const cell = this.contentGrid[r][colIndex];
    const [originRow, originCol] = cell.mergedInto as [number, number];

    if (originCol === colIndex) {
      return;
    }

    const origin = this.contentGrid[originRow]?.[originCol];

    if (!origin) {
      return;
    }

    const oColspan = origin.colspan ?? 1;
    const oRowspan = origin.rowspan ?? 1;
    const newColspan = oColspan - 1;

    if (newColspan === 1 && oRowspan === 1) {
      delete origin.colspan;
      delete origin.rowspan;

      this.clearMergedIntoRefsForDissolveCol(originRow, originRow + oRowspan, originCol, originCol + oColspan, originRow, originCol, colIndex);
    } else {
      if (newColspan > 1) {
        origin.colspan = newColspan;
      } else {
        delete origin.colspan;
      }
    }
  }

  private clearMergedIntoRefsForDissolveCol(
    startRow: number, endRow: number, startCol: number, endCol: number,
    skipOriginRow: number, skipOriginCol: number, deletedCol: number
  ): void {
    this.contentGrid.slice(startRow, endRow).forEach((_gridRow, ri) => {
      const dr = startRow + ri;

      this.contentGrid[dr].slice(startCol, endCol).forEach((_spanned, ci) => {
        const dc = startCol + ci;

        if (dr === skipOriginRow && dc === skipOriginCol) {
          return;
        }

        if (dc === deletedCol) {
          return;
        }

        const spanned = this.contentGrid[dr]?.[dc];

        if (spanned?.mergedInto) {
          delete spanned.mergedInto;
        }
      });
    });
  }

  /**
   * Check if any cell in a row is involved in a merge that extends beyond the row.
   */
  private isRowInvolvedInMerge(rowIndex: number): boolean {
    const row = this.contentGrid[rowIndex];

    return row.some(cell => {
      // Origin with rowspan > 1 means it extends to other rows
      if ((cell.rowspan ?? 1) > 1) {
        return true;
      }

      // Covered by a merge from a different row
      return cell.mergedInto !== undefined && cell.mergedInto[0] !== rowIndex;
    });
  }

  /**
   * Check if any cell in a column is involved in a merge that extends beyond the column.
   */
  private isColInvolvedInMerge(colIndex: number): boolean {
    return this.contentGrid.some(row => {
      const cell = row[colIndex];

      // Origin with colspan > 1 means it extends to other columns
      if ((cell.colspan ?? 1) > 1) {
        return true;
      }

      // Covered by a merge from a different column
      return cell.mergedInto !== undefined && cell.mergedInto[1] !== colIndex;
    });
  }

  /**
   * After a row move (splice from, splice to), rebuild mergedInto row coordinates
   * by computing the index remapping.
   */
  private rebuildMergedIntoRowCoordinates(from: number, to: number): void {
    const rowCount = this.contentGrid.length;
    const mapping = this.buildMoveMapping(rowCount, from, to);

    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];

        if (gridCell.mergedInto !== undefined) {
          const oldOriginRow = gridCell.mergedInto[0];

          gridCell.mergedInto = [mapping[oldOriginRow], gridCell.mergedInto[1]];
        }
      });
    });
  }

  /**
   * After a column move (splice from, splice to), rebuild mergedInto col coordinates
   * by computing the index remapping.
   */
  private rebuildMergedIntoColCoordinates(from: number, to: number): void {
    const colCount = this.cols;
    const mapping = this.buildMoveMapping(colCount, from, to);

    this.contentGrid.forEach((_row, r) => {
      this.contentGrid[r].forEach((_cell, c) => {
        const gridCell = this.contentGrid[r][c];

        if (gridCell.mergedInto !== undefined) {
          const oldOriginCol = gridCell.mergedInto[1];

          gridCell.mergedInto = [gridCell.mergedInto[0], mapping[oldOriginCol]];
        }
      });
    });
  }

  private buildMoveMapping(count: number, from: number, to: number): number[] {
    return Array.from({ length: count }, (_, oldIdx) => {
      if (oldIdx === from) {
        return to;
      }

      const afterRemove = oldIdx > from ? oldIdx - 1 : oldIdx;

      return afterRemove >= to ? afterRemove + 1 : afterRemove;
    });
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
