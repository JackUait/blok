/**
 * Cell copy/paste and cell placement driven through a real Blok, so the saved
 * document is what a consumer would store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import {
  Bold,
  Equation,
  InlineCode,
  Italic,
  Link,
  Strikethrough,
  SupSub,
  Underline,
} from '../../../../src/tools';
import { buildClipboardHtml, serializeCellsToClipboard } from '../../../../src/tools/table/table-cell-clipboard';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { CellContent, CellPlacement, TableConfig, TableData } from '../../../../src/tools/table/types';
import type { BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';

interface CellSelectionHandle {
  selectRow: (row: number) => void;
}

interface SubsystemsHandle {
  cellSelectionSubsystem: CellSelectionHandle | null;
}

const tables = new Map<string, Table>();

/** Records every live Table by block id so the test can reach its subsystems. */
class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

const subsystemsOf = (tableId: string): SubsystemsHandle => {
  const table = tables.get(tableId);

  if (table === undefined) {
    throw new Error(`no table ${tableId}`);
  }

  return (table as unknown as { subsystems: SubsystemsHandle }).subsystems;
};

const selectionOf = (tableId: string): CellSelectionHandle => {
  const selection = subsystemsOf(tableId).cellSelectionSubsystem;

  if (selection === null) {
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

const boot = async (data: OutputData, onChange?: () => void): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      table: TrackedTable,
      bold: Bold,
      italic: Italic,
      underline: Underline,
      strikethrough: Strikethrough,
      inlineCode: InlineCode,
      supSub: SupSub,
      equation: Equation,
      link: Link,
    },
    data,
    ...(onChange === undefined ? {} : { onChange }),
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Select row `row` of the table and run the real document copy handler. */
const copyRow = (tableId: string, row: number): string => {
  selectionOf(tableId).selectRow(row);

  const store: Record<string, string> = {};
  const clipboardData = {
    setData: (type: string, value: string): void => {
      store[type] = value;
    },
    getData: (type: string): string => store[type] ?? '',
  };
  const event = new Event('copy', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  document.dispatchEvent(event);

  return store['text/html'] ?? '';
};

const pasteHtml = (target: HTMLElement, html: string): void => {
  const data: Record<string, string> = { 'text/html': html };
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  });
  // jsdom does not reflect contentEditable to an attribute, and an element
  // without it cannot take focus; the grid paste handler reads activeElement.
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
};

const cellEditable = (tableId: string, row: number, col: number): HTMLElement => {
  const editable = holder.querySelector<HTMLElement>(
    `[data-blok-id="${tableId}"] [data-blok-table-cell][data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"] [data-blok-element-content] > *`
  );

  if (editable === null) {
    throw new Error(`no editable at ${tableId} ${row},${col}`);
  }

  return editable;
};

const savedTable = (saved: OutputData, tableId: string): TableData => {
  const block = saved.blocks.find(entry => entry.id === tableId);

  if (block === undefined) {
    throw new Error(`no saved table ${tableId}`);
  }

  return block.data as TableData;
};

const savedCell = (saved: OutputData, tableId: string, row: number, col: number): CellContent => {
  const cell = savedTable(saved, tableId).content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no structured cell at ${tableId} ${row},${col}`);
  }

  return cell;
};

const cellTexts = (saved: OutputData, cell: CellContent): unknown[] =>
  cell.blocks.map(id => saved.blocks.find(entry => entry.id === id)?.data.text);

const cellsTable = (id: string, cells: Array<Array<Partial<CellContent> & { id?: string }>>): OutputBlockData[] => [
  {
    id,
    type: 'table',
    data: {
      withHeadings: false,
      content: cells.map(row => row.map(({ id: cellBlockId, ...cell }) => ({
        blocks: cellBlockId === undefined ? [] : [cellBlockId],
        ...cell,
      }))),
    },
  },
];

const cellParagraph = (id: string, tableId: string, text: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text }, parent: tableId,
});

const MARKED = [
  '<u>u</u>',
  '<s>s</s>',
  '<code>c</code>',
  'x<sup>2</sup>',
  'h<sub>2</sub>o',
  '<span data-latex="a^2">a^2</span>',
  '<a href="#top" target="_self">same page</a>',
  '<a href="https://x.test" target="_blank" rel="noopener noreferrer">out</a>',
].join(' ');

describe('table cells through a real Blok', { timeout: 30_000 }, () => {
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

  describe('copied cells keep the inline marks Blok writes', () => {
    const sourceAndTarget = (text: string): OutputData => ({
      blocks: [
        ...cellsTable('src', [[{ id: 's1' }, { id: 's2' }]]),
        cellParagraph('s1', 'src', text),
        cellParagraph('s2', 'src', 'plain'),
        ...cellsTable('dst', [[{ id: 'd1' }, { id: 'd2' }]]),
        cellParagraph('d1', 'dst', ''),
        cellParagraph('d2', 'dst', ''),
        { id: 'free', type: 'paragraph', data: { text: '' } },
      ],
    });

    it('pasting into another table keeps every mark the source cell saved', async () => {
      const editor = await boot(sourceAndTarget(MARKED));
      const sourceText = cellTexts(await editor.save(), savedCell(await editor.save(), 'src', 0, 0))[0];

      pasteHtml(cellEditable('dst', 0, 0), copyRow('src', 0));
      await settle();

      const saved = await editor.save();

      expect(cellTexts(saved, savedCell(saved, 'dst', 0, 0))).toStrictEqual([sourceText]);
      expect(sourceText).toBe(MARKED);
    });

    it('pasting outside a table keeps every mark the source cell saved', async () => {
      const editor = await boot(sourceAndTarget(MARKED));

      pasteHtml(holder.querySelector<HTMLElement>('[data-blok-id="free"] [data-blok-element-content] > *') ?? holder, copyRow('src', 0));
      await settle();

      const saved = await editor.save();
      const pasted = saved.blocks.find(entry => entry.type === 'table' && entry.id !== 'src' && entry.id !== 'dst');

      if (pasted === undefined || pasted.id === undefined) {
        throw new Error('no pasted table');
      }

      expect(cellTexts(saved, savedCell(saved, pasted.id, 0, 0))).toStrictEqual([MARKED]);
    });

    it('still strips a script, an event handler and a javascript: link', async () => {
      const editor = await boot(sourceAndTarget('ok'));
      const forged = buildClipboardHtml(serializeCellsToClipboard([
        {
          row: 0,
          col: 0,
          blocks: [{
            tool: 'paragraph',
            data: { text: 'ok<script>alert(1)</script><u onclick="y" onerror="z">u</u><a href="javascript:alert(1)">j</a>' },
          }],
        },
        { row: 0, col: 1, blocks: [{ tool: 'paragraph', data: { text: 'b' } }] },
      ]));

      pasteHtml(cellEditable('dst', 0, 0), forged);
      await settle();

      // Read the live cell, not save(): the saver sanitizes again and would hide a leak.
      const rendered = holder.querySelector(
        '[data-blok-id="dst"] [data-blok-table-cell-row="0"][data-blok-table-cell-col="0"]'
      )?.innerHTML ?? '';

      expect(rendered).not.toMatch(/script|onerror|onclick|javascript:/);
      expect(rendered).toContain('<u>u</u>');

      const saved = await editor.save();
      const [text] = cellTexts(saved, savedCell(saved, 'dst', 0, 0));

      expect(text).not.toMatch(/script|onerror|onclick|javascript:/);
    });
  });

  it('a pasted merged cell keeps its placement', async () => {
    const editor = await boot({
      blocks: [
        ...cellsTable('src', [[
          { id: 's1', colspan: 2, placement: 'middle-center' },
          { mergedInto: [0, 0] },
          { id: 's3', placement: 'bottom-right' },
        ]]),
        cellParagraph('s1', 'src', 'merged'),
        cellParagraph('s3', 'src', 'single'),
        ...cellsTable('dst', [[{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]]),
        cellParagraph('d1', 'dst', ''),
        cellParagraph('d2', 'dst', ''),
        cellParagraph('d3', 'dst', ''),
      ],
    });

    pasteHtml(cellEditable('dst', 0, 0), copyRow('src', 0));
    await settle();

    const saved = await editor.save();

    expect(savedCell(saved, 'dst', 0, 0).placement).toBe('middle-center');
    expect(savedCell(saved, 'dst', 0, 0).colspan).toBe(2);
    expect(savedCell(saved, 'dst', 0, 2).placement).toBe('bottom-right');
  });

  it('changing a cell placement reports a change by itself', async () => {
    const onChange = vi.fn();
    const editor = await boot({
      blocks: [
        ...cellsTable('tbl', [[{ id: 'c1' }, { id: 'c2' }]]),
        cellParagraph('c1', 'tbl', 'a'),
        cellParagraph('c2', 'tbl', 'b'),
      ],
    }, onChange);

    await settle(300);
    onChange.mockClear();

    const selection = selectionOf('tbl');
    const cells = Array.from(holder.querySelectorAll<HTMLElement>('[data-blok-id="tbl"] [data-blok-table-cell]'));
    const placementHandler = (selection as unknown as {
      onPlacementChange: (cells: HTMLElement[], placement: CellPlacement) => void;
    }).onPlacementChange;

    placementHandler(cells, 'middle-center');
    await settle(300);

    expect(onChange).toHaveBeenCalledTimes(1);

    const saved = await editor.save();

    expect(savedCell(saved, 'tbl', 0, 0).placement).toBe('middle-center');
  });
});
