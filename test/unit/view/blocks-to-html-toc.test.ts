// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

const toc: OutputBlockData = { id: 'toc', type: 'table_of_contents', data: {} };

describe('blocksToHtml — table of contents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves headings without an id when the document has no table of contents', () => {
    const html = blocksToHtml(doc([
      { id: 'h1', type: 'header', data: { text: 'Intro', level: 2 } },
    ]));

    expect(html).toBe('<h2>Intro</h2>');
  });

  it('lists the headings as in-page links, and gives each heading the id its link points at', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'h1', type: 'header', data: { text: 'Intro', level: 2 } },
      { id: 'h2', type: 'header', data: { text: 'Details', level: 3 } },
    ]));

    expect(html).toBe(
      '<nav><ol>'
      + '<li data-depth="0"><a href="#h1">Intro</a></li>'
      + '<li data-depth="1"><a href="#h2">Details</a></li>'
      + '</ol></nav>'
      + '<h2 id="h1">Intro</h2><h3 id="h2">Details</h3>'
    );
  });

  it('lists a heading that comes before the table of contents', () => {
    const html = blocksToHtml(doc([
      { id: 'h1', type: 'header', data: { text: 'Title', level: 1 } },
      toc,
    ]));

    expect(html).toBe('<h1 id="h1">Title</h1><nav><ol><li data-depth="0"><a href="#h1">Title</a></li></ol></nav>');
  });

  it('indents a skipped level one step, as the editor does', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'a', type: 'header', data: { text: 'A', level: 1 } },
      { id: 'b', type: 'header', data: { text: 'B', level: 3 } },
      { id: 'c', type: 'header', data: { text: 'C', level: 2 } },
      { id: 'd', type: 'header', data: { text: 'D', level: 1 } },
    ]));

    expect(html.match(/data-depth="\d"/g)).toEqual([
      'data-depth="0"', 'data-depth="1"', 'data-depth="1"', 'data-depth="0"',
    ]);
  });

  it('links to a stored anchor instead of the block id', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'h1', type: 'header', data: { text: 'Intro', level: 2, anchor: 'h.intro' } },
    ]));

    expect(html).toBe('<nav><ol><li data-depth="0"><a href="#h.intro">Intro</a></li></ol></nav><h2 id="h.intro">Intro</h2>');
  });

  it('skips a heading it cannot link to', () => {
    const html = blocksToHtml(doc([
      toc,
      { type: 'header', data: { text: 'No id', level: 2 } },
      { id: 'h1', type: 'header', data: { text: 'Linked', level: 2 } },
    ]));

    expect(html).toBe('<nav><ol><li data-depth="0"><a href="#h1">Linked</a></li></ol></nav><h2>No id</h2><h2 id="h1">Linked</h2>');
  });

  it('skips empty headings and leaves them without an id', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'e', type: 'header', data: { text: ' <b> </b> ', level: 2 } },
      { id: 'h1', type: 'header', data: { text: 'Kept', level: 2 } },
    ]));

    expect(html).toBe('<nav><ol><li data-depth="0"><a href="#h1">Kept</a></li></ol></nav><h2>   </h2><h2 id="h1">Kept</h2>');
  });

  it('labels an entry with plain text, whitespace collapsed and equations as their source', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'h1', type: 'header', data: { text: '  <b>Bold</b>\n  and <span data-latex="x^2">x2</span>  ', level: 2 } },
    ]));

    expect(html).toContain('<a href="#h1">Bold and x^2</a>');
  });

  it('escapes the label', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'h1', type: 'header', data: { text: '&lt;script&gt; &amp; co', level: 2 } },
    ]));

    expect(html).toContain('<a href="#h1">&lt;script&gt; &amp; co</a>');
  });

  it('encodes the link and escapes the heading id when the block id is hostile', () => {
    const id = 'a b"<c>';
    const html = blocksToHtml(doc([
      toc,
      { id, type: 'header', data: { text: 'T', level: 2 } },
    ]));

    expect(html).toBe(
      `<nav><ol><li data-depth="0"><a href="#${encodeURIComponent(id)}">T</a></li></ol></nav>`
      + '<h2 id="a b&quot;&lt;c&gt;">T</h2>'
    );
  });

  it('passes each link through transformUrl', () => {
    const seen: Array<{ url: string; blockType: string | undefined }> = [];
    const html = blocksToHtml(
      doc([toc, { id: 'h1', type: 'header', data: { text: 'T', level: 2 } }]),
      {
        transformUrl: (url, ctx) => {
          seen.push({ url, blockType: ctx.blockType });

          return `/doc${url}`;
        },
      }
    );

    expect(seen).toEqual([ { url: '#h1', blockType: 'table_of_contents' } ]);
    expect(html).toContain('<a href="/doc#h1">T</a>');
  });

  it('counts headings in columns and callouts, as the editor does', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'cl', type: 'column_list', data: {} },
      { id: 'col', type: 'column', parent: 'cl', data: {} },
      { id: 'inCol', type: 'header', parent: 'col', data: { text: 'In column', level: 2 } },
      { id: 'legacy', type: 'columns', data: {} },
      { id: 'inLegacy', type: 'header', parent: 'legacy', data: { text: 'In legacy columns', level: 2 } },
      { id: 'ca', type: 'callout', data: { emoji: '💡' } },
      { id: 'inCallout', type: 'header', parent: 'ca', data: { text: 'In callout', level: 2 } },
    ]));

    expect(html.match(/<a href="#[^"]+">[^<]+<\/a>/g)).toEqual([
      '<a href="#inCol">In column</a>',
      '<a href="#inLegacy">In legacy columns</a>',
      '<a href="#inCallout">In callout</a>',
    ]);
  });

  it('leaves out headings folded inside a toggle, a list, a quote or a toggle heading', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true } },
      { id: 'inToggle', type: 'header', parent: 'tg', data: { text: 'In toggle', level: 2 } },
      { id: 'li', type: 'list', data: { text: 'Item', style: 'unordered' } },
      { id: 'inList', type: 'header', parent: 'li', data: { text: 'In list', level: 2 } },
      { id: 'q', type: 'quote', data: { text: 'Quote' } },
      { id: 'inQuote', type: 'header', parent: 'q', data: { text: 'In quote', level: 2 } },
      { id: 'th', type: 'header', data: { text: 'Section', level: 2, isToggleable: true, isOpen: true } },
      { id: 'inSection', type: 'header', parent: 'th', data: { text: 'In section', level: 3 } },
      { id: 'cl', type: 'column_list', data: {} },
      { id: 'col', type: 'column', parent: 'cl', data: {} },
      { id: 'tg2', type: 'toggle', parent: 'col', data: { text: 'Toggle in column' } },
      { id: 'deep', type: 'header', parent: 'tg2', data: { text: 'Toggle in column', level: 2 } },
    ]));

    expect(html.match(/<a href="#[^"]+">[^<]+<\/a>/g)).toEqual([ '<a href="#th">Section</a>' ]);
    expect(html).toContain('<h3>In section</h3>');
    expect(html).not.toContain('id="inToggle"');
  });

  it('renders nothing when the document has no headings to list', () => {
    expect(blocksToHtml(doc([toc, { id: 'p', type: 'paragraph', data: { text: 'Body' } }]))).toBe('<p>Body</p>');
    expect(blocksToHtml(doc([toc]), { toolAttributes: true, blockIds: true, classes: true })).toBe('');
  });

  it('survives a parent cycle', () => {
    const html = blocksToHtml(doc([
      toc,
      { id: 'x', type: 'callout', parent: 'y', data: {} },
      { id: 'y', type: 'callout', parent: 'x', data: {} },
      { id: 'h1', type: 'header', data: { text: 'Still here', level: 2 } },
    ]));

    expect(html).toContain('<a href="#h1">Still here</a>');
  });

  it('carries the editor hooks in parity mode', () => {
    const html = blocksToHtml(
      doc([
        toc,
        { id: 'h1', type: 'header', data: { text: 'Intro', level: 1 } },
        { id: 'h2', type: 'header', data: { text: 'Details', level: 2 } },
      ]),
      { classes: true, toolAttributes: true }
    );

    expect(html).toContain(
      '<nav data-blok-tool="table_of_contents" data-blok-toc><ol data-blok-toc-list role="list">'
      + '<li data-depth="0" style="--blok-toc-depth: 0"><a href="#h1" data-blok-toc-link><span>Intro</span></a></li>'
      + '<li data-depth="1" style="--blok-toc-depth: 1"><a href="#h2" data-blok-toc-link><span>Details</span></a></li>'
      + '</ol></nav>'
    );
    expect(html).toMatch(/<h1 [^>]*id="h1"/);
  });

  it('gives no id to headings when a custom renderer draws the table of contents', () => {
    const html = blocksToHtml(
      doc([toc, { id: 'h1', type: 'header', data: { text: 'Intro', level: 2 } }]),
      { renderers: { table_of_contents: () => '<div>custom</div>' } }
    );

    expect(html).toBe('<div>custom</div><h2>Intro</h2>');
  });
});
