import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Regression: a table SAVED with merged cells must keep its merge after being
 * loaded and rendered. rendered() rebuilds the model from initializeCells(),
 * which walks the rendered <td>s; merge-covered cells have no <td> and the
 * origin's colspan/rowspan was dropped — so the model silently flattened the
 * merge while the DOM kept the colspan. That desync also blinds the H5/H6/H7
 * move guard (model.hasMerges() wrongly returns false on a merged-DOM table),
 * re-opening the physical-index corruption it was meant to prevent.
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

const createLoadedTable = (content: TableData['content']): Table => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content },
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'table-1' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  return table;
};

const model = (table: Table) =>
  (table as unknown as { model: { hasMerges: () => boolean; snapshot: () => { content: CellContent[][] } } }).model;

describe('Table merge persistence across load + rendered()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps a horizontal colspan merge in the model after rendered()', () => {
    const table = createLoadedTable([
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    ]);

    const m = model(table);
    const row0 = m.snapshot().content[0];

    expect(m.hasMerges()).toBe(true);
    expect(row0).toHaveLength(3);
    expect(row0[0].colspan).toBe(2);
    expect(row0[1].mergedInto).toEqual([0, 0]);
  });

  it('keeps a vertical rowspan merge in the model after rendered()', () => {
    const table = createLoadedTable([
      [{ blocks: [], rowspan: 2 }, { blocks: [] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    ]);

    const m = model(table);
    const snap = m.snapshot().content;

    expect(m.hasMerges()).toBe(true);
    expect(snap[0][0].rowspan).toBe(2);
    expect(snap[1][0].mergedInto).toEqual([0, 0]);
  });
});
