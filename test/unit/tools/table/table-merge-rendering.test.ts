import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Create a mock API that returns block holders with data-blok-id attributes.
 */
const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key },
  blocks: {
    delete: () => {},
    getChildren: () => [],
    insert: () => {
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    },
    getCurrentBlockIndex: () => 0,
    getBlocksCount: () => 0,
    getBlockIndex: () => undefined,
    setBlockParent: vi.fn(),
    transactWithoutCapture: vi.fn((fn: () => void) => fn()),
  },
  events: { on: vi.fn(), off: vi.fn() },
} as unknown as API);

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

/**
 * Helper: render a Table and call rendered() to fully initialize it.
 */
const renderTable = (table: Table): HTMLDivElement => {
  const element = table.render();

  table.rendered();

  return element;
};

/**
 * Helper: query all <td> elements within a specific <tr> row.
 */
const getCellsInRow = (element: HTMLElement, rowIndex: number): NodeListOf<HTMLTableCellElement> => {
  const rows = element.querySelectorAll('[data-blok-table-row]');

  return rows[rowIndex]?.querySelectorAll('td') ?? ([] as unknown as NodeListOf<HTMLTableCellElement>);
};

/**
 * Accessors for private Table members used in tests.
 */
interface TableInternals {
  model: {
    mergeCells: (r: { minRow: number; maxRow: number; minCol: number; maxCol: number }) => void;
    splitCell: (r: number, c: number) => void;
    snapshot: () => { content: CellContent[][] };
  };
  rebuildTableBody: () => void;
}

const getInternals = (table: Table): TableInternals =>
  table as unknown as TableInternals;

describe('Table merge/split DOM rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('after merge, DOM reflects merged state', () => {
    it('shows colspan and rowspan on the origin cell after merging 2x2', () => {
      // 2x3 table so after merge we still have unmerged cells to verify
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      ];
      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = renderTable(table);

      // Before merge: each row should have 3 cells
      expect(getCellsInRow(element, 0)).toHaveLength(3);
      expect(getCellsInRow(element, 1)).toHaveLength(3);

      const internals = getInternals(table);

      internals.model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      internals.rebuildTableBody.call(table);

      // Row 0 should have 2 <td>: the merged origin (colspan=2,rowspan=2) + cell[0,2]
      const row0Cells = getCellsInRow(element, 0);

      expect(row0Cells).toHaveLength(2);
      expect(row0Cells[0].colSpan).toBe(2);
      expect(row0Cells[0].rowSpan).toBe(2);

      // Row 1 should have 1 <td>: only cell[1,2] (covered cells are omitted)
      const row1Cells = getCellsInRow(element, 1);

      expect(row1Cells).toHaveLength(1);
    });
  });

  describe('after split, DOM reflects unmerged state', () => {
    it('restores individual cells after merging then splitting', () => {
      // Start with unmerged 2x2 content
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ];
      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = renderTable(table);

      const internals = getInternals(table);

      // Merge all 4 cells
      internals.model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      internals.rebuildTableBody.call(table);

      // Verify merged state: row 0 has 1 cell (colspan=2, rowspan=2)
      expect(getCellsInRow(element, 0)).toHaveLength(1);
      expect(getCellsInRow(element, 0)[0].colSpan).toBe(2);
      expect(getCellsInRow(element, 0)[0].rowSpan).toBe(2);

      // Now split the merged cell
      internals.model.splitCell(0, 0);
      internals.rebuildTableBody.call(table);

      // After split: row 0 should have 2 <td>, row 1 should have 2 <td>
      const row0Cells = getCellsInRow(element, 0);

      expect(row0Cells).toHaveLength(2);

      const row1Cells = getCellsInRow(element, 1);

      expect(row1Cells).toHaveLength(2);

      // No cell should have colspan or rowspan > 1
      const allCells = element.querySelectorAll('td');

      allCells.forEach(cell => {
        expect(cell.colSpan).toBeLessThanOrEqual(1);
        expect(cell.rowSpan).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('block holders preserved after merge', () => {
    it('keeps all data-blok-id holders in the DOM after merge rebuild', () => {
      const content: CellContent[][] = [
        [{ blocks: [] }, { blocks: [] }],
        [{ blocks: [] }, { blocks: [] }],
      ];
      const options = createTableOptions({ content });
      const table = new Table(options);
      const element = renderTable(table);

      // Collect all block holder IDs before merge
      const holderIdsBefore = Array.from(
        element.querySelectorAll('[data-blok-id]')
      ).map(el => el.getAttribute('data-blok-id'));

      expect(holderIdsBefore.length).toBeGreaterThan(0);

      // Merge all 4 cells into one
      const internals = getInternals(table);

      internals.model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
      internals.rebuildTableBody.call(table);

      // All holders should still be in the DOM
      const holderIdsAfter = Array.from(
        element.querySelectorAll('[data-blok-id]')
      ).map(el => el.getAttribute('data-blok-id'));

      expect(holderIdsAfter).toHaveLength(holderIdsBefore.length);

      for (const id of holderIdsBefore) {
        expect(holderIdsAfter).toContain(id);
      }

      // All holders should be inside the merged origin cell's blocks container
      const originCell = getCellsInRow(element, 0)[0];
      const blocksContainer = originCell.querySelector('[data-blok-table-cell-blocks]');

      expect(blocksContainer).not.toBeNull();

      const holdersInOrigin = blocksContainer?.querySelectorAll('[data-blok-id]');

      expect(holdersInOrigin).toHaveLength(holderIdsBefore.length);
    });
  });
});
