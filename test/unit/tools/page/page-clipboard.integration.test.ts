import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import type { Paste } from '../../../../src/components/modules/paste';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { CodeTool } from '../../../../src/tools/code';
import { ListItem } from '../../../../src/tools/list';
import { PageTool } from '../../../../src/tools/page';
import { PageLink } from '../../../../src/tools/page-link';
import type { API, ConversionConfig, OutputData, PasteConfig } from '../../../../types';

/**
 * A pasted page block is another entry point to the same page in the page's
 * own document, and a link anywhere else. Runs the real copy handler, paste
 * module, sanitizer and default tool on a real editor.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  caret: API['caret'];
  blocks: API['blocks'];
  module: { blockManager: { blocks: Block[] }; blockSelection: BlockSelection; paste: Paste };
}

class ConsumerPage extends Paragraph {
  public static get pasteConfig(): PasteConfig {
    return { tags: [] };
  }
}

class NoImportDefault extends Paragraph {
  public static get conversionConfig(): ConversionConfig {
    return { export: 'text' };
  }

  public static get pasteConfig(): PasteConfig {
    return { tags: [] };
  }
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const PAGE_URL = new URL('/editor/page/p1', document.baseURI).href;

const createEditor = async (withHref = true, withPageLink = false, hasPage = true): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      page: { class: PageTool, config: withHref ? { href: (pageId: string) => `/editor/page/${pageId}` } : { open: () => undefined } },
      ...(withPageLink ? { 'page-link': { class: PageLink, config: { open: () => undefined } } } : {}),
    },
    data: {
      blocks: [
        { id: 'before', type: 'paragraph', data: { text: 'Before' } },
        ...(hasPage ? [{ id: 'pg', type: 'page', data: { pageId: 'p1', cache: { title: 'Plans' } } }] : []),
      ],
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const copyPage = async (instance: TestEditor, cut: boolean): Promise<Map<string, string>> => {
  const written = new Map<string, string>();
  const { blockSelection, blockManager } = instance.module;
  const page = blockManager.blocks.find((block) => block.name === 'page');

  if (page === undefined) {
    throw new Error('no page block');
  }

  blockSelection.selectBlock(page);
  await blockSelection.copySelectedBlocks({
    preventDefault: () => undefined,
    clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
  } as unknown as ClipboardEvent, { cut });
  blockSelection.clearSelection();

  return written;
};

const paste = async (instance: TestEditor, written: Map<string, string>): Promise<void> => {
  instance.caret.setToBlock('before', 'end');
  await instance.module.paste.processDataTransfer({
    getData: (type: string) => written.get(type) ?? '',
    types: [...written.keys()],
    files: [] as unknown as FileList,
  } as unknown as DataTransfer);
};

/** The document the page does not live in. */
const openOtherDocument = async (withHref = true, withPageLink = false): Promise<TestEditor> => {
  editor?.destroy();
  holder?.remove();
  holder = document.createElement('div');
  document.body.appendChild(holder);

  return createEditor(withHref, withPageLink, false);
};

const pageIds = (output: OutputData): unknown[] =>
  output.blocks.filter((block) => block.type === 'page').map((block) => block.data.pageId);

const instanceDelete = async (instance: TestEditor, pageId: string): Promise<void> => {
  const block = instance.module.blockManager.blocks.find((candidate) => candidate.name === 'page' && candidate.preservedData.pageId === pageId);

  if (block !== undefined) {
    await instance.blocks.delete(instance.blocks.getBlockIndex(block.id));
  }
};

const pageCount = (output: OutputData): number => output.blocks.filter((block) => block.type === 'page').length;

const linkParagraphs = (output: OutputData): string[] =>
  output.blocks
    .filter((block) => block.type === 'paragraph' && String(block.data.text).includes('<a'))
    .map((block) => String(block.data.text));

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

describe('page block clipboard (entry points and links)', () => {
  it('a copied page pastes as another entry point to the same page in its document', async () => {
    const instance = await createEditor();
    const written = await copyPage(instance, false);

    await paste(instance, written);

    const output = await instance.save();

    expect(pageIds(output)).toEqual(['p1', 'p1']);
    expect(linkParagraphs(output)).toEqual([]);
    expect(written.get('text/plain')).toBe(`[Page](${PAGE_URL})`);
    expect(written.get('text/html')).toBe(`<p><a href="${PAGE_URL}">Page</a></p>`);
    expect([...written.values()].join(' ')).not.toContain('Plans');
  });

  it('a copied page pastes as a link to the absolute page url in another document', async () => {
    const written = await copyPage(await createEditor(), false);
    const other = await openOtherDocument();

    await paste(other, written);

    const output = await other.save();

    expect(pageCount(output)).toBe(0);
    expect(linkParagraphs(output)).toEqual([`<a href="${PAGE_URL}">Page</a>`]);
  });

  it('copies an open-only page as an entry point here and a non-owning reference elsewhere', async () => {
    const instance = await createEditor(false);
    const written = await copyPage(instance, false);

    await paste(instance, written);
    await paste(instance, written);

    expect(pageIds(await instance.save())).toEqual(['p1', 'p1', 'p1']);
    expect([...written.values()].join(' ')).not.toContain('Plans');
    expect([...written.values()].join(' ')).not.toContain('cache');

    const other = await openOtherDocument(false);

    await paste(other, written);
    await paste(other, written);

    const output = await other.save();

    expect(pageCount(output)).toBe(0);
    expect(linkParagraphs(output)).toEqual([
      '<a data-blok-page-id="p1">Page</a>',
      '<a data-blok-page-id="p1">Page</a>',
    ]);
  });

  it.each([
    ['page-link', true, { pageId: 'p1' }],
    ['paragraph', false, { text: '<a data-blok-page-id="p1">Page</a>' }],
  ] as const)('keeps a copied open-only page ID via %s in another document when the custom default cannot import HTML', async (tool, withPageLink, data) => {
    const make = async (hasPage: boolean): Promise<TestEditor> => {
      const instance = new Blok({
        holder,
        defaultBlock: 'custom',
        tools: {
          custom: NoImportDefault,
          paragraph: Paragraph,
          page: { class: PageTool, config: { open: () => undefined } },
          ...(withPageLink ? { 'page-link': { class: PageLink, config: { open: () => undefined } } } : {}),
        },
        data: {
          blocks: [
            { id: 'before', type: 'custom', data: { text: 'Before' } },
            ...(hasPage ? [{ id: 'pg', type: 'page', data: { pageId: 'p1' } }] : []),
          ],
        },
      }) as unknown as TestEditor;

      editor = instance;
      await instance.isReady;

      return instance;
    };
    const written = await copyPage(await make(true), false);

    editor?.destroy();
    const other = await make(false);

    await paste(other, written);
    await paste(other, written);
    const output = await other.save();

    expect(pageCount(output)).toBe(0);
    expect(output.blocks.filter((block) => block.type === tool).map((block) => block.data)).toEqual([data, data]);
  });

  it('keeps a no-href page ID in another document when Code is the default and Paragraph is registered', async () => {
    const make = async (hasPage: boolean): Promise<TestEditor> => {
      const instance = new Blok({
        holder,
        defaultBlock: 'code',
        tools: {
          code: CodeTool,
          paragraph: Paragraph,
          page: { class: PageTool, config: { open: () => undefined } },
        },
        data: {
          blocks: [
            { id: 'before', type: 'paragraph', data: { text: 'Before' } },
            ...(hasPage ? [{ id: 'pg', type: 'page', data: { pageId: 'p1' } }] : []),
          ],
        },
      }) as unknown as TestEditor;

      editor = instance;
      await instance.isReady;

      return instance;
    };
    const written = await copyPage(await make(true), false);

    editor?.destroy();
    const other = await make(false);

    await paste(other, written);
    const output = await other.save();

    expect(linkParagraphs(output)).toEqual(['<a data-blok-page-id="p1">Page</a>']);
    expect(pageCount(output)).toBe(0);
  });

  it('copies a consumer page tool and its child without treating it as a pointer', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, page: ConsumerPage },
      data: {
        blocks: [
          { id: 'before', type: 'paragraph', data: { text: 'Before' } },
          { id: 'pg', type: 'page', data: { text: 'Custom page content' }, content: ['child'] },
          { id: 'child', type: 'paragraph', parent: 'pg', data: { text: 'Inside child' } },
        ],
      },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    const written = await copyPage(instance, false);
    const clipboardBlocks = JSON.parse(written.get('application/x-blok') ?? '') as Array<{ tool: string; data: { text?: string } }>;

    expect(clipboardBlocks).toEqual([
      expect.objectContaining({ tool: 'page', data: expect.objectContaining({ text: 'Custom page content' }) }),
      expect.objectContaining({ tool: 'paragraph', data: expect.objectContaining({ text: 'Inside child' }), parentId: 'pg' }),
    ]);
    expect(written.get('text/plain')).toContain('Custom page content');
    expect(written.get('text/html')).toContain('Custom page content');
  });

  it('a cut page comes back once; the next paste of the same cut is another entry point', async () => {
    const instance = await createEditor();
    const written = await copyPage(instance, true);

    await instance.blocks.delete(instance.blocks.getBlockIndex('pg'));
    await paste(instance, written);

    const afterFirst = await instance.save();

    expect(pageIds(afterFirst)).toEqual(['p1']);
    expect(linkParagraphs(afterFirst)).toEqual([]);

    await paste(instance, written);

    const afterSecond = await instance.save();

    expect(pageIds(afterSecond)).toEqual(['p1', 'p1']);
    expect(linkParagraphs(afterSecond)).toEqual([]);
  });

  it('a cut page moves into another document once, then pastes there as another entry point', async () => {
    const written = await copyPage(await createEditor(), true);
    const other = await openOtherDocument(true, true);

    await paste(other, written);
    expect(pageIds(await other.save())).toEqual(['p1']);

    await paste(other, written);

    const output = await other.save();

    expect(pageIds(output)).toEqual(['p1', 'p1']);
  });

  it('a spent cut pastes a page-link in a document without the page', async () => {
    const written = await copyPage(await createEditor(false, true), true);
    const other = await openOtherDocument(false, true);

    await paste(other, written);
    await instanceDelete(other, 'p1');
    await paste(other, written);

    const output = await other.save();

    expect(output.blocks.filter((block) => block.type === 'page-link').map((block) => block.data)).toEqual([{ pageId: 'p1' }]);
    expect(pageCount(output)).toBe(0);
  });

  it('a cut page pastes as another entry point while the original is live', async () => {
    const instance = await createEditor(false, true);
    const written = await copyPage(instance, true);

    await paste(instance, written);
    const output = await instance.save();

    expect(pageIds(output)).toEqual(['p1', 'p1']);
    expect(output.blocks.filter((block) => block.type === 'page-link')).toEqual([]);
  });

  it.each(['paragraph', 'list'] as const)('does not copy revoked inline page metadata from a saved %s', async (type) => {
    let access: 'allowed' | 'none' = 'allowed';
    let notify: (() => void) | undefined;
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        list: ListItem,
        page: {
          class: PageTool,
          config: {
            resolve: () => access === 'none'
              ? { access: 'none' as const, title: 'Secret Roadmap' }
              : { title: 'Secret Roadmap' },
            href: () => '/private/secret-roadmap',
            subscribe: (_id: string, onChange: () => void) => { notify = onChange; },
          },
        },
      },
      data: {
        blocks: [{
          id: 'body',
          type,
          data: {
            text: 'See <a data-blok-page-id="p1">Page</a> and <a href="https://example.test/ordinary">Ordinary</a>',
            ...(type === 'list' && { style: 'unordered' }),
          },
        }],
      },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    const anchor = holder?.querySelector<HTMLAnchorElement>('a[data-blok-page-id="p1"]');

    await vi.waitFor(() => expect(anchor?.textContent).toBe('Secret Roadmap'));
    await instance.save();
    access = 'none';
    notify?.();
    await vi.waitFor(() => expect(anchor?.textContent).toBe('No access'));

    const body = instance.module.blockManager.blocks.find((block) => block.id === 'body');

    if (body === undefined) {
      throw new Error('no body block');
    }
    const written = new Map<string, string>();

    instance.module.blockSelection.selectBlock(body);
    await instance.module.blockSelection.copySelectedBlocks({
      preventDefault: () => undefined,
      clipboardData: { setData: (flavor: string, value: string): void => void written.set(flavor, value) },
    } as unknown as ClipboardEvent);

    expect(Object.fromEntries([...written].map(([flavor, value]) => [
      flavor,
      /Secret Roadmap|secret-roadmap/.test(value),
    ]))).toEqual({ 'text/plain': false, 'text/html': false, 'application/x-blok': false });
    expect(JSON.parse(written.get('application/x-blok') ?? '')).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({
        text: expect.stringContaining('<a data-blok-page-id="p1">Page</a>'),
      }) }),
    ]));
    expect(written.get('application/x-blok')).toContain('https://example.test/ordinary');
    expect(written.get('text/html')).toContain('https://example.test/ordinary');
    expect(written.get('text/plain')).toContain('https://example.test/ordinary');
  });
});
