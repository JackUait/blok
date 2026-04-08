import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';

/**
 * Place mock block elements into cells' blocks containers.
 * Each label becomes a block ID.
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

    it('cells have a text cursor so the entire cell surface feels clickable', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 1);
      const cell = element.querySelector('[data-blok-table-cell]');

      expect(cell).toHaveClass('cursor-text');
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

    it('preserves column count when adding row with px widths on <col>', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3, [200, 300, 150]);

      grid.addRow(element);

      const newRow = element.querySelectorAll('[data-blok-table-row]')[1];
      const newCells = newRow.querySelectorAll('[data-blok-table-cell]');

      expect(newCells).toHaveLength(3);

      // Widths are on <col> elements, not on cells
      const widths = grid.getColWidths(element);

      expect(widths).toEqual([200, 300, 150]);
    });

    it('new rows match column count after addColumn then addRow', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3, [200, 200, 200]);

      grid.addColumn(element);

      const colCountAfterAdd = grid.getColumnCount(element);

      grid.addRow(element);

      const newRow = element.querySelectorAll('[data-blok-table-row]')[2];
      const newCells = newRow.querySelectorAll('[data-blok-table-cell]');

      expect(newCells).toHaveLength(colCountAfterAdd);
    });
  });

  describe('deleteRow', () => {
    it('removes a row at index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.deleteRow(element, 1);
      model.deleteRow(1);

      expect(model.snapshot().content).toEqual([[b('A'), b('B')], [b('E'), b('F')]]);
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
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D']]);
      grid.addColumn(element, 1);
      model.addColumn(1);

      expect(model.snapshot().content).toEqual([[b('A'), empty, b('B')], [b('C'), empty, b('D')]]);
    });

    it('keeps existing <col> widths unchanged and adds new <col> with default width in px mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      // Set px widths on <col> elements (simulating resize)
      grid.applyColWidths(element, [200, 200, 200]);

      grid.addColumn(element);

      const widths = grid.getColWidths(element);

      // Existing columns keep their widths
      expect(widths[0]).toBe(200);
      expect(widths[1]).toBe(200);
      expect(widths[2]).toBe(200);

      // New column has a default width in px
      expect(widths[3]).toBeGreaterThan(0);
    });

    it('converts <col> widths to px when colWidths are provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      grid.addColumn(element, undefined, [200, 300, 150]);

      const cols = element.querySelectorAll('col');

      // Existing columns converted to provided pixel widths
      expect(cols[0].style.width).toBe('200px');
      expect(cols[1].style.width).toBe('300px');
      expect(cols[2].style.width).toBe('150px');

      // New column has px width
      expect(cols[3].style.width).toMatch(/px$/);
      expect(parseFloat(cols[3].style.width)).toBeGreaterThan(0);
    });

    it('sets new <col> width to half the average when colWidths provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.addColumn(element, undefined, [200, 300, 100]);

      const cols = element.querySelectorAll('col');

      // Average of [200, 300, 100] = 200, half = 100
      expect(cols[3].style.width).toBe('100px');
    });

    it('sets new <col> width to half the average in px mode without colWidths param', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // Set px widths on <col> elements (simulating resize)
      grid.applyColWidths(element, [200, 200, 200]);

      grid.addColumn(element);

      const cols = element.querySelectorAll('col');

      // Average = 200, half = 100
      expect(cols[3].style.width).toBe('100px');
    });

    it('sets new <col> width to half the average in percent mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      // Default percent mode: each column ~33.33%
      grid.addColumn(element);

      const cols = element.querySelectorAll('col');

      // Average = 33.33%, half = 16.67%
      const newColWidth = parseFloat(cols[3].style.width);

      expect(newColWidth).toBeCloseTo(16.67, 1);
      expect(cols[3].style.width).toMatch(/%$/);
    });

    it('applies colWidths to <col> elements when adding column', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);

      grid.addColumn(element, undefined, [250, 350]);

      const cols = element.querySelectorAll('col');

      expect(cols).toHaveLength(3);
      expect(cols[0].style.width).toBe('250px');
      expect(cols[1].style.width).toBe('350px');
      // New column: half the average of [250, 350] = 300, half = 150
      expect(cols[2].style.width).toBe('150px');

      // All rows have the right number of cells
      const rows = element.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        expect(row.querySelectorAll('[data-blok-table-cell]')).toHaveLength(3);
      });
    });

    it('uses explicit newColWidth when provided instead of computing from existing widths', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.addColumn(element, undefined, [200, 300, 100], 75);

      const cols = element.querySelectorAll('col');

      expect(cols[3].style.width).toBe('75px');
    });

    it('falls back to half-average when newColWidth is not provided', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.addColumn(element, undefined, [200, 300, 100]);

      const cols = element.querySelectorAll('col');

      expect(cols[3].style.width).toBe('100px');
    });
  });

  describe('deleteColumn', () => {
    it('removes a column at index', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.deleteColumn(element, 1);
      model.deleteColumn(1);

      expect(model.snapshot().content).toEqual([[b('A'), b('C')], [b('D'), b('F')]]);
    });

    it('preserves remaining <col> widths in px mode', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3, [200, 300, 100]);

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
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 0, 2);
      model.moveRow(0, 2);

      expect(model.snapshot().content).toEqual([[b('C'), b('D')], [b('E'), b('F')], [b('A'), b('B')]]);
    });

    it('moves a row from last to first', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 2, 0);
      model.moveRow(2, 0);

      expect(model.snapshot().content).toEqual([[b('E'), b('F')], [b('A'), b('B')], [b('C'), b('D')]]);
    });

    it('does nothing when fromIndex equals toIndex', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 1, 1);
      model.moveRow(1, 1);

      expect(model.snapshot().content).toEqual([[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]]);
    });

    it('moves adjacent rows correctly (swap down)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 0, 1);
      model.moveRow(0, 1);

      expect(model.snapshot().content).toEqual([[b('C'), b('D')], [b('A'), b('B')], [b('E'), b('F')]]);
    });

    it('moves adjacent rows correctly (swap up)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 2);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B')], [b('C'), b('D')], [b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B'], ['C', 'D'], ['E', 'F']]);
      grid.moveRow(element, 2, 1);
      model.moveRow(2, 1);

      expect(model.snapshot().content).toEqual([[b('A'), b('B')], [b('E'), b('F')], [b('C'), b('D')]]);
    });
  });

  describe('moveColumn', () => {
    it('moves a column from one index to another', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 0, 2);
      model.moveColumn(0, 2);

      expect(model.snapshot().content).toEqual([[b('B'), b('C'), b('A')], [b('E'), b('F'), b('D')]]);
    });

    it('moves a column from last to first', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 2, 0);
      model.moveColumn(2, 0);

      expect(model.snapshot().content).toEqual([[b('C'), b('A'), b('B')], [b('F'), b('D'), b('E')]]);
    });

    it('does nothing when fromIndex equals toIndex', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 1, 1);
      model.moveColumn(1, 1);

      expect(model.snapshot().content).toEqual([[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]]);
    });

    it('moves adjacent columns correctly (swap right)', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[b('A'), b('B'), b('C')], [b('D'), b('E'), b('F')]],
      });

      fillWithBlocks(grid, element, [['A', 'B', 'C'], ['D', 'E', 'F']]);
      grid.moveColumn(element, 0, 1);
      model.moveColumn(0, 1);

      expect(model.snapshot().content).toEqual([[b('B'), b('A'), b('C')], [b('E'), b('D'), b('F')]]);
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

  describe('cell line-height', () => {
    it('cell has line-height 1 (leading-none) matching Notion table cell', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 1);
      const cell = element.querySelector('[data-blok-table-cell]') as HTMLElement;

      expect(cell).toHaveClass('leading-none');
    });
  });

  // ─── HTML <table> structure ────────────────────────────────────────

  describe('HTML table structure', () => {
    it('createGrid returns a <table> element', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      expect(element.tagName).toBe('TABLE');
    });

    it('table has table-layout fixed', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      expect(element.style.tableLayout).toBe('fixed');
    });

    it('table has border-collapse separate with 0 spacing', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      expect(element.style.borderCollapse).toBe('separate');
      expect(element.style.borderSpacing).toBe('0px');
    });

    it('creates a <colgroup> with one <col> per column', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const colgroup = element.querySelector('colgroup');

      expect(colgroup).not.toBeNull();
      expect(colgroup!.querySelectorAll('col')).toHaveLength(3);
    });

    it('creates a <tbody> containing <tr> rows', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const tbody = element.querySelector('tbody');

      expect(tbody).not.toBeNull();
      expect(tbody!.querySelectorAll('tr')).toHaveLength(2);
    });

    it('rows are <tr> elements with ROW_ATTR', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const rows = element.querySelectorAll('[data-blok-table-row]');

      expect(rows).toHaveLength(2);
      rows.forEach(row => {
        expect(row.tagName).toBe('TR');
      });
    });

    it('cells are <td> elements with CELL_ATTR', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      expect(cells).toHaveLength(6);
      cells.forEach(cell => {
        expect(cell.tagName).toBe('TD');
      });
    });

    it('column widths are on <col> elements, not on cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      const cols = element.querySelectorAll('col');

      cols.forEach(col => {
        const w = parseFloat(col.style.width);

        expect(w).toBeGreaterThan(0);
      });

      // Cells should NOT have inline width
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      cells.forEach(cell => {
        expect((cell as HTMLElement).style.width).toBe('');
      });
    });

    it('getColWidths reads from <col> elements', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3, [100, 200, 150]);

      const widths = grid.getColWidths(element);

      expect(widths).toEqual([100, 200, 150]);
    });

    it('addRow inserts <tr> into <tbody>', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 2);

      grid.addRow(element);

      const tbody = element.querySelector('tbody')!;

      expect(tbody.querySelectorAll('tr')).toHaveLength(2);
    });

    it('addColumn adds a <col> and a <td> per row', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.addColumn(element);

      expect(element.querySelectorAll('col')).toHaveLength(3);

      const rows = element.querySelectorAll('tr');

      rows.forEach(row => {
        expect(row.querySelectorAll('td')).toHaveLength(3);
      });
    });

    it('deleteColumn removes a <col> and a <td> per row', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 3);

      grid.deleteColumn(element, 1);

      expect(element.querySelectorAll('col')).toHaveLength(2);

      const rows = element.querySelectorAll('tr');

      rows.forEach(row => {
        expect(row.querySelectorAll('td')).toHaveLength(2);
      });
    });

    it('moveColumn reorders <col> elements too', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3, [100, 200, 300]);

      grid.moveColumn(element, 0, 2);

      const cols = element.querySelectorAll('col');

      expect(parseFloat(cols[0].style.width)).toBe(200);
      expect(parseFloat(cols[1].style.width)).toBe(300);
      expect(parseFloat(cols[2].style.width)).toBe(100);
    });
  });

  // ─── Coordinate reindexing after structural ops ────────────────
  describe('coordinate reindexing', () => {
    const getCoords = (element: HTMLElement): Array<{ row: string; col: string }> => {
      const cells = element.querySelectorAll('[data-blok-table-cell]');

      return Array.from(cells).map(cell => ({
        row: cell.getAttribute('data-blok-table-cell-row') ?? '',
        col: cell.getAttribute('data-blok-table-cell-col') ?? '',
      }));
    };

    it('reindexes column coordinates after deleteColumn', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.deleteColumn(element, 1);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '0', col: '1' },
      ]);
    });

    it('reindexes row coordinates after deleteRow', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 1);

      grid.deleteRow(element, 0);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '1', col: '0' },
      ]);
    });

    it('reindexes coordinates after moveColumn', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(1, 3);

      grid.moveColumn(element, 0, 2);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '0', col: '1' },
        { row: '0', col: '2' },
      ]);
    });

    it('reindexes coordinates after moveRow', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(3, 1);

      grid.moveRow(element, 2, 0);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '1', col: '0' },
        { row: '2', col: '0' },
      ]);
    });

    it('reindexes coordinates after addRow', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.addRow(element, 0);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '0', col: '1' },
        { row: '1', col: '0' },
        { row: '1', col: '1' },
        { row: '2', col: '0' },
        { row: '2', col: '1' },
      ]);
    });

    it('reindexes coordinates after addColumn', () => {
      const grid = new TableGrid({ readOnly: false });
      const element = grid.createGrid(2, 2);

      grid.addColumn(element, 0);

      const coords = getCoords(element);

      expect(coords).toEqual([
        { row: '0', col: '0' },
        { row: '0', col: '1' },
        { row: '0', col: '2' },
        { row: '1', col: '0' },
        { row: '1', col: '1' },
        { row: '1', col: '2' },
      ]);
    });

    it('reindexCoordinates assigns correct model column when a cell has colspan=2', () => {
      // Table layout: row 0 has [td colspan=2 at model col 0] then [td at model col 2]
      // After reindexCoordinates, DOM cell index 1 in row 0 should be col=2, not col=1
      const grid = new TableGrid({ readOnly: false });
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');

      const row = document.createElement('tr');

      row.setAttribute('data-blok-table-row', '');

      const cellA = document.createElement('td');

      cellA.setAttribute('data-blok-table-cell', '');
      cellA.colSpan = 2;

      const cellB = document.createElement('td');

      cellB.setAttribute('data-blok-table-cell', '');
      cellB.colSpan = 1;

      row.appendChild(cellA);
      row.appendChild(cellB);
      tbody.appendChild(row);
      table.appendChild(tbody);

      grid.reindexCoordinates(table);

      expect(cellA.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cellA.getAttribute('data-blok-table-cell-col')).toBe('0');
      expect(cellB.getAttribute('data-blok-table-cell-row')).toBe('0');
      // cellB is at model col 2 (skipping col 1 occupied by cellA's colspan)
      expect(cellB.getAttribute('data-blok-table-cell-col')).toBe('2');
    });

    it('reindexCoordinates skips rowspan-blocked columns in subsequent rows', () => {
      // Table layout:
      //   row 0: [td rowspan=2 at model (0,0)], [td at model (0,1)]
      //   row 1: [td at model (1,1)]   <-- col 0 is blocked by rowspan from row 0
      const grid = new TableGrid({ readOnly: false });
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');

      const row0 = document.createElement('tr');

      row0.setAttribute('data-blok-table-row', '');

      const cellR0C0 = document.createElement('td');

      cellR0C0.setAttribute('data-blok-table-cell', '');
      cellR0C0.rowSpan = 2;

      const cellR0C1 = document.createElement('td');

      cellR0C1.setAttribute('data-blok-table-cell', '');

      row0.appendChild(cellR0C0);
      row0.appendChild(cellR0C1);

      const row1 = document.createElement('tr');

      row1.setAttribute('data-blok-table-row', '');

      const cellR1C1 = document.createElement('td');

      cellR1C1.setAttribute('data-blok-table-cell', '');

      row1.appendChild(cellR1C1);
      tbody.appendChild(row0);
      tbody.appendChild(row1);
      table.appendChild(tbody);

      grid.reindexCoordinates(table);

      expect(cellR0C0.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cellR0C0.getAttribute('data-blok-table-cell-col')).toBe('0');
      expect(cellR0C1.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cellR0C1.getAttribute('data-blok-table-cell-col')).toBe('1');
      expect(cellR1C1.getAttribute('data-blok-table-cell-row')).toBe('1');
      // col 0 is occupied by rowspan from row 0; this cell is at model col 1
      expect(cellR1C1.getAttribute('data-blok-table-cell-col')).toBe('1');
    });

    it('reindexCoordinates handles a cell with both colspan=2 and rowspan=2', () => {
      // 3x3 table where cell at [0,0] has colspan=2 AND rowspan=2
      // Row 0 DOM: [td colspan=2 rowspan=2] [td] <- model cols 0-1 merged, td at col 2
      // Row 1 DOM: [td] <- col 0 blocked (rowspan), col 1 blocked (rowspan+colspan), starts at col 2
      const grid = new TableGrid({ readOnly: false });
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      const row0 = document.createElement('tr');
      row0.setAttribute('data-blok-table-row', '');
      const cell00 = document.createElement('td');
      cell00.setAttribute('data-blok-table-cell', '');
      cell00.colSpan = 2;
      cell00.rowSpan = 2;
      const cell02 = document.createElement('td');
      cell02.setAttribute('data-blok-table-cell', '');
      row0.appendChild(cell00);
      row0.appendChild(cell02);
      tbody.appendChild(row0);

      const row1 = document.createElement('tr');
      row1.setAttribute('data-blok-table-row', '');
      const cell12 = document.createElement('td');
      cell12.setAttribute('data-blok-table-cell', '');
      row1.appendChild(cell12);
      tbody.appendChild(row1);

      grid.reindexCoordinates(table);

      // cell00: model [0,0]
      expect(cell00.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cell00.getAttribute('data-blok-table-cell-col')).toBe('0');

      // cell02: model [0,2] (after the 2-wide colspan)
      expect(cell02.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cell02.getAttribute('data-blok-table-cell-col')).toBe('2');

      // cell12: model [1,2] (cols 0 and 1 are blocked by the combined colspan+rowspan)
      expect(cell12.getAttribute('data-blok-table-cell-row')).toBe('1');
      expect(cell12.getAttribute('data-blok-table-cell-col')).toBe('2');
    });
  });

  // ─── Merge-aware rendering ─────────────────────────────────────
  describe('merge-aware rendering', () => {
    /** Helper to create a TableModel from a content grid */
    const createModel = (
      content: Array<Array<{
        blocks: string[];
        colspan?: number;
        rowspan?: number;
        mergedInto?: [number, number];
      }>>
    ): TableModel => {
      return new TableModel({ content, withHeadings: false, withHeadingColumn: false });
    };

    it('createGrid sets coordinate attributes on cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const table = grid.createGrid(2, 3);

      const rows = table.querySelectorAll('[data-blok-table-row]');

      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('[data-blok-table-cell]');

        cells.forEach((cell, colIndex) => {
          expect(cell.getAttribute('data-blok-table-cell-row')).toBe(String(rowIndex));
          expect(cell.getAttribute('data-blok-table-cell-col')).toBe(String(colIndex));
        });
      });
    });

    it('createGridFromModel sets colspan on origin td', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      ]);

      const table = grid.createGridFromModel(model);
      const rows = table.querySelectorAll('[data-blok-table-row]');
      const firstCell = rows[0].querySelector('td');

      expect((firstCell as HTMLTableCellElement).colSpan).toBe(2);
    });

    it('createGridFromModel sets rowspan on origin td', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [{ blocks: ['a'], rowspan: 2 }],
        [{ blocks: [], mergedInto: [0, 0] }],
      ]);

      const table = grid.createGridFromModel(model);
      const rows = table.querySelectorAll('[data-blok-table-row]');
      const firstCell = rows[0].querySelector('td');

      expect((firstCell as HTMLTableCellElement).rowSpan).toBe(2);
    });

    it('createGridFromModel omits covered cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [{ blocks: ['a'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
      ]);

      const table = grid.createGridFromModel(model);
      const rows = table.querySelectorAll('[data-blok-table-row]');

      expect(rows[0].querySelectorAll('td')).toHaveLength(1);
      expect(rows[1].querySelectorAll('td')).toHaveLength(0);
    });

    it('2x2 merge produces correct DOM structure', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [
          { blocks: ['a'], colspan: 2, rowspan: 2 },
          { blocks: [], mergedInto: [0, 0] },
          { blocks: ['b'] },
        ],
        [
          { blocks: [], mergedInto: [0, 0] },
          { blocks: [], mergedInto: [0, 0] },
          { blocks: ['c'] },
        ],
      ]);

      const table = grid.createGridFromModel(model);
      const rows = table.querySelectorAll('[data-blok-table-row]');

      // Row 0: merged cell + unmerged [0,2]
      expect(rows[0].querySelectorAll('td')).toHaveLength(2);
      // Row 1: only [1,2]
      expect(rows[1].querySelectorAll('td')).toHaveLength(1);

      const originCell = rows[0].querySelector('td') as HTMLTableCellElement;

      expect(originCell.colSpan).toBe(2);
      expect(originCell.rowSpan).toBe(2);
    });

    it('getCell returns correct td using coordinate attributes', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [
          { blocks: ['a'], colspan: 2, rowspan: 2 },
          { blocks: [], mergedInto: [0, 0] },
          { blocks: ['b'] },
        ],
        [
          { blocks: [], mergedInto: [0, 0] },
          { blocks: [], mergedInto: [0, 0] },
          { blocks: ['c'] },
        ],
      ]);

      const table = grid.createGridFromModel(model);

      // Origin cell at (0,0)
      const cell00 = grid.getCell(table, 0, 0);

      expect(cell00).not.toBeNull();
      expect(cell00?.getAttribute('data-blok-table-cell-row')).toBe('0');
      expect(cell00?.getAttribute('data-blok-table-cell-col')).toBe('0');

      // Unmerged cell at (0,2)
      const cell02 = grid.getCell(table, 0, 2);

      expect(cell02).not.toBeNull();
      expect(cell02?.getAttribute('data-blok-table-cell-col')).toBe('2');

      // Cell at (1,2)
      const cell12 = grid.getCell(table, 1, 2);

      expect(cell12).not.toBeNull();
      expect(cell12?.getAttribute('data-blok-table-cell-row')).toBe('1');
      expect(cell12?.getAttribute('data-blok-table-cell-col')).toBe('2');
    });

    it('createGridFromModel sets coordinate attributes on cells', () => {
      const grid = new TableGrid({ readOnly: false });
      const model = createModel([
        [
          { blocks: ['a'], colspan: 2 },
          { blocks: [], mergedInto: [0, 0] },
          { blocks: ['b'] },
        ],
        [
          { blocks: ['c'] },
          { blocks: ['d'] },
          { blocks: ['e'] },
        ],
      ]);

      const table = grid.createGridFromModel(model);

      // Row 0: origin at (0,0) and cell at (0,2)
      const cell00 = table.querySelector('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]');

      expect(cell00).not.toBeNull();

      const cell02 = table.querySelector('[data-blok-table-cell-row="0"][data-blok-table-cell-col="2"]');

      expect(cell02).not.toBeNull();

      // Row 1: cells at (1,0), (1,1), (1,2)
      const cell10 = table.querySelector('[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"]');

      expect(cell10).not.toBeNull();

      const cell11 = table.querySelector('[data-blok-table-cell-row="1"][data-blok-table-cell-col="1"]');

      expect(cell11).not.toBeNull();

      const cell12 = table.querySelector('[data-blok-table-cell-row="1"][data-blok-table-cell-col="2"]');

      expect(cell12).not.toBeNull();

      // Covered cell (0,1) should NOT exist in the DOM
      const cell01 = table.querySelector('[data-blok-table-cell-row="0"][data-blok-table-cell-col="1"]');

      expect(cell01).toBeNull();
    });
  });

  describe('table cell block height in readonly mode', () => {
    it('main.css applies min-height to .blok-block inside table cells so empty cells match edit-mode height', () => {
      const mainCss = readFileSync(
        resolve(__dirname, '../../../../src/styles/main.css'),
        'utf-8'
      );

      // The rule for [data-blok-table-cell-blocks] .blok-block must include min-h
      // to prevent empty non-contenteditable paragraphs from collapsing to 0px height
      const blockRule = mainCss.match(
        /\[data-blok-table-cell-blocks\]\s*\.blok-block\s*\{[^}]*\}/
      );

      expect(blockRule).not.toBeNull();
      expect(blockRule?.[0]).toContain('min-h-');
    });
  });

});
