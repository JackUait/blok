import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';
const OVERLAY_ATTR = 'data-blok-table-selection-overlay';
const PILL_ATTR = 'data-blok-table-selection-pill';

/**
 * Captures the params of the last PopoverDesktop built by the pill menu, so a
 * test can assert which actions the menu offers.
 */
const popoverState = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');

    constructor(params: { items: unknown[] }) {
      popoverState.items = params.items;
    }

    show(): void {
      document.body.appendChild(this.el);
    }

    destroy(): void {
      this.el.remove();
    }

    on(): void {
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

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: () => ({ element: document.createElement('div') }),
}));

import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';

const mockI18n = {
  t: (key: string): string => key,
  has: (): boolean => false,
  getEnglishTranslation: (key: string): string => key,
  getLocale: (): string => 'en',
};

const GRID_LEFT = 10;
const GRID_TOP = 10;
const COL_WIDTH = 200;
const PAINT_ROW_HEIGHT = 40;
const RESIZED_ROW_HEIGHT = 60;
/**
 * Both borders must be non-zero and different from each other. With zeroes the
 * sign of `- borderTop` / `- borderLeft` and the `|| 0` fallbacks are invisible,
 * and a shared value cannot tell the two axes apart.
 */
const BORDER_TOP = 3;
const BORDER_LEFT = 5;

const addCell = (row: HTMLTableRowElement, r: number, c: number, colspan = 1, rowspan = 1): void => {
  const td = document.createElement('td');

  td.setAttribute(CELL_ATTR, '');
  td.setAttribute(CELL_ROW_ATTR, String(r));
  td.setAttribute(CELL_COL_ATTR, String(c));

  if (colspan > 1) {
    td.colSpan = colspan;
  }
  if (rowspan > 1) {
    td.rowSpan = rowspan;
  }

  const blocks = document.createElement('div');

  blocks.setAttribute(CELL_BLOCKS_ATTR, '');
  td.appendChild(blocks);
  row.appendChild(td);
};

const addColgroup = (table: HTMLTableElement, count: number): void => {
  const colgroup = document.createElement('colgroup');

  Array.from({ length: count }).forEach(() => {
    colgroup.appendChild(document.createElement('col'));
  });
  table.appendChild(colgroup);
};

const addRow = (table: HTMLTableElement, build: (row: HTMLTableRowElement) => void): void => {
  let tbody = table.querySelector('tbody');

  if (tbody === null) {
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
  }

  const row = document.createElement('tr');

  row.setAttribute(ROW_ATTR, '');
  build(row);
  tbody.appendChild(row);
};

/**
 * 2 rows × 4 logical columns with a 2×2 merge at (0,0):
 *
 *   +-------------------+---------+---------+
 *   | merged (2x2)      | (0,2)   | (0,3)   |
 *   |                   +---------+---------+
 *   |                   | (1,2)   | (1,3)   |
 *   +-------------------+---------+---------+
 *
 * Row 0 holds 3 physical <td> for 4 logical columns, so anything that counts
 * <td> instead of <col> lands one column short.
 */
const createMergedGrid = (colCount = 4): HTMLTableElement => {
  const table = document.createElement('table');

  addColgroup(table, colCount);
  addRow(table, row => {
    addCell(row, 0, 0, 2, 2);
    addCell(row, 0, 2);
    addCell(row, 0, 3);
  });
  addRow(table, row => {
    addCell(row, 1, 2);
    addCell(row, 1, 3);
  });
  document.body.appendChild(table);

  return table;
};

/** 2 rows × 2 columns, no merges. */
const createPlainGrid = (): HTMLTableElement => {
  const table = document.createElement('table');

  addColgroup(table, 2);
  addRow(table, row => {
    addCell(row, 0, 0);
    addCell(row, 0, 1);
  });
  addRow(table, row => {
    addCell(row, 1, 0);
    addCell(row, 1, 1);
  });
  document.body.appendChild(table);

  return table;
};

const mockRects = (grid: HTMLTableElement, rowHeight: number, totalRows: number, totalCols: number): void => {
  const rect = (top: number, left: number, height: number, width: number): DOMRect => ({
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });

  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(
    rect(GRID_TOP, GRID_LEFT, totalRows * rowHeight, totalCols * COL_WIDTH)
  );

  grid.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
    const r = Number(cell.getAttribute(CELL_ROW_ATTR));
    const c = Number(cell.getAttribute(CELL_COL_ATTR));
    const td = cell as HTMLTableCellElement;

    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(
      rect(
        GRID_TOP + r * rowHeight,
        GRID_LEFT + c * COL_WIDTH,
        (td.rowSpan || 1) * rowHeight,
        (td.colSpan || 1) * COL_WIDTH
      )
    );
  });

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    borderTopWidth: `${BORDER_TOP}px`,
    borderLeftWidth: `${BORDER_LEFT}px`,
  } as unknown as CSSStyleDeclaration);
};

const getCellSpan = (row: number, col: number): { colspan: number; rowspan: number } =>
  row === 0 && col === 0 ? { colspan: 2, rowspan: 2 } : { colspan: 1, rowspan: 1 };

const getMergeOrigin = (row: number, col: number): [number, number] | null =>
  row <= 1 && col <= 1 ? [0, 0] : null;

const itemTitles = (): string[] =>
  popoverState.items.flatMap(item =>
    typeof item === 'object' && item !== null && 'title' in item && typeof item.title === 'string'
      ? [item.title]
      : []
  );

const openPillMenu = (grid: HTMLElement): void => {
  const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

  pill?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};

describe('TableCellSelection — mutation gaps', () => {
  let grid: HTMLTableElement;
  let selection: TableCellSelection;

  beforeEach(() => {
    vi.clearAllMocks();
    popoverState.items = [];
  });

  afterEach(() => {
    selection?.destroy();
    grid?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('overlay reposition on cell resize', () => {
    let notifyResize: (() => void) | null;

    beforeEach(() => {
      notifyResize = null;

      class CapturingResizeObserver {
        constructor(callback: () => void) {
          notifyResize = callback;
        }

        observe(): void {
          // no-op
        }

        unobserve(): void {
          // no-op
        }

        disconnect(): void {
          // no-op
        }
      }

      vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
    });

    it('recomputes overlay and pill geometry from the resized cell rects', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        getCellSpan,
        getMergeOrigin,
      });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const overlay = grid.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`);
      const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

      expect(overlay).not.toBeNull();
      expect(pill).not.toBeNull();

      // Merge covers logical cols 0-1 and rows 0-1: 400×80 plus the 1px border cover.
      expect(overlay?.style.width).toBe('401px');
      expect(overlay?.style.height).toBe('81px');
      // Cell origin equals grid origin, so only the grid borders and the 1px
      // outward bleed remain.
      expect(overlay?.style.top).toBe(`${-BORDER_TOP - 1}px`);
      expect(overlay?.style.left).toBe(`${-BORDER_LEFT - 1}px`);
      expect(pill?.style.left).toBe('394px');
      expect(pill?.style.top).toBe('36.5px');

      mockRects(grid, RESIZED_ROW_HEIGHT, 2, 4);
      notifyResize?.();

      expect(overlay?.style.width).toBe('401px');
      expect(overlay?.style.height).toBe('121px');
      expect(overlay?.style.top).toBe(`${-BORDER_TOP - 1}px`);
      expect(overlay?.style.left).toBe(`${-BORDER_LEFT - 1}px`);
      expect(pill?.style.left).toBe('394px');
      expect(pill?.style.top).toBe('56.5px');
    });
  });

  describe('pill menu merge/split availability', () => {
    const buildSelection = (): TableCellSelection =>
      new TableCellSelection({
        grid,
        i18n: mockI18n,
        getCellSpan,
        getMergeOrigin,
        canMergeCells: () => true,
        onMergeCells: () => undefined,
        isMergedCell: (row, col) => row === 0 && col === 0,
        onSplitCell: () => undefined,
      });

    it('offers merge for a range spanning one row and several columns', () => {
      grid = createMergedGrid();
      selection = buildSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 2, maxCol: 3 });
      openPillMenu(grid);

      expect(itemTitles()).toContain('tools.table.mergeCells');
    });

    it('offers merge for a range spanning one column and several rows', () => {
      grid = createMergedGrid();
      selection = buildSelection();

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 2, maxCol: 2 });
      openPillMenu(grid);

      expect(itemTitles()).toContain('tools.table.mergeCells');
    });

    it('offers split, not merge, when a single click lands on a merged cell', () => {
      grid = createMergedGrid();
      selection = buildSelection();

      // One cell asked for, but the merge expands it to a 2×2 rectangle. The
      // rectangle is only wide because of the merge, so merging it again is not
      // an offer — splitting it is.
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      openPillMenu(grid);

      expect(itemTitles()).toContain('tools.table.splitCell');
      expect(itemTitles()).not.toContain('tools.table.mergeCells');
    });
  });

  describe('logical column count', () => {
    it('selects every logical column of a row, including those hidden by a colspan', () => {
      grid = createMergedGrid();
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        getCellSpan,
        getMergeOrigin,
      });

      selection.selectRow(0);

      expect(selection.getSelectedRange()).toEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 3,
      });
    });

    it('falls back to the physical cell count when the colgroup carries no columns', () => {
      grid = createMergedGrid(0);
      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        getCellSpan,
        getMergeOrigin,
      });

      selection.selectRow(0);

      // Row 0 has 3 physical <td>, so the fallback reaches logical column 2.
      expect(selection.getSelectedRange()).toEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
    });
  });

  describe('single-cell selections keep the normal editing shortcuts', () => {
    const pressBold = (): void => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
      );
    };

    it('does not bulk-format when only one cell is selected', () => {
      const onFormatCells = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onFormatCells });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      pressBold();

      expect(onFormatCells).not.toHaveBeenCalled();
    });

    it('bulk-formats across a real rectangle', () => {
      const onFormatCells = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onFormatCells });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      pressBold();

      expect(onFormatCells).toHaveBeenCalledTimes(1);
      expect(onFormatCells.mock.calls[0][1]).toBe('bold');
    });
  });

  describe('clipboard defers to the browser only for a single cell', () => {
    const dispatchClipboard = (type: 'copy' | 'cut'): Event => {
      const event = new Event(type, { bubbles: true,
        cancelable: true });

      Object.defineProperty(event, 'clipboardData', {
        value: { setData: vi.fn(),
          getData: vi.fn() },
      });
      document.dispatchEvent(event);

      return event;
    };

    /** Pretends the user highlighted characters inside a cell. */
    const stubNonCollapsedTextSelection = (): void => {
      vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
      } as unknown as Selection);
    };

    it('leaves copy to the browser when one cell holds a text selection', () => {
      const onCopy = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onCopy });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      stubNonCollapsedTextSelection();

      const event = dispatchClipboard('copy');

      expect(onCopy).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('copies the whole rectangle even while text is highlighted', () => {
      const onCopy = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onCopy });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      stubNonCollapsedTextSelection();

      const event = dispatchClipboard('copy');

      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves cut to the browser when one cell holds a text selection', () => {
      const onCut = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onCut });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      stubNonCollapsedTextSelection();

      const event = dispatchClipboard('cut');

      expect(onCut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('cuts the whole rectangle even while text is highlighted', () => {
      const onCut = vi.fn();

      grid = createPlainGrid();
      selection = new TableCellSelection({ grid,
        i18n: mockI18n,
        onCut });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      stubNonCollapsedTextSelection();

      const event = dispatchClipboard('cut');

      expect(onCut).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
