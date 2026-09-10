import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import {
  CELL_ATTR,
  CELL_COL_ATTR,
  CELL_ROW_ATTR,
  ROW_ATTR,
  TableGrid,
  equalWidths,
} from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent } from '../../../../src/tools/table/types';

const BORDER = '1px solid var(--blok-table-border)';

/** Narrow a nullable DOM lookup without `!`, naming the fixture part that is missing. */
const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`fixture is missing ${what}`);
  }

  return value;
};

interface RawTableOptions {
  rows: number;
  cols: number;
  /** Omitted means no <colgroup> at all; `[]` means a <colgroup> with no <col> in it. */
  colWidths?: string[];
}

/**
 * A hand-built table. Nothing here stamps coordinate attributes, which is what
 * the index-based fallbacks in getCell/getColumnCount are for, and every cell
 * carries its own text so a move can be checked by identity rather than shape.
 */
const rawTable = ({ rows, cols, colWidths }: RawTableOptions): HTMLTableElement => {
  const table = document.createElement('table');

  if (colWidths !== undefined) {
    const colgroup = document.createElement('colgroup');

    colWidths.forEach((width) => {
      const col = document.createElement('col');

      if (width !== '') {
        col.style.width = width;
      }
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  }

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach((_, rowIndex) => {
    const row = document.createElement('tr');

    row.setAttribute(ROW_ATTR, '');

    Array.from({ length: cols }).forEach((__, colIndex) => {
      const cell = document.createElement('td');

      cell.setAttribute(CELL_ATTR, '');
      cell.textContent = `r${rowIndex}c${colIndex}`;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  return table;
};

const modelOf = (rows: number, cols: number, colWidths?: number[]): TableModel => {
  const content: CellContent[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ blocks: [] })));

  return new TableModel({ content, colWidths });
};

const rowTexts = (table: HTMLElement): string[][] =>
  Array.from(table.querySelectorAll(`[${ROW_ATTR}]`)).map(row =>
    Array.from(row.querySelectorAll(`[${CELL_ATTR}]`)).map(cell => cell.textContent ?? ''));

const colWidthsOf = (table: HTMLElement): string[] =>
  Array.from(table.querySelectorAll<HTMLElement>('col')).map(col => col.style.width);

const coordsOf = (table: HTMLElement): string[][] =>
  Array.from(table.querySelectorAll(`[${ROW_ATTR}]`)).map(row =>
    Array.from(row.querySelectorAll(`[${CELL_ATTR}]`)).map(
      cell => `${cell.getAttribute(CELL_ROW_ATTR)},${cell.getAttribute(CELL_COL_ATTR)}`));

describe('TableGrid — mutation coverage', () => {
  let grid: TableGrid;

  beforeEach(() => {
    vi.clearAllMocks();
    grid = new TableGrid({ readOnly: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shared constants', () => {
    it('draws table and cell edges with the border token', () => {
      const table = grid.createGrid(1, 1);
      const cell = must(table.querySelector<HTMLElement>(`[${CELL_ATTR}]`), 'a cell');

      expect({
        tableTop: table.style.borderTop,
        tableLeft: table.style.borderLeft,
        cellRight: cell.style.borderRight,
        cellBottom: cell.style.borderBottom,
      }).toEqual({
        tableTop: BORDER,
        tableLeft: BORDER,
        cellRight: BORDER,
        cellBottom: BORDER,
      });
    });

    it('keeps every utility class the cell box is styled with', () => {
      const table = grid.createGrid(1, 1);
      const cell = must(table.querySelector<HTMLElement>(`[${CELL_ATTR}]`), 'a cell');

      expect(cell.className.split(' ').filter(Boolean)).toEqual(
        expect.arrayContaining(['py-1', 'px-2', 'min-h-[2em]', 'outline-hidden', 'leading-none', 'cursor-text'])
      );
    });

    it('equalWidths splits 100 across the columns, rounded to two decimals', () => {
      expect({ three: equalWidths(3), eight: equalWidths(8) }).toEqual({
        three: [33.33, 33.33, 33.33],
        eight: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
      });
    });
  });

  describe('createGrid', () => {
    it('a fluid table carries the layout styles and the per-column floor', () => {
      const table = grid.createGrid(2, 3);

      expect({
        layout: table.style.tableLayout,
        width: table.style.width,
        minWidth: table.style.minWidth,
      }).toEqual({ layout: 'fixed', width: '100%', minWidth: '150px' });
    });

    it('explicit widths replace the fluid floor', () => {
      const table = grid.createGrid(2, 3, [20, 30, 50]);

      expect({ minWidth: table.style.minWidth, widths: colWidthsOf(table) }).toEqual({
        minWidth: '',
        widths: ['20%', '30%', '50%'],
      });
    });

    it('a width that already carries its unit is written verbatim, not suffixed with %', () => {
      // createCol declares `number | string` for its width; every in-tree caller
      // passes a number, so this is the only way the unit-carrying branch runs.
      const table = grid.createGrid(1, 2, ['10px', '20px'] as unknown as number[]);

      expect(colWidthsOf(table)).toEqual(['10px', '20px']);
    });

    it('rows are flagged with a valueless attribute', () => {
      const table = grid.createGrid(1, 1);

      expect(must(table.querySelector(`[${ROW_ATTR}]`), 'a row').getAttribute(ROW_ATTR)).toBe('');
    });

    it('every cell is stamped with its own coordinates', () => {
      expect(coordsOf(grid.createGrid(2, 2))).toEqual([['0,0', '0,1'], ['1,0', '1,1']]);
    });

    it('a cell carries the box styles and the block-container contract', () => {
      const table = grid.createGrid(1, 1);
      const cell = must(table.querySelector<HTMLElement>(`[${CELL_ATTR}]`), 'a cell');
      const container = must(cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`), 'a blocks container');

      expect({
        cellFlag: cell.getAttribute(CELL_ATTR),
        height: cell.style.height,
        blocksFlag: container.getAttribute(CELL_BLOCKS_ATTR),
        nestedFlag: container.getAttribute(DATA_ATTR.nestedBlocks),
        mutationFree: container.getAttribute(DATA_ATTR.mutationFree),
        display: container.style.display,
        flexDirection: container.style.flexDirection,
        minHeight: container.style.minHeight,
      }).toEqual({
        cellFlag: '',
        height: '0px',
        blocksFlag: '',
        nestedFlag: '',
        mutationFree: 'true',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
      });
    });
  });

  describe('createGridFromModel', () => {
    it('a model without widths carries the layout styles and the per-column floor', () => {
      const table = grid.createGridFromModel(modelOf(2, 3));

      expect({
        layout: table.style.tableLayout,
        width: table.style.width,
        borderCollapse: table.style.borderCollapse,
        borderSpacing: table.style.borderSpacing,
        minWidth: table.style.minWidth,
      }).toEqual({
        layout: 'fixed',
        width: '100%',
        borderCollapse: 'separate',
        borderSpacing: '0px',
        minWidth: '150px',
      });
    });

    it('a model with widths replaces the fluid floor', () => {
      const table = grid.createGridFromModel(modelOf(2, 3, [20, 30, 50]));

      expect({ minWidth: table.style.minWidth, widths: colWidthsOf(table) }).toEqual({
        minWidth: '',
        widths: ['20%', '30%', '50%'],
      });
    });

    it('rows are flagged with a valueless attribute', () => {
      const table = grid.createGridFromModel(modelOf(1, 1));

      expect(must(table.querySelector(`[${ROW_ATTR}]`), 'a row').getAttribute(ROW_ATTR)).toBe('');
    });

    it('an unmerged cell carries no span attributes at all', () => {
      const table = grid.createGridFromModel(modelOf(2, 2));

      expect(Array.from(table.querySelectorAll(`[${CELL_ATTR}]`)).map(
        cell => [cell.hasAttribute('colspan'), cell.hasAttribute('rowspan')]
      )).toEqual([[false, false], [false, false], [false, false], [false, false]]);
    });

    it('a merged cell renders its spans and the covered cells are dropped', () => {
      const model = modelOf(3, 3);

      model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

      const table = grid.createGridFromModel(model);
      const origin = must(table.querySelector(`[${CELL_ATTR}]`), 'the merge origin');

      expect({
        colspan: origin.getAttribute('colspan'),
        rowspan: origin.getAttribute('rowspan'),
        cellsPerRow: rowTexts(table).map(row => row.length),
      }).toEqual({ colspan: '2', rowspan: '2', cellsPerRow: [2, 1, 3] });
    });
  });

  describe('addRow', () => {
    it('inserts before the row at the given index', () => {
      const table = grid.createGrid(3, 2);
      const before = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));
      const added = grid.addRow(table, 1);

      expect(Array.from(table.querySelectorAll(`[${ROW_ATTR}]`)).map(
        row => (row === added ? 'new' : `old${before.indexOf(row)}`)
      )).toEqual(['old0', 'new', 'old1', 'old2']);
    });

    it('appends when the index is omitted or past the last row', () => {
      const appended = grid.addRow(grid.createGrid(2, 2));
      const pastEnd = grid.createGrid(2, 2);
      const addedPastEnd = grid.addRow(pastEnd, 7);

      expect({
        appendedIsLast: appended.parentElement?.lastElementChild === appended,
        pastEndIsLast: addedPastEnd.parentElement?.lastElementChild === addedPastEnd,
      }).toEqual({ appendedIsLast: true, pastEndIsLast: true });
    });
  });

  describe('deleteRow', () => {
    it('an index past the last row is ignored rather than reaching for a missing row', () => {
      const table = grid.createGrid(2, 2);

      expect(() => grid.deleteRow(table, 2)).not.toThrow();
      expect(grid.getRowCount(table)).toBe(2);
    });

    it('removes the row at the index and renumbers the rest', () => {
      const table = rawTable({ rows: 3, cols: 1 });

      grid.deleteRow(table, 1);

      expect({ texts: rowTexts(table), coords: coordsOf(table) }).toEqual({
        texts: [['r0c0'], ['r2c0']],
        coords: [['0,0'], ['1,0']],
      });
    });
  });

  describe('addColumn', () => {
    it('reports that the column was added', () => {
      expect(grid.addColumn(grid.createGrid(2, 2))).toBe(true);
    });

    it('a percent table shrinks its columns and the new one takes half a share', () => {
      const table = grid.createGrid(1, 2, [60, 40]);

      grid.addColumn(table);

      expect(colWidthsOf(table)).toEqual(['45%', '30%', '25%']);
    });

    it('a colWidths array whose length does not match the columns is ignored', () => {
      const table = grid.createGrid(1, 2, [60, 40]);

      grid.addColumn(table, undefined, [999]);

      expect(colWidthsOf(table)).toEqual(['45%', '30%', '25%']);
    });

    it('a column with no width of its own falls back to an equal share', () => {
      const table = rawTable({ rows: 1, cols: 2, colWidths: ['', ''] });

      grid.addColumn(table);

      expect(colWidthsOf(table)).toEqual(['37.5%', '37.5%', '25%']);
    });

    it('matching pixel widths are written onto the existing columns', () => {
      const table = grid.createGrid(1, 2, [60, 40]);

      grid.addColumn(table, undefined, [120, 80], 50);

      expect(colWidthsOf(table)).toEqual(['120px', '80px', '50px']);
    });

    it('inserts the new column before the given index, in both the colgroup and every row', () => {
      const table = rawTable({ rows: 1, cols: 3, colWidths: ['10px', '20px', '30px'] });

      grid.addColumn(table, 1, [10, 20, 30], 40);

      expect({ widths: colWidthsOf(table), texts: rowTexts(table)[0] }).toEqual({
        widths: ['10px', '40px', '20px', '30px'],
        texts: ['r0c0', '', 'r0c1', 'r0c2'],
      });
    });

    it('an index at the end appends', () => {
      const table = rawTable({ rows: 1, cols: 2, colWidths: ['10px', '20px'] });

      grid.addColumn(table, 2, [10, 20], 40);

      expect({ widths: colWidthsOf(table), texts: rowTexts(table)[0] }).toEqual({
        widths: ['10px', '20px', '40px'],
        texts: ['r0c0', 'r0c1', ''],
      });
    });

    it('an empty colgroup yields a zero-width column, never a NaN one', () => {
      const table = rawTable({ rows: 1, cols: 1, colWidths: [] });

      grid.addColumn(table, undefined, []);

      expect(colWidthsOf(table)).toEqual(['0px']);
    });

    it('an empty colgroup does not break the width-unit probe', () => {
      const table = rawTable({ rows: 1, cols: 1, colWidths: [] });

      expect(() => grid.addColumn(table)).not.toThrow();
    });
  });

  describe('deleteColumn', () => {
    it('an index past the last column is ignored rather than reaching for a missing cell', () => {
      const table = grid.createGrid(2, 3);

      expect(() => grid.deleteColumn(table, 3)).not.toThrow();
      expect({ cols: grid.getColumnCount(table), perRow: rowTexts(table).map(row => row.length) })
        .toEqual({ cols: 3, perRow: [3, 3] });
    });

    it('removes the <col> and one cell per row', () => {
      const table = rawTable({ rows: 2, cols: 3, colWidths: ['10px', '20px', '30px'] });

      grid.deleteColumn(table, 1);

      expect({ widths: colWidthsOf(table), texts: rowTexts(table) }).toEqual({
        widths: ['10px', '30px'],
        texts: [['r0c0', 'r0c2'], ['r1c0', 'r1c2']],
      });
    });
  });

  describe('moveRow', () => {
    const threeRows = (): HTMLTableElement => rawTable({ rows: 3, cols: 2 });
    const labels = (table: HTMLElement): string[] =>
      rowTexts(table).map(row => row[0] ?? '<row lost>');

    it('moves a row forward to the requested index', () => {
      const table = threeRows();

      grid.moveRow(table, 0, 1);

      expect(labels(table)).toEqual(['r1c0', 'r0c0', 'r2c0']);
    });

    it('a move to the last index lands at the end and keeps the row', () => {
      const table = threeRows();

      grid.moveRow(table, 0, 2);

      expect(labels(table)).toEqual(['r1c0', 'r2c0', 'r0c0']);
    });

    it('moves a row backward', () => {
      const table = threeRows();

      grid.moveRow(table, 2, 0);

      expect(labels(table)).toEqual(['r2c0', 'r0c0', 'r1c0']);
    });

    it('a source index at or past the end leaves the table alone', () => {
      const table = threeRows();

      expect(() => grid.moveRow(table, 3, 0)).not.toThrow();
      expect(labels(table)).toEqual(['r0c0', 'r1c0', 'r2c0']);
    });

    it('a target index at or past the end leaves the table alone', () => {
      const table = threeRows();

      expect(() => grid.moveRow(table, 0, 3)).not.toThrow();
      expect(labels(table)).toEqual(['r0c0', 'r1c0', 'r2c0']);
    });

    it('a same-index move returns before touching the DOM', () => {
      const table = threeRows();
      const cell = must(table.querySelector(`[${CELL_ATTR}]`), 'a cell');

      cell.setAttribute(CELL_COL_ATTR, 'untouched');
      grid.moveRow(table, 1, 1);

      expect(cell.getAttribute(CELL_COL_ATTR)).toBe('untouched');
    });
  });

  describe('moveColumn', () => {
    const threeCols = (): HTMLTableElement =>
      rawTable({ rows: 2, cols: 3, colWidths: ['10px', '20px', '30px'] });

    it('moves the <col> and the cells to the requested index together', () => {
      const table = threeCols();

      grid.moveColumn(table, 0, 1);

      expect({ widths: colWidthsOf(table), texts: rowTexts(table) }).toEqual({
        widths: ['20px', '10px', '30px'],
        texts: [['r0c1', 'r0c0', 'r0c2'], ['r1c1', 'r1c0', 'r1c2']],
      });
    });

    it('a move to the last index lands at the end and keeps the column', () => {
      const table = threeCols();

      grid.moveColumn(table, 0, 2);

      expect({ widths: colWidthsOf(table), texts: rowTexts(table) }).toEqual({
        widths: ['20px', '30px', '10px'],
        texts: [['r0c1', 'r0c2', 'r0c0'], ['r1c1', 'r1c2', 'r1c0']],
      });
    });

    it('a source index at or past the end leaves the table alone', () => {
      const table = threeCols();

      expect(() => grid.moveColumn(table, 3, 0)).not.toThrow();
      expect({ widths: colWidthsOf(table), texts: rowTexts(table) }).toEqual({
        widths: ['10px', '20px', '30px'],
        texts: [['r0c0', 'r0c1', 'r0c2'], ['r1c0', 'r1c1', 'r1c2']],
      });
    });

    it('a target index at or past the end leaves the table alone', () => {
      const table = threeCols();

      expect(() => grid.moveColumn(table, 0, 3)).not.toThrow();
      expect({ widths: colWidthsOf(table), texts: rowTexts(table) }).toEqual({
        widths: ['10px', '20px', '30px'],
        texts: [['r0c0', 'r0c1', 'r0c2'], ['r1c0', 'r1c1', 'r1c2']],
      });
    });

    it('a same-index move returns before touching the DOM', () => {
      const table = threeCols();
      const cell = must(table.querySelector(`[${CELL_ATTR}]`), 'a cell');

      cell.setAttribute(CELL_COL_ATTR, 'untouched');
      grid.moveColumn(table, 1, 1);

      expect(cell.getAttribute(CELL_COL_ATTR)).toBe('untouched');
    });
  });

  describe('reindexCoordinates', () => {
    it('a colspan advances the model column by its own width', () => {
      const table = rawTable({ rows: 1, cols: 3 });
      const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`));

      cells[0].colSpan = 2;
      cells[2].remove();
      grid.reindexCoordinates(table);

      expect(coordsOf(table)).toEqual([['0,0', '0,2']]);
    });

    it('a rowspan blocks its column only for the rows it actually covers', () => {
      const table = rawTable({ rows: 3, cols: 2 });
      const rows = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));
      const origin = must(rows[0].querySelector<HTMLTableCellElement>(`[${CELL_ATTR}]`), 'the rowspan origin');

      origin.rowSpan = 2;
      must(rows[1].querySelector(`[${CELL_ATTR}]`), 'the covered cell').remove();
      grid.reindexCoordinates(table);

      expect(coordsOf(table)).toEqual([['0,0', '0,1'], ['1,1'], ['2,0', '2,1']]);
    });

    it('two rowspans reaching the same row both keep their columns blocked', () => {
      const table = rawTable({ rows: 2, cols: 3 });
      const rows = Array.from(table.querySelectorAll(`[${ROW_ATTR}]`));
      const first = Array.from(rows[0].querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`));
      const second = Array.from(rows[1].querySelectorAll(`[${CELL_ATTR}]`));

      first[0].rowSpan = 2;
      first[2].rowSpan = 2;
      second[2].remove();
      second[0].remove();
      grid.reindexCoordinates(table);

      expect(coordsOf(table)).toEqual([['0,0', '0,1', '0,2'], ['1,1']]);
    });
  });

  describe('getCell', () => {
    const plain = (): HTMLTableElement => rawTable({ rows: 2, cols: 3 });

    it('falls back to the row/column index when no coordinates are stamped', () => {
      const table = plain();
      const expected = Array.from(table.querySelectorAll(`[${CELL_ATTR}]`))[4];

      expect(grid.getCell(table, 1, 1)).toBe(expected);
    });

    it('a row index past the end reads no cell at all', () => {
      expect(grid.getCell(plain(), 2, 0)).toBeNull();
    });

    it('a column index past the end reads no cell at all', () => {
      expect(grid.getCell(plain(), 0, 3)).toBeNull();
    });

    it('the stamped coordinates win over DOM order', () => {
      const table = plain();
      const cells = Array.from(table.querySelectorAll(`[${CELL_ATTR}]`));

      cells[5].setAttribute(CELL_ROW_ATTR, '0');
      cells[5].setAttribute(CELL_COL_ATTR, '0');

      expect(grid.getCell(table, 0, 0)).toBe(cells[5]);
    });
  });

  describe('column width accessors', () => {
    it('getColWidths reads the <col> widths and reports 0 for the unset ones', () => {
      const table = rawTable({ rows: 1, cols: 3, colWidths: ['10px', '', '30px'] });

      expect(grid.getColWidths(table)).toEqual([10, 0, 30]);
    });

    it('applyColWidths ignores widths beyond the last column', () => {
      const table = grid.createGrid(1, 3);

      expect(() => grid.applyColWidths(table, [11, 22, 33, 44])).not.toThrow();
      expect(colWidthsOf(table)).toEqual(['11px', '22px', '33px']);
    });

    it('getColumnCount comes from the colgroup, not from a row that holds fewer cells', () => {
      const table = rawTable({ rows: 1, cols: 2, colWidths: ['10px', '20px', '30px'] });

      expect(grid.getColumnCount(table)).toBe(3);
    });

    it('getColgroup hands back the table own colgroup element', () => {
      const table = grid.createGrid(1, 2);
      const colgroup = must(table.querySelector('colgroup'), 'a colgroup');

      expect(grid.getColgroup(table)).toBe(colgroup);
    });
  });

  describe('a table with no <colgroup>', () => {
    const noColgroup = (): HTMLTableElement => rawTable({ rows: 2, cols: 2 });

    it('addColumn still adds one cell per row', () => {
      const table = noColgroup();

      expect(() => grid.addColumn(table)).not.toThrow();
      expect(rowTexts(table).map(row => row.length)).toEqual([3, 3]);
    });

    it('addColumn with an empty width list does not reach into a missing colgroup', () => {
      const table = noColgroup();

      expect(() => grid.addColumn(table, undefined, [])).not.toThrow();
      expect(rowTexts(table).map(row => row.length)).toEqual([3, 3]);
    });

    it('deleteColumn still removes one cell per row', () => {
      const table = noColgroup();

      expect(() => grid.deleteColumn(table, 0)).not.toThrow();
      expect(rowTexts(table)).toEqual([['r0c1'], ['r1c1']]);
    });

    it('moveColumn still reorders the cells', () => {
      const table = noColgroup();

      expect(() => grid.moveColumn(table, 0, 1)).not.toThrow();
      expect(rowTexts(table)).toEqual([['r0c1', 'r0c0'], ['r1c1', 'r1c0']]);
    });

    it('getColumnCount falls back to counting the first row', () => {
      expect(grid.getColumnCount(noColgroup())).toBe(2);
    });

    it('getColumnCount is 0 when there is no row to count either', () => {
      expect(grid.getColumnCount(document.createElement('table'))).toBe(0);
    });

    it('getColWidths is empty', () => {
      expect(grid.getColWidths(noColgroup())).toEqual([]);
    });

    it('applyColWidths does nothing', () => {
      const table = noColgroup();

      expect(() => grid.applyColWidths(table, [10, 20])).not.toThrow();
    });

    it('getColgroup is null', () => {
      expect(grid.getColgroup(noColgroup())).toBeNull();
    });
  });
});
