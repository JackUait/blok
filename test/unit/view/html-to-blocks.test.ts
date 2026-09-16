// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { blocksToHtml, blocksToPlainText, htmlToBlocks, htmlToBlocksWithReport } from '../../../src/view';

import type { OutputBlockData } from '../../../types';

/**
 * Blocks without their generated ids, so a test asserts shape rather than the
 * id generator's output. `parent` is rewritten to the index of the block it
 * points at, which is what a structural assertion actually cares about.
 * @param blocks - blocks to strip
 */
const shape = (blocks: OutputBlockData[]): unknown[] => {
  const indexOf = new Map(blocks.map((block, index) => [block.id, index]));

  return blocks.map(({ id: _id, parent, ...rest }) => (
    parent === undefined ? rest : { ...rest, parent: indexOf.get(parent) }
  ));
};

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
      { type: 'paragraph', data: { text: 'a <b>bold</b> <a href="https://x.dev" rel="nofollow">link</a>' } },
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

  it('converts details into a toggle whose body blocks reference it', () => {
    expect(shape(htmlToBlocks('<details open><summary>More</summary><p>body</p></details>'))).toEqual([
      { type: 'toggle', data: { text: 'More', isOpen: true } },
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
    const report = htmlToBlocksWithReport('<p>H<sub>2</sub>O and x<sup>2</sup></p>');

    expect(shape(report.blocks)).toEqual([{ type: 'paragraph', data: { text: 'H2O and x2' } }]);
    expect(report.warnings).toEqual([
      { construct: 'sub', action: 'degraded', detail: expect.stringContaining('sub') },
      { construct: 'sup', action: 'degraded', detail: expect.stringContaining('sup') },
    ]);
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
