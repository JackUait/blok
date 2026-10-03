/**
 * Data-loss hunt: external HTML pasted INTO the cells of an existing table.
 * The table's own grid paste handler takes this path, not the Paste module's
 * Google Docs preprocessor, so marks must survive it on their own.
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
  Marker,
  Strikethrough,
  SupSub,
  Underline,
} from '../../../../../src/tools';
import { isCellWithBlocks } from '../../../../../src/tools/table/types';
import type { TableData } from '../../../../../src/tools/table/types';
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

const ROWS = 3;
const COLS = 2;
const cellId = (row: number, col: number): string => `c${row}${col}`;

const bootWithTable = async (extraTools: Record<string, unknown> = {}): Promise<TestEditor> => {
  const content = Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (__, col) => ({ blocks: [cellId(row, col)] })));
  const cellBlocks = content.flat().map(cell => ({
    id: cell.blocks[0],
    type: 'paragraph',
    data: { text: '' },
    parent: 'dst',
  }));
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      table: Table,
      marker: Marker,
      bold: Bold,
      italic: Italic,
      underline: Underline,
      strikethrough: Strikethrough,
      inlineCode: InlineCode,
      supSub: SupSub,
      link: Link,
      ...extraTools,
    },
    data: { blocks: [{ id: 'dst', type: 'table', data: { withHeadings: false, content } }, ...cellBlocks] },
  }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const pasteIntoCell = async (html: string, plain: string): Promise<void> => {
  const target = holder.querySelector<HTMLElement>(
    '[data-blok-id="dst"] [data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [data-blok-element-content] > *'
  );

  if (target === null) {
    throw new Error('no cell');
  }

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

const cellHtml = (saved: OutputData, row: number, col: number): string => {
  const table = saved.blocks.find(block => block.id === 'dst');
  const cell = (table?.data as TableData | undefined)?.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell.blocks
    .map(id => saved.blocks.find(entry => entry.id === id))
    .map(block => (typeof block?.data.text === 'string' ? block.data.text : ''))
    .join('|');
};

const cellBlocksAt = (saved: OutputData, row: number, col: number): OutputBlockData[] => {
  const table = saved.blocks.find(block => block.id === 'dst');
  const cell = (table?.data as TableData | undefined)?.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell.blocks.map(id => {
    const block = saved.blocks.find(entry => entry.id === id);

    if (block === undefined) {
      throw new Error(`missing block ${id}`);
    }

    return block;
  });
};

const placementAt = (saved: OutputData, row: number, col: number): string | undefined => {
  const table = saved.blocks.find(block => block.id === 'dst');
  const cell = (table?.data as TableData | undefined)?.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell ${row},${col}`);
  }

  return cell.placement;
};

// 2x2 so the grid paste replaces cells instead of inserting inline at the caret.
const tableWithFirstCell = (td: string): string =>
  `<table><tbody><tr><td>${td}</td><td>z</td></tr><tr><td>q</td><td>w</td></tr></tbody></table>`;

const GDOCS_SPAN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;';
const GDOCS_TD = 'border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;';
const gdocsP = (inner: string, align = ''): string =>
  `<p dir="ltr" style="line-height:1.2;${align === '' ? '' : `text-align:${align};`}margin-top:0pt;margin-bottom:0pt;">${inner}</p>`;
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

describe('clipboard data loss: html pasted into cells of an existing table', { timeout: 60_000 }, () => {
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

  const pasteGdocsMarks = async (): Promise<OutputData> => {
    const editor = await bootWithTable();

    await pasteIntoCell(gdocsTable([
      [gdocsP(gdocsSpan('under', 'text-decoration:underline;')), gdocsP(gdocsSpan('struck', 'text-decoration:line-through;'))],
      [gdocsP(`x${gdocsSpan('2', 'vertical-align:super;')}`), gdocsP(`H${gdocsSpan('2', 'vertical-align:sub;')}O`)],
      [
        gdocsP(`<a href="https://example.com/x" style="text-decoration:none;">${gdocsSpan('link', 'color:#1155cc;text-decoration:underline;')}</a>`),
        gdocsP(gdocsSpan('both', 'text-decoration:underline line-through;')),
      ],
    ]), 'under\tstruck\nx2\tH2O\nlink\tboth');

    return editor.save();
  };

  it('google docs: an underlined span stays underlined', async () => {
    expect(cellHtml(await pasteGdocsMarks(), 0, 0)).toMatch(/<u>under<\/u>/);
  });

  it('google docs: a line-through span stays struck through', async () => {
    expect(cellHtml(await pasteGdocsMarks(), 0, 1)).toMatch(/<s>struck<\/s>/);
  });

  it('google docs: vertical-align super / sub spans become sup / sub', async () => {
    const saved = await pasteGdocsMarks();

    expect(cellHtml(saved, 1, 0)).toMatch(/x<sup>2<\/sup>/);
    expect(cellHtml(saved, 1, 1)).toMatch(/H<sub>2<\/sub>O/);
  });

  it('google docs: a link span keeps its link and gains no underline', async () => {
    const html = cellHtml(await pasteGdocsMarks(), 2, 0);

    expect(html).not.toMatch(/<u>/);
    expect(html).toMatch(/<a href="https:\/\/example.com\/x"[^>]*>link<\/a>/);
  });

  it('google docs: underline + line-through on one span keep both marks', async () => {
    const html = cellHtml(await pasteGdocsMarks(), 2, 1);

    expect(html).toMatch(/<u>.*both.*<\/u>/);
    expect(html).toMatch(/<s>.*both.*<\/s>/);
  });

  it('plain u / s / sup / sub tags survive', async () => {
    const editor = await bootWithTable();

    await pasteIntoCell(
      '<table><tbody>'
      + '<tr><td><u>under</u></td><td><s>struck</s></td></tr>'
      + '<tr><td>x<sup>2</sup></td><td>H<sub>2</sub>O</td></tr>'
      + '</tbody></table>',
      'under\tstruck\nx2\tH2O'
    );
    const saved = await editor.save();

    expect(cellHtml(saved, 0, 0)).toMatch(/<u>under<\/u>/);
    expect(cellHtml(saved, 0, 1)).toMatch(/<s>struck<\/s>/);
    expect(cellHtml(saved, 1, 0)).toMatch(/x<sup>2<\/sup>/);
    expect(cellHtml(saved, 1, 1)).toMatch(/H<sub>2<\/sub>O/);
  });

  it('an image in a pasted cell becomes an image block in that cell', async () => {
    const editor = await bootWithTable({ image: Image, code: Code });

    await pasteIntoCell(tableWithFirstCell('a<img src="https://example.com/x.png" alt="x">b'), 'ab\tz\nq\tw');
    const blocks = cellBlocksAt(await editor.save(), 0, 0);

    expect(blocks.find(block => block.type === 'image')?.data).toMatchObject({ url: 'https://example.com/x.png' });
    expect(blocks.find(block => block.type === 'paragraph')?.data.text).toBe('ab');
  });

  it('a raster data: image src is kept', async () => {
    const editor = await bootWithTable({ image: Image, code: Code });
    const src = 'data:image/png;base64,iVBORw0KGgo=';

    await pasteIntoCell(tableWithFirstCell(`<img src="${src}">`), '\tz\nq\tw');
    const blocks = cellBlocksAt(await editor.save(), 0, 0);

    expect(blocks.find(block => block.type === 'image')?.data).toMatchObject({ url: src });
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:text/html', 'data:text/html,<script>alert(1)</script>'],
  ])('an image with a %s src is not kept', async (scheme, src) => {
    const editor = await bootWithTable({ image: Image, code: Code });

    await pasteIntoCell(tableWithFirstCell(`a<img src="${src}">b`), 'ab\tz\nq\tw');
    const saved = await editor.save();

    expect(saved.blocks.some(block => block.type === 'image')).toBe(false);
    expect(JSON.stringify(saved)).not.toContain(scheme);
    expect(cellBlocksAt(saved, 0, 1).map(block => block.data.text)).toEqual(['z']);
  });

  it('a pre in a pasted cell becomes a code block in that cell', async () => {
    const editor = await bootWithTable({ image: Image, code: Code });

    await pasteIntoCell(tableWithFirstCell('<pre><code>const x = 1;\nfoo();</code></pre>'), 'const x = 1;\tz\nq\tw');
    const blocks = cellBlocksAt(await editor.save(), 0, 0);

    expect(blocks.map(block => block.type)).toEqual(['code']);
    expect(blocks[0].data.code).toBe('const x = 1;\nfoo();');
  });

  it('a pre keeps its text when the editor has no code tool', async () => {
    const editor = await bootWithTable();

    await pasteIntoCell(tableWithFirstCell('<pre>a &lt; b</pre>'), 'a < b\tz\nq\tw');
    const saved = await editor.save();

    expect(cellBlocksAt(saved, 0, 0).map(block => block.data.text)).toEqual(['a &lt; b']);
    expect(cellBlocksAt(saved, 0, 1).map(block => block.data.text)).toEqual(['z']);
    expect(saved.blocks.every(block => block.type === 'table' || block.type === 'paragraph')).toBe(true);
  });

  it('google docs: paragraph alignment becomes the cell placement', async () => {
    const editor = await bootWithTable();

    await pasteIntoCell(gdocsTable([
      // The unaligned spacer paragraph is not a vote.
      [gdocsP(gdocsSpan('a'), 'center') + gdocsP('&nbsp;'), gdocsP(gdocsSpan('b'), 'right')],
      [gdocsP(gdocsSpan('c')), gdocsP(gdocsSpan('d'), 'center')],
    ]), 'a\tb\nc\td');
    const saved = await editor.save();

    expect(placementAt(saved, 0, 0)).toBe('top-center');
    expect(placementAt(saved, 0, 1)).toBe('top-right');
    expect(placementAt(saved, 1, 0)).toBeUndefined();
    expect(placementAt(saved, 1, 1)).toBe('top-center');
  });

  it('google docs: paragraphs that disagree leave the placement alone', async () => {
    const editor = await bootWithTable();

    await pasteIntoCell(gdocsTable([
      [gdocsP(gdocsSpan('a'), 'center') + gdocsP(gdocsSpan('b'), 'right'), gdocsP(gdocsSpan('z'))],
      [gdocsP(gdocsSpan('q')), gdocsP(gdocsSpan('w'))],
    ]), 'a\nb\tz\nq\tw');
    const saved = await editor.save();

    expect(placementAt(saved, 0, 0)).toBeUndefined();
    expect(cellHtml(saved, 0, 0)).toContain('a');
  });
});
