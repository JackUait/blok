import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRowColControls } from '../../../../src/tools/table/table-row-col-controls';

const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const GRIP_VISIBLE_ATTR = 'data-blok-table-grip-visible';
const HIDE_DELAY_MS = 150;

/**
 * Create a minimal grid element with rows and cells for testing.
 * Mocks offsetWidth/offsetHeight/offsetTop so grip positioning works.
 * Stamps CELL_COL_ATTR and CELL_ROW_ATTR so getCellPosition() reads logical indices.
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
      cell.setAttribute(CELL_COL_ATTR, String(c));
      cell.setAttribute(CELL_ROW_ATTR, String(r));
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

const simulateMouseEnter = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseenter', { bubbles: false });

  element.dispatchEvent(event);
};

const simulateMouseLeave = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseleave', { bubbles: false });

  element.dispatchEvent(event);
};

const simulateMouseOver = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseover', { bubbles: true });

  element.dispatchEvent(event);
};

describe('TableRowColControls', () => {
  let grid: HTMLElement;
  let controls: TableRowColControls;

  const mockI18n = {
    t: vi.fn((key: string) => key),
    has: vi.fn(() => false),
    getEnglishTranslation: vi.fn((key: string) => key),
    getLocale: vi.fn(() => 'en'),
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

      simulateMouseOver(cell);

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

      simulateMouseOver(cell);

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

      simulateMouseOver(cell);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      expect(isGripVisible(colGrips[0])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(true);

      // Mouse leaves grid
      simulateMouseLeave(grid);
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
      simulateMouseOver(getCell(grid, 0, 0));

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      expect(isGripVisible(colGrips[0])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(true);

      // Hover cell (1,1) — different row AND column
      simulateMouseOver(getCell(grid, 1, 1));

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

    it('centers row grip on the full height of a rowspan=3 merged cell, not just the first row', () => {
      // Create a 3-row, 2-col table where cell [0,0] spans all 3 rows.
      // Each row is 40px tall, so the merged cell BCR height = 3 * 40 = 120px,
      // and the grip for row 0 should be at the center: 0 + 120/2 = 60px.
      const rowCount = 3;
      const rowHeight = 40;

      // Merged cell BCR: top=0 (matches the table in viewport), height=120 (3 * 40)
      // Table/container BCR: top=0
      const mergedCellBCR = { top: 0, height: 120, left: 0, width: 100, right: 100, bottom: 120 };
      const containerBCR = { top: 0, height: 120, left: 0, width: 200, right: 200, bottom: 120 };

      const table = document.createElement('table');
      const tbody = document.createElement('tbody');

      table.appendChild(tbody);
      table.getBoundingClientRect = vi.fn().mockReturnValue(containerBCR);

      let originCellEl: HTMLTableCellElement | null = null;

      for (let r = 0; r < rowCount; r++) {
        const tr = document.createElement('tr');

        tr.setAttribute(ROW_ATTR, '');
        Object.defineProperty(tr, 'offsetTop', { value: r * rowHeight, configurable: true });
        Object.defineProperty(tr, 'offsetHeight', { value: rowHeight, configurable: true });

        if (r === 0) {
          // Origin cell spanning all 3 rows
          const originCell = document.createElement('td');

          originCell.setAttribute(CELL_ATTR, '');
          originCell.setAttribute(CELL_ROW_ATTR, '0');
          originCell.setAttribute(CELL_COL_ATTR, '0');
          originCell.rowSpan = rowCount;
          originCell.getBoundingClientRect = vi.fn().mockReturnValue(mergedCellBCR);
          originCellEl = originCell;
          tr.appendChild(originCell);

          // Second column cell (non-merged)
          const cell2 = document.createElement('td');

          cell2.setAttribute(CELL_ATTR, '');
          cell2.setAttribute(CELL_ROW_ATTR, '0');
          cell2.setAttribute(CELL_COL_ATTR, '1');
          tr.appendChild(cell2);
        } else {
          // Rows 1 and 2: only have the second column cell (first column is spanned)
          const cell2 = document.createElement('td');

          cell2.setAttribute(CELL_ATTR, '');
          cell2.setAttribute(CELL_ROW_ATTR, String(r));
          cell2.setAttribute(CELL_COL_ATTR, '1');
          tr.appendChild(cell2);
        }

        tbody.appendChild(tr);
      }

      grid = table as unknown as HTMLElement;
      document.body.appendChild(grid);

      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 2,
        getRowCount: () => rowCount,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Row 0 grip: center of the merged cell BCR relative to container
      // = mergedCellBCR.top(0) - containerBCR.top(0) + mergedCellBCR.height(120)/2 = 60px
      expect(rowGrips[0].style.top).toBe('60px');

      // Row 1 grip (non-merged): center of just its own row: 40 + 40/2 = 60px
      expect(rowGrips[1].style.top).toBe('60px');

      // Row 2 grip (non-merged): center of just its own row: 80 + 40/2 = 100px
      expect(rowGrips[2].style.top).toBe('100px');
    });

    it('centers row grip using getBoundingClientRect when merged cell content is taller than individual row heights', () => {
      // Simulate the real-browser scenario:
      //   - 3 rows, each with offsetHeight=31 (browser minimum per-row height)
      //   - But the td[rowspan=3] has actual rendered height=93px (browser distributed the height)
      //   - The grip for row 0 should be at 93/2 = 46.5px (center of the merged cell's BCR)
      //     relative to the overlay, NOT at 0 + (31+31+31)/2 = 46.5px... wait, those happen to be equal.
      //   - Use a more realistic case: rows at offsetTop 10/41/72, merged cell BCR top=10, height=124
      //     expected center = 10 - 0 + 124/2 = 72 (relative to overlay top=0)
      const rowCount = 3;
      const rowOffsets = [10, 41, 72];
      const rowHeight = 31;

      // Merged cell BCR: top=10 (matches row 0 in viewport), height=124 (taller than 3*31=93)
      const mergedCellBCR = { top: 10, height: 124, left: 0, width: 100, right: 100, bottom: 134 };
      // Overlay BCR: top=10 (overlay starts at same y as the table in viewport)
      const overlayBCR = { top: 10, height: 200, left: 0, width: 200, right: 200, bottom: 210 };

      // Expected center Y relative to overlay: mergedCellBCR.top - overlayBCR.top + mergedCellBCR.height/2
      // = 10 - 10 + 124/2 = 62
      const expectedCenterY = 62;

      const table = document.createElement('table');
      const tbody = document.createElement('tbody');

      table.appendChild(tbody);

      let originCellEl: HTMLTableCellElement | null = null;

      for (let r = 0; r < rowCount; r++) {
        const tr = document.createElement('tr');

        tr.setAttribute(ROW_ATTR, '');
        Object.defineProperty(tr, 'offsetTop', { value: rowOffsets[r], configurable: true });
        Object.defineProperty(tr, 'offsetHeight', { value: rowHeight, configurable: true });

        if (r === 0) {
          const originCell = document.createElement('td');

          originCell.setAttribute(CELL_ATTR, '');
          originCell.setAttribute(CELL_ROW_ATTR, '0');
          originCell.setAttribute(CELL_COL_ATTR, '0');
          originCell.rowSpan = rowCount;
          originCellEl = originCell;
          tr.appendChild(originCell);

          const cell2 = document.createElement('td');

          cell2.setAttribute(CELL_ATTR, '');
          cell2.setAttribute(CELL_ROW_ATTR, '0');
          cell2.setAttribute(CELL_COL_ATTR, '1');
          tr.appendChild(cell2);
        } else {
          const cell2 = document.createElement('td');

          cell2.setAttribute(CELL_ATTR, '');
          cell2.setAttribute(CELL_ROW_ATTR, String(r));
          cell2.setAttribute(CELL_COL_ATTR, '1');
          tr.appendChild(cell2);
        }

        tbody.appendChild(tr);
      }

      // Create an overlay div and mock its getBoundingClientRect
      const overlay = document.createElement('div');

      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.getBoundingClientRect = vi.fn().mockReturnValue(overlayBCR);

      // Mock getBoundingClientRect on the origin cell
      if (originCellEl) {
        originCellEl.getBoundingClientRect = vi.fn().mockReturnValue(mergedCellBCR);
      }

      grid = table as unknown as HTMLElement;
      document.body.appendChild(grid);

      controls = new TableRowColControls({
        grid,
        overlay,
        getColumnCount: () => 2,
        getRowCount: () => rowCount,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      // Grips are appended to the overlay when overlay is provided
      const rowGrips = overlay.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // Row 0 grip: should use BCR of the origin cell relative to the overlay
      // mergedCellBCR.top(10) - overlayBCR.top(10) + mergedCellBCR.height(124)/2 = 62
      expect(rowGrips[0].style.top).toBe(`${expectedCenterY}px`);

      // Row 1 grip (non-merged): should still use offsetTop + offsetHeight/2
      // = 41 + 31/2 = 56.5px
      expect(rowGrips[1].style.top).toBe('56.5px');

      // Row 2 grip (non-merged): 72 + 31/2 = 87.5px
      expect(rowGrips[2].style.top).toBe('87.5px');
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

      simulateMouseEnter(grip);

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

      simulateMouseEnter(grip);
      simulateMouseLeave(grip);

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

      simulateMouseEnter(grip);

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

      simulateMouseEnter(grip);
      simulateMouseLeave(grip);

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

      simulateMouseOver(cell);
      expect(isGripVisible(grip)).toBe(true);
      // Column grip starts at idle height (4px)
      expect(grip.style.height).toBe('4px');

      // Hover the grip (expand) — height expands to 16px
      simulateMouseEnter(grip);
      expect(grip.style.height).toBe('16px');

      // Leave the grip (collapse) — height returns to idle (4px)
      simulateMouseLeave(grip);
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

      simulateMouseEnter(grip);
      expect(grip.style.width).toBe('24px');

      simulateMouseLeave(grip);
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

      simulateMouseEnter(grip);
      expect(grip.style.height).toBe('20px');

      simulateMouseLeave(grip);
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
      simulateMouseOver(getCell(grid, 0, 0));

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

    it('grip stays visible after refresh() is called while popover is open', async () => {
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

      const colGripsBefore = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const firstGrip = colGripsBefore[0];

      // Click the first column grip to open popover
      firstGrip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 50,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Wait for popover to open
      await vi.waitFor(() => {
        expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      });

      // Verify grip is active before refresh
      expect(isGripVisible(firstGrip)).toBe(true);

      // Simulate what handleRowColAction does: call refresh() while popover is open.
      // This is triggered by heading toggle click in the real app.
      controls.refresh();

      // After refresh(), new grips are created. The grip at index 0 should
      // still be visible with active classes since the popover is still open.
      const colGripsAfter = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const newFirstGrip = colGripsAfter[0];

      expect(newFirstGrip).not.toBe(firstGrip); // Must be a new DOM element
      expect(isGripVisible(newFirstGrip)).toBe(true);
      expect(newFirstGrip.className).toContain('bg-blue-500');
      expect(newFirstGrip.className).toContain('opacity-100');
    });

    it('grip stays visible when setGripsDisplay(false) then setGripsDisplay(true) is called during onGripClick', async () => {
      grid = createGrid(3, 3);
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 3,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
        onGripClick: () => {
          // Simulate the real index.ts flow:
          // onSelectionActiveChange(true) → setGripsDisplay(false)
          controls.setGripsDisplay(false);
          // onSelectionRangeChange → setGripsDisplay(true)
          controls.setGripsDisplay(true);
        },
      });

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);
      const activeGrip = colGrips[1];

      // Click the grip to open popover
      activeGrip.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 150,
        clientY: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Wait for popover to open
      await vi.waitFor(() => {
        expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      });

      // The grip must still be visible (active classes, not hidden)
      expect(activeGrip.style.display).not.toBe('none');
      expect(isGripVisible(activeGrip)).toBe(true);
      expect(activeGrip.className).toContain('opacity-100');
    });
  });

  describe('grip entry animation', () => {
    it('skips opacity transition when switching grips while already inside table', () => {
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

      // First hover: mouse enters table — grips appear (with transition)
      simulateMouseOver(getCell(grid, 0, 0));

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // Set up spy: when the code reads offsetHeight for reflow,
      // capture the transition value at that moment
      let transitionDuringReflow = '';

      Object.defineProperty(colGrips[1], 'offsetHeight', {
        get: () => {
          transitionDuringReflow = colGrips[1].style.transition;

          return 0;
        },
        configurable: true,
      });

      // Second hover: move to different column (still inside table)
      simulateMouseOver(getCell(grid, 0, 1));

      // During the reflow, transition should have been 'none' (animation bypassed)
      expect(transitionDuringReflow).toBe('none');
      // After operation, transition should be restored
      expect(colGrips[1].style.transition).toBe('');
    });

    it('skips opacity transition on the old grip when switching cells', () => {
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

      // First hover: mouse enters table
      simulateMouseOver(getCell(grid, 0, 0));

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // Spy on old grip: capture transition value during reflow
      let transitionDuringReflow = '';

      Object.defineProperty(colGrips[0], 'offsetHeight', {
        get: () => {
          transitionDuringReflow = colGrips[0].style.transition;

          return 0;
        },
        configurable: true,
      });

      // Move to different column — old grip (col 0) should hide without animation
      simulateMouseOver(getCell(grid, 0, 1));

      expect(transitionDuringReflow).toBe('none');
      expect(colGrips[0].style.transition).toBe('');
    });

    it('restores transition after mouse leaves and re-enters the table', () => {
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

      // Enter table
      simulateMouseOver(getCell(grid, 0, 0));

      // Leave table and wait for hide delay
      simulateMouseLeave(grid);
      vi.advanceTimersByTime(HIDE_DELAY_MS + 10);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // Set up spy: on re-entry, offsetHeight should NOT be read
      // (because we're entering fresh, transition should play normally)
      let offsetHeightRead = false;

      Object.defineProperty(colGrips[0], 'offsetHeight', {
        get: () => {
          offsetHeightRead = true;

          return 0;
        },
        configurable: true,
      });

      // Re-enter table — should animate (not bypass transition)
      simulateMouseOver(getCell(grid, 0, 0));

      expect(offsetHeightRead).toBe(false);
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

  describe('getCellPosition with merged cells', () => {
    /**
     * Build a 3-column grid where row 1 has a colspan=2 origin cell at logical
     * col 0 (spanning cols 0–1) and a regular cell at logical col 2.
     *
     * DOM structure:
     *   Row 0: <td col=0> <td col=1> <td col=2>   (3 physical cells)
     *   Row 1: <td col=0 colspan=2> <td col=2>    (2 physical cells, logical cols 0 and 2)
     *
     * The bug: hovering the last cell in row 1 returns physical index 1,
     * which activates colGrip[1] instead of the correct colGrip[2].
     */
    const createMergedGrid = (): HTMLElement => {
      const grid = document.createElement('div');

      grid.style.position = 'relative';

      // Row 0 — 3 regular cells at logical cols 0, 1, 2
      const row0 = document.createElement('div');

      row0.setAttribute(ROW_ATTR, '');
      Object.defineProperty(row0, 'offsetTop', { value: 0, configurable: true });
      Object.defineProperty(row0, 'offsetHeight', { value: 40, configurable: true });

      for (let c = 0; c < 3; c++) {
        const cell = document.createElement('div');

        cell.setAttribute(CELL_ATTR, '');
        cell.setAttribute(CELL_COL_ATTR, String(c));
        cell.setAttribute(CELL_ROW_ATTR, '0');
        Object.defineProperty(cell, 'offsetWidth', { value: 100, configurable: true });
        row0.appendChild(cell);
      }

      // Row 1 — colspan=2 origin at logical col 0, then regular cell at logical col 2
      const row1 = document.createElement('div');

      row1.setAttribute(ROW_ATTR, '');
      Object.defineProperty(row1, 'offsetTop', { value: 40, configurable: true });
      Object.defineProperty(row1, 'offsetHeight', { value: 40, configurable: true });

      const mergedCell = document.createElement('div');

      mergedCell.setAttribute(CELL_ATTR, '');
      mergedCell.setAttribute(CELL_COL_ATTR, '0');
      mergedCell.setAttribute(CELL_ROW_ATTR, '1');
      Object.defineProperty(mergedCell, 'offsetWidth', { value: 200, configurable: true });
      row1.appendChild(mergedCell);

      const lastCell = document.createElement('div');

      lastCell.setAttribute(CELL_ATTR, '');
      lastCell.setAttribute(CELL_COL_ATTR, '2');
      lastCell.setAttribute(CELL_ROW_ATTR, '1');
      Object.defineProperty(lastCell, 'offsetWidth', { value: 100, configurable: true });
      row1.appendChild(lastCell);

      grid.appendChild(row0);
      grid.appendChild(row1);
      document.body.appendChild(grid);

      return grid;
    };

    it('shows the correct column grip (logical col 2) when hovering a cell after a colspan=2 cell', () => {
      grid = createMergedGrid();
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      // The last cell in row 1 is at physical index 1, but logical col 2.
      // Hovering it should activate colGrip[2], not colGrip[1].
      const row1 = grid.querySelectorAll(`[${ROW_ATTR}]`)[1];
      const cells = row1.querySelectorAll(`[${CELL_ATTR}]`);
      const lastCellInRow1 = cells[1] as HTMLElement; // physical index 1, logical col 2

      simulateMouseOver(lastCellInRow1);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // colGrip[2] must be visible — the logical column of lastCellInRow1
      expect(isGripVisible(colGrips[2])).toBe(true);
      // colGrip[1] must NOT be visible — the (wrong) physical index
      expect(isGripVisible(colGrips[1])).toBe(false);
    });

    it('shows the correct row grip (logical row 1) when hovering a cell in a merged row', () => {
      grid = createMergedGrid();
      controls = new TableRowColControls({
        grid,
        getColumnCount: () => 3,
        getRowCount: () => 2,
        isHeadingRow: () => false,
        isHeadingColumn: () => false,
        onAction: vi.fn(),
        i18n: mockI18n,
      });

      const row1 = grid.querySelectorAll(`[${ROW_ATTR}]`)[1];
      const cells = row1.querySelectorAll(`[${CELL_ATTR}]`);
      const lastCellInRow1 = cells[1] as HTMLElement;

      simulateMouseOver(lastCellInRow1);

      const rowGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`);

      // rowGrip[1] should be visible — the logical row of row1
      expect(isGripVisible(rowGrips[1])).toBe(true);
      expect(isGripVisible(rowGrips[0])).toBe(false);
    });
  });

  describe('setActiveGrip', () => {
    it('cancels pending scheduleHideAll timer when locking a grip', () => {
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

      // Hover a cell to show grips, then leave to start scheduleHideAll
      simulateMouseOver(getCell(grid, 0, 0));
      simulateMouseLeave(grid);

      // scheduleHideAll is now pending (150ms timer)
      // Lock a grip before the timer fires
      controls.setActiveGrip('col', 1);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      expect(isGripVisible(colGrips[1])).toBe(true);

      // Advance past the scheduleHideAll delay — the timer should have been cancelled
      vi.advanceTimersByTime(HIDE_DELAY_MS + 50);

      // The locked grip must still be visible (timer was cancelled by setActiveGrip)
      expect(isGripVisible(colGrips[1])).toBe(true);
    });

    it('registers pointerdown unlock listener synchronously', () => {
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

      controls.setActiveGrip('col', 1);

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      expect(isGripVisible(colGrips[1])).toBe(true);

      // Dispatch pointerdown on document WITHOUT advancing RAF timers.
      // If the listener is registered synchronously, it should fire immediately.
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // The grip should now be unlocked and hidden
      expect(isGripVisible(colGrips[1])).toBe(false);
    });

    it('does not block hover after grip is unlocked by clicking outside', () => {
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

      // Lock a grip
      controls.setActiveGrip('col', 1);

      // Unlock by clicking outside (pointerdown on document)
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // Now hover a cell — grips should respond
      simulateMouseOver(getCell(grid, 0, 2));

      const colGrips = grid.querySelectorAll<HTMLElement>(`[${GRIP_COL_ATTR}]`);

      // Column grip 2 should be visible (not blocked by stale lock)
      expect(isGripVisible(colGrips[2])).toBe(true);
    });
  });
});
