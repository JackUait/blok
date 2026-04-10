import { twMerge } from '../../components/utils/tw';
import { DATA_ATTR } from '../../components/constants/data-attributes';

import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import type { TableModel } from './table-model';
import type { LegacyCellContent } from './types';

export const ROW_ATTR = 'data-blok-table-row';
export const CELL_ATTR = 'data-blok-table-cell';
export const CELL_ROW_ATTR = 'data-blok-table-cell-row';
export const CELL_COL_ATTR = 'data-blok-table-cell-col';

export const BORDER_WIDTH = 1;
const BORDER_STYLE = `${BORDER_WIDTH}px solid var(--blok-table-border)`;

const CELL_CLASSES = [
  'py-1',
  'px-2',
  'min-h-[2em]',
  'outline-hidden',
  'leading-none',
  'text-sm',
  'cursor-text',
];

/**
 * Generate equal column widths that sum to 100
 */
export const equalWidths = (cols: number): number[] => {
  const width = Math.round((100 / cols) * 100) / 100;

  return Array.from({ length: cols }, () => width);
};

interface TableGridOptions {
  readOnly: boolean;
}

/**
 * Manages the table grid DOM structure.
 * Creates, deletes, moves, and queries rows, columns, and cells.
 *
 * Uses native HTML `<table>` elements with `<colgroup>/<col>` for widths,
 * `<tbody>/<tr>/<td>` for rows/cells. This enables native colspan/rowspan
 * rendering and accessible table navigation.
 */
export class TableGrid {
  private readOnly: boolean;

  constructor(options: TableGridOptions) {
    this.readOnly = options.readOnly;
  }

  /**
   * Create a grid element with specified rows and columns.
   * Returns an HTML <table> with <colgroup> for widths and <tbody> for rows.
   */
  public createGrid(rows: number, cols: number, colWidths?: number[]): HTMLTableElement {
    const table = document.createElement('table');

    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    table.style.borderCollapse = 'separate';
    table.style.borderSpacing = '0px';
    table.style.borderTop = BORDER_STYLE;
    table.style.borderLeft = BORDER_STYLE;

    const widths = colWidths ?? equalWidths(cols);

    // <colgroup> holds column widths
    const colgroup = document.createElement('colgroup');

    widths.forEach(w => {
      colgroup.appendChild(this.createCol(w));
    });
    table.appendChild(colgroup);

    // <tbody> holds rows
    const tbody = document.createElement('tbody');

    Array.from({ length: rows }).forEach((_, rowIndex) => {
      tbody.appendChild(this.createRow(cols, rowIndex));
    });
    table.appendChild(tbody);

    return table;
  }

  /**
   * No-op. Cell content is populated by TableCellBlocks.initializeCells().
   * Kept for API compatibility with render() callers.
   */
  public fillGrid(_table: HTMLElement, _content: LegacyCellContent[][]): void {
    // Content is populated by TableCellBlocks.initializeCells()
  }

  /**
   * Create a grid from a TableModel, rendering colspan/rowspan for merged cells.
   * Covered (spanned) cells are omitted from the DOM; the origin cell gets
   * the appropriate colSpan/rowSpan attributes.
   */
  public createGridFromModel(model: TableModel): HTMLTableElement {
    const table = document.createElement('table');

    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    table.style.borderCollapse = 'separate';
    table.style.borderSpacing = '0px';
    table.style.borderTop = BORDER_STYLE;
    table.style.borderLeft = BORDER_STYLE;

    // <colgroup>
    const colgroup = document.createElement('colgroup');
    const widths = model.colWidths ?? equalWidths(model.cols);

    widths.forEach(w => colgroup.appendChild(this.createCol(w)));
    table.appendChild(colgroup);

    // <tbody>
    const tbody = document.createElement('tbody');

    Array.from({ length: model.rows }).forEach((_, r) => {
      const row = document.createElement('tr');

      row.setAttribute(ROW_ATTR, '');

      Array.from({ length: model.cols }).forEach((__, c) => {
        if (model.isSpannedCell(r, c)) {
          return;
        }

        const cell = this.createCell(r, c) as HTMLTableCellElement;
        const span = model.getCellSpan(r, c);

        if (span.colspan > 1) {
          cell.colSpan = span.colspan;
        }
        if (span.rowspan > 1) {
          cell.rowSpan = span.rowspan;
        }

        row.appendChild(cell);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);

    return table;
  }

  /**
   * Add a row. If index is provided, inserts before that row.
   * Otherwise appends at the end.
   */
  public addRow(table: HTMLElement, index?: number): HTMLElement {
    const cols = this.getColumnCount(table);
    const row = this.createRow(cols);
    const tbody = table.querySelector('tbody') ?? table;
    const rows = tbody.querySelectorAll(`[${ROW_ATTR}]`);

    if (index !== undefined && index < rows.length) {
      tbody.insertBefore(row, rows[index]);
    } else {
      tbody.appendChild(row);
    }

    this.reindexCoordinates(table);

    return row;
  }

  /**
   * Delete a row at index
   */
  public deleteRow(table: HTMLElement, index: number): void {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    if (index < rows.length) {
      rows[index].remove();
    }

    this.reindexCoordinates(table);
  }

  /**
   * Add a column. If index is provided, inserts before that column.
   * Otherwise appends at the end.
   *
   * When colWidths (pixel widths) are provided, existing <col> elements are set to
   * those widths and the new column is added in px mode.
   */
  public addColumn(table: HTMLElement, index?: number, colWidths?: number[], newColWidth?: number): boolean {
    const colgroup = table.querySelector('colgroup');
    const cols = colgroup ? Array.from(colgroup.querySelectorAll('col')) : [];
    const oldColCount = cols.length;
    const hasValidColWidths = colWidths !== undefined && colWidths.length === oldColCount;
    const usePx = hasValidColWidths || this.detectWidthUnit(table) === 'px';

    if (hasValidColWidths && colgroup) {
      this.applyWidthsToCols(colgroup, colWidths);
    }

    if (usePx) {
      this.addColumnPx(table, oldColCount, index, newColWidth);
    } else {
      this.addColumnPercent(table, oldColCount, index);
    }

    this.reindexCoordinates(table);

    return true;
  }

  /**
   * Apply pixel widths to existing <col> elements
   */
  private applyWidthsToCols(colgroup: Element, colWidths: number[]): void {
    const cols = Array.from(colgroup.querySelectorAll('col')) as HTMLElement[];

    colWidths.forEach((w, i) => {
      if (i < cols.length) {
        cols[i].style.width = `${w}px`;
      }
    });
  }

  /**
   * Add column in px mode: keep existing widths, add new column at given width or half the average
   */
  private addColumnPx(table: HTMLElement, oldColCount: number, index?: number, newColWidth?: number): void {
    const computedWidth = newColWidth ?? this.computeHalfAvgWidth(table, oldColCount);
    const widthStr = `${computedWidth}px`;

    this.insertColumn(table, index, widthStr);
  }

  private computeHalfAvgWidth(table: HTMLElement, oldColCount: number): number {
    const colgroup = table.querySelector('colgroup');
    const cols = colgroup ? Array.from(colgroup.querySelectorAll('col')) : [];
    const totalWidth = cols.reduce(
      (sum, col) => sum + (parseFloat((col as HTMLElement).style.width) || 0),
      0
    );

    return oldColCount > 0
      ? Math.round((totalWidth / oldColCount / 2) * 100) / 100
      : 0;
  }

  /**
   * Add column in % mode: shrink existing columns slightly and add new column at half the average width
   */
  private addColumnPercent(table: HTMLElement, oldColCount: number, index?: number): void {
    const halfColFraction = 0.5 / oldColCount;
    const scaleFactor = 1 - halfColFraction;

    // Shrink existing <col> widths
    const colgroup = table.querySelector('colgroup');
    const existingCols = colgroup ? Array.from(colgroup.querySelectorAll('col')) : [];

    existingCols.forEach(col => {
      const el = col as HTMLElement;
      const oldWidth = parseFloat(el.style.width) || (100 / oldColCount);
      const newWidth = Math.round(oldWidth * scaleFactor * 100) / 100;

      el.style.width = `${newWidth}%`;
    });

    const newColWidth = Math.round((100 / oldColCount / 2) * 100) / 100;

    this.insertColumn(table, index, `${newColWidth}%`);
  }

  /**
   * Insert a <col> and a <td> per row at the given index
   */
  private insertColumn(table: HTMLElement, index: number | undefined, widthStr: string): void {
    // Insert <col>
    const colgroup = table.querySelector('colgroup');

    if (colgroup) {
      const col = document.createElement('col');

      col.style.width = widthStr;

      const existingCols = colgroup.querySelectorAll('col');
      const isAppend = index === undefined || index >= existingCols.length;

      if (!isAppend) {
        colgroup.insertBefore(col, existingCols[index]);
      } else {
        colgroup.appendChild(col);
      }
    }

    // Insert <td> in each row
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const isAppend = index === undefined || index >= cells.length;
      const cell = this.createCell();

      if (!isAppend) {
        row.insertBefore(cell, cells[index]);
      } else {
        row.appendChild(cell);
      }
    });
  }

  /**
   * Delete a column at index
   */
  public deleteColumn(table: HTMLElement, index: number): void {
    // Remove <col>
    const colgroup = table.querySelector('colgroup');

    if (colgroup) {
      const cols = colgroup.querySelectorAll('col');

      if (index < cols.length) {
        cols[index].remove();
      }
    }

    // Remove <td> per row
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (index >= cells.length) {
        return;
      }

      cells[index].remove();
    });

    this.reindexCoordinates(table);
  }

  /**
   * Move a row from one index to another.
   * The row at fromIndex is removed and inserted at toIndex.
   */
  public moveRow(table: HTMLElement, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return;
    }

    const tbody = table.querySelector('tbody') ?? table;
    const rows = Array.from(tbody.querySelectorAll(`[${ROW_ATTR}]`));

    if (fromIndex >= rows.length || toIndex >= rows.length) {
      return;
    }

    const row = rows[fromIndex];

    row.remove();

    const updatedRows = Array.from(tbody.querySelectorAll(`[${ROW_ATTR}]`));

    if (toIndex >= updatedRows.length) {
      tbody.appendChild(row);
    } else {
      tbody.insertBefore(row, updatedRows[toIndex]);
    }

    this.reindexCoordinates(table);
  }

  /**
   * Move a column from one index to another.
   * Reorders <col> elements and cells across all rows.
   */
  public moveColumn(table: HTMLElement, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return;
    }

    this.reorderColElement(table, fromIndex, toIndex);

    // Move cells in each row
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));

      if (fromIndex >= cells.length || toIndex >= cells.length) {
        return;
      }

      const cell = cells[fromIndex];

      cell.remove();

      const updatedCells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));

      if (toIndex >= updatedCells.length) {
        row.appendChild(cell);
      } else {
        row.insertBefore(cell, updatedCells[toIndex]);
      }
    });

    this.reindexCoordinates(table);
  }

  /**
   * Reindex coordinate attributes on all cells after structural changes.
   * Sets data-blok-table-cell-row and data-blok-table-cell-col to match
   * each cell's model (logical) position, accounting for colspan and rowspan.
   *
   * Uses sparse table reconstruction: tracks columns blocked by rowspan cells
   * from previous rows so that each DOM cell gets the correct model column index
   * rather than its physical DOM index.
   */
  public reindexCoordinates(table: HTMLElement): void {
    const rows = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));

    // Map from rowIndex -> Set of columnIndices occupied by rowspan cells from earlier rows
    const occupiedCols: Map<number, Set<number>> = new Map();

    rows.forEach((row, r) => {
      const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
      const blockedCols = occupiedCols.get(r) ?? new Set<number>();

      cells.reduce((modelCol, cell) => {
        const tdCell = cell as HTMLTableCellElement;

        // Skip columns that are occupied by rowspan cells from previous rows
        const skipBlocked = (c: number): number => (blockedCols.has(c) ? skipBlocked(c + 1) : c);
        const col = skipBlocked(modelCol);

        cell.setAttribute(CELL_ROW_ATTR, String(r));
        cell.setAttribute(CELL_COL_ATTR, String(col));

        const colSpan = tdCell.colSpan || 1;
        const rowSpan = tdCell.rowSpan || 1;

        // If this cell has rowspan > 1, mark those columns as blocked in subsequent rows
        if (rowSpan > 1) {
          this.blockRowspanCols(occupiedCols, r, col, rowSpan, colSpan);
        }

        // Advance by colspan
        return col + colSpan;
      }, 0);

      occupiedCols.delete(r);
    });
  }

  /**
   * Register blocked columns in occupiedCols for a cell with rowspan > 1.
   * All columns in [startCol, startCol + colSpan) are blocked for rows
   * [startRow + 1, startRow + rowSpan).
   */
  private blockRowspanCols(
    occupiedCols: Map<number, Set<number>>,
    startRow: number,
    startCol: number,
    rowSpan: number,
    colSpan: number
  ): void {
    Array.from({ length: rowSpan - 1 }, (_, i) => i + 1).forEach((dr) => {
      const futureRow = startRow + dr;

      if (!occupiedCols.has(futureRow)) {
        occupiedCols.set(futureRow, new Set());
      }

      const blocked = occupiedCols.get(futureRow) as Set<number>;

      Array.from({ length: colSpan }, (_, dc) => dc).forEach((dc) => {
        blocked.add(startCol + dc);
      });
    });
  }

  /**
   * Get number of rows
   */
  public getRowCount(table: HTMLElement): number {
    return table.querySelectorAll(`[${ROW_ATTR}]`).length;
  }

  /**
   * Get number of columns (from colgroup)
   */
  public getColumnCount(table: HTMLElement): number {
    const colgroup = table.querySelector('colgroup');

    if (colgroup) {
      return colgroup.querySelectorAll('col').length;
    }

    // Fallback: count cells in first row
    const firstRow = table.querySelector(`[${ROW_ATTR}]`);

    if (!firstRow) {
      return 0;
    }

    return firstRow.querySelectorAll(`[${CELL_ATTR}]`).length;
  }

  /**
   * Get a specific cell element.
   * Tries coordinate-based lookup first (works with merged cells),
   * then falls back to index-based lookup for backwards compatibility.
   */
  public getCell(table: HTMLElement, row: number, col: number): HTMLElement | null {
    // Try coordinate-based lookup first (works with merged cells)
    const coordCell = table.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
    );

    if (coordCell) {
      return coordCell;
    }

    // Fallback to index-based lookup (for backwards compatibility)
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    if (row >= rows.length) {
      return null;
    }

    const cells = rows[row].querySelectorAll(`[${CELL_ATTR}]`);

    if (col >= cells.length) {
      return null;
    }

    return cells[col] as HTMLElement;
  }

  /**
   * Read column widths from <col> elements
   */
  public getColWidths(table: HTMLElement): number[] {
    const colgroup = table.querySelector('colgroup');

    if (!colgroup) {
      return [];
    }

    const cols = colgroup.querySelectorAll('col');
    const widths: number[] = [];

    cols.forEach(col => {
      const w = parseFloat((col as HTMLElement).style.width);

      widths.push(isNaN(w) ? 0 : w);
    });

    return widths;
  }

  /**
   * Get the <colgroup> element from the table
   */
  public getColgroup(table: HTMLElement): HTMLElement | null {
    return table.querySelector('colgroup');
  }

  /**
   * Apply widths to <col> elements
   */
  public applyColWidths(table: HTMLElement, widths: number[]): void {
    const colgroup = table.querySelector('colgroup');

    if (!colgroup) {
      return;
    }

    const cols = Array.from(colgroup.querySelectorAll('col')) as HTMLElement[];

    widths.forEach((w, i) => {
      if (i < cols.length) {
        cols[i].style.width = `${w}px`;
      }
    });
  }

  /**
   * Reorder a <col> element within the <colgroup>
   */
  private reorderColElement(table: HTMLElement, fromIndex: number, toIndex: number): void {
    const colgroup = table.querySelector('colgroup');

    if (!colgroup) {
      return;
    }

    const cols = Array.from(colgroup.querySelectorAll('col'));

    if (fromIndex >= cols.length || toIndex >= cols.length) {
      return;
    }

    const col = cols[fromIndex];

    col.remove();

    const updatedCols = Array.from(colgroup.querySelectorAll('col'));

    if (toIndex >= updatedCols.length) {
      colgroup.appendChild(col);
    } else {
      colgroup.insertBefore(col, updatedCols[toIndex]);
    }
  }

  /**
   * Detect whether columns use 'px' or '%' widths
   */
  private detectWidthUnit(table: HTMLElement): string {
    const colgroup = table.querySelector('colgroup');

    if (!colgroup) {
      return '%';
    }

    const firstCol: HTMLElement | null = colgroup.querySelector('col');

    if (!firstCol) {
      return '%';
    }

    return firstCol.style.width.endsWith('px') ? 'px' : '%';
  }

  /**
   * Create a <col> element with a width
   */
  private createCol(width: number | string): HTMLElement {
    const col = document.createElement('col');

    col.style.width = typeof width === 'string' ? width : `${width}%`;

    return col;
  }

  /**
   * Create a single <tr> row with N cells
   */
  private createRow(cols: number, rowIndex?: number): HTMLElement {
    const row = document.createElement('tr');

    row.setAttribute(ROW_ATTR, '');

    Array.from({ length: cols }).forEach((_, colIndex) => {
      row.appendChild(this.createCell(rowIndex, rowIndex !== undefined ? colIndex : undefined));
    });

    return row;
  }

  /**
   * Create a single <td> cell.
   * When rowIndex and colIndex are provided, sets coordinate data attributes.
   */
  private createCell(rowIndex?: number, colIndex?: number): HTMLElement {
    const cell = document.createElement('td');

    cell.className = twMerge(CELL_CLASSES);
    cell.style.borderRight = BORDER_STYLE;
    cell.style.borderBottom = BORDER_STYLE;
    cell.style.overflow = 'hidden';
    cell.style.overflowWrap = 'break-word';
    cell.style.height = '0';

    cell.setAttribute(CELL_ATTR, '');

    if (rowIndex !== undefined && colIndex !== undefined) {
      cell.setAttribute(CELL_ROW_ATTR, String(rowIndex));
      cell.setAttribute(CELL_COL_ATTR, String(colIndex));
    }

    const blocksContainer = document.createElement('div');

    blocksContainer.setAttribute(CELL_BLOCKS_ATTR, '');
    blocksContainer.setAttribute(DATA_ATTR.nestedBlocks, '');
    blocksContainer.style.display = 'flex';
    blocksContainer.style.flexDirection = 'column';
    blocksContainer.style.minHeight = '100%';
    cell.appendChild(blocksContainer);

    return cell;
  }
}
