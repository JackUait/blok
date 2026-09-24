/**
 * Undo and redo rebuild blocks from the shared document. Every rebuilt block
 * must land inside its parent's run in the flat array, with its holder in its
 * home slot. The save gate (`Saver.assertTreePlacement`) throws under
 * NODE_ENV=test, so `save()` resolving is the placement check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Callout, Header, Toggle } from '../../../../../src/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void };
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

const boot = async (blocks: OutputBlockData[]): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, toggle: Toggle, callout: Callout },
    data: { blocks },
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

/** `id:tool^parent` for every block, in flat order. */
const flat = (instance: Runtime): string[] => instance.module.blockManager.blocks
  .map(block => `${block.id}:${block.name}^${block.parentId ?? '-'}`);

/** `id^parent` for every block in the shared document, in its order. */
const docFlat = (instance: Runtime): string[] => instance.module.yjsManager.toJSON()
  .map(block => `${block.id}^${block.parent ?? '-'}`);

const TOGGLE = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id,
  type: 'toggle',
  data: { text: id, isOpen: true },
  content,
  ...(parent !== undefined ? { parent } : {}),
});

const P = (id: string, parent?: string): OutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...(parent !== undefined ? { parent } : {}),
});

describe('undo and redo keep rebuilt blocks in their parent run', () => {
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

  it('undoing a replace after deleting a nested toggle puts the restored subtree back under its parent', async () => {
    const instance = await boot([
      TOGGLE('a', ['b']),
      TOGGLE('b', ['b1', 'b2'], 'a'),
      P('b1', 'b'),
      P('b2', 'b'),
      TOGGLE('m', ['m1']),
      P('m1', 'm'),
      TOGGLE('d', ['e']),
      TOGGLE('e', ['e1', 'e2'], 'd'),
      P('e1', 'e'),
      P('e2', 'e'),
    ]);
    const initial = flat(instance);

    // Deleting b lifts its children into a.
    await step(instance, () => instance.blocks.delete(1, false));
    const afterDelete = flat(instance);

    // Replacing e (flat index 7 now) gives it a new id and moves its children.
    await step(instance, () => instance.blocks.insert('paragraph', { text: 'x' }, undefined, 7, false, true));
    const afterReplace = flat(instance);

    await step(instance, () => instance.history.undo());
    expect(flat(instance)).toEqual(afterDelete);
    await expect(instance.save()).resolves.toBeDefined();

    await step(instance, () => instance.history.undo());
    expect(flat(instance)).toEqual(initial);
    await expect(instance.save()).resolves.toBeDefined();

    await step(instance, () => instance.history.redo());
    expect(flat(instance)).toEqual(afterDelete);
    await expect(instance.save()).resolves.toBeDefined();

    await step(instance, () => instance.history.redo());
    expect(flat(instance)).toEqual(afterReplace);
    await expect(instance.save()).resolves.toBeDefined();
  }, 30_000);

  // The callout saves other data than legacy data gives it, so undo rebuilds it.
  it('undo and redo of a convert around a callout booted with legacy data keep its children on screen', async () => {
    const instance = await boot([
      { id: 'h', type: 'header', data: { text: 'h', level: 2, isToggleable: true, isOpen: true }, content: ['C'] },
      { id: 'C', type: 'callout', data: { text: 'Callout' }, parent: 'h', content: ['k1', 'k2'] },
      P('k1', 'C'),
      P('k2', 'C'),
      P('z'),
    ]);
    const initial = flat(instance);

    await step(instance, () => instance.blocks.convert('h', 'toggle', { text: 'h' }));
    const converted = flat(instance);

    await expect(instance.save()).resolves.toBeDefined();

    await step(instance, () => instance.history.undo());
    await expect(instance.save()).resolves.toBeDefined();
    expect(flat(instance)).toEqual(initial);

    await step(instance, () => instance.history.redo());
    await expect(instance.save()).resolves.toBeDefined();
    expect(flat(instance)).toEqual(converted);
  }, 30_000);

  // The Enter makes the callout write back the colour keys its data lacked,
  // as a tracked step; undoing that replays callout data, and a callout has
  // no setData, so the replay rebuilds it.
  it('undo and redo of Enter in the child of a callout saved with only an emoji keep the child on screen', async () => {
    const instance = await boot([
      { id: 'C', type: 'callout', data: { emoji: '💡' }, content: ['k'] },
      P('k', 'C'),
    ]);
    const initial = flat(instance);
    const kHolder = holder?.querySelector<HTMLElement>('[data-blok-id="k"]');
    // jsdom does not reflect the contentEditable property to the attribute.
    const editable = Array.from(kHolder?.querySelectorAll<HTMLElement>('*') ?? [])
      .find(element => element.contentEditable === 'true');

    if (editable === null || editable === undefined) {
      throw new Error('no editable for k');
    }

    // Browsers reflect it; the key handlers find the editable by it.
    editable.setAttribute('contenteditable', 'true');

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
    instance.module.yjsManager.stopCapturing();
    const entered = flat(instance);

    expect(entered).toHaveLength(3);
    await expect(instance.save()).resolves.toBeDefined();

    // The save-back joins the Enter's step, so one undo and one redo cover both.
    await step(instance, () => instance.history.undo());
    await expect(instance.save()).resolves.toBeDefined();
    expect(flat(instance)).toEqual(initial);

    await step(instance, () => instance.history.redo());
    await expect(instance.save()).resolves.toBeDefined();
    expect(flat(instance)).toEqual(entered);
  }, 30_000);

  it('updating the data of a callout with a child keeps the child on screen', async () => {
    const instance = await boot([
      { id: 'C', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['k'] },
      P('k', 'C'),
    ]);

    await step(instance, () => instance.blocks.update('C', { emoji: '🔥' }));

    await expect(instance.save()).resolves.toBeDefined();
  }, 30_000);

  it('deleting a nested toggle writes its lifted children to the doc', async () => {
    const instance = await boot([
      TOGGLE('a', ['b']),
      TOGGLE('b', ['b1'], 'a'),
      P('b1', 'b'),
      P('z'),
    ]);

    await step(instance, () => instance.blocks.delete(1, false));

    expect(instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`))
      .toEqual(['a^-', 'b1^a', 'z^-']);
    expect(docFlat(instance)).toEqual(['a^-', 'b1^a', 'z^-']);
  }, 30_000);
});
