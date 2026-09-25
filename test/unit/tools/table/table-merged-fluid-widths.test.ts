import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { readPixelWidths, planInsertColumnWidths } from '../../../../src/tools/table/table-operations';

const COL_PX = 100;

/**
 * A fluid (percent) table. Each row lists [logicalCol, colSpan] per physical cell.
 * jsdom has no layout, so every cell measures COL_PX per column it spans.
 */
const createFluidTable = (cols: number, rows: Array<Array<[number, number]>>): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: cols }).forEach(() => {
    const col = document.createElement('col');

    col.style.width = `${100 / cols}%`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  rows.forEach(cells => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    cells.forEach(([logicalCol, span]) => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute(CELL_COL_ATTR, String(logicalCol));
      td.colSpan = span;
      vi.spyOn(td, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, COL_PX * span, 20));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
};

describe('fluid table widths with a merged first row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads one width per logical column when row 0 has a colspan-2 cell', () => {
    const table = createFluidTable(3, [
      [[0, 2], [2, 1]],
      [[0, 1], [1, 1], [2, 1]],
    ]);

    expect(readPixelWidths(table)).toEqual([100, 100, 100]);
  });

  it('splits a spanning cell across columns no single cell measures', () => {
    const table = createFluidTable(3, [
      [[0, 2], [2, 1]],
    ]);

    expect(readPixelWidths(table)).toEqual([100, 100, 100]);
  });

  it('plans one width per column after adding a column to a merged fluid table', () => {
    const table = createFluidTable(3, [
      [[0, 2], [2, 1]],
      [[0, 1], [1, 1], [2, 1]],
    ]);

    const plan = planInsertColumnWidths(table, 3, undefined, undefined);

    expect(plan.next).toHaveLength(4);
    expect(plan.next.slice(0, 3)).toEqual([100, 100, 100]);
    expect(plan.next[3]).toBeGreaterThan(0);
  });
});
