import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { buildClipboardHtml } from '../../../../src/tools/table/table-cell-clipboard';
import type { TableData, TableConfig, TableCellsClipboard, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Regression: pasting a multi-cell block onto a destination region that overlaps
 * an EXISTING merge in the target table silently dropped every payload cell that
 * landed on a merge-covered coordinate (grid.getCell returns null for covered
 * positions, so that payload cell was skipped). The paste must not lose data:
 * the overlapped merge is split first so every destination is a real cell.
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
    insert: vi.fn().mockImplementation((_tool: string, _data: unknown, _tunes: unknown, index: number) => {
      const holder = document.createElement('div');
      const id = `blk-${index}-${Math.random().toString(36).slice(2, 7)}`;

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

const createTable = (content: TableData['content']): { table: Table; gridEl: HTMLElement } => {
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

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, gridEl };
};

const model = (table: Table) =>
  (table as unknown as { model: { hasMerges: () => boolean; snapshot: () => { content: CellContent[][] } } }).model;

const dispatchPaste = (gridEl: HTMLElement, payload: TableCellsClipboard): void => {
  const html = buildClipboardHtml(payload);
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : '') },
  });

  gridEl.dispatchEvent(event);
};

describe('Paste over an existing destination merge does not drop data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('splits the overlapped merge and fills every destination cell', () => {
    // Row 1 is a horizontal 2-col merge (origin at [1,0], [1,1] covered).
    const { table, gridEl } = createTable([
      [{ blocks: [] }, { blocks: [] }],
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [1, 0] }],
    ]);

    const m = model(table);

    expect(m.hasMerges()).toBe(true);

    // Place the caret in the merged origin cell (row 1).
    const originCell = gridEl.querySelector(
      '[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"]'
    ) as HTMLElement;
    const focusTarget = document.createElement('div');

    focusTarget.tabIndex = 0;
    originCell.appendChild(focusTarget);
    focusTarget.focus();

    // Paste a 1×2 block — destination (1,0) and (1,1); (1,1) is merge-covered.
    const payload: TableCellsClipboard = {
      rows: 1,
      cols: 2,
      cells: [[
        { blocks: [{ tool: 'paragraph', data: { text: 'X' } }] },
        { blocks: [{ tool: 'paragraph', data: { text: 'Y' } }] },
      ]],
    };

    dispatchPaste(gridEl, payload);

    const row1 = m.snapshot().content[1];

    // The merge is gone and BOTH destination cells received content — no drop.
    expect(m.hasMerges()).toBe(false);
    expect(row1).toHaveLength(2);
    expect(row1[0].blocks.length).toBeGreaterThan(0);
    expect(row1[1].blocks.length).toBeGreaterThan(0);
    expect(row1[1].mergedInto).toBeUndefined();
  });
});
