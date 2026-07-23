// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToHtml, defineBlokSchema } from '../../../src/view';

import type { LooseOutputData, OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DOM-free guarantee', () => {
    it('runs without document or window (node environment)', () => {
      expect(typeof document).toBe('undefined');
      expect(typeof window).toBe('undefined');

      const html = blocksToHtml(doc([{ type: 'paragraph', data: { text: 'Hi' } }]));

      expect(html).toBe('<p>Hi</p>');
    });
  });

  describe('paragraph', () => {
    it('renders a <p> with sanitized inline marks', () => {
      const html = blocksToHtml(doc([
        { type: 'paragraph', data: { text: 'Hello <b>world</b> and <a href="https://x.y" target="_blank">link</a>' } },
      ]));

      expect(html).toBe('<p>Hello <b>world</b> and <a href="https://x.y" target="_blank">link</a></p>');
    });

    it('renders an empty <p> for empty text', () => {
      expect(blocksToHtml(doc([{ type: 'paragraph', data: {} }]))).toBe('<p></p>');
    });
  });

  describe('header', () => {
    it('respects the stored level', () => {
      expect(blocksToHtml(doc([{ type: 'header', data: { text: 'Title', level: 3 } }]))).toBe('<h3>Title</h3>');
    });

    it('clamps invalid levels into 1..6', () => {
      expect(blocksToHtml(doc([{ type: 'header', data: { text: 'T', level: 9 } }]))).toBe('<h6>T</h6>');
      expect(blocksToHtml(doc([{ type: 'header', data: { text: 'T' } }]))).toBe('<h1>T</h1>');
    });

    it('renders a toggleable header as details/summary with children inside', () => {
      const html = blocksToHtml(doc([
        { id: 'h1', type: 'header', data: { text: 'Sec', level: 2, isToggleable: true, isOpen: true } },
        { id: 'c1', type: 'paragraph', parent: 'h1', data: { text: 'Body' } },
      ]));

      expect(html).toBe('<details open><summary><h2>Sec</h2></summary><p>Body</p></details>');
    });
  });

  describe('quote', () => {
    it('renders a blockquote with inline content', () => {
      expect(blocksToHtml(doc([{ type: 'quote', data: { text: 'Wise <i>words</i>', size: 'default' } }])))
        .toBe('<blockquote>Wise <i>words</i></blockquote>');
    });

    it('includes a cite when a caption is present (defensive legacy shape)', () => {
      expect(blocksToHtml(doc([{ type: 'quote', data: { text: 'Wise', caption: 'Author' } }])))
        .toBe('<blockquote>Wise<cite>Author</cite></blockquote>');
    });
  });

  describe('code', () => {
    it('entity-escapes the code and carries a language class', () => {
      const html = blocksToHtml(doc([{ type: 'code', data: { code: 'if (a < b) { c("&"); }', language: 'js' } }]));

      expect(html).toBe('<pre><code class="language-js">if (a &lt; b) { c(&quot;&amp;&quot;); }</code></pre>');
    });

    it('omits the language class when no language is stored', () => {
      expect(blocksToHtml(doc([{ type: 'code', data: { code: 'x' } }]))).toBe('<pre><code>x</code></pre>');
    });
  });

  describe('divider', () => {
    it('renders an <hr>', () => {
      expect(blocksToHtml(doc([{ type: 'divider', data: {} }]))).toBe('<hr>');
    });
  });

  describe('list', () => {
    it('groups consecutive unordered items into one <ul>', () => {
      const html = blocksToHtml(doc([
        { type: 'list', data: { text: 'One', style: 'unordered' } },
        { type: 'list', data: { text: 'Two', style: 'unordered' } },
      ]));

      expect(html).toBe('<ul><li>One</li><li>Two</li></ul>');
    });

    it('renders ordered lists with a start attribute when start > 1', () => {
      const html = blocksToHtml(doc([
        { type: 'list', data: { text: 'Three', style: 'ordered', start: 3 } },
        { type: 'list', data: { text: 'Four', style: 'ordered' } },
      ]));

      expect(html).toBe('<ol start="3"><li>Three</li><li>Four</li></ol>');
    });

    it('nests deeper flat-depth items inside the previous item', () => {
      const html = blocksToHtml(doc([
        { type: 'list', data: { text: 'One', style: 'unordered' } },
        { type: 'list', data: { text: 'Sub', style: 'unordered', depth: 1 } },
        { type: 'list', data: { text: 'Two', style: 'unordered' } },
      ]));

      expect(html).toBe('<ul><li>One<ul><li>Sub</li></ul></li><li>Two</li></ul>');
    });

    it('nests structurally-parented list items inside the parent item', () => {
      const html = blocksToHtml(doc([
        { id: 'a', type: 'list', data: { text: 'One', style: 'unordered' } },
        { id: 'b', type: 'list', parent: 'a', data: { text: 'Sub', style: 'unordered', depth: 1 } },
        { id: 'c', type: 'list', data: { text: 'Two', style: 'unordered' } },
      ]));

      expect(html).toBe('<ul><li>One<ul><li>Sub</li></ul></li><li>Two</li></ul>');
    });

    it('renders checklists with disabled checkbox state', () => {
      const html = blocksToHtml(doc([
        { type: 'list', data: { text: 'Done', style: 'checklist', checked: true } },
        { type: 'list', data: { text: 'Todo', style: 'checklist', checked: false } },
      ]));

      expect(html).toBe('<ul><li><input type="checkbox" checked disabled>Done</li><li><input type="checkbox" disabled>Todo</li></ul>');
    });

    it('splits adjacent runs when the style changes at the same depth', () => {
      const html = blocksToHtml(doc([
        { type: 'list', data: { text: 'A', style: 'unordered' } },
        { type: 'list', data: { text: 'B', style: 'ordered' } },
      ]));

      expect(html).toBe('<ul><li>A</li></ul><ol><li>B</li></ol>');
    });
  });

  describe('callout', () => {
    it('renders an aside with the emoji and the child blocks', () => {
      const html = blocksToHtml(doc([
        { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null } },
        { id: 'c1', type: 'paragraph', parent: 'co', data: { text: 'Note' } },
      ]));

      expect(html).toBe('<aside><span>💡</span><p>Note</p></aside>');
    });
  });

  describe('toggle', () => {
    it('renders details/summary with children, open when isOpen', () => {
      const html = blocksToHtml(doc([
        { id: 'tg', type: 'toggle', data: { text: 'More', isOpen: true } },
        { id: 'c1', type: 'paragraph', parent: 'tg', data: { text: 'Hidden' } },
      ]));

      expect(html).toBe('<details open><summary>More</summary><p>Hidden</p></details>');
    });

    it('renders closed when isOpen is absent', () => {
      const html = blocksToHtml(doc([
        { id: 'tg', type: 'toggle', data: { text: 'More' } },
      ]));

      expect(html).toBe('<details><summary>More</summary></details>');
    });
  });

  describe('image', () => {
    it('renders figure/img with alt and an entity-escaped figcaption (captions are plain text in the live editor)', () => {
      const html = blocksToHtml(doc([
        { type: 'image', data: { url: 'https://x.y/a.png', alt: 'Alt text', caption: 'Cap <b>bold</b>' } },
      ]));

      expect(html).toBe('<figure><img src="https://x.y/a.png" alt="Alt text"><figcaption>Cap &lt;b&gt;bold&lt;/b&gt;</figcaption></figure>');
    });

    it('omits the figcaption when captionVisible is false', () => {
      const html = blocksToHtml(doc([
        { type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', captionVisible: false } },
      ]));

      expect(html).toBe('<figure><img src="https://x.y/a.png" alt=""></figure>');
    });

    it('drops script-capable src schemes', () => {
      const html = blocksToHtml(doc([
        { type: 'image', data: { url: 'javascript:alert(1)' } },
      ]));

      expect(html).not.toContain('javascript:');
      expect(html).toBe('<figure><img alt=""></figure>');
    });
  });

  describe('video', () => {
    it('renders a controls-enabled video with caption', () => {
      const html = blocksToHtml(doc([
        { type: 'video', data: { url: 'https://x.y/v.mp4', caption: 'Clip' } },
      ]));

      expect(html).toBe('<figure><video src="https://x.y/v.mp4" controls></video><figcaption>Clip</figcaption></figure>');
    });

    it('honors autoplay/loop/hideControls flags', () => {
      const html = blocksToHtml(doc([
        { type: 'video', data: { url: 'https://x.y/v.mp4', autoplay: true, loop: true, hideControls: true } },
      ]));

      expect(html).toBe('<figure><video src="https://x.y/v.mp4" autoplay loop></video></figure>');
    });
  });

  describe('audio', () => {
    it('renders audio with caption falling back to title', () => {
      const html = blocksToHtml(doc([
        { type: 'audio', data: { url: 'https://x.y/a.mp3', title: 'Song' } },
      ]));

      expect(html).toBe('<figure><audio src="https://x.y/a.mp3" controls></audio><figcaption>Song</figcaption></figure>');
    });
  });

  describe('file', () => {
    it('renders a download anchor labeled with the file name', () => {
      const html = blocksToHtml(doc([
        { type: 'file', data: { url: 'https://x.y/report.pdf', fileName: 'report.pdf' } },
      ]));

      expect(html).toBe('<a href="https://x.y/report.pdf" download>report.pdf</a>');
    });
  });

  describe('bookmark', () => {
    it('renders an anchor labeled with the title', () => {
      const html = blocksToHtml(doc([
        { type: 'bookmark', data: { url: 'https://x.y', title: 'Example' } },
      ]));

      expect(html).toBe('<a href="https://x.y">Example</a>');
    });

    it('drops unsafe hrefs but keeps the label', () => {
      const html = blocksToHtml(doc([
        { type: 'bookmark', data: { url: 'javascript:alert(1)', title: 'Bad' } },
      ]));

      expect(html).toBe('<a>Bad</a>');
      expect(html).not.toContain('javascript:');
    });
  });

  describe('embed', () => {
    it('renders an https embed as an iframe with caption', () => {
      const html = blocksToHtml(doc([
        { type: 'embed', data: { service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x', caption: 'Vid' } },
      ]));

      expect(html).toBe('<figure><iframe src="https://www.youtube.com/embed/x"></iframe><figcaption>Vid</figcaption></figure>');
    });

    it('degrades a non-https embed to a source anchor', () => {
      const html = blocksToHtml(doc([
        { type: 'embed', data: { service: 'evil', source: 'https://ok.example', embed: 'javascript:alert(1)' } },
      ]));

      expect(html).toBe('<a href="https://ok.example">evil</a>');
      expect(html).not.toContain('javascript:');
    });
  });

  describe('table', () => {
    it('renders thead from the first row when withHeadings is set', () => {
      const html = blocksToHtml(doc([
        {
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              [{ blocks: [], text: 'A' }, { blocks: [], text: 'B' }],
              [{ blocks: [], text: '1' }, { blocks: [], text: '2' }],
            ],
          },
        },
      ]));

      expect(html).toBe('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    });

    it('supports legacy string cells', () => {
      const html = blocksToHtml(doc([
        { type: 'table', data: { withHeadings: false, content: [['x', '<b>y</b>']] } },
      ]));

      expect(html).toBe('<table><tbody><tr><td>x</td><td><b>y</b></td></tr></tbody></table>');
    });

    it('emits colspan/rowspan from merged-cell data and skips covered cells', () => {
      const html = blocksToHtml(doc([
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              [{ blocks: [], text: 'A', colspan: 2 }, { blocks: [], text: '', mergedInto: [0, 0] }],
              [{ blocks: [], text: 'C' }, { blocks: [], text: 'D' }],
            ],
          },
        },
      ]));

      expect(html).toBe('<table><tbody><tr><td colspan="2">A</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>');
    });

    it('marks the first column as th when withHeadingColumn is set', () => {
      const html = blocksToHtml(doc([
        { type: 'table', data: { withHeadings: false, withHeadingColumn: true, content: [[{ blocks: [], text: 'K' }, { blocks: [], text: 'V' }]] } },
      ]));

      expect(html).toBe('<table><tbody><tr><th>K</th><td>V</td></tr></tbody></table>');
    });

    it('renders cell child blocks by id and does not re-render them at top level', () => {
      const html = blocksToHtml(doc([
        { id: 't1', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['p1'] }]] } },
        { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'In cell' } },
      ]));

      expect(html).toBe('<table><tbody><tr><td><p>In cell</p></td></tr></tbody></table>');
    });
  });

  describe('spacer', () => {
    it('renders an empty aria-hidden div', () => {
      expect(blocksToHtml(doc([{ type: 'spacer', data: { height: 40 } }]))).toBe('<div aria-hidden="true"></div>');
    });
  });

  describe('columns', () => {
    it('renders column_list and column children recursively in order', () => {
      const html = blocksToHtml(doc([
        { id: 'cl', type: 'column_list', data: {} },
        { id: 'colA', type: 'column', parent: 'cl', data: {} },
        { id: 'pA', type: 'paragraph', parent: 'colA', data: { text: 'A' } },
        { id: 'colB', type: 'column', parent: 'cl', data: {} },
        { id: 'pB', type: 'paragraph', parent: 'colB', data: { text: 'B' } },
      ]));

      expect(html).toBe('<div><div><p>A</p></div><div><p>B</p></div></div>');
    });
  });

  describe('database', () => {
    it('renders row children as blocks (minimal fallback)', () => {
      const html = blocksToHtml(doc([
        { id: 'db', type: 'database', data: { schema: [], views: [], activeViewId: 'v1' } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { properties: {}, position: 'a' } },
        { id: 'p1', type: 'paragraph', parent: 'r1', data: { text: 'R1' } },
        { id: 'r2', type: 'database-row', parent: 'db', data: { properties: {}, position: 'b' } },
        { id: 'p2', type: 'paragraph', parent: 'r2', data: { text: 'R2' } },
      ]));

      expect(html).toBe('<p>R1</p><p>R2</p>');
    });
  });

  describe('unknown blocks', () => {
    it('skips unknown tools by default', () => {
      const html = blocksToHtml(doc([
        { type: 'widget', data: { foo: 1 } },
        { type: 'paragraph', data: { text: 'After' } },
      ]));

      expect(html).toBe('<p>After</p>');
    });

    it('emits an HTML comment in comment mode with the tool name escaped', () => {
      const html = blocksToHtml(
        doc([{ type: 'widget-->', data: {} }]),
        { onUnknownBlock: 'comment' }
      );

      expect(html).not.toContain('widget-->');
      expect(html).toContain('<!--');
    });
  });

  describe('custom renderers', () => {
    it('wins over the built-in emitter', () => {
      const html = blocksToHtml(
        doc([{ type: 'paragraph', data: { text: 'Hi <b>there</b>' } }]),
        {
          renderers: {
            paragraph: (data, ctx) => `<article>${ctx.sanitizeInline(typeof data.text === 'string' ? data.text : '')}</article>`,
          },
        }
      );

      expect(html).toBe('<article>Hi <b>there</b></article>');
    });

    it('handles unknown tools and composes via ctx.renderChildren', () => {
      const html = blocksToHtml(
        doc([
          { id: 'w', type: 'widget', data: { label: 'Box' } },
          { id: 'c', type: 'paragraph', parent: 'w', data: { text: 'Inside' } },
        ]),
        {
          renderers: {
            widget: (data, ctx) => `<section>${ctx.plainText(typeof data.label === 'string' ? data.label : '')}${ctx.renderChildren()}</section>`,
          },
        }
      );

      expect(html).toBe('<section>Box<p>Inside</p></section>');
    });

    it('exposes renderBlocks for rendering arbitrary block arrays', () => {
      const html = blocksToHtml(
        doc([{ type: 'widget', data: {} }]),
        {
          renderers: {
            widget: (_data, ctx) => ctx.renderBlocks([{ type: 'paragraph', data: { text: 'Injected' } }]),
          },
        }
      );

      expect(html).toBe('<p>Injected</p>');
    });
  });

  describe('sanitization enforcement', () => {
    it('strips event handlers and disallowed tags from data.text', () => {
      const html = blocksToHtml(doc([
        { type: 'paragraph', data: { text: 'Hi <img src="x" onerror="alert(1)"><script>alert(2)</script>' } },
      ]));

      expect(html).toBe('<p>Hi </p>');
    });

    it('strips javascript: hrefs from inline links', () => {
      const html = blocksToHtml(doc([
        { type: 'paragraph', data: { text: '<a href="javascript:alert(1)">x</a>' } },
      ]));

      expect(html).toBe('<p><a>x</a></p>');
    });

    it('entity-escapes captions (plain text in the live editor), neutralizing markup payloads', () => {
      const html = blocksToHtml(doc([
        { type: 'image', data: { url: 'https://x.y/a.png', caption: '<img src=x onerror=alert(1)>cap' } },
      ]));

      expect(html).toBe('<figure><img src="https://x.y/a.png" alt=""><figcaption>&lt;img src=x onerror=alert(1)&gt;cap</figcaption></figure>');
    });
  });

  describe('schema option', () => {
    it('merges the schema baseSanitize over the default inline allowlist', () => {
      class SupTool {
        public static isInline = true;
        public static sanitize = { sup: {} };
        public render(): void {}
      }

      const { viewSchema } = defineBlokSchema({ tools: { sup: SupTool as never } });
      const blocks = doc([{ type: 'paragraph', data: { text: 'x<sup>2</sup> stays <b>bold</b>' } }]);

      expect(blocksToHtml(blocks, { schema: viewSchema })).toBe('<p>x<sup>2</sup> stays <b>bold</b></p>');
      expect(blocksToHtml(blocks)).toBe('<p>x2 stays <b>bold</b></p>');
    });
  });

  describe('LooseOutputData tolerance', () => {
    it('returns empty string for missing blocks array', () => {
      expect(blocksToHtml({} as unknown as OutputData)).toBe('');
      expect(blocksToHtml(null)).toBe('');
      expect(blocksToHtml(undefined)).toBe('');
    });

    it('treats null block data as empty data', () => {
      const loose: LooseOutputData = { blocks: [{ id: null, type: 'paragraph', data: null }] };

      expect(blocksToHtml(loose)).toBe('<p></p>');
    });

    it('skips malformed block entries', () => {
      const loose = { blocks: [null, 42, { data: { text: 'no type' } }, { type: 'paragraph', data: { text: 'ok' } }] };

      expect(blocksToHtml(loose as unknown as LooseOutputData)).toBe('<p>ok</p>');
    });

    it('promotes children with dangling parents to top level', () => {
      const html = blocksToHtml(doc([
        { id: 'p1', type: 'paragraph', parent: 'gone', data: { text: 'Orphan' } },
      ]));

      expect(html).toBe('<p>Orphan</p>');
    });
  });

  describe('generic nesting', () => {
    it('renders children of non-container blocks after the parent element', () => {
      const html = blocksToHtml(doc([
        { id: 'p1', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'p2', type: 'paragraph', parent: 'p1', data: { text: 'Child' } },
      ]));

      expect(html).toBe('<p>Parent</p><p>Child</p>');
    });
  });

  describe('toolAttributes option (data-blok-tool styling hooks)', () => {
    it('is off by default — output carries no data-blok-tool attributes', () => {
      const html = blocksToHtml(doc([
        { type: 'paragraph', data: { text: 'Hi' } },
        { type: 'header', data: { text: 'Title', level: 2 } },
      ]));

      expect(html).not.toContain('data-blok-tool');
      expect(html).toBe('<p>Hi</p><h2>Title</h2>');
    });

    it('stamps each block root with data-blok-tool when enabled', () => {
      const html = blocksToHtml(
        doc([
          { type: 'paragraph', data: { text: 'Hi' } },
          { type: 'header', data: { text: 'Title', level: 2 } },
          { type: 'quote', data: { text: 'Q' } },
        ]),
        { toolAttributes: true }
      );

      expect(html).toBe(
        '<p data-blok-tool="paragraph">Hi</p>'
        + '<h2 data-blok-tool="header">Title</h2>'
        + '<blockquote data-blok-tool="quote">Q</blockquote>'
      );
    });

    it('stamps the list run container', () => {
      const html = blocksToHtml(
        doc([{ type: 'list', data: { text: 'one', style: 'unordered' } }]),
        { toolAttributes: true }
      );

      expect(html).toBe('<ul data-blok-tool="list"><li>one</li></ul>');
    });

    it('does not mis-stamp a bare container (database) onto its child block', () => {
      const html = blocksToHtml(
        doc([
          { id: 'db', type: 'database', data: {} },
          { id: 'p', type: 'paragraph', parent: 'db', data: { text: 'row' } },
        ]),
        { toolAttributes: true }
      );

      // database renders its children bare — the child paragraph must carry its
      // OWN tool marker, never the parent's.
      expect(html).toBe('<p data-blok-tool="paragraph">row</p>');
      expect(html).not.toContain('data-blok-tool="database"');
    });
  });
});
