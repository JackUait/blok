import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { PageTool } from '../../../../src/tools/page';
import { PageLink } from '../../../../src/tools/page-link';
import type { OutputBlockData } from '../../../../types';
import type { PageInfo } from '../../../../types/tools/page';

/**
 * The text/plain flavour of a copied page pointer carries what the editor
 * shows: the host-resolved title and the page link. Never a cached title.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  module: { blockManager: { blocks: Block[] }; blockSelection: BlockSelection };
}

const PAGES: Record<string, PageInfo | null> = {
  p1: { title: 'Title p1' },
  p2: { title: 'Roadmap' },
  secret: { title: 'Secret plans', access: 'none' },
};

const pageUrl = (pageId: string): string => new URL(`/pages/${pageId}`, document.baseURI).href;

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[], resolve = true): Promise<TestEditor> => {
  const config = {
    href: (pageId: string) => `/pages/${pageId}`,
    ...(resolve ? { resolve: (pageId: string) => Promise.resolve(PAGES[pageId] ?? null) } : {}),
  };
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      page: { class: PageTool, config },
      'page-link': { class: PageLink, config },
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const copyPlain = async (instance: TestEditor, id: string): Promise<string> => {
  const written = new Map<string, string>();
  const { blockSelection, blockManager } = instance.module;
  const block = blockManager.blocks.find((candidate) => candidate.id === id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  blockSelection.selectBlock(block);
  await blockSelection.copySelectedBlocks({
    preventDefault: () => undefined,
    clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
  } as unknown as ClipboardEvent);
  blockSelection.clearSelection();

  return written.get('text/plain') ?? '';
};

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

describe('copied page pointers in text/plain', () => {
  it('a resolved page-link copies as a Markdown link with its title', async () => {
    const instance = await createEditor([{ id: 'src', type: 'page-link', data: { pageId: 'p1' } }]);

    await vi.waitFor(() => expect(holder?.textContent).toContain('Title p1'));

    expect(await copyPlain(instance, 'src')).toBe(`[Title p1](${pageUrl('p1')})`);
  });

  it('Copy as Markdown writes a resolved page-link as a Markdown link with its title', async () => {
    const instance = await createEditor([{ id: 'src', type: 'page-link', data: { pageId: 'p1' } }]);
    const writeText = vi.fn((_text: string) => Promise.resolve());

    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await vi.waitFor(() => expect(holder?.textContent).toContain('Title p1'));

    const { blockSelection, blockManager } = instance.module;
    const block = blockManager.blocks.find((candidate) => candidate.id === 'src');

    if (block === undefined) {
      throw new Error('no block src');
    }
    blockSelection.selectBlock(block);
    await blockSelection.copySelectedBlocksAsMarkdown();

    expect(writeText).toHaveBeenCalledWith(`[Title p1](${pageUrl('p1')})`);
  });

  it('a resolved inline mention copies as a Markdown link with its title', async () => {
    const instance = await createEditor([
      { id: 'src', type: 'paragraph', data: { text: 'See <a data-blok-page-id="p2">Page</a> now' } },
    ]);

    await vi.waitFor(() => expect(holder?.textContent).toContain('Roadmap'));

    expect(await copyPlain(instance, 'src')).toBe(`See [Roadmap](${pageUrl('p2')}) now`);
  });

  it('an unresolved page-link copies as Page, never its cached title', async () => {
    const instance = await createEditor([
      { id: 'src', type: 'page-link', data: { pageId: 'p1', cache: { title: 'Cached title' } } },
    ], false);

    await settle();

    expect(await copyPlain(instance, 'src')).toBe('Page');
  });

  it('a page the user may not see copies no title and no link', async () => {
    const instance = await createEditor([
      { id: 'link', type: 'page-link', data: { pageId: 'secret' } },
      { id: 'mention', type: 'paragraph', data: { text: 'See <a data-blok-page-id="secret">Page</a>' } },
    ]);

    await vi.waitFor(() => expect(holder?.textContent).not.toContain('Loading'));
    await settle();

    const link = await copyPlain(instance, 'link');
    const mention = await copyPlain(instance, 'mention');

    expect(link).not.toContain('Secret plans');
    expect(link).not.toContain('/pages/secret');
    expect(mention).toBe('See Page');
  });
});
