import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

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
const popoverState = vi.hoisted(() => ({
  items: [] as unknown[],
  destroyed: 0,
  params: null as null | Record<string, unknown>,
  closed: null as null | (() => void),
}));

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');

    constructor(params: { items: unknown[] }) {
      popoverState.items = params.items;
      popoverState.params = params;
      popoverState.closed = null;
    }

    show(): void {
      document.body.appendChild(this.el);
    }

    destroy(): void {
      popoverState.destroyed += 1;
      this.el.remove();
    }

    on(_event: unknown, handler: () => void): void {
      popoverState.closed = handler;
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

/** The options and the tab node the pill menu's colour picker was built with. */
const colorPickerState = vi.hoisted(() => ({
  lastOptions: null as null | Record<string, unknown>,
  tab: null as null | HTMLElement,
}));

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: (options: Record<string, unknown>) => {
    colorPickerState.lastOptions = options;

    const element = document.createElement('div');
    const tab = document.createElement('button');

    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'true');
    element.appendChild(tab);
    colorPickerState.tab = tab;

    return { element };
  },
}));

/** The options the pill menu's placement picker was built with. */
const placementPickerState = vi.hoisted(() => ({
  lastOptions: null as null | Record<string, unknown>,
}));

vi.mock('../../../../src/tools/table/table-cell-placement-picker', () => ({
  createCellPlacementPicker: (options: Record<string, unknown>) => {
    placementPickerState.lastOptions = options;

    return { element: document.createElement('div') };
  },
}));

/** Flipped per test so the pointerup branch on an inner cross-host range is reachable. */
const crossHost = vi.hoisted(() => ({ active: false }));

vi.mock('../../../../src/components/selection/cross-block-range', () => ({
  hasCrossHostSelectionWithin: () => crossHost.active,
}));

/** Both caret-edge probes answer from flags, so "the caret is at the edge" is a test input. */
const caret = vi.hoisted(() => ({
  atStart: false,
  atEnd: false,
  asked: [] as Array<{ which: string; input: HTMLElement }>,
}));

vi.mock('../../../../src/components/utils/caret', () => ({
  isCaretAtStartOfInput: (input: HTMLElement): boolean => {
    caret.asked.push({ which: 'start', input });

    return caret.atStart;
  },
  isCaretAtEndOfInput: (input: HTMLElement): boolean => {
    caret.asked.push({ which: 'end', input });

    return caret.atEnd;
  },
}));

import type { CellMark, FillDirection, SelectionRange } from '../../../../src/tools/table/table-cell-selection';
import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import { MODIFIER_KEY } from '../../../../src/components/constants';

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

/* ------------------------------------------------------------------ *
 * Extended harness for the behaviour-level sweep.
 * ------------------------------------------------------------------ */

const SELECTED_ATTR = 'data-blok-table-cell-selected';
const OVERLAY_SELECTOR = `[${OVERLAY_ATTR}]`;

const selectedCellsIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${SELECTED_ATTR}]`));

/** Every logical coordinate pair currently carrying the selected marker. */
const selectedCoords = (root: HTMLElement): Array<[number, number]> =>
  selectedCellsIn(root).map(cell => [
    Number(cell.getAttribute(CELL_ROW_ATTR)),
    Number(cell.getAttribute(CELL_COL_ATTR)),
  ]);

let blockSeq = 0;

/**
 * A contenteditable block holder inside a cell — the shape `resolveCaretCell`
 * and `isCaretAtCellBoundary` walk up from.
 */
const addBlockInput = (cell: HTMLElement): HTMLElement => {
  const blocks = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`) ?? cell;
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', `blk-${blockSeq++}`);

  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  holder.appendChild(input);
  blocks.appendChild(holder);

  return input;
};

/** n rows × m columns, every cell carrying logical coordinate attributes. */
const createGrid = (rows: number, cols: number): HTMLTableElement => {
  const table = document.createElement('table');

  addColgroup(table, cols);
  for (let r = 0; r < rows; r++) {
    addRow(table, row => {
      for (let c = 0; c < cols; c++) {
        addCell(row, r, c);
      }
    });
  }
  document.body.appendChild(table);

  return table;
};

const cellAt = (root: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = root.querySelector<HTMLElement>(
    `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
  );

  if (cell === null) {
    throw new Error(`no cell at ${row},${col}`);
  }

  return cell;
};

/** No coordinate attributes anywhere: the physical-index fallback must answer. */
const createAttrlessGrid = (rows: number, cols: number): HTMLTableElement => {
  const table = document.createElement('table');

  addColgroup(table, cols);
  for (let r = 0; r < rows; r++) {
    addRow(table, row => {
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td');

        td.setAttribute(CELL_ATTR, '');
        const blocks = document.createElement('div');

        blocks.setAttribute(CELL_BLOCKS_ATTR, '');
        td.appendChild(blocks);
        row.appendChild(td);
      }
    });
  }
  document.body.appendChild(table);

  return table;
};

const pressKey = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  document.dispatchEvent(event);

  return event;
};

const sendPointer = (
  type: string,
  target: EventTarget,
  init: PointerEventInit = {}
): PointerEvent => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

/** Stands in for the document selection so caret position and text ranges are test inputs. */
const stubSelection = (
  over: Partial<{ anchorNode: Node | null; isCollapsed: boolean }> = {}
): { removeAllRanges: ReturnType<typeof vi.fn> } => {
  const removeAllRanges = vi.fn();

  vi.spyOn(window, 'getSelection').mockReturnValue({
    anchorNode: null,
    isCollapsed: true,
    rangeCount: 0,
    removeAllRanges,
    ...over,
  } as unknown as Selection);

  return { removeAllRanges };
};

const makeSelectionFor = (
  target: HTMLElement,
  over: Partial<ConstructorParameters<typeof TableCellSelection>[0]> = {}
): TableCellSelection => {
  const built = new TableCellSelection({
    grid: target,
    i18n: mockI18n,
    ...over,
  });

  // A test that builds two selections in one body would otherwise leave the
  // first one's document listeners behind for every later test to fire.
  liveSelections.push(built);

  return built;
};

/** Every instance `makeSelection` ever built, so afterEach can detach them all. */
const liveSelections: TableCellSelection[] = [];

const items = (): Array<Record<string, unknown>> =>
  popoverState.items.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
  );

const itemNamed = (title: string): Record<string, unknown> | undefined =>
  items().find(item => item.title === title);

/** What the next `document.elementFromPoint` answers; jsdom implements none of it. */
let pointerTarget: HTMLElement | null = null;

document.elementFromPoint = (): Element | null => pointerTarget;

describe('TableCellSelection — mutation gaps', () => {
  let grid: HTMLTableElement;
  let selection: TableCellSelection;
  /**
   * Errors jsdom reported for a throwing DOM listener. `dispatchEvent` swallows
   * those, so a missing guard would otherwise look like a passing test.
   */
  let listenerErrors: unknown[] = [];

  const onWindowError = (event: ErrorEvent): void => {
    listenerErrors.push(event.error);
  };

  /** Builds a selection over the test's grid unless the test overrides the target. */
  const makeSelection = (
    over: Partial<ConstructorParameters<typeof TableCellSelection>[0]> = {}
  ): TableCellSelection => makeSelectionFor(grid, over);

  /** Number of times the grid's computed style has been read — one per repaint. */
  const paintCount = (): number => {
    const spy = window.getComputedStyle as unknown as { mock?: { calls: unknown[] } };

    return spy.mock?.calls.length ?? 0;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    popoverState.items = [];
    popoverState.destroyed = 0;
    popoverState.params = null;
    popoverState.closed = null;
    pointerTarget = null;
    blockSeq = 0;
    crossHost.active = false;
    caret.atStart = false;
    caret.atEnd = false;
    caret.asked = [];
    listenerErrors = [];
    window.addEventListener('error', onWindowError);
  });

  afterEach(() => {
    window.removeEventListener('error', onWindowError);
    // A pointerdown in a test leaves the input modality at 'pointer'; a keydown restores it.
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    // A listener that threw means a guard the test was relying on is missing.
    expect(listenerErrors).toStrictEqual([]);
    selection?.destroy();
    liveSelections.forEach(instance => instance.destroy());
    liveSelections.length = 0;
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

  /* ---------------------------------------------------------------- *
   * Keyboard rectangle (Shift+Arrow) — the capture-phase entry point.
   * ---------------------------------------------------------------- */

  describe('Shift+Arrow rectangle from a caret', () => {
    /** Puts the caret inside `cell` and reports the edge flag the source asks for. */
    const caretIn = (cell: HTMLElement): HTMLElement => {
      const input = addBlockInput(cell);

      return input;
    };

    it('extends right from the last block of the caret cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      const input = caretIn(cellAt(grid, 1, 1));

      caret.atEnd = true;
      const { removeAllRanges } = stubSelection({ anchorNode: input });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
      expect(event.defaultPrevented).toBe(true);
      // The caret's own text selection must not survive next to a cell rectangle.
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(caret.asked).toStrictEqual([{ which: 'end', input }]);
    });

    it('leaves the rectangle alone once it already reaches the last column', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      pressKey({ key: 'ArrowRight', shiftKey: true });
      const second = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
      // Swallowed: the caret must not escape the table at the right edge.
      expect(second.defaultPrevented).toBe(true);
    });

    it('extends left from the first block of the caret cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atStart = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      pressKey({ key: 'ArrowLeft', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
      expect(caret.asked[0].which).toBe('start');
    });

    it('extends down from the caret cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 0, 0)) });

      pressKey({ key: 'ArrowDown', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 0,
      });
    });

    it('extends up from the caret cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atStart = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      pressKey({ key: 'ArrowUp', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('leaves Cmd/Ctrl/Alt+Shift+Arrow to the core shortcuts', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      const meta = pressKey({ key: 'ArrowRight', shiftKey: true, metaKey: true });
      const ctrl = pressKey({ key: 'ArrowRight', shiftKey: true, ctrlKey: true });
      const alt = pressKey({ key: 'ArrowRight', shiftKey: true, altKey: true });

      expect([meta.defaultPrevented, ctrl.defaultPrevented, alt.defaultPrevented]).toStrictEqual([
        false,
        false,
        false,
      ]);
      expect(selection.getSelectedRange()).toBeNull();
      expect(caret.asked).toStrictEqual([]);
    });

    it('leaves a plain arrow to the caret', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      const event = pressKey({ key: 'ArrowRight' });

      expect(event.defaultPrevented).toBe(false);
      expect(caret.asked).toStrictEqual([]);
    });

    it('yields Shift+Arrow to a block selection inside the grid', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      const marker = document.createElement('div');

      marker.setAttribute('data-blok-selected', 'true');
      grid.appendChild(marker);

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
      expect(caret.asked).toStrictEqual([]);
    });

    it('does not extend when the caret is mid-cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = false;
      caret.atStart = false;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('does not extend when the caret is outside the grid', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;

      const outside = document.createElement('div');

      outside.setAttribute('contenteditable', 'true');
      document.body.appendChild(outside);
      stubSelection({ anchorNode: outside });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
      expect(caret.asked).toStrictEqual([]);
    });

    it('does not extend when the caret sits in a cell with no editable input', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: cellAt(grid, 1, 1) });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('does not extend when the caret node is not inside the grid', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: null });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('adopts a pointer-made rectangle as the keyboard origin', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
    });

    it('does not adopt a 1x1 rectangle — it falls through to the caret', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      caret.atEnd = true;
      stubSelection({ anchorNode: addBlockInput(cellAt(grid, 2, 2)) });

      pressKey({ key: 'ArrowRight', shiftKey: true });

      // Stepped off the caret at (2,2), not off the 1x1 box at (0,0).
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 2,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('keeps extending from the keyboard anchor even after the caret moves', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      pressKey({ key: 'ArrowRight', shiftKey: true });
      // The caret jumps elsewhere; the rectangle must keep its own origin.
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 2, 2)) });
      pressKey({ key: 'ArrowDown', shiftKey: true });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('swallows the key at the bottom edge without repainting', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
      const overlay = grid.querySelector(OVERLAY_SELECTOR);

      const event = pressKey({ key: 'ArrowDown', shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 2,
        minCol: 0,
        maxCol: 2,
      });
      // Nothing repainted: the overlay element is the very same node.
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBe(overlay);
    });

    it('ignores the keyboard while a grip drag owns the grid', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atEnd = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 1, 1)) });

      grid.style.userSelect = 'none';

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
      expect(caret.asked).toStrictEqual([]);
    });

    it('refuses to extend out of the grid on the first press at the top-left', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caret.atStart = true;
      stubSelection({ anchorNode: caretIn(cellAt(grid, 0, 0)) });

      const event = pressKey({ key: 'ArrowUp', shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * Bulk mark / fill shortcuts.
   * ---------------------------------------------------------------- */

  describe('bulk mark and fill shortcuts', () => {
    const rectangle = (): void => {
      grid = createGrid(2, 2);
      selection = makeSelection({
        onFormatCells,
        onFillCells,
      });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    };
    let onFormatCells: Mock<(cells: HTMLElement[], mark: CellMark) => void>;
    let onFillCells: Mock<(cells: HTMLElement[], range: SelectionRange, direction: FillDirection) => void>;

    beforeEach(() => {
      onFormatCells = vi.fn<(cells: HTMLElement[], mark: CellMark) => void>();
      onFillCells = vi.fn<(cells: HTMLElement[], range: SelectionRange, direction: FillDirection) => void>();
    });

    it.each([
      [{ key: 'b' }, 'bold'],
      [{ key: 'i' }, 'italic'],
      [{ key: 'u' }, 'underline'],
      [{ key: 'e' }, 'code'],
      [{ key: 'B' }, 'bold'],
    ])('maps %o onto the %s mark', (init, mark) => {
      rectangle();

      const event = pressKey({ ...init, ctrlKey: true });

      expect(onFormatCells).toHaveBeenCalledTimes(1);
      expect(onFormatCells.mock.calls[0][1]).toBe(mark);
      expect(onFormatCells.mock.calls[0][0]).toHaveLength(2);
      expect(event.defaultPrevented).toBe(true);
    });

    it('maps Cmd+Shift+S onto strikethrough', () => {
      rectangle();

      pressKey({ key: 's', shiftKey: true, metaKey: true });

      expect(onFormatCells.mock.calls[0][1]).toBe('strikethrough');
    });

    it('ignores an unclaimed shifted letter', () => {
      rectangle();

      const event = pressKey({ key: 'b', shiftKey: true, ctrlKey: true });

      expect(onFormatCells).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores an unclaimed plain letter', () => {
      rectangle();

      const event = pressKey({ key: 'z', ctrlKey: true });

      expect(onFormatCells).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores a mark with no modifier', () => {
      rectangle();

      pressKey({ key: 'b' });

      expect(onFormatCells).not.toHaveBeenCalled();
    });

    it('ignores a mark with Alt held', () => {
      rectangle();

      pressKey({ key: 'b', ctrlKey: true, altKey: true });

      expect(onFormatCells).not.toHaveBeenCalled();
    });

    it('fills right on Cmd/Ctrl+R', () => {
      rectangle();

      const event = pressKey({ key: 'r', ctrlKey: true });

      expect(onFillCells).toHaveBeenCalledTimes(1);
      expect(onFillCells.mock.calls[0][1]).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1,
      });
      expect(onFillCells.mock.calls[0][2]).toBe('right');
      expect(event.defaultPrevented).toBe(true);
    });

    it('fills down on Cmd/Ctrl+D', () => {
      rectangle();

      pressKey({ key: 'D', ctrlKey: true });

      expect(onFillCells.mock.calls[0][2]).toBe('down');
    });

    it('leaves Cmd+Shift+R and Cmd+Alt+R to the core', () => {
      rectangle();

      pressKey({ key: 'r', ctrlKey: true, shiftKey: true });
      pressKey({ key: 'r', ctrlKey: true, altKey: true });

      expect(onFillCells).not.toHaveBeenCalled();
    });

    it('leaves an unclaimed fill key to the core', () => {
      rectangle();

      pressKey({ key: 'q', ctrlKey: true });

      expect(onFillCells).not.toHaveBeenCalled();
    });

    it('offers neither mark nor fill for a single selected cell', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onFormatCells, onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      pressKey({ key: 'r', ctrlKey: true });
      pressKey({ key: 'b', ctrlKey: true });

      expect(onFillCells).not.toHaveBeenCalled();
      expect(onFormatCells).not.toHaveBeenCalled();
    });

    it('offers neither mark nor fill with no selection at all', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onFormatCells, onFillCells });

      pressKey({ key: 'b', ctrlKey: true });

      expect(onFormatCells).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- *
   * Delete/Backspace across a rectangle.
   * ---------------------------------------------------------------- */

  describe('Delete and Backspace over a rectangle', () => {
    let onClearContent: Mock<(cells: HTMLElement[]) => void>;

    beforeEach(() => {
      onClearContent = vi.fn<(cells: HTMLElement[]) => void>();
    });

    it('clears the whole rectangle and dismisses the selection', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onClearContent });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = pressKey({ key: 'Delete' });

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(2);
      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('treats Backspace the same way', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onClearContent });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const event = pressKey({ key: 'Backspace' });

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a single-cell selection to the browser', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onClearContent });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const event = pressKey({ key: 'Delete' });

      expect(onClearContent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores keys other than Delete/Backspace', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onClearContent });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const event = pressKey({ key: 'a' });

      expect(onClearContent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing with no selection', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ onClearContent });

      const event = pressKey({ key: 'Delete' });

      expect(onClearContent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- *
   * Pointer drag.
   * ---------------------------------------------------------------- */

  describe('pointer drag rectangle', () => {
    it('selects a single cell on a click with no drag', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      sendPointer('pointerdown', cellAt(grid, 1, 2));
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 2,
        maxCol: 2,
      });
      expect(onSelectionActiveChange).toHaveBeenCalledWith(true, false);
    });

    it('marks the range multi-cell only once the pointer crosses a boundary', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();
      const onSelectionRangeChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange, onSelectionRangeChange });

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      // Still inside the anchor cell — no selection yet.
      pointerTarget = cellAt(grid, 0, 0);
      sendPointer('pointermove', cellAt(grid, 0, 0));
      expect(onSelectionActiveChange).not.toHaveBeenCalled();
      expect(selection.getSelectedRange()).toBeNull();

      pointerTarget = cellAt(grid, 0, 2);
      sendPointer('pointermove', cellAt(grid, 0, 2));

      expect(onSelectionActiveChange).toHaveBeenCalledWith(true, true);
      expect(grid.style.userSelect).toBe('none');

      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 2,
      });
      // Drag finished: the native text-selection lock is released again.
      expect(grid.style.userSelect).toBe('');
      expect(onSelectionRangeChange).toHaveBeenCalledTimes(1);
    });

    it('does not repaint while the pointer stays in the same extent cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = cellAt(grid, 1, 1);
      sendPointer('pointermove', cellAt(grid, 1, 1));
      const overlay = grid.querySelector(OVERLAY_SELECTOR);

      sendPointer('pointermove', cellAt(grid, 1, 1));

      expect(grid.querySelector(OVERLAY_SELECTOR)).toBe(overlay);
    });

    it('ignores a pointermove before any pointerdown', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      pointerTarget = cellAt(grid, 1, 1);
      sendPointer('pointermove', cellAt(grid, 1, 1));
      sendPointer('pointerup', document);

      expect(onSelectionActiveChange).not.toHaveBeenCalled();
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('ignores a pointermove that resolves to nothing', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = null;
      sendPointer('pointermove', document);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('clamps to the top-left corner when the pointer leaves the grid', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      pointerTarget = cellAt(grid, 1, 2);
      sendPointer('pointermove', cellAt(grid, 1, 2));

      pointerTarget = document.body;
      sendPointer('pointermove', document.body, { clientX: 0, clientY: 0 });
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('clamps to the last row and column when the pointer leaves past the end', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      pointerTarget = cellAt(grid, 2, 2);
      sendPointer('pointermove', cellAt(grid, 2, 2));

      pointerTarget = document.body;
      sendPointer('pointermove', document.body, { clientX: 9999, clientY: 9999 });
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('keeps the previous extent when the pointer is outside the grid but within its box', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      pointerTarget = cellAt(grid, 2, 2);
      sendPointer('pointermove', cellAt(grid, 2, 2));

      pointerTarget = document.body;
      const inside = sendPointer('pointermove', document.body, {
        clientX: GRID_LEFT + 20,
        clientY: GRID_TOP + 20,
      });
      expect(inside.defaultPrevented).toBe(false);

      sendPointer('pointerup', document);

      // Fallback keeps the cell the pointer came from.
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('ignores a pointerdown on a non-primary button', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const event = sendPointer('pointerdown', cellAt(grid, 1, 1), { button: 2 });

      expect(event.defaultPrevented).toBe(false);
      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('ignores a pointerdown on the pill', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      const before = selection.getSelectedRange();
      const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

      sendPointer('pointerdown', pill as HTMLElement);

      expect(selection.getSelectedRange()).toStrictEqual(before);
    });

    it('ignores a pointerdown on a grip or resize handle', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const grip = document.createElement('div');

      grip.setAttribute('data-blok-table-grip', '');
      cellAt(grid, 1, 1).appendChild(grip);

      const resize = document.createElement('div');

      resize.setAttribute('data-blok-table-resize', '');
      cellAt(grid, 1, 1).appendChild(resize);

      sendPointer('pointerdown', grip);
      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toBeNull();

      sendPointer('pointerdown', resize);
      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('ignores a pointerdown that lands outside any cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', grid);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('ignores a pointerdown while a grip drag owns the grid', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      grid.style.userSelect = 'none';

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('prevents the native dragstart only while a drag is armed', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const idle = new Event('dragstart', { bubbles: true, cancelable: true });

      grid.dispatchEvent(idle);
      expect(idle.defaultPrevented).toBe(false);

      sendPointer('pointerdown', cellAt(grid, 1, 1));

      const armed = new Event('dragstart', { bubbles: true, cancelable: true });

      grid.dispatchEvent(armed);
      expect(armed.defaultPrevented).toBe(true);
    });

    it('hands pointercancel the same cleanup as pointerup', () => {
      grid = createGrid(3, 3);
      const onPointerDragActiveChange = vi.fn();

      selection = makeSelection({ onPointerDragActiveChange });

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      expect(onPointerDragActiveChange).toHaveBeenLastCalledWith(true);

      sendPointer('pointercancel', document);
      expect(onPointerDragActiveChange).toHaveBeenLastCalledWith(false);
    });

    it('keeps an already boxed single cell when it is clicked again', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      onSelectionActiveChange.mockClear();

      sendPointer('pointerdown', cellAt(grid, 0, 0));

      // No clear-then-repaint: the border must not flash.
      expect(onSelectionActiveChange).not.toHaveBeenCalledWith(false, false);
      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
      });
    });

    it('drops an existing selection when a different cell is pressed', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      onSelectionActiveChange.mockClear();

      sendPointer('pointerdown', cellAt(grid, 2, 2));

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 2,
        maxRow: 2,
        minCol: 2,
        maxCol: 2,
      });
    });

    it('drops the rectangle when the cell also holds a cross-host text range', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      onSelectionActiveChange.mockClear();

      crossHost.active = true;
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      sendPointer('pointerup', document);

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('drops the rectangle when the cell holds a selected block', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      onSelectionActiveChange.mockClear();

      const marker = document.createElement('div');

      marker.setAttribute('data-blok-selected', 'true');
      cellAt(grid, 0, 0).appendChild(marker);

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      sendPointer('pointerup', document);

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('does not box a cell when an inner block selection owns the click', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const marker = document.createElement('div');

      marker.setAttribute('data-blok-selected', 'true');
      cellAt(grid, 0, 0).appendChild(marker);

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('keeps an existing selection when the release carries no inner range', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      onSelectionActiveChange.mockClear();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      sendPointer('pointerup', document);

      // Re-registered, not rebuilt: rebuilding would first report (false, false).
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
      });
      expect(onSelectionActiveChange).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- *
   * Document-level clearing.
   * ---------------------------------------------------------------- */

  describe('clicking away clears the selection', () => {
    it('clears on a pointerdown anywhere else', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      onSelectionActiveChange.mockClear();

      sendPointer('pointerdown', document.body);

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      expect(selection.getSelectedRange()).toBeNull();
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
      expect(selectedCellsIn(grid)).toStrictEqual([]);
    });

    it('does not clear when the pill itself is pressed', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

      sendPointer('pointerdown', pill as HTMLElement);

      expect(selection.getSelectedRange()).not.toBeNull();
    });

    it('does not clear when an open popover is pressed', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover-opened', '');
      document.body.appendChild(popover);

      sendPointer('pointerdown', popover);

      expect(selection.getSelectedRange()).not.toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Focus-driven single-cell box.
   * ---------------------------------------------------------------- */

  describe('focusin paints and clears the single-cell box', () => {
    it('boxes the cell the caret enters', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const input = addBlockInput(cellAt(grid, 1, 2));

      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 2,
        maxCol: 2,
      });
      expect(selectedCoords(grid)).toStrictEqual([[1, 2]]);
    });

    it('does not rebuild the box when the caret stays in the boxed cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const input = addBlockInput(cellAt(grid, 1, 2));

      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const overlay = grid.querySelector(OVERLAY_SELECTOR);

      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(grid.querySelector(OVERLAY_SELECTOR)).toBe(overlay);
    });

    it('rebuilds the box when the caret moves to another cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      addBlockInput(cellAt(grid, 1, 2)).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const overlay = grid.querySelector(OVERLAY_SELECTOR);

      addBlockInput(cellAt(grid, 0, 0)).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(grid.querySelector(OVERLAY_SELECTOR)).not.toBe(overlay);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 0,
      });
    });

    it('clears the box when focus leaves the table', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      onSelectionActiveChange.mockClear();

      const outside = document.createElement('div');

      outside.setAttribute('contenteditable', 'true');
      document.body.appendChild(outside);
      outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('keeps the box while the table chrome holds focus', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const holder = document.createElement('div');

      holder.setAttribute('data-blok-id', 'table-1');
      document.body.appendChild(holder);
      holder.appendChild(grid);

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const chrome = document.createElement('button');

      holder.appendChild(chrome);
      chrome.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).not.toBeNull();
    });

    it('keeps the box while a popover holds focus', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover-opened', '');
      popover.tabIndex = -1;
      document.body.appendChild(popover);
      popover.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).not.toBeNull();
    });

    it('drops the box for a focus target inside the grid but outside a cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const stray = document.createElement('div');

      stray.tabIndex = -1;
      grid.appendChild(stray);
      stray.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('ignores a focusin while a keyboard rectangle is being extended', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      caret.atEnd = true;
      stubSelection({ anchorNode: addBlockInput(cellAt(grid, 1, 1)) });
      pressKey({ key: 'ArrowRight', shiftKey: true });

      addBlockInput(cellAt(grid, 0, 0)).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('ignores a focusin while a pointer drag is armed', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      addBlockInput(cellAt(grid, 0, 0)).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).toBeNull();
      sendPointer('pointerup', document);
    });
  });

  /* ---------------------------------------------------------------- *
   * Programmatic selection API.
   * ---------------------------------------------------------------- */

  describe('programmatic selection API', () => {
    it('selects a whole column', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectColumn(1);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('reports nothing selected before any selection', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('clears an active selection on request', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      selection.clearActiveSelection();

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('reports the range as multi-cell once more than one cell is boxed', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      expect(onSelectionActiveChange).toHaveBeenLastCalledWith(true, true);
    });

    it('reports a single-cell range as not multi-cell', () => {
      grid = createGrid(3, 3);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(onSelectionActiveChange).toHaveBeenLastCalledWith(true, false);
    });

    it('does nothing when the grid has no rows', () => {
      grid = createGrid(3, 3);
      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());
      selection = makeSelection();

      selection.selectColumn(0);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('does nothing when the grid has no columns', () => {
      grid = createGrid(3, 3);
      grid.querySelector('colgroup')?.remove();
      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());
      selection = makeSelection();

      selection.selectRow(0);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('publishes the painted range after a programmatic selection', () => {
      grid = createGrid(3, 3);
      const onSelectionRangeChange = vi.fn();

      selection = makeSelection({ onSelectionRangeChange });

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(onSelectionRangeChange).toHaveBeenCalledWith({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * destroy().
   * ---------------------------------------------------------------- */

  describe('destroy', () => {
    it('stops listening for shortcuts', () => {
      grid = createGrid(2, 2);
      const onFormatCells = vi.fn();

      selection = makeSelection({ onFormatCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      selection.destroy();
      pressKey({ key: 'b', ctrlKey: true });

      expect(onFormatCells).not.toHaveBeenCalled();
    });

    it('removes the painted chrome and reports the selection gone', () => {
      grid = createGrid(2, 2);
      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      onSelectionActiveChange.mockClear();

      selection.destroy();

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
      expect(grid.querySelector(`[${PILL_ATTR}]`)).toBeNull();
      expect(selectedCellsIn(grid)).toStrictEqual([]);
    });

    it('releases the drag lock when destroyed mid-drag', () => {
      grid = createGrid(2, 2);
      const onPointerDragActiveChange = vi.fn();

      selection = makeSelection({ onPointerDragActiveChange });

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      grid.style.userSelect = 'none';
      onPointerDragActiveChange.mockClear();

      selection.destroy();

      expect(onPointerDragActiveChange).toHaveBeenCalledWith(false);
      expect(grid.style.userSelect).toBe('');
    });

    it('does not report a drag release when nothing was armed', () => {
      grid = createGrid(2, 2);
      const onPointerDragActiveChange = vi.fn();

      selection = makeSelection({ onPointerDragActiveChange });
      selection.destroy();

      expect(onPointerDragActiveChange).not.toHaveBeenCalledWith(false);
    });

    it('stops clearing on a later outside click', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      selection.destroy();

      // No throw, and the grid is inert to the click.
      sendPointer('pointerdown', document.body);

      expect(selection.getSelectedRange()).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Cell resolution.
   * ---------------------------------------------------------------- */

  describe('cell resolution', () => {
    it('prefers the stamped logical coordinates over the physical index', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection();

      // Row 0 holds three <td>; the second one is logically column 2.
      const second = grid.querySelectorAll(`[${ROW_ATTR}]`)[0].querySelectorAll(`[${CELL_ATTR}]`)[1];

      sendPointer('pointerdown', second);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 2,
        maxCol: 2,
      });
    });

    it('falls back to the physical index when the grid carries no coordinates', () => {
      grid = createAttrlessGrid(2, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      const second = grid.querySelectorAll(`[${ROW_ATTR}]`)[0].querySelectorAll(`[${CELL_ATTR}]`)[1];

      sendPointer('pointerdown', second);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('falls back to the physical index when the coordinates are unparsable', () => {
      grid = createGrid(2, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      const second = cellAt(grid, 0, 1);

      second.setAttribute(CELL_ROW_ATTR, 'not-a-number');
      second.setAttribute(CELL_COL_ATTR, 'not-a-number');

      sendPointer('pointerdown', second);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('ignores a cell whose row lives outside the grid', () => {
      grid = createGrid(2, 3);
      selection = makeSelection();

      const orphan = document.createElement('table');
      const orphanRow = document.createElement('tr');

      orphanRow.setAttribute(ROW_ATTR, '');
      const orphanCell = document.createElement('td');

      orphanCell.setAttribute(CELL_ATTR, '');
      orphanRow.appendChild(orphanCell);
      orphan.appendChild(orphanRow);
      document.body.appendChild(orphan);

      sendPointer('pointerdown', orphanCell);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Logical column count.
   * ---------------------------------------------------------------- */

  describe('logical column count fallbacks', () => {
    it('counts the colgroup when it has columns', () => {
      grid = createGrid(2, 5);
      selection = makeSelection();

      selection.selectRow(0);

      expect(selection.getSelectedRange()?.maxCol).toBe(4);
    });

    it('falls back to the first row when the colgroup is empty', () => {
      grid = createGrid(2, 3);
      grid.querySelector('colgroup')?.remove();
      selection = makeSelection();

      selection.selectRow(0);

      expect(selection.getSelectedRange()?.maxCol).toBe(2);
    });

    it('reports no columns for a grid with no rows at all', () => {
      grid = document.createElement('table');
      document.body.appendChild(grid);
      selection = makeSelection();

      selection.selectRow(0);

      expect(selection.getSelectedRange()).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Merged-span expansion.
   * ---------------------------------------------------------------- */

  describe('painted rectangle absorbs merges', () => {
    it('pulls a rectangle up and left onto the merge origin', () => {
      grid = createGrid(4, 4);
      selection = makeSelection({ getCellSpan, getMergeOrigin });

      // (1,1) is covered by the 2x2 merge whose origin is (0,0).
      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('iterates until a chained merge stops extending the rectangle', () => {
      grid = createGrid(4, 4);
      // (1,1) is covered by a merge at (1,0); (1,0) is covered by one at (0,0).
      const originOf = (row: number, col: number): [number, number] | null => {
        if (row === 1 && col === 1) {
          return [1, 0];
        }

        return col === 0 && row <= 1 ? [0, 0] : null;
      };

      selection = makeSelection({ getCellSpan, getMergeOrigin: originOf });

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('measures a covered slot from its own coordinates when no origin is known', () => {
      grid = createGrid(3, 3);
      selection = makeSelection({ getCellSpan });

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('leaves the rectangle untouched without a span probe', () => {
      grid = createGrid(3, 3);
      selection = makeSelection({ getMergeOrigin });

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('marks every cell whose span overlaps the rectangle', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection({ getCellSpan, getMergeOrigin });

      // Column 2 only — the 2x2 merge at (0,0) does not reach it.
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 2, maxCol: 2 });

      expect(selectedCoords(grid)).toStrictEqual([
        [0, 2],
        [1, 2],
      ]);
    });

    it('includes a merge that overhangs the rectangle edge', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection({ getCellSpan, getMergeOrigin });

      // (1,1) is covered by the merge at (0,0), so the merge is pulled in.
      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(selectedCoords(grid)).toStrictEqual([
        [0, 0],
      ]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Overlay geometry.
   * ---------------------------------------------------------------- */

  describe('overlay geometry', () => {
    it('positions the overlay from the rectangle corner cells', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      // 2 columns x 2 rows = 400x80, plus the 1px outward bleed on each edge.
      expect(overlay?.style.width).toBe('401px');
      expect(overlay?.style.height).toBe('81px');
      expect(overlay?.style.top).toBe(`${-BORDER_TOP - 1}px`);
      expect(overlay?.style.left).toBe(`${-BORDER_LEFT - 1}px`);
    });

    it('positions from the cell offsets when the rectangle does not start at the origin', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      expect(overlay?.style.width).toBe(`${COL_WIDTH + 1}px`);
      expect(overlay?.style.height).toBe(`${PAINT_ROW_HEIGHT + 1}px`);
      expect(overlay?.style.top).toBe(`${PAINT_ROW_HEIGHT - BORDER_TOP - 1}px`);
      expect(overlay?.style.left).toBe(`${COL_WIDTH - BORDER_LEFT - 1}px`);
    });

    it('treats an unparsable grid border width as zero', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: '',
        borderLeftWidth: '',
      } as unknown as CSSStyleDeclaration);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      expect(overlay?.style.top).toBe('-1px');
      expect(overlay?.style.left).toBe('-1px');
    });

    it('creates the overlay and pill once and reuses them across paints', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      // A drag repaints on every pointermove without tearing the chrome down.
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = cellAt(grid, 0, 1);
      sendPointer('pointermove', cellAt(grid, 0, 1));
      const first = grid.querySelector(OVERLAY_SELECTOR);

      pointerTarget = cellAt(grid, 1, 1);
      sendPointer('pointermove', cellAt(grid, 1, 1));

      expect(grid.querySelector(OVERLAY_SELECTOR)).toBe(first);
      expect(grid.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(1);
      expect(grid.querySelectorAll(`[${PILL_ATTR}]`)).toHaveLength(1);

      sendPointer('pointerup', document);
    });

    it('gives the overlay and pill their fixed attributes', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);
      const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

      expect(overlay?.style.position).toBe('absolute');
      expect(overlay?.style.pointerEvents).toBe('none');
      expect(overlay?.style.boxSizing).toBe('border-box');
      expect(overlay?.style.borderRadius).toBe('2px');
      expect(overlay?.style.border).toBe('2px solid rgb(59, 130, 246)');
      expect(pill?.getAttribute('data-blok-table-cell-menu')).toBe('');
      expect(pill?.getAttribute('contenteditable')).toBe('false');
      expect(pill?.style.pointerEvents).toBe('auto');
      expect(pill?.style.transform).toBe('translate(-50%, -50%)');
      expect(pill?.style.height).toBe('20px');
      expect(pill?.style.width).toBe('4px');
    });

    it('draws the pill menu dots as a cropped three-dot glyph', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const svg = grid.querySelector<SVGElement>(`[${PILL_ATTR}] svg`);

      expect(svg?.getAttribute('width')).toBe('4');
      expect(svg?.getAttribute('height')).toBe('14');
      expect(svg?.getAttribute('viewBox')).toBe('8 3 4 14');
      expect(svg?.getAttribute('fill')).toBe('currentColor');
      expect(svg?.classList.contains('opacity-0')).toBe(true);
      expect(svg?.classList.contains('pointer-events-none')).toBe(true);

      const circles = Array.from(svg?.querySelectorAll('circle') ?? []);

      expect(circles).toHaveLength(3);
      circles.forEach(circle => {
        expect(circle.getAttribute('transform')).toBe('rotate(90 10 10)');
      });
    });

    it('does not paint when the range resolves to no cell', () => {
      const attrless = document.createElement('table');

      addRow(attrless, row => addCell(row, 0, 0));
      document.body.appendChild(attrless);
      grid = attrless;
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 5, minCol: 0, maxCol: 5 });

      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Clicked-same-cell decision — each axis asked separately.
   * ---------------------------------------------------------------- */

  describe('repeat click on the boxed cell', () => {
    /** Presses `at` while `range` is painted and reports whether the box was dropped. */
    const clickWhilePainted = (
      range: { minRow: number; maxRow: number; minCol: number; maxCol: number },
      at: [number, number]
    ): boolean => {
      grid = createGrid(3, 3);

      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });
      selection.selectRange(range);
      onSelectionActiveChange.mockClear();

      sendPointer('pointerdown', cellAt(grid, at[0], at[1]));

      const dropped = onSelectionActiveChange.mock.calls.some(
        call => call[0] === false && call[1] === false
      );

      sendPointer('pointerup', document);

      return dropped;
    };

    it('drops the box when the pressed row is the rectangle minimum', () => {
      expect(clickWhilePainted({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }, [1, 0])).toBe(true);
    });

    it('drops the box when the pressed row is the rectangle maximum', () => {
      expect(clickWhilePainted({ minRow: 0, maxRow: 1, minCol: 1, maxCol: 1 }, [0, 1])).toBe(true);
    });

    it('drops the box when the pressed column is the rectangle minimum', () => {
      expect(clickWhilePainted({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }, [0, 1])).toBe(true);
    });

    it('drops the box when the pressed column is the rectangle maximum', () => {
      expect(clickWhilePainted({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }, [0, 0])).toBe(true);
    });

    it('keeps the box for a 1x1 rectangle pressed on its own cell', () => {
      expect(clickWhilePainted({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 }, [1, 1])).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- *
   * destroy() detaches every listener it installed.
   * ---------------------------------------------------------------- */

  describe('destroy detaches the document listeners', () => {
    const dispatchClipboard = (type: 'copy' | 'cut'): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });

      Object.defineProperty(event, 'clipboardData', {
        value: { setData: vi.fn(), getData: vi.fn() },
      });
      document.dispatchEvent(event);

      return event;
    };

    it('stops boxing a cell on focus', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      selection.destroy();

      addBlockInput(cellAt(grid, 1, 1)).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });

    it('stops copying and cutting', () => {
      grid = createGrid(3, 3);

      const onCopy = vi.fn();
      const onCut = vi.fn();

      selection = makeSelection({ onCopy, onCut });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      selection.destroy();

      const copy = dispatchClipboard('copy');
      const cut = dispatchClipboard('cut');

      expect(onCopy).not.toHaveBeenCalled();
      expect(onCut).not.toHaveBeenCalled();
      expect(copy.defaultPrevented).toBe(false);
      expect(cut.defaultPrevented).toBe(false);
    });

    it('stops clearing on Delete', () => {
      grid = createGrid(3, 3);

      const onClearContent = vi.fn();

      selection = makeSelection({ onClearContent });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      selection.destroy();

      pressKey({ key: 'Delete' });

      expect(onClearContent).not.toHaveBeenCalled();
    });

    it('stops starting a drag on pointerdown', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      selection.destroy();

      sendPointer('pointerdown', cellAt(grid, 1, 1));
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('stops swallowing the native dragstart', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      selection.destroy();

      const event = new Event('dragstart', { bubbles: true, cancelable: true });

      grid.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('stops cancelling the rectangle on mousemove', () => {
      grid = createGrid(2, 2);

      const cancelActiveSelection = vi.fn();

      selection = makeSelection({ rectangleSelection: { cancelActiveSelection } });
      selection.destroy();

      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(cancelActiveSelection).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- *
   * Capture-phase registration.
   * ---------------------------------------------------------------- */

  describe('capture-phase claims', () => {
    it('cancels the rectangle before any bubble-phase mousemove listener', () => {
      grid = createGrid(2, 2);

      const order: string[] = [];
      const onBubble = (): void => {
        order.push('bubble');
      };

      document.addEventListener('mousemove', onBubble);

      selection = makeSelection({
        rectangleSelection: { cancelActiveSelection: () => order.push('cancel') },
      });

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      document.removeEventListener('mousemove', onBubble);

      expect(order).toStrictEqual(['cancel', 'bubble']);
    });

    it('claims the bulk-format key before any bubble-phase keydown listener', () => {
      grid = createGrid(2, 2);

      const bubble = vi.fn();
      const onBubble = (): void => {
        bubble();
      };

      document.addEventListener('keydown', onBubble);

      const onFormatCells = vi.fn();

      selection = makeSelection({ onFormatCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      pressKey({ key: 'b', ctrlKey: true });
      document.removeEventListener('keydown', onBubble);

      expect(bubble).not.toHaveBeenCalled();
      expect(onFormatCells).toHaveBeenCalledTimes(1);
    });

    it('hides the rectangle overlay after cancelling', () => {
      grid = createGrid(2, 2);

      const overlay = document.createElement('div');

      overlay.setAttribute('data-blok-overlay-rectangle', '');
      document.body.appendChild(overlay);

      selection = makeSelection({ rectangleSelection: { cancelActiveSelection: vi.fn() } });
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(overlay.style.display).toBe('none');
      overlay.remove();
    });

    it('tolerates a missing rectangle overlay', () => {
      grid = createGrid(2, 2);
      selection = makeSelection({ rectangleSelection: { cancelActiveSelection: vi.fn() } });

      sendPointer('pointerdown', cellAt(grid, 0, 0));

      expect(() => {
        document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      }).not.toThrow();
    });

    it('does nothing without a rectangle selection to cancel', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));

      expect(() => {
        document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      }).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------- *
   * Caret boundary inside a multi-block cell.
   * ---------------------------------------------------------------- */

  describe('caret boundary across several blocks in one cell', () => {
    it('refuses to extend right from a non-final block', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      const first = addBlockInput(cellAt(grid, 0, 0));

      addBlockInput(cellAt(grid, 0, 0));
      caret.atEnd = true;
      stubSelection({ anchorNode: first });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
      expect(caret.asked).toStrictEqual([]);
    });

    it('extends right from the final block', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      addBlockInput(cellAt(grid, 0, 0));
      const last = addBlockInput(cellAt(grid, 0, 0));

      caret.atEnd = true;
      stubSelection({ anchorNode: last });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('refuses to extend left from a non-first block', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      addBlockInput(cellAt(grid, 0, 1));
      const last = addBlockInput(cellAt(grid, 0, 1));

      caret.atStart = true;
      stubSelection({ anchorNode: last });

      const event = pressKey({ key: 'ArrowLeft', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('extends left from the first block', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      const first = addBlockInput(cellAt(grid, 0, 1));

      addBlockInput(cellAt(grid, 0, 1));
      caret.atStart = true;
      stubSelection({ anchorNode: first });

      const event = pressKey({ key: 'ArrowLeft', shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1,
      });
    });
  });

  describe('drag start clears any native text range', () => {
    it('drops the browser text selection when the rectangle opens', () => {
      grid = createGrid(2, 2);

      const { removeAllRanges } = stubSelection();

      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = cellAt(grid, 1, 1);
      sendPointer('pointermove', cellAt(grid, 1, 1));

      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      sendPointer('pointerup', document);
    });
  });

  /* ---------------------------------------------------------------- *
   * Pill menu.
   * ---------------------------------------------------------------- */

  describe('pill menu', () => {
    const openMenu = (
      over: Partial<ConstructorParameters<typeof TableCellSelection>[0]> = {},
      select: { minRow: number; maxRow: number; minCol: number; maxCol: number } = {
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1,
      }
    ): void => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection(over);
      selection.selectRange(select);
      openPillMenu(grid);
    };

    const activate = (title: string): void => {
      const item = itemNamed(title);

      expect(item, `no ${title} item in the pill menu`).toBeDefined();
      (item?.onActivate as () => void)();
    };

    it('offers only copy and clear when nothing else is wired up', () => {
      openMenu();

      expect(itemTitles()).toStrictEqual([
        'tools.table.copySelection',
        'tools.table.clearSelection',
      ]);
    });

    it('labels copy with the platform modifier and closes on activate', () => {
      const onCopyViaButton = vi.fn();

      openMenu({ onCopyViaButton });

      const copy = itemNamed('tools.table.copySelection');

      expect(copy?.secondaryLabel).toBe(MODIFIER_KEY === 'Meta' ? '⌘C' : 'Ctrl+C');
      expect(copy?.closeOnActivate).toBe(true);
      expect(copy?.icon).toBeDefined();

      activate('tools.table.copySelection');

      expect(onCopyViaButton).toHaveBeenCalledTimes(1);
      expect(onCopyViaButton.mock.calls[0][0]).toHaveLength(2);
    });

    it('labels clear with Del and clears both content and selection', () => {
      const onClearContent = vi.fn();

      openMenu({ onClearContent });

      expect(itemNamed('tools.table.clearSelection')?.secondaryLabel).toBe('Del');

      activate('tools.table.clearSelection');

      expect(onClearContent).toHaveBeenCalledTimes(1);
      expect(onClearContent.mock.calls[0][0]).toHaveLength(2);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('adds a colour entry only when a colour handler exists', () => {
      openMenu();

      expect(itemNamed('tools.table.cellColor')).toBeUndefined();

      openMenu({ onColorChange: vi.fn() });

      const children = itemNamed('tools.table.cellColor')?.children as {
        items: Array<{ type: string; element: unknown }>;
        isFlippable: boolean;
      };

      expect(children.items).toHaveLength(1);
      expect(children.items[0].type).toBe('html');
      expect(children.items[0].element).toBeInstanceOf(HTMLElement);
      expect(children.isFlippable).toBe(false);
    });

    it('seeds the colour picker from the origin cell of the rectangle', () => {
      openMenu(
        {
          onColorChange: vi.fn(),
          getCellColor: (row, col) => `bg-${row}-${col}`,
          getCellTextColor: (row, col) => `fg-${row}-${col}`,
        },
        { minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 }
      );

      expect(colorPickerState.lastOptions?.currentColors).toStrictEqual({
        textColor: 'fg-1-1',
        backgroundColor: 'bg-1-1',
      });
    });

    it('reports no colour when the origin cell has none', () => {
      openMenu({
        onColorChange: vi.fn(),
        getCellColor: () => undefined,
        getCellTextColor: () => undefined,
      });

      expect(colorPickerState.lastOptions?.currentColors).toStrictEqual({
        textColor: null,
        backgroundColor: null,
      });
    });

    it('applies a picked colour to every selected cell', () => {
      const onColorChange = vi.fn();

      openMenu({ onColorChange });

      const options = colorPickerState.lastOptions as {
        onColorSelect: (color: string | null, mode: string) => void;
      };

      options.onColorSelect('#ff0000', 'background');

      expect(onColorChange).toHaveBeenCalledTimes(1);
      expect(onColorChange.mock.calls[0][0]).toHaveLength(2);
      expect(onColorChange.mock.calls[0][1]).toBe('#ff0000');
      expect(onColorChange.mock.calls[0][2]).toBe('background');
    });

    it('focuses the active colour tab when the submenu opens by keyboard', async () => {
      openMenu({ onColorChange: vi.fn() });

      const children = itemNamed('tools.table.cellColor')?.children as { onOpen: () => void };
      const tab = colorPickerState.tab as HTMLElement;
      const focus = vi.spyOn(tab, 'focus').mockImplementation(() => undefined);

      // The menu itself was opened by a synthetic press; a key press is what
      // puts the editor back into keyboard modality.
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      children.onOpen();

      // Deferred: focusing synchronously would fight the click that opened the menu.
      expect(focus).not.toHaveBeenCalled();

      await Promise.resolve();

      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('leaves focus alone when the submenu opens by pointer', () => {
      openMenu({ onColorChange: vi.fn() });

      const children = itemNamed('tools.table.cellColor')?.children as { onOpen: () => void };
      const tab = colorPickerState.tab as HTMLElement;
      const focus = vi.spyOn(tab, 'focus').mockImplementation(() => undefined);

      children.onOpen();

      expect(focus).not.toHaveBeenCalled();
    });

    it('adds a placement entry only when a placement handler exists', () => {
      openMenu();

      expect(itemNamed('tools.table.placement')).toBeUndefined();

      openMenu({ onPlacementChange: vi.fn() });

      const children = itemNamed('tools.table.placement')?.children as {
        items: Array<{ type: string }>;
        isFlippable: boolean;
      };

      expect(children.items).toHaveLength(1);
      expect(children.items[0].type).toBe('html');
      expect(children.isFlippable).toBe(false);
    });

    it('seeds the placement picker from the origin cell', () => {
      openMenu(
        {
          onPlacementChange: vi.fn(),
          getCellPlacement: (row, col) => (row === 1 && col === 1 ? 'bottom-right' : 'top-left'),
        },
        { minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 }
      );

      expect(placementPickerState.lastOptions?.currentPlacement).toBe('bottom-right');
    });

    it('leaves the placement unset when no probe is wired up', () => {
      openMenu({ onPlacementChange: vi.fn() });

      expect(placementPickerState.lastOptions?.currentPlacement).toBeUndefined();
    });

    it('applies a picked placement to every selected cell', () => {
      const onPlacementChange = vi.fn();

      openMenu({ onPlacementChange });

      const options = placementPickerState.lastOptions as {
        onPlacementSelect: (placement: string) => void;
      };

      options.onPlacementSelect('middle-center');

      expect(onPlacementChange).toHaveBeenCalledTimes(1);
      expect(onPlacementChange.mock.calls[0][0]).toHaveLength(2);
      expect(onPlacementChange.mock.calls[0][1]).toBe('middle-center');
    });

    it('offers merge for a multi-cell rectangle and merges it', () => {
      const onMergeCells = vi.fn();

      openMenu({ onMergeCells, canMergeCells: () => true });

      const merge = itemNamed('tools.table.mergeCells');

      expect(merge?.closeOnActivate).toBe(true);
      expect(merge?.icon).toBeDefined();

      activate('tools.table.mergeCells');

      expect(onMergeCells).toHaveBeenCalledWith({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('hides merge when the range is not mergeable', () => {
      openMenu({ onMergeCells: vi.fn(), canMergeCells: () => false });

      expect(itemNamed('tools.table.mergeCells')).toBeUndefined();
    });

    it('hides merge without a mergeability probe', () => {
      openMenu({ onMergeCells: vi.fn() });

      expect(itemNamed('tools.table.mergeCells')).toBeUndefined();
    });

    it('offers split for a click that a merge expanded', () => {
      const onSplitCell = vi.fn();

      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection({
        onSplitCell,
        getCellSpan,
        getMergeOrigin,
        isMergedCell: (row, col) => row === 0 && col === 0,
      });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      openPillMenu(grid);

      expect(itemNamed('tools.table.mergeCells')).toBeUndefined();
      expect(itemNamed('tools.table.splitCell')?.closeOnActivate).toBe(true);

      activate('tools.table.splitCell');

      expect(onSplitCell).toHaveBeenCalledWith(0, 0);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('hides split when the selected cell is not a merge origin', () => {
      openMenu(
        { onSplitCell: vi.fn(), isMergedCell: () => false },
        { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }
      );

      expect(itemNamed('tools.table.splitCell')).toBeUndefined();
    });

    it('hides split for a multi-cell rectangle whose origin is merged', () => {
      openMenu({ onSplitCell: vi.fn(), isMergedCell: () => true });

      expect(itemNamed('tools.table.splitCell')).toBeUndefined();
    });

    it('hides split without a split handler', () => {
      openMenu({ isMergedCell: () => true }, { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      expect(itemNamed('tools.table.splitCell')).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------- *
   * Pill affordance.
   * ---------------------------------------------------------------- */

  describe('pill hover affordance', () => {
    const paintSingleCell = (
      over: Partial<ConstructorParameters<typeof TableCellSelection>[0]> = {}
    ): HTMLElement => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection(over);
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      return grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`) as HTMLElement;
    };

    it('expands on hover and collapses again when the pointer leaves', () => {
      const pill = paintSingleCell();
      const svg = pill.querySelector('svg') as SVGElement;

      pill.dispatchEvent(new MouseEvent('mouseenter'));

      expect(pill.style.width).toBe('16px');
      expect(svg.classList.contains('opacity-100')).toBe(true);
      expect(svg.classList.contains('opacity-0')).toBe(false);

      pill.dispatchEvent(new MouseEvent('mouseleave'));

      expect(pill.style.width).toBe('4px');
      expect(svg.classList.contains('opacity-0')).toBe(true);
      expect(svg.classList.contains('opacity-100')).toBe(false);
    });

    it('opens the menu on a press and does not let the press reach the grid', () => {
      const pill = paintSingleCell();

      popoverState.items = [];

      const event = sendPointer('pointerdown', pill);

      expect(event.defaultPrevented).toBe(true);
      expect(popoverState.items.length).toBeGreaterThan(0);
    });

    it('stays expanded while its menu is open', () => {
      const pill = paintSingleCell();

      sendPointer('pointerdown', pill);
      expect(pill.style.width).toBe('16px');

      pill.dispatchEvent(new MouseEvent('mouseleave'));

      expect(pill.style.width).toBe('16px');
    });

    it('dismisses an open menu when the user clicks away', () => {
      const pill = paintSingleCell();

      sendPointer('pointerdown', pill);
      popoverState.destroyed = 0;

      sendPointer('pointerdown', document.body);

      expect(popoverState.destroyed).toBe(1);
    });

    it('dismisses an open menu on destroy', () => {
      const pill = paintSingleCell();

      sendPointer('pointerdown', pill);
      popoverState.destroyed = 0;

      selection.destroy();

      expect(popoverState.destroyed).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- *
   * Overlay reposition guards.
   * ---------------------------------------------------------------- */

  describe('overlay reposition guards', () => {
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

    it('leaves the overlay where it was when the corner cells are gone', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR) as HTMLElement;
      const width = overlay.style.width;

      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());
      notifyResize?.();

      expect(overlay.style.width).toBe(width);
    });

    it('does nothing when the selection has already gone', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      selection.clearActiveSelection();

      expect(() => notifyResize?.()).not.toThrow();
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Physical-index fallback for the overlay corners.
   * ---------------------------------------------------------------- */

  describe('overlay geometry without coordinate attributes', () => {
    /** Lays out rows and cells by their DOM index, since the grid has no coordinates. */
    const mockIndexRects = (grid: HTMLTableElement, rowHeight: number): void => {
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
        rect(GRID_TOP, GRID_LEFT, 2 * rowHeight, 2 * COL_WIDTH)
      );

      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach((row, r) => {
        row.querySelectorAll(`[${CELL_ATTR}]`).forEach((cell, c) => {
          vi.spyOn(cell as HTMLElement, 'getBoundingClientRect').mockReturnValue(
            rect(GRID_TOP + r * rowHeight, GRID_LEFT + c * COL_WIDTH, rowHeight, COL_WIDTH)
          );
        });
      });

      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        borderTopWidth: `${BORDER_TOP}px`,
        borderLeftWidth: `${BORDER_LEFT}px`,
      } as unknown as CSSStyleDeclaration);
    };

    it('positions from the physical index lookup', () => {
      grid = createAttrlessGrid(2, 2);
      mockIndexRects(grid, PAINT_ROW_HEIGHT);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      expect(overlay?.style.width).toBe('401px');
      expect(overlay?.style.height).toBe('81px');
      expect(overlay?.style.top).toBe(`${-BORDER_TOP - 1}px`);
      expect(overlay?.style.left).toBe(`${-BORDER_LEFT - 1}px`);
    });
  });

  /* ---------------------------------------------------------------- *
   * Clamping a pointer that left the grid.
   * ---------------------------------------------------------------- */

  describe('pointer leaving the grid mid-drag', () => {
    const startDragTo = (from: [number, number], to: [number, number]): void => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();
      sendPointer('pointerdown', cellAt(grid, from[0], from[1]));
      pointerTarget = cellAt(grid, to[0], to[1]);
      sendPointer('pointermove', cellAt(grid, to[0], to[1]));
    };

    const leaveAt = (clientX: number, clientY: number): void => {
      pointerTarget = document.body;
      sendPointer('pointermove', document.body, { clientX, clientY });
    };

    it('does not repaint when the pointer leaves the grid but keeps the same cell', () => {
      startDragTo([1, 0], [1, 1]);

      const before = paintCount();

      leaveAt(GRID_LEFT + 20, GRID_TOP + 20);
      sendPointer('pointerup', document);

      expect(paintCount()).toBe(before);
    });

    it('repaints when only the row survives the clamp', () => {
      startDragTo([0, 0], [0, 1]);

      const before = paintCount();

      // Inside vertically, past the right edge horizontally.
      leaveAt(9999, GRID_TOP + 20);

      expect(paintCount()).toBe(before + 1);

      sendPointer('pointerup', document);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 2,
      });
    });

    it('clamps the column to the first one past the left edge', () => {
      startDragTo([1, 1], [2, 1]);

      leaveAt(0, GRID_TOP + 20);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('treats a pointer exactly on the right edge as inside the grid', () => {
      startDragTo([1, 1], [2, 1]);

      leaveAt(GRID_LEFT + 3 * COL_WIDTH, GRID_TOP + 20);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('treats a pointer exactly on the left edge as inside the grid', () => {
      startDragTo([1, 1], [2, 1]);

      leaveAt(GRID_LEFT, GRID_TOP + 20);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('treats a pointer exactly on the bottom edge as inside the grid', () => {
      startDragTo([1, 1], [1, 2]);

      leaveAt(GRID_LEFT + 20, GRID_TOP + 3 * PAINT_ROW_HEIGHT);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('treats a pointer exactly on the top edge as inside the grid', () => {
      startDragTo([1, 1], [1, 2]);

      leaveAt(GRID_LEFT + 20, GRID_TOP);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('bails out when the grid has lost all its rows mid-drag', () => {
      startDragTo([1, 1], [1, 2]);

      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());

      leaveAt(9999, 9999);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });

    it('bails out when the grid has lost all its columns mid-drag', () => {
      startDragTo([1, 1], [1, 2]);

      grid.querySelector('colgroup')?.remove();
      grid.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => row.remove());

      leaveAt(9999, 9999);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * Keyboard extension, one direction and branch at a time.
   * ---------------------------------------------------------------- */

  describe('keyboard rectangle stepping', () => {
    const caretAt = (row: number, col: number): void => {
      caret.atEnd = true;
      caret.atStart = true;
      stubSelection({ anchorNode: addBlockInput(cellAt(grid, row, col)) });
    };

    const arrow = (key: string): void => {
      pressKey({ key, shiftKey: true });
    };

    it('walks right to the last column and then stops', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(1, 0);

      arrow('ArrowRight');
      expect(selection.getSelectedRange()?.maxCol).toBe(1);

      arrow('ArrowRight');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });

      arrow('ArrowRight');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
    });

    it('steps back right after walking left of the anchor', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(1, 2);

      arrow('ArrowLeft');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });

      arrow('ArrowRight');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 2,
        maxCol: 2,
      });
    });

    it('steps back left after walking right of the anchor', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(1, 1);

      arrow('ArrowRight');
      arrow('ArrowLeft');

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('walks left past the first column and then stops', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(1, 2);

      arrow('ArrowLeft');
      arrow('ArrowLeft');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });

      arrow('ArrowLeft');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
    });

    it('walks up away from the anchor row and then back down', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(2, 1);

      arrow('ArrowUp');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });

      arrow('ArrowUp');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });

      // The extent now sits above the anchor, so the step walks back towards it.
      arrow('ArrowDown');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 2,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('swallows an up step at the first row', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(1, 1);

      arrow('ArrowUp');
      const clamped = selection.getSelectedRange();

      arrow('ArrowUp');
      expect(selection.getSelectedRange()).toStrictEqual(clamped);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('walks down away from the anchor row and then back up', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();
      caretAt(0, 1);

      arrow('ArrowDown');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 1,
        maxCol: 1,
      });

      arrow('ArrowUp');
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 1,
        maxCol: 1,
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * Cells whose coordinate stamps are incomplete.
   * ---------------------------------------------------------------- */

  describe('half-stamped cells', () => {
    it('drops cells that carry only one of the two coordinate attributes', () => {
      grid = createGrid(2, 2);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      const rowOnly = document.createElement('td');

      rowOnly.setAttribute(CELL_ATTR, '');
      rowOnly.setAttribute(CELL_ROW_ATTR, '1');
      grid.querySelectorAll(`[${ROW_ATTR}]`)[0].appendChild(rowOnly);

      const colOnly = document.createElement('td');

      colOnly.setAttribute(CELL_ATTR, '');
      colOnly.setAttribute(CELL_COL_ATTR, '0');
      grid.querySelectorAll(`[${ROW_ATTR}]`)[1].appendChild(colOnly);

      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      expect(selectedCellsIn(grid)).toHaveLength(4);
      expect(rowOnly.hasAttribute(SELECTED_ATTR)).toBe(false);
      expect(colOnly.hasAttribute(SELECTED_ATTR)).toBe(false);
    });

    it('falls back to the physical index for a half-stamped cell', () => {
      grid = createGrid(2, 2);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      const rowOnly = cellAt(grid, 0, 1);

      rowOnly.removeAttribute(CELL_COL_ATTR);

      sendPointer('pointerdown', rowOnly);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 1,
        maxCol: 1,
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * Merge-aware cell lookup.
   * ---------------------------------------------------------------- */

  describe('merge-aware cell lookup', () => {
    /** 2x2 merge whose origin is (1,1); (2,1) is covered by it and by nothing else. */
    const createOffsetMergeGrid = (): HTMLTableElement => {
      const table = document.createElement('table');

      addColgroup(table, 3);
      addRow(table, row => {
        addCell(row, 0, 0);
        addCell(row, 0, 1);
        addCell(row, 0, 2);
      });
      addRow(table, row => {
        addCell(row, 1, 0);
        addCell(row, 1, 1, 2, 2);
      });
      addRow(table, row => {
        addCell(row, 2, 0);
      });
      document.body.appendChild(table);

      return table;
    };

    it('resolves a coordinate covered by an off-diagonal merge', () => {
      grid = createOffsetMergeGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 2, maxRow: 2, minCol: 1, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      expect(overlay).not.toBeNull();
      // The 2x2 merge origin at (1,1) is the only cell covering (2,1).
      expect(overlay?.style.width).toBe(`${2 * COL_WIDTH + 1}px`);
      expect(overlay?.style.height).toBe(`${2 * PAINT_ROW_HEIGHT + 1}px`);
    });

    it('resolves a coordinate covered by a colspan on the same row', () => {
      const table = document.createElement('table');

      addColgroup(table, 2);
      addRow(table, row => {
        addCell(row, 0, 0, 2);
      });
      document.body.appendChild(table);
      grid = table;
      mockRects(grid, PAINT_ROW_HEIGHT, 1, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 });

      const overlay = grid.querySelector<HTMLElement>(OVERLAY_SELECTOR);

      expect(overlay).not.toBeNull();
      expect(overlay?.style.width).toBe(`${2 * COL_WIDTH + 1}px`);
    });

    it('leaves a coordinate no cell covers unpainted', () => {
      const table = document.createElement('table');

      addColgroup(table, 2);
      addRow(table, row => {
        addCell(row, 0, 0);
      });
      addRow(table, row => {
        addCell(row, 1, 1);
      });
      document.body.appendChild(table);
      grid = table;
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      // (1,0) is stamped by no cell at all.
      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 0 });

      expect(selectedCellsIn(grid)).toHaveLength(0);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });

    it('marks a merged cell for a rectangle that only its span reaches', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 });

      expect(selectedCellsIn(grid)).toHaveLength(1);
      expect(selectedCellsIn(grid)[0]).toBe(cellAt(grid, 0, 0));
    });
  });
  /* ---------------------------------------------------------------- *
   * A destroyed instance must be fully inert.
   * ---------------------------------------------------------------- */

  describe('a destroyed instance answers nothing', () => {
    const dispatchClipboard = (type: 'copy' | 'cut', withData: boolean): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });

      if (withData) {
        Object.defineProperty(event, 'clipboardData', {
          value: { setData: vi.fn(), getData: vi.fn() },
        });
      }
      document.dispatchEvent(event);

      return event;
    };

    /** destroy() clears the box, so the rectangle has to be rebuilt to observe a listener. */
    const stillListens = (): {
      onClearContent: Mock<(cells: HTMLElement[]) => void>;
      onCut: Mock<(cells: HTMLElement[], data: DataTransfer) => void>;
      onCopy: Mock<(cells: HTMLElement[], data: DataTransfer) => void>;
      onFormatCells: Mock<(cells: HTMLElement[], mark: CellMark) => void>;
    } => {
      const onClearContent = vi.fn<(cells: HTMLElement[]) => void>();
      const onCut = vi.fn<(cells: HTMLElement[], data: DataTransfer) => void>();
      const onCopy = vi.fn<(cells: HTMLElement[], data: DataTransfer) => void>();
      const onFormatCells = vi.fn<(cells: HTMLElement[], mark: CellMark) => void>();

      grid = createGrid(3, 3);
      selection = makeSelection({ onClearContent, onCut, onCopy, onFormatCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      selection.destroy();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      return { onClearContent, onCut, onCopy, onFormatCells };
    };

    it('ignores Delete', () => {
      const spies = stillListens();

      pressKey({ key: 'Delete' });

      expect(spies.onClearContent).not.toHaveBeenCalled();
    });

    it('ignores cut', () => {
      const spies = stillListens();

      dispatchClipboard('cut', true);

      expect(spies.onCut).not.toHaveBeenCalled();
    });

    it('ignores copy', () => {
      const spies = stillListens();

      dispatchClipboard('copy', true);

      expect(spies.onCopy).not.toHaveBeenCalled();
    });

    it('ignores the bulk-format shortcut', () => {
      const spies = stillListens();

      pressKey({ key: 'b', ctrlKey: true });

      expect(spies.onFormatCells).not.toHaveBeenCalled();
    });

    it('does not start a drag on pointerdown', () => {
      stillListens();

      const before = paintCount();

      sendPointer('pointerdown', cellAt(grid, 1, 1));

      expect(paintCount()).toBe(before);
    });

    it('does not follow the pointer', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      selection.destroy();

      const before = paintCount();

      pointerTarget = cellAt(grid, 2, 2);
      sendPointer('pointermove', cellAt(grid, 2, 2));

      expect(paintCount()).toBe(before);
    });

    it('does not release the drag lock a second time on pointerup', () => {
      grid = createGrid(3, 3);

      const onPointerDragActiveChange = vi.fn();

      selection = makeSelection({ onPointerDragActiveChange });
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      selection.destroy();

      const releases = onPointerDragActiveChange.mock.calls.filter(call => call[0] === false).length;

      sendPointer('pointerup', document);

      expect(
        onPointerDragActiveChange.mock.calls.filter(call => call[0] === false).length
      ).toBe(releases);
    });

    it('does not release the drag lock a second time on pointercancel', () => {
      grid = createGrid(3, 3);

      const onPointerDragActiveChange = vi.fn();

      selection = makeSelection({ onPointerDragActiveChange });
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      selection.destroy();

      const releases = onPointerDragActiveChange.mock.calls.filter(call => call[0] === false).length;

      sendPointer('pointercancel', document);

      expect(
        onPointerDragActiveChange.mock.calls.filter(call => call[0] === false).length
      ).toBe(releases);
    });

    it('does not suppress a later native dragstart', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      selection.destroy();

      const event = new Event('dragstart', { bubbles: true, cancelable: true });

      grid.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not cancel the rectangle selection on mousemove', () => {
      grid = createGrid(2, 2);

      const cancelActiveSelection = vi.fn();

      selection = makeSelection({ rectangleSelection: { cancelActiveSelection } });
      sendPointer('pointerdown', cellAt(grid, 0, 0));
      selection.destroy();

      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(cancelActiveSelection).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- *
   * Guards that only a listener throw can witness.
   * ---------------------------------------------------------------- */

  describe('listener guards', () => {
    it('ignores a focusin whose target is not an element', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Not an element: neither a cell nor a reason to drop the box.
      expect(selection.getSelectedRange()).not.toBeNull();
    });

    it('does not paint when the pointer is still over the anchor and no drag started', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 1, 1));

      const before = paintCount();

      // Leaves the grid before a drag ever started: nothing to clamp yet.
      pointerTarget = document.body;
      sendPointer('pointermove', document.body, { clientX: 9999, clientY: 9999 });

      expect(paintCount()).toBe(before);
    });

    it('ignores a pointerdown that resolves to no cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const before = paintCount();

      sendPointer('pointerdown', grid);

      expect(paintCount()).toBe(before);
    });

    it('ignores a focusin on a cell that has no row', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();

      const stray = document.createElement('div');

      stray.setAttribute(CELL_ATTR, '');
      grid.appendChild(stray);

      stray.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(selection.getSelectedRange()).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Clipboard deferral, decided from the real selection.
   * ---------------------------------------------------------------- */

  describe('native text selection probe', () => {
    const dispatchClipboard = (type: 'copy' | 'cut'): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });

      Object.defineProperty(event, 'clipboardData', {
        value: { setData: vi.fn(), getData: vi.fn() },
      });
      document.dispatchEvent(event);

      return event;
    };

    it('copies the cell when the browser has only a collapsed caret', () => {
      const onCopy = vi.fn();

      grid = createPlainGrid();
      selection = makeSelection({ onCopy });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true } as unknown as Selection);

      const event = dispatchClipboard('copy');

      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('copies the cell when the browser has no selection object at all', () => {
      const onCopy = vi.fn();

      grid = createPlainGrid();
      selection = makeSelection({ onCopy });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const event = dispatchClipboard('copy');

      expect(onCopy).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores a cut that carries no clipboard payload', () => {
      const onCut = vi.fn();

      grid = createPlainGrid();
      selection = makeSelection({ onCut });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = new Event('cut', { bubbles: true, cancelable: true });

      document.dispatchEvent(event);

      expect(onCut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores a copy with no selection at all', () => {
      const onCopy = vi.fn();

      grid = createPlainGrid();
      selection = makeSelection({ onCopy });

      const event = dispatchClipboard('copy');

      expect(onCopy).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores a cut with no selection at all', () => {
      const onCut = vi.fn();

      grid = createPlainGrid();
      selection = makeSelection({ onCut });

      const event = dispatchClipboard('cut');

      expect(onCut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- *
   * Fill scope and payload.
   * ---------------------------------------------------------------- */

  describe('fill payload', () => {
    it('hands over every selected cell', () => {
      const onFillCells = vi.fn();

      grid = createGrid(2, 2);
      selection = makeSelection({ onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      pressKey({ key: 'r', ctrlKey: true });

      expect(onFillCells.mock.calls[0][0]).toHaveLength(4);
    });

    it('ignores a bare R with no modifier', () => {
      const onFillCells = vi.fn();

      grid = createGrid(2, 2);
      selection = makeSelection({ onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      pressKey({ key: 'r' });

      expect(onFillCells).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- *
   * Split availability for a plain single cell.
   * ---------------------------------------------------------------- */

  describe('split availability for a single cell', () => {
    it('offers split for one merge-origin cell', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection({
        onSplitCell: () => undefined,
        isMergedCell: () => true,
      });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      openPillMenu(grid);

      expect(itemTitles()).toContain('tools.table.splitCell');
    });
  });

  /* ---------------------------------------------------------------- *
   * Rectangle growth must be detected on every axis.
   * ---------------------------------------------------------------- */

  describe('merge expansion notices a change on each axis alone', () => {
    /**
     * Each case makes ONE axis the only thing the first pass changes, and then
     * needs the second pass to find more — so a `changed` test that ignores that
     * axis stops the loop early and returns a smaller rectangle.
     */
    const expand = (
      originOf: (row: number, col: number) => [number, number] | null,
      spanOf: (row: number, col: number) => { colspan: number; rowspan: number }
    ): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null => {
      grid = createGrid(3, 3);
      selection = makeSelection({ getMergeOrigin: originOf, getCellSpan: spanOf });
      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      return selection.getSelectedRange();
    };

    const unit = { colspan: 1, rowspan: 1 };

    it('follows a minimum-row-only change into the next step', () => {
      const range = expand(
        (row, col) => {
          if (row === 1 && col === 1) {
            return [0, 1];
          }

          return row === 0 && col === 1 ? [0, 0] : null;
        },
        () => unit
      );

      expect(range).toStrictEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    });

    it('follows a maximum-row-only change into the next step', () => {
      const range = expand(
        (row, col) => {
          if (row === 1 && col === 1) {
            return [1, 1];
          }

          return row === 2 && col === 1 ? [2, 0] : null;
        },
        (row, col) => (row === 1 && col === 1 ? { colspan: 1, rowspan: 2 } : unit)
      );

      expect(range).toStrictEqual({ minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 });
    });

    it('follows a minimum-column-only change into the next step', () => {
      const range = expand(
        (row, col) => {
          if (row === 1 && col === 1) {
            return [1, 0];
          }

          return row === 1 && col === 0 ? [0, 0] : null;
        },
        () => unit
      );

      expect(range).toStrictEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    });

    it('follows a maximum-column-only change into the next step', () => {
      const range = expand(
        (row, col) => {
          if (row === 1 && (col === 1 || col === 2)) {
            return [1, 1];
          }

          return null;
        },
        (row, col) => (row === 1 && col === 1 ? { colspan: 2, rowspan: 1 } : unit)
      );

      expect(range).toStrictEqual({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 });
    });
  });

  /* ---------------------------------------------------------------- *
   * A merge that only its ROWSPAN reaches.
   * ---------------------------------------------------------------- */

  describe('rowspan-only merge overlap', () => {
    it('marks the merge that a lower row is covered by', () => {
      grid = createMergedGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 4);
      selection = makeSelection();

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(selectedCellsIn(grid)).toStrictEqual([cellAt(grid, 0, 0)]);
    });
  });


  /* ---------------------------------------------------------------- *
   * Callbacks the host never wired up.
   * ---------------------------------------------------------------- */

  describe('missing optional callbacks', () => {
    it('deletes a rectangle with no clear-content handler', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      pressKey({ key: 'Delete' });

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('bulk-formats a rectangle with no format handler', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = pressKey({ key: 'b', ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
    });

    it('fills a rectangle with no fill handler', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = pressKey({ key: 'r', ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
    });

    it('copies a rectangle with no copy handler', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = new Event('copy', { bubbles: true, cancelable: true });

      Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('cuts a rectangle with no cut handler', () => {
      grid = createGrid(2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

      const event = new Event('cut', { bubbles: true, cancelable: true });

      Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
      document.dispatchEvent(event);

      expect(selection.getSelectedRange()).toBeNull();
    });

    it('starts a drag when the browser exposes no selection object', () => {
      grid = createGrid(2, 2);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = cellAt(grid, 1, 1);
      sendPointer('pointermove', cellAt(grid, 1, 1));
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });
    });

    it('extends the keyboard rectangle when the browser exposes no selection object', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      caret.atEnd = true;
      stubSelection({ anchorNode: addBlockInput(cellAt(grid, 1, 1)) });
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('activates the menu entries that have no handlers', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      openPillMenu(grid);

      expect(() => {
        (itemNamed('tools.table.copySelection')?.onActivate as () => void)();
        (itemNamed('tools.table.clearSelection')?.onActivate as () => void)();
      }).not.toThrow();
    });

    it('does not offer split with no merge probe', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection({ onSplitCell: () => undefined });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      openPillMenu(grid);

      expect(itemNamed('tools.table.splitCell')).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------- *
   * Marker and overlay attribute values.
   * ---------------------------------------------------------------- */

  describe('painted attribute values', () => {
    it('stamps the bare empty value on the marker and the overlay', () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      expect(cellAt(grid, 0, 0).getAttribute(SELECTED_ATTR)).toBe('');
      expect(grid.querySelector(OVERLAY_SELECTOR)?.getAttribute(OVERLAY_ATTR)).toBe('');
    });

    it('unmarks the cells the rectangle has moved off while dragging', () => {
      grid = createGrid(3, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 3, 3);
      selection = makeSelection();

      sendPointer('pointerdown', cellAt(grid, 0, 0));
      pointerTarget = cellAt(grid, 0, 2);
      sendPointer('pointermove', cellAt(grid, 0, 2));
      pointerTarget = cellAt(grid, 0, 1);
      sendPointer('pointermove', cellAt(grid, 0, 1));
      sendPointer('pointerup', document);

      expect(selectedCoords(grid)).toStrictEqual([
        [0, 0],
        [0, 1],
      ]);
    });

    it('drops the box on a press the document listener stands down for', () => {
      grid = createGrid(3, 3);

      const onSelectionActiveChange = vi.fn();

      selection = makeSelection({ onSelectionActiveChange });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
      onSelectionActiveChange.mockClear();

      // Inside an open popover: the document clear handler deliberately stands
      // down, so only the grid's own handler can drop the box.
      const shell = document.createElement('div');

      shell.setAttribute('data-blok-popover-opened', '');
      document.body.appendChild(shell);
      shell.appendChild(grid);

      sendPointer('pointerdown', cellAt(grid, 2, 2));

      expect(onSelectionActiveChange).toHaveBeenCalledWith(false, false);
    });
  });

  /* ---------------------------------------------------------------- *
   * Menu wiring.
   * ---------------------------------------------------------------- */

  describe('pill menu wiring', () => {
    const openMenu = (): HTMLElement => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection({ onPlacementChange: vi.fn() });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      openPillMenu(grid);

      return grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`) as HTMLElement;
    };

    it('anchors the menu on the pill and lets it flip', () => {
      const pill = openMenu();

      expect(popoverState.params?.trigger).toBe(pill);
      expect(popoverState.params?.flippable).toBe(true);
    });

    it('names the placement entry', () => {
      openMenu();

      expect(itemNamed('tools.table.placement')?.name).toBe('cellPlacement');
    });

    it('closes the menu when clear is activated', () => {
      openMenu();

      expect(itemNamed('tools.table.clearSelection')?.closeOnActivate).toBe(true);
    });

    it('replaces the previous menu on a second press', () => {
      const pill = openMenu();

      popoverState.destroyed = 0;
      sendPointer('pointerdown', pill);

      expect(popoverState.destroyed).toBe(1);
    });

    it('tears itself down when the popover reports it closed', () => {
      const pill = openMenu();

      expect(typeof popoverState.closed).toBe('function');

      popoverState.destroyed = 0;
      (popoverState.closed as () => void)();

      expect(popoverState.destroyed).toBe(1);
      expect(pill.style.width).toBe('4px');
    });

    it('keeps the pill press away from the document listeners', () => {
      const pill = openMenu();
      const sink = vi.fn();

      document.addEventListener('pointerdown', sink);
      sendPointer('pointerdown', pill);
      document.removeEventListener('pointerdown', sink);

      expect(sink).not.toHaveBeenCalled();
    });

    it('keeps the fill key away from the bubble-phase listeners', () => {
      grid = createGrid(2, 2);

      const sink = vi.fn();
      const onBubble = (): void => {
        sink();
      };

      document.addEventListener('keydown', onBubble);
      selection = makeSelection({ onFillCells: vi.fn() });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      pressKey({ key: 'r', ctrlKey: true });
      document.removeEventListener('keydown', onBubble);

      expect(sink).not.toHaveBeenCalled();
    });

    it('survives a submenu whose tab has gone', async () => {
      grid = createPlainGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection({ onColorChange: vi.fn() });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
      openPillMenu(grid);

      const children = itemNamed('tools.table.cellColor')?.children as { onOpen: () => void };

      colorPickerState.tab?.remove();
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      children.onOpen();

      await Promise.resolve();

      expect(colorPickerState.tab?.isConnected).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- *
   * Half-unparsable coordinates.
   * ---------------------------------------------------------------- */

  describe('one unparsable coordinate', () => {
    it('falls back to the physical index when only the column is unparsable', () => {
      grid = createGrid(2, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      const cell = cellAt(grid, 0, 1);

      cell.setAttribute(CELL_COL_ATTR, 'not-a-number');

      sendPointer('pointerdown', cell);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 0,
        maxRow: 0,
        minCol: 1,
        maxCol: 1,
      });
    });

    it('falls back to the physical index when only the row is unparsable', () => {
      grid = createGrid(2, 3);
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      const cell = cellAt(grid, 1, 0);

      cell.setAttribute(CELL_ROW_ATTR, 'not-a-number');

      sendPointer('pointerdown', cell);
      sendPointer('pointerup', document);

      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 0,
        maxCol: 0,
      });
    });
  });


  /* ---------------------------------------------------------------- *
   * Precise merge-lookup rejections.
   * ---------------------------------------------------------------- */

  describe('merge lookup rejects the right cells', () => {
    /** Two rows, a hole at (0,1), and a second cell only on the lower row. */
    const holeyGrid = (): HTMLTableElement => {
      const table = document.createElement('table');

      addColgroup(table, 2);
      addRow(table, row => {
        addCell(row, 0, 0);
      });
      addRow(table, row => {
        addCell(row, 1, 1);
      });
      document.body.appendChild(table);

      return table;
    };

    it('leaves a same-row coordinate no cell covers unpainted', () => {
      grid = holeyGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      // (0,1) is stamped by no cell and reached by no span.
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 });

      expect(selectedCellsIn(grid)).toHaveLength(0);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });

    it('leaves a coordinate whose row no cell reaches unpainted', () => {
      grid = holeyGrid();
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 2);
      selection = makeSelection();

      selection.selectRange({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 0 });

      expect(selectedCellsIn(grid)).toHaveLength(0);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });

    it('leaves a coordinate to the left of a spanning cell unpainted', () => {
      const table = document.createElement('table');

      addColgroup(table, 3);
      addRow(table, row => {
        addCell(row, 0, 0);
        addCell(row, 0, 2);
      });
      addRow(table, row => {
        addCell(row, 1, 0);
      });
      document.body.appendChild(table);
      grid = table;
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      // (0,1) is a hole; the cell at (0,2) starts to its right.
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 1, maxCol: 1 });

      expect(selectedCellsIn(grid)).toHaveLength(0);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });

    it('leaves a coordinate above a spanning cell unpainted', () => {
      const table = document.createElement('table');

      addColgroup(table, 3);
      addRow(table, row => {
        addCell(row, 0, 0);
        addCell(row, 0, 1);
      });
      addRow(table, row => {
        addCell(row, 1, 1, 2);
      });
      document.body.appendChild(table);
      grid = table;
      mockRects(grid, PAINT_ROW_HEIGHT, 2, 3);
      selection = makeSelection();

      // (0,2) is beside the 2-wide cell on the row below.
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 2, maxCol: 2 });

      expect(selectedCellsIn(grid)).toHaveLength(0);
      expect(grid.querySelector(OVERLAY_SELECTOR)).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * A caret that leaves the cell it started in.
   * ---------------------------------------------------------------- */

  describe('caret resolved to no cell', () => {
    it('does not extend when the caret sits in the grid but outside any cell', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const loose = document.createElement('div');

      loose.setAttribute('contenteditable', 'true');
      grid.appendChild(loose);

      caret.atEnd = true;
      stubSelection({ anchorNode: loose });

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(false);
      expect(selection.getSelectedRange()).toBeNull();
    });

    it('extends when the selection object vanishes after the caret was read', () => {
      grid = createGrid(3, 3);
      selection = makeSelection();

      const input = addBlockInput(cellAt(grid, 1, 1));

      caret.atEnd = true;

      const readable = {
        anchorNode: input,
        isCollapsed: true,
        rangeCount: 0,
        removeAllRanges: vi.fn(),
      };
      let calls = 0;

      vi.spyOn(window, 'getSelection').mockImplementation(
        () => (calls++ === 0 ? (readable as unknown as Selection) : null)
      );

      const event = pressKey({ key: 'ArrowRight', shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(selection.getSelectedRange()).toStrictEqual({
        minRow: 1,
        maxRow: 1,
        minCol: 1,
        maxCol: 2,
      });
    });
  });

});

