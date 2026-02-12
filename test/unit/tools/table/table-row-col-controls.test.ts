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

  const mockI18n = {
    t: vi.fn((key: string) => key),
    has: vi.fn(() => false),
    getEnglishTranslation: vi.fn((key: string) => key),
  };

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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // The 1px border center is at y=-0.5px.
      // translate(-50%, -50%) handles offset from the center point.
      expect(colGrips[0].style.top).toBe('-0.5px');
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
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // The 1px border center is at x=-0.5px.
      // translate(-50%, -50%) handles offset from the center point.
      expect(rowGrips[0].style.left).toBe('-0.5px');
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
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
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const circles = colGrips[0].querySelectorAll('circle');

      circles.forEach(circle => {
        expect(circle).toHaveAttribute('r', '1.5');
      });
    });
  });

  describe('dimension-based grip expand/collapse', () => {
    it('column grips are created at idle height with translate centering', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      // Width stays at full size; height starts at idle pill size (4px content)
      expect(grip.style.width).toBe('24px');
      expect(grip.style.height).toBe('4px');
      // Uses translate for centering, not scale transforms
      expect(grip.style.transform).toBe('translate(-50%, -50%)');
    });

    it('row grips are created at idle width with translate centering', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      // Height stays at full size; width starts at idle pill size (4px content)
      expect(grip.style.width).toBe('4px');
      expect(grip.style.height).toBe('20px');
      expect(grip.style.transform).toBe('translate(-50%, -50%)');
    });

    it('column grip expands height on mouseenter', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

      expect(grip.style.height).toBe('16px');
      // Width stays constant
      expect(grip.style.width).toBe('24px');
      // Transform stays as translate, no scale
      expect(grip.style.transform).toBe('translate(-50%, -50%)');
    });

    it('column grip collapses height back to idle on mouseleave', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

      expect(grip.style.height).toBe('4px');
    });

    it('row grip expands width on mouseenter', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

      expect(grip.style.width).toBe('16px');
      // Height stays constant
      expect(grip.style.height).toBe('20px');
      expect(grip.style.transform).toBe('translate(-50%, -50%)');
    });

    it('row grip collapses width back to idle on mouseleave', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

      expect(grip.style.width).toBe('4px');
    });

    it('grip retains bg-gray-300 after expand then collapse so pill stays visible', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      // Make grip visible by hovering a cell
      const cell = getCell(grid, 0, 0);

      cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(isGripVisible(grip)).toBe(true);
      // Column grip starts at idle height (4px)
      expect(grip.style.height).toBe('4px');

      // Hover the grip (expand) — height expands to 16px
      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      expect(grip.style.height).toBe('16px');

      // Leave the grip (collapse) — height returns to idle (4px)
      grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      expect(grip.style.height).toBe('4px');
    });

    it('column grip fixed dimension stays constant during expand/collapse', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      // Width is the fixed dimension for column grips
      expect(grip.style.width).toBe('24px');

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      expect(grip.style.width).toBe('24px');

      grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      expect(grip.style.width).toBe('24px');
    });

    it('row grip fixed dimension stays constant during expand/collapse', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      // Height is the fixed dimension for row grips
      expect(grip.style.height).toBe('20px');

      grip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      expect(grip.style.height).toBe('20px');

      grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      expect(grip.style.height).toBe('20px');
    });
  });

  describe('drag hides all grips', () => {
    it('hides both row and column grips when dragging a row', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Pointerdown on a row grip to start tracking
      const rowGrip = rowGrips[0];

      rowGrip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }));

      // Move pointer beyond drag threshold (10px)
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 0,
        clientY: 20,
      }));

      // ALL grips should be hidden — both row and column
      colGrips.forEach(grip => expect(grip.style.display).toBe('none'));
      rowGrips.forEach(grip => expect(grip.style.display).toBe('none'));

      // Clean up drag state
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });

    it('hides both row and column grips when dragging a column', () => {
      grid = createGrid(2, 3);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Pointerdown on a column grip to start tracking
      const colGrip = colGrips[1];

      colGrip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0,
      }));

      // Move pointer beyond drag threshold (10px)
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 70,
        clientY: 0,
      }));

      // ALL grips should be hidden — both row and column
      colGrips.forEach(grip => expect(grip.style.display).toBe('none'));
      rowGrips.forEach(grip => expect(grip.style.display).toBe('none'));

      // Clean up drag state
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });

    it('restores all grips when drag ends', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Start a drag on a row grip
      rowGrips[0].dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 0,
        clientY: 20,
      }));

      // End the drag
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // All grips should be restored
      colGrips.forEach(grip => expect(grip.style.display).toBe(''));
      rowGrips.forEach(grip => expect(grip.style.display).toBe(''));
    });
  });

  describe('grip click popover ordering', () => {
    it('popover is in the DOM before onGripClick fires so grip hiding does not break positioning', async () => {
      grid = createGrid(2, 2);

      let popoverInDomAtCallbackTime = false;

      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
        onGripClick: () => {
          // In the real app, onGripClick triggers cell selection which hides
          // all grips (display:none). The popover must already be positioned
          // (i.e. show() must have already run) by this point, otherwise
          // getBoundingClientRect on the hidden grip returns {0,0,0,0}.
          popoverInDomAtCallbackTime = document.querySelector('[data-blok-popover-opened]') !== null;

          // Simulate what the real app does: hide all grips
          controls.setGripsDisplay(false);
        },
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // Simulate a click (pointerdown → pointerup with no drag).
      // beginTracking returns a Promise that resolves on pointerup.
      // The .then() callback (which calls openPopover) runs asynchronously.
      colGrips[0].dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Flush microtask queue so the .then() callback runs
      await vi.waitFor(() => {
        expect(popoverInDomAtCallbackTime).toBe(true);
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
        i18n: mockI18n,
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

  describe('grip stays expanded while popover is open', () => {
    it('column grip remains at expanded size (16px height) while popover is open', async () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      // Click the grip to open popover (pointerdown → pointerup)
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Wait for popover to open (async .then() callback)
      await vi.waitFor(() => {
        expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      });

      // Grip should be expanded (16px height) while popover is open
      expect(grip.style.height).toBe('16px');
      // Width stays constant
      expect(grip.style.width).toBe('24px');
    });

    it('row grip remains at expanded size (16px width) while popover is open', async () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      // Click the grip to open popover
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 20,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Wait for popover to open
      await vi.waitFor(() => {
        expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      });

      // Grip should be expanded (16px width) while popover is open
      expect(grip.style.width).toBe('16px');
      // Height stays constant
      expect(grip.style.height).toBe('20px');
    });

    it('grip with popover stays visible when setGripsDisplay(false) is called', async () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
        onGripClick: () => {
          // Simulate what the real app does: when a grip is clicked,
          // cell selection happens and calls setGripsDisplay(false)
          controls.setGripsDisplay(false);
        },
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const activeGrip = colGrips[0];
      const otherGrip = colGrips[1];

      // Click the grip to open popover
      activeGrip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Wait for popover to open
      await vi.waitFor(() => {
        expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      });

      // The grip with the popover should still be visible (not display:none)
      expect(activeGrip.style.display).not.toBe('none');
      // Other grips should be hidden
      expect(otherGrip.style.display).toBe('none');
    });
  });

  describe('grip styling (original behavior)', () => {
    it('row grips do not have position: relative (no pseudo-element hit area expansion)', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);
      const grip = rowGrips[0];

      // Original behavior: no position: relative (pseudo-element approach removed)
      expect(grip.style.position).not.toBe('relative');
    });

    it('column grips do not have position: relative (no pseudo-element hit area expansion)', () => {
      grid = createGrid(2, 2);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const grip = colGrips[0];

      // Original behavior: no position: relative (pseudo-element approach removed)
      expect(grip.style.position).not.toBe('relative');
    });
  });
});
