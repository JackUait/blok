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
    setBlockParent: (blockId: string, parentId: string | null) => void;
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

const saved = async (instance: TestEditor): Promise<Array<{ id?: string; parent?: string }>> =>
  (await instance.save()).blocks.map((block) => ({ id: block.id,
    parent: block.parent }));

describe('blocks.setBlockParent — undo steps', () => {
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

    const inserted = instance.blocks.insert('paragraph', { text: 'A' }, undefined, 1);

    await flush();
    await nextTask();

    instance.blocks.setBlockParent(inserted.id, 'p1');
    await flush();
    await nextTask();

    instance.history.undo();
    await flush();

    expect(await saved(instance)).toEqual([{ id: 'p1',
      parent: undefined },
    { id: inserted.id,
      parent: undefined }]);
  });
});
