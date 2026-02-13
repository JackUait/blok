import { describe, it, expect } from 'vitest';
import { TableGrid } from '../../../../src/tools/table/table-core';

/**
 * Place mock block elements into cells' blocks containers.
 * Each label becomes a block ID so getData() returns { blocks: [label] }.
 */
const fillWithBlocks = (grid: TableGrid, element: HTMLElement, labels: string[][]): void => {
  const rows = element.querySelectorAll('[data-blok-table-row]');

  labels.forEach((rowLabels, rowIndex) => {
    if (rowIndex >= rows.length) {
      return;
    }

    const cells = rows[rowIndex].querySelectorAll('[data-blok-table-cell]');

    rowLabels.forEach((label, colIndex) => {
      if (colIndex >= cells.length) {
        return;
      }

      const container = cells[colIndex].querySelector('[data-blok-table-cell-blocks]');

      if (!container) {
        return;
      }

      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', label);
      container.appendChild(blockHolder);
    });
  });
};

/** Shorthand to create a block-reference cell value */
const b = (id: string): { blocks: string[] } => {
  return { blocks: [id] };
};

/** Shorthand for an empty cell (no blocks) */
const empty = { blocks: [] };

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

    it('cell should not be contenteditable', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect(cell.getAttribute('contenteditable')).not.toBe('true');
      });
    });

    it('cell should not be contenteditable in readOnly mode either', () => {
      const grid = new TableGrid({ readOnly: true });
      const element = grid.createGrid(1, 1);
      const cell = element.querySelector('[data-blok-table-cell]');

      expect(cell?.getAttribute('contenteditable')).not.toBe('true');
      expect(cell?.getAttribute('contenteditable')).not.toBe('false');
    });

    it('cell should have a blocks container', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        const container = cell.querySelector('[data-blok-table-cell-blocks]');

        expect(container).not.toBeNull();
      });
    });

    it('creates cells with flex-shrink 0 so they do not compress when table overflows', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.flexShrink).toBe('0');
      });
    });

    it('creates cells with overflow hidden so text does not bleed into adjacent cells', () => {
      const grid = new TableGrid({ readOnly: true });
      const element = grid.createGrid(2, 3);

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.overflow).toBe('hidden');
      });
    });

    it('creates cells with overflow-wrap break-word so long words wrap within narrow cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 2);

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.overflowWrap).toBe('break-word');
      });
    });
  });

  describe('fillGrid', () => {
    it('should not modify cell contents', () => {
      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(1, 1);

      grid.fillGrid(gridEl, [['Hello']]);

      const cell = gridEl.querySelector('[data-blok-table-cell]') as HTMLElement;
      const container = cell.querySelector('[data-blok-table-cell-blocks]');

      // Container should exist and be empty (fillGrid should not populate it)
      expect(container).not.toBeNull();
      expect(container?.children.length).toBe(0);
    });
  });

  describe('getData', () => {
    it('should return block references for all cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(1, 1);

      // Simulate a cell with a mounted block
      const cell = gridEl.querySelector('[data-blok-table-cell]') as HTMLElement;
      const container = cell.querySelector('[data-blok-table-cell-blocks]') as HTMLElement;
      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', 'block-123');
      container.appendChild(blockHolder);

      const data = grid.getData(gridEl);

      expect(data[0][0]).toEqual({ blocks: ['block-123'] });
    });

    it('should return empty blocks array for cell with no blocks', () => {
      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(1, 1);

      const data = grid.getData(gridEl);

      expect(data[0][0]).toEqual({ blocks: [] });
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

      grid.addRow(element, 1);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows).toHaveLength(3);

      // New row should be empty, at index 1
      const newRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');
      expect(newRowCells[0]).toHaveTextContent('');
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

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.deleteRow(element, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), b('B')], [b('E'), b('F')]]);
    });
  });

  describe('addColumn', () => {
    it('appends a column at the end', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.addColumn(element);

      const rows = element.querySelectorAll('[data-blok-table-row]');
      expect(rows[0].querySelectorAll('[data-blok-table-cell]')).toHaveLength(3);
    });

    it('inserts a column at specific index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D']]);
      grid.addColumn(element, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), empty, b('B')], [b('C'), empty, b('D')]]);
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

    it('sets new column width to half the average of existing columns when colWidths provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.addColumn(element, undefined, [200, 300, 100]);

      const cells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Average of [200, 300, 100] = 200, half = 100
      expect((cells[3] as HTMLElement).style.width).toBe('100px');
    });

    it('sets new column width to half the average in px mode without colWidths param', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // Set px widths directly on cells (simulating resize)
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      (cells[0] as HTMLElement).style.width = '200px';
      (cells[1] as HTMLElement).style.width = '200px';
      (cells[2] as HTMLElement).style.width = '200px';

      grid.addColumn(element);

      const allCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Average = 200, half = 100
      expect((allCells[3] as HTMLElement).style.width).toBe('100px');
    });

    it('sets new column width to half the average in percent mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // Default percent mode: each column ~33.33%
      grid.addColumn(element);

      const allCells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      // Average = 33.33%, half = 16.67%
      const newColWidth = parseFloat((allCells[3] as HTMLElement).style.width);

      expect(newColWidth).toBeCloseTo(16.67, 1);
      expect((allCells[3] as HTMLElement).style.width).toMatch(/%$/);
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
        // New column: half the average of [250, 350] = 300, half = 150
        expect((cells[2] as HTMLElement).style.width).toBe('150px');
      });
    });

    it('uses explicit newColWidth when provided instead of computing from existing widths', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // colWidths [200, 300, 100] → avg=200, half=100
      // But we pass explicit newColWidth=75
      grid.addColumn(element, undefined, [200, 300, 100], 75);

      const cells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      expect((cells[3] as HTMLElement).style.width).toBe('75px');
    });

    it('falls back to half-average when newColWidth is not provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // colWidths [200, 300, 100] → avg=200, half=100 (existing behavior)
      grid.addColumn(element, undefined, [200, 300, 100]);

      const cells = element.querySelectorAll('[data-blok-table-row]')[0]
        .querySelectorAll('[data-blok-table-cell]');

      expect((cells[3] as HTMLElement).style.width).toBe('100px');
    });
  });

  describe('deleteColumn', () => {
    it('removes a column at index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.deleteColumn(element, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), b('C')], [b('D'), b('F')]]);
    });

    it('preserves remaining column widths in px mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Set px widths directly on cells
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        (cells[0] as HTMLElement).style.width = '200px';
        (cells[1] as HTMLElement).style.width = '300px';
        (cells[2] as HTMLElement).style.width = '100px';
      });

      grid.deleteColumn(element, 1);

      const widths = grid.getColWidths(element);

      expect(widths).toEqual([200, 100]);
    });

    it('preserves remaining column widths in percent mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Default widths are equal percentages (~33.33% each)
      const widthsBefore = grid.getColWidths(element);

      grid.deleteColumn(element, 1);

      const widthsAfter = grid.getColWidths(element);

      expect(widthsAfter).toEqual([widthsBefore[0], widthsBefore[2]]);
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

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D']]);

      const cell = grid.getCell(element, 1, 0);
      const container = cell?.querySelector('[data-blok-table-cell-blocks]');
      const block = container?.querySelector('[data-blok-id="C"]');

      expect(block).not.toBeNull();
    });
  });

  describe('moveRow', () => {
    it('moves a row from one index to another', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 0, 2);

      const data = grid.getData(element);

      expect(data).toEqual([[b('C'), b('D')], [b('E'), b('F')], [b('A'), b('B')]]);
    });

    it('moves a row from last to first', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 2, 0);

      const data = grid.getData(element);

      expect(data).toEqual([[b('E'), b('F')], [b('A'), b('B')], [b('C'), b('D')]]);
    });

    it('does nothing when fromIndex equals toIndex', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 1, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]]);
    });

    it('moves adjacent rows correctly (swap down)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 0, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('C'), b('D')], [b('A'), b('B')], [b('E'), b('F')]]);
    });

    it('moves adjacent rows correctly (swap up)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 2, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), b('B')], [b('E'), b('F')], [b('C'), b('D')]]);
    });
  });

  describe('moveColumn', () => {
    it('moves a column from one index to another', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 0, 2);

      const data = grid.getData(element);

      expect(data).toEqual([[b('B'), b('C'), b('A')], [b('E'), b('F'), b('D')]]);
    });

    it('moves a column from last to first', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 2, 0);

      const data = grid.getData(element);

      expect(data).toEqual([[b('C'), b('A'), b('B')], [b('F'), b('D'), b('E')]]);
    });

    it('does nothing when fromIndex equals toIndex', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 1, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]]);
    });

    it('moves adjacent columns correctly (swap right)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 0, 1);

      const data = grid.getData(element);

      expect(data).toEqual([[b('B'), b('A'), b('C')], [b('E'), b('D'), b('F')]]);
    });

    it('preserves cell widths when moving columns', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      const cells = element.querySelectorAll('[data-blok-table-cell]');

      (cells[0] as HTMLElement).style.width = '100px';
      (cells[1] as HTMLElement).style.width = '200px';
      (cells[2] as HTMLElement).style.width = '300px';

      grid.moveColumn(element, 0, 2);

      const movedCells = element.querySelectorAll('[data-blok-table-cell]');

      expect((movedCells[0] as HTMLElement).style.width).toBe('200px');
      expect((movedCells[1] as HTMLElement).style.width).toBe('300px');
      expect((movedCells[2] as HTMLElement).style.width).toBe('100px');
    });
  });

});
