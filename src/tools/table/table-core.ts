import { twMerge } from '../../components/utils/tw';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';

const TABLE_CLASSES = [
  'w-full',
];

const BORDER_STYLE = '1px solid #d1d5db';

const ROW_CLASSES = [
  'flex',
];

const CELL_CLASSES = [
  'p-2',
  'min-h-[2em]',
  'outline-none',
  'leading-normal',
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
  maxRows?: number;
  maxCols?: number;
}

/**
 * Manages the table grid DOM structure.
 * Creates rows, columns, cells and extracts data from the grid.
 */
export class TableGrid {
  private readOnly: boolean;
  private maxRows?: number;
  private maxCols?: number;

  constructor(options: TableGridOptions) {
    this.readOnly = options.readOnly;
    this.maxRows = options.maxRows;
    this.maxCols = options.maxCols;
  }

  /**
   * Create a grid element with specified rows and columns
   */
  public createGrid(rows: number, cols: number, colWidths?: number[]): HTMLDivElement {
    const table = document.createElement('div');

    table.className = twMerge(TABLE_CLASSES);
    table.style.borderTop = BORDER_STYLE;
    table.style.borderLeft = BORDER_STYLE;

    const widths = colWidths ?? equalWidths(cols);

    Array.from({ length: rows }).forEach(() => {
      table.appendChild(this.createRow(cols, widths));
    });

    return table;
  }

  /**
   * Fill grid cells with content from 2D array
   */
  public fillGrid(table: HTMLElement, content: string[][]): void {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    content.forEach((rowData, rowIndex) => {
      if (rowIndex >= rows.length) {
        return;
      }

      const cells = rows[rowIndex].querySelectorAll(`[${CELL_ATTR}]`);

      rowData.forEach((cellContent, colIndex) => {
        if (colIndex >= cells.length) {
          return;
        }

        const cell = cells[colIndex] as HTMLElement;

        cell.innerHTML = cellContent;
      });
    });
  }

  /**
   * Extract 2D array from grid DOM, excluding empty rows
   */
  public getData(table: HTMLElement): string[][] {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);
    const result: string[][] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const rowData: string[] = [];

      cells.forEach(cell => {
        rowData.push(this.getCellContent(cell as HTMLElement));
      });

      const isEmpty = rowData.every(cell => cell.trim() === '');

      if (!isEmpty) {
        result.push(rowData);
      }
    });

    return result;
  }

  /**
   * Add a row. If index is provided, inserts before that row.
   * Otherwise appends at the end.
   * Returns null if maxRows limit would be exceeded.
   */
  public addRow(table: HTMLElement, index?: number): HTMLElement | null {
    if (this.maxRows !== undefined && this.getRowCount(table) >= this.maxRows) {
      return null;
    }

    const cols = this.getColumnCount(table);
    const widths = this.getColWidths(table);
    const row = this.createRow(cols, widths);
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
   * Returns false if maxCols limit would be exceeded.
   */
  public addColumn(table: HTMLElement, index?: number): boolean {
    if (this.maxCols !== undefined && this.getColumnCount(table) >= this.maxCols) {
      return false;
    }

    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);
    const oldColCount = this.getColumnCount(table);
    const newColCount = oldColCount + 1;
    const newColWidth = Math.round((100 / newColCount) * 100) / 100;
    const scaleFactor = (100 - newColWidth) / 100;

    rows.forEach(row => {
      // Scale existing cells
      const existingCells = row.querySelectorAll(`[${CELL_ATTR}]`);

      existingCells.forEach(cell => {
        const el = cell as HTMLElement;
        const oldWidth = parseFloat(el.style.width) || (100 / oldColCount);

        el.style.width = `${Math.round(oldWidth * scaleFactor * 100) / 100}%`;
      });

      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);
      const isAppend = index === undefined || index >= cells.length;
      const cell = this.createCell(newColWidth);

      if (!isAppend) {
        row.insertBefore(cell, cells[index]);

        return;
      }

      row.appendChild(cell);
    });

    return true;
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

      const removedWidth = parseFloat((cells[index] as HTMLElement).style.width) || 0;

      cells[index].remove();

      // Redistribute removed width to remaining cells
      const remaining = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (remaining.length > 0 && removedWidth > 0) {
        const extra = removedWidth / remaining.length;

        remaining.forEach(cell => {
          const el = cell as HTMLElement;
          const currentWidth = parseFloat(el.style.width) || 0;

          el.style.width = `${Math.round((currentWidth + extra) * 100) / 100}%`;
        });
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
   * Get cell content HTML
   */
  private getCellContent(cell: HTMLElement): string {
    return cell.innerHTML;
  }

  /**
   * Create a single row with N cells
   */
  private createRow(cols: number, colWidths: number[]): HTMLElement {
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
  private createCell(widthPercent?: number): HTMLElement {
    const cell = document.createElement('div');

    cell.className = twMerge(CELL_CLASSES);
    cell.style.borderRight = BORDER_STYLE;
    cell.style.borderBottom = BORDER_STYLE;

    if (widthPercent !== undefined) {
      cell.style.width = `${widthPercent}%`;
    }

    cell.setAttribute(CELL_ATTR, '');
    cell.setAttribute('contenteditable', this.readOnly ? 'false' : 'true');

    return cell;
  }
}
