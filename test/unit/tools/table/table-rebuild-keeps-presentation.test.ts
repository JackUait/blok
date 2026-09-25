import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { CELL_COL_ATTR, ROW_ATTR } from '../../../../src/tools/table/table-core';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { SelectionRange } from '../../../../src/tools/table/table-cell-selection';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Regression: merging cells reset the header row, the heading column, cell
 * colors and cell placement in the DOM. rebuildTableBody swaps in a fresh
 * <tbody> built from structure only, while the model still held all of it.
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
    insert: vi.fn().mockImplementation(() => {
      const holder = document.createElement('div');
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    }),
    delete: vi.fn(),
    getChildren: vi.fn().mockReturnValue([]),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    getBlocksCount: vi.fn().mockReturnValue(0),
    setBlockParent: vi.fn(),
  },
  events: { on: vi.fn(), off: vi.fn() },
  toolbar: { close: vi.fn() },
} as unknown as API);

const BLUE = 'rgb(0, 0, 255)';
const RED = 'rgb(255, 0, 0)';

/**
 * 3x3, heading row + heading column. The header cell [0,0] is blue with red
 * text and centered. Row 2 [2,0] carries a color too.
 */
const styledData = (withMerge: boolean): TableData => ({
  withHeadings: true,
  withHeadingColumn: true,
  content: [
    [
      { blocks: [], color: BLUE, textColor: RED, placement: 'middle-center' },
      { blocks: [] },
      { blocks: [] },
    ],
    withMerge
      ? [{ blocks: [] }, { blocks: [], colspan: 2 }, { blocks: [], mergedInto: [1, 1] }]
      : [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [], color: BLUE }, { blocks: [] }, { blocks: [] }],
  ],
});

const createTable = (data: TableData): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data,
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'table-rebuild-presentation' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, gridEl };
};

interface SubsystemsView {
  handleRowColAction: (grid: HTMLElement, a: RowColAction) => void;
  cellSelectionSubsystem: unknown;
}

const subsystemsOf = (table: Table): SubsystemsView =>
  (table as unknown as { subsystems: SubsystemsView }).subsystems;

const selectionCallbacks = (table: Table): {
  onMergeCells: (range: SelectionRange) => void;
  onSplitCell: (row: number, col: number) => void;
} => subsystemsOf(table).cellSelectionSubsystem as {
  onMergeCells: (range: SelectionRange) => void;
  onSplitCell: (row: number, col: number) => void;
};

const cellAt = (gridEl: HTMLElement, row: number, col: number): HTMLElement => {
  const rowEl = gridEl.querySelectorAll(`[${ROW_ATTR}]`)[row];
  const cell = rowEl?.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${col}"]`);

  if (!cell) {
    throw new Error(`no cell at ${row},${col}`);
  }

  return cell;
};

const expectPresentationKept = (gridEl: HTMLElement): void => {
  const header = cellAt(gridEl, 0, 0);

  expect(header.style.backgroundColor).toBe(BLUE);
  expect(header.style.color).toBe(RED);
  expect(header.querySelector('[data-blok-table-cell-blocks]')?.getAttribute('data-blok-cell-placement'))
    .toBe('middle-center');
  expect(gridEl.querySelectorAll(`[${ROW_ATTR}]`)[0].hasAttribute('data-blok-table-heading')).toBe(true);
  expect(cellAt(gridEl, 0, 1).getAttribute('role')).toBe('columnheader');
  expect(cellAt(gridEl, 2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  expect(cellAt(gridEl, 2, 0).style.backgroundColor).toBe(BLUE);
};

describe('Table rebuild keeps model presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('merge keeps header alignment, colors, heading row and heading column', () => {
    const { table, gridEl } = createTable(styledData(false));

    selectionCallbacks(table).onMergeCells({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 });

    expectPresentationKept(gridEl);
  });

  it('merge paints the new cells before they enter the live grid', async () => {
    const { table, gridEl } = createTable(styledData(false));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));

    observer.observe(gridEl, { attributes: true, subtree: true });
    selectionCallbacks(table).onMergeCells({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 2 });
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();

    const paintAttributes = ['style', 'role', 'data-blok-table-heading', 'data-blok-table-heading-col', 'data-blok-cell-placement'];

    expect(records.filter(record => paintAttributes.includes(record.attributeName ?? ''))).toStrictEqual([]);
    expectPresentationKept(gridEl);
  });

  it('split keeps header alignment, colors, heading row and heading column', () => {
    const { table, gridEl } = createTable(styledData(true));

    selectionCallbacks(table).onSplitCell(1, 1);

    expectPresentationKept(gridEl);
  });

  it('insert-row on a merged table keeps colors and placement', () => {
    const { table, gridEl } = createTable(styledData(true));

    subsystemsOf(table).handleRowColAction(gridEl, { type: 'insert-row-below', index: 2 });

    expectPresentationKept(gridEl);
  });

  it('move-row on a merged table paints the moved row from the model', () => {
    const { table, gridEl } = createTable(styledData(true));

    // The row drag highlights the source row and records the old color, then
    // runs the action, then restores that color onto the (now detached) cells.
    const sourceCell = cellAt(gridEl, 2, 0);
    const originalBg = sourceCell.style.backgroundColor;

    sourceCell.style.backgroundColor = '#f3f4f6';
    subsystemsOf(table).handleRowColAction(gridEl, { type: 'move-row', fromIndex: 2, toIndex: 0 });
    sourceCell.style.backgroundColor = originalBg;

    const movedCell = cellAt(gridEl, 0, 0);

    expect(sourceCell.isConnected).toBe(false);
    expect(movedCell.style.backgroundColor).toBe(BLUE);
    expect(movedCell.style.color).toBe('');
    expect(cellAt(gridEl, 1, 0).style.backgroundColor).toBe(BLUE);
    expect(cellAt(gridEl, 1, 0).style.color).toBe(RED);
  });
});
