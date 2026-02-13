import { twMerge } from '../../components/utils/tw';

import { CELL_BLOCKS_ATTR } from './table-cell-blocks';
import type { CellContent, LegacyCellContent } from './types';

export const ROW_ATTR = 'data-blok-table-row';
export const CELL_ATTR = 'data-blok-table-cell';

export const BORDER_WIDTH = 1;
const BORDER_STYLE = `${BORDER_WIDTH}px solid #d1d5db`;

const ROW_CLASSES = [
  'flex',
];

const CELL_CLASSES = [
  'py-1',
  'px-2',
  'min-h-[2em]',
  'outline-none',
  'leading-normal',
  'text-sm',
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
 * Creates rows, columns, cells and extracts data from the grid.
 */
export class TableGrid {
  private readOnly: boolean;

  constructor(options: TableGridOptions) {
    this.readOnly = options.readOnly;
  }

  /**
   * Create a grid element with specified rows and columns
   */
  public createGrid(rows: number, cols: number, colWidths?: number[]): HTMLDivElement {
    const table = document.createElement('div');

    table.style.borderTop = BORDER_STYLE;
    table.style.borderLeft = BORDER_STYLE;

    const widths = colWidths ?? equalWidths(cols);

    Array.from({ length: rows }).forEach(() => {
      table.appendChild(this.createRow(cols, widths));
    });

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
   * Extract 2D array from grid DOM
   */
  public getData(table: HTMLElement): CellContent[][] {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);
    const result: CellContent[][] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const rowData: CellContent[] = [];

      cells.forEach(cell => {
        rowData.push(this.getCellContent(cell as HTMLElement));
      });

      result.push(rowData);
    });

    return result;
  }

  /**
   * Add a row. If index is provided, inserts before that row.
   * Otherwise appends at the end.
   */
  public addRow(table: HTMLElement, index?: number): HTMLElement {
    const cols = this.getColumnCount(table);
    const rawWidths = this.getRawCellWidths(table);
    const row = this.createRow(cols, rawWidths);
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    if (index !== undefined && index < rows.length) {
      table.insertBefore(row, rows[index]);
    } else {
      table.appendChild(row);
    }

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
  }

  /**
   * Add a column. If index is provided, inserts before that column.
   * Otherwise appends at the end.
   *
   * When colWidths (pixel widths) are provided, existing columns are set to
   * those widths and the new column is added in px mode. This prevents
   * existing columns from shrinking when the table is in percent mode.
   */
  public addColumn(table: HTMLElement, index?: number, colWidths?: number[], newColWidth?: number): boolean {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);
    const oldColCount = this.getColumnCount(table);
    const hasValidColWidths = colWidths !== undefined && colWidths.length === oldColCount;
    const usePx = hasValidColWidths || this.detectWidthUnit(table) === 'px';

    if (hasValidColWidths) {
      this.convertToPixelWidths(rows, colWidths);
    }

    if (usePx) {
      this.addColumnPx(rows, oldColCount, index, newColWidth);

      return true;
    }

    this.addColumnPercent(rows, oldColCount, index);

    return true;
  }

  /**
   * Convert all cells in each row to the given pixel widths
   */
  private convertToPixelWidths(rows: NodeListOf<Element>, colWidths: number[]): void {
    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      cells.forEach((node, i) => {
        if (i < colWidths.length) {
          const el = node as HTMLElement;

          el.style.width = `${colWidths[i]}px`;
        }
      });
    });
  }

  /**
   * Add column in px mode: keep existing widths, add new column at half the average width
   */
  private addColumnPx(rows: NodeListOf<Element>, oldColCount: number, index?: number, newColWidth?: number): void {
    let computedWidth: number;

    if (newColWidth !== undefined) {
      computedWidth = newColWidth;
    } else {
      const firstRow = rows[0];
      const firstRowCells = firstRow?.querySelectorAll(`[${CELL_ATTR}]`);
      const totalWidth = Array.from(firstRowCells ?? []).reduce(
        (sum, node) => sum + (parseFloat((node as HTMLElement).style.width) || 0),
        0
      );

      computedWidth = oldColCount > 0
        ? Math.round((totalWidth / oldColCount / 2) * 100) / 100
        : 0;
    }

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const isAppend = index === undefined || index >= cells.length;
      const cell = this.createCell(`${computedWidth}px`);

      if (!isAppend) {
        row.insertBefore(cell, cells[index]);

        return;
      }

      row.appendChild(cell);
    });
  }

  /**
   * Add column in % mode: shrink existing columns slightly and add new column at half the average width
   */
  private addColumnPercent(rows: NodeListOf<Element>, oldColCount: number, index?: number): void {
    const halfColFraction = 0.5 / oldColCount;
    const scaleFactor = 1 - halfColFraction;

    rows.forEach(row => {
      const existingCells = row.querySelectorAll(`[${CELL_ATTR}]`);

      existingCells.forEach(cell => {
        const el = cell as HTMLElement;
        const oldWidth = parseFloat(el.style.width) || (100 / oldColCount);
        const newWidth = Math.round(oldWidth * scaleFactor * 100) / 100;

        el.style.width = `${newWidth}%`;
      });

      const newColWidth = Math.round((100 / oldColCount / 2) * 100) / 100;
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const isAppend = index === undefined || index >= cells.length;
      const cell = this.createCell(`${newColWidth}%`);

      if (!isAppend) {
        row.insertBefore(cell, cells[index]);

        return;
      }

      row.appendChild(cell);
    });
  }

  /**
   * Delete a column at index
   */
  public deleteColumn(table: HTMLElement, index: number): void {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (index >= cells.length) {
        return;
      }

      cells[index].remove();
    });
  }

  /**
   * Move a row from one index to another.
   * The row at fromIndex is removed and inserted at toIndex.
   */
  public moveRow(table: HTMLElement, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return;
    }

    const rows = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));

    if (fromIndex >= rows.length || toIndex >= rows.length) {
      return;
    }

    const row = rows[fromIndex];

    row.remove();

    const updatedRows = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));

    if (toIndex >= updatedRows.length) {
      table.appendChild(row);
    } else {
      table.insertBefore(row, updatedRows[toIndex]);
    }
  }

  /**
   * Move a column from one index to another.
   * Reorders cells across all rows.
   */
  public moveColumn(table: HTMLElement, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return;
    }

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
  }

  /**
   * Get number of rows
   */
  public getRowCount(table: HTMLElement): number {
    return table.querySelectorAll(`[${ROW_ATTR}]`).length;
  }

  /**
   * Get number of columns (from first row)
   */
  public getColumnCount(table: HTMLElement): number {
    const firstRow = table.querySelector(`[${ROW_ATTR}]`);

    if (!firstRow) {
      return 0;
    }

    return firstRow.querySelectorAll(`[${CELL_ATTR}]`).length;
  }

  /**
   * Get a specific cell element
   */
  public getCell(table: HTMLElement, row: number, col: number): HTMLElement | null {
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
   * Read column widths from the DOM
   */
  public getColWidths(table: HTMLElement): number[] {
    const firstRow = table.querySelector(`[${ROW_ATTR}]`);

    if (!firstRow) {
      return [];
    }

    const cells = firstRow.querySelectorAll(`[${CELL_ATTR}]`);
    const widths: number[] = [];

    cells.forEach(cell => {
      const w = parseFloat((cell as HTMLElement).style.width);

      widths.push(isNaN(w) ? 0 : w);
    });

    return widths;
  }

  /**
   * Get cell content as block references
   */
  private getCellContent(cell: HTMLElement): CellContent {
    const blocksContainer = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

    if (!blocksContainer) {
      return { blocks: [] };
    }

    const blockElements = blocksContainer.querySelectorAll('[data-blok-id]');
    const blockIds = Array.from(blockElements)
      .map(el => el.getAttribute('data-blok-id') ?? '')
      .filter(id => id !== '');

    return { blocks: blockIds };
  }

  /**
   * Detect whether cells use 'px' or '%' widths
   */
  private detectWidthUnit(table: HTMLElement): string {
    const firstRow = table.querySelector(`[${ROW_ATTR}]`);

    if (!firstRow) {
      return '%';
    }

    const firstCell: HTMLElement | null = firstRow.querySelector(`[${CELL_ATTR}]`);

    if (!firstCell) {
      return '%';
    }

    return firstCell.style.width.endsWith('px') ? 'px' : '%';
  }

  /**
   * Read raw CSS width strings (e.g. "200px", "33.33%") from first row cells
   */
  private getRawCellWidths(table: HTMLElement): string[] {
    const firstRow = table.querySelector(`[${ROW_ATTR}]`);

    if (!firstRow) {
      return [];
    }

    const cells = firstRow.querySelectorAll(`[${CELL_ATTR}]`);

    return Array.from(cells).map(cell => (cell as HTMLElement).style.width);
  }

  /**
   * Create a single row with N cells
   */
  private createRow(cols: number, colWidths: (number | string)[]): HTMLElement {
    const row = document.createElement('div');

    row.className = twMerge(ROW_CLASSES);
    row.setAttribute(ROW_ATTR, '');

    Array.from({ length: cols }).forEach((_, i) => {
      row.appendChild(this.createCell(colWidths[i]));
    });

    return row;
  }

  /**
   * Create a single cell
   */
  private createCell(width?: number | string): HTMLElement {
    const cell = document.createElement('div');

    cell.className = twMerge(CELL_CLASSES);
    cell.style.borderRight = BORDER_STYLE;
    cell.style.borderBottom = BORDER_STYLE;
    cell.style.flexShrink = '0';
    cell.style.overflow = 'hidden';
    cell.style.overflowWrap = 'break-word';

    if (width !== undefined) {
      cell.style.width = typeof width === 'string' ? width : `${width}%`;
    }

    cell.setAttribute(CELL_ATTR, '');

    const blocksContainer = document.createElement('div');

    blocksContainer.setAttribute(CELL_BLOCKS_ATTR, '');
    cell.appendChild(blocksContainer);

    return cell;
  }
}
