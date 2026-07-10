import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { buildClipboardHtml } from '../../../../src/tools/table/table-cell-clipboard';
import type { TableData, TableConfig, TableCellsClipboard, CellContent } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Gap A (into-table route): pasting a copied merged region into another table
 * skipped covered payload slots but never re-applied the merge, flattening the
 * region and leaving whatever content sat under the covered coordinates.
 * The spans carried by the clipboard payload must be reconstructed in the
 * destination model.
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
  (table as unknown as {
    model: {
      hasMerges: () => boolean;
      getCellSpan: (row: number, col: number) => { colspan: number; rowspan: number };
      snapshot: () => { content: CellContent[][] };
    };
  }).model;

const focusCell = (gridEl: HTMLElement, row: number, col: number): void => {
  const cell = gridEl.querySelector(
    `[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`
  ) as HTMLElement;
  const focusTarget = document.createElement('div');

  focusTarget.tabIndex = 0;
  cell.appendChild(focusTarget);
  focusTarget.focus();
};

const dispatchPasteHtml = (gridEl: HTMLElement, html: string): void => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : '') },
  });

  gridEl.dispatchEvent(event);
};

const dispatchPaste = (gridEl: HTMLElement, payload: TableCellsClipboard): void => {
  dispatchPasteHtml(gridEl, buildClipboardHtml(payload));
};

describe('Pasting a merged clipboard payload into a table reconstructs the merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('re-applies a colspan merge at the destination', () => {
    const { table, gridEl } = createTable([
      [{ blocks: [] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }],
    ]);

    focusCell(gridEl, 0, 0);

    // 2x2 payload: origin (0,0) spans both columns of row 0.
    const payload: TableCellsClipboard = {
      rows: 2,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'Merged' } }], colspan: 2 },
          { blocks: [], covered: true },
        ],
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'A' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'B' } }] },
        ],
      ],
    };

    dispatchPaste(gridEl, payload);

    const m = model(table);
    const content = m.snapshot().content;

    expect(m.hasMerges()).toBe(true);
    expect(m.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(content[0][1].mergedInto).toEqual([0, 0]);
    // Origin keeps the pasted content, non-merged cells got theirs.
    expect(content[0][0].blocks.length).toBeGreaterThan(0);
    expect(content[1][0].blocks.length).toBeGreaterThan(0);
    expect(content[1][1].blocks.length).toBeGreaterThan(0);
  });

  it('re-applies a rowspan merge at a shifted destination anchor', () => {
    const { table, gridEl } = createTable([
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    ]);

    focusCell(gridEl, 0, 1);

    // 2x1 payload: origin spans two rows.
    const payload: TableCellsClipboard = {
      rows: 2,
      cols: 1,
      cells: [
        [{ blocks: [{ tool: 'paragraph', data: { text: 'Tall' } }], rowspan: 2 }],
        [{ blocks: [], covered: true }],
      ],
    };

    dispatchPaste(gridEl, payload);

    const m = model(table);
    const content = m.snapshot().content;

    expect(m.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 2 });
    expect(content[1][1].mergedInto).toEqual([0, 1]);
  });

  it('reconstructs merges when pasting a FOREIGN html table into a cell (Gap B)', () => {
    const { table, gridEl } = createTable([
      [{ blocks: [] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }],
    ]);

    focusCell(gridEl, 0, 0);

    // Foreign table (no data-blok-table-cells attribute) with a rowspan.
    dispatchPasteHtml(
      gridEl,
      '<table><tr><td rowspan="2">Tall</td><td>B1</td></tr><tr><td>B2</td></tr></table>'
    );

    const m = model(table);
    const content = m.snapshot().content;

    // The rowspan is reconstructed and B2 lands at logical column 1, not 0.
    expect(m.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(content[1][0].mergedInto).toEqual([0, 0]);
    expect(content[1][1].blocks.length).toBeGreaterThan(0);
  });

  it('pastes legacy covered-only payloads (no spans) without creating merges', () => {
    const { table, gridEl } = createTable([
      [{ blocks: [] }, { blocks: [] }],
    ]);

    focusCell(gridEl, 0, 0);

    const payload: TableCellsClipboard = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'Origin' } }] },
          { blocks: [], covered: true },
        ],
      ],
    };

    dispatchPaste(gridEl, payload);

    const m = model(table);

    expect(m.hasMerges()).toBe(false);
    expect(m.snapshot().content[0][0].blocks.length).toBeGreaterThan(0);
  });
});
