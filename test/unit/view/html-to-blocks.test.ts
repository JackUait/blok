// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToHtml, blocksToPlainText, htmlToBlocks as htmlToSegmentBlocks, htmlToBlocksWithReport as htmlToSegmentBlocksWithReport } from '../../../src/view';
import type { HtmlImportResult } from '../../../src/view/html-to-blocks';
import { richTextAsHtml } from '../helpers/rich-text-as-html';

import type { OutputBlockData } from '../../../types';
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from '../../../src/components/shared/color-presets';

/**
 * Blocks without their generated ids, so a test asserts shape rather than the
 * id generator's output. `parent` is rewritten to the index of the block it
 * points at, which is what a structural assertion actually cares about.
 * @param blocks - blocks to strip
 */
/** Rich fields read back as HTML; the rich text output tests below pin segments. */
const htmlToBlocks = (html: string): OutputBlockData[] => richTextAsHtml(htmlToSegmentBlocks(html));

const htmlToBlocksWithReport = (html: string): HtmlImportResult => {
  const result = htmlToSegmentBlocksWithReport(html);

  return { ...result, blocks: richTextAsHtml(result.blocks) };
};

const shape = (blocks: OutputBlockData[]): unknown[] => {
  const indexOf = new Map(blocks.map((block, index) => [block.id, index]));

  return blocks.map(({ id: _id, parent, ...rest }) => (
    parent === undefined ? rest : { ...rest, parent: indexOf.get(parent) }
  ));
};

describe('htmlToBlocks — rich text output', () => {
  it('returns paragraph text as segments, entities decoded', () => {
    expect(shape(htmlToSegmentBlocks('<p>a <strong>b</strong> &amp; c</p>'))).toEqual([
      { type: 'paragraph', data: { text: [{ text: 'a ' }, { text: 'b', marks: { bold: true } }, { text: ' & c' }] } },
    ]);
  });

  it('returns segments in every built-in rich field and leaves other fields alone', () => {
    const blocks = htmlToSegmentBlocks('<h2>T</h2><blockquote>q</blockquote><ul><li>i</li></ul><pre><code>&lt;b&gt;</code></pre>');

    expect(shape(blocks)).toEqual([
      { type: 'header', data: { text: [{ text: 'T' }], level: 2 } },
      { type: 'quote', data: expect.objectContaining({ text: [{ text: 'q' }] }) },
      { type: 'list', data: expect.objectContaining({ text: [{ text: 'i' }] }) },
      { type: 'code', data: expect.objectContaining({ code: '<b>' }) },
    ]);
  });
});

describe('htmlToBlocks — structure', () => {
  it('converts headings at every level', () => {
    expect(shape(htmlToBlocks('<h1>One</h1><h3>Three</h3><h6>Six</h6>'))).toEqual([
      { type: 'header', data: { text: 'One', level: 1 } },
      { type: 'header', data: { text: 'Three', level: 3 } },
      { type: 'header', data: { text: 'Six', level: 6 } },
    ]);
  });

  it('keeps inline markup and links inside a paragraph', () => {
    expect(shape(htmlToBlocks('<p>a <b>bold</b> <a href="https://x.dev" rel="nofollow">link</a></p>'))).toEqual([
      { type: 'paragraph', data: { text: 'a <strong>bold</strong> <a href="https://x.dev" rel="nofollow">link</a>' } },
    ]);
  });

  it('imports a page reference without its stale URL or title', () => {
    expect(shape(htmlToBlocks('<p>See <a data-blok-page-id="p1" href="/old-title" title="Old title">Old title</a></p>'))).toEqual([
      { type: 'paragraph', data: { text: 'See <a data-blok-page-id="p1">Page</a>' } },
    ]);
  });

  it('strips an unsafe href while keeping the link text', () => {
    const [block] = htmlToBlocks('<p><a href="javascript:alert(1)">x</a></p>');

    expect(block.data.text).toBe('<a>x</a>');
  });

  it('reads a full document and ignores head markup', () => {
    expect(shape(htmlToBlocks('<!doctype html><html><head><meta charset="utf-8"></head><body><p>hi</p></body></html>')))
      .toEqual([{ type: 'paragraph', data: { text: 'hi' } }]);
  });

  it('unwraps generic containers and converts their children', () => {
    expect(shape(htmlToBlocks('<div><section><p>deep</p><hr></section></div>'))).toEqual([
      { type: 'paragraph', data: { text: 'deep' } },
      { type: 'divider', data: {} },
    ]);
  });

  it('turns a bare text node into a paragraph and drops whitespace-only ones', () => {
    expect(shape(htmlToBlocks('loose\n   \n<p>p</p>'))).toEqual([
      { type: 'paragraph', data: { text: 'loose' } },
      { type: 'paragraph', data: { text: 'p' } },
    ]);
  });

  it('converts a blockquote, joining its paragraphs with a line break', () => {
    expect(shape(htmlToBlocks('<blockquote><p>one</p><p>two</p></blockquote>'))).toEqual([
      { type: 'quote', data: { text: 'one<br>two', size: 'default' } },
    ]);
  });

  it('converts pre/code, reading the language off the class', () => {
    expect(shape(htmlToBlocks('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>'))).toEqual([
      { type: 'code', data: { code: 'const a = 1 < 2;', language: 'typescript' } },
    ]);
  });

  it('reads a figcaption above a pre as the code block\'s filename', () => {
    expect(shape(htmlToBlocks('<figure><figcaption>block.ts</figcaption><pre><code class="language-ts">x</code></pre></figure>'))).toEqual([
      { type: 'code', data: { code: 'x', language: 'typescript', filename: 'block.ts' } },
    ]);
  });

  it('round-trips a code block filename through the view HTML', () => {
    const blocks: OutputBlockData[] = [{ id: 'c1', type: 'code', data: { code: 'a < b', language: 'typescript', filename: 'my "x" <y>.ts' } }];

    expect(shape(htmlToBlocks(blocksToHtml({ blocks })))).toEqual([
      { type: 'code', data: { code: 'a < b', language: 'typescript', filename: 'my "x" <y>.ts' } },
    ]);
  });

  it('adds no filename to a plain pre', () => {
    expect(shape(htmlToBlocks(blocksToHtml({ blocks: [{ id: 'c1', type: 'code', data: { code: 'x', language: 'typescript' } }] })))).toEqual([
      { type: 'code', data: { code: 'x', language: 'typescript' } },
    ]);
  });

  it('falls back to plain text for a pre with no language', () => {
    expect(shape(htmlToBlocks('<pre>raw</pre>'))).toEqual([
      { type: 'code', data: { code: 'raw', language: 'plain text' } },
    ]);
  });

  it('converts a standalone image, a wrapped image and a figure with a caption', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" alt="A">'
      + '<p><img src="https://x.dev/b.png"></p>'
      + '<figure><img src="https://x.dev/c.png"><figcaption>Cee</figcaption></figure>'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', caption: 'A', alt: 'A' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
      { type: 'image', data: { url: 'https://x.dev/c.png', caption: 'Cee', alt: 'Cee' } },
    ]);
  });

  it('converts details into a toggle whose body blocks reference it, dropping the open state', () => {
    expect(shape(htmlToBlocks('<details open><summary>More</summary><p>body</p></details>'))).toEqual([
      { type: 'toggle', data: { text: 'More' } },
      { type: 'paragraph', data: { text: 'body' }, parent: 0 },
    ]);
  });
});

describe('htmlToBlocks — lists', () => {
  it('flattens a nested list, carrying style and depth', () => {
    expect(shape(htmlToBlocks('<ul><li>a<ol><li>b</li></ol></li><li>c</li></ul>'))).toEqual([
      { type: 'list', data: { text: 'a', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'b', style: 'ordered', depth: 1 } },
      { type: 'list', data: { text: 'c', style: 'unordered', depth: 0 } },
    ]);
  });

  it('carries an ordered list start value', () => {
    expect(shape(htmlToBlocks('<ol start="5"><li>a</li><li>b</li></ol>'))).toEqual([
      { type: 'list', data: { text: 'a', style: 'ordered', depth: 0, start: 5 } },
      { type: 'list', data: { text: 'b', style: 'ordered', depth: 0 } },
    ]);
  });

  it('indents a list parsed as a sibling of the item it belongs under', () => {
    expect(shape(htmlToBlocks('<ol><li>A</li><ol><li>B</li><li>C</li></ol></ol>'))).toEqual([
      { type: 'list', data: { text: 'A', style: 'ordered', depth: 0 } },
      { type: 'list', data: { text: 'B', style: 'ordered', depth: 1 } },
      { type: 'list', data: { text: 'C', style: 'ordered', depth: 1 } },
    ]);
  });

  it('indents a sibling list that opens the list, before any item', () => {
    expect(shape(htmlToBlocks('<ul><ul><li>B</li></ul><li>A</li></ul>'))).toEqual([
      { type: 'list', data: { text: 'B', style: 'unordered', depth: 1 } },
      { type: 'list', data: { text: 'A', style: 'unordered', depth: 0 } },
    ]);
  });

  it('carries each sibling list\'s own bullet style', () => {
    expect(shape(htmlToBlocks('<ul><li>A</li><ol><li>B</li></ol><li>C</li><ul><li>D</li></ul></ul>'))).toEqual([
      { type: 'list', data: { text: 'A', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'B', style: 'ordered', depth: 1 } },
      { type: 'list', data: { text: 'C', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'D', style: 'unordered', depth: 1 } },
    ]);
  });

  it('nests sibling lists deeper than one level', () => {
    expect(shape(htmlToBlocks('<ul><li>A</li><ul><li>B</li><ul><li>C</li></ul></ul></ul>'))).toEqual([
      { type: 'list', data: { text: 'A', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'B', style: 'unordered', depth: 1 } },
      { type: 'list', data: { text: 'C', style: 'unordered', depth: 2 } },
    ]);
  });

  it('mixes a sibling list with a properly nested one', () => {
    expect(shape(htmlToBlocks('<ol><li>A<ol><li>B</li></ol></li><ol><li>C</li></ol></ol>'))).toEqual([
      { type: 'list', data: { text: 'A', style: 'ordered', depth: 0 } },
      { type: 'list', data: { text: 'B', style: 'ordered', depth: 1 } },
      { type: 'list', data: { text: 'C', style: 'ordered', depth: 1 } },
    ]);
  });

  it('gives start to the first item of the list that declares it, past a sibling list', () => {
    expect(shape(htmlToBlocks('<ol start="5"><ol><li>B</li></ol><li>A</li></ol>'))).toEqual([
      { type: 'list', data: { text: 'B', style: 'ordered', depth: 1 } },
      { type: 'list', data: { text: 'A', style: 'ordered', depth: 0, start: 5 } },
    ]);
  });

  it('reads a checkbox input as a checklist item', () => {
    expect(shape(htmlToBlocks('<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>')))
      .toEqual([
        { type: 'list', data: { text: 'done', style: 'checklist', depth: 0, checked: true } },
        { type: 'list', data: { text: 'todo', style: 'checklist', depth: 0, checked: false } },
      ]);
  });

  /**
   * An item with neither text nor block children left the lone-paragraph
   * unwrap testing `undefined`, which threw and failed the whole import.
   */
  it('reads an item that carries nothing at all', () => {
    expect(shape(htmlToBlocks('<ul><li>A</li><li></li><li>C</li></ul>'))).toEqual([
      { type: 'list', data: { text: 'A', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: '', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'C', style: 'unordered', depth: 0 } },
    ]);
  });

  it('reads an item holding only whitespace, a break, or a nested list', () => {
    expect(() => htmlToBlocks('<ul><li>  </li></ul>')).not.toThrow();
    expect(() => htmlToBlocks('<ul><li><br></li></ul>')).not.toThrow();
    expect(shape(htmlToBlocks('<ul><li><ul><li>B</li></ul></li></ul>'))).toEqual([
      { type: 'list', data: { text: '', style: 'unordered', depth: 0 } },
      { type: 'list', data: { text: 'B', style: 'unordered', depth: 1 } },
    ]);
  });

  /**
   * A Docs export wraps an image in a sized `span`, which the inline sanitizer
   * strips. An item's text is built from its inline nodes, so the image has to
   * be lifted out of them rather than serialized with them.
   */
  it('keeps an image an item carries in its own text', () => {
    expect(shape(htmlToBlocks(
      '<ul><li>before<span style="display:inline-block"><img src="https://x.dev/a.png"></span>after</li></ul>'
    ))).toEqual([
      { type: 'list', data: { text: 'beforeafter', style: 'unordered', depth: 0 } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
  });

  it('keeps a bare image an item carries', () => {
    expect(shape(htmlToBlocks('<ul><li><img src="https://x.dev/a.png"></li></ul>'))).toEqual([
      { type: 'list', data: { text: '', style: 'unordered', depth: 0 } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
  });
});

describe('htmlToBlocks — tables', () => {
  it('converts a table into a table block plus parented cell blocks', () => {
    expect(shape(htmlToBlocks('<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>')))
      .toEqual([
        {
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [[{ blocks: [expect.any(String)] }], [{ blocks: [expect.any(String)] }]],
          },
        },
        { type: 'paragraph', data: { text: 'H' }, parent: 0 },
        { type: 'paragraph', data: { text: 'c' }, parent: 0 },
      ]);
  });

  it('carries colspan and marks the cells it covers', () => {
    const [table] = htmlToBlocks('<table><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></table>');
    const content = table.data.content as unknown[][];

    expect(content[0][0]).toMatchObject({ colspan: 2 });
    expect(content[0][1]).toMatchObject({ mergedInto: [0, 0] });
    expect(content[1]).toHaveLength(2);
  });

  it('carries rowspan down the column it covers', () => {
    const [table] = htmlToBlocks('<table><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></table>');
    const content = table.data.content as unknown[][];

    expect(content[0][0]).toMatchObject({ rowspan: 2 });
    expect(content[1][0]).toMatchObject({ mergedInto: [0, 0] });
    expect(content[1][1]).toMatchObject({ blocks: [expect.any(String)] });
  });

  it('has no heading row when the table has no thead and only one row', () => {
    const [table] = htmlToBlocks('<table><tr><td>a</td></tr></table>');

    expect(table.data.withHeadings).toBe(false);
  });

  it('marks a heading column when every row opens with a th', () => {
    const [table] = htmlToBlocks('<table><tr><th>a</th><td>1</td></tr><tr><th>b</th><td>2</td></tr></table>');

    expect(table.data.withHeadingColumn).toBe(true);
  });

  it('reads a one-column table of th cells with no thead as a heading column, not a heading row', () => {
    const [table] = htmlToBlocks('<table><tr><th>a</th></tr><tr><th>b</th></tr></table>');

    expect(table.data).toMatchObject({ withHeadings: false, withHeadingColumn: true });
  });

  it('keeps both heading flags when the first row is all th and every row opens with th', () => {
    const [table] = htmlToBlocks('<table><tr><th>a</th><th>b</th></tr><tr><th>x</th><td>1</td></tr></table>');

    expect(table.data).toMatchObject({ withHeadings: true, withHeadingColumn: true });
  });

  it('keeps a first row of th with no thead as a heading row', () => {
    const [table] = htmlToBlocks('<table><tr><th>H</th></tr><tr><td>c</td></tr></table>');

    expect(table.data).toMatchObject({ withHeadings: true, withHeadingColumn: false });
  });

  it('round-trips a one-column table with both heading flags', () => {
    const doc = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: true, withHeadingColumn: true, content: [[{ blocks: ['a'] }], [{ blocks: ['b'] }]] }, content: ['a', 'b'] },
        { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
      ] as OutputBlockData[],
    };
    const [table] = htmlToBlocks(blocksToHtml(doc));

    expect(table.data).toMatchObject({ withHeadings: true, withHeadingColumn: true });
  });

  it('reads cell colours and alignment from the cell style', () => {
    const [table] = htmlToBlocks(
      '<table><tr>'
      + '<td style="background-color: rgb(251, 236, 221); color: #d9730d; text-align: center; vertical-align: middle">a</td>'
      + '<td style="text-align:var(--_blok-end-side, right);vertical-align:bottom">b</td>'
      + '<td style="text-align: right">c</td>'
      + '<td style="background: #EEE; color: var(--Brand-Ink)">d</td>'
      + '</tr></table>'
    );
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row[3]).toMatchObject({ color: '#EEE', textColor: 'var(--Brand-Ink)' });
    expect(row[0]).toMatchObject({ color: 'rgb(251, 236, 221)', textColor: '#d9730d', placement: 'middle-center' });
    expect(row[1]).toMatchObject({ placement: 'bottom-right' });
    expect(row[2]).toMatchObject({ placement: 'top-right' });
  });

  it('adds no style keys for a plain, transparent, top-left or unsafe cell', () => {
    const [table] = htmlToBlocks(
      '<table><tr>'
      + '<td>a</td>'
      + '<td style="background-color: transparent; text-align: left; vertical-align: top">b</td>'
      + '<td style="background-color: url(x); color: expression(1); border-color: red">c</td>'
      + '</tr></table>'
    );
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row).toEqual([
      { blocks: [expect.any(String)] },
      { blocks: [expect.any(String)] },
      { blocks: [expect.any(String)] },
    ]);
  });

  it.each([
    ['#ffffff', '#000000'],
    ['#fff', '#000'],
    ['white', 'black'],
    ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
    ['rgba(255,255,255,1)', 'rgba(0, 0, 0, 1)'],
    ['#FFFFFF', 'BLACK'],
  ])('drops the page-default bg %s and text %s that external tables put on every cell', (background, text) => {
    const [table] = htmlToBlocks(
      '<table><tr>'
      + `<td style="border:solid #000000 1pt;background-color:${background};color:${text};padding:5pt">a</td>`
      + `<td style="background-color:#fbecdd;color:${text}">b</td>`
      + `<td style="background-color:${background};color:#d9730d">c</td>`
      + '</tr></table>'
    );
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row[0]).toEqual({ blocks: [expect.any(String)] });
    expect(row[1]).toEqual({ blocks: [expect.any(String)], color: '#fbecdd' });
    expect(row[2]).toEqual({ blocks: [expect.any(String)], textColor: '#d9730d' });
  });

  it.each([
    ['rgb(31, 31, 31)'],
    ['#202124'],
    ['rgba(40, 40, 40, 1)'],
  ])('drops the near-black body ink %s like the editor paste does', (text) => {
    const [table] = htmlToBlocks(`<table><tr><td style="color:${text}">a</td><td style="color:rgb(41, 41, 41)">b</td></tr></table>`);
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row[0]).toEqual({ blocks: [expect.any(String)] });
    expect(row[1]).toEqual({ blocks: [expect.any(String)], textColor: 'rgb(41, 41, 41)' });
  });

  it('round-trips every light and dark cell colour preset exactly', () => {
    const presets = [...COLOR_PRESETS, ...COLOR_PRESETS_DARK];
    const doc = {
      blocks: [
        {
          id: 't',
          type: 'table',
          data: { withHeadings: false, content: [presets.map((preset, index) => ({ blocks: [`p${index}`], color: preset.bg, textColor: preset.text }))] },
          content: presets.map((_, index) => `p${index}`),
        },
        ...presets.map((_, index) => ({ id: `p${index}`, type: 'paragraph', parent: 't', data: { text: String(index) } })),
      ] as OutputBlockData[],
    };
    const [table] = htmlToBlocks(blocksToHtml(doc));
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row.map((cell) => [cell.color, cell.textColor])).toEqual(presets.map((preset) => [preset.bg, preset.text]));
  });

  it('mirrors physical left and right in a right-to-left table', () => {
    const [table] = htmlToBlocks(
      '<div dir="rtl"><table><tr>'
      + '<td style="text-align: right; vertical-align: middle">a</td>'
      + '<td style="text-align: left">b</td>'
      + '<td style="text-align:var(--_blok-end-side, right)">c</td>'
      + '</tr></table></div>'
    );
    const [row] = table.data.content as Array<Array<Record<string, unknown>>>;

    expect(row[0]).toMatchObject({ placement: 'middle-left' });
    expect(row[1]).toMatchObject({ placement: 'top-right' });
    expect(row[2]).toMatchObject({ placement: 'top-right' });
  });

  it('flattens a table nested behind a wrapper into one block per inner cell, in order, with a warning', () => {
    const report = htmlToBlocksWithReport(
      '<table><tr><td><p>before</p><div><table><tr><td>deep</td><td>er</td></tr></table></div><p>after</p></td></tr></table>'
    );

    expect(shape(report.blocks)).toEqual([
      { type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: [expect.any(String), expect.any(String), expect.any(String), expect.any(String)] }]] } },
      { type: 'paragraph', data: { text: 'before' }, parent: 0 },
      { type: 'paragraph', data: { text: 'deep' }, parent: 0 },
      { type: 'paragraph', data: { text: 'er' }, parent: 0 },
      { type: 'paragraph', data: { text: 'after' }, parent: 0 },
    ]);
    expect(report.warnings.map(({ construct, action }) => ({ construct, action }))).toEqual([{ construct: 'table', action: 'degraded' }]);
  });

  it('reads column widths and stretched only when they fit the grid', () => {
    const [fits] = htmlToBlocks('<table data-blok-col-widths="120,360.5" data-blok-stretched="true"><tr><td>a</td><td>b</td></tr></table>');
    const [wrongCount] = htmlToBlocks('<table data-blok-col-widths="120"><tr><td>a</td><td>b</td></tr></table>');
    const [bad] = htmlToBlocks('<table data-blok-col-widths="120,-1"><tr><td>a</td><td>b</td></tr></table>');

    expect(fits.data).toMatchObject({ colWidths: [120, 360.5], stretched: true });
    expect(wrongCount.data).not.toHaveProperty('colWidths');
    expect(bad.data).not.toHaveProperty('colWidths');
    expect(bad.data).not.toHaveProperty('stretched');
  });
});

describe('htmlToBlocksWithReport — warnings', () => {
  /**
   * @param html - source markup
   */
  const warn = (html: string): { construct: string; action: string }[] =>
    htmlToBlocksWithReport(html).warnings.map(({ construct, action }) => ({ construct, action }));

  it('reports nothing for markup it fully understands', () => {
    expect(htmlToBlocksWithReport('<h1>a</h1><p>b</p><ul><li>c</li></ul>').warnings).toEqual([]);
  });

  it('drops embedded media and reports each one', () => {
    const report = htmlToBlocksWithReport('<p>a</p><iframe src="https://x.dev"></iframe><video src="v.mp4"></video>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'a' } }]);
    expect(report.warnings).toEqual([
      { construct: 'iframe', action: 'dropped', detail: expect.stringContaining('iframe') },
      { construct: 'video', action: 'dropped', detail: expect.stringContaining('video') },
    ]);
  });

  it('reports embedded media dropped from inside a paragraph', () => {
    const report = htmlToBlocksWithReport('<p>before<iframe src="https://x.dev"></iframe>after</p>');

    expect(shape(report.blocks)).toEqual([
      { type: 'paragraph', data: { text: 'before' } },
      { type: 'paragraph', data: { text: 'after' } },
    ]);
    expect(report.warnings).toEqual([
      { construct: 'iframe', action: 'dropped', detail: expect.stringContaining('iframe') },
    ]);
  });

  it('reports a video dropped from inside a paragraph', () => {
    expect(warn('<p>a<video src="v.mp4"></video>b</p>')).toEqual([{ construct: 'video', action: 'dropped' }]);
  });

  it('reports an unknown element dropped from inside a paragraph', () => {
    expect(warn('<p>a<marquee>scrolling</marquee>b</p>')).toEqual([{ construct: 'marquee', action: 'degraded' }]);
  });

  it('drops script and style without reporting them as lost content', () => {
    const report = htmlToBlocksWithReport('<style>p{color:red}</style><script>alert(1)</script><p>a</p>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'a' } }]);
    expect(report.warnings).toEqual([]);
  });

  it('reports a form control it cannot carry', () => {
    expect(warn('<form><input name="a"><button>go</button></form>')).toEqual([
      { construct: 'form', action: 'dropped' },
    ]);
  });

  it('reports a definition list degraded into paragraphs', () => {
    const report = htmlToBlocksWithReport('<dl><dt>Term</dt><dd>Meaning</dd></dl>');

    expect(shape(report.blocks)).toEqual([
      { type: 'paragraph', data: { text: 'Term' } },
      { type: 'paragraph', data: { text: 'Meaning' } },
    ]);
    expect(warn('<dl><dt>Term</dt><dd>Meaning</dd></dl>')).toEqual([{ construct: 'dl', action: 'degraded' }]);
  });

  it('reports an aside, whose callout semantics are not inferred', () => {
    expect(warn('<aside><p>note</p></aside>')).toEqual([{ construct: 'aside', action: 'degraded' }]);
  });

  it('reports a document title it does not import', () => {
    expect(warn('<html><head><title>Doc</title></head><body><p>a</p></body></html>')).toEqual([
      { construct: 'title', action: 'dropped' },
    ]);
  });

  it('reports an unknown element whose content it flattens', () => {
    const report = htmlToBlocksWithReport('<marquee>scrolling</marquee>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'scrolling' } }]);
    expect(report.warnings).toEqual([
      { construct: 'marquee', action: 'degraded', detail: expect.stringContaining('marquee') },
    ]);
  });

  it('reports an image it had to drop for want of a usable source', () => {
    expect(warn('<img alt="none"><img src="javascript:alert(1)">')).toEqual([
      { construct: 'img', action: 'dropped' },
      { construct: 'img', action: 'dropped' },
    ]);
  });

  it('reports a table nested inside a cell', () => {
    const report = htmlToBlocksWithReport('<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>');

    expect(report.warnings).toEqual([
      { construct: 'table', action: 'degraded', detail: expect.stringContaining('nested') },
    ]);
    expect(report.blocks.some((block) => block.type === 'paragraph' && block.data.text === 'inner')).toBe(true);
  });

  it('reports every occurrence, in document order', () => {
    expect(warn('<iframe></iframe><p>a</p><aside>b</aside><iframe></iframe>')).toEqual([
      { construct: 'iframe', action: 'dropped' },
      { construct: 'aside', action: 'degraded' },
      { construct: 'iframe', action: 'dropped' },
    ]);
  });

  it('reports an inline tag whose meaning the sanitizer unwraps away', () => {
    const report = htmlToBlocksWithReport('<p>Press <kbd>K</kbd> or <small>s</small></p>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'Press K or s' } }]);
    expect(report.warnings).toEqual([
      { construct: 'kbd', action: 'degraded', detail: expect.stringContaining('kbd') },
      { construct: 'small', action: 'degraded', detail: expect.stringContaining('small') },
    ]);
  });

  it('keeps sub and sup, which every text block stores', () => {
    const report = htmlToBlocksWithReport('<p>H<sub>2</sub>O and x<sup>2</sup></p>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'H<sub>2</sub>O and x<sup>2</sup>' } }]);
    expect(report.warnings).toEqual([]);
  });

  it('does not report a span, whose text survives unwrapping intact', () => {
    expect(htmlToBlocksWithReport('<p><span class="x">plain</span></p>').warnings).toEqual([]);
  });
});

describe('htmlToBlocks — edges', () => {
  it('returns no blocks for empty or whitespace-only input', () => {
    expect(htmlToBlocks('')).toEqual([]);
    expect(htmlToBlocks('   \n  ')).toEqual([]);
    expect(htmlToBlocksWithReport('').warnings).toEqual([]);
  });

  it('splits a paragraph that mixes prose and an image, keeping both', () => {
    expect(shape(htmlToBlocks('<p>before <img src="https://x.dev/a.png"> after</p>'))).toEqual([
      { type: 'paragraph', data: { text: 'before' } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'paragraph', data: { text: 'after' } },
    ]);
  });

  it('splits a heading that mixes text and an image, keeping both', () => {
    expect(shape(htmlToBlocks('<h2>Title<img src="https://x.dev/a.png"></h2>'))).toEqual([
      { type: 'header', data: { text: 'Title', level: 2 } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
  });

  it('keeps an image wrapped in a link, reporting the link it cannot carry', () => {
    const report = htmlToBlocksWithReport('<p><a href="https://x.dev"><img src="https://x.dev/a.png"></a></p>');

    expect(shape(report.blocks)).toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png' } }]);
    expect(report.warnings).toEqual([
      { construct: 'a', action: 'degraded', detail: expect.stringContaining('link') },
    ]);
  });

  it('keeps an image wrapped in inline markup, and the markup around it', () => {
    const report = htmlToBlocksWithReport('<p><strong>bold <img src="https://x.dev/a.png"></strong></p>');

    expect(shape(report.blocks)).toEqual([
      { type: 'paragraph', data: { text: '<strong>bold </strong>' } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
    expect(report.warnings).toEqual([]);
  });

  /**
   * The wrapper a Google Docs export puts around every image: a sized
   * `inline-block` span, which the inline sanitizer unwraps — taking the image
   * with it before this split ran.
   */
  it('keeps an image wrapped in a sized span, as a Docs export writes it', () => {
    const report = htmlToBlocksWithReport(
      '<p>t<span style="border:none;display:inline-block;overflow:hidden;width:164px;height:321px;">'
      + '<img src="https://lh7-rt.googleusercontent.com/x"></span>u</p>'
    );

    expect(shape(report.blocks)).toEqual([
      { type: 'paragraph', data: { text: 't' } },
      { type: 'image', data: { url: 'https://lh7-rt.googleusercontent.com/x' } },
      { type: 'paragraph', data: { text: 'u' } },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('keeps an image wrapped in nested inline elements', () => {
    expect(shape(htmlToBlocks('<p><a href="https://x.dev"><span><img src="https://x.dev/a.png"></span></a></p>')))
      .toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png' } }]);
  });

  it('keeps a wrapped image in a heading and in a table cell', () => {
    expect(shape(htmlToBlocks('<h2>T<a href="https://x.dev"><img src="https://x.dev/a.png"></a></h2>'))).toEqual([
      { type: 'header', data: { text: 'T', level: 2 } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);

    const cell = shape(htmlToBlocks('<table><tr><td><span><img src="https://x.dev/a.png"></span></td></tr></table>'));

    expect(cell[1]).toEqual({ type: 'image', data: { url: 'https://x.dev/a.png' }, parent: 0 });
  });

  it('leaves an inline run with no image in it serialized whole', () => {
    expect(shape(htmlToBlocks('<p>a <span class="x"><b>b</b> c</span> d</p>'))).toEqual([
      { type: 'paragraph', data: { text: 'a <strong>b</strong> c d' } },
    ]);
  });

  it('emits nothing for a heading with no text', () => {
    expect(shape(htmlToBlocks('<h2></h2><h3>  </h3>'))).toEqual([]);
  });

  it('keeps block content that follows a list item\'s own text', () => {
    expect(shape(htmlToBlocks('<ul><li><p>item</p><pre>code</pre></li></ul>'))).toEqual([
      { type: 'list', data: { text: 'item', style: 'unordered', depth: 0 } },
      { type: 'code', data: { code: 'code', language: 'plain text' } },
    ]);
  });

  it('ignores comments', () => {
    expect(shape(htmlToBlocks('<!-- note --><p>a</p>'))).toEqual([{ type: 'paragraph', data: { text: 'a' } }]);
  });

  it('gives every block a distinct id', () => {
    const ids = htmlToBlocks('<p>a</p><p>b</p><ul><li>c</li></ul>').map((block) => block.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Containers Blok stores as ONE inline field — a quote, a toggle's title, an
 * image's caption. Anything in them that is not text has to leave the field and
 * survive beside it, or be reported.
 */
describe('htmlToBlocks — single-field containers', () => {
  it('keeps an image a blockquote carries, after the quote', () => {
    const report = htmlToBlocksWithReport('<blockquote><p>quoted</p><img src="https://x.dev/a.png"></blockquote>');

    expect(shape(report.blocks)).toEqual([
      { type: 'quote', data: { text: 'quoted', size: 'default' } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('keeps a blockquote that holds nothing but an image', () => {
    expect(shape(htmlToBlocks('<blockquote><img src="https://x.dev/a.png"></blockquote>'))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
  });

  it('keeps an image a blockquote wraps in a sized span', () => {
    expect(shape(htmlToBlocks(
      '<blockquote>quoted<span style="display:inline-block"><img src="https://x.dev/a.png"></span></blockquote>'
    ))).toEqual([
      { type: 'quote', data: { text: 'quoted', size: 'default' } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
  });

  it('reports an iframe inside a blockquote, as it does at block level', () => {
    const report = htmlToBlocksWithReport('<blockquote>said<iframe src="https://y.dev"></iframe></blockquote>');

    expect(shape(report.blocks)).toEqual([{ type: 'quote', data: { text: 'said', size: 'default' } }]);
    expect(report.warnings).toEqual([
      { construct: 'iframe', action: 'dropped', detail: expect.stringContaining('iframe') },
    ]);
  });

  it('keeps an image a toggle summary carries, inside the toggle', () => {
    const report = htmlToBlocksWithReport(
      '<details><summary>S<img src="https://x.dev/s.png"></summary>body</details>'
    );

    expect(shape(report.blocks)).toEqual([
      { type: 'toggle', data: { text: 'S' } },
      { type: 'image', data: { url: 'https://x.dev/s.png' }, parent: 0 },
      { type: 'paragraph', data: { text: 'body' }, parent: 0 },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('keeps a table caption, reported as the prose it becomes', () => {
    const report = htmlToBlocksWithReport(
      '<table><caption>Table 1<img src="https://x.dev/c.png"></caption><tr><td>a</td></tr></table>'
    );

    expect(shape(report.blocks).slice(0, 2)).toEqual([
      { type: 'paragraph', data: { text: 'Table 1' } },
      { type: 'image', data: { url: 'https://x.dev/c.png' } },
    ]);
    expect(report.blocks[2].type).toBe('table');
    expect(report.warnings).toEqual([
      { construct: 'caption', action: 'degraded', detail: expect.stringContaining('caption') },
    ]);
  });

  it('keeps an image a code block carries, after the code', () => {
    const report = htmlToBlocksWithReport('<pre><code>x</code><img src="https://x.dev/a.png"></pre>');

    expect(shape(report.blocks)).toEqual([
      { type: 'code', data: { code: 'x', language: 'plain text' } },
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('keeps an image a figure caption carries, after the figure image', () => {
    const report = htmlToBlocksWithReport(
      '<figure><img src="https://x.dev/a.png"><figcaption>See <img src="https://x.dev/b.png"></figcaption></figure>'
    );

    expect(shape(report.blocks)).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', caption: 'See', alt: 'See' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
    ]);
    expect(report.warnings).toEqual([]);
  });
});

/**
 * The failure this whole converter exists to prevent: content that disappears
 * without the report saying so. When nothing is reported, every word of the
 * source has to be findable in the document that came out.
 */
describe('htmlToBlocks — nothing is lost in silence', () => {
  const article = `
    <article>
      <h1>Release notes</h1>
      <p>Ships <b>today</b>. See <a href="https://x.dev/docs">the docs</a>.</p>
      <h2>Highlights</h2>
      <ul>
        <li>Faster startup
          <ol start="3"><li>colder caches</li></ol>
        </li>
        <li><p>Smaller bundle</p></li>
      </ul>
      <blockquote><p>Measured, not estimated.</p></blockquote>
      <pre><code class="language-js">const ready = true;</code></pre>
      <table>
        <thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead>
        <tbody>
          <tr><td colspan="2">combined</td><td>91</td></tr>
          <tr><td>Bundle</td><td>612kb</td><td>588kb</td></tr>
        </tbody>
      </table>
      <figure><img src="https://x.dev/chart.png"><figcaption>Startup over time</figcaption></figure>
      <details open><summary>Known issues</summary><p>None outstanding.</p></details>
      <hr>
    </article>
  `;

  it('reports nothing for an article built only of constructs it covers', () => {
    expect(htmlToBlocksWithReport(article).warnings).toEqual([]);
  });

  it('carries every word of that article into the document', () => {
    const text = blocksToPlainText({ blocks: htmlToBlocks(article) });
    const words = [
      'Release notes', 'Ships', 'today', 'the docs', 'Highlights', 'Faster startup',
      'colder caches', 'Smaller bundle', 'Measured, not estimated.', 'const ready = true;',
      'Metric', 'Before', 'After', 'combined', '91', 'Bundle', '612kb', '588kb',
      'Startup over time', 'Known issues', 'None outstanding.',
    ];

    for (const word of words) {
      expect(text).toContain(word);
    }
  });

  it('renders back to HTML that still holds the structure it read', () => {
    const html = blocksToHtml({ blocks: htmlToBlocks(article) });

    expect(html).toContain('<h1>Release notes</h1>');
    expect(html).toContain('<a href="https://x.dev/docs">the docs</a>');
    expect(html).toContain('<td colspan="2">');
    expect(html).toContain('<img src="https://x.dev/chart.png"');
    expect(html).toContain('<hr>');
  });
});

describe('htmlToBlocks — image width', () => {
  it('reads a percentage width off the style, rounding it', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="width: 25%;">'
      + '<img src="https://x.dev/b.png" style="max-width: 100%; height: auto; width: 50%">'
      + '<img src="https://x.dev/c.png" style="WIDTH:33.4%">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', width: 25 } },
      { type: 'image', data: { url: 'https://x.dev/b.png', width: 50 } },
      { type: 'image', data: { url: 'https://x.dev/c.png', width: 33 } },
    ]);
  });

  it('reads a percentage width off the legacy width attribute', () => {
    expect(shape(htmlToBlocks('<img src="https://x.dev/a.png" width="40%">')))
      .toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png', width: 40 } }]);
  });

  it('prefers the style width over the attribute', () => {
    expect(shape(htmlToBlocks('<img src="https://x.dev/a.png" width="40%" style="width:60%">')))
      .toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png', width: 60 } }]);
  });

  it('emits no width for a pixel width, on the style or the attribute', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="width: 748px;">'
      + '<img src="https://x.dev/b.png" width="602" height="311">'
      + '<img src="https://x.dev/c.png" style="width: 686.997px; height: 452.286px;">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
      { type: 'image', data: { url: 'https://x.dev/c.png' } },
    ]);
  });

  it('emits no width for a percentage outside the 10–100 the field allows', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="width: 4%">'
      + '<img src="https://x.dev/b.png" style="width: 139%">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
    ]);
  });

  it('emits no width for a style it cannot read', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="width: auto">'
      + '<img src="https://x.dev/b.png" style="width=">'
      + '<img src="https://x.dev/c.png" style="">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
      { type: 'image', data: { url: 'https://x.dev/c.png' } },
    ]);
  });

  it('keeps the width on an image a figure or a paragraph carries', () => {
    expect(shape(htmlToBlocks(
      '<figure><img src="https://x.dev/a.png" style="width:50%"><figcaption>Cee</figcaption></figure>'
      + '<p>t<span style="display:inline-block;width:164px"><img src="https://x.dev/b.png" style="width:25%"></span></p>'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', caption: 'Cee', alt: 'Cee', width: 50 } },
      { type: 'paragraph', data: { text: 't' } },
      { type: 'image', data: { url: 'https://x.dev/b.png', width: 25 } },
    ]);
  });
});

describe('htmlToBlocks — image alignment', () => {
  it('reads a float off the style', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="margin-left: 0px; float: right;">'
      + '<img src="https://x.dev/b.png" style="float:left">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', alignment: 'right' } },
      { type: 'image', data: { url: 'https://x.dev/b.png', alignment: 'left' } },
    ]);
  });

  it('centres an image whose side margins are both auto', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="margin: 0 auto">'
      + '<img src="https://x.dev/b.png" style="padding: 0px; margin: 20px auto 25px; display: block; width: 748px;">'
      + '<img src="https://x.dev/c.png" style="margin-left: auto; margin-right: auto;">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', alignment: 'center' } },
      { type: 'image', data: { url: 'https://x.dev/b.png', alignment: 'center' } },
      { type: 'image', data: { url: 'https://x.dev/c.png', alignment: 'center' } },
    ]);
  });

  it('pushes an image with one auto side margin to the other side', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="margin-left: auto">'
      + '<img src="https://x.dev/b.png" style="margin: 0 0 0 auto">'
      + '<img src="https://x.dev/c.png" style="margin-right: auto">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', alignment: 'right' } },
      { type: 'image', data: { url: 'https://x.dev/b.png', alignment: 'right' } },
      { type: 'image', data: { url: 'https://x.dev/c.png', alignment: 'left' } },
    ]);
  });

  it('reads the legacy align attribute when no style carries the alignment', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" align="center">'
      + '<img src="https://x.dev/b.png" align="RIGHT">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png', alignment: 'center' } },
      { type: 'image', data: { url: 'https://x.dev/b.png', alignment: 'right' } },
    ]);
  });

  it('lets the style win over the legacy align attribute', () => {
    expect(shape(htmlToBlocks('<img src="https://x.dev/a.png" align="center" style="float:left">')))
      .toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png', alignment: 'left' } }]);
  });

  it('emits no alignment for an align value the field has no room for', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" align="middle">'
      + '<img src="https://x.dev/b.png" align="justify">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
    ]);
  });

  it('emits no alignment for margins that pin no side', () => {
    expect(shape(htmlToBlocks(
      '<img src="https://x.dev/a.png" style="margin-left:0px;margin-top:0px;">'
      + '<img src="https://x.dev/b.png" style="margin: 20px 10px; float: none;">'
      + '<img src="https://x.dev/c.png">'
    ))).toEqual([
      { type: 'image', data: { url: 'https://x.dev/a.png' } },
      { type: 'image', data: { url: 'https://x.dev/b.png' } },
      { type: 'image', data: { url: 'https://x.dev/c.png' } },
    ]);
  });

  it('keeps width and alignment together on one image', () => {
    expect(shape(htmlToBlocks('<figure><img src="https://x.dev/a.png" style="width:25%;margin:0 auto" alt="A"></figure>')))
      .toEqual([{ type: 'image', data: { url: 'https://x.dev/a.png', caption: 'A', alt: 'A', width: 25, alignment: 'center' } }]);
  });
});

describe('htmlToBlocks — tabs', () => {
  it('rebuilds tabs with each tab\'s title, icon and content', () => {
    expect(shape(htmlToBlocks(
      '<div data-blok-tabs>'
      + '<section data-blok-tab><h4 data-blok-tab-title><span data-blok-tab-icon>🍎</span> First &amp; &lt;One&gt;</h4><p>A</p></section>'
      + '<section data-blok-tab><h4 data-blok-tab-title>Second</h4><p>B</p><p>C</p></section>'
      + '</div>'
    ))).toEqual([
      { type: 'tabs', data: {} },
      { type: 'tab', data: { title: 'First & <One>', icon: '🍎' }, parent: 0 },
      { type: 'paragraph', data: { text: 'A' }, parent: 1 },
      { type: 'tab', data: { title: 'Second' }, parent: 0 },
      { type: 'paragraph', data: { text: 'B' }, parent: 3 },
      { type: 'paragraph', data: { text: 'C' }, parent: 3 },
    ]);
  });

  it('reads an icon-only title as an empty title', () => {
    expect(shape(htmlToBlocks(
      '<div data-blok-tabs><section data-blok-tab><h4 data-blok-tab-title><span data-blok-tab-icon>📋</span></h4></section></div>'
    ))).toEqual([
      { type: 'tabs', data: {} },
      { type: 'tab', data: { title: '', icon: '📋' }, parent: 0 },
    ]);
  });

  it('keeps an untitled, empty tab as a tab', () => {
    expect(shape(htmlToBlocks('<div data-blok-tabs><section data-blok-tab></section></div>'))).toEqual([
      { type: 'tabs', data: {} },
      { type: 'tab', data: { title: '' }, parent: 0 },
    ]);
  });

  it('keeps a real H4 that opens an untitled tab as a header', () => {
    expect(shape(htmlToBlocks(
      '<div data-blok-tabs><section data-blok-tab><h4>Real heading</h4><p>A</p></section></div>'
    ))).toEqual([
      { type: 'tabs', data: {} },
      { type: 'tab', data: { title: '' }, parent: 0 },
      { type: 'header', data: { text: 'Real heading', level: 4 }, parent: 1 },
      { type: 'paragraph', data: { text: 'A' }, parent: 1 },
    ]);
  });

  it('ignores whitespace between hand-formatted sections', () => {
    expect(shape(htmlToBlocks(
      '<div data-blok-tabs>\n  <section data-blok-tab>\n    <h4 data-blok-tab-title> One </h4>\n  </section>\n  <!-- c -->\n</div>'
    ))).toEqual([
      { type: 'tabs', data: {} },
      { type: 'tab', data: { title: 'One' }, parent: 0 },
    ]);
  });

  it('unwraps a tab section that is not directly inside tabs', () => {
    expect(shape(htmlToBlocks(
      '<section data-blok-tab><h4 data-blok-tab-title>Loose</h4><p>A</p></section>'
    ))).toEqual([
      { type: 'header', data: { text: 'Loose', level: 4 } },
      { type: 'paragraph', data: { text: 'A' } },
    ]);
  });

  it('unwraps tabs that hold no tab section', () => {
    expect(shape(htmlToBlocks('<div data-blok-tabs><p>A</p></div><div data-blok-tabs></div>'))).toEqual([
      { type: 'paragraph', data: { text: 'A' } },
    ]);
  });

  it('moves content that is not a tab out after the tabs, and reports it', () => {
    const { blocks, warnings } = htmlToBlocksWithReport(
      '<details><summary>T</summary><div data-blok-tabs><p>stray</p><section data-blok-tab><h4 data-blok-tab-title>One</h4></section></div></details>'
    );

    expect(shape(blocks)).toEqual([
      { type: 'toggle', data: { text: 'T' } },
      { type: 'tabs', data: {}, parent: 0 },
      { type: 'tab', data: { title: 'One' }, parent: 1 },
      { type: 'paragraph', data: { text: 'stray' }, parent: 0 },
    ]);
    expect(warnings).toEqual([
      { construct: 'tabs', action: 'degraded', detail: expect.stringContaining('tab') },
    ]);
  });

  it('round-trips tabs through blocksToHtml, nested in a toggle', () => {
    const blocks: OutputBlockData[] = [
      { id: 'tg', type: 'toggle', data: { text: 'Wrap' } },
      { id: 'tabs', type: 'tabs', parent: 'tg', data: {} },
      { id: 't1', type: 'tab', parent: 'tabs', data: { title: 'First & <One>', icon: '🍎' } },
      { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'A' } },
      { id: 'h1', type: 'header', parent: 't1', data: { text: 'Inner', level: 4 } },
      { id: 't2', type: 'tab', parent: 'tabs', data: { title: '' } },
      { id: 'h2', type: 'header', parent: 't2', data: { text: 'Lead', level: 4 } },
      { id: 't3', type: 'tab', parent: 'tabs', data: { title: '', icon: '📋' } },
      { id: 't4', type: 'tab', parent: 'tabs', data: { title: 'Last' } },
      { id: 'after', type: 'paragraph', data: { text: 'after' } },
    ];

    expect(shape(htmlToBlocks(blocksToHtml({ blocks })))).toEqual([
      { type: 'toggle', data: { text: 'Wrap' } },
      { type: 'tabs', data: {}, parent: 0 },
      { type: 'tab', data: { title: 'First & <One>', icon: '🍎' }, parent: 1 },
      { type: 'paragraph', data: { text: 'A' }, parent: 2 },
      { type: 'header', data: { text: 'Inner', level: 4 }, parent: 2 },
      { type: 'tab', data: { title: '' }, parent: 1 },
      { type: 'header', data: { text: 'Lead', level: 4 }, parent: 5 },
      { type: 'tab', data: { title: '', icon: '📋' }, parent: 1 },
      { type: 'tab', data: { title: 'Last' }, parent: 1 },
      { type: 'paragraph', data: { text: 'after' } },
    ]);
  });
});
