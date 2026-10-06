import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

// Eviction runs in a rAF that re-queues itself while Yjs replay settles.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      tabs: TabsTool,
      tab: TabTool,
      toggle: ToggleItem,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Each block as `id<parent`, in saved order. */
const shape = (data: OutputData): string[] =>
  data.blocks.map(block => `${block.id ?? '?'}<${block.parent ?? 'root'}`);

const contentOf = (data: OutputData, id: string): string[] =>
  data.blocks.find(block => block.id === id)?.content ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  vi.restoreAllMocks();
});

describe('tabs block evicting non-tab children', () => {
  it('keeps a stray inside the toggle that holds the tabs, right after the tabs block', async () => {
    const instance = await boot([
      { id: 'o', type: 'toggle', data: { text: 'outer' }, content: ['tabs', 'after'] },
      { id: 'tabs', type: 'tabs', data: {}, parent: 'o', content: ['t1', 'p'] },
      { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 'p', type: 'paragraph', data: { text: 'stray' }, parent: 'tabs' },
      { id: 'after', type: 'paragraph', data: { text: 'after' }, parent: 'o' },
      { id: 'tail', type: 'paragraph', data: { text: 'tail' } },
    ]);

    const saved = await instance.save();

    expect(contentOf(saved, 'o')).toEqual(['tabs', 'p', 'after']);
    expect(contentOf(saved, 'tabs')).toEqual(['t1']);
    expect(shape(saved)).toEqual(['o<root', 'tabs<o', 't1<tabs', 'p1<t1', 'p<o', 'after<o', 'tail<root']);

    const holderOf = (id: string): Element | null => document.querySelector(`[data-blok-id="${id}"]`);
    const stray = holderOf('p');

    expect(stray?.parentElement?.closest('[data-blok-id]')).toBe(holderOf('o'));
    expect(holderOf('tabs')?.nextElementSibling).toBe(stray);
  });

  it('keeps strays and their children in the inner toggle of two nested toggles, in order', async () => {
    const instance = await boot([
      { id: 'o', type: 'toggle', data: { text: 'outer' }, content: ['c', 'oafter'] },
      { id: 'c', type: 'toggle', data: { text: 'inner' }, parent: 'o', content: ['tabs', 'cafter'] },
      { id: 'tabs', type: 'tabs', data: {}, parent: 'c', content: ['s1', 't1', 's2'] },
      { id: 's1', type: 'toggle', data: { text: 'stray one' }, parent: 'tabs', content: ['s1c'] },
      { id: 's1c', type: 'paragraph', data: { text: 'stray child' }, parent: 's1' },
      { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'tabs' },
      { id: 's2', type: 'paragraph', data: { text: 'stray two' }, parent: 'tabs' },
      { id: 'cafter', type: 'paragraph', data: { text: 'c after' }, parent: 'c' },
      { id: 'oafter', type: 'paragraph', data: { text: 'o after' }, parent: 'o' },
    ]);

    const saved = await instance.save();

    expect(contentOf(saved, 'c')).toEqual(['tabs', 's1', 's2', 'cafter']);
    expect(contentOf(saved, 's1')).toEqual(['s1c']);
    expect(shape(saved)).toEqual([
      'o<root', 'c<o', 'tabs<c', 't1<tabs', 's1<c', 's1c<s1', 's2<c', 'cafter<c', 'oafter<o',
    ]);
  });

  it('puts each tabs block’s strays right after that block when two share a toggle', async () => {
    const instance = await boot([
      { id: 'o', type: 'toggle', data: { text: 'outer' }, content: ['tabsA', 'tabsB'] },
      { id: 'tabsA', type: 'tabs', data: {}, parent: 'o', content: ['ta', 'a1', 'a2'] },
      { id: 'ta', type: 'tab', data: { title: 'A' }, parent: 'tabsA' },
      { id: 'a1', type: 'paragraph', data: { text: 'a1' }, parent: 'tabsA' },
      { id: 'a2', type: 'paragraph', data: { text: 'a2' }, parent: 'tabsA' },
      { id: 'tabsB', type: 'tabs', data: {}, parent: 'o', content: ['tb', 'b1'] },
      { id: 'tb', type: 'tab', data: { title: 'B' }, parent: 'tabsB' },
      { id: 'b1', type: 'paragraph', data: { text: 'b1' }, parent: 'tabsB' },
    ]);

    const saved = await instance.save();

    expect(contentOf(saved, 'o')).toEqual(['tabsA', 'a1', 'a2', 'tabsB', 'b1']);
    expect(shape(saved)).toEqual([
      'o<root', 'tabsA<o', 'ta<tabsA', 'a1<o', 'a2<o', 'tabsB<o', 'tb<tabsB', 'b1<o',
    ]);
  });

  // Same documents as the view's document-model tests: both sides must read one order.
  it('saves the view fixture of strays in two nested toggles in this order', async () => {
    const instance = await boot([
      { id: 'before', type: 'paragraph', data: { text: 'B' } },
      { id: 'o', type: 'toggle', data: { text: 'O' }, content: ['c', 'o2'] },
      { id: 'c', type: 'toggle', data: { text: 'C' }, parent: 'o', content: ['tabs', 'i2'] },
      { id: 'tabs', type: 'tabs', data: {}, parent: 'c', content: ['s1', 't1'] },
      { id: 's1', type: 'paragraph', data: { text: 'S1' }, parent: 'tabs', content: ['s1c'] },
      { id: 's1c', type: 'paragraph', data: { text: 'S1C' }, parent: 's1' },
      { id: 't1', type: 'tab', data: { title: 'Do' }, parent: 'tabs' },
      { id: 'i2', type: 'paragraph', data: { text: 'I2' }, parent: 'c' },
      { id: 'o2', type: 'paragraph', data: { text: 'O2' }, parent: 'o' },
      { id: 'after', type: 'paragraph', data: { text: 'A' } },
    ]);

    expect(shape(await instance.save())).toEqual([
      'before<root', 'o<root', 'c<o', 'tabs<c', 't1<tabs', 's1<c', 's1c<s1', 'i2<c', 'o2<o', 'after<root',
    ]);
  });

  it('saves the view fixture of two tabs blocks in one toggle in this order', async () => {
    const instance = await boot([
      { id: 'c', type: 'toggle', data: { text: 'C' }, content: ['ta', 'tb'] },
      { id: 'ta', type: 'tabs', data: {}, parent: 'c', content: ['a1', 'ta1', 'a2'] },
      { id: 'a1', type: 'paragraph', data: { text: 'A1' }, parent: 'ta' },
      { id: 'ta1', type: 'tab', data: { title: 'x' }, parent: 'ta' },
      { id: 'a2', type: 'paragraph', data: { text: 'A2' }, parent: 'ta' },
      { id: 'tb', type: 'tabs', data: {}, parent: 'c', content: ['b1', 'tb1'] },
      { id: 'b1', type: 'paragraph', data: { text: 'B1' }, parent: 'tb' },
      { id: 'tb1', type: 'tab', data: { title: 'y' }, parent: 'tb' },
      { id: 'after', type: 'paragraph', data: { text: 'A' } },
    ]);

    expect(shape(await instance.save())).toEqual([
      'c<root', 'ta<c', 'ta1<ta', 'a1<c', 'a2<c', 'tb<c', 'tb1<tb', 'b1<c', 'after<root',
    ]);
  });

  it('puts a stray of a root tabs block at the root right after the tabs block', async () => {
    const instance = await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['s1', 't1', 's2'] },
      { id: 's1', type: 'toggle', data: { text: 'stray one' }, parent: 'tabs', content: ['s1c'] },
      { id: 's1c', type: 'paragraph', data: { text: 'stray child' }, parent: 's1' },
      { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'tabs', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 's2', type: 'paragraph', data: { text: 'stray two' }, parent: 'tabs' },
      { id: 'tail', type: 'paragraph', data: { text: 'tail' } },
    ]);

    const saved = await instance.save();

    expect(shape(saved)).toEqual(['tabs<root', 't1<tabs', 'p1<t1', 's1<root', 's1c<s1', 's2<root', 'tail<root']);
  });
});
