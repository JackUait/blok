import type { API } from '../../../../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isColumnEmpty,
  getBlockIdsInColumn,
  applyCellColors,
  mountCellBlocksReadOnly,
} from '../../../../src/tools/table/table-operations';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const CELL_ROW_ATTR = 'data-blok-table-cell-row';
const CELL_COL_ATTR = 'data-blok-table-cell-col';
const CELL_BLOCKS_ATTR = 'data-blok-table-cell-blocks';

/**
 * Create a 2x3 grid with a 2x2 merge at [0,0].
 *
 * Logical layout:
 *   col0       col1       col2
 * +----------+----------+----------+
 * | merged (colspan=2,  |  [0,2]   |   row 0
 * |  rowspan=2)         |          |
 * +----------+----------+----------+
 * | (covered by merge)  |  [1,2]   |   row 1
 * +----------+----------+----------+
 *
 * Physical DOM:
 *   row 0: td[0,0] (colspan=2,rowspan=2) + td[0,2]  — 2 physical <td>s
 *   row 1: td[1,2] only                              — 1 physical <td>
 *
 * BUG scenario: index-based lookup `cells[colIndex]` on row 1:
 *   cells[0] → td[1,2] (WRONG — that's col 2, not col 0)
 *   cells[1] → undefined (WRONG — col 1 is covered, but col 2 exists)
 *   cells[2] → undefined (WRONG — col 2 is at physical index 0)
 */
const createMergedTable = (): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  [200, 200, 200].forEach(w => {
    const col = document.createElement('col');

    col.style.width = `${w}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  // Row 0: merged [0,0] (colspan=2,rowspan=2) + [0,2]
  const row0 = document.createElement('tr');

  row0.setAttribute(ROW_ATTR, '');

  const td00 = document.createElement('td');

  td00.setAttribute(CELL_ATTR, '');
  td00.setAttribute(CELL_ROW_ATTR, '0');
  td00.setAttribute(CELL_COL_ATTR, '0');
  td00.colSpan = 2;
  td00.rowSpan = 2;
  const b00 = document.createElement('div');

  b00.setAttribute(CELL_BLOCKS_ATTR, '');
  b00.textContent = 'merged';
  td00.appendChild(b00);
  row0.appendChild(td00);

  const td02 = document.createElement('td');

  td02.setAttribute(CELL_ATTR, '');
  td02.setAttribute(CELL_ROW_ATTR, '0');
  td02.setAttribute(CELL_COL_ATTR, '2');
  const b02 = document.createElement('div');

  b02.setAttribute(CELL_BLOCKS_ATTR, '');
  td02.appendChild(b02);
  row0.appendChild(td02);
  tbody.appendChild(row0);

  // Row 1: only [1,2] (col 0 and col 1 are covered by the merge)
  const row1 = document.createElement('tr');

  row1.setAttribute(ROW_ATTR, '');
  const td12 = document.createElement('td');

  td12.setAttribute(CELL_ATTR, '');
  td12.setAttribute(CELL_ROW_ATTR, '1');
  td12.setAttribute(CELL_COL_ATTR, '2');
  const b12 = document.createElement('div');

  b12.setAttribute(CELL_BLOCKS_ATTR, '');
  b12.textContent = 'row1-col2-content';
  td12.appendChild(b12);
  row1.appendChild(td12);
  tbody.appendChild(row1);

  table.appendChild(tbody);

  return table;
};

describe('table-operations with merged cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isColumnEmpty', () => {
    it('returns true for empty column in merged table', () => {
      const grid = createMergedTable();

      // Col 2 row 0 is empty, col 2 row 1 has text "row1-col2-content"
      // so col 2 is NOT empty. But col 1 has no physical cells in row 1
      // (covered by merge) and shares the merge origin in row 0.
      // With index-based lookup, cells[1] on row 0 is td[0,2] (WRONG).
      // With coordinate-based lookup, col 1 has no td in row 1 (skip)
      // and no td in row 0 (the merged td has col=0). So col 1 should be empty.
      expect(isColumnEmpty(grid, 1)).toBe(true);
    });

    it('returns false for non-empty merged column', () => {
      const grid = createMergedTable();

      // Col 0 has the merged cell with text "merged" (at coordinate col=0)
      expect(isColumnEmpty(grid, 0)).toBe(false);
    });

    it('does not confuse physical index with logical column for covered rows', () => {
      const grid = createMergedTable();

      // Row 1 has only one physical <td> at physical index 0, but it's col 2.
      // Index-based cells[0] in row 1 returns td[1,2], so isColumnEmpty(0)
      // would wrongly see "row1-col2-content" and return false.
      // With coordinate lookup, col 0 in row 1 has no <td> (covered),
      // so it's treated as empty (skipped). Col 0 in row 0 has "merged" → not empty.
      // This test verifies row 1's covered cell doesn't contaminate col 0.
      // (col 0 is still non-empty due to row 0, but the mechanism matters.)

      // The actual regression: isColumnEmpty for col 2 in row 1.
      // Index-based: cells[2] in row 1 is undefined (only 1 physical td),
      // so row 1 col 2 is treated as empty — WRONG (it has content).
      expect(isColumnEmpty(grid, 2)).toBe(false);
    });
  });

  describe('getBlockIdsInColumn', () => {
    it('finds cells by coordinate attributes in merged table', () => {
      const grid = createMergedTable();

      // Add a block holder to the [1,2] cell
      const cell12 = grid.querySelector<HTMLElement>(
        `[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`
      );
      const container12 = cell12?.querySelector(`[${CELL_BLOCKS_ATTR}]`);
      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', 'block-12');
      container12?.appendChild(blockHolder);

      const mockCellBlocks = {
        getBlockIdsFromCells: vi.fn((cells: Element[]) => {
          const ids: string[] = [];

          cells.forEach(cell => {
            const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

            container?.querySelectorAll('[data-blok-id]').forEach(el => {
              const id = el.getAttribute('data-blok-id');

              if (id) {
                ids.push(id);
              }
            });
          });

          return ids;
        }),
      };

      // With index-based lookup, cells[2] in row 1 is undefined (only 1 td),
      // so the block in [1,2] is never found.
      const result = getBlockIdsInColumn(grid, mockCellBlocks as never, 2);

      expect(result).toContain('block-12');
    });

    it('does not pick up wrong cell from physical index', () => {
      const grid = createMergedTable();

      // Add a block to [1,2] cell
      const cell12 = grid.querySelector<HTMLElement>(
        `[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`
      );
      const container12 = cell12?.querySelector(`[${CELL_BLOCKS_ATTR}]`);
      const blockHolder = document.createElement('div');

      blockHolder.setAttribute('data-blok-id', 'block-wrong-col');
      container12?.appendChild(blockHolder);

      const mockCellBlocks = {
        getBlockIdsFromCells: vi.fn((cells: Element[]) => {
          const ids: string[] = [];

          cells.forEach(cell => {
            const container = cell.querySelector(`[${CELL_BLOCKS_ATTR}]`);

            container?.querySelectorAll('[data-blok-id]').forEach(el => {
              const id = el.getAttribute('data-blok-id');

              if (id) {
                ids.push(id);
              }
            });
          });

          return ids;
        }),
      };

      // With index-based lookup, cells[0] in row 1 picks up td[1,2]
      // and would include block-wrong-col for col 0. With coordinate
      // lookup, col 0 in row 1 has no <td>, so it's correctly excluded.
      const result = getBlockIdsInColumn(grid, mockCellBlocks as never, 0);

      expect(result).not.toContain('block-wrong-col');
    });
  });

  describe('applyCellColors', () => {
    it('applies color to merged cell by coordinate', () => {
      const grid = createMergedTable();

      const content = [
        [{ blocks: [], color: '#fbecdd' }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ];

      applyCellColors(grid, content);

      const mergedCell = grid.querySelector<HTMLElement>(
        `[${CELL_COL_ATTR}="0"]`
      );

      expect(mergedCell?.style.backgroundColor).toBeTruthy();
    });

    it('skips covered cells gracefully without error', () => {
      const grid = createMergedTable();

      // [1,0] and [1,1] are covered — no <td> exists for them in row 1
      const content = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [], color: '#e7f3f8' }, { blocks: [], color: '#e7f3f8' }, { blocks: [] }],
      ];

      // Should not throw
      expect(() => applyCellColors(grid, content)).not.toThrow();
    });

    it('applies color to correct cell in row with fewer physical tds', () => {
      const grid = createMergedTable();

      // Apply color to [1,2] — the only physical <td> in row 1
      // With index-based lookup, cells[2] in row 1 is undefined (only 1 td).
      // With coordinate lookup, it finds the td with col=2.
      const content = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [], color: '#e7f3f8' }],
      ];

      applyCellColors(grid, content);

      const cell12 = grid.querySelector<HTMLElement>(
        `[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`
      );

      expect(cell12?.style.backgroundColor).toBeTruthy();
    });
  });

  describe('mountCellBlocksReadOnly', () => {
    it('skips covered cells without error in merged table', () => {
      const grid = createMergedTable();

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn(),
          getBlockByIndex: vi.fn(),
          getBlocksCount: vi.fn().mockReturnValue(0),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // [1,0] and [1,1] don't have physical <td> elements
      const content = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ];

      expect(() => mountCellBlocksReadOnly(grid, content, api, 'table-1')).not.toThrow();
    });

    it('mounts blocks into correct cell when rows have fewer physical tds', () => {
      const grid = createMergedTable();

      const mockHolder = document.createElement('div');

      mockHolder.setAttribute('data-blok-id', 'block-ro-12');

      const api = {
        blocks: {
          insert: vi.fn(),
          getBlockIndex: vi.fn().mockReturnValue(0),
          getBlockByIndex: vi.fn().mockReturnValue({ holder: mockHolder }),
          getBlocksCount: vi.fn().mockReturnValue(1),
          setBlockParent: vi.fn(),
        },
      } as unknown as API;

      // Mount a block into [1,2] — the only physical <td> in row 1.
      // With index-based lookup, cells[2] in row 1 is undefined (only 1 td).
      const content = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: ['block-ro-12'] }],
      ];

      mountCellBlocksReadOnly(grid, content, api, 'table-1');

      const cell12 = grid.querySelector<HTMLElement>(
        `[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`
      );
      const container = cell12?.querySelector(`[${CELL_BLOCKS_ATTR}]`);

      expect(container?.querySelector('[data-blok-id="block-ro-12"]')).toBeTruthy();
    });
  });
});
