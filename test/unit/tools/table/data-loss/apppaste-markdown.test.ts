/**
 * App-paste data-loss hunt: GFM markdown tables (the shape AI chat copy
 * buttons and markdown editors put on text/plain; the copy-button payload
 * itself is UNVERIFIED, these are constructed GFM inputs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import {
  Bold,
  Code,
  Image,
  InlineCode,
  Italic,
  Link,
  List,
  Marker,
  Strikethrough,
  SupSub,
  Underline,
} from '../../../../../src/tools';
import { isCellWithBlocks } from '../../../../../src/tools/table/types';
import type { CellContent, TableData } from '../../../../../src/tools/table/types';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { savedAsHtml } from '../../../helpers/saved-as-html';

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


const TOOLS = {
  paragraph: Paragraph,
  table: Table,
  list: List,
  code: Code,
  image: Image,
  marker: Marker,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strikethrough: Strikethrough,
  inlineCode: InlineCode,
  supSub: SupSub,
  link: Link,
};

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools: TOOLS, data: { blocks } }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** One empty paragraph: a paste here builds a NEW table. */
const bootEmpty = (): Promise<TestEditor> => boot([{ id: 'p1', type: 'paragraph', data: { text: '' } }]);

/** A 3x3 table 'dst' with empty cells c00..c22: a paste in c00 goes INTO its cells. */
const bootWithTable = (): Promise<TestEditor> => {
  const content = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (__, col) => ({ blocks: [`c${row}${col}`] })));
  const cells = content.flat().map(cell => ({ id: cell.blocks[0], type: 'paragraph', data: { text: '' }, parent: 'dst' }));

  return boot([{ id: 'dst', type: 'table', data: { withHeadings: false, content } }, ...cells]);
};

const editableOf = (id: string): HTMLElement => {
  const el = holder.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-element-content] > *`);

  if (el === null) {
    throw new Error(`no editable for ${id}`);
  }

  return el;
};

const paste = async (target: HTMLElement, flavors: Record<string, string>): Promise<void> => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => flavors[type] ?? '', types: Object.keys(flavors) },
  });
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
  await settle();
  await settle(20);
};

/** Save until two consecutive saves agree (markdown paste lazy-loads its converter). */
const stableSave = async (editor: TestEditor): Promise<OutputData> => {
  let previous = JSON.stringify((savedAsHtml(await editor.save())).blocks);

  for (let i = 0; i < 40; i++) {
    await settle(25);
    const next = savedAsHtml(await editor.save());
    const json = JSON.stringify(next.blocks);

    if (json === previous && i > 2) {
      return next;
    }
    previous = json;
  }

  return editor.save();
};

const tables = (saved: OutputData): OutputBlockData[] => saved.blocks.filter(block => block.type === 'table');

const cellOf = (saved: OutputData, table: OutputBlockData, row: number, col: number): CellContent & { blocks: string[] } => {
  const cell = (table.data as TableData).content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell;
};

const blocksOfCell = (saved: OutputData, table: OutputBlockData, row: number, col: number): OutputBlockData[] =>
  cellOf(saved, table, row, col).blocks.map(id => {
    const block = saved.blocks.find(entry => entry.id === id);

    if (block === undefined) {
      throw new Error(`missing block ${id}`);
    }

    return block;
  });

const textOfCell = (saved: OutputData, table: OutputBlockData, row: number, col: number): string =>
  blocksOfCell(saved, table, row, col).map(block => (typeof block.data.text === 'string' ? block.data.text : '')).join('|');

/** Every text-ish string anywhere in the saved document. */
const allText = (saved: OutputData): string =>
  saved.blocks.map(block => JSON.stringify(block.data)).join('\n');

const lifecycle = (): void => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });
};

const pastePlain = async (target: HTMLElement, plain: string): Promise<void> => {
  await paste(target, { 'text/plain': plain });
};

const cellField = (table: OutputBlockData, row: number, col: number, field: 'placement'): string | undefined => {
  const value = ((table.data as TableData).content[row]?.[col] as Record<string, unknown> | undefined)?.[field];

  return typeof value === 'string' ? value : undefined;
};

const grid = (saved: OutputData, table: OutputBlockData): string[][] =>
  (table.data as TableData).content.map((row, r) => row.map((_, c) => textOfCell(saved, table, r, c)));

describe('app paste: markdown tables', { timeout: 120_000 }, () => {
  lifecycle();

  it('control: inline marks, escaped pipes, <br> and empty cells survive', async () => {
    const editor = await bootEmpty();

    await pastePlain(editableOf('p1'), [
      '| A | B | C |',
      '| --- | --- | --- |',
      '| **bold** *it* | `code` ~~gone~~ | [link](https://example.com) |',
      '| a \\| b | line1<br>line2 |  |',
    ].join('\n'));
    const saved = await stableSave(editor);
    const [table] = tables(saved);

    const cells = grid(saved, table);

    expect(cells[0]).toStrictEqual(['A', 'B', 'C']);
    expect(cells[1].slice(0, 2)).toStrictEqual(['<strong>bold</strong> <i>it</i>', '<code>code</code> <s>gone</s>']);
    expect(cells[1][2]).toMatch(/^<a href="https:\/\/example\.com"[^>]*>link<\/a>$/);
    expect(cells[2]).toStrictEqual(['a | b', 'line1<br>line2', '']);
  });

  it('column alignment (:---: / ---:) becomes the cell placement', async () => {
    const editor = await bootEmpty();

    await pastePlain(editableOf('p1'), [
      '| Left | Center | Right |',
      '| :--- | :---: | ---: |',
      '| l | c | r |',
    ].join('\n'));
    const saved = await stableSave(editor);
    const [table] = tables(saved);

    expect(String(cellField(table, 1, 1, 'placement') ?? '')).toMatch(/center/);
    expect(String(cellField(table, 1, 2, 'placement') ?? '')).toMatch(/right|end/);
  });

  it('a body row with more cells than the header keeps the extra cell text', async () => {
    const editor = await bootEmpty();

    await pastePlain(editableOf('p1'), [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 | 3 |',
    ].join('\n'));
    const saved = await stableSave(editor);

    expect(allText(saved)).toContain('"3"');
  });

  it('pasted into a cell of an existing table, the markdown table keeps its grid', async () => {
    const editor = await bootWithTable();

    await pastePlain(editableOf('c00'), [
      '| H1 | H2 |',
      '| --- | --- |',
      '| m1 | m2 |',
    ].join('\n'));
    const saved = await stableSave(editor);
    const holding = tables(saved).find(table => grid(saved, table).flat().some(text => text.includes('m2')));

    expect(holding === undefined ? null : grid(saved, holding).flat().filter(Boolean)).toEqual(expect.arrayContaining(['H1', 'H2', 'm1', 'm2']));
  });

  it('pasted into a cell of an existing table, the markdown cell text is still in the document', async () => {
    const editor = await bootWithTable();

    await pastePlain(editableOf('c00'), [
      '| H1 | H2 |',
      '| --- | --- |',
      '| m1 | m2 |',
    ].join('\n'));
    const saved = await stableSave(editor);
    const texts = saved.blocks.map(block => block.data.text);

    ['H1', 'H2', 'm1', 'm2'].forEach(text => expect(texts).toContain(text));
  });
});
