/**
 * Data-loss hunt: tables pasted from other apps through a real Blok.
 * Each test pastes real clipboard HTML and checks the SAVED document.
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
import { blocksToHtml } from '../../../../../src/view';
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

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
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
    },
    data: { blocks },
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const pasteHtml = async (target: HTMLElement, html: string, plain = ''): Promise<void> => {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': plain };
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

const editableOf = (id: string): HTMLElement => {
  const el = holder.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-element-content] > *`);

  if (el === null) {
    throw new Error(`no editable for ${id}`);
  }

  return el;
};

const pastedTable = (saved: OutputData): OutputBlockData => {
  const table = saved.blocks.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error(`no table saved: ${JSON.stringify(saved.blocks.map(b => b.type))}`);
  }

  return table;
};

const cellAt = (saved: OutputData, row: number, col: number): CellContent => {
  const cell = (pastedTable(saved).data as TableData).content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell;
};

const cellBlocks = (saved: OutputData, row: number, col: number): OutputBlockData[] =>
  cellAt(saved, row, col).blocks.map(id => {
    const block = saved.blocks.find(entry => entry.id === id);

    if (block === undefined) {
      throw new Error(`missing block ${id}`);
    }

    return block;
  });

const cellHtml = (saved: OutputData, row: number, col: number): string =>
  cellBlocks(saved, row, col).map(block => (typeof block.data.text === 'string' ? block.data.text : '')).join('|');

const GDOCS_SPAN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;';
const GDOCS_TD = 'border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;';
const gdocsP = (inner: string, extra = ''): string =>
  `<p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;${extra}">${inner}</p>`;
// Real Docs writes each property once; an override replaces the default.
const gdocsSpan = (text: string, extra = ''): string => {
  const props = new Map<string, string>();

  `${GDOCS_SPAN}${extra}`.split(';').filter(Boolean).forEach(decl => {
    const [name, ...value] = decl.split(':');

    props.set(name.trim(), value.join(':'));
  });

  return `<span style="${Array.from(props, ([name, value]) => `${name}:${value}`).join(';')};">${text}</span>`;
};
const gdocsTable = (rows: string[][]): string =>
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234abcd-7fff-1234-5678-abcdefabcdef">'
  + '<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;">'
  + '<colgroup><col width="301"><col width="301"></colgroup><tbody>'
  + rows.map(row => `<tr style="height:0pt">${row.map(cell => `<td style="${GDOCS_TD}">${cell}</td>`).join('')}</tr>`).join('')
  + '</tbody></table></div></b>';

const PLACEMENTS = [['top-right', 'bottom-center'], ['middle-right', undefined]];

// Blok's own /view HTML for a table whose cells carry PLACEMENTS.
const viewTableHtml = (direction: 'ltr' | 'rtl'): string => {
  const ids = PLACEMENTS.map((row, r) => row.map((_, c) => `v${r}${c}`));
  const content = PLACEMENTS.map((row, r) => row.map((placement, c) => ({
    blocks: [ids[r][c]],
    ...(placement === undefined ? {} : { placement }),
  })));
  const text = direction === 'rtl' ? 'نص' : 'text';

  return blocksToHtml({
    blocks: [
      { id: 'vt', type: 'table', data: { withHeadings: false, content }, content: ids.flat() },
      ...ids.flat().map(id => ({ id, type: 'paragraph', parent: 'vt', data: { text } })),
    ],
  }, { direction, root: true });
};

describe('clipboard data loss: external tables pasted through a real Blok', { timeout: 60_000 }, () => {
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

  const gdocsMarks = async (): Promise<OutputData> => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = gdocsTable([
      [gdocsP(gdocsSpan('under', 'text-decoration:underline;')), gdocsP(gdocsSpan('struck', 'text-decoration:line-through;'))],
      [gdocsP(gdocsSpan('red', 'color:#ff0000;')), gdocsP(`<a href="https://example.com/x" style="text-decoration:none;">${gdocsSpan('link', 'color:#1155cc;text-decoration:underline;')}</a>`)],
      [gdocsP(`x${gdocsSpan('2', 'vertical-align:super;')}`), gdocsP(gdocsSpan('plain'))],
    ]);

    await pasteHtml(editableOf('p'), html, 'under\tstruck\nred\tlink\nx2\tplain');

    return savedAsHtml(await editor.save());
  };

  it('google docs: underlined text in a cell stays underlined', async () => {
    expect(cellHtml(await gdocsMarks(), 0, 0)).toMatch(/<u>under<\/u>/);
  });

  it('google docs: struck-through text in a cell stays struck through', async () => {
    expect(cellHtml(await gdocsMarks(), 0, 1)).toMatch(/<s>struck<\/s>/);
  });

  it('google docs: superscript text in a cell stays superscript', async () => {
    expect(cellHtml(await gdocsMarks(), 2, 0)).toMatch(/<sup>2<\/sup>/);
  });

  it('google docs: colored text and links in a cell survive', async () => {
    const saved = await gdocsMarks();

    expect(cellHtml(saved, 1, 0)).toMatch(/<mark[^>]*color/);
    expect(cellHtml(saved, 1, 1)).toMatch(/<a href="https:\/\/example.com\/x"/);
  });

  it('outside tables: google docs underline survives a plain paragraph paste', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234abcd-7fff-1234-5678-abcdefabcdef">'
      + gdocsP(gdocsSpan('under', 'text-decoration:underline;')) + '</b>';

    await pasteHtml(editableOf('p'), html, 'under');
    const saved = savedAsHtml(await editor.save());

    expect(saved.blocks.map(block => block.data.text).join('|')).toMatch(/<u>under<\/u>/);
  });

  it('google docs: cell alignment carried on the inner <p> becomes cell placement', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = gdocsTable([
      [gdocsP(gdocsSpan('centered'), 'text-align:center;'), gdocsP(gdocsSpan('right'), 'text-align:right;')],
      [gdocsP(gdocsSpan('a')), gdocsP(gdocsSpan('b'))],
    ]);

    await pasteHtml(editableOf('p'), html, 'centered\tright\na\tb');
    const saved = savedAsHtml(await editor.save());

    expect(cellHtml(saved, 0, 0)).toBe('centered');
    expect(cellAt(saved, 0, 0).placement).toBe('top-center');
    expect(cellAt(saved, 0, 1).placement).toBe('top-right');
  });

  it.each(['ltr', 'rtl'] as const)('blok /view html (%s): end-side cells keep their placement', async direction => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = viewTableHtml(direction);

    expect(html).toContain('text-align:var(--_blok-end-side, right)');
    await pasteHtml(editableOf('p'), html, 'a\tb\nc\td');
    const saved = savedAsHtml(await editor.save());

    expect(PLACEMENTS.map((row, r) => row.map((_, c) => cellAt(saved, r, c).placement))).toStrictEqual(PLACEMENTS);
  });

  it('web page: an image inside a cell is kept', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody><tr><td>Logo</td><td><img src="https://example.com/logo.png" alt="logo"></td></tr>'
      + '<tr><td>a</td><td>b</td></tr></tbody></table>';

    await pasteHtml(editableOf('p'), html, 'Logo\t\na\tb');
    const saved = savedAsHtml(await editor.save());
    const blocks = cellBlocks(saved, 0, 1);
    expect(blocks[0]).toMatchObject({ type: 'image', data: { url: 'https://example.com/logo.png' } });
  });

  it('web page: a nested table inside a cell does not scramble the outer grid', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><td>A1</td><td><table><tbody><tr><td>n1</td><td>n2</td></tr><tr><td>n3</td><td>n4</td></tr></tbody></table></td></tr>'
      + '<tr><td>B1</td><td>B2</td></tr>'
      + '</tbody></table>';

    await pasteHtml(editableOf('p'), html, 'A1\tn1 n2 n3 n4\nB1\tB2');
    const saved = savedAsHtml(await editor.save());
    const content = (pastedTable(saved).data as TableData).content;

    // The outer table is 2x2: row 1 is B1/B2.
    expect(content.length).toBe(2);
    expect(cellHtml(saved, 1, 0)).toBe('B1');
    expect(cellHtml(saved, 1, 1)).toBe('B2');
  });

  it('html with a heading COLUMN (th per row) keeps the heading column', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><th>Name</th><td>Ann</td></tr>'
      + '<tr><th>Age</th><td>30</td></tr>'
      + '</tbody></table>';

    await pasteHtml(editableOf('p'), html, 'Name\tAnn\nAge\t30');
    const saved = savedAsHtml(await editor.save());
    const data = pastedTable(saved).data as TableData;

    expect(data.withHeadingColumn).toBe(true);
  });

  it('inline code, superscript and bold in a cell survive', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody><tr><td><code>npm i</code></td><td>x<sup>2</sup></td></tr>'
      + '<tr><td><strong>bold</strong></td><td><em>it</em></td></tr></tbody></table>';

    await pasteHtml(editableOf('p'), html, 'npm i\tx2\nbold\tit');
    const saved = savedAsHtml(await editor.save());

    expect(cellHtml(saved, 0, 0)).toMatch(/<code[^>]*>npm i<\/code>/);
    expect(cellHtml(saved, 0, 1)).toMatch(/<sup>2<\/sup>/);
    expect(cellHtml(saved, 1, 0)).toMatch(/<(b|strong)>bold<\/(b|strong)>/);
    expect(cellHtml(saved, 1, 1)).toMatch(/<(i|em)>it<\/(i|em)>/);
  });

  it('word: a checklist / bulleted list in a cell is kept as list blocks', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody><tr><td><ul><li>one</li><li>two</li></ul></td><td>x</td></tr>'
      + '<tr><td>a</td><td>b</td></tr></tbody></table>';

    await pasteHtml(editableOf('p'), html, 'one two\tx\na\tb');
    const saved = savedAsHtml(await editor.save());
    const blocks = cellBlocks(saved, 0, 0);

    expect(blocks.map(block => [block.type, block.data.text])).toStrictEqual([['list', 'one'], ['list', 'two']]);
  });

  it('empty cells and an all-empty row keep the grid shape', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody><tr><td>a</td><td></td><td>c</td></tr>'
      + '<tr><td></td><td></td><td></td></tr>'
      + '<tr><td>g</td><td>h</td><td></td></tr></tbody></table>';

    await pasteHtml(editableOf('p'), html, 'a\t\tc\n\t\t\ng\th\t');
    const saved = savedAsHtml(await editor.save());
    const content = (pastedTable(saved).data as TableData).content;

    expect(content.length).toBe(3);
    expect(content[0].length).toBe(3);
    expect(cellHtml(saved, 0, 2)).toBe('c');
    expect(cellHtml(saved, 2, 1)).toBe('h');
  });

  it('a nested table pasted into a cell of an existing table does not scramble the grid', async () => {
    const editor = await boot([
      {
        id: 'dst',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }], [{ blocks: ['d3'] }, { blocks: ['d4'] }]] },
      },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd3', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd4', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);
    const html = '<table><tbody>'
      + '<tr><td>A1</td><td><table><tbody><tr><td>n1</td><td>n2</td></tr></tbody></table></td></tr>'
      + '<tr><td>B1</td><td>B2</td></tr>'
      + '</tbody></table>';
    const cell = holder.querySelector<HTMLElement>(
      '[data-blok-id="dst"] [data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-element-content] > *'
    );

    if (cell === null) {
      throw new Error('no cell');
    }
    await pasteHtml(cell, html, 'A1\tn1 n2\nB1\tB2');
    const saved = savedAsHtml(await editor.save());

    const texts = saved.blocks.map(block => (typeof block.data.text === 'string' ? block.data.text : ''));

    // No two pasted cells may be glued into one run of text.
    expect(texts.filter(text => /A1n1|n2B1|B1B2/.test(text))).toStrictEqual([]);
    // Row 1 of the paste (B1/B2) lands on row 1 of the table.
    expect(cellHtml(saved, 1, 0)).toBe('B1');
    expect(cellHtml(saved, 1, 1)).toBe('B2');
  });

  it('web page: a nested table keeps its text in the outer cell, one block per nested cell', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><td>A1</td><td><table><thead><tr><th>n1</th><th>n2</th></tr></thead><tbody><tr><td>n3</td><td>n4</td></tr></tbody></table></td></tr>'
      + '<tr><td>B1</td><td>B2</td></tr>'
      + '</tbody></table>';

    await pasteHtml(editableOf('p'), html, 'A1\tn1 n2 n3 n4\nB1\tB2');
    const saved = savedAsHtml(await editor.save());

    expect(cellHtml(saved, 0, 1)).toBe('n1|n2|n3|n4');
    expect(cellHtml(saved, 0, 0)).toBe('A1');
  });

  it('a nested table pasted into a cell of an existing table keeps its text, one block per nested cell', async () => {
    const editor = await boot([
      {
        id: 'dst',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }], [{ blocks: ['d3'] }, { blocks: ['d4'] }]] },
      },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd3', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd4', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);
    const html = '<table><tbody>'
      + '<tr><td>A1</td><td><table><tbody><tr><td>n1</td><td>n2</td></tr></tbody></table></td></tr>'
      + '<tr><td>B1</td><td>B2</td></tr>'
      + '</tbody></table>';
    const cell = holder.querySelector<HTMLElement>(
      '[data-blok-id="dst"] [data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-element-content] > *'
    );

    if (cell === null) {
      throw new Error('no cell');
    }
    await pasteHtml(cell, html, 'A1\tn1 n2\nB1\tB2');
    const saved = savedAsHtml(await editor.save());

    expect(cellHtml(saved, 0, 1)).toBe('n1|n2');
    expect(cellHtml(saved, 0, 0)).toBe('A1');
  });

  it('html with a heading ROW over a td body does not turn on the heading column', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><th>Name</th><th>Age</th></tr>'
      + '<tr><td>Ann</td><td>30</td></tr>'
      + '</tbody></table>';

    await pasteHtml(editableOf('p'), html, 'Name\tAge\nAnn\t30');
    const saved = savedAsHtml(await editor.save());
    const data = pastedTable(saved).data as TableData;

    expect(data.withHeadingColumn).toBe(false);
    expect(data.withHeadings).toBe(true);
  });

  it('google docs: a link is not wrapped in an underline (Docs underlines every link)', async () => {
    expect(cellHtml(await gdocsMarks(), 1, 1)).not.toMatch(/<u>/);
  });

  it('google docs: subscript and underline + line-through on one span survive', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234abcd-7fff-1234-5678-abcdefabcdef">'
      + gdocsP(`H${gdocsSpan('2', 'vertical-align:sub;')}O ${gdocsSpan('both', 'text-decoration:underline line-through;')}`) + '</b>';

    await pasteHtml(editableOf('p'), html, 'H2O both');
    const saved = savedAsHtml(await editor.save());
    const text = saved.blocks.map(block => block.data.text).join('|');

    expect(text).toMatch(/<sub>2<\/sub>/);
    expect(text).toMatch(/<u>.*both.*<\/u>/);
    expect(text).toMatch(/<s>.*both.*<\/s>/);
  });

  const legacyAttrs = async (): Promise<OutputData> => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><td align="center" valign="middle">mid</td><td bgcolor="#ffff00">yellow</td></tr>'
      + '<tr><td>a</td><td>b</td></tr></tbody></table>';

    await pasteHtml(editableOf('p'), html, 'mid\tyellow\na\tb');

    return savedAsHtml(await editor.save());
  };

  it('legacy cell attributes: align/valign become placement', async () => {
    expect(cellAt(await legacyAttrs(), 0, 0).placement).toBe('middle-center');
  });

  it('legacy cell attributes: bgcolor becomes the cell color', async () => {
    expect(cellAt(await legacyAttrs(), 0, 1).color).toBeDefined();
  });

  it('two separate tables pasted while the caret is in a cell keep their cell boundaries', async () => {
    const editor = await boot([
      { id: 'dst', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['d1'] }, { blocks: ['d2'] }]] } },
      { id: 'd1', type: 'paragraph', data: { text: '' }, parent: 'dst' },
      { id: 'd2', type: 'paragraph', data: { text: '' }, parent: 'dst' },
    ]);
    const html = '<table><tbody><tr><td>A1</td><td>A2</td></tr><tr><td>B1</td><td>B2</td></tr></tbody></table>'
      + '<p>between</p>'
      + '<table><tbody><tr><td>C1</td><td>C2</td></tr></tbody></table>';
    const cell = holder.querySelector<HTMLElement>(
      '[data-blok-id="dst"] [data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-element-content] > *'
    );

    if (cell === null) {
      throw new Error('no cell');
    }
    await pasteHtml(cell, html, 'A1\tA2\nB1\tB2\nbetween\nC1\tC2');
    const saved = savedAsHtml(await editor.save());
    const texts = saved.blocks.map(block => (typeof block.data.text === 'string' ? block.data.text : ''));

    expect(texts.filter(text => /A1A2|A2B1|B1B2|C1C2/.test(text))).toStrictEqual([]);
  });

  it('a heading or blockquote in a cell becomes its own paragraph, not glued to the next text', async () => {
    const editor = await boot([{ id: 'p', type: 'paragraph', data: { text: '' } }]);
    const html = '<table><tbody>'
      + '<tr><td><h2>Title</h2><p>body</p></td><td><blockquote><b>Said</b></blockquote>after</td></tr>'
      + '<tr><td>a</td><td>b</td></tr>'
      + '</tbody></table>';

    await pasteHtml(editableOf('p'), html, 'Title body\tSaid after\na\tb');
    const saved = savedAsHtml(await editor.save());

    expect(cellBlocks(saved, 0, 0).map(block => [block.type, block.data.text])).toStrictEqual([
      ['paragraph', 'Title'],
      ['paragraph', 'body'],
    ]);
    expect(cellBlocks(saved, 0, 1).map(block => [block.type, block.data.text])).toStrictEqual([
      ['paragraph', expect.stringMatching(/^<(b|strong)>Said<\/(b|strong)>$/)],
      ['paragraph', 'after'],
    ]);
  });
});
