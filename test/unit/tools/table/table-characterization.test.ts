/**
 * Characterization tests for the Table block tool's public behavior.
 *
 * These exercise only Table's public API (render / rendered / save / validate /
 * deleteRowWithCleanup / deleteColumnWithCleanup / setData) so they describe
 * observable behavior independent of internal structure. They are verified to
 * pass identically on the pre-refactor baseline (commit 9d58c1f6^), confirming
 * the TableSubsystems extraction preserved behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { ROW_ATTR, CELL_ATTR } from '../../../../src/tools/table/table-core';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => {
  const blockStore = new Map<string, { id: string; holder: HTMLElement; parentId: string | null }>();

  return {
    i18n: { t: (key: string) => key },
    rectangleSelection: {
      isRectActivated: () => false,
      clearSelection: vi.fn(),
      startSelection: vi.fn(),
      endSelection: vi.fn(),
    },
    toolbar: { close: vi.fn() },
    caret: { setToBlock: vi.fn() },
    blocks: {
      delete: () => {},
      getChildren: () => [],
      insert: () => {
        const id = `mock-${Math.random().toString(36).slice(2, 8)}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        const entry = { id, holder, parentId: null };

        blockStore.set(id, entry);

        return entry;
      },
      getCurrentBlockIndex: () => 0,
      getBlocksCount: () => blockStore.size,
      getBlockIndex: () => undefined,
      getById: (id: string) => blockStore.get(id) ?? null,
      setBlockParent: vi.fn((id: string, parentId: string) => {
        const entry = blockStore.get(id);

        if (entry !== undefined) {
          entry.parentId = parentId;
        }
      }),
      setPointerDragActive: vi.fn(),
      transactWithoutCapture: vi.fn((fn: () => void) => fn()),
    },
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;
};

const createOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'table-block' } as never,
});

const emptyCell = (): { blocks: string[] } => ({ blocks: [] });

const grid2x2 = (overrides: Partial<TableData> = {}): Partial<TableData> => ({
  content: [
    [emptyCell(), emptyCell()],
    [emptyCell(), emptyCell()],
  ],
  ...overrides,
});

const renderTable = (data: Partial<TableData>): { table: Table; wrapper: HTMLElement } => {
  const table = new Table(createOptions(data));
  const wrapper = table.render();

  document.body.appendChild(wrapper);
  table.rendered();

  return { table, wrapper };
};

describe('Table characterization (public API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('render', () => {
    it('renders a wrapper tagged as a table tool', () => {
      const { wrapper } = renderTable(grid2x2());

      expect(wrapper.getAttribute('data-blok-tool')).toBe('table');
    });

    it('renders one row element per data row and one cell per column', () => {
      const { wrapper } = renderTable(grid2x2());

      const rows = wrapper.querySelectorAll(`[${ROW_ATTR}]`);

      expect(rows).toHaveLength(2);

      rows.forEach(row => {
        expect(row.querySelectorAll(`[${CELL_ATTR}]`)).toHaveLength(2);
      });
    });
  });

  describe('save', () => {
    it('round-trips the grid dimensions', () => {
      const { table, wrapper } = renderTable(grid2x2());

      const saved = table.save(wrapper);

      expect(saved.content).toHaveLength(2);
      expect(saved.content[0]).toHaveLength(2);
    });

    it('preserves the withHeadings flag', () => {
      const { table, wrapper } = renderTable(grid2x2({ withHeadings: true }));

      expect(table.save(wrapper).withHeadings).toBe(true);
    });
  });

  describe('validate', () => {
    it('rejects empty content and accepts non-empty content', () => {
      const table = new Table(createOptions());

      expect(table.validate({ withHeadings: false, withHeadingColumn: false, content: [] })).toBe(false);
      expect(table.validate({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[emptyCell()]],
      })).toBe(true);
    });
  });

  describe('deleteRowWithCleanup / deleteColumnWithCleanup', () => {
    it('removes a row from the model and DOM', () => {
      const { table, wrapper } = renderTable(grid2x2());

      table.deleteRowWithCleanup(0);

      expect(table.save(wrapper).content).toHaveLength(1);
      expect(wrapper.querySelectorAll(`[${ROW_ATTR}]`)).toHaveLength(1);
    });

    it('removes a column from every row', () => {
      const { table, wrapper } = renderTable(grid2x2());

      table.deleteColumnWithCleanup(0);

      const saved = table.save(wrapper);

      saved.content.forEach(row => {
        expect(row).toHaveLength(1);
      });
      wrapper.querySelectorAll(`[${ROW_ATTR}]`).forEach(row => {
        expect(row.querySelectorAll(`[${CELL_ATTR}]`)).toHaveLength(1);
      });
    });
  });

  describe('setData', () => {
    it('replaces the grid with new dimensions', () => {
      const { table, wrapper } = renderTable(grid2x2());

      table.setData({
        content: [[emptyCell()], [emptyCell()], [emptyCell()]],
      });

      const saved = table.save(wrapper);

      expect(saved.content).toHaveLength(3);
      expect(saved.content[0]).toHaveLength(1);
    });
  });
});
