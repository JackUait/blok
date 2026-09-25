import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * A Yjs replay hands setData the converged grid. When a merge raced a peer's
 * edit, a block sits in a merge-covered cell; the model moves it into the
 * origin, and setData must not drop it again.
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
    getById: vi.fn(() => undefined),
    getChildren: vi.fn().mockReturnValue([]),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    getBlocksCount: vi.fn().mockReturnValue(0),
    setBlockParent: vi.fn(),
    isSyncingFromYjs: false,
  },
  events: { on: vi.fn(), off: vi.fn() },
  toolbar: { close: vi.fn() },
} as unknown as API);

describe('setData during a Yjs replay keeps a block left in a covered cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('moves the covered cell block into the merge origin', () => {
    const api = createMockAPI();
    const options: BlockToolConstructorOptions<TableData, TableConfig> = {
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: [] }, { blocks: [] }]] },
      config: {},
      api,
      readOnly: false,
      block: { id: 'table-covered-setdata' } as never,
    };
    const table = new Table(options);
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    (api.blocks as { isSyncingFromYjs: boolean }).isSyncingFromYjs = true;
    table.setData({
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['o'], colspan: 2 }, { blocks: ['y'], mergedInto: [0, 0] }],
        [{ blocks: ['a'] }, { blocks: ['b'] }],
      ],
    });

    const [origin, covered] = (table as unknown as { model: TableModel }).model.snapshot().content[0];

    expect(isCellWithBlocks(origin) && origin.blocks).toStrictEqual(['o', 'y']);
    expect(isCellWithBlocks(covered) && covered.blocks).toStrictEqual([]);
  });
});
