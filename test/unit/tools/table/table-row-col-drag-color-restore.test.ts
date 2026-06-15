import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableRowColDrag } from '../../../../src/tools/table/table-row-col-drag';
import { TableGrid } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';

/**
 * Regression for M7: the drag highlight overwrote each source cell's inline
 * backgroundColor and cleanup blanked it to '' — wiping a user-set cell color
 * until the next re-render. Cleanup must restore the original inline color.
 */
describe('TableRowColDrag restores user cell color after a drag', () => {
  let drag: TableRowColDrag | undefined;

  afterEach(() => {
    drag = undefined;
    document.body.innerHTML = '';
  });

  it('restores the original backgroundColor on cleanup', () => {
    const model = new TableModel({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ],
    });
    const grid = new TableGrid({ readOnly: false });
    const table = grid.createGridFromModel(model);

    document.body.appendChild(table);

    // User colors column 0's first cell yellow (inline style, as the tool does).
    const coloredCell = table.querySelector<HTMLElement>(
      '[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]'
    );

    if (!coloredCell) {
      throw new Error('cell not found');
    }

    coloredCell.style.backgroundColor = 'rgb(255, 255, 0)';

    drag = new TableRowColDrag({ grid: table, onAction: vi.fn() });

    drag.beginTracking('col', 0, 0, 0);

    // Move past the drag threshold to trigger source-cell highlight.
    document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 100, clientY: 0 }));

    // While dragging, the highlight overrides the color.
    expect(coloredCell.style.backgroundColor).not.toBe('rgb(255, 255, 0)');

    // Release — cleanup must put the user's color back.
    document.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 100, clientY: 0 }));

    expect(coloredCell.style.backgroundColor).toBe('rgb(255, 255, 0)');
  });
});
