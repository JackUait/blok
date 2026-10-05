import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../types';
import { blocksToHtml, remapPageDocument } from '../../../src/view';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });
const ids = {
  blockIds: new Map([
    ['old-block', 'new-block'],
    ['child', 'new-child'],
    ['ptr', 'new-ptr'],
    ['link', 'new-link'],
  ]),
  pageIds: new Map([['old-page', 'new-page']]),
};

describe('remapPageDocument', () => {
  it('rewrites structural and typed references without rewriting ordinary text or URLs', () => {
    const original = doc([
      { id: 'old-block', type: 'toggle', content: ['child'], data: { text: 'old-block' } },
      {
        id: 'child',
        type: 'paragraph',
        parent: 'old-block',
        data: {
          text: '<a data-blok-page-id="old-page" href="/secret" title="Secret">Page</a> <a href="#old-block">Top</a> <a href="https://x.test/old-page">External</a> old-page',
        },
      },
      { id: 'ptr', type: 'page', data: { pageId: 'old-page' } },
      { id: 'link', type: 'page-link', data: { pageId: 'old-page' } },
    ]);
    const before = JSON.stringify(original);

    const copied = remapPageDocument(original, ids);

    expect(copied.blocks[0]?.data.text).toBe('old-block');
    expect(copied.blocks[1]?.data.text).toContain('href="https://x.test/old-page"');
    expect(copied.blocks[1]?.data.text).toContain(' old-page');
    expect(copied.blocks[0]?.id).toBe('new-block');
    expect(copied.blocks[0]?.content).toEqual(['new-child']);
    expect(copied.blocks[1]?.id).toBe('new-child');
    expect(copied.blocks[1]?.parent).toBe('new-block');
    expect(copied.blocks[1]?.data.text).toContain('data-blok-page-id="new-page"');
    expect(copied.blocks[1]?.data.text).toContain('href="#new-block"');
    expect(copied.blocks[2]?.data.pageId).toBe('new-page');
    expect(copied.blocks[3]?.data.pageId).toBe('new-page');
    expect(JSON.stringify(original)).toBe(before);
  });

  it('remaps a block link whose fragment is URL-encoded', () => {
    const original = doc([
      { id: 'section/1', type: 'paragraph', data: { text: 'Heading' } },
      { id: 'link', type: 'paragraph', data: { text: '<a href="#section%2F1">Jump</a>' } },
    ]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['section/1', 'copy/1'], ['link', 'copy-link']]),
      pageIds: new Map(),
    });

    expect(copied.blocks[1]?.data.text).toContain('href="#copy%2F1"');
    expect(original.blocks[1]?.data.text).toContain('href="#section%2F1"');
  });

  it('rewrites a page reference despite malformed UTF-16 in the same field', () => {
    const original = doc([{
      id: 'old-block',
      type: 'paragraph',
      data: { text: '<a data-blok-page-id="old-page">Page</a>\uDC00\uDC00' },
    }]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.text).toContain('data-blok-page-id="new-page"');
    expect(original.blocks[0]?.data.text).toContain('data-blok-page-id="old-page"');
  });

  it('imports three permitted levels and renders copied links from host metadata', () => {
    const rootBody = doc([
      {
        id: 'root-text', type: 'paragraph', data: {
          text: '<a href="https://outside.test/child">External</a> <a data-blok-page-id="child">Page</a> <a data-blok-page-id="restricted-sibling">Page</a> <a href="#root-pointer">Jump</a> child',
        },
      },
      { id: 'root-pointer', type: 'page', data: { pageId: 'child' } },
      { id: 'outside-link', type: 'page-link', data: { pageId: 'restricted-sibling', title: 'Private sibling' } },
    ]);
    const childBody = doc([
      { id: 'child-text', type: 'paragraph', data: { text: '<a data-blok-page-id="grandchild">Page</a> <a href="#child-pointer">Jump</a>' } },
      { id: 'child-pointer', type: 'page', data: { pageId: 'grandchild' } },
    ]);
    const grandchildBody = doc([
      { id: 'grandchild-text', type: 'paragraph', data: { text: 'Deep body' } },
    ]);
    const pageIds = new Map([
      ['root', 'copy-root'],
      ['child', 'copy-child'],
      ['grandchild', 'copy-grandchild'],
    ]);
    const copiedRoot = remapPageDocument(rootBody, {
      blockIds: new Map([
        ['root-text', 'copy-root-text'],
        ['root-pointer', 'copy-root-pointer'],
        ['outside-link', 'copy-outside-link'],
      ]),
      pageIds,
    });
    const copiedChild = remapPageDocument(childBody, {
      blockIds: new Map([
        ['child-text', 'copy-child-text'],
        ['child-pointer', 'copy-child-pointer'],
      ]),
      pageIds,
    });
    const copiedGrandchild = remapPageDocument(grandchildBody, {
      blockIds: new Map([['grandchild-text', 'copy-grandchild-text']]),
      pageIds,
    });
    const allowedPageInfo = new Map([
      ['copy-child', { title: 'Copied child' }],
      ['copy-grandchild', { title: 'Copied grandchild' }],
    ]);
    const render = (body: OutputData): string => blocksToHtml(body, {
      pageInfo: (id) => allowedPageInfo.get(id),
      pageHref: (id) => `pages/${id}.html`,
    });

    const copiedRootText = copiedRoot.blocks[0]?.data.text;

    expect(copiedRootText).toContain('href="https://outside.test/child"');
    expect(copiedRootText).toContain(' child');
    expect(copiedRootText).toContain('data-blok-page-id="copy-child"');
    expect(copiedRootText).toContain('href="#copy-root-pointer"');
    expect(copiedRoot.blocks[1]?.data.pageId).toBe('copy-child');
    expect(copiedRoot.blocks[2]?.type).toBe('page-link');
    expect(copiedRoot.blocks[2]?.data.pageId).toBe('restricted-sibling');
    expect(copiedChild.blocks[0]?.data.text).toContain('data-blok-page-id="copy-grandchild"');
    expect(copiedChild.blocks[0]?.data.text).toContain('href="#copy-child-pointer"');
    expect(copiedChild.blocks[1]?.data.pageId).toBe('copy-grandchild');
    expect(copiedGrandchild.blocks[0]?.id).toBe('copy-grandchild-text');

    const rootHtml = render(copiedRoot);
    const childHtml = render(copiedChild);
    const grandchildHtml = render(copiedGrandchild);
    const inlineAnchor = rootHtml.match(/<a\b[^>]*data-blok-page-id="copy-child"[^>]*>/)?.[0];

    expect(inlineAnchor).toContain('href="pages/copy-child.html"');
    expect(rootHtml).toContain('href="https://outside.test/child"');
    expect(rootHtml).toContain('href="pages/copy-child.html"');
    expect(childHtml).toContain('href="pages/copy-grandchild.html"');
    expect(grandchildHtml).toContain('Deep body');
    expect(rootHtml.match(/<a\b[^>]*data-blok-page-id="restricted-sibling"[^>]*>/)?.[0])
      .not.toContain('href=');
    expect(rootHtml).not.toContain('Private sibling');
    expect(rootHtml).not.toContain('pages/restricted-sibling.html');

    const unsafeHtml = blocksToHtml(copiedRoot, {
      pageInfo: (id) => allowedPageInfo.get(id),
      pageHref: () => 'javascript:alert(1)',
    });

    expect(unsafeHtml.match(/<a\b[^>]*data-blok-page-id="copy-child"[^>]*>/)?.[0])
      .not.toContain('href=');
  });

  it('remaps a migrated database row body within the copied subtree', () => {
    const original = doc([{
      id: 'old-block',
      type: 'database-row',
      data: { pageId: 'old-page', properties: { status: 'Ready' } },
    }]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.pageId).toBe('new-page');
    expect(copied.blocks[0]?.data.properties).toEqual({ status: 'Ready' });
    expect(original.blocks[0]?.data.pageId).toBe('old-page');
  });

  it('leaves references outside the copied subtree unchanged', () => {
    const original = doc([
      { id: 'old-block', type: 'paragraph', data: {
        text: '<a data-blok-page-id="external-page">Page</a> <a href="#external-block">Outside</a>',
      } },
    ]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.text).toContain('data-blok-page-id="external-page"');
    expect(copied.blocks[0]?.data.text).toContain('href="#external-block"');
  });

  it('remaps table cell block references with the copied child blocks', () => {
    const original = doc([
      {
        id: 'old-block',
        type: 'table',
        content: ['child'],
        data: { withHeadings: false, content: [[{ blocks: ['child'], id: 'column-1' }]] },
      },
      { id: 'child', type: 'paragraph', parent: 'old-block', data: { text: 'Cell' } },
    ]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block'], ['child', 'new-child']]),
      pageIds: new Map(),
    });

    expect(copied.blocks[0]?.data.content).toEqual([[{ blocks: ['new-child'], id: 'column-1' }]]);
    expect(copied.blocks[0]?.content).toEqual(['new-child']);
    expect(copied.blocks[1]?.parent).toBe('new-block');
    expect(original.blocks[0]?.data.content).toEqual([[{ blocks: ['child'], id: 'column-1' }]]);
  });

  it('remaps a page reference inside saved table cell HTML', () => {
    const original = doc([{
      id: 'old-block',
      type: 'table',
      data: {
        withHeadings: false,
        content: [[{ blocks: [], text: '<a data-blok-page-id="old-page">Page</a>' }]],
      },
    }]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.content).toEqual([[{
      blocks: [],
      text: '<a data-blok-page-id="new-page">Page</a>',
    }]]);
    expect(original.blocks[0]?.data.content).toEqual([[{
      blocks: [],
      text: '<a data-blok-page-id="old-page">Page</a>',
    }]]);
  });

  it('remaps a page reference in merged table leading text', () => {
    const original = doc([
      {
        id: 'old-block',
        type: 'table',
        content: ['child'],
        data: {
          content: [[{ blocks: ['child'], leadingText: '<a data-blok-page-id="old-page">Page</a>' }]],
        },
      },
      { id: 'child', type: 'paragraph', parent: 'old-block', data: { text: 'Cell' } },
    ]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block'], ['child', 'new-child']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.content).toEqual([[
      { blocks: ['new-child'], leadingText: '<a data-blok-page-id="new-page">Page</a>' },
    ]]);
    expect(original.blocks[0]?.data.content).toEqual([[
      { blocks: ['child'], leadingText: '<a data-blok-page-id="old-page">Page</a>' },
    ]]);
  });

  it('remaps a page reference in a legacy string table cell', () => {
    const original = doc([{
      id: 'old-block',
      type: 'table',
      data: { content: [['<a data-blok-page-id="old-page">Page</a>']] },
    }]);

    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map([['old-page', 'new-page']]),
    });

    expect(copied.blocks[0]?.data.content).toEqual([['<a data-blok-page-id="new-page">Page</a>']]);
    expect(original.blocks[0]?.data.content).toEqual([['<a data-blok-page-id="old-page">Page</a>']]);
  });

  it('keeps the original document unchanged when nested copied data is edited', () => {
    const original = doc([{
      id: 'old-block',
      type: 'custom',
      data: { nested: { label: 'Original' } },
    }]);
    const copied = remapPageDocument(original, {
      blockIds: new Map([['old-block', 'new-block']]),
      pageIds: new Map(),
    });
    const nested = copied.blocks[0]?.data.nested;

    if (nested === null || typeof nested !== 'object') {
      throw new Error('Copied nested data is missing');
    }
    Reflect.set(nested, 'label', 'Edited');

    expect(original.blocks[0]?.data.nested).toEqual({ label: 'Original' });
  });

  it('refuses a missing block ID mapping', () => {
    const original = doc([{ id: 'old-block', type: 'paragraph', data: {} }]);

    expect(() => remapPageDocument(original, { blockIds: new Map(), pageIds: new Map() }))
      .toThrow(/mapping/i);
    expect(original.blocks[0]?.id).toBe('old-block');
  });

  it('refuses duplicate mapped block IDs', () => {
    const original = doc([
      { id: 'a', type: 'paragraph', data: {} },
      { id: 'b', type: 'paragraph', data: {} },
    ]);

    expect(() => remapPageDocument(original, {
      blockIds: new Map([['a', 'same'], ['b', 'same']]),
      pageIds: new Map(),
    })).toThrow(/duplicate/i);
    expect(original.blocks.map((block) => block.id)).toEqual(['a', 'b']);
  });
});
