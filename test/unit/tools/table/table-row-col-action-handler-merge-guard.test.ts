import { describe, it, expect, vi } from 'vitest';
import { executeRowColAction } from '../../../../src/tools/table/table-row-col-action-handler';
import type { TableGrid } from '../../../../src/tools/table/table-core';

/**
 * Row/column reordering uses physical NodeList indices, which desync the DOM
 * from the logical model on a merged grid. The guard is PER MOVE, not
 * table-wide:
 *
 *   - a move the model refused (it would tear a merge — ActionData.moveAllowed
 *     is false) is a complete no-op: no DOM mutation, no colWidths reorder;
 *   - a move the model accepted on a MERGED grid still must not touch the DOM
 *     at physical indices — it re-renders the body from the model instead;
 *   - on an unmerged grid the physical move runs as before.
 */
describe('executeRowColAction move guard on merged tables', () => {
  const makeGrid = () => ({
    moveRow: vi.fn(),
    moveColumn: vi.fn(),
  }) as unknown as TableGrid;

  const baseData = (hasMerges: boolean, moveAllowed = true) => ({
    colWidths: [100, 200, 150],
    withHeadings: false,
    withHeadingColumn: false,
    hasMerges,
    moveAllowed,
  });

  const gridEl = document.createElement('div');

  it('move-row the model refused is a no-op', () => {
    const grid = makeGrid();
    const rebuildTableBody = vi.fn();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-row', fromIndex: 1, toIndex: 0 },
      { grid, data: baseData(true, false), cellBlocks: null, rebuildTableBody }
    );

    expect(grid.moveRow).not.toHaveBeenCalled();
    expect(rebuildTableBody).not.toHaveBeenCalled();
    expect(result.moveSelection).toBeNull();
    expect(result.colWidths).toEqual([100, 200, 150]);
  });

  it('move-col the model refused is a no-op (and does not reorder colWidths)', () => {
    const grid = makeGrid();
    const rebuildTableBody = vi.fn();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-col', fromIndex: 2, toIndex: 0 },
      { grid, data: baseData(true, false), cellBlocks: null, rebuildTableBody }
    );

    expect(grid.moveColumn).not.toHaveBeenCalled();
    expect(rebuildTableBody).not.toHaveBeenCalled();
    expect(result.moveSelection).toBeNull();
    expect(result.colWidths).toEqual([100, 200, 150]);
  });

  it('an allowed move on a merged grid re-renders from the model instead of moving <td>s', () => {
    const grid = makeGrid();
    const rebuildTableBody = vi.fn();
    const result = executeRowColAction(
      gridEl,
      { type: 'move-row', fromIndex: 2, toIndex: 0 },
      { grid, data: baseData(true), cellBlocks: null, rebuildTableBody }
    );

    // The physical-index DOM move would scramble a merged grid's coordinates.
    expect(grid.moveRow).not.toHaveBeenCalled();
    expect(rebuildTableBody).toHaveBeenCalledTimes(1);
    expect(result.moveSelection).toEqual({ type: 'row', index: 0 });
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
