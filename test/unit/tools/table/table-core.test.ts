import { describe, it, expect } from 'vitest';
import { TableGrid } from '../../../../src/tools/table/table-core';

describe('TableGrid', () => {
  describe('createGrid', () => {
    it('creates a grid with specified rows and columns', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(2);

      const cellsInFirstRow = rows[0].querySelectorAll('[data-blok-table-cell]');
      expect(cellsInFirstRow).toHaveLength(3);
    });

    it('makes cells contentEditable when not readOnly', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 1);

      const cell = element.querySelector('[data-blok-table-cell]');
      expect(cell?.getAttribute('contenteditable')).toBe('true');
    });

    it('makes cells non-editable when readOnly', () => {
      const grid = new TableGrid({ readOnly: true });
      const element = grid.createGrid(1, 1);

      const cell = element.querySelector('[data-blok-table-cell]');
      expect(cell?.getAttribute('contenteditable')).toBe('false');
    });

    it('creates cells with flex-shrink 0 so they do not compress when table overflows', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.flexShrink).toBe('0');
      });
    });
  });

  describe('fillGrid', () => {
    it('populates cells with content from 2D array', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D']]);

      const cells = element.querySelectorAll('[data-blok-table-cell]');
      expect(cells[0].textContent).toBe('A');
      expect(cells[1].textContent).toBe('B');
      expect(cells[2].textContent).toBe('C');
      expect(cells[3].textContent).toBe('D');
    });
  });

  describe('getData', () => {
    it('extracts 2D array from grid DOM', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D']]);

      const data = grid.getData(element);
      expect(data).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('excludes completely empty rows', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      grid.fillGrid(element, [['A', 'B'], ['', ''], ['C', 'D']]);

      const data = grid.getData(element);
      expect(data).toEqual([['A', 'B'], ['C', 'D']]);
    });
  });

  describe('addRow', () => {
    it('appends a row at the end', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 2);

      grid.addRow(element);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(2);
    });

    it('inserts a row at specific index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['R1', 'R1'], ['R2', 'R2']]);
      grid.addRow(element, 1);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(3);

      // New row should be empty, at index 1
      const newRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');
      expect(newRowCells[0].textContent).toBe('');
    });

    it('preserves pixel widths when existing cells use px units', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // Simulate TableResize setting pixel widths on cells
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      (cells[0] as HTMLElement).style.width = '200px';
      (cells[1] as HTMLElement).style.width = '300px';
      (cells[2] as HTMLElement).style.width = '150px';

      grid.addRow(element);

      const newRow = element.querySelectorAll('[data-blok-table-row]')[1];
      const newCells = newRow.querySelectorAll('[data-blok-table-cell]');

      expect((newCells[0] as HTMLElement).style.width).toBe('200px');
      expect((newCells[1] as HTMLElement).style.width).toBe('300px');
      expect((newCells[2] as HTMLElement).style.width).toBe('150px');
    });

    it('new rows match existing widths after addColumn then addRow with px units', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Simulate TableResize setting pixel widths
      const allCells = element.querySelectorAll('[data-blok-table-cell]');

      allCells.forEach(node => {
        const el = node as HTMLElement;

        el.style.width = '200px';
      });

      // Add a column (simulating the user action)
      grid.addColumn(element);

      // Read widths from first row after addColumn
      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      const expectedWidths = Array.from(firstRowCells).map(
        cell => (cell as HTMLElement).style.width
      );

      // Add a row (the bug scenario)
      grid.addRow(element);

      const newRow = element.querySelectorAll('[data-blok-table-row]')[2];
      const newCells = newRow.querySelectorAll('[data-blok-table-cell]');

      expect(newCells).toHaveLength(expectedWidths.length);

      expectedWidths.forEach((expectedWidth, i) => {
        expect((newCells[i] as HTMLElement).style.width).toBe(expectedWidth);
      });
    });
  });

  describe('deleteRow', () => {
    it('removes a row at index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.deleteRow(element, 1);

      const data = grid.getData(element);
      expect(data).toEqual([['A', 'B'], ['E', 'F']]);
    });
  });

  describe('addColumn', () => {
    it('appends a column at the end', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D']]);
      grid.addColumn(element);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows[0].querySelectorAll('[data-blok-table-cell]')).toHaveLength(3);
    });

    it('inserts a column at specific index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D']]);
      grid.addColumn(element, 1);

      const data = grid.getData(element);
      expect(data).toEqual([['A', '', 'B'], ['C', '', 'D']]);
    });

    it('keeps existing pixel widths unchanged and adds new column with default width', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Simulate TableResize setting pixel widths
      const allCells = element.querySelectorAll('[data-blok-table-cell]');

      allCells.forEach(node => {
        const el = node as HTMLElement;

        el.style.width = '200px';
      });

      grid.addColumn(element);

      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Existing columns should keep their widths
      expect((firstRowCells[0] as HTMLElement).style.width).toBe('200px');
      expect((firstRowCells[1] as HTMLElement).style.width).toBe('200px');
      expect((firstRowCells[2] as HTMLElement).style.width).toBe('200px');

      // New column should have a default width in px
      const newCellWidth = parseFloat((firstRowCells[3] as HTMLElement).style.width);

      expect((firstRowCells[3] as HTMLElement).style.width).toMatch(/px$/);
      expect(newCellWidth).toBeGreaterThan(0);
    });

    it('preserves existing column widths in percent mode when colWidths are provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Table starts in percent mode (default)
      const firstCell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      expect(firstCell.style.width).toMatch(/%$/);

      // Add column with known pixel widths (as Table class would provide from resize data)
      grid.addColumn(element, undefined, [200, 300, 150]);

      const firstRowCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Existing columns should be converted to provided pixel widths
      expect((firstRowCells[0] as HTMLElement).style.width).toBe('200px');
      expect((firstRowCells[1] as HTMLElement).style.width).toBe('300px');
      expect((firstRowCells[2] as HTMLElement).style.width).toBe('150px');

      // New column should have average width in px
      const newCellWidth = parseFloat((firstRowCells[3] as HTMLElement).style.width);

      expect((firstRowCells[3] as HTMLElement).style.width).toMatch(/px$/);
      expect(newCellWidth).toBeGreaterThan(0);
    });

    it('sets new column width to average of existing columns when colWidths provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.addColumn(element, undefined, [200, 300, 100]);

      const cells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Average of [200, 300, 100] = 200
      expect((cells[3] as HTMLElement).style.width).toBe('200px');
    });

    it('applies colWidths to all rows when adding column', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      grid.addColumn(element, undefined, [250, 350]);

      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        expect(cells).toHaveLength(3);
        expect((cells[0] as HTMLElement).style.width).toBe('250px');
        expect((cells[1] as HTMLElement).style.width).toBe('350px');
        // New column
        expect((cells[2] as HTMLElement).style.width).toBe('300px');
      });
    });
  });

  describe('deleteColumn', () => {
    it('removes a column at index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      grid.fillGrid(element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.deleteColumn(element, 1);

      const data = grid.getData(element);
      expect(data).toEqual([['A', 'C'], ['D', 'F']]);
    });
  });

  describe('row and column count', () => {
    it('returns correct row count', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      expect(grid.getRowCount(element)).toBe(3);
    });

    it('returns correct column count', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 4);

      expect(grid.getColumnCount(element)).toBe(4);
    });
  });

  describe('getCell', () => {
    it('returns cell at row and column', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.fillGrid(element, [['A', 'B'], ['C', 'D']]);

      const cell = grid.getCell(element, 1, 0);
      expect(cell?.textContent).toBe('C');
    });
  });

});
