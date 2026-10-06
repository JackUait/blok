// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fromMarkdown } from 'mdast-util-from-markdown';

import { blocksToMarkdown, blocksToMarkdownWithReport } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';
import type { PageInfo } from '../../../types/tools/page';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToMarkdown (view)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without document or window (node environment)', () => {
    expect(typeof document).toBe('undefined');

    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }]))).toBe('Hello **world**');
  });

  it('serializes inline bold, italic, code, strikethrough and links', () => {
    const text = 'a <b>bold</b> <i>italic</i> <code>c</code> <s>gone</s> <a href="https://x.com">link</a>';

    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]))).toBe(
      'a **bold** *italic* `c` ~~gone~~ [link](https://x.com)'
    );
  });

  it('exports inline page references from authorized metadata, not saved labels or URLs', () => {
    const data = doc([{
      type: 'paragraph',
      data: { text: 'See <a data-blok-page-id="p1" href="/private" title="Private"><strong>Private</strong></a>' },
    }]);

    expect(blocksToMarkdown(data, { pageInfo: () => ({ title: 'Roadmap [Q4]' }) })).toBe('See Roadmap \\[Q4\\]');
    expect(blocksToMarkdown(data, { pageInfo: () => ({ access: 'none', title: 'Private' }) })).toBe('See Page');
    expect(blocksToMarkdown(data, { pageInfo: () => null })).toBe('See Page');
    expect(blocksToMarkdown(data)).toBe('See Page');
  });

  it('decodes HTML entities in inline text', () => {
    expect(blocksToMarkdown(doc([{ type: 'paragraph', data: { text: 'a &lt; b &amp; c' } }]))).toBe('a < b & c');
  });

  /**
   * An inline `<img>` has no child nodes, so without a case of its own it fell
   * to the default branch and serialized to the empty string — the image
   * vanished from the export with nothing said about it.
   */
  describe('inline images', () => {
    /**
     * Serialize one paragraph's inline HTML.
     * @param text - the paragraph's `data.text`
     */
    const inline = (text: string): string => blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]));

    it('serializes an inline image as a Markdown image', () => {
      expect(inline('before <img src="https://i/x.png" alt="A shot"> after'))
        .toBe('before ![A shot](https://i/x.png) after');
    });

    it('emits an empty alt when the image has none', () => {
      expect(inline('<img src="https://i/x.png">')).toBe('![](https://i/x.png)');
      expect(inline('<img src="https://i/x.png" alt="">')).toBe('![](https://i/x.png)');
    });

    it('emits nothing for an image with no usable src, rather than a broken link', () => {
      expect(inline('x <img alt="orphan"> y')).toBe('x  y');
      expect(inline('x <img src="" alt="orphan"> y')).toBe('x  y');
    });

    /**
     * The link case emits `href` and its label raw, so the image case does the
     * same. Escaping only one of the two would make the backends disagree with
     * how every other inline construct is written.
     */
    it('escapes Markdown-meaningful characters in alt and link text, leaving a well-formed src and href as is', () => {
      expect(inline('<img src="https://i/x(1).png" alt="a]b">')).toBe('![a\\]b](https://i/x(1).png)');
      expect(inline('<a href="https://x.com/(1)">a]b</a>')).toBe('[a\\]b](https://x.com/(1))');
    });

    it('decodes HTML entities in alt and src', () => {
      expect(inline('<img src="https://i/x.png?a=1&amp;b=2" alt="Tom &amp; Jerry">'))
        .toBe('![Tom & Jerry](https://i/x.png?a=1&b=2)');
    });

    it('keeps an image nested inside a link or a mark', () => {
      expect(inline('<a href="https://x.com"><img src="i.png" alt="A"></a>')).toBe('[![A](i.png)](https://x.com)');
      expect(inline('<b><img src="i.png" alt="A"></b>')).toBe('**![A](i.png)**');
    });

    it('collapses a mark holding only a src-less image', () => {
      expect(inline('<b><img alt="orphan"></b>')).toBe('');
    });
  });

  /**
   * Markdown renderers turn a destination into a live href/src, so a
   * script-capable URL must never reach one. The label stays, as in blocksToHtml.
   */
  describe('unsafe URLs', () => {
    /**
     * Serialize one paragraph's inline HTML.
     * @param text - the paragraph's `data.text`
     */
    const inline = (text: string): string => blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]));

    it('keeps the label of a javascript: link and drops the link', () => {
      expect(inline('<a href="javascript:alert(1)">js</a>')).toBe('js');
    });

    it('drops a link whose scheme is smuggled through whitespace', () => {
      expect(inline('<a href=" java\tscript:alert(1)">ws</a>')).toBe('ws');
    });

    it('drops a data: or blob: link', () => {
      expect(inline('<a href="data:text/html,x">d</a> <a href="blob:https://x/1">b</a>')).toBe('d b');
    });

    it('emits nothing for an image with a javascript: src', () => {
      expect(inline('x <img src="javascript:alert(1)" alt="i"> y')).toBe('x  y');
    });

    it('keeps a raster data: image src', () => {
      expect(inline('<img src="data:image/png;base64,AA" alt="p">')).toBe('![p](data:image/png;base64,AA)');
    });

    it('drops the link from an image block and a link-like block with an unsafe url', () => {
      expect(blocksToMarkdown(doc([{ type: 'image', data: { url: 'javascript:alert(1)', alt: 'Alt' } }]))).toBe('Alt');
      expect(blocksToMarkdown(doc([{ type: 'bookmark', data: { url: 'javascript:alert(1)', title: 'X' } }]))).toBe('X');
      expect(blocksToMarkdown(doc([{ type: 'embed', data: { source: 'data:text/html,x', service: 'evil' } }]))).toBe('evil');
    });
  });

  /**
   * A destination must stay ONE destination when a CommonMark parser reads it
   * back. Checked with a real parse, not string matching, so any escape form
   * that keeps a second link or raw HTML out passes.
   */
  describe('URL destinations', () => {
    /**
     * Serialize one paragraph's inline HTML.
     * @param text - the paragraph's `data.text`
     */
    const inline = (text: string): string => blocksToMarkdown(doc([{ type: 'paragraph', data: { text } }]));

    /**
     * Count node types in the CommonMark parse of `markdown`.
     * @param markdown - the Markdown to parse
     */
    const nodeTypes = (markdown: string): Record<string, number> => {
      const counts: Record<string, number> = {};

      /**
       * Walk one node and its children.
       * @param node - mdast node
       * @param node.type - node type
       * @param node.children - child nodes
       */
      const walk = (node: { type: string; children?: unknown[] }): void => {
        counts[node.type] = (counts[node.type] ?? 0) + 1;
        node.children?.forEach((child) => walk(child as { type: string; children?: unknown[] }));
      };

      walk(fromMarkdown(markdown));

      return counts;
    };

    it('cannot open a second link through a ) in the href', () => {
      const markdown = inline('<a href="https://ok.example/x) [evil](javascript:alert(1)">break</a>');

      expect(nodeTypes(markdown)).toMatchObject({ link: 1 });
      expect(markdown).not.toContain('](javascript:');
    });

    it('cannot smuggle raw HTML through a space in the href', () => {
      const markdown = inline('<a href="https://x.example/a <img src=x onerror=alert(1)>">l</a>');
      const types = nodeTypes(markdown);

      expect(types.html).toBeUndefined();
      expect(types).toMatchObject({ link: 1 });
    });

    it('cannot smuggle a script URL through a character reference', () => {
      const urls: string[] = [];

      /**
       * Collect every link and image URL, decoded as a renderer reads it.
       * @param node - mdast node
       * @param node.url - link or image destination
       * @param node.children - child nodes
       */
      const collect = (node: { url?: string; children?: unknown[] }): void => {
        if (node.url !== undefined) {
          urls.push(node.url);
        }
        node.children?.forEach((child) => collect(child as { url?: string; children?: unknown[] }));
      };
      const markdown = blocksToMarkdown(doc([
        { type: 'paragraph', data: { text: '<a href="&amp;#106;avascript:alert(1)">a</a> <img src="&amp;#x6A;avascript:x" alt="i">' } },
        { type: 'image', data: { url: '&#100;ata:text/html,x', alt: 'A' } },
        { type: 'bookmark', data: { url: '&Tab;javascript:alert(2)', title: 'B' } },
        { type: 'page', data: { pageId: 'p1' } },
      ]), { pageInfo: () => ({ title: 'T' }), pageHref: () => '&#106;avascript:alert(3)' });

      collect(fromMarkdown(markdown));

      expect(urls).toEqual([
        '&#106;avascript:alert(1)',
        '&#x6A;avascript:x',
        '&#100;ata:text/html,x',
        '&Tab;javascript:alert(2)',
        '&#106;avascript:alert(3)',
      ]);
    });

    it('writes an & that starts no character reference as is', () => {
      expect(inline('<a href="https://x.example/?a=1&amp;b=2">q</a>')).toBe('[q](https://x.example/?a=1&b=2)');
    });

    it('keeps a link whose href holds a space', () => {
      expect(inline('<a href="https://ok.example/a b">space</a>')).toBe('[space](https://ok.example/a%20b)');
    });

    it('closes a link whose href ends in a backslash', () => {
      expect(nodeTypes(inline('<a href="https://x.example/a\\">l</a> tail'))).toMatchObject({ link: 1 });
    });

    it('keeps one image when the src breaks out', () => {
      const markdown = inline('<img src="https://i.example/x.png) ![e](https://e.example/y.png" alt="i">');

      expect(nodeTypes(markdown)).toMatchObject({ image: 1 });
    });

    it('keeps one image for an image block whose url breaks out', () => {
      const markdown = blocksToMarkdown(doc([{ type: 'image', data: { url: 'https://i.example/x.png) [e](https://e.example', alt: 'A' } }]));
      const types = nodeTypes(markdown);

      expect(types).toMatchObject({ image: 1 });
      expect(types.link).toBeUndefined();
    });

    it('writes a URL with balanced parens byte-identically', () => {
      expect(inline('<a href="https://en.wikipedia.org/wiki/Foo_(bar)">w</a>'))
        .toBe('[w](https://en.wikipedia.org/wiki/Foo_(bar))');
    });
  });

  it('serializes headings, quotes, dividers and code fences', () => {
    expect(blocksToMarkdown(doc([{ type: 'header', data: { text: 'Title', level: 2 } }]))).toBe('## Title');
    expect(blocksToMarkdown(doc([{ type: 'quote', data: { text: 'wisdom' } }]))).toBe('> wisdom');
    expect(blocksToMarkdown(doc([{ type: 'divider', data: {} }]))).toBe('---');
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'const a = 1;' } }]))).toBe('```\nconst a = 1;\n```');
  });

  it('keeps a code block language on the fence', () => {
    const md = blocksToMarkdown(doc([
      { type: 'code', data: { code: 'var x = 1;', language: 'csharp' } },
    ]));

    expect(md).toBe('```csharp\nvar x = 1;\n```');
  });

  it('emits a bare fence when the language is plain text or absent', () => {
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'x', language: 'plain text' } }])))
      .toBe('```\nx\n```');
    expect(blocksToMarkdown(doc([{ type: 'code', data: { code: 'x' } }])))
      .toBe('```\nx\n```');
  });

  /**
   * `delimiter` is Editor.js's name for the same block. Documents imported from
   * an Editor.js-era store still carry it, and without the alias it fell to the
   * default branch and serialized as an EMPTY line.
   */
  it('serializes the legacy `delimiter` alias as a thematic break', () => {
    expect(blocksToMarkdown(doc([{ type: 'delimiter', data: {} }]))).toBe('---');
  });

  it('serializes list styles and structural nesting', () => {
    const md = blocksToMarkdown(doc([
      { id: 'a', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'b', type: 'list', data: { text: 'nested', style: 'ordered' }, parent: 'a' },
      { id: 'c', type: 'list', data: { text: 'todo', style: 'checklist', checked: true } },
    ]));

    expect(md).toBe('- one\n    1. nested\n- [x] todo');
  });

  it('does not indent a paragraph nested under a heading into a code block', () => {
    const md = blocksToMarkdown(doc([
      { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true } },
      { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 'h1' },
    ]));

    expect(md).toBe('## Section\n\nBody');
  });

  it('keeps the indent for a paragraph continuing a list item', () => {
    const md = blocksToMarkdown(doc([
      { id: 'l1', type: 'list', data: { text: 'Step one', style: 'unordered' } },
      { id: 'p1', type: 'paragraph', data: { text: 'More about step one' }, parent: 'l1' },
    ]));

    expect(md).toBe('- Step one\n\n    More about step one');
  });

  describe('page', () => {
    it('ignores legacy cached titles without host metadata', () => {
      const md = blocksToMarkdown(doc([
        { type: 'paragraph', data: { text: 'Before' } },
        { type: 'page', data: { pageId: 'p1', cache: { title: 'Restricted title' } } },
      ]));

      expect(md).toBe('Before\n\nPage');
    });

    it('exports only the host-authorized title as escaped plain text', () => {
      const md = blocksToMarkdown(doc([
        { type: 'page', data: { pageId: 'p1', cache: { title: 'Restricted title' } } },
      ]), { pageInfo: (pageId) => pageId === 'p1' ? { title: 'Q3 <plan> & notes' } : undefined });

      expect(md).toBe('Q3 \\<plan> & notes');
    });

    it('uses neutral labels for unresolved, missing, denied, and untitled pages', () => {
      const page = doc([{ type: 'page', data: { pageId: 'p1', cache: { title: 'Restricted title' } } }]);

      expect(blocksToMarkdown(page)).toBe('Page');
      expect(blocksToMarkdown(page, { pageInfo: () => undefined })).toBe('Page');
      expect(blocksToMarkdown(page, { pageInfo: () => null })).toBe('Page not found');
      expect(blocksToMarkdown(page, { pageInfo: () => ({ access: 'none', title: 'Host secret' }) })).toBe('No access');
      expect(blocksToMarkdown(page, { pageInfo: () => ({ title: '' }) })).toBe('New page');
    });

    it('never exports children a malformed document hangs off a page', () => {
      const md = blocksToMarkdown(doc([
        { id: 'pg', type: 'page', data: { pageId: 'p1', cache: { title: 'Restricted title' } }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', parent: 'pg', data: { text: 'Leaked body' } },
      ]));

      expect(md).toBe('Page');
    });

    it('does not report the page as dropped', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'page', data: { pageId: 'p1' } }]));

      expect(warnings.filter(warning => warning.action === 'dropped')).toEqual([]);
    });

    it('reports the lost sub-page link as a degradation', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'page', data: { pageId: 'p1' } }]));

      expect(warnings).toEqual([expect.objectContaining({ construct: 'page', action: 'degraded' })]);
    });
  });

  describe('page links', () => {
    const pages = doc([
      { type: 'page', data: { pageId: 'p1' } },
      { type: 'page-link', data: { pageId: 'p2' } },
    ]);

    it('links an allowed page that has an href, and reports nothing lost', () => {
      const result = blocksToMarkdownWithReport(pages, {
        pageInfo: (pageId) => ({ title: pageId === 'p1' ? 'Road [map]' : '' }),
        pageHref: (pageId) => `/pages/${pageId}`,
      });

      expect(result.markdown).toBe('[Road \\[map\\]](/pages/p1)\n\n[New page](/pages/p2)');
      expect(result.warnings).toEqual([]);
    });

    it('keeps the title only, and reports the lost link, when there is no href', () => {
      const result = blocksToMarkdownWithReport(pages, {
        pageInfo: () => ({ title: 'Roadmap' }),
        pageHref: () => '',
      });

      expect(result.markdown).toBe('Roadmap\n\nRoadmap');
      expect(result.warnings).toEqual([
        { construct: 'page', action: 'degraded', detail: 'page link is lost' },
        { construct: 'page-link', action: 'degraded', detail: 'page link is lost' },
      ]);
    });

    it.each([
      ['a script URL', 'javascript:alert(1)'],
      ['a whitespace-smuggled script URL', ' java\tscript:alert(1)'],
    ])('never links %s', (_name, href) => {
      const result = blocksToMarkdownWithReport(pages, { pageInfo: () => ({ title: 'T' }), pageHref: () => href });

      expect(result.markdown).toBe('T\n\nT');
      expect(result.warnings).toHaveLength(2);
    });

    it('cannot open a second link through a ) in the href', () => {
      const markdown = blocksToMarkdown(doc([{ type: 'page', data: { pageId: 'p1' } }]), {
        pageInfo: () => ({ title: 'T' }),
        pageHref: () => 'https://ok.example/x) [evil](javascript:alert(1)',
      });

      const paragraph = fromMarkdown(markdown).children[0] as { children: Array<{ type: string; url?: string }> };

      expect(paragraph.children).toEqual([expect.objectContaining({ type: 'link', url: 'https://ok.example/x)%20[evil](javascript:alert(1)' })]);
    });

    it('never asks for the href of an unresolved, missing or denied page', () => {
      const pageHref = vi.fn(() => '/leak');
      const info: Record<string, PageInfo | null> = { p2: null, p3: { access: 'none', title: 'Secret' } };
      const markdown = blocksToMarkdown(doc([
        { type: 'page', data: { pageId: 'p1' } },
        { type: 'page-link', data: { pageId: 'p2' } },
        { type: 'page-link', data: { pageId: 'p3' } },
        { type: 'paragraph', data: { text: '<a data-blok-page-id="p1">x</a> <a data-blok-page-id="p2">x</a> <a data-blok-page-id="p3">x</a>' } },
      ]), { pageInfo: (pageId) => info[pageId], pageHref });

      expect(markdown).toBe('Page\n\nPage not found\n\nNo access\n\nPage Page Page');
      expect(pageHref).not.toHaveBeenCalled();
    });

    it('links an inline reference to an allowed page', () => {
      const data = doc([{ type: 'paragraph', data: { text: 'See <a data-blok-page-id="p1">x</a> and <a data-blok-page-id="p2">x</a>' } }]);

      expect(blocksToMarkdown(data, {
        pageInfo: (pageId) => ({ title: pageId === 'p1' ? 'Roadmap' : ' ' }),
        pageHref: (pageId) => `/pages/${pageId}`,
      })).toBe('See [Roadmap](/pages/p1) and [Page](/pages/p2)');
      expect(blocksToMarkdown(data, {
        pageInfo: () => ({ title: 'Roadmap' }),
        pageHref: () => 'javascript:alert(1)',
      })).toBe('See Roadmap and Roadmap');
    });
  });

  describe('containers that own their children', () => {
    it('renders a callout as a blockquote carrying its emoji and its children', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Note body' }, parent: 'cal1' },
      ]));

      expect(md).toBe('> 💡 Note body');
    });

    it('keeps every callout child inside the quote, exactly once', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'First' }, parent: 'cal1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' }, parent: 'cal1' },
      ]));

      expect(md).toBe('> 💡 First\n> \n> Second');
    });

    it('renders a toggle as a bold summary followed by its body', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tg1', type: 'toggle', data: { text: 'Details' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Hidden' }, parent: 'tg1' },
      ]));

      expect(md).toBe('**Details**\n\nHidden');
    });

    /**
     * A container claims every descendant, not just its direct children, but
     * used to render only the direct ones — so anything deeper vanished with
     * no warning. A list inside a toggle is the everyday shape of that.
     */
    it('renders a grandchild instead of dropping it', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tg', type: 'toggle', data: { text: 'More' } },
        { id: 'l1', type: 'list', data: { text: 'a', style: 'unordered' }, parent: 'tg' },
        { id: 'l2', type: 'list', data: { text: 'b', style: 'unordered' }, parent: 'l1' },
      ]));

      expect(md).toBe('**More**\n\n- a\n    - b');
    });

    it('lets a nested container render its own children once', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cal', type: 'callout', data: { emoji: '💡' } },
        { id: 'tg', type: 'toggle', data: { text: 'More' }, parent: 'cal' },
        { id: 'p1', type: 'paragraph', data: { text: 'Deep' }, parent: 'tg' },
      ]));

      expect(md).toBe('> 💡 **More**\n> \n> Deep');
    });

    it('flattens columns into their blocks in reading order', () => {
      const md = blocksToMarkdown(doc([
        { id: 'cl', type: 'column_list', data: {} },
        { id: 'c1', type: 'column', data: {}, parent: 'cl' },
        { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl' },
        { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ]));

      expect(md).toBe('Left\n\nRight');
    });

    it('writes every tab as a bold title line followed by its content', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: 'Overview', icon: '📋' }, parent: 'tabs' },
        { id: 'p1', type: 'paragraph', data: { text: 'First <b>body</b>' }, parent: 't1' },
        { id: 'l1', type: 'list', data: { text: 'nested', style: 'unordered' }, parent: 't1' },
        { id: 't2', type: 'tab', data: { title: 'Details' }, parent: 'tabs' },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' }, parent: 't2' },
        { type: 'paragraph', data: { text: 'After' } },
      ]));

      expect(md).toBe('**📋 Overview**\n\nFirst **body**\n\n- nested\n\n**Details**\n\nSecond\n\nAfter');
    });

    it('escapes a tab title as plain text, never reading it as HTML or Markdown', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: '<b>a</b> & *b*' }, parent: 'tabs' },
      ]));

      expect(fromMarkdown(md).children).toMatchObject([
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: '<b>a</b> & *b*' }] }] },
      ]);
    });

    /** `****` alone on a line is a thematic break, so an empty title must not print it. */
    it('writes no title line for an untitled tab without an icon', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: '' }, parent: 'tabs' },
        { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 't1' },
        { id: 't2', type: 'tab', data: { title: '' }, parent: 'tabs' },
      ]));

      expect(md).toBe('Body');
    });

    it('escapes a Markdown-significant icon so the title stays bold', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: 'A', icon: '**' }, parent: 'tabs' },
      ]));

      expect(fromMarkdown(md).children).toMatchObject([
        { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: '** A' }] }] },
      ]);
    });

    it('writes an untitled tab with an icon as the icon alone', () => {
      const md = blocksToMarkdown(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: '', icon: '🔍' }, parent: 'tabs' },
      ]));

      expect(md).toBe('**🔍**');
    });

    /**
     * The defect these cases exist for: a contentless container carries no
     * `data.text`, so the default branch emitted an empty string — and the
     * blank-line separator around it was still applied, leaving a run of stray
     * blank lines in place of the block.
     */
    it('leaves no stray blank lines where a container used to serialize empty', () => {
      const md = blocksToMarkdown(doc([
        { type: 'paragraph', data: { text: 'Before' } },
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Inside' }, parent: 'cal1' },
        { type: 'paragraph', data: { text: 'After' } },
      ]));

      expect(md).toBe('Before\n\n> 💡 Inside\n\nAfter');
    });
  });

  it('drops a spacer without leaving a gap', () => {
    const md = blocksToMarkdown(doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'spacer', data: {} },
      { type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(md).toBe('A\n\nB');
  });

  it('drops a table of contents, even one carrying stray text', () => {
    const md = blocksToMarkdown(doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'table_of_contents', data: { text: 'stray', textColor: 'red' } },
      { type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(md).toBe('A\n\nB');
  });

  it('serializes media and embeds as links', () => {
    expect(blocksToMarkdown(doc([{ type: 'image', data: { url: 'https://i/x.png', alt: 'Shot' } }])))
      .toBe('![Shot](https://i/x.png)');
    expect(blocksToMarkdown(doc([{ type: 'bookmark', data: { url: 'https://x.com', title: 'X' } }])))
      .toBe('[X](https://x.com)');
  });

  it('serializes a table as a GFM pipe table', () => {
    const md = blocksToMarkdown(doc([
      {
        id: 't1',
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ text: 'H1' }, { text: 'H2' }],
            [{ text: 'a' }, { text: 'b' }],
          ],
        },
      },
    ]));

    expect(md).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |');
  });

  it('writes a block once when two table cells reference its id', () => {
    const md = blocksToMarkdown(doc([
      { id: 't', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['shared'] }, { blocks: ['shared'], text: 'Stale' }]] } },
      { id: 'shared', type: 'paragraph', parent: 't', data: { text: 'First' } },
    ]));

    expect(md).toBe('| First |  |\n| --- | --- |');
  });

  it('keeps a null first row as a blank heading row, marked so it is not read back as headless', () => {
    const md = blocksToMarkdown(doc([
      { id: 't', type: 'table', data: { withHeadings: true, content: [null, [{ blocks: ['x'] }]] } },
      { id: 'x', type: 'paragraph', parent: 't', data: { text: 'X' } },
    ]));

    expect(md).toBe('| <br> |\n| --- |\n| X |');
  });

  it('moves covered blocks into a merged cell without reviving stale text', () => {
    const md = blocksToMarkdown(doc([
      { id: 't', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['own'], text: 'Stale', colspan: 2 }, { blocks: ['claimed'], mergedInto: [0, 0] }]] } },
      { id: 'own', type: 'paragraph', parent: 't', data: { text: 'Own' } },
      { id: 'claimed', type: 'paragraph', parent: 't', data: { text: 'Claimed' } },
    ]));

    expect(md).toBe('| Own<br>Claimed |  |\n| --- | --- |');
  });

  it('keeps a text-only merge origin before a covered block', () => {
    const md = blocksToMarkdown(doc([
      { id: 't', type: 'table', data: { withHeadings: true, content: [[{ blocks: [], text: 'Origin', colspan: 2 }, { blocks: ['claimed'] }]] } },
      { id: 'claimed', type: 'paragraph', parent: 't', data: { text: 'Claimed' } },
    ]));

    expect(md).toBe('| Origin<br>Claimed |  |\n| --- | --- |');
  });

  it('falls back to saved cell text when its block reference is unresolved', () => {
    const md = blocksToMarkdown(doc([
      { id: 't', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['missing'], text: 'Saved fallback' }]] } },
    ]));

    expect(md).toBe('| Saved fallback |\n| --- |');
  });

  describe('degradation report', () => {
    it('reports a dropped spacer', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'spacer', data: {} }]));

      expect(warnings).toEqual([
        { construct: 'spacer', action: 'dropped', detail: expect.stringContaining('Markdown') },
      ]);
    });

    it('reports a dropped table of contents', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'table_of_contents', data: {} }]));

      expect(warnings).toEqual([
        { construct: 'table_of_contents', action: 'dropped', detail: expect.stringContaining('headings') },
      ]);
    });

    it('reports a callout as degraded', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'cal1', type: 'callout', data: { emoji: '💡' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Body' }, parent: 'cal1' },
      ]));

      expect(warnings).toEqual([
        { construct: 'callout', action: 'degraded', detail: expect.stringContaining('blockquote') },
      ]);
    });

    it('reports tabs as degraded once, not once per tab', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'tabs', type: 'tabs', data: {} },
        { id: 't1', type: 'tab', data: { title: 'A' }, parent: 'tabs' },
        { id: 't2', type: 'tab', data: { title: 'B' }, parent: 'tabs' },
      ]));

      expect(warnings).toEqual([
        { construct: 'tabs', action: 'degraded', detail: 'tabs are written one after another, each under its bold title; switching between them is lost' },
      ]);
    });

    it('does not report tabs as degraded when the block holds no tab', () => {
      const empty = blocksToMarkdownWithReport(doc([{ id: 'tabs', type: 'tabs', data: {} }]));
      const strayOnly = blocksToMarkdownWithReport(doc([
        { id: 'tabs', type: 'tabs', data: {}, content: ['s1'] },
        { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs' },
      ]));

      expect(empty.warnings).toEqual([]);
      expect(strayOnly.warnings).toEqual([]);
      expect(strayOnly.markdown).toBe('S1');
    });

    it('reports a collapsible heading', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2, isToggleable: true } },
      ]));

      expect(warnings).toEqual([
        { construct: 'header',
          action: 'degraded',
          detail: 'collapsible heading is rendered as a heading followed by its body; collapsibility is lost' },
      ]);
    });

    it('does not report an ordinary heading', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'header', data: { text: 'Section', level: 2 } },
      ])).warnings).toEqual([]);
    });

    it.each(['embed', 'video', 'audio', 'file', 'bookmark'])('reports %s as a plain link', (tool) => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { type: tool, data: { url: 'https://example.com/x', title: 'X' } },
      ]));

      expect(warnings).toEqual([
        { construct: tool, action: 'degraded', detail: expect.stringContaining('rendered as a plain link') },
      ]);
    });

    it('reports table cell references it could not resolve', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 't1', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['gone'] }]] } },
      ]));

      expect(warnings).toContainEqual({
        construct: 'table',
        action: 'dropped',
        detail: '1 child block reference could not be resolved and was dropped',
      });
    });

    it('pluralizes the unresolved table cell reference report', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 't1', type: 'table', data: { withHeadings: true, content: [[{ blocks: ['gone', 'also-gone'] }]] } },
      ]));

      expect(warnings).toContainEqual({
        construct: 'table',
        action: 'dropped',
        detail: '2 child block references could not be resolved and were dropped',
      });
    });

    /**
     * `content[]` is the canonical containment form, so a container naming a
     * child the document does not carry loses it exactly the way an unresolved
     * table cell reference does — and used to say nothing about it.
     */
    it('reports a block-level content reference it could not resolve', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'l1', type: 'list', data: { text: 'item', style: 'unordered' }, content: ['gone'] },
      ]));

      expect(warnings).toEqual([
        { construct: 'list',
          action: 'dropped',
          detail: '1 child block reference could not be resolved and was dropped' },
      ]);
    });

    it('pluralizes the unresolved block-level content report', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'p1', type: 'paragraph', data: { text: 'text' }, content: ['gone', 'also-gone'] },
      ]));

      expect(warnings).toEqual([
        { construct: 'paragraph',
          action: 'dropped',
          detail: '2 child block references could not be resolved and were dropped' },
      ]);
    });

    it('reports an unresolved reference inside a nested container once', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'cl1', type: 'column_list', data: {}, content: ['col1'] },
        { id: 'col1', type: 'column', data: {}, parent: 'cl1', content: ['gone'] },
      ]));

      expect(warnings).toEqual([
        { construct: 'column_list',
          action: 'degraded',
          detail: 'columns are flattened into sequential blocks; the side-by-side layout is lost' },
        { construct: 'column',
          action: 'dropped',
          detail: '1 child block reference could not be resolved and was dropped' },
      ]);
    });

    it('stays silent when every content reference resolves', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { id: 'q1', type: 'quote', data: { text: 'q' }, content: ['k1'] },
        { id: 'k1', type: 'paragraph', data: { text: 'child' } },
      ]));

      expect(warnings).toEqual([]);
    });

    /**
     * A block that vanishes from the output must be named. Without this, a
     * custom or unrecognized contentless tool disappeared silently — the same
     * failure mode the Markdown serialization law exists to prevent, but at
     * runtime rather than at build time.
     */
    it('reports an unrecognized block that produced no output', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: 'A' } },
        { type: 'org-chart', data: { nodes: [] } },
      ]));

      expect(markdown).toBe('A');
      expect(warnings).toEqual([
        { construct: 'org-chart', action: 'dropped', detail: expect.any(String) },
      ]);
    });

    it('keeps an unrecognized block that carries text, without a warning', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'org-chart', data: { text: 'Team' } },
      ]));

      expect(markdown).toBe('Team');
      expect(warnings).toEqual([]);
    });

    it('reports nothing for a document that serializes losslessly', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'header', data: { text: 'Title', level: 1 } },
        { type: 'paragraph', data: { text: 'Body' } },
      ]));

      expect(markdown).toBe('# Title\n\nBody');
      expect(warnings).toEqual([]);
    });
  });

  /**
   * Markdown cannot express any of these, which is exactly why they have to be
   * REPORTED: dropping them in silence tells a host round-tripping a document
   * through Markdown that the conversion was lossless.
   */
  describe('silently lost constructs', () => {
    /** The view paints `caption` as a `<cite>` inside the blockquote, so it stays inside the quote. */
    it('keeps a quote caption as an attribution line inside the quote, and reports it', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'quote', data: { text: 'Цитата', caption: 'Стандарт' } },
      ]));

      expect(markdown).toBe('> Цитата\n>\n> — Стандарт');
      expect(warnings).toEqual([
        { construct: 'quote', action: 'degraded', detail: expect.stringContaining('attribution line') },
      ]);
    });

    it('keeps rich text and line breaks of a quote caption inside the quote', () => {
      expect(blocksToMarkdown(doc([
        { type: 'quote', data: { text: 'Q', caption: 'Cap <b>bold</b><br>two' } },
      ]))).toBe('> Q\n>\n> — Cap **bold**  \n> two');
    });

    it('emits only the attribution line for a caption on an empty quote', () => {
      expect(blocksToMarkdown(doc([
        { type: 'quote', data: { text: '', caption: 'Author' } },
      ]))).toBe('> — Author');
    });

    it('stays silent for a quote without a caption', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'quote', data: { text: 'Цитата' } },
      ])).warnings).toEqual([]);
    });

    it('reports an image width that is not full width', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', width: 50, alignment: 'center' } },
      ]));

      expect(markdown).toBe('![](https://i/x.png)');
      expect(warnings).toEqual([
        { construct: 'image', action: 'degraded', detail: 'image is rendered as a plain Markdown image; its width is lost' },
      ]);
    });

    it('names every non-default presentation field the image loses', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        {
          type: 'image',
          data: { url: 'https://i/x.png',
            width: 50,
            alignment: 'left',
            crop: { x: 10, y: 10, w: 50, h: 50 } },
        },
      ]));

      expect(warnings).toEqual([
        { construct: 'image',
          action: 'degraded',
          detail: 'image is rendered as a plain Markdown image; its crop, width and alignment are lost' },
      ]);
    });

    it('reports the turn, mirror, straighten, filter and adjustments right after the crop', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        {
          type: 'image',
          data: { url: 'https://i/x.png',
            width: 50,
            crop: { x: 10, y: 10, w: 50, h: 50 },
            rotation: 90,
            flipX: true,
            straighten: -3.5,
            filter: 'mono',
            adjust: { brightness: 0, contrast: 20 } },
        },
      ]));

      expect(warnings).toEqual([
        { construct: 'image',
          action: 'degraded',
          detail: 'image is rendered as a plain Markdown image; its crop, rotation, mirror, straighten, filter, adjustments and width are lost' },
      ]);
    });

    it('reports marks right after the crop, since both are lost content', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        {
          type: 'image',
          data: { url: 'https://i/x.png',
            rotation: 90,
            crop: { x: 10, y: 10, w: 50, h: 50 },
            markup: [{ id: 'a', type: 'line', color: '#111111', x1: 0, y1: 0, x2: 1, y2: 1, size: 0.01 }] },
        },
      ]));

      expect(warnings).toEqual([
        { construct: 'image',
          action: 'degraded',
          detail: 'image is rendered as a plain Markdown image; its crop, markup and rotation are lost' },
      ]);
    });

    it('stays silent for an image with an empty markup list', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', markup: [] } },
      ])).warnings).toEqual([]);
    });

    it('stays silent for an image whose geometry and adjust fields hold their defaults', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'image',
          data: { url: 'https://i/x.png', rotation: 0, flipX: false, straighten: 0, filter: 'none', adjust: { brightness: 0, contrast: 0, saturation: 0 } } },
      ])).warnings).toEqual([]);
    });

    it('stays silent for an image whose presentation fields hold their defaults', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', width: 100, alignment: 'center', rounded: true } },
      ])).warnings).toEqual([]);
    });

    /**
     * The `![…]` slot IS the alt slot, so the caption used to be written into
     * it — inventing an alt the author never typed and overwriting the one they
     * did. The caption has no Markdown home and is reported instead.
     */
    it('writes the alt text into the alt slot and reports the caption', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', alt: 'схема', caption: 'Выдача' } },
      ]));

      expect(markdown).toBe('![схема](https://i/x.png)');
      expect(warnings).toEqual([
        { construct: 'image', action: 'degraded', detail: expect.stringContaining('caption') },
      ]);
    });

    it('drops a caption-only image to an empty alt and reports the caption', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', caption: 'Выдача' } },
      ]));

      expect(markdown).toBe('![](https://i/x.png)');
      expect(warnings).toEqual([
        { construct: 'image', action: 'degraded', detail: expect.stringContaining('caption') },
      ]);
    });

    /**
     * `![text](url)` imports as caption AND alt (mdast-to-blocks), so a
     * Markdown-sourced image always has the two equal. The alt slot carries
     * that string out again, so nothing is lost and nothing is reported.
     */
    it('stays silent when the caption is the alt text the Markdown already carries', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'image', data: { url: 'https://i/x.png', alt: 'схема', caption: 'схема' } },
      ]));

      expect(markdown).toBe('![схема](https://i/x.png)');
      expect(warnings).toEqual([]);
    });

    it('reports inline colour and highlight, keeping the text', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: '<span style="color:#ff0000">красный</span> и <mark>маркер</mark>' } },
      ]));

      expect(markdown).toBe('красный и маркер');
      expect(warnings).toEqual([
        { construct: 'text-color', action: 'degraded', detail: expect.stringContaining('colour') },
        { construct: 'highlight', action: 'degraded', detail: expect.stringContaining('highlight') },
      ]);
    });

    it('reads a background-colour mark as a highlight', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: '<mark style="background-color:#ff0">жёлтый</mark>' } },
      ]));

      expect(warnings).toEqual([
        { construct: 'highlight', action: 'degraded', detail: expect.stringContaining('highlight') },
      ]);
    });

    /** The report carries no block location, so N identical lines say no more than one. */
    it('reports a repeated inline loss once per document', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: '<mark>один</mark>' } },
        { type: 'paragraph', data: { text: '<mark>два</mark>' } },
      ]));

      expect(warnings).toEqual([
        { construct: 'highlight', action: 'degraded', detail: expect.stringContaining('highlight') },
      ]);
    });

    it.each([
      ['<u>подчёркнутый</u>', 'underline'],
      ['x<sup>2</sup>', 'superscript'],
      ['H<sub>2</sub>O', 'subscript'],
    ])('reports %s as a lost inline construct', (text, construct) => {
      const { warnings } = blocksToMarkdownWithReport(doc([{ type: 'paragraph', data: { text } }]));

      expect(warnings).toEqual([
        { construct, action: 'degraded', detail: expect.any(String) },
      ]);
    });

    it('stays silent for a plain span carrying no colour', () => {
      expect(blocksToMarkdownWithReport(doc([
        { type: 'paragraph', data: { text: '<span>обычный</span>' } },
      ])).warnings).toEqual([]);
    });

    it('reports merged cells, a heading column and cell colours', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        {
          id: 't1',
          type: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: true,
            content: [
              [{ text: 'H1', colspan: 2 }, { text: 'H2' }],
              [{ text: 'a', color: '#fee' }, { text: 'b' }],
            ],
          },
        },
      ]));

      expect(warnings).toEqual([
        { construct: 'table',
          action: 'degraded',
          detail: 'table is rendered as a GFM pipe table; its merged cells, heading column and cell colours are lost' },
      ]);
    });

    it('keeps cells separate when the span is not numeric', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([{
        id: 't1',
        type: 'table',
        data: { withHeadings: true, content: [[{ blocks: [], text: 'Origin', colspan: '2' }, { blocks: [], text: 'Covered' }]] },
      }]));

      expect(markdown).toBe('| Origin | Covered |\n| --- | --- |');
      expect(warnings).toEqual([]);
    });

    it('stays silent for a table a pipe table can express', () => {
      expect(blocksToMarkdownWithReport(doc([
        {
          id: 't1',
          type: 'table',
          data: { withHeadings: true, content: [[{ text: 'H1' }, { text: 'H2' }], [{ text: 'a' }, { text: 'b' }]] },
        },
      ])).warnings).toEqual([]);
    });

    /** The anti-noise pin: an ordinary document must still report nothing. */
    it('reports nothing for a document whose blocks carry no unrepresentable fields', () => {
      const { warnings } = blocksToMarkdownWithReport(doc([
        { type: 'header', data: { text: 'Title', level: 2 } },
        { type: 'paragraph', data: { text: 'Body with <b>bold</b> and a <a href="https://x.com">link</a>' } },
        { type: 'list', data: { text: 'item', style: 'unordered' } },
        { type: 'quote', data: { text: 'Цитата' } },
        { type: 'image', data: { url: 'https://i/x.png', alt: 'схема' } },
        { type: 'code', data: { code: 'const a = 1;', language: 'js' } },
        { id: 't1', type: 'table', data: { withHeadings: true, content: [[{ text: 'H' }], [{ text: 'a' }]] } },
      ]));

      expect(warnings).toEqual([]);
    });
  });

  /**
   * `toggleList` and `columns` are the legacy names of `toggle` and
   * `column_list`. `document-model.ts` already expands their nested children,
   * so the content reached the output — but with no case of their own they hit
   * the `default` branch and were reported as `dropped`, which is what
   * consumers gate destructive overwrites on.
   */
  describe('legacy container aliases', () => {
    it('renders a legacy toggleList exactly like the toggle that replaced it', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        {
          type: 'toggleList',
          data: {
            title: 'Summary',
            body: { blocks: [{ type: 'paragraph', data: { text: 'body' } }] },
          },
        },
      ]));

      expect(markdown).toBe('**Summary**\n\nbody');
      expect(warnings).toEqual([
        { construct: 'toggle',
          action: 'degraded',
          detail: 'toggle is rendered as a bold summary followed by its body; collapsibility is lost' },
      ]);
    });

    it('renders legacy columns exactly like the column_list that replaced it', () => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc([
        {
          type: 'columns',
          data: {
            cols: [
              { blocks: [{ type: 'paragraph', data: { text: 'left' } }] },
              { blocks: [{ type: 'paragraph', data: { text: 'right' } }] },
            ],
          },
        },
      ]));

      expect(markdown).toBe('left\n\nright');
      expect(warnings).toEqual([
        { construct: 'columns',
          action: 'degraded',
          detail: 'columns are flattened into sequential blocks; the side-by-side layout is lost' },
      ]);
    });
  });

  it('returns an empty string for an empty or malformed document', () => {
    expect(blocksToMarkdown(undefined)).toBe('');
    expect(blocksToMarkdown(doc([]))).toBe('');
  });
});

/** The editor evicts non-`tab` children of `tabs` to the tabs block's own parent, right after the tabs block. */
describe('stray children of tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places strays after the tabs subtree, in editor save order', () => {
    const out = blocksToMarkdown(doc([
      { id: 'before', type: 'paragraph', data: { text: 'BEFORE' } },
      { id: 'tabs', type: 'tabs', data: {}, content: ['s1', 't1', 's2'] },
      { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs', content: ['s1c'] },
      { id: 's1c', type: 'paragraph', data: { text: 'S1C' }, parent: 's1' },
      { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 's2', type: 'paragraph', data: { text: 'S2' }, parent: 'tabs' },
      { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
    ]));

    expect(out).toBe('BEFORE\n\n**Do**\n\none\n\nS1\n\nS1C\n\nS2\n\nAFTER');
  });

  it('keeps a tabs block holding only a stray, with the stray after it', () => {
    const out = blocksToMarkdown(doc([
      { id: 'tabs', type: 'tabs', data: {}, content: ['s1'] },
      { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs' },
      { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
    ]));

    expect(out).toBe('S1\n\nAFTER');
  });

  it('keeps a stray in the toggle holding the tabs, right after the tabs', () => {
    const out = blocksToMarkdown(doc([
      { id: 'c', type: 'toggle', data: { text: 'C' }, content: ['tabs', 'i2'] },
      { id: 'tabs', type: 'tabs', data: {}, parent: 'c', content: ['s1', 't1'] },
      { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs' },
      { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 'i2', type: 'paragraph', data: { text: 'I2' }, parent: 'c' },
      { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
    ]));

    expect(out).toBe('**C**\n\n**Do**\n\none\n\nS1\n\nI2\n\nAFTER');
  });

  it('renders nested tabs without strays as before', () => {
    const out = blocksToMarkdown(doc([
      { id: 'c', type: 'toggle', data: { text: 'C' }, content: ['tabs', 'i2'] },
      { id: 'tabs', type: 'tabs', data: {}, parent: 'c', content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 'i2', type: 'paragraph', data: { text: 'I2' }, parent: 'c' },
      { id: 'after', type: 'paragraph', data: { text: 'AFTER' } },
    ]));

    expect(out).toBe('**C**\n\n**Do**\n\none\n\nI2\n\nAFTER');
  });
});
