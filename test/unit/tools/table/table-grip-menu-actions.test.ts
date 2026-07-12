import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Table } from '../../../../src/tools/table';
import { TableGrid } from '../../../../src/tools/table/table-core';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Integration cover for the grip menu's three new actions, driving the REAL
 * Table (model + DOM + cell blocks), because every one of them shipped broken
 * or missing:
 *
 * - Duplicate row/column did not exist at all.
 * - Clear contents wiped the cells' COLORS along with their text.
 * - The grip's only route to Color went through the selection pill's popover,
 *   whose opening tore the grip popover down, which in turn cleared the very
 *   selection the colour would have been applied to.
 */

interface StoredBlock {
  id: string;
  holder: HTMLElement;
  name: string;
  data: Record<string, unknown>;
  parentId: string | null;
}

interface Harness {
  table: Table;
  gridEl: HTMLElement;
  blocks: Map<string, StoredBlock>;
}

const createMockAPI = (blocks: Map<string, StoredBlock>): API => {
  let counter = 0;

  /** Insertion order, so getBlockIndex/delete behave like the real BlockManager. */
  const order: string[] = [];

  const toBlockApi = (entry: StoredBlock): unknown => ({
    id: entry.id,
    name: entry.name,
    holder: entry.holder,
    preservedData: entry.data,
    preservedTunes: {},
    dispatchChange: vi.fn(),
  });

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
    i18n: { t: (key: string) => key },
    blocks: {
      insert: vi.fn((tool: string, data: Record<string, unknown>) => {
        counter += 1;

        const id = `block-${counter}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        const entry: StoredBlock = {
          id,
          holder,
          name: tool,
          data: data ?? {},
          parentId: null,
        };

        blocks.set(id, entry);
        order.push(id);

        return toBlockApi(entry);
      }),
      delete: vi.fn((index: number) => {
        const id = order[index];

        if (id === undefined) {
          return Promise.resolve();
        }

        blocks.get(id)?.holder.remove();
        blocks.delete(id);
        order.splice(index, 1);

        return Promise.resolve();
      }),
      getChildren: vi.fn().mockReturnValue([]),
      getById: vi.fn((id: string) => {
        const entry = blocks.get(id);

        return entry === undefined ? null : toBlockApi(entry);
      }),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn((id: string) => {
        const index = order.indexOf(id);

        return index === -1 ? undefined : index;
      }),
      getBlocksCount: vi.fn(() => blocks.size),
      setBlockParent: vi.fn((id: string, parentId: string) => {
        const entry = blocks.get(id);

        if (entry !== undefined) {
          entry.parentId = parentId;
        }
      }),
      transactWithoutCapture: vi.fn((fn: () => void) => fn()),
    },
    events: { on: vi.fn(), off: vi.fn() },
    toolbar: { close: vi.fn() },
    caret: { setToBlock: vi.fn() },
  } as unknown as API;
};

const createTable = (data: TableData): Harness => {
  const blocks = new Map<string, StoredBlock>();
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data,
    config: {},
    api: createMockAPI(blocks),
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, gridEl, blocks };
};

const invokeAction = (table: Table, gridEl: HTMLElement, action: RowColAction): void => {
  const subsystems = (table as unknown as { subsystems: unknown }).subsystems;

  (subsystems as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
    .handleRowColAction(gridEl, action);
};

const clearRange = (table: Table, type: 'row' | 'col', index: number): void => {
  const subsystems = (table as unknown as { subsystems: unknown }).subsystems;

  (subsystems as { clearRangeContents: (t: 'row' | 'col', i: number) => void })
    .clearRangeContents(type, index);
};

const colorRange = (table: Table, type: 'row' | 'col', index: number, color: string): void => {
  const subsystems = (table as unknown as { subsystems: unknown }).subsystems;

  (subsystems as {
    colorRange: (t: 'row' | 'col', i: number, c: string | null, m: 'backgroundColor' | 'textColor') => void;
  }).colorRange(type, index, color, 'backgroundColor');
};

const model = (table: Table): {
  snapshot: () => TableData;
  getCellColor: (row: number, col: number) => string | undefined;
  getCellBlocks: (row: number, col: number) => string[];
  validateInvariants: () => void;
  rows: number;
  cols: number;
} => (table as unknown as { model: never }).model;

/** Every rendered cell as [row, col, colSpan, rowSpan], in document order. */
const renderedCells = (gridEl: HTMLElement): Array<[number, number, number, number]> =>
  Array.from(gridEl.querySelectorAll<HTMLTableCellElement>('[data-blok-table-cell]')).map(cell => [
    Number(cell.getAttribute('data-blok-table-cell-row')),
    Number(cell.getAttribute('data-blok-table-cell-col')),
    cell.colSpan || 1,
    cell.rowSpan || 1,
  ]);

const flatData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [], text: 'A1' }, { blocks: [], text: 'B1' }],
    [{ blocks: [], text: 'A2' }, { blocks: [], text: 'B2' }],
  ],
});

const mergedData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  // Row 0 col 0 spans two columns.
  content: [
    [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

describe('grip menu actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('duplicate row', () => {
    it('inserts a copy directly below and deep-copies the cell blocks (new ids)', () => {
      const { table, gridEl, blocks } = createTable(flatData());
      const sourceIds = [
        ...model(table).getCellBlocks(0, 0),
        ...model(table).getCellBlocks(0, 1),
      ];

      invokeAction(table, gridEl, { type: 'duplicate-row', index: 0 });

      expect(model(table).rows).toBe(3);

      const copyIds = [
        ...model(table).getCellBlocks(1, 0),
        ...model(table).getCellBlocks(1, 1),
      ];

      // The source row still owns its own blocks...
      expect([
        ...model(table).getCellBlocks(0, 0),
        ...model(table).getCellBlocks(0, 1),
      ]).toEqual(sourceIds);

      // ...and the copy got BRAND NEW blocks, not aliases of the originals.
      expect(copyIds).toHaveLength(2);
      expect(copyIds.some(id => sourceIds.includes(id))).toBe(false);

      // Same content, different identity.
      const text = (id: string): unknown => blocks.get(id)?.data.text;

      expect(copyIds.map(text)).toEqual(sourceIds.map(text));
    });

    it('does not alias the source block data — editing the copy leaves the original alone', () => {
      const { table, gridEl, blocks } = createTable(flatData());
      const sourceId = model(table).getCellBlocks(0, 0)[0];

      invokeAction(table, gridEl, { type: 'duplicate-row', index: 0 });

      const copyId = model(table).getCellBlocks(1, 0)[0];
      const copy = blocks.get(copyId);
      const source = blocks.get(sourceId);

      if (copy === undefined || source === undefined) {
        throw new Error('duplicate must create a real block');
      }

      expect(copy.data).not.toBe(source.data);

      copy.data.text = 'edited';

      expect(source.data.text).toBe('A1');
    });

    it('copies the row colors', () => {
      const { table, gridEl } = createTable(flatData());

      colorRange(table, 'row', 0, '#ff0000');
      invokeAction(table, gridEl, { type: 'duplicate-row', index: 0 });

      expect(model(table).getCellColor(1, 0)).toBe('#ff0000');
      expect(model(table).getCellColor(1, 1)).toBe('#ff0000');
    });

    it('does not corrupt a merged grid (rebuilds from the model, no physical row insert)', () => {
      const addRowSpy = vi.spyOn(TableGrid.prototype, 'addRow');
      const { table, gridEl } = createTable(mergedData());

      // Row 1 is clear of the colspan-only merge in row 0.
      invokeAction(table, gridEl, { type: 'duplicate-row', index: 1 });

      expect(addRowSpy).not.toHaveBeenCalled();
      expect(() => model(table).validateInvariants()).not.toThrow();
      expect(renderedCells(gridEl)).toEqual([
        [0, 0, 2, 1],
        [0, 2, 1, 1],
        [1, 0, 1, 1],
        [1, 1, 1, 1],
        [1, 2, 1, 1],
        [2, 0, 1, 1],
        [2, 1, 1, 1],
        [2, 2, 1, 1],
      ]);
    });
  });

  describe('duplicate column', () => {
    it('inserts a copy to the right with new blocks and the source column width', () => {
      const { table, gridEl } = createTable({ ...flatData(), colWidths: [120, 240] });
      const sourceIds = [
        ...model(table).getCellBlocks(0, 1),
        ...model(table).getCellBlocks(1, 1),
      ];

      invokeAction(table, gridEl, { type: 'duplicate-col', index: 1 });

      expect(model(table).cols).toBe(3);

      const copyIds = [
        ...model(table).getCellBlocks(0, 2),
        ...model(table).getCellBlocks(1, 2),
      ];

      expect(copyIds).toHaveLength(2);
      expect(copyIds.some(id => sourceIds.includes(id))).toBe(false);
      expect(model(table).snapshot().colWidths).toEqual([120, 240, 240]);
    });

    it('does not corrupt a merged grid', () => {
      const addColumnSpy = vi.spyOn(TableGrid.prototype, 'addColumn');
      const { table, gridEl } = createTable(mergedData());

      invokeAction(table, gridEl, { type: 'duplicate-col', index: 2 });

      expect(addColumnSpy).not.toHaveBeenCalled();
      expect(() => model(table).validateInvariants()).not.toThrow();
      expect(renderedCells(gridEl)).toEqual([
        [0, 0, 2, 1],
        [0, 2, 1, 1],
        [0, 3, 1, 1],
        [1, 0, 1, 1],
        [1, 1, 1, 1],
        [1, 2, 1, 1],
        [1, 3, 1, 1],
      ]);
    });
  });

  describe('clear contents', () => {
    /** Block holders currently mounted in the cell at [row, col]. */
    const holdersIn = (gridEl: HTMLElement, row: number, col: number): number => {
      const cell = gridEl.querySelector(
        `[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`
      );

      return cell?.querySelectorAll('[data-blok-id]').length ?? -1;
    };

    it('clears the content of a row but PRESERVES its colors', () => {
      const { table, gridEl } = createTable(flatData());

      colorRange(table, 'row', 0, '#00ff00');

      expect(holdersIn(gridEl, 0, 0)).toBe(1);

      clearRange(table, 'row', 0);

      // Content is gone from every cell of the row...
      expect(holdersIn(gridEl, 0, 0)).toBe(0);
      expect(holdersIn(gridEl, 0, 1)).toBe(0);
      // ...row 1 is untouched...
      expect(holdersIn(gridEl, 1, 0)).toBe(1);
      // ...and the color survived, in the model and in the DOM.
      expect(model(table).getCellColor(0, 0)).toBe('#00ff00');
      expect(model(table).getCellColor(0, 1)).toBe('#00ff00');

      const firstCell = gridEl.querySelector<HTMLElement>('[data-blok-table-cell]');

      expect(firstCell?.style.backgroundColor).not.toBe('');
    });

    it('clears a column without touching its colors', () => {
      const { table, gridEl } = createTable(flatData());

      colorRange(table, 'col', 1, '#0000ff');
      clearRange(table, 'col', 1);

      expect(holdersIn(gridEl, 0, 1)).toBe(0);
      expect(holdersIn(gridEl, 1, 1)).toBe(0);
      expect(holdersIn(gridEl, 0, 0)).toBe(1);

      expect(model(table).getCellColor(0, 1)).toBe('#0000ff');
      expect(model(table).getCellColor(1, 1)).toBe('#0000ff');
    });
  });

  describe('grip popover lifecycle (ITEM A regression)', () => {
    it('a popover closing while a grip selection is painted must not wipe the selection', () => {
      const { table } = createTable(flatData());
      const subsystems = table as unknown as {
        subsystems: {
          cellSelectionSubsystem: { selectRow: (i: number) => void; getSelectedRange: () => unknown } | null;
          rowColControls: unknown;
        };
      };
      const selection = subsystems.subsystems.cellSelectionSubsystem;

      if (selection === null) {
        throw new Error('cell selection subsystem must exist');
      }

      selection.selectRow(0);
      expect(selection.getSelectedRange()).not.toBeNull();

      // The grip popover closes for reasons other than "the user dismissed the
      // row" — e.g. another popover (the selection pill's own colour menu) takes
      // over via the registry's mutual exclusion. That must NOT tear the
      // selection down: doing so destroyed the very menu that was opening.
      (subsystems.subsystems as unknown as { handleGripPopoverClose: () => void }).handleGripPopoverClose();

      expect(selection.getSelectedRange()).not.toBeNull();
    });
  });
});
