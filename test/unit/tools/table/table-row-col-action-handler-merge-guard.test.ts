import { describe, it, expect, vi } from 'vitest';
import { executeRowColAction } from '../../../../src/tools/table/table-row-col-action-handler';
import type { TableGrid } from '../../../../src/tools/table/table-core';

/**
 * Regression for H5/H6/H7: row/column reordering uses physical NodeList
 * indices, which desync the DOM from the logical model on a merged grid
 * (and even corrupt unrelated rows when a different column holds the merge).
 * When the table has any merge, the move must be a complete no-op — no DOM
 * mutation and no colWidths reorder.
 */
describe('executeRowColAction blocks moves on merged tables', () => {
  const makeGrid = () => ({
    moveRow: vi.fn(),
    moveColumn: vi.fn(),
  }) as unknown as TableGrid;

  const baseData = (hasMerges: boolean) => ({
    colWidths: [100, 200, 150],
    withHeadings: false,
    withHeadingColumn: false,
    hasMerges,
  });

  const gridEl = document.createElement('div');

  it('move-row is a no-op when the table has merges', () => {
    const grid = makeGrid();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-row', fromIndex: 1, toIndex: 0 },
      { grid, data: baseData(true), cellBlocks: null }
    );

    expect(grid.moveRow).not.toHaveBeenCalled();
    expect(result.moveSelection).toBeNull();
    expect(result.colWidths).toEqual([100, 200, 150]);
  });

  it('move-col is a no-op (and does not reorder colWidths) when the table has merges', () => {
    const grid = makeGrid();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-col', fromIndex: 2, toIndex: 0 },
      { grid, data: baseData(true), cellBlocks: null }
    );

    expect(grid.moveColumn).not.toHaveBeenCalled();
    expect(result.moveSelection).toBeNull();
    expect(result.colWidths).toEqual([100, 200, 150]);
  });

  it('move-col still moves and reorders widths on an unmerged table', () => {
    const grid = makeGrid();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-col', fromIndex: 2, toIndex: 0 },
      { grid, data: baseData(false), cellBlocks: null }
    );

    expect(grid.moveColumn).toHaveBeenCalledWith(gridEl, 2, 0);
    expect(result.colWidths).toEqual([150, 100, 200]);
  });
});
