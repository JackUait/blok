import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Paste } from '../../../../src/components/modules/paste';
import { Paragraph } from '../../../../src/tools/paragraph';
import { PageTool, type PageConfig, type PageInfo } from '../../../../src/tools/page';
import type { API, OutputData } from '../../../../types';

/**
 * A copied page link pastes as a mention: an inline reference to the page,
 * not another page block. Runs the real paste module, link menu and editor.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  caret: API['caret'];
  history: API['history'];
  module: { paste: Paste };
}

const PAGE_URL = new URL('/editor/page/p1', document.baseURI).href;

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const createEditor = async (page: PageConfig & Record<string, unknown>, text = ''): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, page: { class: PageTool, config: page } },
    data: { blocks: [{ id: 'target', type: 'paragraph', data: { text } }] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const pasteText = async (instance: TestEditor, value: string): Promise<void> => {
  instance.caret.setToBlock('target', 'end');

  await instance.module.paste.processDataTransfer({
    getData: (type: string) => (type === 'text/plain' ? value : ''),
    types: ['text/plain'],
    files: [] as unknown as FileList,
  } as unknown as DataTransfer);
};

const menuItem = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-blok-item-name="paste-menu-${name}"]`);

const savedText = async (instance: TestEditor): Promise<string> => {
  const output = await instance.save();

  const text: unknown = output.blocks[0]?.data.text;

  return typeof text === 'string' ? text : '';
};

const reference = (): HTMLAnchorElement | null =>
  holder?.querySelector<HTMLAnchorElement>('a[data-blok-page-id="p1"]') ?? null;

const pageConfig = (info: PageInfo = { title: 'Plans' }): PageConfig & Record<string, unknown> => ({
  href: (pageId) => `/editor/page/${pageId}`,
  pageIdFromHref: (href) => /\/editor\/page\/([^/?#]+)/.exec(new URL(href).pathname)?.[1] ?? null,
  resolve: () => info,
});

describe('pasting a page link as a mention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    editor = undefined;
    await settle();
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it('saves a page reference, not the url, when Mention is chosen', async () => {
    const instance = await createEditor(pageConfig());

    await pasteText(instance, PAGE_URL);
    menuItem('mention')?.click();
    await settle();

    expect(await savedText(instance)).toBe('<a data-blok-page-id="p1">Page</a>');
  });

  it('undoes the mention back to the plain link in one step', async () => {
    const instance = await createEditor(pageConfig());

    await pasteText(instance, PAGE_URL);
    await new Promise(resolve => setTimeout(resolve, 100));
    menuItem('mention')?.click();
    await settle();
    instance.history.undo();
    await settle();

    const text = await savedText(instance);

    expect(text).toContain(`href="${PAGE_URL}"`);
    expect(text).not.toContain('data-blok-page-id');
  });

  it('offers no mention when the host cannot map the url to a page', async () => {
    const instance = await createEditor({ ...pageConfig(), pageIdFromHref: () => null });

    await pasteText(instance, PAGE_URL);

    expect(menuItem('mention')).toBeNull();
  });

  it('shows the page icon with an arrow badge and the page title', async () => {
    const instance = await createEditor(pageConfig({ title: 'Plans', icon: { type: 'emoji', value: '🕌' } }));

    await pasteText(instance, PAGE_URL);
    menuItem('mention')?.click();
    await settle();
    await settle();

    const anchor = reference();
    const icon = anchor?.querySelector('[data-blok-testid="page-reference-icon"]');

    expect(icon?.getAttribute('data-blok-emoji')).toBe('🕌');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('[data-blok-testid="page-reference-arrow"] svg')).not.toBeNull();
    expect(anchor?.querySelector('[data-blok-testid="page-reference-title"]')?.textContent).toBe('Plans');
    // The emoji is drawn by CSS, so the reference reads as its title alone.
    expect(anchor?.textContent).toBe('Plans');
  });

  it('shows the page glyph when the page has no icon', async () => {
    const instance = await createEditor(pageConfig({ title: 'Plans' }));

    await pasteText(instance, PAGE_URL);
    menuItem('mention')?.click();
    await settle();
    await settle();

    const icon = reference()?.querySelector('[data-blok-testid="page-reference-icon"]');

    expect(icon?.hasAttribute('data-blok-emoji')).toBe(false);
    expect(icon?.querySelectorAll('svg')).toHaveLength(2);
  });
});
