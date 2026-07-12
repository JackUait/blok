/**
 * Round-trip property guard for the cell-range clipboard.
 *
 * Copying a range of cells and pasting it back must reproduce the grid
 * IDENTICALLY: block tools + data (images, code, lists), block tunes, cell
 * colors, the 9-way placement and merge spans. Each of those was collected by
 * the payload builder and then silently ignored by a consumer (the classic
 * writer/consumer drift). This test copies ONE range carrying all of them and
 * asserts the pasted grid matches, so no field can be lost again one at a time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { CellContent, TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

interface FakeBlock {
  id: string;
  name: string;
  holder: HTMLElement;
  preservedData: Record<string, unknown>;
  preservedTunes: Record<string, unknown>;
  parentId: string | null;
}

interface FakeEditor {
  api: API;
  blocks: FakeBlock[];
  byId: (id: string) => FakeBlock | undefined;
}

const createFakeEditor = (): FakeEditor => {
  const blocks: FakeBlock[] = [];
  let seq = 0;

  const api = {
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
      insert: (
        tool = 'paragraph',
        data: Record<string, unknown> = {},
        _config?: unknown,
        index?: number,
        _needToFocus?: boolean,
        _replace?: boolean,
        id?: string,
        tunes?: Record<string, unknown>,
      ): FakeBlock => {
        seq += 1;

        const blockId = id ?? `fake-${seq}`;
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', blockId);

        const block: FakeBlock = {
          id: blockId,
          name: tool,
          holder,
          preservedData: data,
          preservedTunes: tunes ?? {},
          parentId: null,
        };

        blocks.splice(index ?? blocks.length, 0, block);

        return block;
      },
      delete: (index: number): void => {
        const [removed] = blocks.splice(index, 1);

        removed?.holder.remove();
      },
      getBlockIndex: (id: string): number | undefined => {
        const index = blocks.findIndex(block => block.id === id);

        return index === -1 ? undefined : index;
      },
      getBlockByIndex: (index: number): FakeBlock | undefined => blocks[index],
      getById: (id: string): FakeBlock | null => blocks.find(block => block.id === id) ?? null,
      getBlocksCount: (): number => blocks.length,
      getCurrentBlockIndex: (): number => 0,
      getChildren: (): FakeBlock[] => [],
      setBlockParent: (id: string, parentId: string | null): void => {
        const block = blocks.find(entry => entry.id === id);

        if (block) {
          block.parentId = parentId;
        }
      },
      transactWithoutCapture: (fn: () => void): void => fn(),
      setPointerDragActive: vi.fn(),
    },
    caret: { setToBlock: vi.fn() },
    events: { on: vi.fn(), off: vi.fn() },
  } as unknown as API;

  return { api, blocks, byId: (id: string) => blocks.find(block => block.id === id) };
};

const TABLE_ID = 'table-roundtrip';

const mountTable = (content: TableData['content'], editor: FakeEditor): { table: Table; grid: HTMLElement; wrapper: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data: { withHeadings: false, withHeadingColumn: false, content },
    config: {},
    api: editor.api,
    readOnly: false,
    block: { id: TABLE_ID } as never,
  };

  const table = new Table(options);
  const wrapper = table.render();

  document.body.appendChild(wrapper);
  table.rendered();

  const grid = wrapper.querySelector<HTMLElement>('[data-blok-table-grid]')
    ?? (wrapper.firstElementChild?.firstElementChild as HTMLElement);

  return { table, grid, wrapper };
};

/** Copy every rendered cell of the grid through the real copy handler. */
const copyGrid = (table: Table, grid: HTMLElement): { html: string; plain: string } => {
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-blok-table-cell]'));
  const store: Record<string, string> = {};
  const clipboardData = {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
  } as unknown as DataTransfer;

  const subsystems = (table as unknown as {
    subsystems: { handleCellCopy: (cells: HTMLElement[], data: DataTransfer) => void };
  }).subsystems;

  subsystems.handleCellCopy(cells, clipboardData);

  return { html: store['text/html'] ?? '', plain: store['text/plain'] ?? '' };
};

const focusCellAt = (grid: HTMLElement, row: number, col: number): void => {
  const rowEl = grid.querySelectorAll('[data-blok-table-row]')[row];
  const cell = rowEl.querySelectorAll<HTMLElement>('[data-blok-table-cell]')[col];

  let editable = cell.querySelector<HTMLElement>('[contenteditable="true"]');

  if (!editable) {
    editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    cell.appendChild(editable);
  }

  editable.focus();
};

const pasteInto = (grid: HTMLElement, html: string): void => {
  const clipboardData = {
    getData: (type: string) => (type === 'text/html' ? html : ''),
    setData: () => {},
  } as unknown as DataTransfer;

  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;

  Object.defineProperty(event, 'clipboardData', { value: clipboardData, writable: false });

  grid.dispatchEvent(event);
};

const cellAt = (saved: TableData, row: number, col: number): CellContent => {
  const cell = saved.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no structured cell at [${row}][${col}]`);
  }

  return cell;
};

const IMAGE_DATA = { file: { url: 'https://cdn.test/cat.png' }, caption: 'A cat' };
const CODE_DATA = { code: 'const a = 1;' };

/**
 * Source grid (2 rows x 3 cols):
 *   (0,0) merged 2x2, holds an IMAGE block, background color
 *   (0,2) a bullet LIST
 *   (1,2) a CODE block, text color + middle-center placement, tuned paragraph
 */
const sourceContent = (): TableData['content'] => [
  [
    {
      blocks: [],
      blockData: [{ tool: 'image', data: IMAGE_DATA }],
      colspan: 2,
      rowspan: 2,
      color: '#fbecdd',
    },
    { blocks: [], mergedInto: [0, 0] },
    { blocks: [], text: '<ul><li aria-level="1">alpha</li></ul>' },
  ],
  [
    { blocks: [], mergedInto: [0, 0] },
    { blocks: [], mergedInto: [0, 0] },
    {
      blocks: [],
      blockData: [
        { tool: 'code', data: CODE_DATA },
        { tool: 'paragraph', data: { text: 'tuned' }, tunes: { textAlign: { alignment: 'center' } } },
      ],
      textColor: '#d44c47',
      placement: 'middle-center',
    },
  ],
];

const emptyContent = (): TableData['content'] => [
  [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
];

describe('table cell clipboard round-trip: copy a rich range, paste it back, grid is identical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('preserves image / code / list blocks, tunes, colors, placement and the 2x2 merge', () => {
    const sourceEditor = createFakeEditor();
    const source = mountTable(sourceContent(), sourceEditor);

    const { html } = copyGrid(source.table, source.grid);

    source.wrapper.remove();

    const targetEditor = createFakeEditor();
    const target = mountTable(emptyContent(), targetEditor);

    focusCellAt(target.grid, 0, 0);
    pasteInto(target.grid, html);

    const saved = target.table.save(target.wrapper);

    // (d) merged 2x2 survives
    const origin = cellAt(saved, 0, 0);

    expect(origin.colspan).toBe(2);
    expect(origin.rowspan).toBe(2);
    expect(cellAt(saved, 0, 1).mergedInto).toEqual([0, 0]);
    expect(cellAt(saved, 1, 0).mergedInto).toEqual([0, 0]);
    expect(cellAt(saved, 1, 1).mergedInto).toEqual([0, 0]);

    // (a) the image block survives with its data intact
    const originBlocks = origin.blocks.map(id => targetEditor.byId(id));

    expect(originBlocks.map(block => block?.name)).toEqual(['image']);
    expect(originBlocks[0]?.preservedData).toEqual(IMAGE_DATA);

    // (e) colored cell
    expect(origin.color).toBe('#fbecdd');

    // (c) the list block survives as a list, not flattened text
    const listBlocks = cellAt(saved, 0, 2).blocks.map(id => targetEditor.byId(id));

    expect(listBlocks.map(block => block?.name)).toEqual(['list']);
    expect(listBlocks[0]?.preservedData.text).toBe('alpha');

    // (b) code block + (e) text color and placement + block tunes
    const tail = cellAt(saved, 1, 2);
    const tailBlocks = tail.blocks.map(id => targetEditor.byId(id));

    expect(tailBlocks.map(block => block?.name)).toEqual(['code', 'paragraph']);
    expect(tailBlocks[0]?.preservedData).toEqual(CODE_DATA);
    expect(tailBlocks[1]?.preservedTunes).toEqual({ textAlign: { alignment: 'center' } });
    expect(tail.textColor).toBe('#d44c47');
    expect(tail.placement).toBe('middle-center');
  });
});
