import type { TableModel, SelectionRect } from './table-model';

export interface CellMapEntry {
  originRow: number;
  originCol: number;
  colspan: number;
  rowspan: number;
}

type GridRow = (CellMapEntry | null)[];

/**
 * Fill all grid positions covered by an origin cell's span with the same entry.
 */
const fillSpan = (
  grid: GridRow[],
  entry: CellMapEntry,
  maxRow: number,
  maxCol: number
): void => {
  const endRow = Math.min(entry.originRow + entry.rowspan, maxRow);
  const endCol = Math.min(entry.originCol + entry.colspan, maxCol);

  grid.slice(entry.originRow, endRow).forEach(row => {
    const fill: (CellMapEntry | null)[] = Array.from({ length: endCol - entry.originCol }, () => entry);

    row.splice(entry.originCol, fill.length, ...fill);
  });
};

/**
 * Maps logical grid positions to physical cell information.
 *
 * With colspan/rowspan, physical `<td>` count != logical column count.
 * TableMap bridges that gap for both model-side and DOM-side lookups.
 */
export class TableMap {
  readonly width: number;
  readonly height: number;
  private readonly grid: GridRow[];

  private constructor(width: number, height: number, grid: GridRow[]) {
    this.width = width;
    this.height = height;
    this.grid = grid;
  }

  static fromModel(model: TableModel): TableMap {
    const height = model.rows;
    const width = model.cols;

    if (height === 0 || width === 0) {
      return new TableMap(0, 0, []);
    }

    const grid: GridRow[] = Array.from({ length: height }, () =>
      Array.from<CellMapEntry | null>({ length: width }).fill(null)
    );

    grid.forEach((row, r) => {
      row.forEach((_cell, c) => {
        const span = model.getCellSpan(r, c);

        if (span.colspan > 1 || span.rowspan > 1) {
          fillSpan(grid, { originRow: r, originCol: c, colspan: span.colspan, rowspan: span.rowspan }, height, width);
        } else if (!model.isSpannedCell(r, c)) {
          grid[r][c] = { originRow: r, originCol: c, colspan: 1, rowspan: 1 };
        }
      });
    });

    return new TableMap(width, height, grid);
  }

  static fromTable(table: HTMLTableElement): TableMap {
    const rows = Array.from(table.querySelectorAll('tr'));
    const height = rows.length;

    if (height === 0) {
      return new TableMap(0, 0, []);
    }

    const grid: GridRow[] = Array.from({ length: height }, () => [] as GridRow);
    const occupied: boolean[][] = Array.from({ length: height }, () => []);

    const processCell = (
      rowIndex: number,
      td: HTMLTableCellElement,
      startCol: number
    ): number => {
      const colspan = td.colSpan || 1;
      const rowspan = td.rowSpan || 1;
      const entry: CellMapEntry = {
        originRow: rowIndex,
        originCol: startCol,
        colspan,
        rowspan,
      };

      Array.from({ length: Math.min(rowspan, height - rowIndex) }).forEach((_, dr) => {
        Array.from({ length: colspan }).forEach((__, dc) => {
          const targetRow = rowIndex + dr;
          const targetCol = startCol + dc;

          grid[targetRow][targetCol] = entry;
          occupied[targetRow][targetCol] = true;
        });
      });

      return startCol + colspan;
    };

    const rowWidths = rows.map((tr, r) => {
      const tds = Array.from(tr.querySelectorAll<HTMLTableCellElement>(':scope > td, :scope > th'));
      const finalCol = tds.reduce((col, td) => {
        const nextFreeCol = TableMap.findNextFreeCol(occupied[r], col);

        return processCell(r, td, nextFreeCol);
      }, 0);

      return finalCol;
    });

    const width = Math.max(0, ...rowWidths);

    // Pad rows to full width
    grid.forEach(row => {
      while (row.length < width) {
        row.push(null);
      }
    });

    return new TableMap(width, height, grid);
  }

  private static findNextFreeCol(occupied: boolean[], startCol: number): number {
    const col = startCol;

    if (!occupied[col]) {
      return col;
    }

    return TableMap.findNextFreeCol(occupied, col + 1);
  }

  getEntry(row: number, col: number): CellMapEntry | null {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return null;
    }

    return this.grid[row][col];
  }

  getOriginPosition(row: number, col: number): { row: number; col: number } | null {
    const entry = this.getEntry(row, col);

    if (!entry) {
      return null;
    }

    return { row: entry.originRow, col: entry.originCol };
  }

  getCellElement(table: HTMLElement, row: number, col: number): HTMLElement | null {
    const entry = this.getEntry(row, col);

    if (!entry) {
      return null;
    }

    return table.querySelector<HTMLElement>(
      `td[data-row="${entry.originRow}"][data-col="${entry.originCol}"]`
    );
  }

  getCellPosition(table: HTMLElement, cell: HTMLElement): { row: number; col: number } | null {
    if (!table.contains(cell)) {
      return null;
    }

    const rowAttr = cell.getAttribute('data-row');
    const colAttr = cell.getAttribute('data-col');

    if (rowAttr === null || colAttr === null) {
      return null;
    }

    return { row: parseInt(rowAttr, 10), col: parseInt(colAttr, 10) };
  }

  collectCellsInRange(
    table: HTMLElement,
    minRow: number,
    maxRow: number,
    minCol: number,
    maxCol: number
  ): HTMLElement[] {
    const seen = new Set<string>();
    const result: HTMLElement[] = [];

    this.forEachInRange(minRow, maxRow, minCol, maxCol, (entry) => {
      const key = `${entry.originRow},${entry.originCol}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      const el = this.getCellElement(table, entry.originRow, entry.originCol);

      if (el) {
        result.push(el);
      }
    });

    return result;
  }

  expandRangeForMerges(
    inputMinRow: number,
    inputMaxRow: number,
    inputMinCol: number,
    inputMaxCol: number
  ): SelectionRect {
    const rect: SelectionRect = {
      minRow: inputMinRow,
      maxRow: inputMaxRow,
      minCol: inputMinCol,
      maxCol: inputMaxCol,
    };

    const expand = (): boolean => {
      const snapshot = { ...rect };

      this.forEachInRange(rect.minRow, rect.maxRow, rect.minCol, rect.maxCol, (entry) => {
        const spanMaxRow = entry.originRow + entry.rowspan - 1;
        const spanMaxCol = entry.originCol + entry.colspan - 1;

        rect.minRow = Math.min(rect.minRow, entry.originRow);
        rect.minCol = Math.min(rect.minCol, entry.originCol);
        rect.maxRow = Math.max(rect.maxRow, spanMaxRow);
        rect.maxCol = Math.max(rect.maxCol, spanMaxCol);
      });

      return (
        rect.minRow !== snapshot.minRow ||
        rect.maxRow !== snapshot.maxRow ||
        rect.minCol !== snapshot.minCol ||
        rect.maxCol !== snapshot.maxCol
      );
    };

    while (expand()) {
      // keep expanding until stable
    }

    return rect;
  }

  /**
   * Iterate over all non-null entries in a rectangular range.
   */
  private forEachInRange(
    minRow: number,
    maxRow: number,
    minCol: number,
    maxCol: number,
    callback: (entry: CellMapEntry) => void
  ): void {
    this.grid.slice(minRow, maxRow + 1).forEach(row => {
      row.slice(minCol, maxCol + 1).forEach(entry => {
        if (entry) {
          callback(entry);
        }
      });
    });
  }
}
