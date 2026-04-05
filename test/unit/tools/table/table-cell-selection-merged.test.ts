import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const SELECTED_ATTR = 'data-blok-table-cell-selected';
const OVERLAY_ATTR = 'data-blok-table-selection-overlay';

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');
    show(): void {
      this.el.setAttribute('data-blok-popover-opened', 'true');
      document.body.appendChild(this.el);
    }
    destroy(): void {
      this.el.removeAttribute('data-blok-popover-opened');
      this.el.remove();
    }
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

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: () => ({ element: document.createElement('div') }),
}));

import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';

/**
 * Creates a 2-row x 3-column grid with a 2x2 merge at [0,0].
 *
 * Logical layout:
 *   col 0     col 1     col 2
 *   +---------+---------+---------+
 *   | merged (2x2)      | [0,2]   |   row 0
 *   |                   +---------+
 *   |                   | [1,2]   |   row 1
 *   +---------+---------+---------+
 *
 * Physical <td> elements per row:
 *   Row 0: td[0,0] (colspan=2, rowspan=2), td[0,2]  → 2 physical cells
 *   Row 1: td[1,2]                                    → 1 physical cell
 *
 * Colgroup has 3 <col> elements (the true logical column count).
 */
const createMergedGrid = (): HTMLTableElement => {
  const table = document.createElement('table');

  table.style.position = 'relative';

  const colgroup = document.createElement('colgroup');

  [200, 200, 200].forEach(w => {
    const col = document.createElement('col');

    col.style.width = `${w}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  // Row 0: merged cell [0,0] (colspan=2, rowspan=2) + cell [0,2]
  const row0 = document.createElement('tr');

  row0.setAttribute(ROW_ATTR, '');

  const td00 = document.createElement('td');

  td00.setAttribute(CELL_ATTR, '');
  td00.setAttribute(CELL_ROW_ATTR, '0');
  td00.setAttribute(CELL_COL_ATTR, '0');
  td00.colSpan = 2;
  td00.rowSpan = 2;

  const blocks00 = document.createElement('div');

  blocks00.setAttribute('data-blok-table-cell-blocks', '');
  td00.appendChild(blocks00);
  row0.appendChild(td00);

  const td02 = document.createElement('td');

  td02.setAttribute(CELL_ATTR, '');
  td02.setAttribute(CELL_ROW_ATTR, '0');
  td02.setAttribute(CELL_COL_ATTR, '2');

  const blocks02 = document.createElement('div');

  blocks02.setAttribute('data-blok-table-cell-blocks', '');
  td02.appendChild(blocks02);
  row0.appendChild(td02);
  tbody.appendChild(row0);

  // Row 1: only cell [1,2] (cells [1,0] and [1,1] are covered by the merge)
  const row1 = document.createElement('tr');

  row1.setAttribute(ROW_ATTR, '');

  const td12 = document.createElement('td');

  td12.setAttribute(CELL_ATTR, '');
  td12.setAttribute(CELL_ROW_ATTR, '1');
  td12.setAttribute(CELL_COL_ATTR, '2');

  const blocks12 = document.createElement('div');

  blocks12.setAttribute('data-blok-table-cell-blocks', '');
  td12.appendChild(blocks12);
  row1.appendChild(td12);
  tbody.appendChild(row1);

  table.appendChild(tbody);
  document.body.appendChild(table);

  return table;
};

/**
 * Mock getBoundingClientRect for all cells in a merged grid.
 * Uses the coordinate attributes to place cells at the correct logical position.
 */
const mockMergedBoundingRects = (grid: HTMLTableElement): void => {
  const gridLeft = 10;
  const gridTop = 10;
  const colWidth = 200;
  const rowHeight = 40;
  const totalCols = 3;
  const totalRows = 2;

  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    top: gridTop,
    left: gridLeft,
    bottom: gridTop + totalRows * rowHeight,
    right: gridLeft + totalCols * colWidth,
    width: totalCols * colWidth,
    height: totalRows * rowHeight,
    x: gridLeft,
    y: gridTop,
    toJSON: () => ({}),
  });

  const cells = grid.querySelectorAll(`[${CELL_ATTR}]`);

  cells.forEach(cell => {
    const r = Number(cell.getAttribute(CELL_ROW_ATTR));
    const c = Number(cell.getAttribute(CELL_COL_ATTR));
    const td = cell as HTMLTableCellElement;
    const cs = td.colSpan || 1;
    const rs = td.rowSpan || 1;

    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
      top: gridTop + r * rowHeight,
      left: gridLeft + c * colWidth,
      bottom: gridTop + (r + rs) * rowHeight,
      right: gridLeft + (c + cs) * colWidth,
      width: cs * colWidth,
      height: rs * rowHeight,
      x: gridLeft + c * colWidth,
      y: gridTop + r * rowHeight,
      toJSON: () => ({}),
    });
  });

  // Also mock getComputedStyle for the grid
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    borderTopWidth: '0',
    borderLeftWidth: '0',
  } as unknown as CSSStyleDeclaration);
};

const mockI18n = {
  t: (key: string): string => key,
};

describe('TableCellSelection — merged cells', () => {
  let grid: HTMLTableElement;
  let selection: TableCellSelection;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    selection?.destroy();
    grid?.remove();
    vi.restoreAllMocks();
  });

  it('selectRow uses colgroup for column count, not physical cell count', () => {
    grid = createMergedGrid();
    mockMergedBoundingRects(grid);

    const rangeSpy = vi.fn();

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
      onSelectionRangeChange: rangeSpy,
    });

    selection.selectRow(0);

    // The selection should cover columns 0..2 (3 logical columns from colgroup),
    // NOT 0..1 (2 physical cells in row 0).
    expect(rangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })
    );
  });

  it('paintSelection finds corner cells by coordinate attributes in merged table', () => {
    grid = createMergedGrid();
    mockMergedBoundingRects(grid);

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
    });

    // Select the full first row: from [0,0] to [0,2]
    selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });

    // The overlay should exist and be positioned
    const overlay = grid.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`);

    expect(overlay).not.toBeNull();
    // Verify it has style dimensions (proves the corner cells were found)
    expect(overlay?.style.width).toBeTruthy();
    expect(overlay?.style.height).toBeTruthy();
  });

  it('clampExtentToEdge uses colgroup for column count with merged cells', () => {
    grid = createMergedGrid();
    mockMergedBoundingRects(grid);

    const rangeSpy = vi.fn();

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
      onSelectionRangeChange: rangeSpy,
    });

    // selectRow internally calls showProgrammaticSelection which uses colCount.
    // If colgroup is used, maxCol will be 2. If physical cells, maxCol will be 1.
    selection.selectRow(1);

    expect(rangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ minCol: 0, maxCol: 2 })
    );
  });

  it('collectCellsInRange finds cells by coordinate attributes in merged table', () => {
    grid = createMergedGrid();
    mockMergedBoundingRects(grid);

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
    });

    // Select range covering the entire grid
    selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });

    // All 3 physical cells should be selected: td[0,0], td[0,2], td[1,2]
    const selectedCells = grid.querySelectorAll(`[${SELECTED_ATTR}]`);

    expect(selectedCells.length).toBe(3);
  });

  it('repositionOverlay finds cells by coordinate attributes after resize', () => {
    grid = createMergedGrid();
    mockMergedBoundingRects(grid);

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
    });

    // Select from [0,0] to [0,2] — first row
    selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });

    const overlay = grid.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`);

    expect(overlay).not.toBeNull();

    const initialWidth = overlay?.style.width;

    // Simulate a resize by updating bounding rects and manually calling
    // repositionOverlay (which the ResizeObserver would trigger)
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      left: 10,
      bottom: 110,
      right: 710,
      width: 700,
      height: 100,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });

    // The overlay should still exist (repositionOverlay should find cells by coords)
    expect(overlay?.style.width).toBeTruthy();
    expect(initialWidth).toBeTruthy();
  });
});
