import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';
const SELECTED_ATTR = 'data-blok-table-cell-selected';
const PILL_ATTR = 'data-blok-table-selection-pill';

const MERGE_TITLE = 'tools.table.mergeCells';
const SPLIT_TITLE = 'tools.table.splitCell';

interface MockPopoverItem {
  onActivate?: () => void;
  title?: string;
}

interface MockPopoverArgs {
  items?: MockPopoverItem[];
}

interface MockPopover {
  hide: () => void;
  getElement: () => HTMLElement;
}

const popoverState: { lastArgs: MockPopoverArgs | null; last: MockPopover | null } = { lastArgs: null, last: null };

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');
    private closedHandlers: Array<() => void> = [];
    constructor(args: MockPopoverArgs) {
      popoverState.lastArgs = args;
      popoverState.last = this;
      // The real popover container is focusable (tabindex=0).
      this.el.tabIndex = 0;
    }
    show(): void {
      this.el.setAttribute('data-blok-popover-opened', 'true');
      document.body.appendChild(this.el);
    }
    // Like the real one: hide() emits Closed, destroy() hides first.
    hide(): void {
      this.el.removeAttribute('data-blok-popover-opened');
      this.closedHandlers.forEach(handler => handler());
    }
    destroy(): void {
      this.hide();
      this.el.remove();
    }
    on(_event: string, handler: () => void): void {
      this.closedHandlers.push(handler);
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
  PopoverEvent: { Closed: 'closed' },
}));

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: () => ({ element: document.createElement('div') }),
}));

vi.mock('../../../../src/tools/table/table-cell-placement-picker', () => ({
  createCellPlacementPicker: () => ({ element: document.createElement('div') }),
}));

import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent } from '../../../../src/tools/table/types';
import type { I18n } from '../../../../types/api';

const i18n = { t: (key: string) => key, has: () => false } as unknown as I18n;

const COL_WIDTH = 100;
const ROW_HEIGHT = 40;

interface Rect {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Real model of `rows x cols` cells, with the given rects merged in order.
 */
const makeModel = (rows: number, cols: number, merges: Rect[] = []): TableModel => {
  const content: CellContent[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ blocks: [`r${r}c${c}`] })));
  const model = new TableModel({ withHeadings: false, withHeadingColumn: false, content });

  merges.forEach(rect => {
    if (!model.canMergeCells(rect)) {
      throw new Error(`fixture merge refused: ${JSON.stringify(rect)}`);
    }
    model.mergeCells(rect);
  });

  return model;
};

/**
 * Render the grid the way the table tool does: covered slots get no <td>,
 * origins carry colSpan/rowSpan, every <td> carries logical coordinates and
 * one contenteditable block.
 */
const renderGrid = (model: TableModel): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: model.cols }).forEach(() => colgroup.appendChild(document.createElement('col')));
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  Array.from({ length: model.rows }, (_, r) => r).forEach(r => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');

    Array.from({ length: model.cols }, (_, c) => c).forEach(c => {
      if (model.isSpannedCell(r, c)) {
        return;
      }

      const span = model.getCellSpan(r, c);

      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_ROW_ATTR, String(r));
      td.setAttribute(CELL_COL_ATTR, String(c));
      td.colSpan = span.colspan;
      td.rowSpan = span.rowspan;

      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const holder = document.createElement('div');

      holder.setAttribute('data-blok-id', `b-${r}-${c}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      editable.textContent = `cell ${r}${c}`;

      holder.appendChild(editable);
      container.appendChild(holder);
      td.appendChild(container);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  document.body.appendChild(table);

  const makeRect = (top: number, left: number, width: number, height: number): DOMRect => ({
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

  vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(
    makeRect(0, 0, model.cols * COL_WIDTH, model.rows * ROW_HEIGHT)
  );

  table.querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`).forEach(td => {
    const r = Number(td.getAttribute(CELL_ROW_ATTR));
    const c = Number(td.getAttribute(CELL_COL_ATTR));

    vi.spyOn(td, 'getBoundingClientRect').mockReturnValue(
      makeRect(r * ROW_HEIGHT, c * COL_WIDTH, td.colSpan * COL_WIDTH, td.rowSpan * ROW_HEIGHT)
    );
  });

  return table;
};

interface Harness {
  grid: HTMLTableElement;
  selection: TableCellSelection;
  onMergeCells: ReturnType<typeof vi.fn>;
  onSplitCell: ReturnType<typeof vi.fn>;
}

/**
 * Wire TableCellSelection to the REAL model, mirroring table-subsystems.ts
 * (canMergeCells / onMergeCells / isMergedCell / onSplitCell / getCellSpan /
 * getMergeOrigin).
 */
const mount = (model: TableModel): Harness => {
  const grid = renderGrid(model);
  const onMergeCells = vi.fn((range: Rect) => {
    model.mergeCells(range);
  });
  const onSplitCell = vi.fn((row: number, col: number) => {
    model.splitCell(row, col);
  });
  const selection = new TableCellSelection({
    grid,
    i18n,
    canMergeCells: range => model.canMergeCells(range),
    onMergeCells,
    isMergedCell: (row, col) => model.isMergedCell(row, col),
    onSplitCell,
    getCellSpan: (row, col) => model.getCellSpan(row, col),
    getMergeOrigin: (row, col) => model.getMergeOrigin(row, col),
    getCellPlacement: (row, col) => model.getCellPlacement(row, col),
    onPlacementChange: () => undefined,
  });

  return { grid, selection, onMergeCells, onSplitCell };
};

const cellAt = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = grid.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

  if (cell === null) {
    throw new Error(`no <td> at ${row},${col}`);
  }

  return cell;
};

const editableAt = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const editable = cellAt(grid, row, col).querySelector<HTMLElement>('[contenteditable="true"]');

  if (editable === null) {
    throw new Error(`no editable at ${row},${col}`);
  }

  return editable;
};

/**
 * Pointer-drag from one <td> to another, like a user dragging a rectangle.
 * elementFromPoint is not implemented by jsdom, so each move names its target.
 */
const drag = (grid: HTMLElement, from: [number, number], path: Array<[number, number]>): void => {
  const start = cellAt(grid, from[0], from[1]);

  start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

  path.forEach(([r, c]) => {
    const target = cellAt(grid, r, c);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
  });

  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
};

const placeCaretAtEnd = (editable: HTMLElement): void => {
  const text = editable.firstChild;

  if (text === null) {
    throw new Error('editable has no text');
  }

  const range = document.createRange();

  range.setStart(text, (text.textContent ?? '').length);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

/**
 * Put the caret in a cell the way a real user does: focus lands first (which
 * boxes the cell through the focusin handler), then the caret is at the end.
 */
const focusCellEnd = (editable: HTMLElement): void => {
  editable.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  placeCaretAtEnd(editable);
};

const shiftArrow = (target: HTMLElement, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true }));
};

const selectedCoords = (grid: HTMLElement): string[] =>
  Array.from(grid.querySelectorAll(`[${SELECTED_ATTR}]`))
    .map(cell => `${cell.getAttribute(CELL_ROW_ATTR)}:${cell.getAttribute(CELL_COL_ATTR)}`)
    .sort();

// A function read, so TS does not keep the `= null` narrowing across the dispatch.
const readLastArgs = (): MockPopoverArgs | null => popoverState.lastArgs;

/**
 * Open the pill menu and return its items.
 */
const openMenu = (grid: HTMLElement): MockPopoverItem[] => {
  const pill = grid.querySelector<HTMLElement>(`[${PILL_ATTR}]`);

  if (pill === null) {
    throw new Error('no selection pill');
  }

  popoverState.lastArgs = null;
  pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

  return readLastArgs()?.items ?? [];
};

const titles = (items: MockPopoverItem[]): string[] =>
  items.map(item => item.title ?? '').filter(title => title === MERGE_TITLE || title === SPLIT_TITLE);

const findItem = (items: MockPopoverItem[], title: string): MockPopoverItem => {
  const item = items.find(candidate => candidate.title === title);

  if (item === undefined) {
    throw new Error(`no "${title}" item`);
  }

  return item;
};

describe('merge audit — selection → Merge/Split menu gate', () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    popoverState.lastArgs = null;
    popoverState.last = null;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      borderTopWidth: '0',
      borderLeftWidth: '0',
      whiteSpace: 'normal',
    } as unknown as CSSStyleDeclaration);
  });

  afterEach(() => {
    harness?.selection.destroy();
    harness?.grid.remove();
    harness = null;
    Reflect.deleteProperty(document, 'elementFromPoint');
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('pointer paths (REFUTED — work)', () => {
    it('drag from a merged cell outward to an unmerged neighbour offers Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      drag(harness.grid, [0, 0], [[0, 2]]);

      expect(titles(openMenu(harness.grid))).toEqual([MERGE_TITLE]);
    });

    it('drag from an unmerged cell into a merged cell offers Merge', () => {
      const model = makeModel(3, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      drag(harness.grid, [2, 2], [[0, 0]]);

      expect(titles(openMenu(harness.grid))).toEqual([MERGE_TITLE]);
      expect(selectedCoords(harness.grid)).toEqual(['0:0', '0:2', '1:2', '2:0', '2:1', '2:2']);
    });

    it('drag covering two whole merged cells offers Merge, and merging combines them', () => {
      const model = makeModel(2, 4, [
        { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 },
        { minRow: 0, maxRow: 1, minCol: 2, maxCol: 3 },
      ]);

      harness = mount(model);
      drag(harness.grid, [0, 0], [[0, 2]]);

      const items = openMenu(harness.grid);

      expect(titles(items)).toEqual([MERGE_TITLE]);
      findItem(items, MERGE_TITLE).onActivate?.();
      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 4, rowspan: 2 });
    });

    it('drag out of a merged cell and back onto it offers Split, not Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      drag(harness.grid, [0, 0], [[0, 2], [0, 0]]);

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('single click on a merged cell offers Split, not Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      drag(harness.grid, [0, 0], []);

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('rect expansion reaches a fixpoint across a chain of staggered merges and offers Merge', () => {
      /**
       *      c0 c1 c2 c3
       * r0  [A  A] .  .
       * r1   . [B  B] .
       * r2   .  . [C  C]
       * Drag (0,2) -> B: the rect first reaches col 1 via B, then col 0 via A,
       * which is only exposed by the first pull.
       */
      const model = makeModel(3, 4, [
        { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 },
        { minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 },
        { minRow: 2, maxRow: 2, minCol: 2, maxCol: 3 },
      ]);

      harness = mount(model);
      drag(harness.grid, [0, 2], [[1, 1]]);

      expect(titles(openMenu(harness.grid))).toEqual([MERGE_TITLE]);
      expect(selectedCoords(harness.grid)).toEqual(['0:0', '0:2', '1:0', '1:1']);
    });
  });

  describe('shift-click', () => {
    it('shift-click is not a range gesture: it re-boxes the clicked cell, it does not extend to it', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      drag(harness.grid, [0, 0], []);
      cellAt(harness.grid, 0, 2).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, shiftKey: true }));

      expect(selectedCoords(harness.grid)).toEqual(['0:2']);
      expect(titles(openMenu(harness.grid))).toEqual([]);
    });
  });

  describe('programmatic paths', () => {
    it('selectRange on a single covered coordinate expands to the merge and offers Split', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      harness.selection.selectRange({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 });

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('re-applying a boxed merged cell\'s own range (setData selection restore) still offers Split, not Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      harness = mount(model);
      // Box the merged cell the way a click does.
      drag(harness.grid, [0, 0], []);

      const boxed = harness.selection.getSelectedRange();

      expect(boxed).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      if (boxed === null) {
        throw new Error('nothing boxed');
      }

      // Table.setData does exactly this: getSelectedRange() → teardown → selectRange(saved).
      harness.selection.selectRange(boxed);

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('activating Merge on a range that is exactly one merged cell does not wipe its placement', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      model.setCellPlacement(0, 0, 'middle-center');
      harness = mount(model);
      harness.selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const items = openMenu(harness.grid);
      const merge = items.find(item => item.title === MERGE_TITLE);

      merge?.onActivate?.();

      expect(model.getCellPlacement(0, 0)).toBe('middle-center');
      expect(harness.onMergeCells).not.toHaveBeenCalled();
    });

    it('a Merge item whose range went stale under the open menu cannot corrupt the model', () => {
      const model = makeModel(3, 3);

      harness = mount(model);
      drag(harness.grid, [0, 0], [[1, 1]]);

      const items = openMenu(harness.grid);

      // A merge lands under the open menu without a rebuild, partially overlapping the range.
      model.mergeCells({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });
      findItem(items, MERGE_TITLE).onActivate?.();

      expect(harness.onMergeCells).toHaveBeenCalledWith({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      expect(model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
      expect(model.getCellSpan(1, 1)).toEqual({ colspan: 2, rowspan: 2 });
    });

    it('selectRow on a row that is one full-width merged cell offers Split, not Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 }]);

      harness = mount(model);
      harness.selection.selectRow(0);

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('selectColumn on a column that is one full-height merged cell offers Split, not Merge', () => {
      const model = makeModel(3, 2, [{ minRow: 0, maxRow: 2, minCol: 0, maxCol: 0 }]);

      harness = mount(model);
      harness.selection.selectColumn(0);

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });
  });

  describe('model gate', () => {
    it('canMergeCells refuses a rect that is exactly one existing merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 })).toBe(false);
    });

    it('mergeCells on a rect that is exactly one existing merge keeps the origin placement and blocks', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 }]);

      model.setCellPlacement(0, 0, 'bottom-right');

      const blocksBefore = model.getCellBlocks(0, 0);

      model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });

      expect(model.getCellPlacement(0, 0)).toBe('bottom-right');
      expect(model.getCellBlocks(0, 0)).toEqual(blocksBefore);
    });

    it('canMergeCells still accepts a merge plus a neighbour', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }]);

      expect(model.canMergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 })).toBe(true);
    });
  });

  describe('focus after a menu action', () => {
    const popover = (): MockPopover => {
      const last = popoverState.last;

      if (last === null) {
        throw new Error('no popover');
      }

      return last;
    };

    it('Copy from the menu returns focus to the cell and keeps a pointer rectangle', () => {
      const model = makeModel(3, 3);

      harness = mount(model);

      const editable = editableAt(harness.grid, 0, 0);

      editable.focus();
      drag(harness.grid, [0, 0], [[1, 1]]);

      const items = openMenu(harness.grid);

      // Pressing a menu item moves focus into the popover.
      popover().getElement().focus();
      findItem(items, 'tools.table.copySelection').onActivate?.();
      popover().hide();

      expect(editable).toHaveFocus();
      expect(selectedCoords(harness.grid)).toEqual(['0:0', '0:1', '1:0', '1:1']);
    });

    it('closing the menu does not pull focus back when the user already moved it elsewhere', () => {
      const model = makeModel(3, 3);

      harness = mount(model);

      const editable = editableAt(harness.grid, 0, 0);
      const outside = document.createElement('input');

      document.body.appendChild(outside);
      editable.focus();
      drag(harness.grid, [0, 0], [[1, 1]]);
      openMenu(harness.grid);
      outside.focus();
      popover().hide();

      expect(outside).toHaveFocus();
    });
  });

  describe('keyboard paths', () => {
    it('Shift+Right out of a merged cell offers Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }]);

      harness = mount(model);

      const editable = editableAt(harness.grid, 0, 0);

      focusCellEnd(editable);
      shiftArrow(editable, 'ArrowRight');

      expect(selectedCoords(harness.grid)).toEqual(['0:0', '0:2']);
      expect(titles(openMenu(harness.grid))).toEqual([MERGE_TITLE]);
    });

    it('Shift+Right then Shift+Left from a merged cell returns to that cell and offers Split, not Merge', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }]);

      harness = mount(model);

      const editable = editableAt(harness.grid, 0, 0);

      focusCellEnd(editable);
      shiftArrow(editable, 'ArrowRight');
      shiftArrow(editable, 'ArrowLeft');

      if (selectedCoords(harness.grid).join() !== '0:0') {
        throw new Error(`precondition: expected only the merged cell boxed, got ${selectedCoords(harness.grid).join()}`);
      }

      expect(titles(openMenu(harness.grid))).toEqual([SPLIT_TITLE]);
    });

    it('Shift+Left shrinks a keyboard rectangle back off a merged cell it swallowed', () => {
      const model = makeModel(2, 3, [{ minRow: 0, maxRow: 1, minCol: 1, maxCol: 2 }]);

      harness = mount(model);

      const editable = editableAt(harness.grid, 0, 0);

      focusCellEnd(editable);
      shiftArrow(editable, 'ArrowRight');

      if (selectedCoords(harness.grid).join() !== '0:0,0:1,1:0') {
        throw new Error(`precondition: expected the merge swallowed, got ${selectedCoords(harness.grid).join()}`);
      }

      // Repeated presses: the rectangle never shrinks, however often Left is pressed.
      shiftArrow(editable, 'ArrowLeft');
      shiftArrow(editable, 'ArrowLeft');
      shiftArrow(editable, 'ArrowLeft');

      expect(selectedCoords(harness.grid)).toEqual(['0:0']);
    });
  });
});
