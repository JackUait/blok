import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const SELECTED_ATTR = 'data-blok-table-cell-selected';
const OVERLAY_ATTR = 'data-blok-table-selection-overlay';
const PILL_ATTR = 'data-blok-table-selection-pill';

interface MockPopoverItem {
  onActivate?: () => void;
  icon?: string;
  title?: string;
}

interface MockPopoverArgs {
  items?: MockPopoverItem[];
  trigger?: HTMLElement;
  flippable?: boolean;
}

const mockPopoverShow = vi.fn();
const mockPopoverDestroy = vi.fn();
let lastPopoverArgs: MockPopoverArgs | null = null;

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    constructor(args: MockPopoverArgs) {
      lastPopoverArgs = args;
    }
    show = mockPopoverShow;
    destroy = mockPopoverDestroy;
    on(_event: string, _handler: () => void): void {
      // no-op for tests
    }
  },
}));

vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: {
    Closed: 'closed',
  },
}));

import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';

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

/**
 * Simulate pointer entering an element (hover).
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateHover = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseenter', { bubbles: true });

  element.dispatchEvent(event);
};

/**
 * Simulate pointer leaving an element (unhover).
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateUnhover = (element: HTMLElement): void => {
  const event = new MouseEvent('mouseleave', { bubbles: true });

  element.dispatchEvent(event);
};

/**
 * Simulate a mousemove event on the document.
 * Wraps dispatchEvent in a semantic helper to express user intent.
 */
const simulateDocumentMouseMove = (options: { clientX: number; clientY: number }): void => {
  const event = new MouseEvent('mousemove', {
    clientX: options.clientX,
    clientY: options.clientY,
    bubbles: true,
  });

  document.dispatchEvent(event);
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

  const mockI18n = {
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'tools.table.clearSelection': 'Clear',
      };

      return translations[key] || key;
    }),
    has: vi.fn(() => false),
    getEnglishTranslation: vi.fn((key: string) => key),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    elementFromPointTarget = null;
    lastPopoverArgs = null;

    // jsdom doesn't define elementFromPoint; provide a stub
    document.elementFromPoint = (_x: number, _y: number) => elementFromPointTarget;

    grid = createGrid(3, 3);
    mockBoundingRects(grid);
    selection = new TableCellSelection({ grid, i18n: mockI18n });
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

  describe('onSelectionActiveChange callback', () => {
    it('fires true when drag selection starts', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      simulateDrag(grid, 0, 0, 1, 1);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('does not fire false when drag ends but selection persists', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      simulateDrag(grid, 0, 0, 1, 1);

      // Should have been called once with true, never with false
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).not.toHaveBeenCalledWith(false);
    });

    it('fires false when selection is cleared by click-away', () => {
      vi.useFakeTimers();

      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      simulateDrag(grid, 0, 0, 1, 1);

      // Flush the rAF that registers the clear listener
      vi.runAllTimers();

      callback.mockClear();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      vi.useRealTimers();

      expect(callback).toHaveBeenCalledWith(false);
    });

    it('fires true for programmatic selectRow', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      selection.selectRow(1);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('fires true for programmatic selectColumn', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      selection.selectColumn(0);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('fires false when programmatic selection is cleared by click-away', () => {
      vi.useFakeTimers();

      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      selection.selectRow(0);

      // Flush the rAF that registers the clear listener
      vi.runAllTimers();

      callback.mockClear();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      vi.useRealTimers();

      expect(callback).toHaveBeenCalledWith(false);
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

  describe('selection pill', () => {
    it('creates a pill element when drag selection is made', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`);

      expect(pill).not.toBeNull();
    });

    it('creates a pill element for programmatic selectRow', () => {
      selection.selectRow(1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`);

      expect(pill).not.toBeNull();
    });

    it('creates a pill element for programmatic selectColumn', () => {
      selection.selectColumn(0);

      const pill = grid.querySelector(`[${PILL_ATTR}]`);

      expect(pill).not.toBeNull();
    });

    it('positions pill centered on the right edge of the overlay', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      // Overlay: top=-1, left=-1, width=201, height=81
      // Pill is positioned at center point; translate(-50%,-50%) handles centering
      // left = -1 + 201 - 1 = 199 (border midpoint)
      // top = -1 + 81/2 = 39.5
      expect(pill.style.left).toBe('199px');
      expect(pill.style.top).toBe('39.5px');
    });

    it('pill starts with idle width', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      expect(pill.style.width).toBe('4px');
      expect(pill.style.transform).toBe('translate(-50%, -50%)');
    });

    it('pill expands on mouseenter and collapses on mouseleave', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      simulateHover(pill);

      expect(pill.style.width).toBe('16px');

      simulateUnhover(pill);

      expect(pill.style.width).toBe('4px');
    });

    it('pill has pointer-events auto so it is clickable', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      expect(pill.style.pointerEvents).toBe('auto');
    });

    it('removes pill on click-away clear', () => {
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      expect(grid.querySelector(`[${PILL_ATTR}]`)).not.toBeNull();

      vi.runAllTimers();

      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      vi.useRealTimers();

      expect(grid.querySelector(`[${PILL_ATTR}]`)).toBeNull();
    });

    it('removes pill on destroy', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      expect(grid.querySelector(`[${PILL_ATTR}]`)).not.toBeNull();

      selection.destroy();

      expect(grid.querySelector(`[${PILL_ATTR}]`)).toBeNull();
    });

    it('clicking pill does not clear the selection', () => {
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      vi.useRealTimers();

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`).length).toBeGreaterThan(0);
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).not.toBeNull();
    });

    it('clicking pill opens PopoverDesktop with Clear item', () => {
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      vi.useRealTimers();

      expect(lastPopoverArgs).not.toBeNull();
      expect(lastPopoverArgs?.items).toHaveLength(1);
      expect(lastPopoverArgs?.items?.[0]?.title).toBe('Clear');
      expect(mockPopoverShow).toHaveBeenCalled();
    });

    it('fires onClearContent with selected cells when Clear action activates', () => {
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
      });

      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      const items = lastPopoverArgs?.items;

      items?.[0]?.onActivate?.();

      vi.useRealTimers();

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(4);
    });

    it('does not clear selection when pointerdown fires on popover item before onActivate', () => {
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
      });

      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      // Simulate the real browser flow: clicking a popover item fires pointerdown
      // on the document before the click/onActivate handler runs.
      // The popover is rendered outside the pill, so this pointerdown would
      // normally trigger handleClearSelection and empty selectedCells.
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      const items = lastPopoverArgs?.items;

      items?.[0]?.onActivate?.();

      vi.useRealTimers();

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(4);
    });

    it('clears selection after Clear action fires', () => {
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
      });

      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      lastPopoverArgs?.items?.[0]?.onActivate?.();

      vi.useRealTimers();

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(0);
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).toBeNull();
      expect(grid.querySelector(`[${PILL_ATTR}]`)).toBeNull();
    });
  });

  describe('overlay positioning', () => {
    it('positions overlay to cover the selected cells', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Grid starts at (10, 10). Cell (0,0) top-left is (10, 10).
      // Cell (1,1) bottom-right is (10 + 2*100, 10 + 2*40) = (210, 90).
      // Overlay extends 1px outward on top and left to cover adjacent borders.
      expect(overlay.style.top).toBe('-1px');
      expect(overlay.style.left).toBe('-1px');
      expect(overlay.style.width).toBe('201px');
      expect(overlay.style.height).toBe('81px');
    });

    it('positions overlay correctly for non-origin selection', () => {
      simulateDrag(grid, 1, 1, 2, 2);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Cell (1,1) top-left: (10 + 100, 10 + 40) = (110, 50) relative to page.
      // Grid top-left: (10, 10).
      // Base: top = 50 - 10 = 40, left = 110 - 10 = 100.
      // Extends 1px outward: top = 39, left = 99, width = 201, height = 81.
      expect(overlay.style.top).toBe('39px');
      expect(overlay.style.left).toBe('99px');
      expect(overlay.style.width).toBe('201px');
      expect(overlay.style.height).toBe('81px');
    });

    it('extends overlay to cover adjacent borders including grid border', () => {
      // Simulate a real browser where grid has 1px borders and cells start
      // 1px inside the grid's border-box.
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

      // Base: top = (10+1) - 10 - 1 = 0. Extended: 0 - 1 = -1.
      // Base: left = (10+1) - 10 - 1 = 0. Extended: 0 - 1 = -1.
      // width = 200 + 1 = 201, height = 80 + 1 = 81.
      expect(overlay.style.top).toBe('-1px');
      expect(overlay.style.left).toBe('-1px');
      expect(overlay.style.width).toBe('201px');
      expect(overlay.style.height).toBe('81px');
    });

    it('extends overlay for non-edge selection too', () => {
      const gridLeft = 10;
      const gridTop = 10;
      const borderWidth = 1;
      const cellWidth = 100;
      const cellHeight = 40;

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

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '1px',
        borderLeftWidth: '1px',
      } as CSSStyleDeclaration);

      // Select cells (1,1) to (2,2) — not touching row 0 or col 0
      simulateDrag(grid, 1, 1, 2, 2);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`) as HTMLElement;

      // Base: top = (10+1+40) - 10 - 1 = 40. Extended: 40 - 1 = 39.
      // Base: left = (10+1+100) - 10 - 1 = 100. Extended: 100 - 1 = 99.
      // width = 200 + 1 = 201, height = 80 + 1 = 81.
      expect(overlay.style.top).toBe('39px');
      expect(overlay.style.left).toBe('99px');
      expect(overlay.style.width).toBe('201px');
      expect(overlay.style.height).toBe('81px');
    });
  });

  describe('RectangleSelection integration', () => {
    it('accepts rectangleSelection in constructor', () => {
      const mockRectangleSelection = {
        cancelActiveSelection: vi.fn(),
      };

      const selectionWithRef = new TableCellSelection({
        grid,
        i18n: mockI18n,
        rectangleSelection: mockRectangleSelection,
      });

      expect(selectionWithRef).toBeDefined();
    });

    it('works without rectangleSelection (backward compatibility)', () => {
      const selectionWithoutRef = new TableCellSelection({
        grid,
        i18n: mockI18n,
      });

      expect(selectionWithoutRef).toBeDefined();
    });

    it('cancels RectangleSelection when drag enters table cell from outside', () => {
      const mockRectangleSelection = {
        cancelActiveSelection: vi.fn(),
      };

      const selectionWithCapture = new TableCellSelection({
        grid,
        i18n: mockI18n,
        rectangleSelection: mockRectangleSelection,
      });

      // Create mock overlay element (simulates active RectangleSelection)
      const overlay = document.createElement('div');

      overlay.setAttribute('data-blok-overlay-rectangle', '');
      overlay.style.display = 'block';
      document.body.appendChild(overlay);

      try {
        // Get first cell
        const cell = grid.querySelector('[data-blok-table-cell]') as HTMLElement;
        const cellRect = cell.getBoundingClientRect();

        // Simulate pointerdown in cell (sets anchor)
        const downEvent = new PointerEvent('pointerdown', {
          clientX: cellRect.left + 10,
          clientY: cellRect.top + 10,
          bubbles: true,
          button: 0,
        });

        Object.defineProperty(downEvent, 'target', { value: cell, configurable: true });
        grid.dispatchEvent(downEvent);

        // Mock elementFromPoint to return a different cell
        const cell2 = grid.querySelectorAll('[data-blok-table-cell]')[1] as HTMLElement;
        const originalElementFromPoint = document.elementFromPoint;

        document.elementFromPoint = vi.fn().mockReturnValue(cell2);

        // Simulate mousemove to different cell (should trigger capture phase handler)
        simulateDocumentMouseMove({ clientX: cellRect.left + 100, clientY: cellRect.top + 10 });

        // Also dispatch pointermove for the actual cell selection logic
        const pointerMoveEvent = new PointerEvent('pointermove', {
          clientX: cellRect.left + 100,
          clientY: cellRect.top + 10,
          bubbles: true,
        });

        document.dispatchEvent(pointerMoveEvent);

        // Verify cancelActiveSelection was called
        expect(mockRectangleSelection.cancelActiveSelection).toHaveBeenCalled();

        // Verify the rectangle overlay was hidden (observable DOM state change)
        expect(overlay.style.display).toBe('none');

        // Cleanup
        document.elementFromPoint = originalElementFromPoint;
        selectionWithCapture.destroy();
      } finally {
        overlay.remove();
      }
    });

    it('does not cancel RectangleSelection if no overlay visible', () => {
      const mockRectangleSelection = {
        cancelActiveSelection: vi.fn(),
      };

      const selectionNoOverlay = new TableCellSelection({
        grid,
        i18n: mockI18n,
        rectangleSelection: mockRectangleSelection,
      });

      // No overlay element created

      const cell = grid.querySelector('[data-blok-table-cell]') as HTMLElement;
      const cellRect = cell.getBoundingClientRect();

      const downEvent = new PointerEvent('pointerdown', {
        clientX: cellRect.left + 10,
        clientY: cellRect.top + 10,
        bubbles: true,
        button: 0,
      });

      Object.defineProperty(downEvent, 'target', { value: cell, configurable: true });
      grid.dispatchEvent(downEvent);

      const cell2 = grid.querySelectorAll('[data-blok-table-cell]')[1] as HTMLElement;

      document.elementFromPoint = vi.fn().mockReturnValue(cell2);

      const moveEvent = new PointerEvent('pointermove', {
        clientX: cellRect.left + 100,
        clientY: cellRect.top + 10,
        bubbles: true,
      });

      document.dispatchEvent(moveEvent);

      // Should NOT cancel if no overlay
      expect(mockRectangleSelection.cancelActiveSelection).not.toHaveBeenCalled();

      selectionNoOverlay.destroy();
    });
  });

  describe('keyboard handling', () => {
    it('clears selected cells on Delete key', () => {
      const onClearContent = vi.fn();
      const onSelectionActiveChange = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
        onSelectionActiveChange,
      });

      // Programmatically select row 0 (3 cells)
      selection.selectRow(0);

      // Dispatch Delete key to document
      const deleteEvent = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(deleteEvent, 'preventDefault');

      document.dispatchEvent(deleteEvent);

      // Verify onClearContent called with array of 3 cells
      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(3);

      // Verify onSelectionActiveChange called with false (selection dismissed)
      expect(onSelectionActiveChange).toHaveBeenCalledWith(false);

      // Verify preventDefault called
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('clears selected cells on Backspace key', () => {
      const onClearContent = vi.fn();
      const onSelectionActiveChange = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
        onSelectionActiveChange,
      });

      // Programmatically select row 0 (3 cells)
      selection.selectRow(0);

      // Dispatch Backspace key to document
      const backspaceEvent = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(backspaceEvent, 'preventDefault');

      document.dispatchEvent(backspaceEvent);

      // Verify onClearContent called with array of 3 cells
      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(3);

      // Verify onSelectionActiveChange called with false (selection dismissed)
      expect(onSelectionActiveChange).toHaveBeenCalledWith(false);

      // Verify preventDefault called
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('does not clear when no selection is active', () => {
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
      });

      // Do NOT select any cells

      // Dispatch Delete key
      const deleteEvent = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(deleteEvent);

      // Verify onClearContent NOT called
      expect(onClearContent).not.toHaveBeenCalled();
    });

    it('does not clear for other keys', () => {
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onClearContent,
      });

      // Select cells
      selection.selectRow(0);

      // Dispatch Enter key
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(enterEvent);

      // Verify onClearContent NOT called
      expect(onClearContent).not.toHaveBeenCalled();
    });
  });

  describe('pill styling (original behavior)', () => {
    it('pill does not have position: relative (no pseudo-element hit area expansion)', () => {
      simulateDrag(grid, 0, 0, 1, 1);

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      // Original behavior: no position: relative (pseudo-element approach removed)
      expect(pill.style.position).not.toBe('relative');
    });
  });

});

