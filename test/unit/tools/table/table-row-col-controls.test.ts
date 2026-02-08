import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRowColControls } from '../../../../src/tools/table/table-row-col-controls';

const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const GRIP_VISIBLE_ATTR = 'data-blok-table-grip-visible';
const HIDE_DELAY_MS = 150;

/**
 * Create a minimal grid element with rows and cells for testing.
 * Mocks offsetWidth/offsetHeight/offsetTop so grip positioning works.
 */
const createGrid = (rows: number, cols: number, cellWidth = 100): HTMLElement => {
  const grid = document.createElement('div');

  grid.style.position = 'relative';

  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');
    Object.defineProperty(row, 'offsetTop', { value: r * 40, configurable: true });
    Object.defineProperty(row, 'offsetHeight', { value: 40, configurable: true });

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      cell.style.width = `${cellWidth}px`;
      Object.defineProperty(cell, 'offsetWidth', { value: cellWidth, configurable: true });
      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  document.body.appendChild(grid);

  return grid;
};

const getCell = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
  const cells = rows[row].querySelectorAll(`[${CELL_ATTR}]`);

  return cells[col] as HTMLElement;
};

const isGripVisible = (grip: HTMLElement): boolean => {
  return grip.hasAttribute(GRIP_VISIBLE_ATTR);
};

describe('TableRowColControls', () => {
  let grid: HTMLElement;
  let controls: TableRowColControls;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    controls?.destroy();
    grid?.remove();
    vi.restoreAllMocks();
  });

  describe('hover-based grip visibility', () => {
    it('shows row and column grips when hovering over a cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const cell = getCell(grid, 0, 1);

      const event = new MouseEvent('mouseover', { bubbles: true });

      cell.dispatchEvent(event);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Column grip 1 should be visible
      expect(isGripVisible(colGrips[1])).toBe(true);
      // Row grip 0 should be visible
      expect(isGripVisible(rowGrips[0])).toBe(true);
    });

    it('only shows grips for the hovered cell, not others', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const cell = getCell(grid, 1, 2);
      const event = new MouseEvent('mouseover', { bubbles: true });

      cell.dispatchEvent(event);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Only col grip 2 visible, others hidden
      expect(isGripVisible(colGrips[0])).toBe(false);
      expect(isGripVisible(colGrips[1])).toBe(false);
      expect(isGripVisible(colGrips[2])).toBe(true);

      // Only row grip 1 visible, other hidden
      expect(isGripVisible(rowGrips[0])).toBe(false);
      expect(isGripVisible(rowGrips[1])).toBe(true);
    });

    it('hides grips when mouse leaves the grid', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const cell = getCell(grid, 0, 0);

      const hoverEvent = new MouseEvent('mouseover', { bubbles: true });

      cell.dispatchEvent(hoverEvent);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      expect(isGripVisible(colGrips[0])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(true);

      // Mouse leaves grid
      const leaveEvent = new MouseEvent('mouseleave', { bubbles: false });

      grid.dispatchEvent(leaveEvent);
      vi.advanceTimersByTime(HIDE_DELAY_MS + 10);

      // Grips should be hidden
      expect(isGripVisible(colGrips[0])).toBe(false);
      expect(isGripVisible(rowGrips[0])).toBe(false);
    });

    it('switches grips when hovering a different cell', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      // Hover cell (0,0)
      const hoverFirst = new MouseEvent('mouseover', { bubbles: true });

      getCell(grid, 0, 0).dispatchEvent(hoverFirst);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      expect(isGripVisible(colGrips[0])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(true);

      // Hover cell (1,1) — different row AND column
      const hoverSecond = new MouseEvent('mouseover', { bubbles: true });

      getCell(grid, 1, 1).dispatchEvent(hoverSecond);

      // Previous grips should be hidden
      expect(isGripVisible(colGrips[0])).toBe(false);
      expect(isGripVisible(rowGrips[0])).toBe(false);

      // New grips should be visible
      expect(isGripVisible(colGrips[1])).toBe(true);
      expect(isGripVisible(rowGrips[1])).toBe(true);
    });

    it('does not show grips on focus (old behavior removed)', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const cell = getCell(grid, 0, 0);

      cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // All grips should remain hidden
      colGrips.forEach(grip => expect(isGripVisible(grip)).toBe(false));
      rowGrips.forEach(grip => expect(isGripVisible(grip)).toBe(false));
    });
  });

  describe('public positionGrips', () => {
    it('positionGrips can be called externally to reposition grips', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      // Should not throw when called externally
      expect(() => controls.positionGrips()).not.toThrow();
    });

    it('centers column grips on the top border line', () => {
      const cellWidth = 100;

      grid = createGrid(2, 2, cellWidth);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // The 1px border sits from y=-1 to y=0 (outside padding box).
      // Border center is at y=-0.5px, so pill top = -0.5 - 2 = -2.5px
      expect(colGrips[0].style.top).toBe('-2.5px');
    });

    it('centers row grips on the left border line', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // The 1px border sits from x=-1 to x=0 (outside padding box).
      // Border center is at x=-0.5px, so pill left = -0.5 - 2 = -2.5px
      expect(rowGrips[0].style.left).toBe('-2.5px');
    });
  });

  describe('setGripsDisplay', () => {
    it('hides all grips when called with false', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      controls.setGripsDisplay(false);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      colGrips.forEach(grip => expect(grip.style.display).toBe('none'));
      rowGrips.forEach(grip => expect(grip.style.display).toBe('none'));
    });

    it('restores all grips when called with true', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      controls.setGripsDisplay(false);
      controls.setGripsDisplay(true);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      colGrips.forEach(grip => expect(grip.style.display).toBe(''));
      rowGrips.forEach(grip => expect(grip.style.display).toBe(''));
    });
  });

  describe('grip dot pattern', () => {
    it('each grip contains an SVG with 6 circles for the drag handle pattern', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // All column grips should have SVG with 6 circles
      colGrips.forEach(grip => {
        const svg = grip.querySelector('svg');

        expect(svg).not.toBeNull();
        expect(svg?.querySelectorAll('circle')).toHaveLength(6);
      });

      // All row grips should have SVG with 6 circles
      rowGrips.forEach(grip => {
        const svg = grip.querySelector('svg');

        expect(svg).not.toBeNull();
        expect(svg?.querySelectorAll('circle')).toHaveLength(6);
      });
    });

    it('grip SVG has pointer-events-none so clicks pass through to grip', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const svg = colGrips[0].querySelector('svg');

      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('fill')).toBe('currentColor');
    });

    it('grip SVG circles have correct attributes', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const circles = colGrips[0].querySelectorAll('circle');

      circles.forEach(circle => {
        expect(circle).toHaveAttribute('r', '1.5');
      });
    });
  });

  describe('hideAllGrips', () => {
    it('immediately hides all visible grips without delay', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
      });

      // Show grips by hovering
      const event = new MouseEvent('mouseover', { bubbles: true });

      getCell(grid, 0, 0).dispatchEvent(event);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      expect(isGripVisible(colGrips[0])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(true);

      // Hide all immediately (no timer needed)
      controls.hideAllGrips();

      expect(isGripVisible(colGrips[0])).toBe(false);
      expect(isGripVisible(rowGrips[0])).toBe(false);
    });
  });
});
