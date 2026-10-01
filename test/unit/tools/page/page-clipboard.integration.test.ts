import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import type { Paste } from '../../../../src/components/modules/paste';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { PageTool } from '../../../../src/tools/page';
import type { API, OutputData } from '../../../../types';

/**
 * A page must have one block. Runs the real copy handler, paste module,
 * sanitizer and default tool on a real editor.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  caret: API['caret'];
  blocks: API['blocks'];
  module: { blockManager: { blocks: Block[] }; blockSelection: BlockSelection; paste: Paste };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const PAGE_URL = new URL('/editor/page/p1', document.baseURI).href;

const createEditor = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      page: { class: PageTool, config: { href: (pageId: string) => `/editor/page/${pageId}` } },
    },
    data: {
      blocks: [
        { id: 'before', type: 'paragraph', data: { text: 'Before' } },
        { id: 'pg', type: 'page', data: { pageId: 'p1', cache: { title: 'Plans' } } },
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

const pageCount = (output: OutputData): number => output.blocks.filter((block) => block.type === 'page').length;

const linkParagraphs = (output: OutputData): string[] =>
  output.blocks
    .filter((block) => block.type === 'paragraph' && String(block.data.text).includes('<a'))
    .map((block) => String(block.data.text));

beforeEach(() => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

describe('page block clipboard (one block per page)', () => {
  it('a copied page pastes as a link to the absolute page url', async () => {
    const instance = await createEditor();
    const written = await copyPage(instance, false);

    await paste(instance, written);

    const output = await instance.save();

    expect(pageCount(output)).toBe(1);
    expect(linkParagraphs(output)).toEqual([`<a href="${PAGE_URL}">Plans</a>`]);
    expect(written.get('text/plain')).toBe(`[Plans](${PAGE_URL})`);
  });

  it('a cut page comes back once; the next paste of the same cut is a link', async () => {
    const instance = await createEditor();
    const written = await copyPage(instance, true);

    await instance.blocks.delete(instance.blocks.getBlockIndex('pg'));
    await paste(instance, written);

    const afterFirst = await instance.save();

    expect(pageCount(afterFirst)).toBe(1);
    expect(linkParagraphs(afterFirst)).toEqual([]);

    await paste(instance, written);

    const afterSecond = await instance.save();

    expect(pageCount(afterSecond)).toBe(1);
    expect(linkParagraphs(afterSecond)).toEqual([`<a href="${PAGE_URL}">Plans</a>`]);
  });
});
