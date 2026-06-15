import { describe, it, expect } from 'vitest';
import { TableGrid, CELL_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { getCellPosition } from '../../../../src/tools/table/table-operations';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Regression coverage for the physical-vs-logical column bug (findings H1-H4, M3, M4).
 *
 * Merged cells are NOT rendered as <td>, so the physical NodeList index of a
 * <td> diverges from its logical model column in any row touched by a merge.
 * getCellPosition must report the LOGICAL coordinate the cell carries in
 * CELL_ROW_ATTR/CELL_COL_ATTR, not its physical position among siblings.
 */
describe('getCellPosition on merged grids (table-operations)', () => {
  /** 2x3 model with row-0 cols 0+1 merged horizontally (colspan=2). */
  const horizontalMergeData = (): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    content: [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    ],
  });

  /** 2x2 model with col-0 rows 0+1 merged vertically (rowspan=2). */
  const verticalMergeData = (): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    content: [
      [{ blocks: [], rowspan: 2 }, { blocks: [] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    ],
  });

  it('reports the logical column for a cell after a horizontal merge', () => {
    const model = new TableModel(horizontalMergeData());
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    // Row 0 has 2 physical <td>: the colspan=2 cell (logical col 0) and logical col 2.
    const row0Cells = Array.from(
      table.querySelectorAll(`[data-blok-table-row]`)[0].querySelectorAll(`[${CELL_ATTR}]`)
    ) as HTMLElement[];

    expect(row0Cells).toHaveLength(2);

    const lastCell = row0Cells[1];

    expect(lastCell.getAttribute(CELL_COL_ATTR)).toBe('2');

    const pos = getCellPosition(table, lastCell);

    expect(pos).toEqual({ row: 0, col: 2 });
  });

  it('reports the logical column for the lone cell in a row below a rowspan', () => {
    const model = new TableModel(verticalMergeData());
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    // Row 1 has 1 physical <td> (logical col 1); col 0 is covered by the rowspan.
    const row1Cells = Array.from(
      table.querySelectorAll(`[data-blok-table-row]`)[1].querySelectorAll(`[${CELL_ATTR}]`)
    ) as HTMLElement[];

    expect(row1Cells).toHaveLength(1);

    const pos = getCellPosition(table, row1Cells[0]);

    expect(pos).toEqual({ row: 1, col: 1 });
  });

  it('still reports correct coordinates on an unmerged grid', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ],
    });
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    const rows = table.querySelectorAll(`[data-blok-table-row]`);
    const cell = Array.from(rows[1].querySelectorAll(`[${CELL_ATTR}]`))[2] as HTMLElement;

    expect(getCellPosition(table, cell)).toEqual({ row: 1, col: 2 });
  });
});
