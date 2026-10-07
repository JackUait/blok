/**
 * Data-loss hunt: code (and other non-text) blocks in table cells through the
 * clipboard, both directions, in a real Blok.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Code, Column, ColumnList, Header, Image, List } from '../../../../../src/tools';
import { isCellWithBlocks } from '../../../../../src/tools/table/types';
import type { CellContent, TableConfig, TableData } from '../../../../../src/tools/table/types';
import type { BlockToolConstructorOptions, OutputBlockData, OutputData, ToolConstructable, ToolSettings } from '../../../../../types';
import { savedAsHtml } from '../../../helpers/saved-as-html';

interface SelectionRange { minRow: number; maxRow: number; minCol: number; maxCol: number }

interface CellSelectionHandle {
  selectRange: (range: SelectionRange) => void;
}

const tables = new Map<string, Table>();

class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

const selectionOf = (tableId: string): CellSelectionHandle => {
  const table = tables.get(tableId);
  const selection = (table as unknown as { subsystems?: { cellSelectionSubsystem: CellSelectionHandle | null } } | undefined)
    ?.subsystems?.cellSelectionSubsystem;

  if (selection === null || selection === undefined) {
    throw new Error(`no cell selection on ${tableId}`);
  }

  return selection;
};

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let holder: HTMLDivElement;
let blok: TestEditor | null = null;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const ALL_TOOLS: Record<string, ToolConstructable | ToolSettings> = {
  paragraph: Paragraph,
  table: TrackedTable,
  list: List,
  code: Code,
  image: Image,
  header: Header,
};

const boot = async (
  blocks: OutputBlockData[],
  tools: Record<string, ToolConstructable | ToolSettings> = ALL_TOOLS,
): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools, data: { blocks } }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Select a cell range and run the real document copy handler. */
const copyRange = (tableId: string, range: SelectionRange): Record<string, string> => {
  selectionOf(tableId).selectRange(range);

  const store: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string): void => {
        store[type] = value;
      },
      getData: (type: string): string => store[type] ?? '',
    },
  });
  document.dispatchEvent(event);

  return store;
};

const paste = async (target: HTMLElement, data: Record<string, string>): Promise<void> => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  });
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
  await settle();
  await settle();
  await settle(20);
};

const freeEditable = (id: string): HTMLElement => {
  const el = holder.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-element-content] > *`);

  if (el === null) {
    throw new Error(`no editable ${id}`);
  }

  return el;
};

const cellEditable = (tableId: string, row: number, col: number): HTMLElement => {
  const el = holder.querySelector<HTMLElement>(
    `[data-blok-id="${tableId}"] [data-blok-table-cell][data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"] [data-blok-element-content] > *`
  );

  if (el === null) {
    throw new Error(`no cell editable ${tableId} ${row},${col}`);
  }

  return el;
};

const newTable = (saved: OutputData, known: string[]): OutputBlockData => {
  const table = saved.blocks.find(block => block.type === 'table' && !known.includes(block.id ?? ''));

  if (table === undefined) {
    throw new Error(`no pasted table: ${JSON.stringify(saved.blocks.map(b => b.type))}`);
  }

  return table;
};

const cellOf = (table: OutputBlockData, row: number, col: number): CellContent => {
  const cell = (table.data as TableData).content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell;
};

const blocksIn = (saved: OutputData, cell: CellContent): OutputBlockData[] =>
  cell.blocks.map(id => saved.blocks.find(block => block.id === id)).filter((b): b is OutputBlockData => b !== undefined);

const CODE = 'const a = 1;\nconst b = a < 2;';

/** Strips Blok's JSON payload so the HTML reads as it would from another app. */
const asExternalHtml = (html: string): string => html.replace(/ data-blok-table-cells='[^']*'/, '');

const codeTable = (): OutputBlockData[] => [
  { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['k1'] }, { blocks: ['p1'] }]] } },
  { id: 'k1', type: 'code', data: { code: CODE, language: 'javascript' }, parent: 'src' },
  { id: 'p1', type: 'paragraph', data: { text: 'side' }, parent: 'src' },
  { id: 'free', type: 'paragraph', data: { text: '' } },
];

const EXTERNAL_PRE_TABLE = '<table><tbody>'
  + '<tr><td><pre>line one\n  line two</pre></td><td>b</td></tr>'
  + '<tr><td>c</td><td>d</td></tr>'
  + '</tbody></table>';

describe('clipboard data loss: code blocks in table cells', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('copying a cell with a code block puts the code in text/html and text/plain', async () => {
    await boot(codeTable());

    const clip = copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(clip['text/html']).toContain('<pre><code>const a = 1;\nconst b = a &lt; 2;</code></pre>');
    expect(clip['text/plain']).toContain(CODE);
  });

  it('a copied code cell pasted back as a new table stays a code block', async () => {
    const editor = await boot(codeTable());

    await paste(freeEditable('free'), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = savedAsHtml(await editor.save());
    const [first] = blocksIn(saved, cellOf(newTable(saved, ['src']), 0, 0));

    expect(first).toMatchObject({ type: 'code', data: { code: CODE } });
  });

  it('the copied HTML without the Blok payload pastes as a new table with a code block', async () => {
    const editor = await boot(codeTable());
    const clip = copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    await paste(freeEditable('free'), { 'text/html': asExternalHtml(clip['text/html']), 'text/plain': clip['text/plain'] });
    const saved = savedAsHtml(await editor.save());
    const [first] = blocksIn(saved, cellOf(newTable(saved, ['src']), 0, 0));

    expect(first).toMatchObject({ type: 'code', data: { code: CODE } });
  });

  it('the copied HTML without the Blok payload pastes into existing cells as a code block', async () => {
    const editor = await boot([
      ...codeTable(),
      { id: 'dst', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }]] } },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);
    const clip = copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    await paste(cellEditable('dst', 0, 0), { 'text/html': asExternalHtml(clip['text/html']), 'text/plain': clip['text/plain'] });
    const saved = savedAsHtml(await editor.save());
    const [first] = blocksIn(saved, cellOf(saved.blocks.find(block => block.id === 'dst') as OutputBlockData, 0, 0));

    expect(first).toMatchObject({ type: 'code', data: { code: CODE } });
  });

  it('external html: a <pre> in a cell pasted as a NEW table becomes a code block', async () => {
    const editor = await boot([{ id: 'free', type: 'paragraph', data: { text: '' } }]);

    await paste(freeEditable('free'), { 'text/html': EXTERNAL_PRE_TABLE, 'text/plain': '' });
    const saved = savedAsHtml(await editor.save());
    const [first] = blocksIn(saved, cellOf(newTable(saved, []), 0, 0));

    expect(first).toMatchObject({ type: 'code', data: { code: 'line one\n  line two' } });
  });

  it('external html: a <pre> in a cell pasted INTO cells becomes a code block', async () => {
    const editor = await boot([
      { id: 'dst', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }]] } },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);

    await paste(cellEditable('dst', 0, 0), { 'text/html': EXTERNAL_PRE_TABLE, 'text/plain': '' });
    const saved = savedAsHtml(await editor.save());
    const [first] = blocksIn(saved, cellOf(saved.blocks.find(block => block.id === 'dst') as OutputBlockData, 0, 0));

    expect(first).toMatchObject({ type: 'code', data: { code: 'line one\n  line two' } });
  });

  it('external html: without a Code tool, a <pre> in a new table keeps its text as a paragraph', async () => {
    const editor = await boot(
      [{ id: 'free', type: 'paragraph', data: { text: '' } }],
      { paragraph: Paragraph, table: TrackedTable, list: List },
    );

    await paste(freeEditable('free'), { 'text/html': EXTERNAL_PRE_TABLE, 'text/plain': '' });
    const saved = savedAsHtml(await editor.save());
    const blocks = blocksIn(saved, cellOf(newTable(saved, []), 0, 0));

    expect(blocks.map(block => block.type)).toStrictEqual(['paragraph']);
    expect(blocks[0].data.text).toBe('line one<br>  line two');
  });

  it('without a Table tool, a <pre> in a pasted table leaks no stand-in tag', async () => {
    const editor = await boot(
      [{ id: 'free', type: 'paragraph', data: { text: '' } }],
      { paragraph: Paragraph, code: Code },
    );

    await paste(freeEditable('free'), { 'text/html': EXTERNAL_PRE_TABLE, 'text/plain': '' });
    const saved = JSON.stringify(savedAsHtml(await editor.save()));

    expect(saved).not.toContain('blok-cell-code');
    expect(saved).toContain('line one');
  });

  it('a google docs one-row table (pasted as columns) with a <pre> leaks no stand-in tag', async () => {
    const editor = await boot(
      [{ id: 'free', type: 'paragraph', data: { text: '' } }],
      { ...ALL_TOOLS, column_list: ColumnList, column: Column },
    );
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234abcd-7fff-1234-5678-abcdefabcdef">'
      + '<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><tbody>'
      + '<tr><td><pre>line one\n  line two</pre></td><td><p>right</p></td></tr>'
      + '</tbody></table></div></b>';

    await paste(freeEditable('free'), { 'text/html': html, 'text/plain': '' });
    // The column paste fills its columns asynchronously; slow runs (coverage) need the wait.
    await vi.waitFor(async () => {
      expect(JSON.stringify(savedAsHtml(await editor.save()))).toContain('line one');
    }, { timeout: 5000 });
    const saved = savedAsHtml(await editor.save());
    const json = JSON.stringify(saved);

    expect(saved.blocks.some(block => block.type === 'column_list')).toBe(true);
    expect(json).not.toContain('blok-cell-code');
    expect(json).toContain('line one');
  });

  it('a <pre> outside any table still pastes as a top-level code block', async () => {
    const editor = await boot([{ id: 'free', type: 'paragraph', data: { text: '' } }]);

    await paste(freeEditable('free'), { 'text/html': '<pre>top\n  level</pre>', 'text/plain': '' });
    const saved = savedAsHtml(await editor.save());

    expect(saved.blocks.find(block => block.type === 'code')).toMatchObject({ data: { code: 'top\n  level' } });
  });

  it('copying cells with an image, a checklist and a header keeps each in the external flavors', async () => {
    await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['i1'] }, { blocks: ['l1'] }, { blocks: ['h1'] }]] } },
      { id: 'i1', type: 'image', data: { url: 'https://example.com/pic.png' }, parent: 'src' },
      { id: 'l1', type: 'list', data: { text: 'todo', style: 'checklist', checked: true }, parent: 'src' },
      { id: 'h1', type: 'header', data: { text: 'Title', level: 2 }, parent: 'src' },
    ]);

    const clip = copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 });

    expect(clip['text/html']).toContain('<img src="https://example.com/pic.png"');
    expect(clip['text/html']).toMatch(/<input type="checkbox" checked>todo/);
    expect(clip['text/html']).toContain('Title');
    expect(clip['text/plain'].split('\t')).toStrictEqual(['https://example.com/pic.png', 'todo', 'Title']);
  });
});
