import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { CELL_ATTR, CELL_COL_ATTR, CELL_ROW_ATTR } from '../../../../src/tools/table/table-core';
import type { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Regression: inserting a row/column into a MERGED grid desyncs the DOM from
 * the model.
 *
 * The model half is correct (expandSpansForInsertedRow/Col grow the origin's
 * span and mark the new cells as covered), but the DOM half inserts plain
 * <td>s at PHYSICAL indices — it never grows the origin's colSpan/rowSpan and
 * never omits the covered cells. The result is a phantom editable <td> inside
 * the merge footprint and scrambled data-blok-table-cell-col coordinates,
 * so anything typed into the phantom cell is dropped on the next render.
 *
 * THE INVARIANT under test: after ANY structural op on a table with merges,
 * the rendered <tbody> must be exactly what the model describes.
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

/**
 * 3x3 grid whose row 0 merges B1:C1 (origin [0,1], colspan 2).
 */
const colspanData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 1] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

/**
 * 3x3 grid whose column 1 merges B1:B2 (origin [0,1], rowspan 2).
 */
const rowspanData = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [], rowspan: 2 }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [], mergedInto: [0, 1] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

const createTable = (data: TableData): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data,
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'table-insert-merge' } as never,
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

const getModel = (table: Table): TableModel =>
  (table as unknown as { model: TableModel }).model;

const cellsOf = (gridEl: HTMLElement): HTMLTableCellElement[] =>
  Array.from(gridEl.querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`));

/**
 * The core invariant: every rendered <td> is a non-spanned model cell at the
 * coordinates its data attributes claim, with matching spans — and every
 * non-spanned model cell has exactly one <td>.
 */
const expectDomMatchesModel = (gridEl: HTMLElement, model: TableModel): void => {
  const rendered = cellsOf(gridEl).map(cell => {
    const row = Number(cell.getAttribute(CELL_ROW_ATTR));
    const col = Number(cell.getAttribute(CELL_COL_ATTR));

    return {
      row,
      col,
      colSpan: cell.colSpan || 1,
      rowSpan: cell.rowSpan || 1,
    };
  });

  const expected: Array<{ row: number; col: number; colSpan: number; rowSpan: number }> = [];

  Array.from({ length: model.rows }).forEach((_, r) => {
    Array.from({ length: model.cols }).forEach((__, c) => {
      if (model.isSpannedCell(r, c)) {
        return;
      }

      const span = model.getCellSpan(r, c);

      expected.push({ row: r, col: c, colSpan: span.colspan, rowSpan: span.rowspan });
    });
  });

  expect(rendered).toEqual(expected);
};

describe('structural ops on a merged grid keep the DOM in sync with the model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('insert-col-left INSIDE a colspan grows the merge instead of leaving a phantom cell', () => {
    const { table, gridEl } = createTable(colspanData());
    const model = getModel(table);

    // Column 2 is covered by the B1:C1 merge — inserting to its left lands
    // inside the merge footprint.
    invokeAction(table, gridEl, { type: 'insert-col-left', index: 2 });

    expect(model.cols).toBe(4);

    const origin = gridEl.querySelector<HTMLTableCellElement>(
      `[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="1"]`
    );

    expect(origin).not.toBeNull();
    // The merge absorbed the inserted column: B1 now spans cols 1..3.
    expect(origin?.colSpan).toBe(3);

    // Row 0 renders exactly two <td>s: A1 and the merge origin. A phantom <td>
    // inside the merged footprint would make it three.
    const row0Cells = Array.from(
      gridEl.querySelectorAll<HTMLElement>(`[${CELL_ROW_ATTR}="0"]`)
    );

    expect(row0Cells).toHaveLength(2);

    expectDomMatchesModel(gridEl, model);
  });

  it('insert-col-right OUTSIDE a colspan leaves the merge intact', () => {
    const { table, gridEl } = createTable(colspanData());
    const model = getModel(table);

    invokeAction(table, gridEl, { type: 'insert-col-right', index: 2 });

    expect(model.cols).toBe(4);
    expectDomMatchesModel(gridEl, model);
  });

  it('insert-row INSIDE a rowspan grows the merge instead of leaving a phantom cell', () => {
    const { table, gridEl } = createTable(rowspanData());
    const model = getModel(table);

    // Row 1 is covered by the B1:B2 merge — inserting above it lands inside
    // the merge footprint.
    invokeAction(table, gridEl, { type: 'insert-row-above', index: 1 });

    expect(model.rows).toBe(4);

    const origin = gridEl.querySelector<HTMLTableCellElement>(
      `[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="1"]`
    );

    expect(origin).not.toBeNull();
    expect(origin?.rowSpan).toBe(3);

    // The inserted row must NOT carry a <td> at the covered column 1.
    const insertedRowCells = Array.from(
      gridEl.querySelectorAll<HTMLElement>(`[${CELL_ROW_ATTR}="1"]`)
    );

    expect(insertedRowCells).toHaveLength(2);
    expect(insertedRowCells.map(c => c.getAttribute(CELL_COL_ATTR))).toEqual(['0', '2']);

    expectDomMatchesModel(gridEl, model);
  });

  it('insert-row-below the last covered row leaves the merge intact', () => {
    const { table, gridEl } = createTable(rowspanData());
    const model = getModel(table);

    invokeAction(table, gridEl, { type: 'insert-row-below', index: 2 });

    expect(model.rows).toBe(4);
    expectDomMatchesModel(gridEl, model);
  });
});
