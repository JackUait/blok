import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const OVERLAY_ATTR = 'data-blok-table-selection-overlay';

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');
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

const GRID_LEFT = 10;
const GRID_TOP = 10;
const COL_WIDTH = 200;
const ROW_HEIGHT = 40;
const TOTAL_COLS = 4;
const TOTAL_ROWS = 2;

/**
 * 2 rows × 4 logical columns with a 2×2 merge at [0,0]:
 *
 *   col 0     col 1     col 2     col 3
 *   +-------------------+---------+---------+
 *   | merged (2x2)      | [0,2]   | [0,3]   |  row 0
 *   |                   +---------+---------+
 *   |                   | [1,2]   | [1,3]   |  row 1
 *   +-------------------+---------+---------+
 *
 * The two trailing columns matter: they give row 1 more than one physical
 * <td>, so a physical-index lookup for logical column 1 silently resolves to
 * a real (but wrong) far-right cell instead of failing.
 */
const createWideMergedGrid = (): HTMLTableElement => {
  const table = document.createElement('table');

  const colgroup = document.createElement('colgroup');

  Array.from({ length: TOTAL_COLS }).forEach(() => {
    const col = document.createElement('col');

    col.style.width = `${COL_WIDTH}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

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

    blocks.setAttribute('data-blok-table-cell-blocks', '');
    td.appendChild(blocks);
    row.appendChild(td);
  };

  const row0 = document.createElement('tr');

  row0.setAttribute(ROW_ATTR, '');
  addCell(row0, 0, 0, 2, 2);
  addCell(row0, 0, 2);
  addCell(row0, 0, 3);
  tbody.appendChild(row0);

  const row1 = document.createElement('tr');

  row1.setAttribute(ROW_ATTR, '');
  addCell(row1, 1, 2);
  addCell(row1, 1, 3);
  tbody.appendChild(row1);

  table.appendChild(tbody);
  document.body.appendChild(table);

  return table;
};

const mockBoundingRects = (grid: HTMLTableElement): void => {
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    top: GRID_TOP,
    left: GRID_LEFT,
    bottom: GRID_TOP + TOTAL_ROWS * ROW_HEIGHT,
    right: GRID_LEFT + TOTAL_COLS * COL_WIDTH,
    width: TOTAL_COLS * COL_WIDTH,
    height: TOTAL_ROWS * ROW_HEIGHT,
    x: GRID_LEFT,
    y: GRID_TOP,
    toJSON: () => ({}),
  });

  grid.querySelectorAll(`[${CELL_ATTR}]`).forEach(cell => {
    const r = Number(cell.getAttribute(CELL_ROW_ATTR));
    const c = Number(cell.getAttribute(CELL_COL_ATTR));
    const td = cell as HTMLTableCellElement;
    const cs = td.colSpan || 1;
    const rs = td.rowSpan || 1;

    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
      top: GRID_TOP + r * ROW_HEIGHT,
      left: GRID_LEFT + c * COL_WIDTH,
      bottom: GRID_TOP + (r + rs) * ROW_HEIGHT,
      right: GRID_LEFT + (c + cs) * COL_WIDTH,
      width: cs * COL_WIDTH,
      height: rs * ROW_HEIGHT,
      x: GRID_LEFT + c * COL_WIDTH,
      y: GRID_TOP + r * ROW_HEIGHT,
      toJSON: () => ({}),
    });
  });

  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    borderTopWidth: '0',
    borderLeftWidth: '0',
  } as unknown as CSSStyleDeclaration);
};

const mockI18n = {
  t: (key: string): string => key,
  has: (): boolean => false,
  getEnglishTranslation: (key: string): string => key,
  getLocale: (): string => 'en',
};

/**
 * Span lookup matching the fixture — the real subsystem delegates to
 * TableModel.getCellSpan, which returns {1,1} for merge-covered coordinates.
 */
const getCellSpan = (row: number, col: number): { colspan: number; rowspan: number } =>
  row === 0 && col === 0 ? { colspan: 2, rowspan: 2 } : { colspan: 1, rowspan: 1 };

describe('TableCellSelection — clicking a merged cell', () => {
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

  it('boxes exactly the merged cell, not the columns beyond it', () => {
    grid = createWideMergedGrid();
    mockBoundingRects(grid);

    selection = new TableCellSelection({
      grid,
      i18n: mockI18n,
      getCellSpan,
    });

    // Clicking inside the merged origin puts the caret there; the box follows focus.
    const mergedCellBlocks = grid.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="0"] [data-blok-table-cell-blocks]`
    );

    mergedCellBlocks?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const overlay = grid.querySelector<HTMLElement>(`[${OVERLAY_ATTR}]`);

    expect(overlay).not.toBeNull();
    // The merged cell spans logical columns 0-1 → 2 × 200px (+1px border cover).
    expect(overlay?.style.width).toBe(`${2 * COL_WIDTH + 1}px`);
    expect(overlay?.style.height).toBe(`${2 * ROW_HEIGHT + 1}px`);
  });
});
