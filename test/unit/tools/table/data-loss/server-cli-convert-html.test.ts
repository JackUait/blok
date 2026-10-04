import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertHtml } from '../../../../../src/cli/commands/convert-html/index';
import { convertGdocs } from '../../../../../src/cli/commands/convert-gdocs/index';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, viewTable, type Booted } from './roundtrip-harness';
import { Image } from '../../../../../src/tools';

const run = (html: string, via: (html: string) => string = convertHtml): OutputData => JSON.parse(via(html)) as OutputData;

const tableOf = (out: OutputData, index = 0): OutputBlockData => out.blocks.filter(b => b.type === 'table')[index];

const cellsOf = (out: OutputData, index = 0): Array<Array<Record<string, unknown>>> =>
  (tableOf(out, index).data as { content: Array<Array<Record<string, unknown>>> }).content;

const textOf = (out: OutputData, id: unknown): string =>
  String((out.blocks.find(b => b.id === id)?.data as { text?: string } | undefined)?.text ?? '');

const allText = (out: OutputData): string => out.blocks.map(b => JSON.stringify(b.data)).join(' ');

describe('CLI --convert-html: table data', () => {
  let booted: Booted | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
  });

  it('keeps a colspan merge', () => {
    const out = run('<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>');
    const origin = cellsOf(out)[0][0];

    expect(origin.colspan).toBe(2);
  });

  it('keeps a rowspan merge', () => {
    const out = run('<table><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></table>');

    expect(cellsOf(out)[0][0].rowspan).toBe(2);
  });

  it('a nested table does not duplicate its rows into the outer table', () => {
    const out = run('<table><tr><td><table><tr><td>inner1</td><td>inner2</td></tr></table></td><td>outer</td></tr></table>');

    expect(cellsOf(out)).toHaveLength(1);
  });

  it('keeps the background of an empty coloured cell', () => {
    const out = run('<table><tr><td style="background-color: #fbecdd"></td><td>x</td></tr></table>');

    expect(cellsOf(out)[0][0].color).not.toBeNull();
  });

  it('keeps a heading column', () => {
    const out = run('<table><tr><th>A</th><td>1</td></tr><tr><th>B</th><td>2</td></tr></table>');

    expect(tableOf(out).data).toMatchObject({ withHeadingColumn: true });
  });

  it('keeps cell text alignment as placement', () => {
    const out = run('<table><tr><td style="text-align: center; vertical-align: middle">c</td></tr></table>');

    expect(cellsOf(out)[0][0].placement).toBe('middle-center');
  });

  it('keeps the table caption text', () => {
    const out = run('<table><caption>Quarterly numbers</caption><tr><td>a</td></tr></table>');

    expect(allText(out)).toContain('Quarterly numbers');
  });

  it('keeps two paragraphs in a cell as two blocks after the editor loads them', async () => {
    const out = run('<table><tr><td><p>first</p><p>second</p></td><td>x</td></tr></table>');

    booted = await boot(out);
    const saved = await booted.editor.save();
    const texts = viewTable(saved)?.grid[0][0].texts ?? [];

    expect(texts.join(' | ')).toMatch(/first.*\|.*second/);
  });

  it('keeps a list in a cell as list items after the editor loads it', async () => {
    const out = run('<table><tr><td><ul><li>one</li><li>two</li></ul></td><td>x</td></tr></table>');

    booted = await boot(out);
    const saved = await booted.editor.save();
    const texts = viewTable(saved)?.grid[0][0].texts ?? [];

    expect(texts.filter(t => t.startsWith('list:'))).toHaveLength(2);
  });

  it('keeps all cell text after the editor loads the output', async () => {
    const out = run('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>');

    booted = await boot(out);
    const saved = await booted.editor.save();
    const texts = (viewTable(saved)?.grid ?? []).flat().flatMap(c => c.texts);

    expect(texts).toEqual(['paragraph:H1', 'paragraph:H2', 'paragraph:a', 'paragraph:b']);
  });

  const cellTexts = (out: OutputData, row = 0, col = 0): string[] =>
    (cellsOf(out)[row][col].blocks as string[]).map(id => textOf(out, id));

  it.each([
    ['the table dir', '<table dir="rtl"><tr><td style="text-align: left">c</td></tr></table>'],
    ['a wrapper dir', '<div dir="rtl"><table><tr><td style="text-align: left">c</td></tr></table></div>'],
    ['the table direction style', '<table style="direction: rtl"><tr><td style="text-align: left">c</td></tr></table>'],
  ])('reads placement right to left from %s', (_name, html) => {
    expect(cellsOf(run(html))[0][0].placement).toBe('top-right');
  });

  it('--convert-gdocs reads placement right to left from the body dir', () => {
    const out = run('<html><body dir="rtl"><table><tr><td style="text-align: left"><p><span>c</span></p></td></tr></table></body></html>', convertGdocs);

    expect(cellsOf(out)[0][0].placement).toBe('top-right');
  });

  it('reads legacy align, valign and bgcolor on a cell', () => {
    const cell = cellsOf(run('<table><tr><td align="center" valign="bottom" bgcolor="#fbecdd">c</td></tr></table>'))[0][0];

    expect(cell.placement).toBe('bottom-center');
    expect(cell.color).toBe('orange');
  });

  it('lets the cell style win over a legacy attribute', () => {
    const cell = cellsOf(run('<table><tr><td align="center" bgcolor="#e7f3f8" style="text-align: right; background-color: #fbecdd">c</td></tr></table>'))[0][0];

    expect(cell.placement).toBe('top-right');
    expect(cell.color).toBe('orange');
  });

  it('ignores a bgcolor that is not a color', () => {
    const cell = cellsOf(run('<table><tr><td bgcolor="red;color:blue">c</td></tr></table>'))[0][0];

    expect(cell.color).toBeNull();
    expect(cell.textColor).toBeNull();
  });

  it('reads the background shorthand on a cell', () => {
    expect(cellsOf(run('<table><tr><td style="background: #fbecdd">c</td></tr></table>'))[0][0].color).toBe('orange');
  });

  it('turns a heading in a cell into its own plain paragraph', () => {
    const out = run('<table><tr><td><h2>Title</h2><p>body</p></td></tr></table>');

    expect(cellTexts(out)).toEqual(['Title', 'body']);
  });

  it('keeps inline marks of a heading in a cell', () => {
    const out = run('<table><tr><td>intro<h3><b>bold</b> head</h3></td></tr></table>');

    expect(cellTexts(out)).toEqual(['intro', '<b>bold</b> head']);
  });

  it('turns a blockquote in a cell into paragraphs', () => {
    expect(cellTexts(run('<table><tr><td><blockquote>Said</blockquote>after</td></tr></table>'))).toEqual(['Said', 'after']);
    expect(cellTexts(run('<table><tr><td><blockquote><p>q1</p><p>q2</p></blockquote></td></tr></table>'))).toEqual(['q1', 'q2']);
  });

  it('carries a paragraph alignment in a cell onto the cell placement', () => {
    const out = run('<table><tr><td><p style="text-align: center">c</p></td><td><p style="text-align:right">r</p><p>&nbsp;</p></td></tr></table>');

    expect(cellsOf(out)[0][0].placement).toBe('top-center');
    expect(cellsOf(out)[0][1].placement).toBe('top-right');
    expect(cellTexts(out)).toEqual(['c']);
  });

  const cellBlocks = (out: OutputData | undefined, row = 0, col = 0): OutputBlockData[] => {
    const blocks = out?.blocks ?? [];
    const table = blocks.find(b => b.type === 'table');
    const ids = (table?.data as { content: Array<Array<{ blocks: string[] }>> } | undefined)?.content[row][col].blocks ?? [];

    return ids.flatMap(id => blocks.filter(b => b.id === id));
  };

  it('splits an image in a cell out of its paragraph, keeping its alt', () => {
    const out = run('<table><tr><td>before <img src="https://x.test/cat.png" alt="a cat"> after</td></tr></table>');

    expect(cellBlocks(out).map(b => b.type === 'image' ? b.data : b.data.text)).toEqual([
      'before ',
      { url: 'https://x.test/cat.png', alt: 'a cat' },
      ' after',
    ]);
  });

  it('keeps the alt of a top-level image', () => {
    const out = run('<img src="https://x.test/cat.png" alt="a cat">');

    expect(out.blocks[0].data).toEqual({ url: 'https://x.test/cat.png', alt: 'a cat' });
  });

  it('an image in a cell keeps its alt after the editor loads and saves it', async () => {
    const out = run('<table><tr><td>before <img src="https://x.test/cat.png" alt="a cat"> after</td></tr></table>');

    booted = await boot(out, { tools: { image: Image } });
    const saved = await booted.editor.save();

    expect(cellBlocks(saved).map(b => b.type === 'image' ? b.data : b.data.text)).toEqual([
      'before ',
      expect.objectContaining({ url: 'https://x.test/cat.png', alt: 'a cat' }),
      ' after',
    ]);
  });

  it('--convert-gdocs keeps a colspan merge', () => {
    const out = run('<table><tbody><tr><td colspan="2"><p><span>wide</span></p></td></tr><tr><td><p><span>a</span></p></td><td><p><span>b</span></p></td></tr></tbody></table>', convertGdocs);

    expect(cellsOf(out)[0][0].colspan).toBe(2);
    expect(textOf(out, (cellsOf(out)[0][0].blocks as string[])[0])).toContain('wide');
  });
});
