/**
 * The toggle heading's open state round-trips through a real editor: read from
 * this browser's personal store at load, never from or into the saved document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../src/tools/toggle';
import { Header } from '../../../../src/tools/header';
import type { Block } from '../../../../src/components/block';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: API['history'];
  viewState: API['viewState'];
  module: {
    blockManager: {
      blocks: Block[];
      replace: (block: Block, tool: string, data: Record<string, unknown>) => Block;
    };
  };
}

const nextFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => resolve());
});

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const openAttrOf = (holder: HTMLElement, blockId: string): string | null | undefined =>
  holder.querySelector(`[data-blok-id="${blockId}"] [data-blok-toggle-open]`)?.getAttribute('data-blok-toggle-open');

describe('toggle heading open state in a real editor', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | undefined;

  const createEditor = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
    const created = new Blok({
      holder,
      tools: { paragraph: Paragraph, toggle: ToggleItem, header: Header },
      data: { id: 'doc-1', blocks },
    }) as unknown as TestEditor;

    editor = created;
    await created.isReady;
    await nextFrame();
    await settle();

    return created;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    editor = undefined;
    await settle();
    holder.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const heading = (id: string, extra: Record<string, unknown> = {}): OutputBlockData => (
    { id, type: 'header', data: { text: 'title', level: 2, isToggleable: true, ...extra } }
  );

  it('opens a loaded toggle heading that this browser left open, and saves no isOpen', async () => {
    localStorage.setItem('blok:view:doc-1:h:open', JSON.stringify({ v: true, t: Date.now() }));

    const loaded = await createEditor([heading('h')]);

    expect(openAttrOf(holder, 'h')).toBe('true');

    const saved = await loaded.save();

    expect(saved.blocks[0]?.data).not.toHaveProperty('isOpen');
    expect(saved.blocks[0]?.data).toMatchObject({ isToggleable: true });
  });

  it('loads a toggle heading collapsed when nothing is stored, whatever the data says', async () => {
    await createEditor([heading('h', { isOpen: true })]);

    expect(openAttrOf(holder, 'h')).toBe('false');
  });

  it('opens a toggle heading inserted in this tab and stores that', async () => {
    const loaded = await createEditor([{ id: 'p', type: 'paragraph', data: { text: 'x' } }]);
    const inserted = loaded.blocks.insert('header', { text: 'new', level: 2, isToggleable: true });

    await nextFrame();
    await settle();

    expect(openAttrOf(holder, inserted.id)).toBe('true');
    expect(loaded.viewState.get(inserted.id, 'open')).toBe(true);
  });

  it('opens a paragraph converted into a toggle heading in this tab', async () => {
    const loaded = await createEditor([{ id: 'p', type: 'paragraph', data: { text: 'x' } }]);

    await loaded.blocks.convert('p', 'header', { level: 2, isToggleable: true });
    await nextFrame();
    await settle();

    expect(openAttrOf(holder, 'p')).toBe('true');
    expect(loaded.viewState.get('p', 'open')).toBe(true);
  });

  it('opens a loaded plain heading turned into a toggle heading in this tab', async () => {
    const loaded = await createEditor([{ id: 'h', type: 'header', data: { text: 'x', level: 2 } }]);

    await loaded.blocks.convert('h', 'header', { level: 2, isToggleable: true });
    await nextFrame();
    await settle();

    expect(openAttrOf(holder, 'h')).toBe('true');
    expect(loaded.viewState.get('h', 'open')).toBe(true);
  });

  it('opens a toggle heading made by the "># " shortcut path (replace)', async () => {
    const loaded = await createEditor([{ id: 'p', type: 'paragraph', data: { text: 'x' } }]);
    const [paragraph] = loaded.module.blockManager.blocks;
    const replaced = loaded.module.blockManager.replace(paragraph, 'header', { text: 'x', level: 2, isToggleable: true });

    await nextFrame();
    await settle();

    expect(openAttrOf(holder, replaced.id)).toBe('true');
    expect(loaded.viewState.get(replaced.id, 'open')).toBe(true);
  });

  it('loads an old document carrying isOpen without adding an undo step', async () => {
    const loaded = await createEditor([heading('h', { isOpen: true })]);

    await nextFrame();
    await settle();

    expect(loaded.history.canUndo()).toBe(false);
  });
});
