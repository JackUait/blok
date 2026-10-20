import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

class TestEditor extends Blok {
  declare public readonly blocks: API['blocks'];
  declare public readonly history: API['history'];
  declare public readonly readOnly: API['readOnly'];
  declare public save: () => Promise<OutputData>;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

// API gestures end in a later task, not just a microtask.
const settle = async (): Promise<void> => {
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flush();
};

const boot = async (): Promise<TestEditor> => {
  const instance = new TestEditor({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'A' } },
        { id: 'b', type: 'paragraph', data: { text: 'B' } },
        { id: 'c', type: 'paragraph', data: { text: 'C' } },
      ],
    },
  });

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const saved = async (instance: TestEditor): Promise<Array<{ id: string | undefined; text: unknown }>> =>
  (await instance.save()).blocks.map((block) => ({ id: block.id, text: htmlOf(block.data.text) }));

describe('history.latestStep / history.undoStep', () => {
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

  it('undoes the step while it is still the newest', async () => {
    const instance = await boot();

    await instance.blocks.delete(1);
    const step = instance.history.latestStep();

    await settle();

    expect(step).toBeDefined();
    expect(step !== undefined && instance.history.undoStep(step)).toBe(true);
    await settle();
    expect((await saved(instance)).map((block) => block.id)).toEqual(['a', 'b', 'c']);
  });

  it('does nothing once a later change is on top, so that change survives', async () => {
    const instance = await boot();

    await instance.blocks.delete(1);
    const step = instance.history.latestStep();

    await settle();
    await instance.blocks.update('a', { text: 'A typed' });
    await settle();

    expect(step !== undefined && instance.history.undoStep(step)).toBe(false);
    await settle();
    expect(await saved(instance)).toEqual([
      { id: 'a', text: 'A typed' },
      { id: 'c', text: 'C' },
    ]);
  });

  it('does nothing while the editor is read-only', async () => {
    const instance = await boot();

    await instance.blocks.delete(1);
    const step = instance.history.latestStep();

    await settle();
    await instance.readOnly.set(true);

    expect(step !== undefined && instance.history.undoStep(step)).toBe(false);
  });
});
