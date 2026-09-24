/**
 * A callout saved in the legacy shape (`variant`, `isEmojiVisible`) is
 * normalised by the tool, so its saved data differs from the shared document.
 * Every undo that replays its data rebuilds it. The save gate
 * (`Saver.assertTreePlacement`) throws under NODE_ENV=test, so `save()`
 * resolving is the placement check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Callout, Header } from '../../../../src/tools';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  blocks: API['blocks'];
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
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

const LEGACY = { variant: 'note', isEmojiVisible: true, emoji: '💡' };

const boot = async (): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, callout: Callout, header: Header },
    data: {
      blocks: [
        { id: 'box', type: 'callout', data: LEGACY, content: ['k'] },
        { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 'box' },
      ],
    },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const step = async (instance: Runtime, action: () => unknown): Promise<void> => {
  await action();
  await settleFrame();
  instance.module.yjsManager.stopCapturing();
};

/** `id^parent` and the data of every saved block. */
const saved = async (instance: Runtime): Promise<string> => {
  const output = await instance.save();

  return JSON.stringify(output.blocks.map(block => [block.id, block.parent ?? null, block.data]));
};

/** Undo until nothing is left, so every tracked step is taken back. */
const undoAll = async (instance: Runtime): Promise<void> => {
  for (let guard = 0; guard < 20 && instance.history.canUndo(); guard++) {
    await step(instance, () => instance.history.undo());
  }
};

const blockById = (instance: Runtime, id: string): Block => {
  const block = instance.module.blockManager.blocks.find(candidate => candidate.id === id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

/** Browsers reflect contentEditable to the attribute; jsdom does not, and the key handlers look for it. */
const editableOf = (id: string): HTMLElement => {
  const editable = Array.from(holder?.querySelectorAll<HTMLElement>(`[data-blok-id="${id}"] *`) ?? [])
    .find(element => element.contentEditable === 'true');

  if (editable === undefined) {
    throw new Error(`no editable for ${id}`);
  }
  editable.setAttribute('contenteditable', 'true');

  return editable;
};

describe('a callout saved in the legacy shape', () => {
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

  it('is unchanged after a blocks.update() and its undo', async () => {
    const instance = await boot();
    const loaded = await saved(instance);

    await step(instance, () => instance.blocks.update('box', { emoji: '🔥' }));
    await expect(instance.save()).resolves.toBeDefined();

    await step(instance, () => instance.history.undo());

    expect(await saved(instance)).toBe(loaded);
  }, 30_000);

  it('is unchanged after Enter in its child and undo', async () => {
    const instance = await boot();
    const loaded = await saved(instance);
    const editable = editableOf('k');

    await step(instance, () => {
      const range = document.createRange();

      editable.focus();
      range.selectNodeContents(editable);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await settle(300);
    await settleFrame();
    expect(instance.module.blockManager.blocks).toHaveLength(3);

    await undoAll(instance);

    expect(await saved(instance)).toBe(loaded);
  }, 30_000);

  it('is unchanged after converting its child and undo', async () => {
    const instance = await boot();
    const loaded = await saved(instance);

    await step(instance, () => instance.blocks.convert('k', 'header', { level: 2 }));
    expect(blockById(instance, 'k').name).toBe('header');

    await undoAll(instance);

    expect(await saved(instance)).toBe(loaded);
  }, 30_000);

  it('is unchanged after a colour change and undo', async () => {
    const instance = await boot();
    const loaded = await saved(instance);
    const colour = blockById(instance, 'box').getTunes().toolTunes
      .find(item => 'name' in item && item.name === 'callout-color');
    const picker = colour !== undefined && 'children' in colour
      ? (colour.children?.items?.[0] as { element?: HTMLElement } | undefined)?.element
      : undefined;
    const swatch = picker?.querySelector<HTMLButtonElement>('[data-blok-testid="callout-color-swatch-background-color-red"]');

    if (swatch === null || swatch === undefined) {
      throw new Error('no red swatch');
    }

    await step(instance, () => swatch.click());
    await settle(300);
    await settleFrame();
    expect(JSON.parse(await saved(instance))[0][2].backgroundColor).toBe('red');

    await undoAll(instance);

    expect(await saved(instance)).toBe(loaded);
  }, 30_000);

  it('is unchanged after it is deleted and the delete is undone', async () => {
    const instance = await boot();
    const loaded = await saved(instance);

    await step(instance, () => instance.blocks.delete(0));
    expect(instance.module.blockManager.blocks.map(block => block.id)).not.toContain('box');

    await undoAll(instance);

    expect(await saved(instance)).toBe(loaded);
  }, 30_000);
});
