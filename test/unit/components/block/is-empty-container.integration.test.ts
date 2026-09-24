import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ToggleItem } from '../../../../src/tools/toggle';
import { CalloutTool } from '../../../../src/tools/callout';
import { ImageTool } from '../../../../src/tools/image';
import type { API, OutputBlockData } from '../../../../types';

/**
 * Block.isEmpty: a block with child blocks is never empty, because callers
 * replace or remove an empty block and would strand its children. A childless
 * block is empty when it has no content; toggle chrome (the "Empty toggle…"
 * body placeholder, the arrow) never counts as content.
 */

interface TestEditor {
  isReady: Promise<unknown>;
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
      image: ImageTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const isEmpty = (instance: TestEditor, id: string): boolean | undefined => instance.blocks.getById(id)?.isEmpty;

describe('Block.isEmpty on containers', () => {
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

  it('an empty toggle reads empty: its body placeholder is not content', async () => {
    const instance = await createEditor([
      { id: 'T0', type: 'toggle', data: { text: '' } },
    ]);

    expect(isEmpty(instance, 'T0')).toBe(true);
  }, 30_000);

  it('an empty toggle heading reads empty: its body placeholder is not content', async () => {
    const instance = await createEditor([
      { id: 'H0', type: 'header', data: { text: '', level: 2, isToggleable: true } },
    ]);

    expect(isEmpty(instance, 'H0')).toBe(true);
  }, 30_000);

  it('a container with only empty child blocks is not empty', async () => {
    const instance = await createEditor([
      { id: 'T1', type: 'toggle', data: { text: '', isOpen: true }, content: ['T1c'] },
      { id: 'T1c', type: 'paragraph', data: { text: '' }, parent: 'T1' },
      { id: 'H1', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true }, content: ['H1c'] },
      { id: 'H1c', type: 'paragraph', data: { text: '' }, parent: 'H1' },
      { id: 'C1', type: 'callout', data: { emoji: '' }, content: ['C1c'] },
      { id: 'C1c', type: 'paragraph', data: { text: '' }, parent: 'C1' },
    ]);

    expect(isEmpty(instance, 'T1')).toBe(false);
    expect(isEmpty(instance, 'H1')).toBe(false);
    expect(isEmpty(instance, 'C1')).toBe(false);
    expect(isEmpty(instance, 'C1c')).toBe(true);
  }, 30_000);

  it('a container whose child has content is not empty', async () => {
    const instance = await createEditor([
      { id: 'T2', type: 'toggle', data: { text: '', isOpen: true }, content: ['T2c'] },
      { id: 'T2c', type: 'paragraph', data: { text: 'kid' }, parent: 'T2' },
      { id: 'C2', type: 'callout', data: { emoji: '' }, content: ['C2c'] },
      { id: 'C2c', type: 'paragraph', data: { text: 'kid' }, parent: 'C2' },
      { id: 'T3', type: 'toggle', data: { text: '', isOpen: true }, content: ['T3c'] },
      { id: 'T3c', type: 'image', data: { url: 'https://example.com/a.png' }, parent: 'T3' },
    ]);

    expect(isEmpty(instance, 'T2')).toBe(false);
    expect(isEmpty(instance, 'C2')).toBe(false);
    expect(isEmpty(instance, 'T3')).toBe(false);
  }, 30_000);

  it('a toggle with a title is not empty', async () => {
    const instance = await createEditor([
      { id: 'T4', type: 'toggle', data: { text: 'title' } },
    ]);

    expect(isEmpty(instance, 'T4')).toBe(false);
  }, 30_000);
});
