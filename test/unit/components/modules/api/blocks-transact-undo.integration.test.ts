import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    insert: (type?: string, data?: unknown, config?: unknown, index?: number) => { id: string };
    transact: (fn: () => void) => void;
  };
  history: { undo: () => void };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/**
 * A later task. An API call's gesture lasts until the end of its task, so a
 * microtask flush alone would keep both calls in one step.
 */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const savedTexts = async (instance: TestEditor): Promise<unknown[]> =>
  (await instance.save()).blocks.map((block) => block.data.text);

describe('blocks.transact — undo steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('is an undo step of its own when host code calls it after another API call', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'first' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    instance.blocks.insert('paragraph', { text: 'A' }, undefined, 1);
    await flush();
    await nextTask();

    instance.blocks.transact(() => {
      instance.blocks.insert('paragraph', { text: 'B' }, undefined, 2);
    });
    await flush();
    await nextTask();

    instance.history.undo();
    await flush();

    expect(await savedTexts(instance)).toEqual(['first', 'A']);
  });
});
