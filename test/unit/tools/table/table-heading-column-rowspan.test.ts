import { describe, it, expect } from 'vitest';
import { TableGrid, CELL_COL_ATTR, CELL_ROW_ATTR, ROW_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { updateHeadingColumnStyles } from '../../../../src/tools/table/table-operations';

/**
 * Regression: the heading-column shading was stamped on each row's FIRST
 * PHYSICAL cell. createGridFromModel omits spanned cells, so in a row whose
 * column-0 slot is covered by a rowspan the first physical <td> belongs to a
 * LATER column — and the shading landed on the wrong cell.
 *
 * The heading column is a LOGICAL column, so it must be addressed the way
 * applyCellColors already does: by CELL_COL_ATTR.
 */
describe('updateHeadingColumnStyles under a rowspan', () => {
  const HEADING_COL_ATTR = 'data-blok-table-heading-col';

  /** 2x3 grid whose [0,0] cell spans both rows, covering [1,0]. */
  const createGridWithRowspan = (): HTMLElement => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: true,
      content: [
        [{ blocks: [], rowspan: 2 }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }, { blocks: [] }],
      ],
    });

    return new TableGrid({ readOnly: false }).createGridFromModel(model);
  };

  it('shades the rowspan origin and NOT the first physical cell of the covered row', () => {
    const gridEl = createGridWithRowspan();

    updateHeadingColumnStyles(gridEl, true);

    const shaded = Array.from(gridEl.querySelectorAll(`[${HEADING_COL_ATTR}]`)).map(cell => ({
      row: cell.getAttribute(CELL_ROW_ATTR),
      col: cell.getAttribute(CELL_COL_ATTR),
    }));

    // Only the origin sits in logical column 0. Row 1 has no column-0 <td> at
    // all — its first physical cell is column 1 and must stay unshaded.
    expect(shaded).toEqual([{ row: '0', col: '0' }]);

    const row1 = gridEl.querySelectorAll(`[${ROW_ATTR}]`)[1];
    const row1FirstPhysical = row1.querySelector(`[${CELL_COL_ATTR}]`);

    expect(row1FirstPhysical?.getAttribute(CELL_COL_ATTR)).toBe('1');
    expect(row1FirstPhysical?.hasAttribute(HEADING_COL_ATTR)).toBe(false);
  });

  it('clears the shading from every cell when the heading column is turned off', () => {
    const gridEl = createGridWithRowspan();

    updateHeadingColumnStyles(gridEl, true);
    updateHeadingColumnStyles(gridEl, false);

    expect(gridEl.querySelectorAll(`[${HEADING_COL_ATTR}]`)).toHaveLength(0);
  });
});
