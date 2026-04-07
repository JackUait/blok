import { describe, it, expect } from 'vitest';
import { TableMap } from '../../../../src/tools/table/table-map';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

// ─── Test helpers ──────────────────────────────────────────────────

const cell = (...blocks: string[]): CellContent => ({ blocks });

const originCell = (blocks: string[], colspan: number, rowspan: number): CellContent => ({
  blocks,
  ...(colspan > 1 ? { colspan } : {}),
  ...(rowspan > 1 ? { rowspan } : {}),
});

const coveredCell = (originRow: number, originCol: number): CellContent => ({
  blocks: [],
  mergedInto: [originRow, originCol],
});

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

const makeModel = (content: CellContent[][]): TableModel =>
  new TableModel(makeData({ content }));

/**
 * Build an HTML <table> that mirrors a model's merge structure.
 * Origin cells get colspan/rowspan attributes; covered cells are omitted.
 * Each <td> gets data-row and data-col attributes for position tracking.
 */
const buildTd = (model: TableModel, r: number, c: number): HTMLTableCellElement | null => {
  if (model.isSpannedCell(r, c)) {
    return null;
  }

  const td = document.createElement('td');

  td.setAttribute('data-row', String(r));
  td.setAttribute('data-col', String(c));

  const span = model.getCellSpan(r, c);

  if (span.colspan > 1) {
    td.colSpan = span.colspan;
  }
  if (span.rowspan > 1) {
    td.rowSpan = span.rowspan;
  }

  return td;
};

const buildTable = (model: TableModel): HTMLTableElement => {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');

  table.appendChild(tbody);

  Array.from({ length: model.rows }).forEach((_, r) => {
    const tr = document.createElement('tr');

    Array.from({ length: model.cols }).forEach((__, c) => {
      const td = buildTd(model, r, c);

      if (td) {
        tr.appendChild(td);
      }
    });

    tbody.appendChild(tr);
  });

  return table;
};

// ─── fromModel construction ────────────────────────────────────────

describe('TableMap', () => {
  describe('fromModel()', () => {
    it('creates a map with correct width and height for a 3x3 grid', () => {
      const model = makeModel([
        [cell('a'), cell('b'), cell('c')],
        [cell('d'), cell('e'), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);

      const map = TableMap.fromModel(model);

      expect(map.width).toBe(3);
      expect(map.height).toBe(3);
    });

    it('creates a map for an empty model', () => {
      const model = makeModel([]);
      const map = TableMap.fromModel(model);

      expect(map.width).toBe(0);
      expect(map.height).toBe(0);
    });

    it('creates a map for a 1x1 grid', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);

      expect(map.width).toBe(1);
      expect(map.height).toBe(1);
    });

    it('maps each cell to itself in a flat grid', () => {
      const model = makeModel([
        [cell('a'), cell('b')],
        [cell('c'), cell('d')],
      ]);
      const map = TableMap.fromModel(model);

      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const entry = map.getEntry(r, c);

          expect(entry).not.toBeNull();
          expect(entry!.originRow).toBe(r);
          expect(entry!.originCol).toBe(c);
          expect(entry!.colspan).toBe(1);
          expect(entry!.rowspan).toBe(1);
        }
      }
    });

    it('maps covered cells to their origin in a 2x2 merge', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);

      // Origin
      const origin = map.getEntry(0, 0)!;

      expect(origin.originRow).toBe(0);
      expect(origin.originCol).toBe(0);
      expect(origin.colspan).toBe(2);
      expect(origin.rowspan).toBe(2);

      // Covered cells point back to origin
      for (const [r, c] of [[0, 1], [1, 0], [1, 1]] as [number, number][]) {
        const entry = map.getEntry(r, c)!;

        expect(entry.originRow).toBe(0);
        expect(entry.originCol).toBe(0);
        expect(entry.colspan).toBe(2);
        expect(entry.rowspan).toBe(2);
      }
    });

    it('handles multiple independent merges', () => {
      const model = makeModel([
        [originCell(['a'], 2, 1), coveredCell(0, 0), cell('c'), cell('d')],
        [cell('e'), cell('f'), originCell(['g'], 1, 2), cell('h')],
        [cell('i'), cell('j'), coveredCell(1, 2), cell('l')],
      ]);
      const map = TableMap.fromModel(model);

      // Horizontal merge at [0,0]
      expect(map.getEntry(0, 0)!.colspan).toBe(2);
      expect(map.getEntry(0, 1)!.originCol).toBe(0);

      // Vertical merge at [1,2]
      expect(map.getEntry(1, 2)!.rowspan).toBe(2);
      expect(map.getEntry(2, 2)!.originRow).toBe(1);
    });

    it('returns null for out-of-bounds positions', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);

      expect(map.getEntry(-1, 0)).toBeNull();
      expect(map.getEntry(0, -1)).toBeNull();
      expect(map.getEntry(1, 0)).toBeNull();
      expect(map.getEntry(0, 1)).toBeNull();
    });
  });

  // ─── getOriginPosition ────────────────────────────────────────────

  describe('getOriginPosition()', () => {
    it('returns same position for unmerged cells', () => {
      const model = makeModel([
        [cell('a'), cell('b')],
        [cell('c'), cell('d')],
      ]);
      const map = TableMap.fromModel(model);

      expect(map.getOriginPosition(0, 0)).toEqual({ row: 0, col: 0 });
      expect(map.getOriginPosition(1, 1)).toEqual({ row: 1, col: 1 });
    });

    it('resolves covered positions to their origin', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0)],
        [coveredCell(0, 0), coveredCell(0, 0)],
      ]);
      const map = TableMap.fromModel(model);

      expect(map.getOriginPosition(0, 1)).toEqual({ row: 0, col: 0 });
      expect(map.getOriginPosition(1, 0)).toEqual({ row: 0, col: 0 });
      expect(map.getOriginPosition(1, 1)).toEqual({ row: 0, col: 0 });
    });

    it('returns origin position itself for the origin cell', () => {
      const model = makeModel([
        [originCell(['a'], 3, 1), coveredCell(0, 0), coveredCell(0, 0)],
      ]);
      const map = TableMap.fromModel(model);

      expect(map.getOriginPosition(0, 0)).toEqual({ row: 0, col: 0 });
    });

    it('returns null for out-of-bounds positions', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);

      expect(map.getOriginPosition(5, 5)).toBeNull();
    });
  });

  // ─── getCellElement ───────────────────────────────────────────────

  describe('getCellElement()', () => {
    it('finds correct <td> in a flat grid', () => {
      const model = makeModel([
        [cell('a'), cell('b'), cell('c')],
        [cell('d'), cell('e'), cell('f')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const td = map.getCellElement(table, r, c);

          expect(td).not.toBeNull();
          expect(td!.getAttribute('data-row')).toBe(String(r));
          expect(td!.getAttribute('data-col')).toBe(String(c));
        }
      }
    });

    it('finds the origin <td> for a covered cell position', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      // Asking for [0,1] (covered) should return the origin <td> at [0,0]
      const td01 = map.getCellElement(table, 0, 1);
      const td00 = map.getCellElement(table, 0, 0);

      expect(td01).toBe(td00);
      expect(td00!.getAttribute('data-row')).toBe('0');
      expect(td00!.getAttribute('data-col')).toBe('0');
    });

    it('finds cells after a merge gap in the same row', () => {
      const model = makeModel([
        [originCell(['a'], 2, 1), coveredCell(0, 0), cell('c')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      // [0,2] is the second physical <td> (index 1) because [0,1] is covered
      const td = map.getCellElement(table, 0, 2);

      expect(td).not.toBeNull();
      expect(td!.getAttribute('data-col')).toBe('2');
    });

    it('returns null for out-of-bounds position', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      expect(map.getCellElement(table, 5, 5)).toBeNull();
    });
  });

  // ─── getCellPosition ──────────────────────────────────────────────

  describe('getCellPosition()', () => {
    it('returns logical position from a <td> in a flat grid', () => {
      const model = makeModel([
        [cell('a'), cell('b')],
        [cell('c'), cell('d')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      const td = table.querySelector('td[data-row="1"][data-col="1"]') as HTMLElement;
      const pos = map.getCellPosition(table, td);

      expect(pos).toEqual({ row: 1, col: 1 });
    });

    it('returns origin position for a merged <td>', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0)],
        [coveredCell(0, 0), coveredCell(0, 0)],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      const td = table.querySelector('td[data-row="0"][data-col="0"]') as HTMLElement;
      const pos = map.getCellPosition(table, td);

      expect(pos).toEqual({ row: 0, col: 0 });
    });

    it('returns null for a <td> not in the table', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);
      const orphan = document.createElement('td');

      expect(map.getCellPosition(table, orphan)).toBeNull();
    });
  });

  // ─── collectCellsInRange ──────────────────────────────────────────

  describe('collectCellsInRange()', () => {
    it('collects all cells in a flat range', () => {
      const model = makeModel([
        [cell('a'), cell('b'), cell('c')],
        [cell('d'), cell('e'), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      const cells = map.collectCellsInRange(table, 0, 1, 0, 1);

      expect(cells).toHaveLength(4); // 2x2 = 4 cells
    });

    it('deduplicates origin cells in a merged range', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      // Range [0,0]-[1,1] covers the entire 2x2 merge — should return 1 element, not 4
      const cells = map.collectCellsInRange(table, 0, 1, 0, 1);

      expect(cells).toHaveLength(1);
      expect(cells[0].getAttribute('data-row')).toBe('0');
      expect(cells[0].getAttribute('data-col')).toBe('0');
    });

    it('includes origin cell when range partially overlaps a merge', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      // Range covers only [1,1] which is a covered cell — still returns the origin
      const cells = map.collectCellsInRange(table, 1, 1, 1, 1);

      expect(cells).toHaveLength(1);
      expect(cells[0].getAttribute('data-col')).toBe('0');
    });

    it('collects cells from multiple merges in the same range', () => {
      const model = makeModel([
        [originCell(['a'], 2, 1), coveredCell(0, 0), originCell(['b'], 2, 1), coveredCell(0, 2)],
        [cell('c'), cell('d'), cell('e'), cell('f')],
      ]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      // Full first row: 2 origin cells
      const cells = map.collectCellsInRange(table, 0, 0, 0, 3);

      expect(cells).toHaveLength(2);
    });

    it('returns empty array for out-of-bounds range', () => {
      const model = makeModel([[cell('a')]]);
      const map = TableMap.fromModel(model);
      const table = buildTable(model);

      const cells = map.collectCellsInRange(table, 5, 5, 5, 5);

      expect(cells).toHaveLength(0);
    });
  });

  // ─── expandRangeForMerges ─────────────────────────────────────────

  describe('expandRangeForMerges()', () => {
    it('returns the same range when no merges are present', () => {
      const model = makeModel([
        [cell('a'), cell('b'), cell('c')],
        [cell('d'), cell('e'), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);

      const result = map.expandRangeForMerges(0, 1, 0, 1);

      expect(result).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    });

    it('expands to include full merge when range partially overlaps', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const map = TableMap.fromModel(model);

      // Select only [1,1] — covered cell. Must expand to include full 2x2 merge.
      const result = map.expandRangeForMerges(1, 1, 1, 1);

      expect(result).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    });

    it('expands when merge extends below the range', () => {
      const model = makeModel([
        [originCell(['a'], 1, 3), cell('b')],
        [coveredCell(0, 0), cell('d')],
        [coveredCell(0, 0), cell('f')],
      ]);
      const map = TableMap.fromModel(model);

      // Select [0,0]-[0,1] — origin has rowspan=3
      const result = map.expandRangeForMerges(0, 0, 0, 1);

      expect(result).toEqual({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 });
    });

    it('expands when merge extends to the right of the range', () => {
      const model = makeModel([
        [originCell(['a'], 3, 1), coveredCell(0, 0), coveredCell(0, 0)],
        [cell('d'), cell('e'), cell('f')],
      ]);
      const map = TableMap.fromModel(model);

      // Select [0,0]-[1,0] — origin has colspan=3
      const result = map.expandRangeForMerges(0, 0, 0, 0);

      expect(result).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });
    });

    it('iterates until stable when expansion reveals new partial merges', () => {
      // Staircase: expanding left for merge A reveals merge B which expands right
      //   [A cs=2][A    ][     ]
      //   [     ][B cs=2][B    ]
      const model = makeModel([
        [originCell(['a'], 2, 1), coveredCell(0, 0), cell('c')],
        [cell('d'), originCell(['e'], 2, 1), coveredCell(1, 1)],
      ]);
      const map = TableMap.fromModel(model);

      // Select [0,1]-[1,1]: col 1, both rows.
      // Pass 1: [0,1] covered by [0,0] → minCol=0; [1,1] origin cs=2 → maxCol=2.
      // Pass 2: [0,0] span ends at col 1, [1,2] covered by [1,1]. No change.
      const result = map.expandRangeForMerges(0, 1, 1, 1);

      expect(result).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });
    });
  });

  // ─── fromTable ────────────────────────────────────────────────────

  describe('fromTable()', () => {
    it('builds a map from a flat HTML table', () => {
      const model = makeModel([
        [cell('a'), cell('b')],
        [cell('c'), cell('d')],
      ]);
      const table = buildTable(model);
      const map = TableMap.fromTable(table);

      expect(map.width).toBe(2);
      expect(map.height).toBe(2);

      const entry = map.getEntry(1, 1)!;

      expect(entry.originRow).toBe(1);
      expect(entry.originCol).toBe(1);
      expect(entry.colspan).toBe(1);
      expect(entry.rowspan).toBe(1);
    });

    it('builds a map from a table with merges', () => {
      const model = makeModel([
        [originCell(['a'], 2, 2), coveredCell(0, 0), cell('c')],
        [coveredCell(0, 0), coveredCell(0, 0), cell('f')],
        [cell('g'), cell('h'), cell('i')],
      ]);
      const table = buildTable(model);
      const map = TableMap.fromTable(table);

      expect(map.width).toBe(3);
      expect(map.height).toBe(3);

      // Origin cell
      const origin = map.getEntry(0, 0)!;

      expect(origin.colspan).toBe(2);
      expect(origin.rowspan).toBe(2);

      // Covered cell resolves to origin
      const covered = map.getEntry(1, 1)!;

      expect(covered.originRow).toBe(0);
      expect(covered.originCol).toBe(0);
    });

    it('agrees with fromModel for a complex table', () => {
      const model = makeModel([
        [originCell(['a'], 2, 1), coveredCell(0, 0), cell('c'), cell('d')],
        [cell('e'), cell('f'), originCell(['g'], 1, 2), cell('h')],
        [cell('i'), cell('j'), coveredCell(1, 2), cell('l')],
      ]);
      const table = buildTable(model);

      const fromModelMap = TableMap.fromModel(model);
      const fromTableMap = TableMap.fromTable(table);

      expect(fromTableMap.width).toBe(fromModelMap.width);
      expect(fromTableMap.height).toBe(fromModelMap.height);

      for (let r = 0; r < fromModelMap.height; r++) {
        for (let c = 0; c < fromModelMap.width; c++) {
          const mEntry = fromModelMap.getEntry(r, c)!;
          const tEntry = fromTableMap.getEntry(r, c)!;

          expect(tEntry.originRow).toBe(mEntry.originRow);
          expect(tEntry.originCol).toBe(mEntry.originCol);
          expect(tEntry.colspan).toBe(mEntry.colspan);
          expect(tEntry.rowspan).toBe(mEntry.rowspan);
        }
      }
    });

    it('handles a table with no <tbody> (cells directly in <table>)', () => {
      const table = document.createElement('table');
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      const td2 = document.createElement('td');

      td1.setAttribute('data-row', '0');
      td1.setAttribute('data-col', '0');
      td2.setAttribute('data-row', '0');
      td2.setAttribute('data-col', '1');
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);

      const map = TableMap.fromTable(table);

      expect(map.width).toBe(2);
      expect(map.height).toBe(1);
    });
  });
});
