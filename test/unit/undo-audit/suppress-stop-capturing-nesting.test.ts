import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';
import type { API, OutputData } from '../../../types';
import { savedAsHtml } from '../helpers/saved-as-html';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  blocks: API['blocks'];
  module: {
    yjsManager: { stopCapturing: () => void; joinMovesToStep: (fn: () => void) => void };
    blockManager: {
      transactForTool: (fn: () => void) => void;
      move: (toIndex: number, fromIndex: number) => void;
    };
  };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settleFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const texts = async (instance: Runtime): Promise<string[]> =>
  savedAsHtml(await instance.save()).blocks.map(block => String(block.data.text));

const boot = async (): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [
      { id: 'a', type: 'paragraph', data: { text: 'a' } },
      { id: 'b', type: 'paragraph', data: { text: 'b' } },
      { id: 'c', type: 'paragraph', data: { text: 'c' } },
    ] },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

describe('undo step boundary inside a tool transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('public transact: a move then an insert undo as one step', async () => {
    const instance = await boot();

    instance.blocks.transact(() => {
      instance.blocks.move(0, 2);
      instance.blocks.insert('paragraph', { text: 'new' }, {}, 3, false);
    });
    await settleFrame();
    await settle(50);
    instance.module.yjsManager.stopCapturing();

    expect(await texts(instance)).toEqual(['c', 'a', 'b', 'new']);

    instance.history.undo();
    await settleFrame();

    expect(await texts(instance)).toEqual(['a', 'b', 'c']);
  });

  // No gesture has started yet, so stopCapturing still closes steps. The move
  // used to clear the suppress flag the open transaction had set, and the
  // insert after it then split the step.
  it('before any gesture: a move then an insert inside a tool transaction undo as one step', async () => {
    const instance = await boot();
    const bm = instance.module.blockManager;

    instance.module.yjsManager.joinMovesToStep(() => {
      bm.transactForTool(() => {
        bm.move(0, 2);
        instance.blocks.insertAt('paragraph', { text: 'new' });
      });
    });
    await settleFrame();
    await settle(50);
    instance.module.yjsManager.stopCapturing();

    expect(await texts(instance)).toEqual(['c', 'a', 'b', 'new']);

    instance.history.undo();
    await settleFrame();

    expect(await texts(instance)).toEqual(['a', 'b', 'c']);
  });
});
