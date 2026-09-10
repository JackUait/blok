import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';
import { TableGrid, ROW_ATTR, CELL_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import {
  applyCellColors,
  applyCellPlacements,
  applyFluidWidths,
  applyPixelWidths,
  computeAvgWidth,
  computeHalfAvgWidth,
  computeInitialColWidth,
  computeInsertColumnWidths,
  enableScrollOverflow,
  getBlockIdsInColumn,
  getBlockIdsInRow,
  getCellPosition,
  isCellEmpty,
  isColumnEmpty,
  isRowEmpty,
  mountCellBlocksReadOnly,
  normalizeTableData,
  parsePastedTable,
  planInsertColumnWidths,
  populateNewCells,
  readPixelWidths,
  rectangularizeContent,
  redistributePercentWidths,
  setupKeyboardNavigation,
  syncColWidthsAfterDeleteColumn,
  syncColWidthsAfterMove,
  TEXT_SIZE_ATTR,
  updateHeadingColumnStyles,
  updateHeadingStyles,
  updateTextSizeStyles,
} from '../../../../src/tools/table/table-operations';
import type { CellContent, LegacyCellContent, TableData } from '../../../../src/tools/table/types';
import type { API } from '../../../../types';

const HEADING_ROW_ATTR = 'data-blok-table-heading';
const HEADING_COL_ATTR = 'data-blok-table-heading-col';

/** Build `<tr>` elements from table markup, the way the paste path receives them. */
const rowsFromHtml = (html: string): HTMLCollectionOf<HTMLTableRowElement> => {
  const host = document.createElement('div');

  host.innerHTML = html;

  const table = host.querySelector('table');

  if (table === null) {
    throw new Error('fixture has no <table>');
  }

  return table.rows;
};

const cellAt = (grid: CellContent[][], row: number, col: number): CellContent => {
  const cell = grid[row]?.[col];

  if (cell === undefined) {
    throw new Error(`no cell at [${row}, ${col}]`);
  }

  return cell;
};

/**
 * Grid wrapper with a `<colgroup>` whose columns carry the given CSS widths
 * (`''` leaves the width unset) and one row per entry in `rowCellCounts`.
 */
const buildGridEl = (colWidths: string[], rowCellCounts: number[]): HTMLElement => {
  const gridEl = document.createElement('div');
  const colgroup = document.createElement('colgroup');

  colWidths.forEach(width => {
    const col = document.createElement('col');

    if (width !== '') {
      col.style.width = width;
    }

    colgroup.appendChild(col);
  });
  gridEl.appendChild(colgroup);

  rowCellCounts.forEach(count => {
    const row = document.createElement('tr');

    row.setAttribute(ROW_ATTR, '');
    Array.from({ length: count }).forEach((_, index) => {
      const cell = document.createElement('td');

      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, String(index));
      row.appendChild(cell);
    });
    gridEl.appendChild(row);
  });

  return gridEl;
};

/** Same shape `createGrid` produces: rows of cells, each holding a blocks container. */
const buildDomGrid = (rows: number, cols: number): HTMLElement => {
  const gridEl = document.createElement('div');

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('tr');

    row.setAttribute(ROW_ATTR, '');
    Array.from({ length: cols }).forEach((_, colIndex) => {
      const cell = document.createElement('td');
      const container = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      cell.setAttribute(CELL_COL_ATTR, String(colIndex));
      container.setAttribute(CELL_BLOCKS_ATTR, '');
      container.setAttribute(DATA_ATTR.nestedBlocks, '');
      cell.appendChild(container);
      row.appendChild(cell);
    });
    gridEl.appendChild(row);
  });

  return gridEl;
};

const colWidthsOf = (gridEl: HTMLElement): string[] => {
  const colgroup = gridEl.querySelector('colgroup');

  if (colgroup === null) {
    return [];
  }

  return Array.from(colgroup.querySelectorAll('col')).map(col => (col as HTMLElement).style.width);
};

interface CellBlocksStub {
  calls: Element[][];
  getBlockIdsFromCells: (cells: NodeListOf<Element> | Element[]) => string[];
  ensureCellHasBlock: (cell: HTMLElement) => void;
  touched: HTMLElement[];
}

/** Fresh per test: `restoreAllMocks` in afterEach would reset a shared spy. */
const makeCellBlocksStub = (): CellBlocksStub => {
  const calls: Element[][] = [];
  const touched: HTMLElement[] = [];

  return {
    calls,
    touched,
    getBlockIdsFromCells: (cells: NodeListOf<Element> | Element[]): string[] => {
      const list = Array.from(cells);

      calls.push(list);

      return list.map(cell => cell.getAttribute('data-test-block-id') ?? '');
    },
    ensureCellHasBlock: (cell: HTMLElement): void => {
      touched.push(cell);
    },
  };
};

const asCellBlocks = (stub: CellBlocksStub): TableCellBlocks => stub as unknown as TableCellBlocks;

interface StubBlock {
  id: string;
  parentId: string | null | undefined;
  holder: HTMLElement;
}

const makeBlocksApi = (blocks: StubBlock[]): API => ({
  blocks: {
    getBlockIndex: (id: string): number | undefined => {
      const index = blocks.findIndex(block => block.id === id);

      return index === -1 ? undefined : index;
    },
    getBlockByIndex: (index: number): StubBlock | undefined => blocks[index],
  },
}) as unknown as API;

const makeStubBlock = (id: string, parentId: string | null | undefined, text: string): StubBlock => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  holder.textContent = text;

  return { id, parentId, holder };
};

/** Content rows keyed by logical column index, so a cell can be found by attribute. */
const cellAtCoord = (gridEl: HTMLElement, row: number, col: number): HTMLElement | null => {
  const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

  return rows[row]?.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${col}"]`) ?? null;
};

const blocksContainerOf = (gridEl: HTMLElement, row: number, col: number): HTMLElement => {
  const container = cellAtCoord(gridEl, row, col)?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (container === undefined || container === null) {
    throw new Error(`no blocks container at [${row}, ${col}]`);
  }

  return container;
};

describe('table-operations — surviving-mutant coverage', () => {
  let windowErrors: string[];

  const onWindowError = (event: ErrorEvent): void => {
    windowErrors.push(String(event.error ?? event.message));
  };

  beforeEach(() => {
    windowErrors = [];
    window.addEventListener('error', onWindowError);
  });

  afterEach(() => {
    window.removeEventListener('error', onWindowError);
    vi.restoreAllMocks();
    // jsdom routes a throw inside an event listener to window's error event,
    // so an unasserted listener throw would otherwise pass silently.
    expect(windowErrors).toEqual([]);
  });

  describe('syncColWidthsAfterMove', () => {
    it('carries the moved column width to its new index', () => {
      expect(syncColWidthsAfterMove([100, 200, 300], 0, 2)).toEqual([200, 300, 100]);
    });

    it('keeps the untouched widths when a column moves left', () => {
      expect(syncColWidthsAfterMove([100, 200, 300], 2, 0)).toEqual([300, 100, 200]);
    });

    it('passes an absent width list straight through', () => {
      expect(syncColWidthsAfterMove(undefined, 0, 1)).toBeUndefined();
    });
  });

  describe('syncColWidthsAfterDeleteColumn', () => {
    it('removes exactly the deleted column width', () => {
      expect(syncColWidthsAfterDeleteColumn([100, 200, 300], 1)).toEqual([100, 300]);
    });

    it('returns undefined when the last width goes, so the grid falls back to equal widths', () => {
      expect(syncColWidthsAfterDeleteColumn([100], 0)).toBeUndefined();
    });

    it('passes an absent width list straight through', () => {
      expect(syncColWidthsAfterDeleteColumn(undefined, 0)).toBeUndefined();
    });
  });

  describe('computeAvgWidth', () => {
    it('averages the widths and rounds to two decimals', () => {
      expect(computeAvgWidth([100, 200, 301])).toBe(200.33);
    });

    it('returns 0 for an empty width list', () => {
      expect(computeAvgWidth([])).toBe(0);
    });
  });

  describe('computeHalfAvgWidth', () => {
    it('halves the mean, rounded to two decimals', () => {
      expect(computeHalfAvgWidth([100, 201])).toBe(75.25);
    });
  });

  describe('computeInitialColWidth', () => {
    it('returns the rounded mean width', () => {
      expect(computeInitialColWidth([100, 201])).toBe(150.5);
    });

    it('returns 0 for an empty width list', () => {
      expect(computeInitialColWidth([])).toBe(0);
    });
  });

  describe('planInsertColumnWidths', () => {
    it('uses the recorded width list verbatim when one is given', () => {
      const gridEl = buildGridEl([], [0]);

      expect(planInsertColumnWidths(gridEl, 1, [200, 200], undefined)).toEqual({
        existing: [200, 200],
        inserted: 100,
        next: [200, 100, 200],
      });
    });

    it('reads pixel widths from the DOM when no width list is recorded', () => {
      const gridEl = buildGridEl(['100px', '200px'], []);

      expect(planInsertColumnWidths(gridEl, 0, undefined, 50)).toEqual({
        existing: [100, 200],
        inserted: 25,
        next: [25, 100, 200],
      });
    });
  });

  describe('computeInsertColumnWidths', () => {
    it('inserts the half-average width AND a physical cell per row', () => {
      const grid = new TableGrid({ readOnly: false });
      const gridEl = grid.createGrid(2, 2);

      const next = computeInsertColumnWidths(gridEl, 1, [200, 200], undefined, grid);

      expect(next).toEqual([200, 100, 200]);

      // The width list and the DOM must grow together; a width-only update
      // leaves every row one cell short of its colgroup.
      gridEl.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => {
        expect(row.querySelectorAll(`[${CELL_ATTR}]`)).toHaveLength(3);
      });
    });
  });

  describe('rectangularizeContent', () => {
    it('pads a short row without dropping the cells it already had', () => {
      const padded = rectangularizeContent([
        [{ blocks: [], text: 'a' }, { blocks: [], text: 'b' }],
        [{ blocks: [], text: 'c' }],
      ]);

      expect(padded[1]).toEqual([{ blocks: [], text: 'c' }, { blocks: [] }]);
    });

    it('hands back an already-rectangular grid unchanged, row for row', () => {
      const full: LegacyCellContent[] = [{ blocks: [] }, { blocks: [] }];
      const short: LegacyCellContent[] = [{ blocks: [] }];

      // One short row forces the pad pass to run; the full row must still come
      // back by identity, not as a rebuilt copy.
      const result = rectangularizeContent([full, short]);

      expect(result[0]).toBe(full);
      expect(result[1]).toEqual([{ blocks: [] }, { blocks: [] }]);
    });

    it('pads a null row out to the widest row', () => {
      const ragged = [[{ blocks: [] }, { blocks: [] }], null] as unknown as LegacyCellContent[][];

      expect(rectangularizeContent(ragged)[1]).toEqual([{ blocks: [] }, { blocks: [] }]);
    });
  });

  describe('readPixelWidths', () => {
    it('returns an empty list when the grid has no colgroup', () => {
      expect(readPixelWidths(document.createElement('div'))).toEqual([]);
    });

    it('reads pixel widths from the col elements', () => {
      expect(readPixelWidths(buildGridEl(['100px', '250px'], [2]))).toEqual([100, 250]);
    });

    it('treats a col with no width as zero', () => {
      expect(readPixelWidths(buildGridEl([''], []))).toEqual([0]);
    });

    it('reads rendered cell widths when the columns are percentages', () => {
      // jsdom reports zero-width rects, so the percent value never leaks through.
      expect(readPixelWidths(buildGridEl(['50%'], [2]))).toEqual([0, 0]);
    });

    it('falls back to the percent number when a percent grid has no rows', () => {
      expect(readPixelWidths(buildGridEl(['50%'], []))).toEqual([50]);
    });
  });

  describe('applyPixelWidths', () => {
    it('pins the grid to the summed width plus the border and writes each col', () => {
      const gridEl = buildGridEl(['', ''], []);

      gridEl.style.minWidth = '500px';
      applyPixelWidths(gridEl, [120, 80]);

      expect(gridEl.style.width).toBe('201px');
      // Pixel mode carries its own width; a leftover fluid floor would fight it.
      expect(gridEl.style.minWidth).toBe('');
      expect(colWidthsOf(gridEl)).toEqual(['120px', '80px']);
    });

    it('stops at the number of columns that exist', () => {
      const gridEl = buildGridEl([''], []);

      applyPixelWidths(gridEl, [10, 20]);

      expect(colWidthsOf(gridEl)).toEqual(['10px']);
    });

    it('still sizes the grid when there is no colgroup to write', () => {
      const gridEl = document.createElement('div');

      expect(() => applyPixelWidths(gridEl, [100])).not.toThrow();
      expect(gridEl.style.width).toBe('101px');
    });
  });

  describe('getCellPosition', () => {
    it('reports the logical row and the column the cell carries', () => {
      const gridEl = buildDomGrid(3, 3);
      const cell = cellAtCoord(gridEl, 1, 2);

      expect(cell).not.toBeNull();

      if (cell === null) {
        return;
      }

      expect(getCellPosition(gridEl, cell)).toEqual({ row: 1, col: 2 });
    });

    it('returns null for a cell whose column attribute is not a number', () => {
      const gridEl = buildDomGrid(1, 1);
      const cell = cellAtCoord(gridEl, 0, 0);

      cell?.setAttribute(CELL_COL_ATTR, 'abc');

      expect(cell).not.toBeNull();

      if (cell === null) {
        return;
      }

      expect(getCellPosition(gridEl, cell)).toBeNull();
    });

    it('returns null for a cell that is not inside a row', () => {
      const gridEl = buildDomGrid(1, 1);
      const orphan = document.createElement('td');

      orphan.setAttribute(CELL_ATTR, '');
      orphan.setAttribute(CELL_COL_ATTR, '0');

      expect(getCellPosition(gridEl, orphan)).toBeNull();
    });
  });

  describe('isCellEmpty', () => {
    it('is true when the cell has no blocks container at all', () => {
      expect(isCellEmpty(document.createElement('td'))).toBe(true);
    });

    it('is true when the blocks container has only whitespace', () => {
      const cell = document.createElement('td');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      container.textContent = '   ';
      cell.appendChild(container);

      expect(isCellEmpty(cell)).toBe(true);
    });

    it('is false when the blocks container carries text', () => {
      const cell = document.createElement('td');
      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      container.textContent = 'typed';
      cell.appendChild(container);

      expect(isCellEmpty(cell)).toBe(false);
    });
  });

  describe('isRowEmpty', () => {
    it('is false when only some cells in the row are empty', () => {
      const gridEl = document.createElement('div');
      const row = document.createElement('div');

      row.setAttribute(ROW_ATTR, '');

      ['', 'typed'].forEach(text => {
        const cell = document.createElement('div');
        const container = document.createElement('div');

        cell.setAttribute(CELL_ATTR, '');
        container.setAttribute(CELL_BLOCKS_ATTR, '');
        container.textContent = text;
        cell.appendChild(container);
        row.appendChild(cell);
      });

      gridEl.appendChild(row);

      expect(isRowEmpty(gridEl, 0)).toBe(false);
    });

    it('is true when every cell in the row is empty', () => {
      const gridEl = buildDomGrid(1, 2);

      expect(isRowEmpty(gridEl, 0)).toBe(true);
    });

    it('is true for a row index that does not exist', () => {
      expect(isRowEmpty(buildDomGrid(1, 1), 4)).toBe(true);
    });
  });

  describe('isColumnEmpty', () => {
    it('is false when any reachable cell in the column has text', () => {
      const gridEl = buildDomGrid(2, 2);

      blocksContainerOf(gridEl, 1, 0).textContent = 'typed';

      expect(isColumnEmpty(gridEl, 0)).toBe(false);
    });

    it('is true when every row is empty in that column', () => {
      expect(isColumnEmpty(buildDomGrid(2, 2), 1)).toBe(true);
    });

    it('treats a row with no cell for that column as empty', () => {
      const gridEl = buildDomGrid(2, 2);
      const row = gridEl.querySelectorAll(`[${ROW_ATTR}]`)[1];

      row.querySelector(`[${CELL_COL_ATTR}="1"]`)?.remove();

      expect(isColumnEmpty(gridEl, 1)).toBe(true);
    });
  });

  describe('applyFluidWidths', () => {
    it('returns the grid to percent mode with the per-column floor', () => {
      const gridEl = buildGridEl(['100px', '100px', '100px', '100px'], []);

      applyFluidWidths(gridEl);

      expect(gridEl.style.width).toBe('100%');
      expect(gridEl.style.minWidth).toBe('200px');
      expect(colWidthsOf(gridEl)).toEqual(['25%', '25%', '25%', '25%']);
    });

    it('leaves a grid with no colgroup completely alone', () => {
      const gridEl = document.createElement('div');

      expect(() => applyFluidWidths(gridEl)).not.toThrow();
      expect(gridEl.style.width).toBe('');
    });
  });

  describe('redistributePercentWidths', () => {
    it('rescales the columns so they sum back to 100', () => {
      const gridEl = buildGridEl(['10%', '10%'], []);

      redistributePercentWidths(gridEl);

      expect(colWidthsOf(gridEl)).toEqual(['50%', '50%']);
      expect(gridEl.style.minWidth).toBe('100px');
    });

    it('treats an unset column width as zero', () => {
      const gridEl = buildGridEl(['20%', ''], []);

      redistributePercentWidths(gridEl);

      expect(colWidthsOf(gridEl)).toEqual(['100%', '0%']);
    });

    it('bails out of the rescale when the columns carry no width at all', () => {
      const gridEl = buildGridEl(['0%', '0%'], []);

      redistributePercentWidths(gridEl);

      expect(colWidthsOf(gridEl)).toEqual(['0%', '0%']);
      // The floor still tracks the column count; only the rescale is skipped.
      expect(gridEl.style.minWidth).toBe('100px');
    });

    it('leaves a grid with no colgroup completely alone', () => {
      const gridEl = document.createElement('div');

      expect(() => redistributePercentWidths(gridEl)).not.toThrow();
      expect(gridEl.style.minWidth).toBe('');
    });
  });

  describe('getBlockIdsInRow', () => {
    it('asks the cell-blocks helper for the cells of that row', () => {
      const gridEl = buildDomGrid(2, 2);
      const stub = makeCellBlocksStub();

      cellAtCoord(gridEl, 1, 0)?.setAttribute('data-test-block-id', 'a');
      cellAtCoord(gridEl, 1, 1)?.setAttribute('data-test-block-id', 'b');

      expect(getBlockIdsInRow(gridEl, asCellBlocks(stub), 1)).toEqual(['a', 'b']);
    });

    it('returns an empty list when there is no element', () => {
      expect(getBlockIdsInRow(null, asCellBlocks(makeCellBlocksStub()), 0)).toEqual([]);
    });

    it('returns an empty list for a row index that does not exist', () => {
      expect(getBlockIdsInRow(buildDomGrid(1, 1), asCellBlocks(makeCellBlocksStub()), 5)).toEqual([]);
    });

    it('falls back to an empty list when there is no cell-blocks helper', () => {
      expect(getBlockIdsInRow(buildDomGrid(1, 1), null, 0)).toEqual([]);
    });
  });

  describe('getBlockIdsInColumn', () => {
    it('collects the cells of the logical column across every row', () => {
      const gridEl = buildDomGrid(2, 2);
      const stub = makeCellBlocksStub();

      cellAtCoord(gridEl, 0, 1)?.setAttribute('data-test-block-id', 'a');
      cellAtCoord(gridEl, 1, 1)?.setAttribute('data-test-block-id', 'b');

      expect(getBlockIdsInColumn(gridEl, asCellBlocks(stub), 1)).toEqual(['a', 'b']);
    });

    it('skips rows that have no cell for that column', () => {
      const gridEl = buildDomGrid(2, 2);
      const stub = makeCellBlocksStub();

      cellAtCoord(gridEl, 0, 1)?.setAttribute('data-test-block-id', 'a');
      cellAtCoord(gridEl, 1, 1)?.remove();

      expect(getBlockIdsInColumn(gridEl, asCellBlocks(stub), 1)).toEqual(['a']);
      expect(stub.calls[0]).toHaveLength(1);
    });

    it('returns an empty list when there is no element', () => {
      expect(getBlockIdsInColumn(null, asCellBlocks(makeCellBlocksStub()), 0)).toEqual([]);
    });

    it('falls back to an empty list when there is no cell-blocks helper', () => {
      expect(getBlockIdsInColumn(buildDomGrid(1, 1), null, 0)).toEqual([]);
    });
  });

  describe('populateNewCells', () => {
    it('ensures every cell of the grid has a block', () => {
      const gridEl = buildDomGrid(2, 2);
      const stub = makeCellBlocksStub();

      populateNewCells(gridEl, asCellBlocks(stub));

      expect(stub.touched).toHaveLength(4);
      expect(stub.touched).toContain(cellAtCoord(gridEl, 1, 1));
    });

    it('does nothing when there is no cell-blocks helper', () => {
      expect(() => populateNewCells(buildDomGrid(1, 1), null)).not.toThrow();
    });
  });

  describe('mountCellBlocksReadOnly', () => {
    const tableId = 'table-1';

    it('stamps legacy text into a leading-[1.5] wrapper', () => {
      const gridEl = buildDomGrid(1, 1);

      mountCellBlocksReadOnly(gridEl, [['legacy text']], makeBlocksApi([]), tableId);

      const container = blocksContainerOf(gridEl, 0, 0);
      const wrapper = container.firstElementChild;

      expect(wrapper?.className).toBe('leading-[1.5]');
      expect(wrapper?.textContent).toBe('legacy text');
    });

    it('mounts each referenced block holder into its cell', () => {
      const gridEl = buildDomGrid(1, 2);
      const blockA = makeStubBlock('a', undefined, 'A');
      const blockB = makeStubBlock('b', tableId, 'B');
      const content: LegacyCellContent[][] = [[{ blocks: ['a'] }, { blocks: ['b'] }]];

      mountCellBlocksReadOnly(gridEl, content, makeBlocksApi([blockA, blockB]), tableId);

      expect(blocksContainerOf(gridEl, 0, 0).firstElementChild).toBe(blockA.holder);
      expect(blocksContainerOf(gridEl, 0, 1).firstElementChild).toBe(blockB.holder);
    });

    it('skips a block whose parentId points at a different table', () => {
      const gridEl = buildDomGrid(1, 1);
      const foreign = makeStubBlock('a', 'other-table', 'A');

      mountCellBlocksReadOnly(gridEl, [[{ blocks: ['a'] }]], makeBlocksApi([foreign]), tableId);

      expect(blocksContainerOf(gridEl, 0, 0).childElementCount).toBe(0);
    });

    it('clones a holder that is already mounted inside another cell', () => {
      const gridEl = buildDomGrid(2, 1);
      const block = makeStubBlock('a', undefined, 'A');

      // Row 0 already owns the holder; row 1 must copy it, not steal the node.
      blocksContainerOf(gridEl, 0, 0).appendChild(block.holder);

      mountCellBlocksReadOnly(gridEl, [[], [{ blocks: ['a'] }]], makeBlocksApi([block]), tableId);

      const clone = blocksContainerOf(gridEl, 1, 0).firstElementChild;

      expect(clone).not.toBe(block.holder);
      expect(clone?.textContent).toBe('A');
      expect(block.holder.parentElement).toBe(blocksContainerOf(gridEl, 0, 0));
    });

    it('ignores a block id the editor does not know', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        mountCellBlocksReadOnly(gridEl, [[{ blocks: ['ghost'] }]], makeBlocksApi([]), tableId);
      }).not.toThrow();
      expect(blocksContainerOf(gridEl, 0, 0).childElementCount).toBe(0);
    });

    it('skips content rows the rendered grid does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        mountCellBlocksReadOnly(gridEl, [[{ blocks: [] }], [{ blocks: [] }]], makeBlocksApi([]), tableId);
      }).not.toThrow();
    });

    it('skips content columns a row does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        mountCellBlocksReadOnly(gridEl, [[{ blocks: [] }, { blocks: [] }]], makeBlocksApi([]), tableId);
      }).not.toThrow();
    });

    it('skips a cell that has no blocks container', () => {
      const gridEl = buildDomGrid(1, 1);

      blocksContainerOf(gridEl, 0, 0).remove();

      expect(() => {
        mountCellBlocksReadOnly(gridEl, [[{ blocks: [] }]], makeBlocksApi([]), tableId);
      }).not.toThrow();
    });

    it('keeps already-mounted blocks when a second legacy cell renders', () => {
      const gridEl = buildDomGrid(1, 1);
      const container = blocksContainerOf(gridEl, 0, 0);
      const existing = document.createElement('div');

      existing.setAttribute('data-blok-id', 'kept');
      container.appendChild(existing);

      mountCellBlocksReadOnly(gridEl, [['legacy']], makeBlocksApi([]), tableId);

      expect(container.querySelector('[data-blok-id]')).not.toBeNull();
    });

    it('wipes a non-empty cell before re-mounting block holders', () => {
      const gridEl = buildDomGrid(1, 1);
      const container = blocksContainerOf(gridEl, 0, 0);
      const holder = document.createElement('div');

      container.textContent = 'stale text';
      holder.setAttribute('data-blok-id', 'held');
      blocksContainerOf(gridEl, 0, 0).appendChild(holder);

      const block = makeStubBlock('b', undefined, 'B');
      const stubApi = makeBlocksApi([block]);

      // The holder is detached from its own container, so the mount must clear
      // the stale text and place exactly one node.
      container.removeChild(holder);
      container.textContent = 'stale text';
      container.appendChild(block.holder);
      container.insertBefore(document.createTextNode('stale text'), container.firstChild);

      mountCellBlocksReadOnly(gridEl, [[{ blocks: ['b'] }]], stubApi, tableId);

      expect(container.textContent).toBe('B');
      expect(container.querySelectorAll('[data-blok-id]')).toHaveLength(1);
    });

    it('leaves an empty cell alone when new blocks mount into it', () => {
      const gridEl = buildDomGrid(1, 1);
      const container = blocksContainerOf(gridEl, 0, 0);
      const stray = document.createElement('span');
      const block = makeStubBlock('b', undefined, 'B');

      container.appendChild(stray);

      mountCellBlocksReadOnly(gridEl, [[{ blocks: ['b'] }]], makeBlocksApi([block]), tableId);

      // Nothing was there to clear, so the pre-existing node stays put.
      expect(container.contains(stray)).toBe(true);
      expect(container.contains(block.holder)).toBe(true);
    });

    it('replaces legacy text in a cell with no existing blocks', () => {
      const gridEl = buildDomGrid(1, 1);
      const container = blocksContainerOf(gridEl, 0, 0);
      const block = makeStubBlock('b', undefined, 'B');

      container.textContent = 'old legacy';

      mountCellBlocksReadOnly(gridEl, [[{ blocks: ['b'] }]], makeBlocksApi([block]), tableId);

      expect(container.textContent).toBe('B');
    });

    it('strips placeholder attributes from mounted blocks', () => {
      const gridEl = buildDomGrid(1, 1);
      const block = makeStubBlock('b', undefined, 'B');

      block.holder.setAttribute('data-blok-placeholder-active', 'true');
      block.holder.setAttribute('data-placeholder', 'Type something');

      mountCellBlocksReadOnly(gridEl, [[{ blocks: ['b'] }]], makeBlocksApi([block]), tableId);

      expect(block.holder.hasAttribute('data-blok-placeholder-active')).toBe(false);
      expect(block.holder.hasAttribute('data-placeholder')).toBe(false);
    });
  });

  describe('parsePastedTable', () => {
    it('marks every slot a colspan covers as merged into the origin', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td colspan="2">A</td><td>B</td></tr><tr><td>C</td><td>D</td><td>E</td></tr></table>'
      ));

      expect(cellAt(result, 0, 0).colspan).toBe(2);
      expect(cellAt(result, 0, 1).mergedInto).toEqual([0, 0]);
    });

    it('marks every slot a rowspan covers as merged into the origin', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
      ));

      expect(cellAt(result, 0, 0).rowspan).toBe(2);
      expect(cellAt(result, 1, 0).mergedInto).toEqual([0, 0]);
      expect(cellAt(result, 1, 1).text).toBe('C');
    });

    it('clamps a colspan above the HTML maximum to 1000 columns', () => {
      const result = parsePastedTable(rowsFromHtml('<table><tr><td colspan="2000">A</td></tr></table>'));

      expect(cellAt(result, 0, 0).colspan).toBe(1000);
      expect(result[0]).toHaveLength(1000);
    });

    it('clamps a rowspan to the rows that were actually pasted', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td>A</td></tr><tr><td rowspan="5">B</td></tr></table>'
      ));

      // Row 1 is the last one, so nothing is left to span — recording rowspan 5
      // would write covered slots into rows that do not exist.
      expect(cellAt(result, 1, 0).rowspan).toBeUndefined();
      expect(result).toHaveLength(2);
    });

    it('drops a cell-less <tr> when the pasted table has no merges', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td>A</td></tr><tr></tr><tr><td>B</td></tr></table>'
      ));

      expect(result).toHaveLength(2);
      expect(cellAt(result, 1, 0).text).toBe('B');
    });

    it('keeps a cell-less <tr> when the table has merges, so coordinates stay put', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td colspan="2">A</td></tr><tr></tr></table>'
      ));

      expect(result).toHaveLength(2);
    });

    it('builds plain cells with no span keys at all', () => {
      const result = parsePastedTable(rowsFromHtml('<table><tr><td>B</td></tr></table>'));

      expect(cellAt(result, 0, 0)).toStrictEqual({ blocks: [], text: 'B' });
    });

    it('fills ragged rows up to the widest row', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>'
      ));

      expect(result[1][1]).toStrictEqual({ blocks: [] });
    });

    it('gives covered slots an empty block list', () => {
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td colspan="2">A</td></tr></table>'
      ));

      expect(cellAt(result, 0, 1).blocks).toEqual([]);
    });

    it('treats a non-numeric colspan as a single column', () => {
      const result = parsePastedTable(rowsFromHtml('<table><tr><td colspan="abc">A</td></tr></table>'));

      expect(cellAt(result, 0, 0).colspan).toBeUndefined();
      expect(result[0]).toHaveLength(1);
    });

    it('keeps the column cursor sane after a non-numeric colspan', () => {
      // A NaN span would push the next cell to index NaN and lose it entirely.
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td colspan="abc">A</td><td>B</td></tr></table>'
      ));

      expect(result[0]).toHaveLength(2);
      expect(cellAt(result, 0, 1).text).toBe('B');
    });

    it('keeps the column cursor sane after a negative colspan', () => {
      // A negative span would walk the cursor backwards and lose the next cell.
      const result = parsePastedTable(rowsFromHtml(
        '<table><tr><td colspan="-1">A</td><td>B</td></tr></table>'
      ));

      expect(cellAt(result, 0, 0).colspan).toBeUndefined();
      expect(result[0]).toHaveLength(2);
      expect(cellAt(result, 0, 1).text).toBe('B');
    });

    it('merges per-cell props from the extractor', () => {
      const result = parsePastedTable(
        rowsFromHtml('<table><tr><td>A</td></tr></table>'),
        () => ({ color: 'red' }),
      );

      expect(cellAt(result, 0, 0)).toStrictEqual({ blocks: [], text: 'A', color: 'red' });
    });
  });

  describe('normalizeTableData', () => {
    it('falls back to config defaults for data that is not a table', () => {
      const result = normalizeTableData({}, { withHeadings: true, withHeadingColumn: true, stretched: true });

      expect(result).toStrictEqual({
        withHeadings: true,
        withHeadingColumn: true,
        stretched: true,
        content: [],
      });
    });

    it('defaults every flag to false when nothing is configured', () => {
      expect(normalizeTableData({}, {})).toStrictEqual({
        withHeadings: false,
        withHeadingColumn: false,
        stretched: false,
        content: [],
      });
    });

    it('defaults the flags to false for table data that carries none', () => {
      const result = normalizeTableData({ content: [[{ blocks: [] }]] } as unknown as TableData, {});

      expect(result.withHeadings).toBe(false);
      expect(result.withHeadingColumn).toBe(false);
      expect(result.stretched).toBe(false);
    });

    it('treats null data as a table with no content', () => {
      const result = normalizeTableData(null as unknown as unknown as TableData, {});

      expect(result).toStrictEqual({
        withHeadings: false,
        withHeadingColumn: false,
        stretched: false,
        content: [],
      });
    });

    it('treats a primitive as data that is not a table', () => {
      const result = normalizeTableData('hello' as unknown as unknown as TableData, {});

      expect(result).toStrictEqual({
        withHeadings: false,
        withHeadingColumn: false,
        stretched: false,
        content: [],
      });
    });

    it('treats a table whose content key is present but empty as having no content', () => {
      const result = normalizeTableData({ content: undefined } as unknown as unknown as TableData, {});

      expect(result.content).toEqual([]);
    });

    it('lets stored flags win over the config', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }]], withHeadings: true, withHeadingColumn: true, stretched: true },
        { withHeadings: false, withHeadingColumn: false, stretched: false },
      );

      expect(result.withHeadings).toBe(true);
      expect(result.withHeadingColumn).toBe(true);
      expect(result.stretched).toBe(true);
    });

    it('takes the config flag when the stored one is absent', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }]] } as unknown as TableData,
        { withHeadings: true, withHeadingColumn: true, stretched: true },
      );

      expect(result.withHeadings).toBe(true);
      expect(result.withHeadingColumn).toBe(true);
      expect(result.stretched).toBe(true);
    });

    it('rectangularizes the stored content', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }]] } as unknown as TableData,
        {},
      );

      expect(result.content[1]).toEqual([{ blocks: [] }, { blocks: [] }]);
    });

    it('uses the recorded widths when they match the column count', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }, { blocks: [] }]], colWidths: [100, 200] } as unknown as TableData,
        {},
      );

      expect(result.colWidths).toEqual([100, 200]);
    });

    it('drops widths whose count does not match the columns', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }, { blocks: [] }]], colWidths: [100, 200, 300] } as unknown as TableData,
        {},
      );

      expect(result.colWidths).toBeUndefined();
    });

    it('drops widths when the table has no columns', () => {
      const result = normalizeTableData({ content: [], colWidths: [] } as unknown as TableData, {});

      expect(result.colWidths).toBeUndefined();
    });

    it('drops widths for a table with no recorded widths at all', () => {
      const result = normalizeTableData({ content: [[{ blocks: [] }]] } as unknown as TableData, {});

      expect(result.colWidths).toBeUndefined();
    });

    it('drops widths that are not positive finite numbers', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }, { blocks: [] }]], colWidths: [100, -5] } as unknown as TableData,
        {},
      );

      expect(result.colWidths).toBeUndefined();
    });

    it('drops a zero width, which no real column has', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }, { blocks: [] }]], colWidths: [100, 0] } as unknown as TableData,
        {},
      );

      expect(result.colWidths).toBeUndefined();
    });

    it('carries initialColWidth and textSize through untouched', () => {
      const result = normalizeTableData(
        { content: [[{ blocks: [] }]], initialColWidth: 180, textSize: 'comfortable' } as unknown as TableData,
        {},
      );

      expect(result.initialColWidth).toBe(180);
      expect(result.textSize).toBe('comfortable');
    });
  });

  describe('setupKeyboardNavigation', () => {
    interface KeyCall {
      name: string;
      position: { row: number; col: number } | null;
    }

    const makeNavigationStub = (): { calls: KeyCall[]; blocks: TableCellBlocks } => {
      const calls: KeyCall[] = [];

      const stub = {
        handleKeyDown: (_event: KeyboardEvent, position: { row: number; col: number }): void => {
          calls.push({ name: 'keyDown', position });
        },
        handleArrowNavigation: (_event: KeyboardEvent, position: { row: number; col: number }): void => {
          calls.push({ name: 'arrowNavigation', position });
        },
      };

      return { calls, blocks: stub as unknown as TableCellBlocks };
    };

    it('routes arrow keys through the capture listener and other keys through the bubble one', () => {
      const gridEl = buildDomGrid(1, 1);
      const cell = cellAtCoord(gridEl, 0, 0);
      const stub = makeNavigationStub();

      setupKeyboardNavigation(gridEl, stub.blocks);
      cell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

      expect(stub.calls).toEqual([
        { name: 'arrowNavigation', position: { row: 0, col: 0 } },
        { name: 'keyDown', position: { row: 0, col: 0 } },
      ]);
    });

    it('ignores a keydown that did not originate inside a cell', () => {
      const gridEl = buildDomGrid(1, 1);
      const stub = makeNavigationStub();

      setupKeyboardNavigation(gridEl, stub.blocks);
      gridEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

      expect(stub.calls).toEqual([]);
    });

    it('does nothing when there is no cell-blocks helper', () => {
      const gridEl = buildDomGrid(1, 1);
      const cell = cellAtCoord(gridEl, 0, 0);

      setupKeyboardNavigation(gridEl, null);

      expect(() => {
        cell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      }).not.toThrow();
    });

    it('detaches both listeners on cleanup', () => {
      const gridEl = buildDomGrid(1, 1);
      const cell = cellAtCoord(gridEl, 0, 0);
      const stub = makeNavigationStub();
      const detach = setupKeyboardNavigation(gridEl, stub.blocks);

      detach();
      cell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

      expect(stub.calls).toEqual([]);
    });

    it('detaches the capture listener too, not just the bubble one', () => {
      const gridEl = buildDomGrid(1, 1);
      const cell = cellAtCoord(gridEl, 0, 0);
      const stub = makeNavigationStub();
      const detach = setupKeyboardNavigation(gridEl, stub.blocks);

      detach();
      cell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

      expect(stub.calls.filter(call => call.name === 'arrowNavigation')).toEqual([]);
    });
  });

  describe('enableScrollOverflow', () => {
    it('adds both scroll classes to the element', () => {
      const element = document.createElement('div');

      enableScrollOverflow(element);

      expect(Array.from(element.classList).sort()).toEqual(['overflow-x-auto', 'overflow-y-hidden']);
    });

    it('accepts a null element', () => {
      expect(() => enableScrollOverflow(null)).not.toThrow();
    });
  });

  describe('updateHeadingStyles', () => {
    it('marks the first row as the heading row and its cells as column headers', () => {
      const gridEl = buildDomGrid(2, 2);

      updateHeadingStyles(gridEl, true);

      const rows = gridEl.querySelectorAll(`[${ROW_ATTR}]`);

      expect(rows[0].hasAttribute(HEADING_ROW_ATTR)).toBe(true);
      expect(rows[0].getAttribute(HEADING_ROW_ATTR)).toBe('');
      expect(rows[1].hasAttribute(HEADING_ROW_ATTR)).toBe(false);
      expect(cellAtCoord(gridEl, 0, 0)?.getAttribute('role')).toBe('columnheader');
      expect(cellAtCoord(gridEl, 1, 0)?.getAttribute('role')).toBeNull();
    });

    it('clears a stale heading row when headings are turned off', () => {
      const gridEl = buildDomGrid(1, 1);
      const row = gridEl.querySelectorAll(`[${ROW_ATTR}]`)[0];

      row.setAttribute(HEADING_ROW_ATTR, '');

      updateHeadingStyles(gridEl, false);

      expect(row.hasAttribute(HEADING_ROW_ATTR)).toBe(false);
    });

    it('ignores a null grid', () => {
      expect(() => updateHeadingStyles(null, true)).not.toThrow();
    });

    it('does not touch row zero when a heading table renders no rows', () => {
      const gridEl = buildGridEl([], []);

      expect(() => updateHeadingStyles(gridEl, true)).not.toThrow();
    });

    it('keeps row headers on column 0 when both header modes are on', () => {
      const gridEl = buildDomGrid(2, 2);

      updateHeadingColumnStyles(gridEl, true);
      updateHeadingStyles(gridEl, true);

      expect(cellAtCoord(gridEl, 1, 0)?.getAttribute('role')).toBe('rowheader');
      expect(cellAtCoord(gridEl, 1, 1)?.getAttribute('role')).toBeNull();
    });
  });

  describe('updateTextSizeStyles', () => {
    it('marks the grid comfortable', () => {
      const gridEl = buildDomGrid(1, 1);

      updateTextSizeStyles(gridEl, 'comfortable');

      expect(gridEl.getAttribute(TEXT_SIZE_ATTR)).toBe('comfortable');
    });

    it('removes the marker in compact mode', () => {
      const gridEl = buildDomGrid(1, 1);

      gridEl.setAttribute(TEXT_SIZE_ATTR, 'comfortable');

      updateTextSizeStyles(gridEl, 'compact');

      expect(gridEl.hasAttribute(TEXT_SIZE_ATTR)).toBe(false);
    });

    it('ignores a null grid', () => {
      expect(() => updateTextSizeStyles(null, 'comfortable')).not.toThrow();
    });
  });

  describe('applyCellColors', () => {
    it('paints the stored background and text colours', () => {
      const gridEl = buildDomGrid(1, 2);
      const content: LegacyCellContent[][] = [[{ blocks: [], color: 'red', textColor: 'blue' }, { blocks: [] }]];

      applyCellColors(gridEl, content);

      expect(cellAtCoord(gridEl, 0, 0)?.style.backgroundColor).toBe('red');
      expect(cellAtCoord(gridEl, 0, 0)?.style.color).toBe('blue');
    });

    it('clears a stale colour on a cell that no longer has one', () => {
      const gridEl = buildDomGrid(1, 2);
      const plain = cellAtCoord(gridEl, 0, 1);

      if (plain === null) {
        throw new Error('fixture cell missing');
      }

      plain.style.backgroundColor = 'red';
      plain.style.color = 'blue';

      // A blocks cell with no colour must clear the previous one, not write
      // undefined at it and leave the stale paint in place.
      applyCellColors(gridEl, [[{ blocks: [], color: 'red' }, { blocks: [] }]]);

      expect(plain.style.backgroundColor).toBe('');
      expect(plain.style.color).toBe('');
    });

    it('clears a stale colour on a legacy cell too', () => {
      const gridEl = buildDomGrid(1, 2);
      const stale = cellAtCoord(gridEl, 0, 1);

      if (stale === null) {
        throw new Error('fixture cell missing');
      }

      stale.style.backgroundColor = 'red';
      stale.style.color = 'blue';

      applyCellColors(gridEl, [[{ blocks: [], color: 'red' }, 'legacy']]);

      expect(stale.style.backgroundColor).toBe('');
      expect(stale.style.color).toBe('');
    });

    it('ignores content rows the grid does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        applyCellColors(gridEl, [[{ blocks: [], color: 'red' }], [{ blocks: [], color: 'blue' }]]);
      }).not.toThrow();
    });

    it('ignores content columns a row does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        applyCellColors(gridEl, [[{ blocks: [], color: 'red' }, { blocks: [], color: 'blue' }]]);
      }).not.toThrow();
    });
  });

  describe('applyCellPlacements', () => {
    it('records a non-default placement on the blocks container', () => {
      const gridEl = buildDomGrid(1, 1);

      applyCellPlacements(gridEl, [[{ blocks: [], placement: 'bottom-right' }]]);

      expect(blocksContainerOf(gridEl, 0, 0).getAttribute('data-blok-cell-placement')).toBe('bottom-right');
    });

    it('removes the placement attribute for a legacy cell', () => {
      const gridEl = buildDomGrid(1, 1);
      const container = blocksContainerOf(gridEl, 0, 0);

      container.setAttribute('data-blok-cell-placement', 'bottom-right');

      applyCellPlacements(gridEl, [[{ blocks: [] }]]);

      expect(container.hasAttribute('data-blok-cell-placement')).toBe(false);
    });

    it('does not record the default top-left placement', () => {
      const gridEl = buildDomGrid(1, 1);

      applyCellPlacements(gridEl, [[{ blocks: [], placement: 'top-left' }]]);

      expect(blocksContainerOf(gridEl, 0, 0).hasAttribute('data-blok-cell-placement')).toBe(false);
    });

    it('ignores content rows the grid does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        applyCellPlacements(gridEl, [[{ blocks: [] }], [{ blocks: [], placement: 'bottom-right' }]]);
      }).not.toThrow();
    });

    it('ignores content columns a row does not have', () => {
      const gridEl = buildDomGrid(1, 1);

      expect(() => {
        applyCellPlacements(gridEl, [[{ blocks: [] }, { blocks: [], placement: 'bottom-right' }]]);
      }).not.toThrow();
    });

    it('ignores a cell with no blocks container', () => {
      const gridEl = buildDomGrid(1, 1);

      blocksContainerOf(gridEl, 0, 0).remove();

      expect(() => {
        applyCellPlacements(gridEl, [[{ blocks: [], placement: 'bottom-right' }]]);
      }).not.toThrow();
    });
  });

  describe('updateHeadingColumnStyles', () => {
    it('shades the logical column 0 of every row', () => {
      const gridEl = buildDomGrid(2, 2);

      updateHeadingColumnStyles(gridEl, true);

      expect(cellAtCoord(gridEl, 0, 0)?.hasAttribute(HEADING_COL_ATTR)).toBe(true);
      expect(cellAtCoord(gridEl, 0, 0)?.getAttribute(HEADING_COL_ATTR)).toBe('');
      expect(cellAtCoord(gridEl, 1, 0)?.hasAttribute(HEADING_COL_ATTR)).toBe(true);
      expect(cellAtCoord(gridEl, 1, 0)?.getAttribute(HEADING_COL_ATTR)).toBe('');
      expect(cellAtCoord(gridEl, 1, 1)?.hasAttribute(HEADING_COL_ATTR)).toBe(false);
    });

    it('marks column 0 cells as row headers for assistive tech', () => {
      const gridEl = buildDomGrid(2, 2);

      updateHeadingColumnStyles(gridEl, true);

      expect(cellAtCoord(gridEl, 0, 0)?.getAttribute('role')).toBe('rowheader');
      expect(cellAtCoord(gridEl, 0, 1)?.getAttribute('role')).toBeNull();
    });

    it('clears stale heading column markers', () => {
      const gridEl = buildDomGrid(1, 2);

      updateHeadingColumnStyles(gridEl, true);
      updateHeadingColumnStyles(gridEl, false);

      expect(cellAtCoord(gridEl, 0, 0)?.hasAttribute(HEADING_COL_ATTR)).toBe(false);
      expect(cellAtCoord(gridEl, 0, 0)?.getAttribute('role')).toBeNull();
    });

    it('ignores rows that have no cell in column 0', () => {
      const gridEl = buildDomGrid(2, 2);

      cellAtCoord(gridEl, 1, 0)?.remove();

      expect(() => updateHeadingColumnStyles(gridEl, true)).not.toThrow();
      expect(cellAtCoord(gridEl, 0, 0)?.hasAttribute(HEADING_COL_ATTR)).toBe(true);
    });

    it('ignores a null grid', () => {
      expect(() => updateHeadingColumnStyles(null, true)).not.toThrow();
    });
  });
});
