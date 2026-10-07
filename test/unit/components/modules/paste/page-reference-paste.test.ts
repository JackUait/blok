import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { PageTool } from '../../../../../src/tools/page';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { LinkInlineTool } from '../../../../../src/components/inline-tools/inline-tool-link';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

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
