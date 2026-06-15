import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableGrid, CELL_COL_ATTR, CELL_ROW_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { TableCellBlocks, CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Regression for M4: Tab / Shift+Tab must skip merge-covered logical columns
 * instead of dead-stopping. Tabbing from a colspan origin landed on the covered
 * column, found no DOM cell, and silently returned after preventDefault had
 * already swallowed the key — the caret got stuck.
 */
describe('TableCellBlocks Tab navigation across merged cells', () => {
  let instance: TableCellBlocks;
  let navigated: Array<{ row: number; col: number }>;

  const api = {
    events: { on: vi.fn(), off: vi.fn() },
    blocks: { isSyncingFromYjs: false, getBlockIndex: vi.fn(), getBlockByIndex: vi.fn() },
    caret: { setToBlock: vi.fn() },
  };

  /** Put a focusable contenteditable into a cell so navigateToCell can land there. */
  const makeFocusable = (table: HTMLElement, row: number, col: number): void => {
    const cell = table.querySelector<HTMLElement>(
      `[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`
    );
    const container = cell?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    container?.appendChild(editable);
  };

  const mount = (data: TableData): HTMLElement => {
    const model = new TableModel(data);
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    document.body.appendChild(table);

    instance = new TableCellBlocks({
      api: api as never,
      gridElement: table,
      tableBlockId: 'table-block',
      model,
      onNavigateToCell: pos => navigated.push(pos),
    });

    return table;
  };

  const pressTab = (row: number, col: number, shift = false): void => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift });

    instance.handleKeyDown(event, { row, col });
  };

  beforeEach(() => {
    navigated = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('Tab from a colspan origin skips the covered column to the next logical cell', () => {
    // 1x3, row-0 cols 0+1 merged (colspan=2). Logical col 1 is covered.
    const table = mount({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ],
    });

    makeFocusable(table, 0, 2);

    pressTab(0, 0);

    expect(navigated).toEqual([{ row: 0, col: 2 }]);
  });

  it('Shift+Tab from a cell after a merge skips the covered column back to the origin', () => {
    const table = mount({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ],
    });

    makeFocusable(table, 0, 0);

    pressTab(0, 2, true);

    expect(navigated).toEqual([{ row: 0, col: 0 }]);
  });

  it('Tab still advances one column on an unmerged row', () => {
    const table = mount({
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }, { blocks: [] }]],
    });

    makeFocusable(table, 0, 1);

    pressTab(0, 0);

    expect(navigated).toEqual([{ row: 0, col: 1 }]);
  });
});
