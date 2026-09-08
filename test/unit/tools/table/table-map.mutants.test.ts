import { describe, it, expect } from 'vitest';

import { TableMap } from '../../../../src/tools/table/table-map';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

const plain = (): CellContent => ({ blocks: [] });

const origin = (colspan: number, rowspan: number): CellContent => ({
  blocks: [],
  ...(colspan > 1 ? { colspan } : {}),
  ...(rowspan > 1 ? { rowspan } : {}),
});

const covered = (originRow: number, originCol: number): CellContent => ({
  blocks: [],
  mergedInto: [originRow, originCol],
});

const model = (content: CellContent[][]): TableModel => {
  const data: TableData = { withHeadings: false, withHeadingColumn: false, content };

  return new TableModel(data);
};

const grid = (rows: number, cols: number): CellContent[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, plain));

/** Places an origin cell and the covered cells its span claims. */
const merge = (
  source: CellContent[][],
  row: number,
  col: number,
  colspan: number,
  rowspan: number
): CellContent[][] => {
  const content = source.map((cells) => [...cells]);

  content[row][col] = origin(colspan, rowspan);
  Array.from({ length: rowspan }).forEach((_, dr) => {
    Array.from({ length: colspan }).forEach((__, dc) => {
      if (dr !== 0 || dc !== 0) {
        content[row + dr][col + dc] = covered(row, col);
      }
    });
  });

  return content;
};

const table = (html: string): HTMLTableElement => {
  const host = document.createElement('div');

  host.innerHTML = `<table><tbody>${html}</tbody></table>`;

  const found = host.querySelector('table');

  if (found === null) {
    throw new Error('no table');
  }

  return found;
};

/**
 * Five mutants survive, and two more are untestable rather than equivalent:
 *
 * - the `height === 0` half of the empty guard, and the whole guard in
 *   `fromTable`: a TableModel derives its column count from its first row, so a
 *   zero-height grid always has zero width too and both halves agree; and
 *   `fromTable` on an empty table builds the same 0x0 map either way.
 * - `Math.min` on the span's END ROW: an over-wide row fill writes DOWNWARDS,
 *   into positions the build loop has not visited yet, and the loop reassigns
 *   every one of them afterwards. For the fill to stick, the extra position
 *   would have to belong to an earlier merge spanning the same column past this
 *   one — which would overlap this merge. (The column version has no such
 *   constraint, and is killed below.)
 * - padding one cell too far: `getEntry` bounds every read by `width`, so a row
 *   one longer than the grid is unreachable.
 * - the two padding-loop mutants that empty the body or drop the push turn
 *   `while (row.length < width)` into an infinite loop. The sweep records those
 *   as killed by timeout, which is not an assertion — they are counted here as
 *   untestable, not as kills.
 */
describe('TableMap mutants', () => {
  describe('the empty guard', () => {
    it('reports a zero-size map for a model with no columns', () => {
      const map = TableMap.fromModel(model([[]]));

      expect(map.width).toBe(0);
      expect(map.height).toBe(0);
    });

    it('leaves the range of an empty map untouched instead of walking it', () => {
      const map = TableMap.fromModel(model([]));

      expect(map.expandRangeForMerges(0, 0, 0, 0))
        .toStrictEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    });

    it('leaves the range of an empty TABLE untouched too', () => {
      const map = TableMap.fromTable(table(''));

      expect(map.width).toBe(0);
      expect(map.expandRangeForMerges(0, 0, 0, 0))
        .toStrictEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    });
  });

  describe('span filling', () => {
    it('claims exactly the rows a rowspan covers, not every row below', () => {
      const map = TableMap.fromModel(model(merge(grid(3, 3), 0, 0, 1, 2)));

      expect(map.getOriginPosition(1, 0)).toStrictEqual({ row: 0, col: 0 });
      expect(map.getOriginPosition(2, 0)).toStrictEqual({ row: 2, col: 0 });
    });

    it('claims exactly the columns a colspan covers, not every column after', () => {
      const map = TableMap.fromModel(model(merge(grid(3, 3), 0, 0, 2, 1)));

      expect(map.getOriginPosition(0, 1)).toStrictEqual({ row: 0, col: 0 });
      expect(map.getOriginPosition(0, 2)).toStrictEqual({ row: 0, col: 2 });
    });

    it('measures a span from its own origin, not from column zero', () => {
      const map = TableMap.fromModel(model(merge(grid(2, 4), 0, 1, 2, 1)));

      expect(map.getOriginPosition(0, 2)).toStrictEqual({ row: 0, col: 1 });
      expect(map.getOriginPosition(0, 3)).toStrictEqual({ row: 0, col: 3 });
    });

    // A cell the build loop would have re-claimed hides an over-wide fill: the
    // loop reassigns every position it visits afterwards. Only a position the
    // loop SKIPS — one already covered by a merge whose origin came earlier —
    // keeps whatever the fill wrote there.
    it('does not spill a span onto a cell that belongs to an earlier merge', () => {
      const content = merge(merge(grid(2, 4), 0, 3, 1, 2), 1, 1, 2, 1);
      const map = TableMap.fromModel(model(content));

      expect(map.getOriginPosition(1, 3)).toStrictEqual({ row: 0, col: 3 });
      expect(map.getOriginPosition(1, 2)).toStrictEqual({ row: 1, col: 1 });
    });
  });

  describe('building from a table element', () => {
    it('clamps a rowspan that runs past the last row', () => {
      const map = TableMap.fromTable(table(
        '<tr><td data-row="0" data-col="0"></td></tr><tr><td data-row="1" data-col="0" rowspan="3"></td></tr>'
      ));

      expect(map.height).toBe(2);
      expect(map.getOriginPosition(1, 0)).toStrictEqual({ row: 1, col: 0 });
    });

    it('pads a short row out to the full width', () => {
      const map = TableMap.fromTable(table(
        '<tr><td data-row="0" data-col="0"></td><td data-row="0" data-col="1"></td><td data-row="0" data-col="2"></td></tr>'
        + '<tr><td data-row="1" data-col="0"></td></tr>'
      ));

      expect(map.width).toBe(3);
      expect(map.getEntry(1, 1)).toBeNull();
      expect(map.getEntry(1, 2)).toBeNull();
      expect(map.expandRangeForMerges(0, 1, 0, 2))
        .toStrictEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });
    });
  });

  describe('locating a cell', () => {
    const twoByTwo = (): { map: TableMap; el: HTMLTableElement } => {
      const el = table('<tr><td data-row="0" data-col="0"></td><td data-row="0" data-col="1"></td></tr>');

      return { map: TableMap.fromTable(el), el };
    };

    it('refuses a cell that belongs to another table', () => {
      const { map, el } = twoByTwo();
      const foreign = document.createElement('td');

      foreign.setAttribute('data-row', '0');
      foreign.setAttribute('data-col', '0');
      document.body.appendChild(foreign);

      expect(map.getCellPosition(el, foreign)).toBeNull();
      foreign.remove();
    });

    it('refuses a cell that is missing either coordinate', () => {
      const el = table('<tr><td></td><td data-row="0"></td><td data-col="1"></td></tr>');
      const map = TableMap.fromTable(el);
      const cells = Array.from(el.querySelectorAll('td'));

      expect(map.getCellPosition(el, cells[0])).toBeNull();
      expect(map.getCellPosition(el, cells[1])).toBeNull();
      expect(map.getCellPosition(el, cells[2])).toBeNull();
    });

    it('collects nothing when no element carries the coordinates', () => {
      const map = TableMap.fromModel(model(grid(2, 2)));

      expect(map.collectCellsInRange(document.createElement('div'), 0, 1, 0, 1)).toStrictEqual([]);
    });
  });

  // Each fixture expands in exactly ONE direction on the first pass, and only
  // the second pass reaches the merge that expands it further — so a mutant
  // that stops watching that one direction stops the loop one step short.
  describe('expanding a range over merges', () => {
    it('keeps growing downwards', () => {
      const content = merge(merge(grid(4, 4), 0, 2, 1, 2), 1, 0, 1, 2);
      const map = TableMap.fromModel(model(content));

      expect(map.expandRangeForMerges(0, 0, 0, 3))
        .toStrictEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 3 });
    });

    it('keeps growing upwards', () => {
      const content = merge(merge(grid(4, 4), 2, 2, 1, 2), 1, 0, 1, 2);
      const map = TableMap.fromModel(model(content));

      expect(map.expandRangeForMerges(3, 3, 0, 3))
        .toStrictEqual({ minRow: 1, maxRow: 3, minCol: 0, maxCol: 3 });
    });

    it('keeps growing rightwards', () => {
      const content = merge(merge(grid(4, 4), 2, 0, 2, 1), 0, 1, 2, 1);
      const map = TableMap.fromModel(model(content));

      expect(map.expandRangeForMerges(0, 3, 0, 0))
        .toStrictEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });
    });

    it('keeps growing leftwards', () => {
      const content = merge(merge(grid(4, 4), 2, 2, 2, 1), 0, 1, 2, 1);
      const map = TableMap.fromModel(model(content));

      expect(map.expandRangeForMerges(0, 3, 3, 3))
        .toStrictEqual({ minRow: 0, maxRow: 3, minCol: 1, maxCol: 3 });
    });
  });
});
