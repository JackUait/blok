import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableRowColDrag } from '../../../../src/tools/table/table-row-col-drag';

const DRAG_THRESHOLD = 10;

/**
 * Creates a grid with the given number of rows and columns.
 * Each cell has the data-blok-table-cell attribute.
 */
const createGrid = (rows: number, cols: number): HTMLDivElement => {
  const grid = document.createElement('div');

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');

    Array.from({ length: cols }).forEach(() => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.style.width = '100px';
      Object.defineProperty(cell, 'offsetWidth', { value: 100 });
      Object.defineProperty(cell, 'offsetHeight', { value: 40 });
      row.appendChild(cell);
    });

    Object.defineProperty(row, 'offsetTop', { value: 0 });
    Object.defineProperty(row, 'offsetHeight', { value: 40 });
    grid.appendChild(row);
  });

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: cols * 100, left: 0, right: cols * 100, top: 0, bottom: rows * 40, height: rows * 40, x: 0, y: 0, toJSON: () => ({}) }),
  });

  document.body.appendChild(grid);

  return grid;
};

/**
 * Simulate a full drag sequence: pointerdown via beginTracking, then pointermove past threshold.
 */
const startDrag = (
  drag: TableRowColDrag,
  type: 'row' | 'col',
  index: number,
  startX: number,
  startY: number
): void => {
  void drag.beginTracking(type, index, startX, startY);

  // Move past the drag threshold to trigger startDrag
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: startX + DRAG_THRESHOLD + 1,
    clientY: startY + DRAG_THRESHOLD + 1,
  }));
};

/**
 * Returns all cells in a given row index from the grid.
 */
const getCellsInRow = (grid: HTMLElement, rowIndex: number): HTMLElement[] => {
  const rows = grid.querySelectorAll('[data-blok-table-row]');
  const row = rows[rowIndex];

  if (!row) {
    return [];
  }

  return Array.from(row.querySelectorAll('[data-blok-table-cell]'));
};

/**
 * Returns all cells in a given column index from the grid.
 */
const getCellsInColumn = (grid: HTMLElement, colIndex: number): HTMLElement[] => {
  const rows = grid.querySelectorAll('[data-blok-table-row]');

  return Array.from(rows).map(row => {
    const cells = row.querySelectorAll('[data-blok-table-cell]');

    return cells[colIndex] as HTMLElement;
  }).filter(Boolean);
};

describe('TableRowColDrag', () => {
  let grid: HTMLDivElement;

  afterEach(() => {
    grid?.remove();
  });

  describe('source cell highlighting during row drag', () => {
    it('applies gray background to dragged row cells', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'row', 1, 50, 50);

      const cells = getCellsInRow(grid, 1);

      cells.forEach(cell => {
        expect(cell.style.backgroundColor).toBe('rgb(243, 244, 246)');
      });

      drag.cleanup();
    });

    it('sets opacity to 0.7 on dragged row cells', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'row', 1, 50, 50);

      const cells = getCellsInRow(grid, 1);

      cells.forEach(cell => {
        expect(cell.style.opacity).toBe('0.7');
      });

      drag.cleanup();
    });

    it('does not highlight cells in other rows', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'row', 1, 50, 50);

      const row0Cells = getCellsInRow(grid, 0);
      const row2Cells = getCellsInRow(grid, 2);

      [...row0Cells, ...row2Cells].forEach(cell => {
        expect(cell.style.backgroundColor).toBe('');
        expect(cell.style.opacity).toBe('');
      });

      drag.cleanup();
    });
  });

  describe('source cell highlighting during column drag', () => {
    it('applies gray background to dragged column cells', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'col', 1, 150, 20);

      const cells = getCellsInColumn(grid, 1);

      cells.forEach(cell => {
        expect(cell.style.backgroundColor).toBe('rgb(243, 244, 246)');
      });

      drag.cleanup();
    });

    it('sets opacity to 0.7 on dragged column cells', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'col', 1, 150, 20);

      const cells = getCellsInColumn(grid, 1);

      cells.forEach(cell => {
        expect(cell.style.opacity).toBe('0.7');
      });

      drag.cleanup();
    });
  });

  describe('cleanup resets highlight styles', () => {
    it('clears background and opacity from row cells after cleanup', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'row', 0, 50, 10);

      drag.cleanup();

      const cells = getCellsInRow(grid, 0);

      cells.forEach(cell => {
        expect(cell.style.backgroundColor).toBe('');
        expect(cell.style.opacity).toBe('');
      });
    });

    it('clears background and opacity from column cells after cleanup', () => {
      grid = createGrid(3, 3);
      const drag = new TableRowColDrag({ grid, onAction: vi.fn() });

      startDrag(drag, 'col', 2, 250, 20);

      drag.cleanup();

      const cells = getCellsInColumn(grid, 2);

      cells.forEach(cell => {
        expect(cell.style.backgroundColor).toBe('');
        expect(cell.style.opacity).toBe('');
      });
    });
  });
});
