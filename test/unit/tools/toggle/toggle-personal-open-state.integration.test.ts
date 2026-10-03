/**
 * The toggle's open state round-trips through a real editor: read from this
 * browser's personal store at load, never from or into the saved document.
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

describe('toggle open state in a real editor', () => {
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

  it('opens a loaded toggle that this browser left open', async () => {
    localStorage.setItem('blok:view:doc-1:t:open', JSON.stringify({ v: true, t: Date.now() }));

    const loaded = await createEditor([{ id: 't', type: 'toggle', data: { text: 'title' } }]);

    expect(openAttrOf(holder, 't')).toBe('true');

    const saved = await loaded.save();

    expect(saved.blocks[0]?.data).not.toHaveProperty('isOpen');
  });

  it('loads a toggle collapsed when nothing is stored, whatever the data says', async () => {
    await createEditor([{ id: 't', type: 'toggle', data: { text: 'title', isOpen: true } }]);

    expect(openAttrOf(holder, 't')).toBe('false');
  });

  it('opens a toggle inserted in this tab and stores that', async () => {
    const loaded = await createEditor([{ id: 'p', type: 'paragraph', data: { text: 'x' } }]);
    const inserted = loaded.blocks.insert('toggle', { text: 'new' });

    await nextFrame();
    await settle();

    expect(openAttrOf(holder, inserted.id)).toBe('true');
    expect(loaded.viewState.get(inserted.id, 'open')).toBe(true);
    expect(localStorage.getItem(`blok:view:doc-1:${inserted.id}:open`)).not.toBeNull();
  });

  it('loads an old document carrying isOpen without adding an undo step', async () => {
    const loaded = await createEditor([{ id: 't', type: 'toggle', data: { text: 'title', isOpen: true } }]);

    await nextFrame();
    await settle();

    expect(loaded.history.canUndo()).toBe(false);
  });

  const stored = (): void => {
    localStorage.setItem('blok:view:doc-1:t:open', JSON.stringify({ v: true, t: Date.now() }));
  };

  const fixture: OutputBlockData[] = [
    { id: 't', type: 'toggle', data: { text: 'title' }, content: ['c'] },
    { id: 'c', type: 'paragraph', data: { text: 'kid' }, parent: 't' },
  ];

  const liveSlotOf = (editor: TestEditor, id: string): Element | null | undefined =>
    editor.module.blockManager.blocks.find(block => block.id === id)?.holder.querySelector('[data-blok-toggle-children]');

  const childHolder = (editor: TestEditor): HTMLElement | undefined =>
    editor.module.blockManager.blocks.find(block => block.id === 'c')?.holder;

  it('a replaced toggle stops reacting, so the live one keeps its child', async () => {
    stored();

    const loaded = await createEditor(fixture);
    const [toggle] = loaded.module.blockManager.blocks;

    loaded.module.blockManager.replace(toggle, 'toggle', { text: 'title' });
    await nextFrame();
    await settle();

    loaded.viewState.set('t', 'open', false);
    loaded.viewState.set('t', 'open', true);

    expect(childHolder(loaded)?.parentElement).toBe(liveSlotOf(loaded, 't'));
    expect(childHolder(loaded)?.classList.contains('hidden')).toBe(false);
  });

  it('a toggle converted away stops reacting to its stored state', async () => {
    stored();

    const loaded = await createEditor(fixture);

    await loaded.blocks.convert('t', 'header', { level: 2 });
    await nextFrame();
    await settle();

    loaded.viewState.set('t', 'open', false);

    expect(childHolder(loaded)?.isConnected).toBe(true);
    expect(childHolder(loaded)?.classList.contains('hidden')).toBe(false);
  });
});
