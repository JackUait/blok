/**
 * Turn into keeps block colour where the target has it, and one undo brings
 * the coloured source back exactly, whatever the target keeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { CodeTool } from '../../../../../src/tools/code';
import { Header } from '../../../../../src/tools/header';
import { ListItem } from '../../../../../src/tools/list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Quote } from '../../../../../src/tools/quote';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void };
  blocks: API['blocks'];
  module: { yjsManager: { stopCapturing: () => void } };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settleFrame = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await new Promise(resolve => setTimeout(resolve, 0));
};

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: ToggleItem, header: Header, list: ListItem, quote: Quote, code: CodeTool },
    data: { blocks },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const COLORED: OutputBlockData[] = [
  { id: 'p', type: 'paragraph', data: { text: 'Hello', backgroundColor: 'blue', textColor: 'red' } },
];

describe('turning a coloured block into another block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('keeps the colour on a toggle', async () => {
    const instance = await boot(COLORED);

    await instance.blocks.convert('p', 'toggle');
    await settleFrame();

    expect((await instance.save()).blocks).toEqual([
      { id: 'p', type: 'toggle', data: { text: 'Hello', isOpen: true, textColor: 'red', backgroundColor: 'blue' } },
    ]);
  }, 30_000);

  // A target without block colour must not hold it in the document either:
  // the first edit prunes it outside any undo step.
  for (const tool of ['list', 'quote', 'code']) {
    it(`comes back exactly as it was after an edit on the ${tool} and two undos`, async () => {
      const instance = await boot(COLORED);
      const before = JSON.stringify((await instance.save()).blocks);

      await instance.blocks.convert('p', tool);
      await settleFrame();
      instance.module.yjsManager.stopCapturing();

      const content = holder?.querySelector('[data-blok-id="p"] [data-blok-element-content]');
      const text = content === null || content === undefined
        ? null
        : document.createTreeWalker(content, NodeFilter.SHOW_TEXT).nextNode();

      if (!(text instanceof Text)) {
        throw new Error('no text');
      }

      text.appendData('!');
      await new Promise(resolve => setTimeout(resolve, 500));
      await settleFrame();
      instance.module.yjsManager.stopCapturing();

      instance.history.undo();
      await settleFrame();
      instance.history.undo();
      await settleFrame();

      expect(JSON.stringify((await instance.save()).blocks)).toBe(before);
    }, 30_000);
  }

  for (const tool of ['toggle', 'header', 'list', 'quote', 'code']) {
    it(`comes back exactly as it was after one undo (${tool})`, async () => {
      const instance = await boot(COLORED);
      const before = JSON.stringify((await instance.save()).blocks);

      await instance.blocks.convert('p', tool);
      await settleFrame();
      instance.module.yjsManager.stopCapturing();

      instance.history.undo();
      await settleFrame();

      expect(JSON.stringify((await instance.save()).blocks)).toBe(before);
    }, 30_000);
  }
});
