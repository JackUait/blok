/**
 * Pasted plain-text Markdown keeps the author's line breaks: a soft line
 * ending inside a paragraph, list item or quote becomes <br> (GitHub-comment
 * semantics). The public importer stays CommonMark-faithful.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';
import { Quote } from '../../../src/tools/quote';
import { ListItem } from '../../../src/tools/list';
import { BoldInlineTool } from '../../../src/components/inline-tools/inline-tool-bold';
import { markdownToBlocks } from '../../../src/markdown/index';
import type { API, OutputBlockData, OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, quote: Quote, list: ListItem, bold: BoldInlineTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Markdown conversion loads a chunk, so wait until the saved document changes. */
const pastePlain = async (instance: TestEditor, id: string, plain: string): Promise<OutputBlockData[]> => {
  const target = Array.from(holder?.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`) ?? [])
    .find(element => element.contentEditable === 'true');

  if (target === undefined) {
    throw new Error('no paste target');
  }

  // jsdom does not reflect the property to the attribute; a browser does.
  target.setAttribute('contenteditable', 'true');
  target.focus();
  instance.caret.setToBlock(id, 'end');
  target.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { getData: (type: string): string => (type === 'text/plain' ? plain : ''), types: ['text/plain'] },
  }));

  await vi.waitFor(async () => {
    expect((await instance.save()).blocks.some(block => block.id !== id)).toBe(true);
  });

  return (await instance.save()).blocks;
};

describe('markdown paste keeps soft line breaks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('turns a soft line ending in a paragraph into <br>', async () => {
    const instance = await boot([{ id: 'e', type: 'paragraph', data: { text: '' } }]);
    const blocks = await pastePlain(instance, 'e', 'Line one\nLine **bold** two');

    expect(blocks.map(block => block.data.text)).toEqual(['Line one<br>Line <strong>bold</strong> two']);
  });

  it('turns soft line endings in list items and quotes into <br>', async () => {
    const instance = await boot([{ id: 'e', type: 'paragraph', data: { text: '' } }]);
    const blocks = await pastePlain(instance, 'e', '- one\n  two\n\n> **q1**\n> q2');

    expect(blocks.map(block => `${block.type}:${String(block.data.text)}`))
      .toEqual(['list:one<br>two', 'quote:<strong>q1</strong><br>q2']);
  });

  it('leaves the public importer CommonMark-faithful', async () => {
    const [block] = await markdownToBlocks('Line one\nLine **bold** two');

    expect(block.data.text).toBe('Line one\nLine <strong>bold</strong> two');
  });
});
