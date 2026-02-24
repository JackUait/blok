import type { CellContent, LegacyCellContent, TableData } from './types';
import { isCellWithBlocks } from './types';

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
        row.map(c => ({ blocks: [...c.blocks] }))
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

    const blocksToDelete = this.collectBlocksInRow(index);

    this.contentGrid.splice(index, 1);

    for (const id of blocksToDelete) {
      this.blockCellMap.delete(id);
    }

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

    const [moved] = this.contentGrid.splice(from, 1);

    this.contentGrid.splice(to, 0, moved);
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

    for (const row of this.contentGrid) {
      const [moved] = row.splice(from, 1);

      row.splice(to, 0, moved);
    }

    if (this.colWidthsValue !== undefined) {
      const [movedWidth] = this.colWidthsValue.splice(from, 1);

      this.colWidthsValue.splice(to, 0, movedWidth);
    }

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

      for (let r = 0; r < this.contentGrid.length; r++) {
        if (this.contentGrid[r].length !== expectedCols) {
          throw new Error(
            `Invariant violation: row ${r} has ${this.contentGrid[r].length} columns, expected ${expectedCols}`
          );
        }
      }
    }

    // Invariant 2: colWidths sync
    if (this.colWidthsValue !== undefined && this.contentGrid.length > 0) {
      if (this.colWidthsValue.length !== this.contentGrid[0].length) {
        throw new Error(
          `Invariant violation: colWidths has ${this.colWidthsValue.length} entries but grid has ${this.contentGrid[0].length} columns`
        );
      }
    }

    // Invariant 3 + 4: blockCellMap consistency and no duplicates
    const seenBlocks = new Set<string>();
    let gridBlockCount = 0;

    for (let r = 0; r < this.contentGrid.length; r++) {
      for (let c = 0; c < this.contentGrid[r].length; c++) {
        for (const blockId of this.contentGrid[r][c].blocks) {
          gridBlockCount++;

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
      }
    }

    // Check map doesn't have extra entries
    if (this.blockCellMap.size !== gridBlockCount) {
      throw new Error(
        `Invariant violation: blockCellMap has ${this.blockCellMap.size} entries but grid has ${gridBlockCount} blocks`
      );
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
      return { blocks: [...cell.blocks] };
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
