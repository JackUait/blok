import { twMerge } from '../../components/utils/tw';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';

const TABLE_CLASSES = [
  'w-full',
  'border-collapse',
];

const ROW_CLASSES = [
  'flex',
];

const CELL_CLASSES = [
  'flex-1',
  'border',
  'border-gray-200',
  'p-2',
  'min-h-[2em]',
  'outline-none',
  'leading-normal',
];

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
  public createGrid(rows: number, cols: number): HTMLDivElement {
    const table = document.createElement('div');

    table.className = twMerge(TABLE_CLASSES);

    for (let r = 0; r < rows; r++) {
      const row = this.createRow(cols);

      table.appendChild(row);
    }

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

        cells[colIndex].innerHTML = cellContent;
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
        rowData.push(cell.innerHTML);
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
   */
  public addRow(table: HTMLElement, index?: number): HTMLElement {
    const cols = this.getColumnCount(table);
    const row = this.createRow(cols);
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
   */
  public addColumn(table: HTMLElement, index?: number): void {
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cell = this.createCell();
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (index !== undefined && index < cells.length) {
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
    const rows = table.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (index < cells.length) {
        cells[index].remove();
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
   * Create a single row with N cells
   */
  private createRow(cols: number): HTMLElement {
    const row = document.createElement('div');

    row.className = twMerge(ROW_CLASSES);
    row.setAttribute(ROW_ATTR, '');

    for (let c = 0; c < cols; c++) {
      row.appendChild(this.createCell());
    }

    return row;
  }

  /**
   * Create a single cell
   */
  private createCell(): HTMLElement {
    const cell = document.createElement('div');

    cell.className = twMerge(CELL_CLASSES);
    cell.setAttribute(CELL_ATTR, '');
    cell.setAttribute('contenteditable', this.readOnly ? 'false' : 'true');

    return cell;
  }
}
