import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import { TableGrid, ROW_ATTR, CELL_ATTR } from '../../../../src/tools/table/table-core';
import {
  computeAvgWidth,
  computeInsertColumnWidths,
  isRowEmpty,
  parsePastedTable,
  rectangularizeContent,
  syncColWidthsAfterDeleteColumn,
  syncColWidthsAfterMove,
} from '../../../../src/tools/table/table-operations';
import type { CellContent } from '../../../../src/tools/table/types';

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

describe('table-operations — surviving-mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncColWidthsAfterMove', () => {
    it('carries the moved column width to its new index', () => {
      expect(syncColWidthsAfterMove([100, 200, 300], 0, 2)).toEqual([200, 300, 100]);
    });

    it('keeps the untouched widths when a column moves left', () => {
      expect(syncColWidthsAfterMove([100, 200, 300], 2, 0)).toEqual([300, 100, 200]);
    });
  });

  describe('syncColWidthsAfterDeleteColumn', () => {
    it('removes exactly the deleted column width', () => {
      expect(syncColWidthsAfterDeleteColumn([100, 200, 300], 1)).toEqual([100, 300]);
    });

    it('returns undefined when the last width goes, so the grid falls back to equal widths', () => {
      expect(syncColWidthsAfterDeleteColumn([100], 0)).toBeUndefined();
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
  });
});
