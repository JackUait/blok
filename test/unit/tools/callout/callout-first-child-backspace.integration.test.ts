import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ToggleItem } from '../../../../src/tools/toggle';
import { CalloutTool } from '../../../../src/tools/callout';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * Backspace at the start of an empty FIRST line of a callout removes that
 * line, unless the line's own tool already handled the key. Emptiness must
 * ignore toggle chrome, and a key pressed in a block nested inside the first
 * line belongs to that block.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      toggle: ToggleItem,
      callout: CalloutTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const editableOf = (id: string): HTMLElement => {
  const blockHolder = holder?.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = Array.from(blockHolder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find((element) => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable for ${id}`);
  }

  return editable;
};

/** Put the caret at the start of the block's first editable and press Backspace there. */
const pressBackspaceAtStart = async (id: string): Promise<void> => {
  const editable = editableOf(id);
  const range = document.createRange();

  editable.focus();
  range.setStart(editable, 0);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);

  editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
};

const savedTree = async (instance: TestEditor): Promise<string[]> =>
  (await instance.save()).blocks.map((block) => `${block.id}:${block.type}:${block.parent ?? 'root'}`);

describe('callout: Backspace on an empty first line', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('lets an empty toggle heading first line handle its own Backspace (it turns into a plain heading)', async () => {
    const instance = await createEditor([
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'header', data: { text: '', level: 2, isToggleable: true }, parent: 'C' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await pressBackspaceAtStart('S');

    const saved = await instance.save();

    expect(saved.blocks.map((block) => `${block.id}:${block.type}:${block.parent ?? 'root'}`))
      .toEqual(['C:callout:root', 'S:header:C', 'Q:paragraph:C']);
    expect(saved.blocks[1].data.isToggleable).toBeFalsy();
  }, 30_000);

  it('removes an empty plain heading first line', async () => {
    const instance = await createEditor([
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'header', data: { text: '', level: 2 }, parent: 'C' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await pressBackspaceAtStart('S');

    expect(await savedTree(instance)).toEqual(['C:callout:root', 'Q:paragraph:C']);
  }, 30_000);

  it('keeps a first-line toggle heading whose title is empty but whose child has text', async () => {
    const instance = await createEditor([
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true }, parent: 'C', content: ['K'] },
      { id: 'K', type: 'paragraph', data: { text: 'kid' }, parent: 'S' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await pressBackspaceAtStart('S');

    // The heading loses its toggle; its child moves up into the callout, after it.
    expect(await savedTree(instance)).toEqual(['C:callout:root', 'S:header:C', 'K:paragraph:C', 'Q:paragraph:C']);
  }, 30_000);

  it('leaves Backspace in an empty block nested inside the first line to that block', async () => {
    const instance = await createEditor([
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true }, parent: 'C', content: ['K'] },
      { id: 'K', type: 'paragraph', data: { text: '' }, parent: 'S' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await pressBackspaceAtStart('K');

    expect(await savedTree(instance)).toContain('S:header:C');
  }, 30_000);

  it('lets an empty toggle first line handle its own Backspace (it turns into text)', async () => {
    const instance = await createEditor([
      { id: 'C', type: 'callout', data: { emoji: '' }, content: ['S', 'Q'] },
      { id: 'S', type: 'toggle', data: { text: '' }, parent: 'C' },
      { id: 'Q', type: 'paragraph', data: { text: 'q' }, parent: 'C' },
    ]);

    await pressBackspaceAtStart('S');

    expect(await savedTree(instance)).toEqual(['C:callout:root', 'S:paragraph:C', 'Q:paragraph:C']);
  }, 30_000);
});
