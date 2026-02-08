import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const SELECTED_ATTR = 'data-blok-table-cell-selected';
const OVERLAY_ATTR = 'data-blok-table-selection-overlay';

/**
 * Creates a simple grid element with rows and columns for testing.
 * Each cell is 100px wide and 40px tall.
 */
const createGrid = (rows: number, cols: number): HTMLElement => {
  const grid = document.createElement('div');

  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      cell.style.width = '100px';
      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  document.body.appendChild(grid);

  return grid;
};

/**
 * Mock getBoundingClientRect for a grid where each cell is 100x40.
 * Grid starts at (10, 10).
 */
const mockBoundingRects = (grid: HTMLElement): void => {
  const gridLeft = 10;
  const gridTop = 10;
  const cellWidth = 100;
  const cellHeight = 40;

  const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
  const colCount = rows[0]?.querySelectorAll(`[${CELL_ATTR}]`).length ?? 0;

  const gridWidth = colCount * cellWidth;
  const gridHeight = rows.length * cellHeight;

  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    top: gridTop,
    left: gridLeft,
    bottom: gridTop + gridHeight,
    right: gridLeft + gridWidth,
    width: gridWidth,
    height: gridHeight,
    x: gridLeft,
    y: gridTop,
    toJSON: () => ({}),
  });

  rows.forEach((row, r) => {
    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach((cell, c) => {
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
        top: gridTop + r * cellHeight,
        left: gridLeft + c * cellWidth,
        bottom: gridTop + (r + 1) * cellHeight,
        right: gridLeft + (c + 1) * cellWidth,
        width: cellWidth,
        height: cellHeight,
        x: gridLeft + c * cellWidth,
        y: gridTop + r * cellHeight,
        toJSON: () => ({}),
      });
    });
  });
};

/** Stub for elementFromPoint that returns the target cell */
let elementFromPointTarget: Element | null = null;

/**
 * Simulate a pointer drag from one cell to another.
 */
const simulateDrag = (
  grid: HTMLElement,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): void => {
  const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
  const startCell = rows[fromRow]?.querySelectorAll(`[${CELL_ATTR}]`)[fromCol] as HTMLElement;
  const endCell = rows[toRow]?.querySelectorAll(`[${CELL_ATTR}]`)[toCol] as HTMLElement;

  const startRect = startCell.getBoundingClientRect();
  const endRect = endCell.getBoundingClientRect();

  // Set the elementFromPoint target before dispatching move events
  elementFromPointTarget = endCell;

  // pointerdown on start cell
  const downEvent = new PointerEvent('pointerdown', {
    clientX: startRect.left + 5,
    clientY: startRect.top + 5,
    bubbles: true,
    button: 0,
  });

  startCell.dispatchEvent(downEvent);

  // pointermove to end cell
  const moveEvent = new PointerEvent('pointermove', {
    clientX: endRect.left + 5,
    clientY: endRect.top + 5,
    bubbles: true,
  });

  document.dispatchEvent(moveEvent);

  // pointerup
  const upEvent = new PointerEvent('pointerup', {
    bubbles: true,
  });

  document.dispatchEvent(upEvent);
};

describe('TableCellSelection', () => {
  let grid: HTMLElement;
  let selection: TableCellSelection;

  beforeEach(() => {
    vi.clearAllMocks();
    elementFromPointTarget = null;

    // jsdom doesn't define elementFromPoint; provide a stub
    document.elementFromPoint = (_x: number, _y: number) => elementFromPointTarget;

    grid = createGrid(3, 3);
    mockBoundingRects(grid);
    selection = new TableCellSelection(grid);
  });

  afterEach(() => {
    selection.destroy();

    if (grid.parentElement) {
      grid.remove();
    }

    vi.restoreAllMocks();
  });

  describe('grid setup', () => {
    it('sets position: relative on grid in constructor', () => {
      expect(grid.style.position).toBe('relative');
    });
  });

  describe('overlay creation', () => {
    it('creates an overlay div when selection is made', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`);

      expect(overlay).not.toBeNull();
    });

    it('overlay has position: absolute', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      expect(overlay.style.position).toBe('absolute');
    });

    it('overlay has blue border', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // jsdom converts hex to rgb when setting style.border
      expect(overlay.style.borderWidth).toBe('2px');
      expect(overlay.style.borderStyle).toBe('solid');
      // jsdom converts hex #3b82f6 to rgb(59, 130, 246)
      expect(overlay.style.borderColor).toBe('rgb(59, 130, 246)');
    });

    it('overlay has pointer-events: none', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      expect(overlay.style.pointerEvents).toBe('none');
    });

    it('overlay has box-sizing: border-box', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      expect(overlay.style.boxSizing).toBe('border-box');
    });
  });

  describe('no per-cell border manipulation', () => {
    it('does not change grid borderTop on edge selection', () => {
      const originalBorderTop = grid.style.borderTop;

      simulateDrag(grid, 0, 0, 0, 1);

      expect(grid.style.borderTop).toBe(originalBorderTop);
    });

    it('does not change grid borderLeft on edge selection', () => {
      const originalBorderLeft = grid.style.borderLeft;

      simulateDrag(grid, 0, 0, 1, 0);

      expect(grid.style.borderLeft).toBe(originalBorderLeft);
    });

    it('does not change cell border styles during selection', () => {
      const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
      const cell = rows[0].querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
      const originalBorderRight = cell.style.borderRight;
      const originalBorderBottom = cell.style.borderBottom;

      simulateDrag(grid, 0, 0, 1, 1);

      expect(cell.style.borderRight).toBe(originalBorderRight);
      expect(cell.style.borderBottom).toBe(originalBorderBottom);
    });
  });

  describe('selected cells marking', () => {
    it('marks selected cells with data attribute', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const selectedCells = grid.querySelectorAll(`[${SELECTED_ATTR}]`);

      // 2x2 selection
      expect(selectedCells).toHaveLength(4);
    });
  });

  describe('clearing selection', () => {
    it('removes overlay from DOM on clear', () => {
      // Enable fake timers BEFORE the drag so requestAnimationFrame is captured
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).not.toBeNull();

      // Flush the rAF callback that registers the clear listener
      vi.runAllTimers();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      vi.useRealTimers();

      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).toBeNull();
    });

    it('removes selected attribute from cells on clear', () => {
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      // Flush the rAF callback that registers the clear listener
      vi.runAllTimers();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      vi.useRealTimers();

      const selectedCells = grid.querySelectorAll(`[${SELECTED_ATTR}]`);

      expect(selectedCells).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('removes overlay on destroy', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).not.toBeNull();

      selection.destroy();

      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).toBeNull();
    });
  });

  describe('overlay positioning', () => {
    it('positions overlay to cover the selected cells', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Grid starts at (10, 10). Cell (0,0) top-left is (10, 10).
      // Cell (1,1) bottom-right is (10 + 2*100, 10 + 2*40) = (210, 90).
      // Overlay relative to grid: top = 0, left = 0, width = 200, height = 80.
      expect(overlay.style.top).toBe('0px');
      expect(overlay.style.left).toBe('0px');
      expect(overlay.style.width).toBe('200px');
      expect(overlay.style.height).toBe('80px');
    });

    it('positions overlay correctly for non-origin selection', () => {
      simulateDrag(grid, 1, 1, 2, 2);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Cell (1,1) top-left: (10 + 100, 10 + 40) = (110, 50) relative to page.
      // Grid top-left: (10, 10).
      // Overlay top = 50 - 10 = 40, left = 110 - 10 = 100.
      // Cell (2,2) bottom-right: (10 + 3*100, 10 + 3*40) = (310, 130).
      // width = 310 - 110 = 200, height = 130 - 50 = 80.
      expect(overlay.style.top).toBe('40px');
      expect(overlay.style.left).toBe('100px');
      expect(overlay.style.width).toBe('200px');
      expect(overlay.style.height).toBe('80px');
    });

    it('compensates for grid border width so overlay aligns with cell edges', () => {
      // Simulate a real browser where grid has 1px borders and cells start
      // 1px inside the grid's border-box. The overlay (position:absolute)
      // positions from the padding-box, so we must subtract the border.
      const gridLeft = 10;
      const gridTop = 10;
      const borderWidth = 1;
      const cellWidth = 100;
      const cellHeight = 40;

      // Grid border-box rect
      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
        top: gridTop,
        left: gridLeft,
        bottom: gridTop + 3 * cellHeight + borderWidth,
        right: gridLeft + 3 * cellWidth + borderWidth,
        width: 3 * cellWidth + borderWidth,
        height: 3 * cellHeight + borderWidth,
        x: gridLeft,
        y: gridTop,
        toJSON: () => ({}),
      });

      // Cells start 1px inside the grid (after the border)
      const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);

      rows.forEach((row, r) => {
        const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

        cells.forEach((cell, c) => {
          vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
            top: gridTop + borderWidth + r * cellHeight,
            left: gridLeft + borderWidth + c * cellWidth,
            bottom: gridTop + borderWidth + (r + 1) * cellHeight,
            right: gridLeft + borderWidth + (c + 1) * cellWidth,
            width: cellWidth,
            height: cellHeight,
            x: gridLeft + borderWidth + c * cellWidth,
            y: gridTop + borderWidth + r * cellHeight,
            toJSON: () => ({}),
          });
        });
      });

      // Mock getComputedStyle to return actual border widths
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '1px',
        borderLeftWidth: '1px',
      } as CSSStyleDeclaration);

      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Without border compensation: top = (10+1) - 10 = 1px (wrong!)
      // With border compensation: top = (10+1) - 10 - 1 = 0px (correct)
      expect(overlay.style.top).toBe('0px');
      expect(overlay.style.left).toBe('0px');
      expect(overlay.style.width).toBe('200px');
      expect(overlay.style.height).toBe('80px');
    });
  });
});
