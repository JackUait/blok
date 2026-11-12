import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { PageTool } from '../../../../../src/tools/page';
import { PageLink } from '../../../../../src/tools/page-link';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import { LinkInlineTool } from '../../../../../src/components/inline-tools/inline-tool-link';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { blocksAsHtml, htmlOf } from '../../../helpers/saved-as-html';
import { loadPasteEngine } from '../../../helpers/paste-engine';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  caret: API['caret'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.append(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

const known: Record<string, { title?: string; access?: 'none' }> = { roadmap: { title: 'Roadmap' }, secret: { title: 'Secret', access: 'none' } };
const resolve = (pageId: string): { title?: string; access?: 'none' } | null => known[pageId] ?? null;

/** Pastes `data` at the end of the `before` paragraph and returns what was saved. */
const pasteInto = async (
  data: Record<string, string>,
  config: Record<string, unknown> = { resolve },
  blocks: OutputBlockData[] = []
): Promise<OutputData> => {
  const instance = new Blok({
    holder,
    sanitizer: { a: { href: true } },
    tools: {
      paragraph: Paragraph,
      link: LinkInlineTool,
      table: Table,
      page: { class: PageTool, config },
      'page-link': { class: PageLink, config },
    },
    data: { blocks: [{ id: 'before', type: 'paragraph', data: { text: 'See ' } }, ...blocks] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  const target = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="before"] *') ?? [])
    .find((element) => element.contentEditable === 'true');

  if (target === undefined) {
    throw new Error('no paragraph input');
  }
  target.setAttribute('contenteditable', 'true');
  target.focus();
  instance.caret.setToBlock('before', 'end');
  await loadPasteEngine();
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  }));
  await new Promise<void>((done) => { setTimeout(done, 100); });

  return instance.save();
};

/** Every page id the save points at: mention anchors in rich text and `pageId` fields. */
const pageIdsIn = (output: OutputData): string[] => {
  const ids: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const wrapper = document.createElement('div');

      wrapper.innerHTML = value;
      wrapper.querySelectorAll('a[data-blok-page-id]').forEach((anchor) => ids.push(anchor.getAttribute('data-blok-page-id') ?? ''));
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([key, item]) => (key === 'pageId' && typeof item === 'string' ? ids.push(item) : walk(item)));
    }
  };

  blocksAsHtml(output.blocks).forEach((block) => walk(block.data));

  return ids;
};

const textOf = (output: OutputData, id: string): unknown => htmlOf(output.blocks.find((block) => block.id === id)?.data.text);

describe('a page id read from pasted html', () => {
  it('becomes plain text when the host does not know the page', async () => {
    const output = await pasteInto({ 'text/html': '<a data-blok-page-id="evil">Plans</a>', 'text/plain': 'Plans' });

    expect(pageIdsIn(output)).toEqual([]);
    expect(textOf(output, 'before')).toBe('See Plans');
  });

  it('becomes a plain link when the anchor has an href', async () => {
    const output = await pasteInto({ 'text/html': '<a data-blok-page-id="evil" href="https://example.test/x">Plans</a>', 'text/plain': 'Plans' });

    expect(pageIdsIn(output)).toEqual([]);
    expect(textOf(output, 'before')).toBe('See <a href="https://example.test/x">Plans</a>');
  });

  it('becomes plain text when the user may not see the page', async () => {
    const output = await pasteInto({ 'text/html': '<a data-blok-page-id="secret">Secret</a>', 'text/plain': 'Secret' });

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('becomes plain text when the host fails to resolve the page', async () => {
    const output = await pasteInto(
      { 'text/html': '<a data-blok-page-id="roadmap">Roadmap</a>', 'text/plain': 'Roadmap' },
      { resolve: (): Promise<never> => Promise.reject(new Error('offline')) }
    );

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('becomes plain text when the host has no resolve and the page is not in this document', async () => {
    const output = await pasteInto({ 'text/html': '<a data-blok-page-id="roadmap">Roadmap</a>', 'text/plain': 'Roadmap' }, {});

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('stays a mention when the host resolves the page', async () => {
    const output = await pasteInto({ 'text/html': '<a data-blok-page-id="roadmap">Roadmap</a>', 'text/plain': 'Roadmap' });

    expect(textOf(output, 'before')).toBe('See <a data-blok-page-id="roadmap">Page</a>');
  });

  it('stays a mention without resolve when this document already mentions the page', async () => {
    const output = await pasteInto(
      { 'text/html': '<a data-blok-page-id="roadmap">Roadmap</a>', 'text/plain': 'Roadmap' },
      {},
      [{ id: 'other', type: 'paragraph', data: { text: 'Also <a data-blok-page-id="roadmap">Page</a>' } }]
    );

    expect(textOf(output, 'before')).toBe('See <a data-blok-page-id="roadmap">Page</a>');
  });

  it('asks the host once per page, however many anchors name it', async () => {
    const counted = vi.fn(resolve);

    await pasteInto({ 'text/html': '<p><a data-blok-page-id="x">a</a> <a data-blok-page-id="x">b</a> <a data-blok-page-id="x">c</a></p>', 'text/plain': 'a b c' }, { resolve: counted });

    expect(counted.mock.calls.filter(([pageId]) => pageId === 'x')).toHaveLength(1);
  });
});

describe('a page id read from pasted plain text', () => {
  it('never becomes a mention from raw html inside Markdown', async () => {
    const output = await pasteInto({ 'text/plain': '**Go** <a data-blok-page-id="evil">Page</a> now' });

    expect(pageIdsIn(output)).toEqual([]);
  });
});

describe('a page id read from Blok clipboard data', () => {
  const blok = (entries: unknown[]): Record<string, string> => ({ 'application/x-blok': JSON.stringify(entries), 'text/plain': 'x' });

  it('turns a mention of an unknown page in block text into plain text', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'paragraph', data: { text: 'Go <a data-blok-page-id="evil">Page</a> now' } }]));

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('turns a mention of an unknown page in rich text segments into plain text', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'paragraph', data: { text: [{ text: 'Go ' }, { embed: { page: { id: 'evil' } } }] } }]));

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('keeps a mention of a page the host resolves', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'paragraph', data: { text: 'Go <a data-blok-page-id="roadmap">Page</a> now' } }]));

    expect(pageIdsIn(output)).toEqual(['roadmap']);
  });

  it('turns a page link to an unknown page into plain text', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'page-link', data: { pageId: 'evil' } }]));

    expect(pageIdsIn(output)).toEqual([]);
    expect(output.blocks.map((block) => block.type)).not.toContain('page-link');
  });

  it('turns a stub-wrapped page link to an unknown page into plain text', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'stub', data: { type: 'page-link', data: { pageId: 'evil' } } }]));

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('keeps a page link to a page the host resolves', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'page-link', data: { pageId: 'roadmap' } }]));

    expect(output.blocks.find((block) => block.type === 'page-link')?.data).toEqual({ pageId: 'roadmap' });
  });

  it('does not point at an unknown page from a copied page block', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'page', data: { pageId: 'evil' } }]));

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('links a copied page block to a page the host resolves', async () => {
    const output = await pasteInto(blok([{ id: 'a', tool: 'page', data: { pageId: 'roadmap' } }]));

    expect(pageIdsIn(output)).toEqual(['roadmap']);
  });

  it('does not point at an unknown page from a Notion sub-page', async () => {
    const notion = JSON.stringify({
      blocks: [{ blockId: 'n1', blockSubtree: { __version__: 3, block: { n1: { value: { id: 'n1', version: 1, type: 'page', parent_id: 'root', parent_table: 'block', alive: true, properties: { title: [['Sub']] } } } } } }],
      action: 'paste',
      wasContiguousSelection: true,
    });
    const output = await pasteInto({ 'text/_notion-blocks-v3-production': notion, 'text/plain': 'Sub' });

    expect(pageIdsIn(output)).toEqual([]);
  });
});

describe('a page id read from a pasted table cell payload', () => {
  it('turns a mention of an unknown page in a cell into plain text', async () => {
    const payload = { rows: 1, cols: 2, cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Go <a data-blok-page-id="evil">Page</a>' } }] }, { blocks: [{ tool: 'paragraph', data: { text: 'B' } }] }]] };
    const html = `<table data-blok-table-cells='${JSON.stringify(payload)}'><tr><td>Go Page</td><td>B</td></tr></table>`;
    const output = await pasteInto({ 'text/html': html, 'text/plain': 'Go Page\tB' });

    expect(pageIdsIn(output)).toEqual([]);
  });
});

describe('a page id pasted into a table cell', () => {
  const pasteIntoCell = async (html: string, config: Record<string, unknown> = { resolve }): Promise<OutputData> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table, page: { class: PageTool, config }, 'page-link': { class: PageLink, config } },
      data: { blocks: [{ id: 'tb', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await new Promise<void>((done) => { setTimeout(done, 50); });
    const cell = holder?.querySelector<HTMLElement>('[data-blok-table-cell] [data-blok-element-content] > *');

    if (cell === null || cell === undefined) {
      throw new Error('no cell input');
    }
    // jsdom focuses a contenteditable only with a tab index.
    cell.tabIndex = 0;
    cell.focus();
    await loadPasteEngine();
    const data: Record<string, string> = { 'text/html': html, 'text/plain': 'x' };

    cell.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
    }));
    await new Promise<void>((done) => { setTimeout(done, 100); });

    return instance.save();
  };

  it('turns a mention of an unknown page in a pasted html table into plain text', async () => {
    const output = await pasteIntoCell('<table><tr><td>Go <a data-blok-page-id="evil">Plans</a></td><td>B</td></tr></table>');

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('turns a mention of an unknown page in a cell payload into plain text', async () => {
    const payload = { rows: 1, cols: 2, cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Go <a data-blok-page-id="evil">Page</a>' } }] }, { blocks: [{ tool: 'paragraph', data: { text: 'B' } }] }]] };
    const output = await pasteIntoCell(`<table data-blok-table-cells='${JSON.stringify(payload)}'><tr><td>Go Page</td><td>B</td></tr></table>`);

    expect(pageIdsIn(output)).toEqual([]);
  });

  it('keeps a mention of a page the host resolves', async () => {
    const output = await pasteIntoCell('<table><tr><td>Go <a data-blok-page-id="roadmap">Roadmap</a></td><td>B</td></tr></table>');

    expect(pageIdsIn(output)).toEqual(['roadmap']);
    expect(output.blocks.filter((block) => block.type === 'table')).toHaveLength(1);
  });
});
