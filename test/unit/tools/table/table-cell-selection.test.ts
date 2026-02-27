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
  secondaryLabel?: string;
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
    private el = document.createElement('div');
    constructor(args: MockPopoverArgs) {
      lastPopoverArgs = args;
    }
    show = mockPopoverShow;
    destroy = mockPopoverDestroy;
    on(_event: string, _handler: () => void): void {
      // no-op for tests
    }
    getElement(): HTMLElement {
      return this.el;
    }
  },
  PopoverItemType: {
    Default: 'default',
    Separator: 'separator',
    Html: 'html',
  },
}));

vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: {
    Closed: 'closed',
  },
}));

const mockColorPickerElement = document.createElement('div');

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: () => ({ element: mockColorPickerElement }),
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
        'tools.table.copySelection': 'Copy',
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

    it('clicking pill opens PopoverDesktop with Copy and Clear items', () => {
      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      vi.useRealTimers();

      expect(lastPopoverArgs).not.toBeNull();
      expect(lastPopoverArgs?.items).toHaveLength(2);
      expect(lastPopoverArgs?.items?.[0]?.title).toBe('Copy');
      expect(lastPopoverArgs?.items?.[0]?.secondaryLabel).toMatch(/[⌘C]|Ctrl\+C/);
      expect(lastPopoverArgs?.items?.[1]?.title).toBe('Clear');
      expect(lastPopoverArgs?.items?.[1]?.secondaryLabel).toBe('Del');
      expect(mockPopoverShow).toHaveBeenCalled();
    });

    it('fires onCopyViaButton with selected cells when Copy action activates', () => {
      const onCopyViaButton = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopyViaButton,
      });

      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      const items = lastPopoverArgs?.items;

      items?.[0]?.onActivate?.();

      vi.useRealTimers();

      expect(onCopyViaButton).toHaveBeenCalledTimes(1);
      expect(onCopyViaButton.mock.calls[0][0]).toHaveLength(4);
    });

    it('does not clear selection after Copy action activates', () => {
      const onCopyViaButton = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopyViaButton,
      });

      vi.useFakeTimers();

      simulateDrag(grid, 0, 0, 1, 1);

      vi.runAllTimers();

      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      lastPopoverArgs?.items?.[0]?.onActivate?.();

      vi.useRealTimers();

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`).length).toBeGreaterThan(0);
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).not.toBeNull();
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

      items?.[1]?.onActivate?.();

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

      // Clear is at index 1 (after Copy)
      items?.[1]?.onActivate?.();

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

      // Clear is at index 1 (after Copy)
      lastPopoverArgs?.items?.[1]?.onActivate?.();

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

  describe('copy/cut event handling', () => {
    /**
     * Helper to create a ClipboardEvent-like object that works in jsdom.
     * jsdom doesn't support DataTransfer in ClipboardEvent constructor,
     * so we create a plain Event and add clipboardData manually.
     */
    const createClipboardEvent = (type: 'copy' | 'cut'): { event: ClipboardEvent; clipboardData: DataTransfer; preventDefaultSpy: ReturnType<typeof vi.fn> } => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
      const clipboardData = { setData: vi.fn(), getData: vi.fn() } as unknown as DataTransfer;
      const preventDefaultSpy = vi.fn();

      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });

      return { event, clipboardData, preventDefaultSpy };
    };

    it('should call onCopy with selected cells and clipboardData on copy event', () => {
      const onCopy = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopy,
      });

      // Create a selection (row 0 = 3 cells)
      selection.selectRow(0);

      const { event, clipboardData } = createClipboardEvent('copy');

      document.dispatchEvent(event);

      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(onCopy.mock.calls[0][0]).toHaveLength(3);
      expect(onCopy.mock.calls[0][1]).toBe(clipboardData);
    });

    it('should not call onCopy when no selection is active', () => {
      const onCopy = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopy,
      });

      // Do NOT select anything

      const { event } = createClipboardEvent('copy');

      document.dispatchEvent(event);

      expect(onCopy).not.toHaveBeenCalled();
    });

    it('should call onCut and then onClearContent on cut event', () => {
      const onCut = vi.fn();
      const onClearContent = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCut,
        onClearContent,
      });

      // Create a selection (row 1 = 3 cells)
      selection.selectRow(1);

      const { event, clipboardData } = createClipboardEvent('cut');

      document.dispatchEvent(event);

      expect(onCut).toHaveBeenCalledTimes(1);
      expect(onCut.mock.calls[0][0]).toHaveLength(3);
      expect(onCut.mock.calls[0][1]).toBe(clipboardData);

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(3);
    });

    it('should prevent default on copy event and preserve selection', () => {
      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopy: vi.fn(),
      });

      selection.selectRow(0);

      const { event, preventDefaultSpy } = createClipboardEvent('copy');

      document.dispatchEvent(event);

      // Selection should still be active after copy (not cleared)
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).not.toBeNull();
      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(3);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should prevent default on cut event when selection is active', () => {
      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCut: vi.fn(),
      });

      selection.selectRow(0);

      const { event, preventDefaultSpy } = createClipboardEvent('cut');

      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      // Selection should be cleared after cut
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).toBeNull();
    });

    it('should clear selection after cut', () => {
      const onSelectionActiveChange = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCut: vi.fn(),
        onSelectionActiveChange,
      });

      selection.selectRow(0);

      onSelectionActiveChange.mockClear();

      const { event } = createClipboardEvent('cut');

      document.dispatchEvent(event);

      // Overlay and selected attributes should be removed
      expect(grid.querySelector(`[${OVERLAY_ATTR}]`)).toBeNull();
      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(0);
      expect(onSelectionActiveChange).toHaveBeenCalledWith(false);
    });

    it('should not call onCopy when clipboardData is null', () => {
      const onCopy = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopy,
      });

      selection.selectRow(0);

      // Create event with null clipboardData
      const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;

      Object.defineProperty(event, 'clipboardData', { value: null });

      document.dispatchEvent(event);

      expect(onCopy).not.toHaveBeenCalled();
    });

    it('should remove copy/cut listeners on destroy', () => {
      const onCopy = vi.fn();
      const onCut = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onCopy,
        onCut,
      });

      selection.selectRow(0);

      // Destroy should remove listeners
      selection.destroy();

      const { event: copyEvent } = createClipboardEvent('copy');
      const { event: cutEvent } = createClipboardEvent('cut');

      document.dispatchEvent(copyEvent);
      document.dispatchEvent(cutEvent);

      expect(onCopy).not.toHaveBeenCalled();
      expect(onCut).not.toHaveBeenCalled();
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

  describe('single-cell click selection', () => {
    /**
     * Simulate a click on a cell (pointerdown + pointerup without drag to another cell).
     */
    const simulateClick = (grid: HTMLElement, row: number, col: number): void => {
      const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
      const cell = rows[row]?.querySelectorAll(`[${CELL_ATTR}]`)[col] as HTMLElement;
      const cellRect = cell.getBoundingClientRect();

      const downEvent = new PointerEvent('pointerdown', {
        clientX: cellRect.left + 5,
        clientY: cellRect.top + 5,
        bubbles: true,
        button: 0,
      });

      cell.dispatchEvent(downEvent);

      const upEvent = new PointerEvent('pointerup', {
        bubbles: true,
      });

      document.dispatchEvent(upEvent);
    };

    it('marks the clicked cell as selected', () => {
      simulateClick(grid, 1, 1);

      const cell = grid.querySelectorAll(`[${ROW_ATTR}]`)[1]
        ?.querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;

      expect(cell.hasAttribute(SELECTED_ATTR)).toBe(true);
    });

    it('selects only one cell', () => {
      simulateClick(grid, 1, 1);

      const selectedCells = grid.querySelectorAll(`[${SELECTED_ATTR}]`);

      expect(selectedCells).toHaveLength(1);
    });

    it('creates an overlay for single-cell selection', () => {
      simulateClick(grid, 0, 0);

      const overlay = grid.querySelector(`[${OVERLAY_ATTR}]`);

      expect(overlay).not.toBeNull();
    });

    it('creates a pill for single-cell selection', () => {
      simulateClick(grid, 0, 0);

      const pill = grid.querySelector(`[${PILL_ATTR}]`);

      expect(pill).not.toBeNull();
    });

    it('fires onSelectionActiveChange with true on click', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      simulateClick(grid, 1, 2);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it('clears previous single-cell selection when clicking a different cell', () => {
      simulateClick(grid, 0, 0);

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(1);

      // Click a different cell — should clear old and select new
      simulateClick(grid, 1, 1);

      const selectedCells = grid.querySelectorAll(`[${SELECTED_ATTR}]`);

      expect(selectedCells).toHaveLength(1);

      const newCell = grid.querySelectorAll(`[${ROW_ATTR}]`)[1]
        ?.querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;

      expect(newCell.hasAttribute(SELECTED_ATTR)).toBe(true);
    });

    it('clears single-cell selection on click-away', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      simulateClick(grid, 0, 0);

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(1);

      callback.mockClear();

      // Click away (document pointerdown outside grid)
      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(0);
      expect(callback).toHaveBeenCalledWith(false);
    });

    it('does not create selection when clicking grip elements', () => {
      // Add a grip attribute to a cell's child
      const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
      const cell = rows[0]?.querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
      const grip = document.createElement('div');

      grip.setAttribute('data-blok-table-grip', '');
      cell.appendChild(grip);

      const gripRect = cell.getBoundingClientRect();

      const downEvent = new PointerEvent('pointerdown', {
        clientX: gripRect.left + 5,
        clientY: gripRect.top + 5,
        bubbles: true,
        button: 0,
      });

      grip.dispatchEvent(downEvent);

      const upEvent = new PointerEvent('pointerup', { bubbles: true });

      document.dispatchEvent(upEvent);

      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(0);
    });
  });

  describe('pill popover color item', () => {
    it('includes a Color item in the pill popover when onColorChange is provided', () => {
      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onColorChange: vi.fn(),
      });

      // Trigger single-cell click to create selection with pill
      const cell = grid.querySelector(`[${CELL_ATTR}]`) as HTMLElement;
      const cellRect = cell.getBoundingClientRect();

      cell.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: cellRect.left + 5,
        clientY: cellRect.top + 5,
        bubbles: true,
        button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Open pill popover
      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // Check that popover items include a Color entry
      expect(lastPopoverArgs?.items?.some((item: MockPopoverItem) => item.title === 'tools.table.cellColor')).toBe(true);
    });

    it('does not include a Color item when onColorChange is not provided', () => {
      // default selection has no onColorChange

      // Trigger single-cell click to create selection with pill
      const cell = grid.querySelector(`[${CELL_ATTR}]`) as HTMLElement;
      const cellRect = cell.getBoundingClientRect();

      cell.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: cellRect.left + 5,
        clientY: cellRect.top + 5,
        bubbles: true,
        button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Open pill popover
      const pill = grid.querySelector(`[${PILL_ATTR}]`) as HTMLElement;

      pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

      // Check that popover items do NOT include a Color entry
      expect(lastPopoverArgs?.items?.some((item: MockPopoverItem) => item.title === 'tools.table.cellColor')).toBe(false);
    });
  });

  describe('isPopoverOpen guard', () => {
    it('does not clear selection when isPopoverOpen returns true', () => {
      const callback = vi.fn();
      const isPopoverOpen = vi.fn().mockReturnValue(true);

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
        isPopoverOpen,
      });

      selection.selectColumn(1);

      callback.mockClear();

      // Simulate a pointerdown on the document (e.g. clicking a grip popover action item).
      // boundClearSelection is registered synchronously by showProgrammaticSelection.
      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      // Selection must remain because the grip popover is open
      expect(callback).not.toHaveBeenCalledWith(false);
      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(3);
    });

    it('clears selection when isPopoverOpen returns false', () => {
      const callback = vi.fn();
      const isPopoverOpen = vi.fn().mockReturnValue(false);

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
        isPopoverOpen,
      });

      selection.selectColumn(1);

      callback.mockClear();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      expect(callback).toHaveBeenCalledWith(false);
      expect(grid.querySelectorAll(`[${SELECTED_ATTR}]`)).toHaveLength(0);
    });

    it('clears selection when isPopoverOpen is not provided', () => {
      const callback = vi.fn();

      selection.destroy();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionActiveChange: callback,
      });

      selection.selectColumn(1);

      callback.mockClear();

      const clearEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
      });

      document.dispatchEvent(clearEvent);

      expect(callback).toHaveBeenCalledWith(false);
    });
  });

  describe('onSelectionRangeChange callback', () => {
    it('fires with range when drag selection completes', () => {
      selection.destroy();

      const rangeCallback = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeCallback,
      });

      simulateDrag(grid, 0, 1, 2, 2);

      expect(rangeCallback).toHaveBeenCalledWith({
        minRow: 0,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('fires with range for single-cell click selection', () => {
      selection.destroy();

      const rangeCallback = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeCallback,
      });

      // Single click on cell (1,1) — pointerdown + pointerup without drag
      const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
      const cell = rows[1]?.querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;
      const rect = cell.getBoundingClientRect();

      cell.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: rect.left + 5,
        clientY: rect.top + 5,
        bubbles: true,
        button: 0,
      }));

      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      expect(rangeCallback).toHaveBeenCalledWith({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('fires with range for programmatic selectRow', () => {
      selection.destroy();

      const rangeCallback = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeCallback,
      });

      selection.selectRow(1);

      expect(rangeCallback).toHaveBeenCalledWith({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
    });

    it('fires with range for programmatic selectColumn', () => {
      selection.destroy();

      const rangeCallback = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeCallback,
      });

      selection.selectColumn(2);

      expect(rangeCallback).toHaveBeenCalledWith({
        minRow: 0,
        maxRow: 2,
        minCol: 2,
        maxCol: 2,
      });
    });
  });

});

