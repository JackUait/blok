/**
 * App-paste data-loss hunt: AI chat clipboards (ChatGPT / Gemini / Claude)
 * pasted as a new table and into the cells of an existing table.
 * Fixtures are the real captured payloads in test/fixtures/ai-chat.
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
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: API['history'];
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

/** Root-level blocks saved after every block of table `id` (its cells included). */
const rootBlocksAfterTable = (saved: OutputData, id: string): OutputBlockData[] => {
  const lastIndex = saved.blocks.reduce((last, block, index) => (block.id === id || block.parent === id ? index : last), -1);

  return saved.blocks.slice(lastIndex + 1).filter(block => block.parent === undefined);
};

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

// Real ChatGPT inline math markup, copied verbatim from chatgpt-math.html.
const CHATGPT_MATH = '<span data-start="48" data-end="62" role="math" aria-label="x = a^2," data-math-source="x = a^2," data-client-katex-layout=""><span class="katex"><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut"></span><span class="mord mathnormal">x</span><span class="mspace"></span><span class="mrel">=</span><span class="mspace"></span></span><span class="base"><span class="strut"></span><span class="mord"><span class="mord mathnormal">a</span><span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="sizing reset-size6 size3 mtight"><span class="mord mtight">2</span></span></span></span></span></span></span></span><span class="mpunct">,</span></span></span></span></span>';

// Composed from real ChatGPT fragments: its table markup with the math span in a cell.
const chatgptMathTable = (): string =>
  '<div class="markdown prose markdown-new-styling"><table data-start="0" data-end="90"><thead data-start="0" data-end="20"><tr data-start="0" data-end="20">'
  + '<th data-start="0" data-end="10" data-col-size="sm">Formula</th><th data-start="10" data-end="20" data-col-size="sm">Note</th></tr></thead>'
  + '<tbody data-start="21" data-end="90"><tr data-start="21" data-end="90">'
  + `<td data-start="21" data-end="60" data-col-size="sm">${CHATGPT_MATH}</td><td data-start="60" data-end="90" data-col-size="sm">odd square</td>`
  + '</tr></tbody></table></div>';

describe('app paste: AI chat tables', { timeout: 60_000 }, () => {
  lifecycle();

  describe('chatgpt real fixture (intro paragraph + table)', () => {
    const html = fixture('ai-chat/chatgpt-table.html');
    const plain = fixture('ai-chat/chatgpt-table.txt');

    it('control: as a new table, the intro sentence and every cell survive', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);

      expect(allText(saved)).toContain('prominent US stocks');
      const [table] = tables(saved);

      expect(textOfCell(saved, table, 1, 0)).toContain('Nvidia (NVDA)');
      expect(textOfCell(saved, table, 10, 3)).toContain('2.01');
    });

    it('into an existing table, the intro sentence outside the table is not dropped', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);

      expect(allText(saved)).toContain('prominent US stocks');
      const after = rootBlocksAfterTable(saved, 'dst');

      expect(after.map(block => block.type)).toEqual(['paragraph', 'paragraph']);
      expect(String(after[0].data.text)).toContain('prominent US stocks');
      expect(String(after[1].data.text)).toContain('These stocks have been identified');
    });

    it('into an existing table, every cell lands', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 1, 0)).toContain('Nvidia (NVDA)');
      expect(textOfCell(saved, table, 10, 3)).toContain('2.01');
    });
  });

  describe('chatgpt math inside a table cell (composed from real fragments)', () => {
    it('control: as a new table, the cell keeps the TeX source once', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/html': chatgptMathTable(), 'text/plain': 'Formula\tNote\nx=a2,\todd square' });
      const saved = await stableSave(editor);
      const [table] = tables(saved);
      const cell = textOfCell(saved, table, 1, 0);

      expect(cell).toContain('x = a^2,');
      expect(cell).not.toContain('x=a2');
    });

    it('into an existing table, the cell keeps the TeX source once', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': chatgptMathTable(), 'text/plain': 'Formula\tNote\nx=a2,\todd square' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      const cell = textOfCell(saved, table, 1, 0);

      expect(cell).toContain('x = a^2,');
      expect(cell).not.toContain('x=a2');
    });
  });

  describe('gemini real fixture', () => {
    const html = fixture('ai-chat/gemini-response.html');
    const plain = fixture('ai-chat/gemini-response.txt');

    it('control: as a new table, the text before the table survives', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);

      expect(tables(saved).length).toBeGreaterThan(0);
      expect(allText(saved)).toContain('glad the explanation was helpful');
    });

    it('into an existing table, the text before the table is not dropped', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);

      expect(allText(saved)).toContain('glad the explanation was helpful');
    });

    it('into an existing table, the text, code and list land after the table in their original order', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);
      const after = rootBlocksAfterTable(saved, 'dst');
      const types = after.map(block => block.type);

      expect(types[0]).toBe('paragraph');
      expect(String(after[0].data.text)).toContain('glad the explanation was helpful');
      expect(types.indexOf('code')).toBeGreaterThan(0);
      expect(String(after[types.indexOf('code')].data.code)).toContain('SELECT COUNT(*) FROM orders');
      expect(types.indexOf('list')).toBeGreaterThan(types.indexOf('code'));
      expect(allText(saved)).toContain('Same Query');
    });

    it('into an existing table, the cells land and near-black text adds no text colour', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 0, 0)).toContain('order_id');
      expect(textOfCell(saved, table, 1, 0)).toBe('101');
      expect(textOfCell(saved, table, 1, 1)).toBe('50.00');
      expect((table.data as TableData).content.flat().map(cell => (isCellWithBlocks(cell) ? cell.textColor : undefined)).filter(Boolean)).toEqual([]);
    });
  });

  describe('a lone table with app wrappers still pastes as a grid', () => {
    it('Google Docs wrapper, meta and trailing br add no blocks', async () => {
      const editor = await bootWithTable();
      const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b"><div dir="ltr" style="margin-left:0pt;" align="left">'
        + '<table style="border:none;border-collapse:collapse;"><tbody><tr><td><p dir="ltr"><span>A</span></p></td><td><p dir="ltr"><span>B</span></p></td></tr></tbody></table>'
        + '</div><br></b>';

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': 'A\tB' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 0, 0)).toBe('A');
      expect(textOfCell(saved, table, 0, 1)).toBe('B');
      expect(saved.blocks.filter(block => block.parent === undefined).map(block => block.id)).toEqual(['dst']);
    });

    it('a Google Docs one-cell table (a "layout" table at the top level) still pastes into the cell', async () => {
      const editor = await bootWithTable();
      const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-3c4d"><div dir="ltr" align="left">'
        + '<table style="border:none;border-collapse:collapse;"><tbody><tr><td><p dir="ltr"><span>Only</span></p></td></tr></tbody></table>'
        + '</div></b>';

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': 'Only' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 0, 0)).toBe('Only');
      expect(saved.blocks.filter(block => block.parent === undefined).map(block => block.id)).toEqual(['dst']);
    });
  });

  describe('a Google Docs single-column photo table pasted into a cell', () => {
    it('keeps one row per cell (Docs layout unwrapping does not apply inside a table)', async () => {
      const editor = await bootWithTable();
      const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-5e6f"><div dir="ltr" align="left">'
        + '<table style="border:none;border-collapse:collapse;"><tbody>'
        + '<tr><td><p dir="ltr"><span>Top</span></p></td></tr>'
        + '<tr><td><p dir="ltr"><span><img src="https://example.com/photo.png" width="100" height="80"></span></p></td></tr>'
        + '<tr><td><p dir="ltr"><span>Bottom</span></p></td></tr>'
        + '</tbody></table></div></b>';

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': 'Top\n\nBottom' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 0, 0)).toBe('Top');
      expect(textOfCell(saved, table, 2, 0)).toBe('Bottom');
      expect(saved.blocks.filter(block => block.parent === undefined).map(block => block.id)).toEqual(['dst']);
    });
  });

  describe('bare text around a table pasted into a cell', () => {
    it('lands after the table, nothing is dropped and no empty block is left', async () => {
      const editor = await bootWithTable();
      const html = 'Before text<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>After text';

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': 'Before text\nA\tB\nC\tD\nAfter text' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('dst gone');
      }
      expect(textOfCell(saved, table, 1, 1)).toBe('D');
      const after = rootBlocksAfterTable(saved, 'dst');
      const texts = after.map(block => (typeof block.data.text === 'string' ? block.data.text : ''));

      expect(texts.join('\n')).toContain('Before text');
      expect(texts.join('\n')).toContain('After text');
      expect(texts.join('\n').indexOf('Before text')).toBeLessThan(texts.join('\n').indexOf('After text'));
      expect(texts.filter(text => text.trim() === '')).toEqual([]);
    });
  });

  describe('one paste into a cell is one undo step', () => {
    /** Content only: an undone edit keeps its edit stamps, which are metadata. */
    const content = (data: { blocks: OutputBlockData[] }): unknown[] =>
      data.blocks.map(({ lastEditedAt: _at, lastEditedBy: _by, ...block }) => block);

    const html = fixture('ai-chat/gemini-response.html');
    const plain = fixture('ai-chat/gemini-response.txt');

    /** The 3x3 'dst' table with text in every cell, past the capture window. */
    const bootFilledTable = async (): Promise<TestEditor> => {
      const content = Array.from({ length: 3 }, (_, row) =>
        Array.from({ length: 3 }, (__, col) => ({ blocks: [`c${row}${col}`] })));
      const cells = content.flat().map(cell => ({ id: cell.blocks[0], type: 'paragraph', data: { text: `t${cell.blocks[0]}` }, parent: 'dst' }));
      const editor = await boot([{ id: 'dst', type: 'table', data: { withHeadings: false, content } }, ...cells]);

      await settle(700);

      return editor;
    };

    it('one undo after pasting Gemini text + table into a cell restores the document, one redo brings the paste back', async () => {
      const editor = await bootFilledTable();
      const before = await stableSave(editor);

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': plain });
      const pasted = await stableSave(editor);

      expect(allText(pasted)).toContain('glad the explanation was helpful');

      editor.history.undo();
      const undone = await stableSave(editor);

      expect(content(undone)).toEqual(content(before));

      editor.history.redo();
      const redone = await stableSave(editor);

      expect(content(redone)).toEqual(content(pasted));
    });

    it('leftover content that makes no block leaves no empty placeholder, and one undo restores the document', async () => {
      const editor = await bootFilledTable();
      const before = await stableSave(editor);
      const html = '<canvas></canvas><table><tr><td>A</td><td>B</td></tr></table>';

      await paste(editableOf('c00'), { 'text/html': html, 'text/plain': 'A\tB' });
      const pasted = await stableSave(editor);

      // save() skips an empty paragraph, so look at the rendered blocks.
      expect(Array.from(holder.querySelectorAll('[data-blok-id]'), el => el.getAttribute('data-blok-id')).sort()).toEqual(pasted.blocks.map(block => block.id).sort());
      expect(textOfCell(pasted, pasted.blocks[0], 0, 1)).toBe('B');

      editor.history.undo();
      const undone = await stableSave(editor);

      expect(content(undone)).toEqual(content(before));
    });
  });
});
