import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { buildClipboardHtml } from '../../../../src/tools/table/table-cell-clipboard';
import type { TableData, TableConfig, TableCellsClipboard } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

// ─── Helpers ───────────────────────────────────────────────────────

const createMockAPI = (): API => {
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
  } as unknown as API;
};

const createTable = (): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      content: [[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]],
    },
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

const single = (block: TableCellsClipboard['cells'][0][0]['blocks'][0]): TableCellsClipboard => ({
  rows: 1,
  cols: 1,
  cells: [[{ blocks: [block] }]],
});

const dispatchPaste = (gridEl: HTMLElement, payload: TableCellsClipboard): void => {
  const html = buildClipboardHtml(payload);
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : '') },
  });

  gridEl.dispatchEvent(event);
};

// ─── Tests ─────────────────────────────────────────────────────────

describe('Table 1×1 paste routing: non-text blocks recreated, not dropped (M5)', () => {
  let intoCells: ReturnType<typeof vi.spyOn>;
  let inline: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const setup = (): HTMLElement => {
    const { table, gridEl } = createTable();
    type SpyableSubsystems = {
      pastePayloadIntoCells: (...args: unknown[]) => void;
      insertSingleCellPayloadInline: (...args: unknown[]) => void;
    };
    const subsystems = (table as unknown as { subsystems: SpyableSubsystems }).subsystems;

    intoCells = vi.spyOn(subsystems, 'pastePayloadIntoCells').mockImplementation(() => {});
    inline = vi.spyOn(subsystems, 'insertSingleCellPayloadInline').mockImplementation(() => {});

    // Place the caret inside the first cell so the paste handler resolves a target.
    const cell = gridEl.querySelector('[data-blok-table-cell]') as HTMLElement;
    const focusTarget = document.createElement('div');

    focusTarget.tabIndex = 0;
    cell.appendChild(focusTarget);
    focusTarget.focus();

    expect(cell.contains(document.activeElement)).toBe(true);

    return gridEl;
  };

  it('routes a single image cell through full recreation (not inline text extraction)', () => {
    const gridEl = setup();

    dispatchPaste(gridEl, single({ tool: 'image', data: { file: { url: 'x.png' } } }));

    expect(intoCells).toHaveBeenCalledTimes(1);
    expect(inline).not.toHaveBeenCalled();
  });

  it('still routes a single text cell through fast inline insertion', () => {
    const gridEl = setup();

    dispatchPaste(gridEl, single({ tool: 'paragraph', data: { text: 'hi' } }));

    expect(inline).toHaveBeenCalledTimes(1);
    expect(intoCells).not.toHaveBeenCalled();
  });
});
