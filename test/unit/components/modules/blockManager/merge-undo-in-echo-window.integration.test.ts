/**
 * A Backspace merge right after a turn-into: one undo must restore both
 * blocks exactly, and redo must merge them again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { ListItem } from '../../../../../src/tools/list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void };
  blocks: API['blocks'];
  module: {
    blockManager: {
      getBlockById: (id: string) => Block | undefined;
      mergeBlocks: (target: Block, source: Block) => Promise<void>;
    };
    yjsManager: { stopCapturing: () => void };
  };
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
    tools: { paragraph: Paragraph, list: ListItem },
    data: { blocks },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const texts = async (instance: Runtime): Promise<string[]> =>
  (await instance.save()).blocks.map(block => `${String(block.id)}:${String(htmlOf((block.data as { text?: unknown }).text))}`);

const blockById = (instance: Runtime, id: string): Block => {
  const block = instance.module.blockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

describe('merging inside the frame a turn-into keeps open', () => {
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

  for (const inFrame of [true, false]) {
    it(`one undo restores both blocks and redo merges again (${inFrame ? 'inside' : 'after'} the frame)`, async () => {
      const instance = await boot([
        { id: 'a', type: 'list', data: { text: 'first', style: 'unordered' } },
        { id: 'b', type: 'list', data: { text: '<strong>ld</strong> tail', style: 'unordered' } },
      ]);

      // Backspace at the start of a list item first turns it into a paragraph.
      await instance.blocks.convert('b', 'paragraph');
      if (!inFrame) {
        await settleFrame();
      }
      const before = await texts(instance);

      // Inside the frame, the merge lands before the convert's echo window closes.
      await instance.module.blockManager.mergeBlocks(blockById(instance, 'a'), blockById(instance, 'b'));
      await settleFrame();

      const merged = await texts(instance);

      expect(merged).toEqual(['a:first<strong>ld</strong> tail']);

      instance.history.undo();
      await settleFrame();

      expect(await texts(instance)).toEqual(before);

      instance.history.redo();
      await settleFrame();

      expect(await texts(instance)).toEqual(merged);
    }, 30_000);
  }
});
