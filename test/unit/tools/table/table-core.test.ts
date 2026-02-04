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
