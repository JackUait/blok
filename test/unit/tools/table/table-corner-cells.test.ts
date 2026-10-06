import { describe, it, expect } from 'vitest';

import { TableGrid, CORNER_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';

/** Map of "row,col" -> corner tokens, for every cell that is a corner. */
const cornersOf = (table: HTMLElement): Record<string, string> => Object.fromEntries(
  Array.from(table.querySelectorAll<HTMLElement>(`[${CORNER_ATTR}]`)).map(cell => [
    `${cell.getAttribute(CELL_ROW_ATTR)},${cell.getAttribute(CELL_COL_ATTR)}`,
    cell.getAttribute(CORNER_ATTR) ?? '',
  ])
);

describe('table corner cells', () => {
  it('marks the four corner cells of a flat grid and nothing else', () => {
    const table = new TableGrid({ readOnly: false }).createGrid(3, 3);

    expect(cornersOf(table)).toEqual({
      '0,0': 'top-start',
      '0,2': 'top-end',
      '2,0': 'bottom-start',
      '2,2': 'bottom-end',
    });
  });

  it('gives a lone cell all four corners', () => {
    const table = new TableGrid({ readOnly: false }).createGrid(1, 1);

    expect(cornersOf(table)).toEqual({ '0,0': 'top-start top-end bottom-start bottom-end' });
  });

  it('marks a rowspan cell from an earlier row when it covers a bottom corner', () => {
    const data: TableData = {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [] }, { blocks: [], rowspan: 2 }],
        [{ blocks: [] }, { blocks: [], mergedInto: [0, 1] }],
      ],
    };
    const table = new TableGrid({ readOnly: false }).createGridFromModel(new TableModel(data));

    expect(cornersOf(table)).toEqual({
      '0,0': 'top-start',
      '0,1': 'top-end bottom-end',
      '1,0': 'bottom-start',
    });
  });

  it('moves the bottom corners to the new last row when a row is appended', () => {
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGrid(2, 2);

    grid.addRow(table);

    expect(cornersOf(table)).toEqual({
      '0,0': 'top-start',
      '0,1': 'top-end',
      '2,0': 'bottom-start',
      '2,1': 'bottom-end',
    });
  });

  it('moves the end corners when the last column is deleted', () => {
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGrid(2, 3);

    grid.deleteColumn(table, 2);

    expect(cornersOf(table)).toEqual({
      '0,0': 'top-start',
      '0,1': 'top-end',
      '1,0': 'bottom-start',
      '1,1': 'bottom-end',
    });
  });
});
