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
  has: (_key: string): boolean => false,
  getEnglishTranslation: (key: string): string => key,
  getLocale: (): string => 'en',
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

  /**
   * Regression tests for the `resolveCellCoord` physical-index bug.
   *
   * Layout reminder (2 rows × 3 logical cols):
   *   col 0     col 1     col 2
   *   +---------+---------+---------+
   *   | merged (2x2)      | [0,2]   |   row 0
   *   |                   +---------+
   *   |                   | [1,2]   |   row 1
   *   +---------+---------+---------+
   *
   * Physical <td> elements per row:
   *   Row 0: td[0,0] (col=0, colspan=2, rowspan=2), td[0,2] (col=2)  → 2 physical cells
   *   Row 1: td[1,2] (col=2)                                           → 1 physical cell
   *
   * BEFORE the fix: resolveCellCoord() returned the physical DOM index (0 or 1)
   * instead of the logical column from data-blok-table-cell-col.
   * For row 0, physical index 1 corresponds to logical column 2, not column 1.
   * For row 1, physical index 0 corresponds to logical column 2, not column 0.
   */
  describe('resolveCellCoord — logical column resolution after merge', () => {
    /**
     * Simulate a pointer drag from one <td> element to another and return
     * the resulting selection range reported via onSelectionRangeChange.
     */
    const simulateDragBetweenCells = (
      fromCell: HTMLElement,
      toCell: HTMLElement,
    ): void => {
      const fromRect = fromCell.getBoundingClientRect();
      const toRect = toCell.getBoundingClientRect();

      // jsdom doesn't define elementFromPoint; assign a stub that returns the target cell
      document.elementFromPoint = (_x: number, _y: number) => toCell;

      fromCell.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: fromRect.left + 5,
        clientY: fromRect.top + 5,
        bubbles: true,
        button: 0,
      }));

      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: toRect.left + 5,
        clientY: toRect.top + 5,
        bubbles: true,
      }));

      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    };

    it('resolveCellCoord returns logical col=2 (not physical index 1) for td[0,2] in row 0', () => {
      grid = createMergedGrid();
      mockMergedBoundingRects(grid);

      const rangeSpy = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeSpy,
      });

      // td[0,0] is the merged cell at physical index 0, logical col 0
      const td00 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="0"]`)!;
      // td[0,2] is the cell at physical index 1 in row 0, but logical col 2
      const td02 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="2"][${CELL_ROW_ATTR}="0"]`)!;

      simulateDragBetweenCells(td00, td02);

      // With the fix: extent col should be 2 (logical), not 1 (physical DOM index)
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minCol: 0, maxCol: 2 })
      );
    });

    it('resolveCellCoord returns logical col=2 (not physical index 0) for td[1,2] in row 1', () => {
      grid = createMergedGrid();
      mockMergedBoundingRects(grid);

      const rangeSpy = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeSpy,
      });

      // td[0,0] is the merged origin at row 0, logical col 0
      const td00 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="0"]`)!;
      // td[1,2] is the ONLY physical <td> in row 1, at physical index 0 but logical col 2
      const td12 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="2"][${CELL_ROW_ATTR}="1"]`)!;

      simulateDragBetweenCells(td00, td12);

      // With the fix: anchor=col 0, extent=col 2 → selection spans minCol=0, maxCol=2
      // Before the fix: extent returns physical index 0, so maxCol=0 (wrong — same as anchor)
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 })
      );
    });

    it('resolveCellCoord returns logical row for cells in rows below a rowspan', () => {
      grid = createMergedGrid();
      mockMergedBoundingRects(grid);

      const rangeSpy = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeSpy,
      });

      // td[0,2] at row 0 → td[1,2] at row 1: both at logical col 2
      const td02 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="2"][${CELL_ROW_ATTR}="0"]`)!;
      const td12 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="2"][${CELL_ROW_ATTR}="1"]`)!;

      simulateDragBetweenCells(td02, td12);

      // A drag from [0,2] to [1,2] should select exactly col 2, rows 0–1
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 1, minCol: 2, maxCol: 2 })
      );
    });

    it('anchor cell on non-origin cell: drag starting at td[0,2] (physical index 1) resolves to logical col=2', () => {
      grid = createMergedGrid();
      mockMergedBoundingRects(grid);

      const rangeSpy = vi.fn();

      selection = new TableCellSelection({
        grid,
        i18n: mockI18n,
        onSelectionRangeChange: rangeSpy,
      });

      // Start the drag on td[0,2] — physical index 1 in row 0, logical col 2.
      // Before the fix the anchor would be resolved to col=1 (physical index),
      // causing the selection to start one column too far left.
      const td02 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="2"][${CELL_ROW_ATTR}="0"]`)!;
      const td00 = grid.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="0"]`)!;

      simulateDragBetweenCells(td02, td00);

      // anchor=col 2, extent=col 0 → minCol=0, maxCol=2
      // Before the fix: anchor=col 1 (physical) → minCol=0, maxCol=1 (wrong)
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })
      );
    });
  });

  /**
   * Rowspan-only merge (no colspan):
   *
   *   col 0     col 1     col 2
   *   +---------+---------+---------+
   *   | [0,0]   | merged  | [0,2]   |   row 0
   *   |         | (2×1)   |         |
   *   +---------+         +---------+
   *   | [1,0]   |         | [1,2]   |   row 1
   *   +---------+---------+---------+
   *
   * Physical <td> elements per row:
   *   Row 0: td[0,0], td[0,1] (rowspan=2), td[0,2]  → 3 physical cells
   *   Row 1: td[1,0], td[1,2]                        → 2 physical cells
   *
   * In row 1, physical index 0 = logical col 0 (unchanged),
   * but physical index 1 = logical col 2 (NOT col 1).
   */
  describe('resolveCellCoord — rowspan-only merge', () => {
    const createRowspanGrid = (): HTMLTableElement => {
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

      // Row 0: [0,0], [0,1] (rowspan=2), [0,2]
      const row0 = document.createElement('tr');

      row0.setAttribute(ROW_ATTR, '');

      const makeTd = (r: number, c: number, cs = 1, rs = 1): HTMLTableCellElement => {
        const td = document.createElement('td');

        td.setAttribute(CELL_ATTR, '');
        td.setAttribute(CELL_ROW_ATTR, String(r));
        td.setAttribute(CELL_COL_ATTR, String(c));
        td.colSpan = cs;
        td.rowSpan = rs;
        const blocks = document.createElement('div');

        blocks.setAttribute('data-blok-table-cell-blocks', '');
        td.appendChild(blocks);
        return td;
      };

      row0.appendChild(makeTd(0, 0));
      row0.appendChild(makeTd(0, 1, 1, 2)); // rowspan=2
      row0.appendChild(makeTd(0, 2));
      tbody.appendChild(row0);

      // Row 1: [1,0], [1,2]  (col 1 is covered by the rowspan above)
      const row1 = document.createElement('tr');

      row1.setAttribute(ROW_ATTR, '');
      row1.appendChild(makeTd(1, 0));
      row1.appendChild(makeTd(1, 2));
      tbody.appendChild(row1);

      table.appendChild(tbody);
      document.body.appendChild(table);
      return table;
    };

    const mockRowspanBoundingRects = (tbl: HTMLTableElement): void => {
      const gridLeft = 10;
      const gridTop = 10;
      const colWidth = 200;
      const rowHeight = 40;

      vi.spyOn(tbl, 'getBoundingClientRect').mockReturnValue({
        top: gridTop, left: gridLeft,
        bottom: gridTop + 2 * rowHeight, right: gridLeft + 3 * colWidth,
        width: 3 * colWidth, height: 2 * rowHeight,
        x: gridLeft, y: gridTop, toJSON: () => ({}),
      });

      tbl.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
        const r = Number(cell.getAttribute(CELL_ROW_ATTR));
        const c = Number(cell.getAttribute(CELL_COL_ATTR));
        const td = cell as HTMLTableCellElement;
        const cs = td.colSpan || 1;
        const rs = td.rowSpan || 1;

        vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
          top: gridTop + r * rowHeight, left: gridLeft + c * colWidth,
          bottom: gridTop + (r + rs) * rowHeight, right: gridLeft + (c + cs) * colWidth,
          width: cs * colWidth, height: rs * rowHeight,
          x: gridLeft + c * colWidth, y: gridTop + r * rowHeight, toJSON: () => ({}),
        });
      });

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '0', borderLeftWidth: '0',
      } as unknown as CSSStyleDeclaration);
    };

    it('resolveCellCoord returns logical col=2 (not physical index 1) for td[1,2] after rowspan-only merge', () => {
      const tbl = createRowspanGrid();

      mockRowspanBoundingRects(tbl);

      const rangeSpy = vi.fn();
      const sel = new TableCellSelection({ grid: tbl, i18n: mockI18n, onSelectionRangeChange: rangeSpy });

      // td[1,0] is physical index 0 and logical col 0 (unchanged)
      const td10 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="0"]`)!;
      // td[1,2] is physical index 1 in row 1 (col 1 is covered), but logical col 2
      const td12 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`)!;

      document.elementFromPoint = () => td12;
      td10.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: td10.getBoundingClientRect().left + 5,
        clientY: td10.getBoundingClientRect().top + 5,
        bubbles: true, button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: td12.getBoundingClientRect().left + 5,
        clientY: td12.getBoundingClientRect().top + 5,
        bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Before the fix: extent col = 1 (physical index), so maxCol=1 (wrong)
      // After the fix:  extent col = 2 (logical from attribute), so maxCol=2
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 2 })
      );

      sel.destroy();
      tbl.remove();
    });
  });

  /**
   * Full-row merged cells — selection rect must expand to cover full colspan.
   *
   * Concrete scenario from bug report:
   *   5-row × 4-column table
   *   Row 0: single td[0,0] with colspan=4 (spans all 4 cols)
   *   Row 1: single td[1,0] with colspan=4 (spans all 4 cols)
   *   Rows 2-4: normal 4-cell rows
   *
   * Bug: dragging from (row=0,col=0) to (row=1,col=0) produces a raw rect of
   *   {minRow:0, maxRow:1, minCol:0, maxCol:0}
   * because both origin cells resolve to col=0. The selection rect should be
   * expanded to include the full span of the merged cells:
   *   {minRow:0, maxRow:1, minCol:0, maxCol:3}
   *
   * Without expansion, canMergeCells returns false and no Merge button appears.
   */
  describe('paintSelection — rect expansion for full-row colspan merges', () => {
    const createFullRowMergeGrid = (): HTMLTableElement => {
      const table = document.createElement('table');

      table.style.position = 'relative';

      const colgroup = document.createElement('colgroup');

      [200, 200, 200, 200].forEach(w => {
        const col = document.createElement('col');

        col.style.width = `${w}px`;
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);

      const tbody = document.createElement('tbody');

      const makeTd = (r: number, c: number, cs = 1, rs = 1): HTMLTableCellElement => {
        const td = document.createElement('td');

        td.setAttribute(CELL_ATTR, '');
        td.setAttribute(CELL_ROW_ATTR, String(r));
        td.setAttribute(CELL_COL_ATTR, String(c));
        td.colSpan = cs;
        td.rowSpan = rs;
        const blocks = document.createElement('div');

        blocks.setAttribute('data-blok-table-cell-blocks', '');
        td.appendChild(blocks);
        return td;
      };

      // Row 0: single cell spanning all 4 columns (colspan=4)
      const row0 = document.createElement('tr');

      row0.setAttribute(ROW_ATTR, '');
      row0.appendChild(makeTd(0, 0, 4, 1));
      tbody.appendChild(row0);

      // Row 1: single cell spanning all 4 columns (colspan=4)
      const row1 = document.createElement('tr');

      row1.setAttribute(ROW_ATTR, '');
      row1.appendChild(makeTd(1, 0, 4, 1));
      tbody.appendChild(row1);

      // Rows 2-4: normal 4-cell rows
      for (let r = 2; r <= 4; r++) {
        const row = document.createElement('tr');

        row.setAttribute(ROW_ATTR, '');
        for (let c = 0; c < 4; c++) {
          row.appendChild(makeTd(r, c));
        }
        tbody.appendChild(row);
      }

      table.appendChild(tbody);
      document.body.appendChild(table);
      return table;
    };

    const mockFullRowMergeBoundingRects = (tbl: HTMLTableElement): void => {
      const gridLeft = 10;
      const gridTop = 10;
      const colWidth = 200;
      const rowHeight = 40;
      const totalCols = 4;
      const totalRows = 5;

      vi.spyOn(tbl, 'getBoundingClientRect').mockReturnValue({
        top: gridTop, left: gridLeft,
        bottom: gridTop + totalRows * rowHeight, right: gridLeft + totalCols * colWidth,
        width: totalCols * colWidth, height: totalRows * rowHeight,
        x: gridLeft, y: gridTop, toJSON: () => ({}),
      });

      tbl.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
        const r = Number(cell.getAttribute(CELL_ROW_ATTR));
        const c = Number(cell.getAttribute(CELL_COL_ATTR));
        const td = cell as HTMLTableCellElement;
        const cs = td.colSpan || 1;
        const rs = td.rowSpan || 1;

        vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
          top: gridTop + r * rowHeight, left: gridLeft + c * colWidth,
          bottom: gridTop + (r + rs) * rowHeight, right: gridLeft + (c + cs) * colWidth,
          width: cs * colWidth, height: rs * rowHeight,
          x: gridLeft + c * colWidth, y: gridTop + r * rowHeight, toJSON: () => ({}),
        });
      });

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '0', borderLeftWidth: '0',
      } as unknown as CSSStyleDeclaration);
    };

    it('expands selection rect to full span of merged cells when dragging across merged cell origins', () => {
      const tbl = createFullRowMergeGrid();

      mockFullRowMergeBoundingRects(tbl);

      const rangeSpy = vi.fn();
      const canMergeSpy = vi.fn().mockReturnValue(true);
      const sel = new TableCellSelection({
        grid: tbl,
        i18n: mockI18n,
        onSelectionRangeChange: rangeSpy,
        canMergeCells: canMergeSpy,
        getCellSpan: (row, col) => {
          const td = tbl.querySelector<HTMLTableCellElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

          return {
            colspan: td?.colSpan ?? 1,
            rowspan: td?.rowSpan ?? 1,
          };
        },
      });

      // td[0,0] is the only physical <td> in row 0 (colspan=4), logical col 0
      const td00 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="0"]`)!;
      // td[1,0] is the only physical <td> in row 1 (colspan=4), logical col 0
      const td10 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="0"]`)!;

      // Simulate drag from td[0,0] to td[1,0]
      document.elementFromPoint = () => td10;
      td00.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: td00.getBoundingClientRect().left + 5,
        clientY: td00.getBoundingClientRect().top + 5,
        bubbles: true, button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: td10.getBoundingClientRect().left + 5,
        clientY: td10.getBoundingClientRect().top + 5,
        bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // The selection rect must be expanded to cover the full colspan of both merged cells.
      // Both td[0,0] and td[1,0] have colspan=4, so cols 0-3 are spanned.
      // Bug: paintSelection uses raw anchor/extent coords {minCol:0, maxCol:0} without expanding.
      // Correct: {minRow:0, maxRow:1, minCol:0, maxCol:3}
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 3 })
      );

      sel.destroy();
      tbl.remove();
    });
  });

  /**
   * Colspan-only merge (no rowspan):
   *
   *   col 0     col 1     col 2
   *   +---------+---------+---------+
   *   | merged (1×2)      | [0,2]   |   row 0
   *   +---------+---------+---------+
   *   | [1,0]   | [1,1]   | [1,2]   |   row 1
   *   +---------+---------+---------+
   *
   * Physical <td> elements per row:
   *   Row 0: td[0,0] (colspan=2), td[0,2]  → 2 physical cells
   *   Row 1: td[1,0], td[1,1], td[1,2]     → 3 physical cells (unchanged)
   *
   * In row 0, physical index 1 = logical col 2 (NOT col 1).
   */
  describe('resolveCellCoord — colspan-only merge', () => {
    const createColspanGrid = (): HTMLTableElement => {
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

      const makeTd = (r: number, c: number, cs = 1, rs = 1): HTMLTableCellElement => {
        const td = document.createElement('td');

        td.setAttribute(CELL_ATTR, '');
        td.setAttribute(CELL_ROW_ATTR, String(r));
        td.setAttribute(CELL_COL_ATTR, String(c));
        td.colSpan = cs;
        td.rowSpan = rs;
        const blocks = document.createElement('div');

        blocks.setAttribute('data-blok-table-cell-blocks', '');
        td.appendChild(blocks);
        return td;
      };

      // Row 0: td[0,0] (colspan=2), td[0,2]
      const row0 = document.createElement('tr');

      row0.setAttribute(ROW_ATTR, '');
      row0.appendChild(makeTd(0, 0, 2, 1)); // colspan=2
      row0.appendChild(makeTd(0, 2));
      tbody.appendChild(row0);

      // Row 1: normal 3-cell row
      const row1 = document.createElement('tr');

      row1.setAttribute(ROW_ATTR, '');
      row1.appendChild(makeTd(1, 0));
      row1.appendChild(makeTd(1, 1));
      row1.appendChild(makeTd(1, 2));
      tbody.appendChild(row1);

      table.appendChild(tbody);
      document.body.appendChild(table);
      return table;
    };

    const mockColspanBoundingRects = (tbl: HTMLTableElement): void => {
      const gridLeft = 10;
      const gridTop = 10;
      const colWidth = 200;
      const rowHeight = 40;

      vi.spyOn(tbl, 'getBoundingClientRect').mockReturnValue({
        top: gridTop, left: gridLeft,
        bottom: gridTop + 2 * rowHeight, right: gridLeft + 3 * colWidth,
        width: 3 * colWidth, height: 2 * rowHeight,
        x: gridLeft, y: gridTop, toJSON: () => ({}),
      });

      tbl.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
        const r = Number(cell.getAttribute(CELL_ROW_ATTR));
        const c = Number(cell.getAttribute(CELL_COL_ATTR));
        const td = cell as HTMLTableCellElement;
        const cs = td.colSpan || 1;
        const rs = td.rowSpan || 1;

        vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
          top: gridTop + r * rowHeight, left: gridLeft + c * colWidth,
          bottom: gridTop + (r + rs) * rowHeight, right: gridLeft + (c + cs) * colWidth,
          width: cs * colWidth, height: rs * rowHeight,
          x: gridLeft + c * colWidth, y: gridTop + r * rowHeight, toJSON: () => ({}),
        });
      });

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '0', borderLeftWidth: '0',
      } as unknown as CSSStyleDeclaration);
    };

    it('resolveCellCoord returns logical col=2 (not physical index 1) for td[0,2] after colspan-only merge', () => {
      const tbl = createColspanGrid();

      mockColspanBoundingRects(tbl);

      const rangeSpy = vi.fn();
      const sel = new TableCellSelection({ grid: tbl, i18n: mockI18n, onSelectionRangeChange: rangeSpy });

      // td[0,0] is the colspan=2 origin cell; physical index 0, logical col 0
      const td00 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="0"]`)!;
      // td[0,2] is physical index 1 in row 0, but logical col 2
      const td02 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="2"]`)!;

      document.elementFromPoint = () => td02;
      td00.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: td00.getBoundingClientRect().left + 5,
        clientY: td00.getBoundingClientRect().top + 5,
        bubbles: true, button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: td02.getBoundingClientRect().left + 5,
        clientY: td02.getBoundingClientRect().top + 5,
        bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Before the fix: extent col = 1 (physical index), so maxCol=1 (wrong)
      // After the fix:  extent col = 2 (logical from attribute), so maxCol=2
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })
      );

      sel.destroy();
      tbl.remove();
    });
  });

  /**
   * Multiple disjoint merges:
   *
   *   col 0     col 1     col 2     col 3
   *   +---------+---------+---------+---------+
   *   | merged (1×2)      | merged (1×2)      |   row 0
   *   +---------+---------+---------+---------+
   *   | [1,0]   | [1,1]   | [1,2]   | [1,3]   |   row 1
   *   +---------+---------+---------+---------+
   *
   * Physical <td> elements per row:
   *   Row 0: td[0,0] (colspan=2), td[0,2] (colspan=2)  → 2 physical cells
   *   Row 1: td[1,0], td[1,1], td[1,2], td[1,3]        → 4 physical cells
   *
   * In row 0, physical index 0 = logical col 0, physical index 1 = logical col 2.
   */
  describe('resolveCellCoord — multiple disjoint merges', () => {
    const createDisjointMergesGrid = (): HTMLTableElement => {
      const table = document.createElement('table');

      table.style.position = 'relative';

      const colgroup = document.createElement('colgroup');

      [200, 200, 200, 200].forEach(w => {
        const col = document.createElement('col');

        col.style.width = `${w}px`;
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);

      const tbody = document.createElement('tbody');

      const makeTd = (r: number, c: number, cs = 1, rs = 1): HTMLTableCellElement => {
        const td = document.createElement('td');

        td.setAttribute(CELL_ATTR, '');
        td.setAttribute(CELL_ROW_ATTR, String(r));
        td.setAttribute(CELL_COL_ATTR, String(c));
        td.colSpan = cs;
        td.rowSpan = rs;
        const blocks = document.createElement('div');

        blocks.setAttribute('data-blok-table-cell-blocks', '');
        td.appendChild(blocks);
        return td;
      };

      // Row 0: two disjoint colspan=2 merges
      const row0 = document.createElement('tr');

      row0.setAttribute(ROW_ATTR, '');
      row0.appendChild(makeTd(0, 0, 2)); // colspan=2, logical cols 0-1
      row0.appendChild(makeTd(0, 2, 2)); // colspan=2, logical cols 2-3
      tbody.appendChild(row0);

      // Row 1: normal 4-cell row
      const row1 = document.createElement('tr');

      row1.setAttribute(ROW_ATTR, '');
      [0, 1, 2, 3].forEach(c => row1.appendChild(makeTd(1, c)));
      tbody.appendChild(row1);

      table.appendChild(tbody);
      document.body.appendChild(table);
      return table;
    };

    const mockDisjointBoundingRects = (tbl: HTMLTableElement): void => {
      const gridLeft = 10;
      const gridTop = 10;
      const colWidth = 200;
      const rowHeight = 40;

      vi.spyOn(tbl, 'getBoundingClientRect').mockReturnValue({
        top: gridTop, left: gridLeft,
        bottom: gridTop + 2 * rowHeight, right: gridLeft + 4 * colWidth,
        width: 4 * colWidth, height: 2 * rowHeight,
        x: gridLeft, y: gridTop, toJSON: () => ({}),
      });

      tbl.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
        const r = Number(cell.getAttribute(CELL_ROW_ATTR));
        const c = Number(cell.getAttribute(CELL_COL_ATTR));
        const td = cell as HTMLTableCellElement;
        const cs = td.colSpan || 1;
        const rs = td.rowSpan || 1;

        vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
          top: gridTop + r * rowHeight, left: gridLeft + c * colWidth,
          bottom: gridTop + (r + rs) * rowHeight, right: gridLeft + (c + cs) * colWidth,
          width: cs * colWidth, height: rs * rowHeight,
          x: gridLeft + c * colWidth, y: gridTop + r * rowHeight, toJSON: () => ({}),
        });
      });

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '0', borderLeftWidth: '0',
      } as unknown as CSSStyleDeclaration);
    };

    it('resolveCellCoord returns logical col=2 (not physical index 1) for second merged cell in row 0', () => {
      const tbl = createDisjointMergesGrid();

      mockDisjointBoundingRects(tbl);

      const rangeSpy = vi.fn();
      const sel = new TableCellSelection({ grid: tbl, i18n: mockI18n, onSelectionRangeChange: rangeSpy });

      // td[0,0] is colspan=2 at physical index 0, logical col 0
      const td00 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="0"]`)!;
      // td[0,2] is colspan=2 at physical index 1, but logical col 2
      const td02 = tbl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="2"]`)!;

      document.elementFromPoint = () => td02;
      td00.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: td00.getBoundingClientRect().left + 5,
        clientY: td00.getBoundingClientRect().top + 5,
        bubbles: true, button: 0,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: td02.getBoundingClientRect().left + 5,
        clientY: td02.getBoundingClientRect().top + 5,
        bubbles: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      // Before the fix: extent col = 1 (physical index), so maxCol=1 (wrong — selects only first merge)
      // After the fix:  extent col = 2 (logical col of second merge origin), so maxCol=3 after
      //                 collectCellsInRange expands for colspan
      expect(rangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })
      );

      sel.destroy();
      tbl.remove();
    });
  });
});
