import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';
const SELECTED_ATTR = 'data-blok-table-cell-selected';
const BLOCK_SELECTED_ATTR = 'data-blok-selected';

interface MockPopoverArgs {
  items?: unknown[];
  trigger?: HTMLElement;
}

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class MockPopoverDesktop {
    private el = document.createElement('div');
    constructor(_args: MockPopoverArgs) {
      // no-op
    }
    show(): void {
      document.body.appendChild(this.el);
    }
    destroy(): void {
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
  PopoverEvent: { Closed: 'closed' },
}));

vi.mock('../../../../src/tools/table/table-cell-color-picker', () => ({
  createCellColorPicker: () => ({ element: document.createElement('div') }),
}));

vi.mock('../../../../src/tools/table/table-cell-placement-picker', () => ({
  createCellPlacementPicker: () => ({ element: document.createElement('div') }),
}));

import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import type { CellMark, FillDirection, SelectionRange } from '../../../../src/tools/table/table-cell-selection';
import type { I18n } from '../../../../types/api';

const i18n = { t: (key: string) => key } as unknown as I18n;

interface GridSpec {
  rows: number;
  cols: number;
  /** merges keyed by "row:col" -> span */
  merges?: Record<string, { colspan: number; rowspan: number }>;
}

/**
 * Build a <table> whose cells carry logical coordinate attributes, a cell-blocks
 * container and one contenteditable block each — the same shape the real table
 * tool renders, which is what the caret-resolution path reads.
 */
const createGrid = ({ rows, cols, merges = {} }: GridSpec): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: cols }).forEach(() => colgroup.appendChild(document.createElement('col')));
  table.appendChild(colgroup);

  const covered = new Set<string>();

  Object.entries(merges).forEach(([key, span]) => {
    const [originRow, originCol] = key.split(':').map(Number);

    Array.from({ length: span.rowspan }).forEach((_, r) => {
      Array.from({ length: span.colspan }).forEach((_, c) => {
        if (r !== 0 || c !== 0) {
          covered.add(`${originRow + r}:${originCol + c}`);
        }
      });
    });
  });

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach((_, r) => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');

    Array.from({ length: cols }).forEach((_, c) => {
      if (covered.has(`${r}:${c}`)) {
        return;
      }

      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_ROW_ATTR, String(r));
      td.setAttribute(CELL_COL_ATTR, String(c));

      const span = merges[`${r}:${c}`];

      if (span) {
        td.colSpan = span.colspan;
        td.rowSpan = span.rowspan;
      }

      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');

      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', `b-${r}-${c}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      editable.textContent = `cell ${r}${c}`;

      blockHolder.appendChild(editable);
      container.appendChild(blockHolder);
      td.appendChild(container);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  document.body.appendChild(table);

  return table;
};

const getCellSpanFor = (merges: Record<string, { colspan: number; rowspan: number }>) =>
  (row: number, col: number): { colspan: number; rowspan: number } =>
    merges[`${row}:${col}`] ?? { colspan: 1, rowspan: 1 };

const getEditable = (grid: HTMLElement, row: number, col: number): HTMLElement => {
  const cell = grid.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

  if (!cell) {
    throw new Error(`cell ${row},${col} not found`);
  }

  const editable = cell.querySelector<HTMLElement>('[contenteditable="true"]');

  if (!editable) {
    throw new Error(`editable in cell ${row},${col} not found`);
  }

  return editable;
};

/**
 * Put a real collapsed caret at the end (or start) of a cell's editable.
 */
const placeCaret = (editable: HTMLElement, at: 'start' | 'end'): void => {
  const textNode = editable.firstChild;

  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    throw new Error('editable has no text node');
  }

  const range = document.createRange();
  const offset = at === 'end' ? (textNode.textContent ?? '').length : 0;

  range.setStart(textNode, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const selectedCoords = (grid: HTMLElement): string[] =>
  Array.from(grid.querySelectorAll(`[${SELECTED_ATTR}]`))
    .map(cell => `${cell.getAttribute(CELL_ROW_ATTR)}:${cell.getAttribute(CELL_COL_ATTR)}`)
    .sort();

const pressArrow = (target: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    shiftKey: true,
    ...modifiers,
  });

  target.dispatchEvent(event);

  return event;
};

const pressShortcut = (target: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: true,
    ...modifiers,
  });

  target.dispatchEvent(event);

  return event;
};

describe('TableCellSelection — keyboard cell selection', () => {
  let grid: HTMLTableElement;
  let selection: TableCellSelection | null = null;
  let coreBubbleSpy: Mock<(event: Event) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    coreBubbleSpy = vi.fn<(event: Event) => void>();
    // Stands in for the core's keydown handlers (BlockEvents / shortcut registry),
    // all of which listen in the bubble phase.
    document.addEventListener('keydown', coreBubbleSpy);
  });

  afterEach(() => {
    document.removeEventListener('keydown', coreBubbleSpy);
    selection?.destroy();
    selection = null;
    grid?.remove();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  describe('Shift+Arrow rectangle', () => {
    it('extends a cell rectangle from a caret at the end of cell (0,0)', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');

      const event = pressArrow(editable, 'ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      expect(selectedCoords(grid)).toEqual(['0:0', '0:1']);
    });

    it('does not let Shift+Arrow reach the core cross-block selection handlers', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');

      expect(coreBubbleSpy).not.toHaveBeenCalled();
    });

    it('keeps extending on repeated Shift+ArrowRight', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');
      pressArrow(editable, 'ArrowRight');

      expect(selectedCoords(grid)).toEqual(['0:0', '0:1', '0:2']);
    });

    it('extends downward with Shift+ArrowDown', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowDown');

      expect(selectedCoords(grid)).toEqual(['0:0', '1:0']);
    });

    it('shrinks back when reversing direction', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');
      pressArrow(editable, 'ArrowRight');
      pressArrow(editable, 'ArrowLeft');

      expect(selectedCoords(grid)).toEqual(['0:0', '0:1']);
    });

    it('clamps at the grid edge instead of escaping the table', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 2);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');
      pressArrow(editable, 'ArrowRight');

      expect(selectedCoords(grid)).toEqual(['0:2']);
    });

    it('does not start a rectangle when the caret is mid-text', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'start');

      const event = pressArrow(editable, 'ArrowRight');

      expect(event.defaultPrevented).toBe(false);
      expect(selectedCoords(grid)).toEqual([]);
      expect(coreBubbleSpy).toHaveBeenCalled();
    });

    it('does not extend from the 1x1 selection a plain cell CLICK leaves behind', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      // Clicking into a cell to edit it leaves a single-cell selection painted
      // while the caret sits in the text. Shift+Arrow mid-text must still be a
      // TEXT gesture, not a rectangle extension.
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'start');

      const event = pressArrow(editable, 'ArrowRight');

      expect(event.defaultPrevented).toBe(false);
      expect(selectedCoords(grid)).toEqual(['0:0']);
    });

    it('extends from a clicked cell once the caret reaches the text boundary', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');

      expect(selectedCoords(grid)).toEqual(['0:0', '0:1']);
    });

    it('defers to an in-cell block selection (line selection keeps working)', () => {
      grid = createGrid({ rows: 2, cols: 3 });
      selection = new TableCellSelection({ grid, i18n });

      const editable = getEditable(grid, 0, 0);
      const holder = editable.closest<HTMLElement>('[data-blok-id]');

      holder?.setAttribute(BLOCK_SELECTED_ATTR, 'true');
      placeCaret(editable, 'end');

      const event = pressArrow(editable, 'ArrowDown');

      expect(event.defaultPrevented).toBe(false);
      expect(selectedCoords(grid)).toEqual([]);
      expect(coreBubbleSpy).toHaveBeenCalled();
    });

    it('expands the rectangle to a whole merged span', () => {
      const merges = { '0:0': { colspan: 2, rowspan: 2 } };

      grid = createGrid({ rows: 2, cols: 3, merges });
      selection = new TableCellSelection({
        grid,
        i18n,
        getCellSpan: getCellSpanFor(merges),
      });

      const editable = getEditable(grid, 0, 0);

      placeCaret(editable, 'end');
      pressArrow(editable, 'ArrowRight');

      // The merge origin covers cols 0-1 / rows 0-1, so a single step right must
      // land on the whole span, not on the covered col 1.
      expect(selection.getSelectedRange()).toEqual<SelectionRange>({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 1,
      });

      pressArrow(editable, 'ArrowRight');

      expect(selection.getSelectedRange()).toEqual<SelectionRange>({
        minRow: 0,
        maxRow: 1,
        minCol: 0,
        maxCol: 2,
      });
      expect(selectedCoords(grid)).toEqual(['0:0', '0:2', '1:2']);
    });
  });

  describe('bulk formatting over a rectangle', () => {
    const marks: Array<[string, Partial<KeyboardEventInit>, CellMark]> = [
      ['b', {}, 'bold'],
      ['i', {}, 'italic'],
      ['u', {}, 'underline'],
      ['e', {}, 'code'],
      ['s', { shiftKey: true }, 'strikethrough'],
    ];

    it.each(marks)('Cmd+%s formats every selected cell', (key, modifiers, mark) => {
      const onFormatCells = vi.fn();

      grid = createGrid({ rows: 2, cols: 2 });
      selection = new TableCellSelection({ grid, i18n, onFormatCells });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const event = pressShortcut(getEditable(grid, 0, 0), key, modifiers);

      expect(event.defaultPrevented).toBe(true);
      expect(coreBubbleSpy).not.toHaveBeenCalled();
      expect(onFormatCells).toHaveBeenCalledTimes(1);

      const [cells, appliedMark] = onFormatCells.mock.calls[0] as [HTMLElement[], CellMark];

      expect(appliedMark).toBe(mark);
      expect(cells).toHaveLength(4);
    });

    it('leaves a single-cell selection to the normal inline toolbar path', () => {
      const onFormatCells = vi.fn();

      grid = createGrid({ rows: 2, cols: 2 });
      selection = new TableCellSelection({ grid, i18n, onFormatCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const event = pressShortcut(getEditable(grid, 0, 0), 'b');

      expect(event.defaultPrevented).toBe(false);
      expect(onFormatCells).not.toHaveBeenCalled();
      expect(coreBubbleSpy).toHaveBeenCalled();
    });
  });

  describe('fill right / fill down', () => {
    it('Cmd+R fills right across the rectangle', () => {
      const onFillCells = vi.fn();

      grid = createGrid({ rows: 2, cols: 2 });
      selection = new TableCellSelection({ grid, i18n, onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const event = pressShortcut(getEditable(grid, 0, 0), 'r');

      expect(event.defaultPrevented).toBe(true);
      expect(onFillCells).toHaveBeenCalledTimes(1);

      const [, range, direction] = onFillCells.mock.calls[0] as [HTMLElement[], SelectionRange, FillDirection];

      expect(direction).toBe('right');
      expect(range).toEqual<SelectionRange>({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    });

    it('Cmd+D fills down across the rectangle', () => {
      const onFillCells = vi.fn();

      grid = createGrid({ rows: 2, cols: 2 });
      selection = new TableCellSelection({ grid, i18n, onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const event = pressShortcut(getEditable(grid, 0, 0), 'd');

      expect(event.defaultPrevented).toBe(true);
      expect(onFillCells).toHaveBeenCalledTimes(1);

      const [, , direction] = onFillCells.mock.calls[0] as [HTMLElement[], SelectionRange, FillDirection];

      expect(direction).toBe('down');
    });

    it('does not shadow the global Cmd+D (duplicate block) without a multi-cell rectangle', () => {
      const onFillCells = vi.fn();

      grid = createGrid({ rows: 2, cols: 2 });
      selection = new TableCellSelection({ grid, i18n, onFillCells });
      selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });

      const event = pressShortcut(getEditable(grid, 0, 0), 'd');

      expect(event.defaultPrevented).toBe(false);
      expect(onFillCells).not.toHaveBeenCalled();
      expect(coreBubbleSpy).toHaveBeenCalled();
    });
  });
});
