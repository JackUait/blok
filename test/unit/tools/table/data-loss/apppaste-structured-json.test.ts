/**
 * App-paste data-loss hunt: the dedicated JSON clipboard flavours —
 * buildin.ai `text/next-space-blocks` and Notion `text/_notion-blocks-v3-production`.
 * buildin uses the real captured fixture; Notion/buildin edge shapes are
 * CONSTRUCTED from the parser's documented input shape and say so.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import {
  Bold,
  Code,
  Header,
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

const fixture = (path: string): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures', path), 'utf8');

const TOOLS = {
  paragraph: Paragraph,
  table: Table,
  list: List,
  code: Code,
  header: Header,
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
  let previous = JSON.stringify((await editor.save()).blocks);

  for (let i = 0; i < 40; i++) {
    await settle(25);
    const next = await editor.save();
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

const BUILDIN_PAGE = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../unit/components/modules/paste/fixtures/buildin-next-space-blocks.json'),
  'utf8'
)) as { blocks: Array<{ subTree: Record<string, { type?: number }> }> };

// The real capture, cut down to its one table entry (the page's other blocks need tools this harness does not register).
const BUILDIN = JSON.stringify({
  ...BUILDIN_PAGE,
  blocks: BUILDIN_PAGE.blocks.filter(entry => Object.values(entry.subTree).some(node => node.type === 27)),
});

/** Cell texts of every saved table that some cell of which contains `needle`. */
const tableHolding = (saved: OutputData, needle: string): string[][] | null => {
  for (const table of tables(saved)) {
    const content = (table.data as TableData).content;
    const grid = content.map((row, r) => row.map((_, c) => {
      try {
        return textOfCell(saved, table, r, c);
      } catch {
        return '<missing>';
      }
    }));

    if (grid.flat().some(text => text.includes(needle))) {
      return grid;
    }
  }

  return null;
};

/** The saved table holding `needle` sits after the 'dst' table, at the root, mounted outside its grid. */
const expectOutsideDst = (saved: OutputData, needle: string): void => {
  const table = tables(saved).find(entry => entry.id !== 'dst' && tableHolding({ blocks: [entry, ...saved.blocks.filter(block => block.type !== 'table')] }, needle) !== null);
  const ids = saved.blocks.map(block => block.id);

  expect(table?.parent).toBeUndefined();
  expect(ids.indexOf(table?.id)).toBeGreaterThan(ids.indexOf('c22'));
  expect(holder.querySelector(`[data-blok-id="${table?.id ?? ''}"]`)?.parentElement?.closest('[data-blok-tool="table"]')).toBeNull();
};

const reboot = async (saved: OutputData): Promise<OutputData> => {
  blok?.destroy();
  blok = null;
  holder.innerHTML = '';
  const editor = await boot(saved.blocks);

  return stableSave(editor);
};

const buildinEnvelope = (tableData: Record<string, unknown>, rows: Array<Record<string, unknown>>): string => {
  const subTree: Record<string, unknown> = {
    T: { uuid: 'T', parentId: 'page', type: 27, title: '', backgroundColor: '', textColor: '', data: tableData, subNodes: rows.map((_, i) => `R${i}`) },
  };

  rows.forEach((row, i) => {
    subTree[`R${i}`] = { uuid: `R${i}`, parentId: 'T', type: 28, title: '', backgroundColor: '', textColor: '', data: row, subNodes: [] };
  });

  return JSON.stringify({ blocks: [{ id: 'T', subTree }], pageId: 'page', fromType: 1 });
};

const seg = (text: string): Array<Record<string, unknown>> => [{ text, type: 0, enhancer: {} }];

describe('app paste: structured JSON clipboards', { timeout: 60_000 }, () => {
  lifecycle();

  describe('buildin.ai real fixture', () => {
    it('control: as a new paste the table and its cells land', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/next-space-blocks': BUILDIN, 'text/plain': 'x' });
      const saved = await stableSave(editor);

      expect(tableHolding(saved, 'special')).toStrictEqual([['just', 'a', 'or'], ['table', 'nothing', 'is'], ['special', 'here', 'here?']]);
    });

    it('pasted into a cell of an existing table, the buildin table cells are kept', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/next-space-blocks': BUILDIN, 'text/plain': 'x' });
      const saved = await stableSave(editor);

      expect(tableHolding(saved, 'special')).toStrictEqual([['just', 'a', 'or'], ['table', 'nothing', 'is'], ['special', 'here', 'here?']]);
      expectOutsideDst(saved, 'special');
    });

    it('pasted into a cell of an existing table, the buildin table survives a reload', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/next-space-blocks': BUILDIN, 'text/plain': 'x' });
      const reloaded = await reboot(await stableSave(editor));

      expect(tableHolding(reloaded, 'special')).toStrictEqual([['just', 'a', 'or'], ['table', 'nothing', 'is'], ['special', 'here', 'here?']]);
    });
  });

  describe('buildin.ai real fixture into a cell: where the text ends up', () => {
    it('every cell text is still in the document after a reload', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/next-space-blocks': BUILDIN, 'text/plain': 'x' });
      const reloaded = await reboot(await stableSave(editor));
      const texts = reloaded.blocks.map(block => block.data.text);

      ['just', 'a', 'or', 'table', 'nothing', 'is', 'special', 'here', 'here?'].forEach(text => expect(texts).toContain(text));
    });

    it('the cell texts are rendered (visible in the editor DOM) after the paste', async () => {
      await bootWithTable();

      await paste(editableOf('c00'), { 'text/next-space-blocks': BUILDIN, 'text/plain': 'x' });
      await settle(50);

      expect(holder.textContent).toContain('special');
    });
  });

  describe('buildin.ai constructed shapes', () => {
    it('a table whose format has no tableBlockColumnOrder keeps its cell text', async () => {
      const editor = await bootEmpty();
      const json = buildinEnvelope({ format: { tableBlockRowHeader: true } }, [
        { collectionProperties: { colA: seg('alpha'), colB: seg('beta') } },
        { collectionProperties: { colA: seg('gamma'), colB: seg('delta') } },
      ]);

      await paste(editableOf('p1'), { 'text/next-space-blocks': json, 'text/plain': 'x' });
      const saved = await stableSave(editor);

      expect(allText(saved)).toContain('alpha');
      expect(allText(saved)).toContain('delta');
      expect(tableHolding(saved, 'alpha')).toStrictEqual([['alpha', 'beta'], ['gamma', 'delta']]);
    });

    it('control: a multi-line buildin cell keeps both lines', async () => {
      const editor = await bootEmpty();
      const json = buildinEnvelope({ format: { tableBlockColumnOrder: ['colA', 'colB'] } }, [
        { collectionProperties: { colA: seg('one\ntwo'), colB: seg('') } },
        { collectionProperties: { colA: seg('x'), colB: seg('y') } },
      ]);

      await paste(editableOf('p1'), { 'text/next-space-blocks': json, 'text/plain': 'x' });
      const saved = await stableSave(editor);
      const [table] = tables(saved);

      expect(textOfCell(saved, table, 0, 0)).toBe('one<br>two');
      expect(textOfCell(saved, table, 0, 1)).toBe('');
    });
  });

  describe('notion blocks-v3 (constructed record-map)', () => {
    const notionTable = (): string => {
      const block = (value: Record<string, unknown>): { value: Record<string, unknown> } => ({ value });

      return JSON.stringify({
        blocks: [{
          blockId: 'tbl',
          blockSubtree: {
            block: {
              tbl: block({ id: 'tbl', type: 'table', content: ['r1', 'r2'], format: { table_block_column_order: ['a', 'b'] } }),
              r1: block({ id: 'r1', type: 'table_row', properties: { a: [['red row']], b: [['x']] } }),
              r2: block({ id: 'r2', type: 'table_row', properties: { a: [['plain']], b: [['y']] } }),
            },
          },
        }],
      });
    };

    it('control: a v3 table pastes its cell text', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/_notion-blocks-v3-production': notionTable(), 'text/plain': 'x' });
      const saved = await stableSave(editor);

      expect(tableHolding(saved, 'red row')).toStrictEqual([['red row', 'x'], ['plain', 'y']]);
    });

    it('pasted into a cell of an existing table, the v3 table keeps its grid', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/_notion-blocks-v3-production': notionTable(), 'text/plain': 'x' });
      const saved = await stableSave(editor);

      expect(tableHolding(saved, 'red row')).toStrictEqual([['red row', 'x'], ['plain', 'y']]);
      expectOutsideDst(saved, 'red row');
    });
  });

  describe('blok json (application/x-blok) into a cell', () => {
    it('a copied header leaves the table: saved after it at the root, mounted outside the grid', async () => {
      const editor = await bootWithTable();
      const json = JSON.stringify([{ id: 'h1', tool: 'header', data: { text: 'Title', level: 2 } }]);

      await paste(editableOf('c00'), { 'application/x-blok': json, 'text/plain': 'Title' });
      const saved = await stableSave(editor);
      const header = saved.blocks.find(block => block.type === 'header');
      const ids = saved.blocks.map(block => block.id);

      expect(header?.data.text).toBe('Title');
      expect(header?.parent).toBeUndefined();
      expect(ids.indexOf(header?.id)).toBeGreaterThan(ids.indexOf('c22'));
      expect(holder.querySelector(`[data-blok-id="${header?.id ?? ''}"]`)?.closest('[data-blok-tool="table"]')).toBeNull();
      expect(textOfCell(saved, tables(saved)[0], 0, 0)).toBe('');
    });

    it('control: a copied paragraph stays in the caret cell', async () => {
      const editor = await bootWithTable();
      const json = JSON.stringify([{ id: 'q1', tool: 'paragraph', data: { text: 'inside' } }]);

      await paste(editableOf('c00'), { 'application/x-blok': json, 'text/plain': 'inside' });
      const saved = await stableSave(editor);

      expect(textOfCell(saved, tables(saved)[0], 0, 0)).toBe('|inside');
    });
  });

  describe('notion real html fixture (the path real Notion copies take)', () => {
    // The "Feature" table, cut verbatim out of the captured clipboard HTML.
    const featureTable = (): string => {
      const html = fixture('notion/demo-page.clipboard.html');
      const match = /<table>(?:(?!<\/table>)[\s\S])*?Feature[\s\S]*?<\/table>/.exec(html);

      if (match === null) {
        throw new Error('Feature table not in fixture');
      }

      return match[0];
    };
    const expected = [
      ['Feature', 'CommonMark', 'GitHub Flavored', 'MultiMarkdown', 'Obsidian'],
      ['<strong>Tables</strong>', '❌', '✅', '✅', '✅'],
    ];

    it('as a new table, header and bold cells survive', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/html': featureTable(), 'text/plain': 'Feature' });
      const saved = await stableSave(editor);
      const grid = tableHolding(saved, 'Obsidian');

      expect(grid?.slice(0, 2)).toStrictEqual(expected);
      expect(grid?.length).toBe(6);
    });

    it('into an existing table, header and bold cells survive', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': featureTable(), 'text/plain': 'Feature' });
      const saved = await stableSave(editor);
      const grid = tableHolding(saved, 'Obsidian');

      expect(grid?.slice(0, 2).map(row => row.slice(0, 5))).toStrictEqual(expected);
      expect(grid?.length).toBe(6);
    });
  });
});
