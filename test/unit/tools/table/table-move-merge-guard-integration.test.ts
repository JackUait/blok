import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { TableGrid } from '../../../../src/tools/table/table-core';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Integration regression for H5/H6/H7. The handler unit tests prove the DOM
 * move and the model move each bail in isolation, but a desync only appears
 * when one bails and the other does NOT. This test drives the REAL Table: the
 * DOM half and the model half must agree, move for move.
 *
 * The guard is PER INDEX, not table-wide. A row/column that a merge holds (or
 * a drop that would land inside a merged span) is refused by BOTH halves; a
 * row/column clear of every merge still reorders normally, with the DOM
 * re-rendered from the model rather than moved at physical indices.
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

      return { id: 'mock-block', holder };
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

const mergedData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  // Row 0 col 0 spans two columns; the table therefore reports hasMerges().
  content: [
    [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

const createMergedTable = (): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: mergedData(),
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

  return { table, gridEl };
};

const invokeAction = (table: Table, gridEl: HTMLElement, action: RowColAction): void => {
  const subsystems = (table as unknown as { subsystems: unknown }).subsystems;

  (subsystems as { handleRowColAction: (grid: HTMLElement, a: RowColAction) => void })
    .handleRowColAction(gridEl, action);
};

const modelContent = (table: Table): unknown => {
  const model = (table as unknown as { model: { snapshot: () => { content: unknown } } }).model;

  return JSON.parse(JSON.stringify(model.snapshot().content));
};

/** Every rendered cell as [row, col, colSpan, rowSpan], in document order. */
const renderedCells = (gridEl: HTMLElement): Array<[number, number, number, number]> =>
  Array.from(gridEl.querySelectorAll<HTMLTableCellElement>('[data-blok-table-cell]')).map(cell => [
    Number(cell.getAttribute('data-blok-table-cell-row')),
    Number(cell.getAttribute('data-blok-table-cell-col')),
    cell.colSpan || 1,
    cell.rowSpan || 1,
  ]);

describe('Table move guard: DOM and model agree, move for move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a column HELD by a merge leaves both the DOM (grid.moveColumn) and the model untouched', () => {
    const moveColumnSpy = vi.spyOn(TableGrid.prototype, 'moveColumn');
    const { table, gridEl } = createMergedTable();

    const before = modelContent(table);
    const domBefore = renderedCells(gridEl);

    // Column 0 is the colspan ORIGIN — moving it would tear the merge.
    invokeAction(table, gridEl, { type: 'move-col', fromIndex: 0, toIndex: 2 });

    // DOM side bailed: the physical-index move never ran.
    expect(moveColumnSpy).not.toHaveBeenCalled();
    // Model side bailed: column order is byte-for-byte unchanged.
    expect(modelContent(table)).toEqual(before);
    expect(renderedCells(gridEl)).toEqual(domBefore);
  });

  it('a column CLEAR of every merge still moves — and the DOM is re-rendered from the model', () => {
    const moveColumnSpy = vi.spyOn(TableGrid.prototype, 'moveColumn');
    const { table, gridEl } = createMergedTable();

    const before = modelContent(table);

    // Column 2 is outside the B1 merge (cols 0-1) and lands ahead of it, so the
    // merge stays contiguous — the move is legal.
    invokeAction(table, gridEl, { type: 'move-col', fromIndex: 2, toIndex: 0 });

    // The model reordered...
    expect(modelContent(table)).not.toEqual(before);
    // ...and the DOM followed it WITHOUT the physical-index move, which would
    // have scrambled the merged row.
    expect(moveColumnSpy).not.toHaveBeenCalled();

    // Merge origin rode along to column 1, still spanning two columns, and the
    // merged row still renders exactly two <td>s (no phantom cell).
    expect(renderedCells(gridEl)).toEqual([
      [0, 0, 1, 1],
      [0, 1, 2, 1],
      [1, 0, 1, 1],
      [1, 1, 1, 1],
      [1, 2, 1, 1],
    ]);
  });

  it('a row CLEAR of every merge still moves on a merged table', () => {
    const moveRowSpy = vi.spyOn(TableGrid.prototype, 'moveRow');
    const { table, gridEl } = createMergedTable();

    const before = modelContent(table);

    // The merge is colspan-only, so neither row is held by it.
    invokeAction(table, gridEl, { type: 'move-row', fromIndex: 1, toIndex: 0 });

    expect(modelContent(table)).not.toEqual(before);
    expect(moveRowSpy).not.toHaveBeenCalled();

    // The merged row is now row 1 and still renders as origin + free cell.
    expect(renderedCells(gridEl)).toEqual([
      [0, 0, 1, 1],
      [0, 1, 1, 1],
      [0, 2, 1, 1],
      [1, 0, 2, 1],
      [1, 2, 1, 1],
    ]);
  });
});
