import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { PageTool } from '../../../../../src/tools/page';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { LinkInlineTool } from '../../../../../src/components/inline-tools/inline-tool-link';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';
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

describe('inline page reference paste', () => {
  it('saves a neutral ID mark inside the current paragraph without creating a page', async () => {
    const instance = new Blok({
      holder,
      sanitizer: { a: { href: true } },
      tools: { paragraph: Paragraph, page: { class: PageTool, config: {} } },
      data: {
        blocks: [
          { id: 'before', type: 'paragraph', data: { text: 'Before ' } },
          { id: 'owner', type: 'page', data: { pageId: 'p1' } },
        ],
      },
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
    const html = '<a data-blok-page-id="p1" href="https://example.test/old-title" title="Old title">Old title</a>';
    const data = { 'text/html': html, 'text/plain': 'Old title' };

    await loadPasteEngine();
    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => data[type as keyof typeof data] ?? '', types: Object.keys(data) },
    }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

    expect(target.querySelector('a[data-blok-page-id="p1"]')?.textContent).toBe('Page');

    const output = await instance.save();
    const current = output.blocks.find((block) => block.id === 'before');

    expect(htmlOf(current?.data.text)).toBe('Before <a data-blok-page-id="p1">Page</a>');
    expect(output.blocks.filter((block) => block.type === 'page')).toHaveLength(1);
    expect(JSON.stringify(output)).not.toContain('old-title');
    expect(JSON.stringify(output)).not.toContain('Old title');
  });

  it('keeps an ordinary pasted link when the link tool allows anchors', async () => {
    const instance = new Blok({
      holder,
      sanitizer: { a: { href: true } },
      tools: { paragraph: Paragraph, link: LinkInlineTool },
      data: { blocks: [{ id: 'before', type: 'paragraph', data: { text: 'Before ' } }] },
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
    const html = '<a href="https://example.test/">Site</a>';
    const data = { 'text/html': html, 'text/plain': 'Site' };

    await loadPasteEngine();
    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => data[type as keyof typeof data] ?? '', types: Object.keys(data) },
    }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

    const output = await instance.save();

    expect(htmlOf(output.blocks.find((block) => block.id === 'before')?.data.text))
      .toBe('Before <a href="https://example.test/">Site</a>');
  });
});

describe('a pasted link to a page this host knows', () => {
  const pageIdFromHref = (href: string): string | null => /^https:\/\/workspace\.test\/pages\/([^/?#]+)$/.exec(href)?.[1] ?? null;
  const titles: Record<string, { title?: string; access?: 'none' }> = { roadmap: { title: 'Roadmap' }, secret: { title: 'Secret', access: 'none' } };
  const resolve = (pageId: string): { title?: string; access?: 'none' } | null => titles[pageId] ?? null;

  /** Pastes `data` at the end of the `before` paragraph and returns what was saved. */
  const pasteInto = async (text: string, data: Record<string, string>, config: Record<string, unknown> = { pageIdFromHref, resolve }): Promise<OutputData> => {
    const instance = new Blok({
      holder,
      sanitizer: { a: { href: true } },
      tools: { paragraph: Paragraph, link: LinkInlineTool, page: { class: PageTool, config } },
      data: { blocks: [{ id: 'before', type: 'paragraph', data: { text } }] },
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
    // The Markdown converter loads on first use.
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });

    return instance.save();
  };

  const texts = (output: OutputData): string[] => output.blocks.map((block) => {
    const html = htmlOf(block.data.text);

    return typeof html === 'string' ? html : '';
  });

  it('becomes that page\'s mention when Markdown text links to it', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[Roadmap](https://workspace.test/pages/roadmap) now' });

    expect(texts(output)).toEqual(['See <a data-blok-page-id="roadmap">Page</a> now']);
  });

  it('becomes that page\'s mention when Markdown text in its own block links to it', async () => {
    const output = await pasteInto('', { 'text/plain': '**Plan**\n\nSee [Roadmap](https://workspace.test/pages/roadmap)' });

    expect(texts(output)).toEqual(['<strong>Plan</strong>', 'See <a data-blok-page-id="roadmap">Page</a>']);
  });

  it('becomes that page\'s mention when html links to it', async () => {
    const output = await pasteInto('See ', { 'text/html': '<a href="https://workspace.test/pages/roadmap">Roadmap</a>', 'text/plain': 'Roadmap' });

    expect(texts(output)).toEqual(['See <a data-blok-page-id="roadmap">Page</a>']);
  });

  it('stays a link with its own text when that text is not the page\'s title', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[click here](https://workspace.test/pages/roadmap) now' });

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/roadmap">click here</a> now']);
  });

  it('stays a link with its own text when html link text is not the page\'s title', async () => {
    const output = await pasteInto('See ', { 'text/html': '<a href="https://workspace.test/pages/roadmap">click here</a>', 'text/plain': 'click here' });

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/roadmap">click here</a>']);
  });

  it('compares the title as written: another case stays a link', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[roadmap](https://workspace.test/pages/roadmap) now' });

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/roadmap">roadmap</a> now']);
  });

  it('becomes the mention when Markdown link text is the URL itself', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[https://workspace.test/pages/roadmap](https://workspace.test/pages/roadmap) now' });

    expect(texts(output)).toEqual(['See <a data-blok-page-id="roadmap">Page</a> now']);
  });

  it('becomes the mention when html link text is the URL itself, with or without a trailing slash', async () => {
    const output = await pasteInto('See ', {
      'text/html': '<a href="https://workspace.test/pages/roadmap">https://workspace.test/pages/roadmap/</a>',
      'text/plain': 'https://workspace.test/pages/roadmap/',
    });

    expect(texts(output)).toEqual(['See <a data-blok-page-id="roadmap">Page</a>']);
  });

  it('becomes the mention when html link text is the title with spaces around it', async () => {
    const output = await pasteInto('See ', { 'text/html': '<a href="https://workspace.test/pages/roadmap"> Roadmap </a>', 'text/plain': 'Roadmap' });

    expect(texts(output)).toEqual(['See <a data-blok-page-id="roadmap">Page</a>']);
  });

  it('stays a link when the user may not see the page, even with its title as text', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[Secret](https://workspace.test/pages/secret) now' });

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/secret">Secret</a> now']);
  });

  it('stays a link when the host fails to resolve the page', async () => {
    const failing = (): Promise<never> => Promise.reject(new Error('offline'));
    const output = await pasteInto('See ', { 'text/plain': '[Roadmap](https://workspace.test/pages/roadmap) now' }, { pageIdFromHref, resolve: failing });

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/roadmap">Roadmap</a> now']);
  });

  it('asks the host once per page, however many links point at it', async () => {
    const counted = vi.fn(resolve);

    const output = await pasteInto('', {
      'text/html': '<p><a href="https://workspace.test/pages/roadmap">x</a> <a href="https://workspace.test/pages/roadmap">y</a> <a href="https://workspace.test/pages/roadmap">z</a></p>',
      'text/plain': 'x y z',
    }, { pageIdFromHref, resolve: counted });

    // No link converts, so no mention on screen asks the host again.
    expect(texts(output)).toEqual(['<a href="https://workspace.test/pages/roadmap">x</a> <a href="https://workspace.test/pages/roadmap">y</a> <a href="https://workspace.test/pages/roadmap">z</a>']);
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it('pastes nothing into an editor destroyed while the host resolves the title', async () => {
    const pending: { settle: (info: { title: string }) => void } = { settle: () => undefined };
    const slowResolve = (): Promise<{ title: string }> => new Promise((resolve) => {
      pending.settle = resolve;
    });
    const instance = new Blok({
      holder,
      sanitizer: { a: { href: true } },
      tools: { paragraph: Paragraph, link: LinkInlineTool, page: { class: PageTool, config: { pageIdFromHref, resolve: slowResolve } } },
      data: { blocks: [{ id: 'before', type: 'paragraph', data: { text: 'See ' } }] },
    }) as unknown as TestEditor;

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
    const errors = vi.spyOn(console, 'error');
    const data: Record<string, string> = { 'text/html': '<a href="https://workspace.test/pages/roadmap">Roadmap</a>', 'text/plain': 'Roadmap' };

    target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
    }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    instance.destroy();
    pending.settle({ title: 'Roadmap' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    expect(holder?.querySelector('[data-blok-page-id]')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('stays a link when the host does not know the page', async () => {
    const output = await pasteInto('See ', { 'text/plain': '[Elsewhere](https://elsewhere.test/pages/roadmap) now' });

    expect(texts(output)).toEqual(['See <a href="https://elsewhere.test/pages/roadmap">Elsewhere</a> now']);
  });

  it('stays a link when the page tool cannot read page links', async () => {
    const output = await pasteInto('See ', { 'text/html': '<a href="https://workspace.test/pages/roadmap">Roadmap</a>', 'text/plain': 'Roadmap' }, {});

    expect(texts(output)).toEqual(['See <a href="https://workspace.test/pages/roadmap">Roadmap</a>']);
  });
});
