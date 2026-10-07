import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { OutputBlockData, OutputData } from '../../../../types';
import { savedAsHtml } from '../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
};

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, tabs: TabsTool, tab: TabTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const press = async (id: string, key: 'Backspace' | 'Delete', at: 'start' | 'end'): Promise<void> => {
  const blockHolder = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = Array.from(blockHolder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find(element => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable in ${id}`);
  }

  const range = document.createRange();

  editable.focus();
  range.selectNodeContents(editable);
  range.collapse(at === 'start');
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await new Promise(resolve => {
    setTimeout(resolve, 50);
  });
};

const ids = async (instance: TestEditor): Promise<string[]> =>
  (savedAsHtml(await instance.save())).blocks.map(block => block.id ?? '');

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

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

describe('tabs block: Backspace and Delete next to it', () => {
  it('Backspace after a tabs block whose last tab is empty never deletes that tab', async () => {
    const instance = await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'A' }, parent: 'tabs', content: ['p1'] },
      P('p1', 'one', 't1'),
      { id: 't2', type: 'tab', data: { title: 'B' }, parent: 'tabs' },
      P('after', 'after'),
    ]);

    await press('after', 'Backspace', 'start');

    expect(await ids(instance)).toEqual(['tabs', 't1', 'p1', 't2', 'after']);
  });

  it('Backspace after a tabs block never merges into content of a hidden tab', async () => {
    const instance = await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'A' }, parent: 'tabs', content: ['p1'] },
      P('p1', 'one', 't1'),
      { id: 't2', type: 'tab', data: { title: 'B' }, parent: 'tabs', content: ['p2'] },
      P('p2', 'hidden', 't2'),
      P('after', 'after'),
    ]);

    await press('after', 'Backspace', 'start');

    const saved = savedAsHtml(await instance.save());

    expect(saved.blocks.map(block => block.id)).toEqual(['tabs', 't1', 'p1', 't2', 'p2', 'after']);
    expect(saved.blocks.find(block => block.id === 'p2')?.data.text).toBe('hidden');
  });

  it('Delete before a tabs block never deletes the tabs block', async () => {
    const instance = await boot([
      P('before', 'before'),
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'A' }, parent: 'tabs' },
    ]);

    await press('before', 'Delete', 'end');

    expect(await ids(instance)).toEqual(['before', 'tabs', 't1']);
  });
});
