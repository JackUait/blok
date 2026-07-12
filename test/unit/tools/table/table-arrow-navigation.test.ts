import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from '../../../../types';
import type { TableModel } from '../../../../src/tools/table/table-model';
import { TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';

/**
 * Notion parity: the four arrow keys navigate BETWEEN cells at a cell's text
 * edge — Up/Down move within the same column, Left/Right cross in reading order.
 * These tests exercise the grid-navigation decision (which cell the caret lands
 * in) via the onNavigateToCell callback. They run without a live selection, so
 * the boundary check degrades to "act on position" — exactly what the capture
 * handler does when core has not already consumed the key.
 */

interface Spanned {
  row: number;
  col: number;
}

const createModelStub = (spanned: Spanned[] = []): TableModel => ({
  isSpannedCell: vi.fn((row: number, col: number) =>
    spanned.some(s => s.row === row && s.col === col)),
  hasMerges: vi.fn(() => false),
  findCellForBlock: vi.fn(() => null),
} as unknown as TableModel);

const createApiStub = (): API => ({
  events: { on: vi.fn(), off: vi.fn() },
  caret: { setToBlock: vi.fn() },
  // getBlockIndex undefined → getTableBlock returns null → exitTable* no-ops,
  // which is all these grid-navigation tests need from the exit path.
  blocks: { getBlockIndex: vi.fn(() => undefined) },
} as unknown as API);

/**
 * Build an R×C grid element where every cell owns one contenteditable block, so
 * navigateToCell has a real focus target.
 */
const buildGrid = (rows: number, cols: number): HTMLElement => {
  const grid = document.createElement('div');

  for (let r = 0; r < rows; r++) {
    const rowEl = document.createElement('div');

    rowEl.setAttribute('data-blok-table-row', String(r));

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.setAttribute('data-blok-table-cell-row', String(r));
      cell.setAttribute('data-blok-table-cell-col', String(c));

      const cellBlocks = document.createElement('div');

      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', `b-${r}-${c}`);

      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      blockHolder.appendChild(editable);
      cellBlocks.appendChild(blockHolder);
      cell.appendChild(cellBlocks);
      rowEl.appendChild(cell);
    }

    grid.appendChild(rowEl);
  }

  // A colgroup makes getColumnCount authoritative regardless of merges.
  const colgroup = document.createElement('colgroup');

  for (let c = 0; c < cols; c++) {
    colgroup.appendChild(document.createElement('col'));
  }
  grid.appendChild(colgroup);

  return grid;
};

const press = (key: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });

describe('table arrow-key grid navigation', () => {
  let grid: HTMLElement;
  let navigated: Array<{ row: number; col: number }>;
  let cellBlocks: TableCellBlocks;

  const mount = (rows: number, cols: number, spanned: Spanned[] = []): void => {
    grid = buildGrid(rows, cols);
    document.body.appendChild(grid);
    navigated = [];
    cellBlocks = new TableCellBlocks({
      api: createApiStub(),
      gridElement: grid,
      tableBlockId: 'table-1',
      model: createModelStub(spanned),
      onNavigateToCell: (position) => navigated.push(position),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('ArrowDown moves to the cell directly below in the same column', () => {
    mount(3, 3);

    cellBlocks.handleArrowNavigation(press('ArrowDown'), { row: 0, col: 1 });

    expect(navigated).toEqual([{ row: 1, col: 1 }]);
  });

  it('ArrowUp moves to the cell directly above in the same column', () => {
    mount(3, 3);

    cellBlocks.handleArrowNavigation(press('ArrowUp'), { row: 2, col: 2 });

    expect(navigated).toEqual([{ row: 1, col: 2 }]);
  });

  it('ArrowRight crosses to the next cell in reading order', () => {
    mount(3, 3);

    cellBlocks.handleArrowNavigation(press('ArrowRight'), { row: 0, col: 0 });

    expect(navigated).toEqual([{ row: 0, col: 1 }]);
  });

  it('ArrowRight at the end of a row wraps to the first cell of the next row', () => {
    mount(3, 3);

    cellBlocks.handleArrowNavigation(press('ArrowRight'), { row: 0, col: 2 });

    expect(navigated).toEqual([{ row: 1, col: 0 }]);
  });

  it('ArrowLeft crosses to the previous cell in reading order', () => {
    mount(3, 3);

    cellBlocks.handleArrowNavigation(press('ArrowLeft'), { row: 1, col: 1 });

    expect(navigated).toEqual([{ row: 1, col: 0 }]);
  });

  it('ArrowDown skips a merge-covered row and lands on the next real cell', () => {
    // Cell (1,0) is covered by a vertical merge from (0,0); Down from (0,0)
    // should skip it and land on (2,0).
    mount(3, 3, [{ row: 1, col: 0 }]);

    cellBlocks.handleArrowNavigation(press('ArrowDown'), { row: 0, col: 0 });

    expect(navigated).toEqual([{ row: 2, col: 0 }]);
  });

  it('does not navigate cells when a modifier key is held', () => {
    mount(3, 3);

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true, cancelable: true });

    cellBlocks.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(navigated).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ArrowDown on the last row exits the table (no in-grid navigation)', () => {
    mount(2, 2);

    const event = press('ArrowDown');

    cellBlocks.handleArrowNavigation(event, { row: 1, col: 0 });

    // No cell below → exit path runs; no in-grid navigation recorded.
    expect(navigated).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });
});
