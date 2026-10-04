/**
 * App-paste data-loss hunt: word-processor clipboards (Microsoft Word,
 * LibreOffice Writer) pasted as a new table and into an existing table.
 *
 * No real capture exists in the repo, so the fixtures are CONSTRUCTED from the
 * documented shape of each app's clipboard HTML: Word writes lists as
 * <p style="mso-list:..."> with <![if !supportLists]> bullet runs and highlights
 * as span background:yellow; Writer writes <p align>, <font color> and bgcolor.
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

const WORD_TD = "width=312 valign=top style='width:233.75pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'";
const wordListP = (cls: string, text: string): string =>
  `<p class=${cls} style='margin-top:0in;margin-right:0in;margin-bottom:0in;margin-left:.25in;mso-add-space:auto;text-indent:-.25in;line-height:normal;mso-list:l0 level1 lfo1'>`
  + "<![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>"
  + `${text}<o:p></o:p></p>`;

const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
  + '<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">'
  + '<style><!--p.MsoNormal {margin:0in;font-size:11.0pt;font-family:"Calibri",sans-serif;}--></style></head><body lang=EN-US style="tab-interval:.5in">'
  + '<!--StartFragment-->'
  + "<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;mso-yfti-tbllook:1184;mso-padding-alt:0in 5.4pt 0in 5.4pt'>"
  + "<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>"
  + `<td ${WORD_TD}><p class=MsoNormal align=center style='margin-bottom:0in;text-align:center;line-height:normal'><b><span style='color:red'>Red bold</span></b><o:p></o:p></p></td>`
  + `<td ${WORD_TD}><p class=MsoNormal style='margin-bottom:0in;line-height:normal'><span style='background:yellow;mso-highlight:yellow'>Highlighted</span><o:p></o:p></p></td>`
  + '</tr>'
  + "<tr style='mso-yfti-irow:1;mso-yfti-lastrow:yes'>"
  + `<td ${WORD_TD}>${wordListP('MsoListParagraphCxSpFirst', 'First')}${wordListP('MsoListParagraphCxSpLast', 'Second')}</td>`
  + `<td ${WORD_TD}><p class=MsoNormal style='margin-bottom:0in;line-height:normal'>Line one<o:p></o:p></p><p class=MsoNormal style='margin-bottom:0in;line-height:normal'>Line two<o:p></o:p></p></td>`
  + '</tr></table>'
  + '<!--EndFragment--></body></html>';
const WORD_PLAIN = 'Red bold\tHighlighted\n·First\n·Second\tLine one\nLine two';

const WRITER = '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><meta name="generator" content="LibreOffice"/></head><body lang="en-US" dir="ltr">'
  + '<table width="100%" cellpadding="4" cellspacing="0"><col width="128*"/><col width="128*"/>'
  + '<tr valign="top"><td width="50%" style="border: 1px solid #000000; padding: 0.1cm" bgcolor="#ffff00"><p align="center"><font color="#ff0000">Red</font></p></td>'
  + '<td width="50%" style="border: 1px solid #000000; padding: 0.1cm"><p><span style="background: #ffff00">Hl</span></p></td></tr>'
  + '<tr valign="top"><td style="border: 1px solid #000000; padding: 0.1cm"><p>a</p></td><td style="border: 1px solid #000000; padding: 0.1cm"><p>b</p></td></tr>'
  + '</table></body></html>';
const WRITER_PLAIN = 'Red\tHl\na\tb';

describe('app paste: word-processor tables', { timeout: 60_000 }, () => {
  lifecycle();

  describe.each<Path>(['new table', 'existing table'])('microsoft word (constructed) via %s', (path) => {
    it('control: bold + red span text, paragraph centering and multi-paragraph cells survive', async () => {
      const { saved, table } = await pasteVia(path, WORD, WORD_PLAIN);

      expect(textOfCell(saved, table, 0, 0)).toMatch(/<(b|strong)>/);
      expect(textOfCell(saved, table, 0, 0)).toContain('Red bold');
      expect(String(cellField(table, 0, 0, 'placement') ?? '')).toMatch(/center/);
      expect(textOfCell(saved, table, 1, 1)).toMatch(/Line one.*Line two/);
    });

    it('a span highlight (background:yellow shorthand) is kept', async () => {
      const { saved, table } = await pasteVia(path, WORD, WORD_PLAIN);

      expect(textOfCell(saved, table, 0, 1)).toMatch(/<mark[^>]*background/);
    });

    it('a Word list in a cell (mso-list paragraphs) becomes list blocks without the bullet glyph', async () => {
      const { saved, table } = await pasteVia(path, WORD, WORD_PLAIN);
      const blocks = blocksOfCell(saved, table, 1, 0);

      expect(blocks.map(block => [block.type, (typeof block.data.text === 'string' ? block.data.text : '').trim()])).toStrictEqual([['list', 'First'], ['list', 'Second']]);
    });
  });

  describe.each<Path>(['new table', 'existing table'])('libreoffice writer (constructed) via %s', (path) => {
    it('control: cell bgcolor and text survive', async () => {
      const { saved, table } = await pasteVia(path, WRITER, WRITER_PLAIN);

      expect(cellField(table, 0, 0, 'color')).toBeDefined();
      expect(textOfCell(saved, table, 0, 0)).toContain('Red');
      expect(textOfCell(saved, table, 1, 1)).toContain('b');
    });

    it('<p align="center"> becomes the cell placement', async () => {
      const { table } = await pasteVia(path, WRITER, WRITER_PLAIN);

      expect(String(cellField(table, 0, 0, 'placement') ?? '')).toMatch(/center/);
    });

    it('a <font color> run keeps its color', async () => {
      const { saved, table } = await pasteVia(path, WRITER, WRITER_PLAIN);

      expect(textOfCell(saved, table, 0, 0)).toMatch(/<mark[^>]*color/);
    });

    it('a span highlight (background shorthand) is kept', async () => {
      const { saved, table } = await pasteVia(path, WRITER, WRITER_PLAIN);

      expect(textOfCell(saved, table, 0, 1)).toMatch(/<mark[^>]*background/);
    });
  });
});
