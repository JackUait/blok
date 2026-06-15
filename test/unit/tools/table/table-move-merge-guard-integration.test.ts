import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { TableGrid } from '../../../../src/tools/table/table-core';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Integration regression for H5/H6/H7. The handler unit tests prove the DOM
 * move and the model move each bail in isolation, but a desync only appears
 * when one bails and the other does NOT. This test drives the REAL Table:
 * model.hasMerges() must gate BOTH the DOM move (grid.moveColumn) and the model
 * move (snapshot) together, so they can never disagree on a merged grid.
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

describe('Table move guard: DOM and model bail together on a merged grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('move-col leaves both the DOM (grid.moveColumn) and the model untouched', () => {
    const moveColumnSpy = vi.spyOn(TableGrid.prototype, 'moveColumn');
    const { table, gridEl } = createMergedTable();

    const before = modelContent(table);

    invokeAction(table, gridEl, { type: 'move-col', fromIndex: 2, toIndex: 0 });

    // DOM side bailed: the physical-index move never ran.
    expect(moveColumnSpy).not.toHaveBeenCalled();
    // Model side bailed: column order is byte-for-byte unchanged.
    expect(modelContent(table)).toEqual(before);
  });

  it('move-row leaves both the DOM (grid.moveRow) and the model untouched', () => {
    const moveRowSpy = vi.spyOn(TableGrid.prototype, 'moveRow');
    const { table, gridEl } = createMergedTable();

    const before = modelContent(table);

    invokeAction(table, gridEl, { type: 'move-row', fromIndex: 1, toIndex: 0 });

    expect(moveRowSpy).not.toHaveBeenCalled();
    expect(modelContent(table)).toEqual(before);
  });
});
