import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableResize } from '../../../../src/tools/table/table-resize';

const MIN_COL_WIDTH = 10;

/**
 * Creates a grid element without resize handles.
 * Handles are now created by TableResize itself.
 */
const createGrid = (colWidths: number[]): HTMLDivElement => {
  const grid = document.createElement('div');

  grid.style.borderTop = '1px solid #d1d5db';
  grid.style.borderLeft = '1px solid #d1d5db';

  const row = document.createElement('div');

  row.setAttribute('data-blok-table-row', '');

  colWidths.forEach((w) => {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    cell.style.width = `${w}%`;
    cell.style.position = 'relative';
    cell.style.borderRight = '1px solid #d1d5db';
    cell.style.borderBottom = '1px solid #d1d5db';

    row.appendChild(cell);
  });

  grid.appendChild(row);
  document.body.appendChild(grid);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

/**
 * Creates a grid with multiple rows for testing full-height handles
 */
const createMultiRowGrid = (rows: number, colWidths: number[]): HTMLDivElement => {
  const grid = document.createElement('div');

  grid.style.borderTop = '1px solid #d1d5db';
  grid.style.borderLeft = '1px solid #d1d5db';

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');

    colWidths.forEach((w) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.style.width = `${w}%`;
      cell.style.position = 'relative';
      cell.style.borderRight = '1px solid #d1d5db';
      cell.style.borderBottom = '1px solid #d1d5db';

      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  document.body.appendChild(grid);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

/**
 * Get the last handle element from the grid
 */
const getLastHandle = (gridEl: HTMLDivElement): HTMLElement => {
  const handles = gridEl.querySelectorAll('[data-blok-table-resize]');

  return handles[handles.length - 1] as HTMLElement;
};

describe('TableResize', () => {
  let grid: HTMLDivElement;

  afterEach(() => {
    grid?.remove();
  });

  describe('handle creation', () => {
    it('creates N handles for N columns (including right edge)', () => {
      grid = createGrid([33.33, 33.33, 33.34]);
      new TableResize(grid, [33.33, 33.33, 33.34], 100, vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      // 3 columns → 3 handles (2 between pairs + 1 at right edge)
      expect(handles).toHaveLength(3);
    });

    it('creates handles equal to column count', () => {
      grid = createGrid([25, 25, 25, 25]);
      new TableResize(grid, [25, 25, 25, 25], 100, vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(4);
    });

    it('does not create handles for single-column grid', () => {
      grid = createGrid([100]);
      new TableResize(grid, [100], 100, vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(0);
    });

    it('positions handles as direct children of the grid', () => {
      grid = createGrid([50, 50]);
      new TableResize(grid, [50, 50], 100, vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.parentElement).toBe(grid);
    });

    it('handles span full table height', () => {
      grid = createMultiRowGrid(3, [50, 50]);
      new TableResize(grid, [50, 50], 100, vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.style.top).toBe('0px');
      expect(handle.style.bottom).toBe('0px');
      expect(handle.style.position).toBe('absolute');
    });

    it('has a wide hit target for easier interaction', () => {
      grid = createGrid([50, 50]);
      new TableResize(grid, [50, 50], 100, vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;
      const width = parseInt(handle.style.width, 10);

      expect(width).toBeGreaterThanOrEqual(16);
    });

    it('sets grid to position relative for handle positioning', () => {
      grid = createGrid([50, 50]);
      new TableResize(grid, [50, 50], 100, vi.fn());

      expect(grid.style.position).toBe('relative');
    });

    it('creates a handle at the right edge of the table', () => {
      grid = createGrid([50, 50]);
      new TableResize(grid, [50, 50], 100, vi.fn());

      const lastHandle = getLastHandle(grid);

      expect(lastHandle.style.left).toContain('100%');
    });

    it('sets grid width from initial tableWidth', () => {
      grid = createGrid([50, 50]);
      new TableResize(grid, [50, 50], 75, vi.fn());

      expect(grid.style.width).toBe('75%');
    });
  });

  describe('pointer drag', () => {
    it('calls onChange with updated widths after drag', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], 100, onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const [newWidths, newTableWidth] = onChange.mock.calls[0] as [number[], number];

      expect(newWidths[0]).toBeCloseTo(60, 0);
      expect(newWidths[1]).toBeCloseTo(40, 0);
      // Table width unchanged for column drag
      expect(newTableWidth).toBe(100);
    });

    it('clamps columns to minimum width', () => {
      grid = createGrid([15, 85]);
      const onChange = vi.fn();

      new TableResize(grid, [15, 85], 100, onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 150, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(MIN_COL_WIDTH);
      expect(newWidths[1]).toBe(90);
    });

    it('updates handle positions during drag', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], 100, onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;
      const initialLeft = handle.style.left;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));

      expect(handle.style.left).not.toBe(initialLeft);

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });
  });

  describe('right edge drag (table width)', () => {
    it('dragging right edge left shrinks the table width', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], 100, onChange);

      const rightEdgeHandle = getLastHandle(grid);

      // Drag left by 200px on a 1000px container
      // Container is 1000px, table is 100% = 1000px
      // Moving 200px left → new table width = 800px = 80% of container
      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 800 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const [colWidths, tableWidth] = onChange.mock.calls[0] as [number[], number];

      // Column ratios unchanged
      expect(colWidths[0]).toBe(50);
      expect(colWidths[1]).toBe(50);
      // Table width shrunk
      expect(tableWidth).toBeCloseTo(80, 0);
    });

    it('dragging right edge right grows the table width', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      // Start with table at 60%
      new TableResize(grid, [50, 50], 60, onChange);

      const rightEdgeHandle = getLastHandle(grid);

      // Table is 60% of 1000px container = 600px
      // Drag right by 200px → new width = 800px = 80% of container
      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 800 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const [colWidths, tableWidth] = onChange.mock.calls[0] as [number[], number];

      expect(colWidths[0]).toBe(50);
      expect(colWidths[1]).toBe(50);
      expect(tableWidth).toBeCloseTo(80, 0);
    });

    it('clamps table width to maximum of 100%', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], 90, onChange);

      const rightEdgeHandle = getLastHandle(grid);

      // Drag right way past the container edge
      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 900, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 1500 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const tableWidth = onChange.mock.calls[0][1] as number;

      expect(tableWidth).toBe(100);
    });

    it('clamps table width to a minimum', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();

      new TableResize(grid, [50, 50], 100, onChange);

      const rightEdgeHandle = getLastHandle(grid);

      // Drag left very far
      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const tableWidth = onChange.mock.calls[0][1] as number;

      // Should not go below minimum (at least 5% per column = 10% for 2 cols)
      expect(tableWidth).toBeGreaterThanOrEqual(10);
    });

    it('updates grid element width during drag', () => {
      grid = createGrid([50, 50]);

      new TableResize(grid, [50, 50], 100, vi.fn());

      const rightEdgeHandle = getLastHandle(grid);

      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 800 }));

      // Grid width should have changed during drag
      expect(grid.style.width).not.toBe('100%');

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });

    it('does not change column widths when dragging right edge', () => {
      grid = createGrid([30, 30, 40]);
      const onChange = vi.fn();

      new TableResize(grid, [30, 30, 40], 100, onChange);

      const rightEdgeHandle = getLastHandle(grid);

      rightEdgeHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 700 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const colWidths = onChange.mock.calls[0][0] as number[];

      expect(colWidths[0]).toBe(30);
      expect(colWidths[1]).toBe(30);
      expect(colWidths[2]).toBe(40);
    });
  });

  describe('destroy', () => {
    it('removes event listeners on destroy', () => {
      grid = createGrid([50, 50]);
      const onChange = vi.fn();
      const resize = new TableResize(grid, [50, 50], 100, onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      resize.destroy();
      grid.appendChild(handle);

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('removes handle elements from the grid on destroy', () => {
      grid = createGrid([50, 50]);
      const resize = new TableResize(grid, [50, 50], 100, vi.fn());

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(2);

      resize.destroy();

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(0);
    });
  });
});
