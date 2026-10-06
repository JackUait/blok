// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBlokVersion } from '../../../src/components/utils/version';
import { pageIndex } from '../../../src/view/page-index';
import { invoke } from '../../../src/view/server-runtime';

describe('server runtime boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs through one global boundary without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(Reflect.get(globalThis, 'blokServerInvoke')).toBe(invoke);
  });

  it('converts Markdown into a serialized OutputData envelope', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"# Hello"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'header', data: { text: 'Hello', level: 1 } }],
    });
  });

  it('loads the inlined math extensions', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"$$E = mc^2$$"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'code', data: { code: 'E = mc^2', language: 'latex' } }],
    });
  });

  /**
   * The asymmetry this closes: `blocksToPlainText` answers '' both for a
   * document with no text and for one made entirely of tools it does not know.
   */
  it('reports the blocks the plain-text reader could make nothing of', async () => {
    const output = JSON.parse(await invoke(
      'blocksToPlainTextWithReport',
      '{"blocks":[{"type":"org-chart","data":{}}]}'
    )) as unknown;

    expect(output).toMatchObject({
      text: '',
      warnings: [{ construct: 'org-chart', action: 'dropped' }],
    });
  });

  it('counts a malformed block in the plain-text report, as Markdown does', async () => {
    const output = JSON.parse(await invoke(
      'blocksToPlainTextWithReport',
      '{"blocks":[{"type":"paragraph","data":{"text":"Kept"}},{"nope":1}]}'
    )) as unknown;

    expect(output).toMatchObject({
      text: 'Kept',
      warnings: [{ construct: 'block', action: 'dropped', detail: '1 malformed block was skipped' }],
    });
  });

  it('answers the cheap questions about a document without converting it', async () => {
    const output = JSON.parse(await invoke(
      'inspect',
      '{"blocks":[{"type":"paragraph","data":{"text":"Body"}},{"type":"org-chart","data":{}},{"nope":1}]}'
    )) as unknown;

    expect(output).toEqual({
      blockCount: 2,
      malformedBlockCount: 1,
      isEmpty: false,
      unrecognizedBlockTypes: ['org-chart'],
    });
  });

  it('tells an empty document from one it recognised nothing in', async () => {
    const empty = JSON.parse(await invoke('inspect', '{"blocks":[]}')) as unknown;
    const unreadable = JSON.parse(await invoke('inspect', '{"blocks":[{"type":"gantt","data":{}}]}')) as unknown;

    expect(empty).toMatchObject({ isEmpty: true, blockCount: 0, unrecognizedBlockTypes: [] });
    expect(unreadable).toMatchObject({ isEmpty: true, blockCount: 1, unrecognizedBlockTypes: ['gantt'] });
  });

  it('converts HTML into a serialized OutputData envelope with a report', async () => {
    const output = JSON.parse(await invoke('htmlToBlocks', '{"html":"<h1>Hello</h1>"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'header', data: { text: 'Hello', level: 1 } }],
      warnings: [],
    });
  });

  it('reports what the HTML could not carry', async () => {
    const output = JSON.parse(
      await invoke('htmlToBlocks', '{"html":"<p>a</p><iframe src=\\"https://x.dev\\"></iframe>"}')
    ) as { warnings: unknown[] };

    expect(output.warnings).toEqual([
      { construct: 'iframe', action: 'dropped', detail: expect.stringContaining('iframe') },
    ]);
  });

  it('rejects an htmlToBlocks input with no html string', async () => {
    await expect(invoke('htmlToBlocks', '{}')).rejects.toThrow(TypeError);
  });

  it('renders a serialized document to HTML', async () => {
    const html = await invoke(
      'blocksToHtml',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(html).toBe('<p>Hi <b>there</b></p>');
  });

  it('preserves the renderer parentId hierarchy alias', async () => {
    const html = await invoke(
      'blocksToHtml',
      JSON.stringify({
        blocks: [
          { id: 'toggle', type: 'toggle', data: { text: 'Parent', isOpen: true } },
          { id: 'child', type: 'paragraph', parentId: 'toggle', data: { text: 'Child' } },
        ],
      })
    );

    expect(html).toBe('<details open><summary>Parent</summary><p>Child</p></details>');
  });

  it('orders children by the parent content, then unlisted ones', async () => {
    const html = await invoke(
      'blocksToHtml',
      JSON.stringify({
        blocks: [
          { id: 't', type: 'toggle', data: { text: 'Parent', isOpen: true }, content: ['b', 'a'] },
          { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
          { id: 'c', type: 'paragraph', parent: 't', data: { text: 'C' } },
          { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
        ],
      })
    );

    expect(html).toBe('<details open><summary>Parent</summary><p>B</p><p>A</p><p>C</p></details>');
  });

  /**
   * `content[]` is the canonical containment form, and the boundary used to
   * read only `parent` — so a document that declares containment one way lost
   * it here and its children escaped their container.
   */
  it('preserves containment declared only by content', async () => {
    const html = await invoke(
      'blocksToHtml',
      JSON.stringify({
        blocks: [
          { id: 'toggle', type: 'toggle', data: { text: 'Parent', isOpen: true }, content: ['child'] },
          { id: 'child', type: 'paragraph', data: { text: 'Child' } },
        ],
      })
    );

    expect(html).toBe('<details open><summary>Parent</summary><p>Child</p></details>');
  });

  it('reports a content reference the document does not carry', async () => {
    const report = JSON.parse(await invoke(
      'blocksToMarkdown',
      JSON.stringify({
        blocks: [{ id: 'l1', type: 'list', data: { text: 'item', style: 'unordered' }, content: ['gone'] }],
      })
    )) as unknown;

    expect(report).toMatchObject({
      warnings: [
        { construct: 'list',
          action: 'dropped',
          detail: '1 child block reference could not be resolved and was dropped' },
      ],
    });
  });

  it('renders a serialized document to plain text', async () => {
    const plainText = await invoke(
      'blocksToPlainText',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(plainText).toBe('Hi there');
  });

  it('refuses a document without a blocks array', async () => {
    await expect(invoke('blocksToHtml', '{"wrong":[]}')).rejects.toThrow('`blocks` array');
  });

  /**
   * This case used to assert the opposite — that a malformed block is refused
   * rather than silently dropped. The objection was to the SILENCE, not to the
   * dropping: a document conversion reports one now. HTML and plain text carry
   * no report channel, so for those two the skip is still silent, which is the
   * price of not losing a whole stored article to one bad entry.
   */
  it('skips a malformed block instead of failing the whole document', async () => {
    const html = await invoke('blocksToHtml', '{"blocks":[{"type":42,"data":{"text":"lost"}}]}');

    expect(html).toBe('');
  });

  it('skips a block that is not an object and reports it', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Kept' } },
        7,
      ],
    }));
    const result = JSON.parse(output) as { markdown: string; warnings: unknown[] };

    expect(result.markdown).toBe('Kept');
    expect(result.warnings).toEqual([
      { construct: 'block', action: 'dropped', detail: '1 malformed block was skipped' },
    ]);
  });

  it('skips a block whose type is missing', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [{ id: 'x', data: { text: 'Orphan' } }],
    }));
    const result = JSON.parse(output) as { markdown: string; warnings: unknown[] };

    expect(result.markdown).toBe('');
    expect(result.warnings).toHaveLength(1);
  });

  it('reports several malformed blocks as one degradation', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [null, { type: 'paragraph', data: { text: 'Kept' } }, 'nope'],
    }));
    const result = JSON.parse(output) as { warnings: Array<{ detail: string }> };

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].detail).toBe('2 malformed blocks were skipped');
  });

  it('never writes a script-capable URL into Markdown', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [
        { type: 'paragraph', data: { text: '<a href="javascript:alert(1)">js</a> <img src="javascript:alert(1)" alt="i">' } },
        { type: 'image', data: { url: 'javascript:alert(1)', alt: 'Alt' } },
      ],
    }));
    const result = JSON.parse(output) as { markdown: string };

    expect(result.markdown).toBe('js \n\nAlt');
  });

  it('never lets a URL break out of its Markdown destination', async () => {
    const output = await invoke('blocksToMarkdown', JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: '<a href="https://ok.example/x) [evil](javascript:alert(1)">b</a>' } }],
    }));
    const result = JSON.parse(output) as { markdown: string };

    expect(result.markdown).not.toContain('](javascript:');
    expect(result.markdown).not.toContain(' ');
  });

  it('still rejects input that is not a document at all', async () => {
    await expect(invoke('blocksToMarkdown', JSON.stringify({ notBlocks: [] })))
      .rejects.toThrow(TypeError);
  });

  it('skips malformed blocks for plain text too', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: 'Kept' } }, null],
    }));

    expect(output).toContain('Kept');
  });

  it('hands out the saved format as JSON Schema', async () => {
    const schema = JSON.parse(await invoke('schema', '{}')) as Record<string, Record<string, unknown>>;

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$defs.paragraph).toBeDefined();
  });

  it('extracts a document\'s translatable strings', async () => {
    const output = JSON.parse(await invoke('extractTexts', JSON.stringify({
      document: {
        blocks: [
          { id: 'h', type: 'header', data: { text: 'Title' } },
          { id: 'i', type: 'image', data: { url: 'u', caption: 'A cat' } },
          { id: 'c', type: 'code', data: { code: 'const a = 1;' } },
        ],
      },
    }))) as unknown;

    expect(output).toEqual(['Title', 'A cat']);
  });

  it('includes code only when asked', async () => {
    const document = { blocks: [{ id: 'c', type: 'code', data: { code: 'const a = 1;' } }] };

    expect(JSON.parse(await invoke('extractTexts', JSON.stringify({ document, includeCode: true }))))
      .toEqual(['const a = 1;']);
  });

  /**
   * The one operation whose output is STORED. `parseDocument` drops a block it
   * cannot read, which is right for the read-only operations and would be a
   * silently deleted block here — so this one never goes through it.
   */
  it('injects translations without dropping a block it cannot read', async () => {
    const output = JSON.parse(await invoke('injectTexts', JSON.stringify({
      document: {
        time: 1700000000000,
        version: '1.12.0',
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: 'Hello' } },
          7,
          { id: 'n', data: { text: 'No type' } },
        ],
      },
      texts: ['Привет'],
    }))) as unknown;

    expect(output).toEqual({
      document: {
        time: 1700000000000,
        version: '1.12.0',
        blocks: [
          { id: 'p', type: 'paragraph', data: { text: 'Привет' } },
          7,
          { id: 'n', data: { text: 'No type' } },
        ],
      },
    });
  });

  it('reports a translation list that does not match the document', async () => {
    const output = JSON.parse(await invoke('injectTexts', JSON.stringify({
      document: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Hello' } }] },
      texts: ['Привет', 'Лишнее'],
    }))) as unknown;

    expect(output).toEqual({ mismatch: { expected: 1, received: 2 } });
  });

  /**
   * Compared against the editor's own function, not a literal: the point of the
   * operation is that both sides stamp the SAME version, and a literal here
   * would keep passing while they drifted apart.
   */
  it('reports the same version the editor stamps into a saved document', async () => {
    expect(await invoke('version', '{}')).toBe(getBlokVersion());
  });

  it('refuses an unknown operation', async () => {
    await expect(invoke('unknown', '{}')).rejects.toThrow('Unsupported Blok runtime operation');
  });

  /**
   * Plain text now takes either shape: a bare document (what every caller sent
   * before the flag existed) or an envelope carrying the options beside it.
   * A saved document always has `blocks`, so the two never collide.
   */
  it('reads plain text from a bare document, as before', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }],
    }));

    expect(output).toBe('Cap');
  });

  it('reads plain text from an envelope without the flag', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }] },
    }));

    expect(output).toBe('Cap');
  });

  it('includes hidden text only when the envelope asks', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap', alt: 'A tabby cat' } }] },
      includeHiddenText: true,
    }));

    expect(output).toBe('Cap\nA tabby cat');
  });

  it('still skips malformed blocks inside an envelope', async () => {
    const output = await invoke('blocksToPlainText', JSON.stringify({
      document: { blocks: [{ type: 'paragraph', data: { text: 'Kept' } }, null] },
      includeHiddenText: true,
    }));

    expect(output).toBe('Kept');
  });

  it('rejects an envelope whose document is not a document', async () => {
    await expect(invoke('blocksToPlainText', JSON.stringify({ document: { notBlocks: [] } })))
      .rejects.toThrow(TypeError);
  });

  describe('page-aware export', () => {
    /** The page glyph and lock are SVG; the labels and links are what matter. */
    const stripSvg = (html: string): string => html.replace(/<svg[\s\S]*?<\/svg>/g, '');

    const pageDocument = {
      blocks: [
        { id: 'b1', type: 'page', data: { pageId: 'p-ok' } },
        { id: 'b2', type: 'page-link', data: { pageId: 'p-denied' } },
        { id: 'b3', type: 'page-link', data: { pageId: 'p-missing' } },
        { id: 'b4', type: 'page', data: { pageId: 'p-absent' } },
        { id: 'b5', type: 'paragraph', data: { text: 'See <a data-blok-page-id="p-ok">x</a> and <a data-blok-page-id="p-denied">x</a>.' } },
      ],
    };
    const pages = {
      'p-ok': { title: 'Roadmap', icon: { type: 'emoji', value: '🚀' }, href: '/p/ok' },
      'p-denied': { access: 'none', title: 'Secret', href: '/p/denied' },
      'p-missing': null,
    };

    it('renders allowed, denied, missing and unlisted pages to HTML', async () => {
      const html = stripSvg(await invoke('blocksToHtmlWithPages', JSON.stringify({ document: pageDocument, pages })));

      expect(html).toBe(
        '<div><a href="/p/ok"><span aria-hidden="true">🚀</span><span>Roadmap</span></a></div>'
        + '<div><span><span aria-hidden="true"></span><span>No access</span></span></div>'
        + '<div><span><span aria-hidden="true"></span><span>Page not found</span></span></div>'
        + '<div><span><span aria-hidden="true"></span><span>Page</span></span></div>'
        + '<p>See <a data-blok-page-id="p-ok" href="/p/ok">Roadmap</a> and <a data-blok-page-id="p-denied">Page</a>.</p>'
      );
      expect(html).not.toContain('Secret');
      expect(html).not.toContain('/p/denied');
    });

    it('gives Markdown the page titles', async () => {
      const output = await invoke('blocksToMarkdownWithPages', JSON.stringify({
        document: pageDocument,
        pages: { 'p-ok': { title: 'Roadmap' }, 'p-denied': { access: 'none' }, 'p-missing': null },
      }));
      const result = JSON.parse(output) as { markdown: string };

      expect(result.markdown).toBe('Roadmap\n\nNo access\n\nPage not found\n\nPage\n\nSee Roadmap and Page.');
    });

    it('links allowed pages in Markdown, and keeps only the title for a script href', async () => {
      const output = await invoke('blocksToMarkdownWithPages', JSON.stringify({
        document: pageDocument,
        pages: { ...pages, 'p-absent': { title: 'Js', href: 'javascript:alert(1)' } },
      }));
      const result = JSON.parse(output) as { markdown: string; warnings: Array<{ construct: string }> };

      expect(result.markdown).toBe('[Roadmap](/p/ok)\n\nNo access\n\nPage not found\n\nJs\n\nSee [Roadmap](/p/ok) and Page.');
      expect(result.warnings.map((warning) => warning.construct)).toEqual(['page-link', 'page-link', 'page']);
    });

    it('still skips and reports a malformed block inside the envelope', async () => {
      const output = await invoke('blocksToMarkdownWithPages', JSON.stringify({
        document: { blocks: [{ type: 'paragraph', data: { text: 'Kept' } }, null] },
        pages: {},
      }));
      const result = JSON.parse(output) as { markdown: string; warnings: Array<{ detail: string }> };

      expect(result.markdown).toBe('Kept');
      expect(result.warnings.map((warning) => warning.detail)).toEqual(['1 malformed block was skipped']);
    });

    it('drops a script-capable page href', async () => {
      const html = await invoke('blocksToHtmlWithPages', JSON.stringify({
        document: pageDocument,
        pages: { 'p-ok': { title: 'T', href: 'javascript:alert(1)' } },
      }));

      expect(html).not.toContain('href=');
      expect(html).toContain('<span>T</span>');
    });

    it('never resolves a prototype key the map does not own', async () => {
      const html = stripSvg(await invoke('blocksToHtmlWithPages', JSON.stringify({
        document: {
          blocks: ['__proto__', 'toString', 'constructor'].map((pageId) => ({ type: 'page-link', data: { pageId } })),
        },
        pages: {},
      })));

      expect(html).toBe('<div><span><span aria-hidden="true"></span><span>Page</span></span></div>'.repeat(3));
    });

    /** `JSON.stringify({ __proto__: … })` would set the prototype, so this is a literal. */
    it('resolves an own __proto__ key in the map', async () => {
      const html = stripSvg(await invoke(
        'blocksToHtmlWithPages',
        '{"document":{"blocks":[{"type":"page-link","data":{"pageId":"__proto__"}},{"type":"page-link","data":{"pageId":"toString"}}]},'
        + '"pages":{"__proto__":{"title":"OwnProto","href":"/p/__proto__"}}}'
      ));

      expect(html).toBe(
        '<div><a href="/p/__proto__"><span aria-hidden="true"></span><span>OwnProto</span></a></div>'
        + '<div><span><span aria-hidden="true"></span><span>Page</span></span></div>'
      );
    });

    it.each([['an array', []], ['a string', 'x'], ['null', null]])('ignores pages that are %s', async (_name, value) => {
      const html = stripSvg(await invoke('blocksToHtmlWithPages', JSON.stringify({
        document: { blocks: [{ type: 'page-link', data: { pageId: '0' } }] },
        pages: value,
      })));

      expect(html).toBe('<div><span><span aria-hidden="true"></span><span>Page</span></span></div>');
    });

    it('reads pages only from the envelope, never from inside the document', async () => {
      const html = stripSvg(await invoke('blocksToHtmlWithPages', JSON.stringify({
        document: { blocks: [{ type: 'page-link', data: { pageId: 'p1' } }], pages: { p1: { title: 'Forged', href: '/forged' } } },
        pages: {},
      })));

      expect(html).toBe('<div><span><span aria-hidden="true"></span><span>Page</span></span></div>');
    });

    it('refuses input with no document record', async () => {
      await expect(invoke('blocksToHtmlWithPages', JSON.stringify(pageDocument))).rejects.toThrow(TypeError);
      await expect(invoke('blocksToMarkdownWithPages', JSON.stringify({ document: [], pages }))).rejects.toThrow(TypeError);
    });

    /** The shipped ops stay bare-only: an envelope there must not set page metadata. */
    it('keeps the old operations bare-only', async () => {
      await expect(invoke('blocksToHtml', JSON.stringify({ document: pageDocument, pages })))
        .rejects.toThrow('Document input requires a `blocks` array');
      await expect(invoke('blocksToMarkdown', JSON.stringify({ document: pageDocument, pages })))
        .rejects.toThrow('Document input requires a `blocks` array');
    });

    it('ignores top-level pages on a bare document sent to the old operations', async () => {
      const forged = { blocks: [{ type: 'page-link', data: { pageId: 'p1' } }], pages: { p1: { title: 'Forged', href: '/forged' } } };
      const html = stripSvg(await invoke('blocksToHtml', JSON.stringify(forged)));
      const markdown = JSON.parse(await invoke('blocksToMarkdown', JSON.stringify(forged))) as { markdown: string };

      expect(html).toBe('<div><span><span aria-hidden="true"></span><span>Page</span></span></div>');
      expect(markdown.markdown).toBe('Page');
    });
  });

  describe('pageIndex', () => {
    const indexedDocument = {
      blocks: [
        { id: 'own', type: 'page', data: { pageId: 'pg-child' } },
        { id: 'p', type: 'paragraph', data: { text: 'See <a data-blok-page-id="pg-ref">x</a>' } },
        { id: 'lnk', type: 'page-link', data: { pageId: 'pg-link' } },
      ],
    };

    it('indexes the document inside the envelope', async () => {
      const output = JSON.parse(await invoke('pageIndex', JSON.stringify({ document: indexedDocument }))) as unknown;

      expect(output).toEqual(pageIndex(indexedDocument));
      expect(output).toEqual({
        owners: [{ pageId: 'pg-child', sourceBlockId: 'own', order: 0 }],
        text: [
          { blockId: 'own', order: 0, text: '' },
          { blockId: 'p', order: 1, text: 'See Page' },
          { blockId: 'lnk', order: 2, text: 'Page' },
        ],
        references: [
          { pageId: 'pg-ref', sourceBlockId: 'p', order: 1 },
          { pageId: 'pg-link', sourceBlockId: 'lnk', order: 2 },
        ],
      });
    });

    /** A Node host calls pageIndex on the raw document; dropping bad blocks first would shift every order. */
    it('keeps the raw block orders of a document with malformed blocks', async () => {
      const malformed = {
        blocks: [
          null,
          5,
          { type: 'paragraph', data: 'x' },
          { id: 3, type: 'page', data: { pageId: 'z' } },
          { id: 'ok', type: 'page', data: { pageId: 'y' } },
          { id: 'p', type: 'paragraph', data: { text: '<a data-blok-page-id="r">x</a>' } },
        ],
      };
      const output = JSON.parse(await invoke('pageIndex', JSON.stringify({ document: malformed }))) as ReturnType<typeof pageIndex>;

      expect(output.owners).toEqual([{ pageId: 'y', sourceBlockId: 'ok', order: 2 }]);
      expect(output.references).toEqual([{ pageId: 'r', sourceBlockId: 'p', order: 3 }]);
      expect(output).toEqual(pageIndex(malformed as never));
    });

    it.each([
      ['a bare document', { blocks: [] }],
      ['no blocks array', { document: { blocks: 'x' } }],
      ['a document that is not a record', { document: [] }],
    ])('refuses %s', async (_name, input) => {
      await expect(invoke('pageIndex', JSON.stringify(input)))
        .rejects.toThrow(new TypeError('pageIndex input requires a `document` with a `blocks` array.'));
    });
  });

  describe('remapPageDocument', () => {
    const remapInput = (document: unknown, blockIds: unknown, pageIds: unknown = {}): string =>
      JSON.stringify({ document, blockIds, pageIds });

    const source = {
      time: 1759670000000,
      version: '1.15.2',
      blocks: [
        { id: 'h1', type: 'header', data: { text: 'Go <a href="#p2">down</a>', level: 2 }, tunes: { anchor: { id: 'top' } } },
        { id: 'own', type: 'page', data: { pageId: 'pg-a' }, custom: 'kept' },
        { id: 'p2', type: 'paragraph', data: { text: 'See <a data-blok-page-id="pg-ref">x</a>' } },
      ],
    };
    const blockIds = { h1: 'H1', own: 'OWN', p2: 'P2' };

    it('remaps ids and keeps tunes, time and unknown keys', async () => {
      const output = JSON.parse(await invoke('remapPageDocument', remapInput(source, blockIds, { 'pg-a': 'PG-A', 'pg-ref': 'PG-REF' }))) as unknown;

      expect(output).toEqual({
        document: {
          time: 1759670000000,
          version: '1.15.2',
          blocks: [
            { id: 'H1', type: 'header', data: { text: 'Go <a href="#P2">down</a>', level: 2 }, tunes: { anchor: { id: 'top' } } },
            { id: 'OWN', type: 'page', data: { pageId: 'PG-A' }, custom: 'kept' },
            { id: 'P2', type: 'paragraph', data: { text: 'See <a data-blok-page-id="PG-REF">x</a>' } },
          ],
        },
      });
    });

    it('answers every id problem as data, legacy-nested ids included', async () => {
      const document = {
        blocks: [
          { id: 'a', type: 'paragraph', parent: 'gone-parent', data: { text: '' } },
          { id: 'b', type: 'paragraph', data: { text: '' } },
          { type: 'paragraph', data: { text: 'idless' } },
          { id: 'co', type: 'callout', data: { body: { blocks: [{ id: 'nested', type: 'page', data: { pageId: 'p' } }] } } },
        ],
      };
      const output = JSON.parse(await invoke('remapPageDocument', remapInput(document, { a: 'X', b: 'X', co: 'CO' }))) as unknown;

      expect(output).toEqual({
        unmapped: { missingBlockIds: ['gone-parent', 'nested'], duplicateBlockIds: ['X'], idlessBlocks: 1 },
      });
    });

    it('reads only string mappings', async () => {
      const output = JSON.parse(await invoke('remapPageDocument', remapInput(
        { blocks: [{ id: 'a', type: 'page', data: { pageId: 'p' } }] },
        { a: 5 },
        { p: 7 }
      ))) as unknown;

      expect(output).toEqual({ unmapped: { missingBlockIds: ['a'], duplicateBlockIds: [], idlessBlocks: 0 } });
    });

    /** JSON.stringify would set the prototype rather than write the key, so this is a literal. */
    it('keeps an own __proto__ key and maps an own __proto__ id', async () => {
      const output = await invoke(
        'remapPageDocument',
        '{"document":{"blocks":[{"id":"__proto__","type":"paragraph","data":{"text":"x","__proto__":{"keep":"me"}}}]},'
        + '"blockIds":{"__proto__":"new"},"pageIds":{}}'
      );

      expect(output).toBe('{"document":{"blocks":[{"id":"new","type":"paragraph","data":{"text":"x","__proto__":{"keep":"me"}}}]}}');
    });

    it.each([
      ['a bare document', { blocks: [] }],
      ['a document with no blocks array', { document: { blocks: {} }, blockIds: {}, pageIds: {} }],
      ['block ids that are not a record', { document: { blocks: [] }, blockIds: [], pageIds: {} }],
      ['page ids that are not a record', { document: { blocks: [] }, blockIds: {}, pageIds: 'x' }],
    ])('refuses %s with a TypeError', async (_name, input) => {
      await expect(invoke('remapPageDocument', JSON.stringify(input))).rejects.toThrow(TypeError);
      await expect(invoke('remapPageDocument', JSON.stringify(input))).rejects.not.toThrow('Unsupported');
    });

    /** The C# host reports a plain Error as Unknown, so a caller mistake in a real document must arrive as data. */
    it.each([
      ['a missing own id', { blocks: [{ id: 'a', type: 'paragraph', data: { text: '' } }] }, {}],
      ['a dangling parent', { blocks: [{ id: 'a', type: 'paragraph', parent: 'x', data: { text: '' } }] }, { a: 'A' }],
      ['a dangling content id', { blocks: [{ id: 'a', type: 'toggle', content: ['x'], data: { text: '' } }] }, { a: 'A' }],
      ['a dangling cell id', { blocks: [{ id: 't', type: 'table', data: { content: [[{ blocks: ['x'] }]] } }] }, { t: 'T' }],
      ['an empty mapping', { blocks: [{ id: 'a', type: 'paragraph', data: { text: '' } }] }, { a: '' }],
      ['a non-string mapping', { blocks: [{ id: 'a', type: 'paragraph', data: { text: '' } }] }, { a: null }],
      ['a duplicate target', { blocks: [{ id: 'a', type: 'paragraph' }, { id: 'b', type: 'paragraph' }] }, { a: 'X', b: 'X' }],
      ['an idless block', { blocks: [{ type: 'paragraph', data: { text: '' } }] }, {}],
      ['a legacy body child id', { blocks: [{ id: 'c', type: 'callout', data: { body: { blocks: [{ id: 'n', type: 'paragraph', data: { text: '' } }] } } }] }, { c: 'C' }],
      ['a data-less page block', { blocks: [{ id: 'a', type: 'page' }] }, { a: 'A' }],
      ['a data-less table block', { blocks: [{ id: 'a', type: 'table' }] }, { a: 'A' }],
      ['a non-record block', { blocks: [5, null, 'x'] }, {}],
    ])('answers as data for %s', async (_name, document, ids) => {
      const outcome = await invoke('remapPageDocument', remapInput(document, ids)).then(
        (output) => JSON.parse(output) as Record<string, unknown>,
        (error: unknown) => error
      );

      expect(outcome).not.toBeInstanceOf(Error);
      expect(Object.keys(outcome as Record<string, unknown>)).toEqual([expect.stringMatching(/^(document|unmapped)$/)]);
    });
  });
});
