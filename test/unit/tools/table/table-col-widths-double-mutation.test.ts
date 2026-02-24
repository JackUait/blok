import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

// ─── Helpers ───────────────────────────────────────────────────────

let insertCallCount = 0;

const createMockAPI = (): API => {
  return {
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
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      insert: vi.fn().mockImplementation(() => {
        insertCallCount++;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-block-${insertCallCount}`);

        return { id: `mock-block-${insertCallCount}`, holder };
      }),
      delete: vi.fn(),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockReturnValue(undefined),
      getBlocksCount: vi.fn().mockReturnValue(0),
      setBlockParent: vi.fn(),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
    toolbar: {
      close: vi.fn(),
    },
  } as unknown as API;
};

/**
 * Create a Table instance with given data, render + call rendered(),
 * then return the table and grid element.
 * The table is mounted to the document so DOM queries work correctly.
 */
const createTableWithColWidths = (
  content: string[][],
  colWidths: number[],
): { table: Table; element: HTMLElement; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      content,
      colWidths,
    },
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, element, gridEl };
};

/**
 * Invoke the private handleRowColAction method on a Table instance.
 */
const invokeAction = (table: Table, gridEl: HTMLElement, action: RowColAction): void => {
  (table as unknown as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
    .handleRowColAction(gridEl, action);
};

// ─── Tests ─────────────────────────────────────────────────────────

describe('Table colWidths double-mutation bug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    insertCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    // Clean up any mounted elements
    document.body.innerHTML = '';
  });

  describe('move-col', () => {
    it('produces correct colWidths when moving column 0 to column 2', () => {
      // 2 rows x 3 cols with known widths [100, 200, 300]
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'move-col', fromIndex: 0, toIndex: 2 });

      const saved = table.save(document.createElement('div'));

      // After moving col 0 to col 2: [100, 200, 300] -> [200, 300, 100]
      expect(saved.colWidths).toEqual([200, 300, 100]);
    });

    it('produces correct colWidths when moving column 2 to column 0', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'move-col', fromIndex: 2, toIndex: 0 });

      const saved = table.save(document.createElement('div'));

      // After moving col 2 to col 0: [100, 200, 300] -> [300, 100, 200]
      expect(saved.colWidths).toEqual([300, 100, 200]);
    });

    it('produces correct colWidths when moving adjacent columns', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'move-col', fromIndex: 0, toIndex: 1 });

      const saved = table.save(document.createElement('div'));

      // After moving col 0 to col 1: [100, 200, 300] -> [200, 100, 300]
      expect(saved.colWidths).toEqual([200, 100, 300]);
    });
  });

  describe('delete-col', () => {
    it('produces correct colWidths when deleting a column', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'delete-col', index: 1 });

      const saved = table.save(document.createElement('div'));

      // After deleting col 1: [100, 200, 300] -> [100, 300]
      expect(saved.colWidths).toEqual([100, 300]);
    });

    it('produces correct colWidths when deleting first column', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'delete-col', index: 0 });

      const saved = table.save(document.createElement('div'));

      // After deleting col 0: [100, 200, 300] -> [200, 300]
      expect(saved.colWidths).toEqual([200, 300]);
    });

    it('produces correct colWidths when deleting last column', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'delete-col', index: 2 });

      const saved = table.save(document.createElement('div'));

      // After deleting col 2: [100, 200, 300] -> [100, 200]
      expect(saved.colWidths).toEqual([100, 200]);
    });
  });

  describe('insert-col-left', () => {
    it('produces correct colWidths when inserting a column to the left', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B'], ['C', 'D']],
        [100, 200],
      );

      invokeAction(table, gridEl, { type: 'insert-col-left', index: 1 });

      const saved = table.save(document.createElement('div'));

      // After inserting at index 1: should have 3 widths
      // The new column gets a half-width, existing widths are preserved in order
      expect(saved.colWidths).toHaveLength(3);
      // First width preserved
      expect(saved.colWidths?.[0]).toBe(100);
      // Last width preserved
      expect(saved.colWidths?.[2]).toBe(200);
      // New column width in the middle
      expect(typeof saved.colWidths?.[1]).toBe('number');
    });
  });

  describe('insert-col-right', () => {
    it('produces correct colWidths when inserting a column to the right', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B'], ['C', 'D']],
        [100, 200],
      );

      invokeAction(table, gridEl, { type: 'insert-col-right', index: 0 });

      const saved = table.save(document.createElement('div'));

      // After inserting at index 1 (right of 0): should have 3 widths
      expect(saved.colWidths).toHaveLength(3);
      // First width preserved
      expect(saved.colWidths?.[0]).toBe(100);
      // Last width preserved
      expect(saved.colWidths?.[2]).toBe(200);
    });
  });

  describe('deleteColumnWithCleanup', () => {
    it('produces correct colWidths after deleteColumnWithCleanup', () => {
      const { table } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      table.deleteColumnWithCleanup(1);

      const saved = table.save(document.createElement('div'));

      // After deleting col 1: [100, 200, 300] -> [100, 300]
      expect(saved.colWidths).toEqual([100, 300]);
    });

    it('produces correct colWidths after deleting first column with cleanup', () => {
      const { table } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      table.deleteColumnWithCleanup(0);

      const saved = table.save(document.createElement('div'));

      // After deleting col 0: [100, 200, 300] -> [200, 300]
      expect(saved.colWidths).toEqual([200, 300]);
    });
  });

  describe('colWidths length stays consistent with column count', () => {
    it('colWidths length equals column count after move-col', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'move-col', fromIndex: 0, toIndex: 2 });

      const saved = table.save(document.createElement('div'));

      expect(saved.colWidths).toHaveLength(saved.content[0].length);
    });

    it('colWidths length equals column count after delete-col', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B', 'C'], ['D', 'E', 'F']],
        [100, 200, 300],
      );

      invokeAction(table, gridEl, { type: 'delete-col', index: 1 });

      const saved = table.save(document.createElement('div'));

      expect(saved.colWidths).toHaveLength(saved.content[0].length);
    });

    it('colWidths length equals column count after insert-col-left', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B'], ['C', 'D']],
        [100, 200],
      );

      invokeAction(table, gridEl, { type: 'insert-col-left', index: 1 });

      const saved = table.save(document.createElement('div'));

      expect(saved.colWidths).toHaveLength(saved.content[0].length);
    });

    it('colWidths length equals column count after insert-col-right', () => {
      const { table, gridEl } = createTableWithColWidths(
        [['A', 'B'], ['C', 'D']],
        [100, 200],
      );

      invokeAction(table, gridEl, { type: 'insert-col-right', index: 0 });

      const saved = table.save(document.createElement('div'));

      expect(saved.colWidths).toHaveLength(saved.content[0].length);
    });
  });
});
