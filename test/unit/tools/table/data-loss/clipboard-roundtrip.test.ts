/**
 * Data-loss hunt: copy cells out of a Blok table and paste them back
 * (into a new table, or into another table's cells) through a real Blok.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Bold, Italic, List, Toggle } from '../../../../../src/tools';
import { isCellWithBlocks } from '../../../../../src/tools/table/types';
import type { CellContent, TableConfig, TableData } from '../../../../../src/tools/table/types';
import type { BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../../types';

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

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: TrackedTable, list: List, toggle: Toggle, bold: Bold, italic: Italic },
    data: { blocks },
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Select a cell range and run the real document copy handler. */
const copyRange = (tableId: string, range: SelectionRange, type: 'copy' | 'cut' = 'copy'): Record<string, string> => {
  selectionOf(tableId).selectRange(range);

  const store: Record<string, string> = {};
  const clipboardData = {
    setData: (type: string, value: string): void => {
      store[type] = value;
    },
    getData: (type: string): string => store[type] ?? '',
  };
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
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
    throw new Error('no pasted table');
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

describe('clipboard data loss: Blok cells copied and pasted back', { timeout: 60_000 }, () => {
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

  it('copying a whole headed table and pasting it outside a table keeps the heading row', async () => {
    const editor = await boot([
      {
        id: 'src',
        type: 'table',
        data: {
          withHeadings: true,
          withHeadingColumn: true,
          content: [[{ blocks: ['h1'] }, { blocks: ['h2'] }], [{ blocks: ['b1'] }, { blocks: ['b2'] }]],
        },
      },
      { id: 'h1', type: 'paragraph', data: { text: 'Name' }, parent: 'src' },
      { id: 'h2', type: 'paragraph', data: { text: 'Age' }, parent: 'src' },
      { id: 'b1', type: 'paragraph', data: { text: 'Ann' }, parent: 'src' },
      { id: 'b2', type: 'paragraph', data: { text: '30' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    const clip = copyRange('src', { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    await paste(freeEditable('free'), clip);
    const saved = await editor.save();
    const pasted = newTable(saved, ['src']);

    expect((pasted.data as TableData).withHeadings).toBe(true);
    expect((pasted.data as TableData).withHeadingColumn).toBe(true);
  });

  it('a paragraph with a block text/background color keeps it when cells are pasted outside a table', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'red', textColor: 'red', backgroundColor: 'yellow' }, parent: 'src' },
      { id: 'c2', type: 'paragraph', data: { text: 'plain' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    const before = (await editor.save()).blocks.find(block => block.id === 'c1')?.data;

    expect(before).toMatchObject({ textColor: 'red', backgroundColor: 'yellow' });

    await paste(freeEditable('free'), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = await editor.save();
    const [first] = blocksIn(saved, cellOf(newTable(saved, ['src']), 0, 0));

    expect(first?.data).toMatchObject({ text: 'red', textColor: 'red', backgroundColor: 'yellow' });
  });

  it('a paragraph with a block color keeps it when cells are pasted into another table', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }]] } },
      { id: 'c1', type: 'paragraph', data: { text: 'red', textColor: 'red' }, parent: 'src' },
      { id: 'c2', type: 'paragraph', data: { text: 'plain' }, parent: 'src' },
      { id: 'dst', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }]] } },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);

    await paste(cellEditable('dst', 0, 0), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = await editor.save();
    const dst = saved.blocks.find(block => block.id === 'dst');

    if (dst === undefined) {
      throw new Error('no dst');
    }
    const [first] = blocksIn(saved, cellOf(dst, 0, 0));

    expect(first?.data).toMatchObject({ text: 'red', textColor: 'red' });
  });

  it('an ordered list starting at 5 keeps its start number when cells are pasted outside a table', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['l1', 'l2'] }, { blocks: ['c2'] }]] } },
      { id: 'l1', type: 'list', data: { text: 'five', style: 'ordered', start: 5 }, parent: 'src' },
      { id: 'l2', type: 'list', data: { text: 'six', style: 'ordered' }, parent: 'src' },
      { id: 'c2', type: 'paragraph', data: { text: 'x' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    const before = (await editor.save()).blocks.find(block => block.id === 'l1')?.data;

    expect(before).toMatchObject({ start: 5 });

    await paste(freeEditable('free'), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = await editor.save();
    const [first] = blocksIn(saved, cellOf(newTable(saved, ['src']), 0, 0));

    expect(first?.data).toMatchObject({ text: 'five', style: 'ordered', start: 5 });
  });

  it('a toggle with a child in a cell keeps the child nested and single after copy/paste outside', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['t1'] }, { blocks: ['c2'] }]] } },
      { id: 't1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, parent: 'src', content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'child' }, parent: 't1' },
      { id: 'c2', type: 'paragraph', data: { text: 'x' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    const before = await editor.save();

    expect(before.blocks.find(block => block.id === 'k1')?.parent).toBe('t1');

    await paste(freeEditable('free'), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = await editor.save();
    const pasted = newTable(saved, ['src']);
    const topLevel = blocksIn(saved, cellOf(pasted, 0, 0));
    const childCopies = saved.blocks.filter(block => block.data.text === 'child' && block.id !== 'k1');

    expect(topLevel.map(block => block.type)).toStrictEqual(['toggle']);
    expect(childCopies).toHaveLength(1);
    expect(childCopies[0].parent).toBe(topLevel[0].id);
  });

  it('cutting a cell with a toggle and its child, then pasting outside, keeps the child under the toggle', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['t1'] }, { blocks: ['c2'] }]] } },
      { id: 't1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, parent: 'src', content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'child' }, parent: 't1' },
      { id: 'c2', type: 'paragraph', data: { text: 'x' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    const clip = copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }, 'cut');
    const afterCut = await editor.save();

    // The cut removes the original: no orphan child pointing at a gone toggle.
    const ids = new Set(afterCut.blocks.map(block => block.id));

    expect(afterCut.blocks.filter(block => block.parent !== undefined && !ids.has(block.parent))).toStrictEqual([]);

    await paste(freeEditable('free'), clip);
    const saved = await editor.save();
    const topLevel = blocksIn(saved, cellOf(newTable(saved, ['src']), 0, 0));
    const child = saved.blocks.find(block => block.data.text === 'child');

    expect(topLevel.map(block => block.type)).toStrictEqual(['toggle']);
    expect(child?.parent).toBe(topLevel[0]?.id);
  });

  it('copying only the body row of a headed table pastes outside without a heading row', async () => {
    const editor = await boot([
      {
        id: 'src',
        type: 'table',
        data: {
          withHeadings: true,
          withHeadingColumn: true,
          content: [[{ blocks: ['h1'] }, { blocks: ['h2'] }], [{ blocks: ['b1'] }, { blocks: ['b2'] }]],
        },
      },
      { id: 'h1', type: 'paragraph', data: { text: 'Name' }, parent: 'src' },
      { id: 'h2', type: 'paragraph', data: { text: 'Age' }, parent: 'src' },
      { id: 'b1', type: 'paragraph', data: { text: 'Ann' }, parent: 'src' },
      { id: 'b2', type: 'paragraph', data: { text: '30' }, parent: 'src' },
      { id: 'free', type: 'paragraph', data: { text: '' } },
    ]);

    await paste(freeEditable('free'), copyRange('src', { minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 }));
    const saved = await editor.save();
    const pasted = newTable(saved, ['src']);

    expect((pasted.data as TableData).withHeadings).toBe(false);
    expect((pasted.data as TableData).withHeadingColumn).toBe(false);
  });

  it('a toggle with a child pasted into another table keeps the child under the toggle', async () => {
    const editor = await boot([
      { id: 'src', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['t1'] }, { blocks: ['c2'] }]] } },
      { id: 't1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, parent: 'src', content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'child' }, parent: 't1' },
      { id: 'c2', type: 'paragraph', data: { text: 'x' }, parent: 'src' },
      { id: 'dst', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }]] } },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);

    await paste(cellEditable('dst', 0, 0), copyRange('src', { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }));
    const saved = await editor.save();
    const dst = saved.blocks.find(block => block.id === 'dst');

    if (dst === undefined) {
      throw new Error('no dst');
    }
    const topLevel = blocksIn(saved, cellOf(dst, 0, 0));
    const childCopies = saved.blocks.filter(block => block.data.text === 'child' && block.id !== 'k1');

    expect(topLevel.map(block => block.type)).toStrictEqual(['toggle']);
    expect(childCopies).toHaveLength(1);
    expect(childCopies[0].parent).toBe(topLevel[0].id);

    const toggleHolder = holder.querySelector(`[data-blok-id="${topLevel[0].id}"]`);
    const childHolder = holder.querySelector(`[data-blok-id="${childCopies[0].id ?? ''}"]`);

    expect(childHolder !== null && toggleHolder?.contains(childHolder)).toBe(true);
  });
});
