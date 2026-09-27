import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Table } from '../../../../src/tools/table';
import type { TableConfig, TableData } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * A cell whose block ids never arrive shows its saved `text` once the sync
 * settles. These pin who may write that text, and which text it is.
 */

interface SyncFlags {
  isSyncingFromYjs: boolean;
  isApplyingRemoteChange: boolean;
}

const createOptions = (): { options: BlockToolConstructorOptions<TableData, TableConfig>; flags: SyncFlags } => {
  const blocks = {
    isSyncingFromYjs: false,
    isApplyingRemoteChange: false,
    delete: vi.fn(),
    getChildren: vi.fn().mockReturnValue([]),
    insert: vi.fn().mockImplementation(() => {
      const holder = document.createElement('div');
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    }),
    getById: vi.fn(() => undefined),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    setBlockParent: vi.fn(),
    moveTo: vi.fn(),
    transactWithoutCapture: vi.fn((fn: () => void) => fn()),
  };
  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key },
    blocks,
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;

  return {
    options: {
      data: { withHeadings: false, withHeadingColumn: false, content: [['A']] },
      config: {},
      api,
      readOnly: false,
      block: { id: 'table-fallback-test' } as never,
    },
    flags: blocks,
  };
};

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

const insertedTexts = (api: API): unknown[] =>
  vi.mocked(api.blocks.insert).mock.calls.map(([, data]) => data?.text);

describe('table cell fallback text', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  const mount = (): { table: Table; api: API; flags: SyncFlags; settle: () => Promise<void> } => {
    const { options, flags } = createOptions();
    const table = new Table(options);

    container.appendChild(table.render());
    table.rendered();
    vi.mocked(options.api.blocks.insert).mockClear();

    const settle = async (): Promise<void> => {
      await Promise.resolve();
      flags.isSyncingFromYjs = false;
      await nextFrame();
      await nextFrame();
    };

    return { table, api: options.api, flags, settle };
  };

  // Every peer replays the same write; each one writing the text would put
  // one copy per peer into the shared cell. The author fills it instead.
  it('leaves a peer\'s dangling cell text to that peer', async () => {
    const { table, api, flags, settle } = mount();

    flags.isSyncingFromYjs = true;
    flags.isApplyingRemoteChange = true;
    table.setData({ withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['gone'], text: 'PEER' }]] });
    flags.isApplyingRemoteChange = false;
    await settle();

    expect(insertedTexts(api)).not.toContain('PEER');
    // An empty stand-in would outlive the peer's text block unless it wins the id tie.
    expect(insertedTexts(api)).toEqual([]);
  });

  it('still writes the text when this editor made the change', async () => {
    const { table, api, flags, settle } = mount();

    flags.isSyncingFromYjs = true;
    table.setData({ withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['gone'], text: 'MINE' }]] });
    await settle();

    expect(insertedTexts(api)).toEqual(['MINE']);
  });

  // Each rebuild gets its own TableCellBlocks, so an earlier pass's text is gone.
  it('does not bring back an earlier pass\'s text for the same missing ids', async () => {
    const { table, api, flags, settle } = mount();

    flags.isSyncingFromYjs = true;
    table.setData({ withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['m'], text: 'OLD' }]] });
    table.setData({ withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['m'] }]] });
    await settle();

    expect(insertedTexts(api)).not.toContain('OLD');
    expect(insertedTexts(api)).toEqual(['']);
  });
});
