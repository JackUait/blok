/**
 * App-paste data-loss hunt: spreadsheet clipboards (Google Sheets, Excel,
 * LibreOffice Calc, TSV-only text) pasted as a new table and into the cells
 * of an existing table.
 *
 * No real spreadsheet capture exists in the repo, so every fixture here is
 * CONSTRUCTED from the documented shape of that app's clipboard HTML:
 * Sheets puts cell formatting on the <td> style, Excel puts it in <style>
 * classes (.xl65 / .font5), LibreOffice Calc uses <font color>, bgcolor and align.
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

type Path = 'new table' | 'existing table';

const pasteVia = async (path: Path, html: string, plain: string): Promise<{ saved: OutputData; table: OutputBlockData }> => {
  const editor = path === 'new table' ? await bootEmpty() : await bootWithTable();

  await paste(editableOf(path === 'new table' ? 'p1' : 'c00'), { 'text/html': html, 'text/plain': plain });
  const saved = await stableSave(editor);
  const table = path === 'new table' ? tables(saved)[0] : saved.blocks.find(block => block.id === 'dst');

  if (table === undefined) {
    throw new Error(`no table: ${JSON.stringify(saved.blocks.map(block => block.type))}`);
  }

  return { saved, table };
};

const cellField = (table: OutputBlockData, row: number, col: number, field: 'color' | 'textColor' | 'placement'): string | undefined => {
  const value = ((table.data as TableData).content[row]?.[col] as Record<string, unknown> | undefined)?.[field];

  return typeof value === 'string' ? value : undefined;
};

const SHEETS_TD = 'overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;';
const sheetsTable = (rows: string[][]): string =>
  '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>'
  + '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">'
  + '<colgroup><col width="100"/><col width="100"/></colgroup><tbody>'
  + rows.map(row => `<tr style="height:21px;">${row.join('')}</tr>`).join('')
  + '</tbody></table></google-sheets-html-origin>';

const SHEETS = sheetsTable([
  [`<td style="${SHEETS_TD}font-weight:bold;">Bold</td>`, `<td style="${SHEETS_TD}font-style:italic;">Italic</td>`],
  [`<td style="${SHEETS_TD}text-decoration:line-through;">Struck</td>`, `<td style="${SHEETS_TD}text-decoration:underline;">Under</td>`],
  [`<td style="${SHEETS_TD}">line1<br>line2</td>`, `<td style="${SHEETS_TD}color:#ff0000;">Red</td>`],
]);
const SHEETS_PLAIN = 'Bold\tItalic\nStruck\tUnder\n"line1\nline2"\tRed';

const EXCEL = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
  + '<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15">'
  + '<style><!--table {mso-displayed-decimal-separator:"\\.";}\n'
  + '.font6 {color:windowtext;font-size:11.0pt;font-weight:700;font-family:Calibri;}\n'
  + 'td {padding-top:1px;color:black;font-size:11.0pt;font-weight:400;font-style:normal;text-align:general;vertical-align:bottom;white-space:nowrap;}\n'
  + '.xl65 {font-weight:700;}\n.xl66 {background:#FFFF00;mso-pattern:black none;}\n.xl67 {color:red;}\n.xl68 {font-style:italic;}\n.xl69 {text-align:center;}\n'
  + '--></style></head><body link="#0563C1" vlink="#954F72">'
  + "<table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse:collapse;width:144pt'><!--StartFragment-->"
  + "<col width=64 span=3 style='width:48pt'>"
  + "<tr height=20 style='height:15.0pt'><td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Bold</td><td class=xl66 width=64 style='width:48pt'>Yellow</td><td class=xl67 width=64 style='width:48pt'>Red</td></tr>"
  + "<tr height=20 style='height:15.0pt'><td height=20 class=xl68 style='height:15.0pt'>Italic</td><td class=xl69>Center</td><td>Normal <font class=\"font6\">run</font></td></tr>"
  + '<!--EndFragment--></table></body></html>';
const EXCEL_PLAIN = 'Bold\tYellow\tRed\nItalic\tCenter\tNormal run';

const CALC = '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><meta name="generator" content="LibreOffice"/></head><body>'
  + '<table cellspacing="0" border="0"><colgroup width="85"></colgroup><colgroup width="85"></colgroup>'
  + '<tr><td height="17" align="left" bgcolor="#FFFF00"><b>Bold</b></td><td align="left"><font color="#FF0000">Red</font></td></tr>'
  + '<tr><td height="17" align="center"><i>It</i></td><td align="left"><u>Under</u></td></tr>'
  + '</table></body></html>';
const CALC_PLAIN = 'Bold\tRed\nIt\tUnder';

describe('app paste: spreadsheet tables', { timeout: 60_000 }, () => {
  lifecycle();

  describe.each<Path>(['new table', 'existing table'])('google sheets (constructed) via %s', (path) => {
    it('td-level bold is kept', async () => {
      const { saved, table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);

      expect(textOfCell(saved, table, 0, 0)).toMatch(/<(b|strong)>Bold<\/(b|strong)>/);
    });

    it('td-level italic is kept', async () => {
      const { saved, table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);

      expect(textOfCell(saved, table, 0, 1)).toMatch(/<(i|em)>Italic<\/(i|em)>/);
    });

    it('td-level line-through is kept', async () => {
      const { saved, table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);

      expect(textOfCell(saved, table, 1, 0)).toMatch(/<(s|del|strike)>Struck<\/(s|del|strike)>/);
    });

    it('td-level underline is kept', async () => {
      const { saved, table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);

      expect(textOfCell(saved, table, 1, 1)).toMatch(/<u>Under<\/u>/);
    });

    it('control: a multi-line cell keeps both lines', async () => {
      const { saved, table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);
      const cell = textOfCell(saved, table, 2, 0);

      expect(cell).toContain('line1');
      expect(cell).toContain('line2');
    });

    it('control: td-level text color is kept', async () => {
      const { table } = await pasteVia(path, SHEETS, SHEETS_PLAIN);

      expect(cellField(table, 2, 1, 'textColor')).toBeDefined();
    });
  });

  describe.each<Path>(['new table', 'existing table'])('excel (constructed) via %s', (path) => {
    it('class-based bold (.xl65) is kept', async () => {
      const { saved, table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(textOfCell(saved, table, 0, 0)).toMatch(/<(b|strong)>Bold<\/(b|strong)>/);
    });

    it('class-based fill (.xl66 background) becomes the cell color', async () => {
      const { table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(cellField(table, 0, 1, 'color')).toBeDefined();
    });

    it('class-based font color (.xl67) becomes the cell text color', async () => {
      const { table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(cellField(table, 0, 2, 'textColor')).toBeDefined();
    });

    it('class-based alignment (.xl69) becomes the cell placement', async () => {
      const { table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(String(cellField(table, 1, 1, 'placement') ?? '')).toMatch(/center/);
    });

    it('a bold rich-text run (<font class=font6>) is kept', async () => {
      const { saved, table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(textOfCell(saved, table, 1, 2)).toMatch(/<(b|strong)>run<\/(b|strong)>/);
    });

    it('control: every cell keeps its text', async () => {
      const { saved, table } = await pasteVia(path, EXCEL, EXCEL_PLAIN);

      expect(textOfCell(saved, table, 0, 0)).toContain('Bold');
      expect(textOfCell(saved, table, 1, 2)).toContain('Normal');
      expect(textOfCell(saved, table, 1, 2)).toContain('run');
    });
  });

  describe.each<Path>(['new table', 'existing table'])('libreoffice calc (constructed) via %s', (path) => {
    it('a <font color> run keeps its color', async () => {
      const { saved, table } = await pasteVia(path, CALC, CALC_PLAIN);

      expect(textOfCell(saved, table, 0, 1)).toMatch(/<mark[^>]*color/);
    });

    it('control: bgcolor, align and b/i/u survive', async () => {
      const { saved, table } = await pasteVia(path, CALC, CALC_PLAIN);

      expect(cellField(table, 0, 0, 'color')).toBeDefined();
      expect(String(cellField(table, 1, 0, 'placement') ?? '')).toMatch(/center/);
      expect(textOfCell(saved, table, 0, 0)).toMatch(/<(b|strong)>Bold/);
      expect(textOfCell(saved, table, 1, 0)).toMatch(/<(i|em)>It/);
      expect(textOfCell(saved, table, 1, 1)).toMatch(/<u>Under/);
    });
  });

  describe('tsv-only clipboard (text/plain, no html)', () => {
    const TSV = 'a\tb\tx<&y\nc\td\n';

    it('into an existing table, tab/newline-separated values spread across cells', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/plain': 'a\tb\nc\td\te\tf\n' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('no dst');
      }

      expect([textOfCell(saved, table, 0, 0), textOfCell(saved, table, 0, 1), textOfCell(saved, table, 1, 0), textOfCell(saved, table, 1, 1)])
        .toStrictEqual(['a', 'b', 'c', 'd']);
      expect((table.data as TableData).content[1]).toHaveLength(4);
      expect([textOfCell(saved, table, 1, 2), textOfCell(saved, table, 1, 3)]).toStrictEqual(['e', 'f']);
      expect(textOfCell(saved, table, 0, 3)).toBe('');
    });

    it('into an existing table, a cell value is kept as text, not markup', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/plain': TSV });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('no dst');
      }

      expect(textOfCell(saved, table, 0, 2)).toBe('x&lt;&amp;y');
    });

    it('control: multi-line text without tabs stays in the one cell', async () => {
      const editor = await bootWithTable();

      await paste(editableOf('c00'), { 'text/plain': 'one\ntwo' });
      const saved = await stableSave(editor);
      const table = saved.blocks.find(block => block.id === 'dst');

      if (table === undefined) {
        throw new Error('no dst');
      }
      const cell = textOfCell(saved, table, 0, 0);

      expect(cell).toContain('one');
      expect(cell).toContain('two');
      expect([textOfCell(saved, table, 0, 1), textOfCell(saved, table, 1, 0)]).toStrictEqual(['', '']);
    });

    it('a top-level paste keeps every character as text and makes no table', async () => {
      const editor = await bootEmpty();

      await paste(editableOf('p1'), { 'text/plain': TSV });
      const saved = await stableSave(editor);

      expect(saved.blocks.map(block => block.type)).not.toContain('table');
      expect(saved.blocks.map(block => block.data.text)).toStrictEqual(['a\tb\tx&lt;&amp;y', 'c\td']);
    });
  });

});
