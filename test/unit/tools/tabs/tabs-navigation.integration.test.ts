import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { ToggleItem } from '../../../../src/tools/toggle';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { Block } from '../../../../src/components/block';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  viewState: API['viewState'];
  module: {
    blockManager: { getBlockById: (id: string) => Block | undefined };
    blockSelection: { selectBlock: (block: Block) => void };
    blockEvents: { keydown: (event: KeyboardEvent) => void };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const wait = async (ms: number): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      list: ListItem,
      toggle: ToggleItem,
      column_list: ColumnList,
      column: Column,
      tabs: TabsTool,
      tab: TabTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  // Open state is personal, not saved data: the fixtures' toggles start open here.
  blocks.filter(block => block.type === 'toggle').forEach(block => {
    if (block.id !== undefined) {
      instance.viewState.set(block.id, 'open', true);
    }
  });
  await wait(0);
  await wait(0);
  // jsdom does not reflect contentEditable to the attribute Blok's input lookup reads.
  holder?.querySelectorAll<HTMLElement>('*').forEach(element => {
    if (element.contentEditable === 'true') {
      element.setAttribute('contenteditable', 'true');
    }
  });

  return instance;
};

const editableOf = (id: string): HTMLElement => {
  const blockHolder = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = Array.from(blockHolder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find(element => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable in ${id}`);
  }

  return editable;
};

const press = async (
  id: string,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowRight' | 'ArrowLeft' | 'Tab',
  at: 'start' | 'end',
  shiftKey = false
): Promise<void> => {
  const editable = editableOf(id);
  const range = document.createRange();

  editable.focus();
  range.selectNodeContents(editable);
  range.collapse(at === 'start');
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  // The selectionchange handler that sets the current block is debounced (180ms).
  await wait(200);
  editable.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  await wait(50);
};

/** Id of the block whose editable holds the caret. */
const caretBlockId = (): string | null => {
  const node = window.getSelection()?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;

  return element?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null;
};

const openTab = async (tabId: string): Promise<void> => {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = ['t1', 't2', 't3'].indexOf(tabId);

  tabs[index].click();
  await wait(50);
};

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const doc = (): OutputBlockData[] => [
  P('before', 'before'),
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2', 't3'] },
  { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['h1', 'l1', 'l2'] },
  { id: 'h1', type: 'header', data: { text: 'Alpha heading', level: 2 }, parent: 't1' },
  { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' }, parent: 't1' },
  { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered' }, parent: 't1' },
  { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs', content: ['tg', 'bp'] },
  { id: 'tg', type: 'toggle', data: { text: 'Toggle' }, parent: 't2', content: ['in'] },
  P('in', 'Inside toggle', 'tg'),
  P('bp', 'Beta paragraph', 't2'),
  { id: 't3', type: 'tab', data: { title: 'Gamma' }, parent: 'tabs', content: ['gp'] },
  P('gp', 'Gamma paragraph', 't3'),
  P('after', 'after'),
];

const columnsInTab = (): OutputBlockData[] => [
  P('before', 'before'),
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
  { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['x'] },
  P('x', 'x', 't1'),
  { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs', content: ['top', 'cl', 'p'] },
  P('top', 'top', 't2'),
  { id: 'cl', type: 'column_list', data: {}, parent: 't2', content: ['cA', 'cB'] },
  { id: 'cA', type: 'column', data: {}, parent: 'cl', content: ['a'] },
  P('a', 'a', 'cA'),
  { id: 'cB', type: 'column', data: {}, parent: 'cl', content: ['b'] },
  P('b', 'b', 'cB'),
  P('p', 'p', 't2'),
  P('after', 'after'),
];

const parentOf = async (instance: TestEditor, id: string): Promise<string | undefined> =>
  (await instance.save()).blocks.find(block => block.id === id)?.parent;

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

describe('tabs block: Shift+Tab and Tab inside a tab', () => {
  it('Shift+Tab on a direct child of a tab keeps it in the tab', async () => {
    const instance = await boot(doc());

    await openTab('t2');
    await press('bp', 'Tab', 'start', true);

    expect(await parentOf(instance, 'bp')).toBe('t2');
    expect((await instance.save()).blocks.find(block => block.id === 't2')?.content).toEqual(['tg', 'bp']);
  });

  it('Shift+Tab on the first child of a tab keeps it and its siblings in the tab', async () => {
    const instance = await boot(doc());

    await press('h1', 'Tab', 'start', true);

    const saved = await instance.save();

    expect(saved.blocks.find(block => block.id === 't1')?.content).toEqual(['h1', 'l1', 'l2']);
    expect(saved.blocks.find(block => block.id === 'tabs')?.content).toEqual(['t1', 't2', 't3']);
  });

  it('Shift+Tab on a block nested in a tab child outdents it to the tab', async () => {
    const instance = await boot(doc());

    await openTab('t2');
    await press('in', 'Tab', 'start', true);

    expect(await parentOf(instance, 'in')).toBe('t2');
  });

  it('Shift+Tab on a direct child of a column keeps it in the column', async () => {
    const instance = await boot([
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['a', 'b'] },
      P('a', 'a', 'c1'),
      P('b', 'b', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['c'] },
      P('c', 'c', 'c2'),
    ]);

    await press('b', 'Tab', 'start', true);

    expect(await parentOf(instance, 'b')).toBe('c1');
  });
});

describe('tabs block: Tab next to and inside a tab', () => {
  it('Tab on the block after the tabs block keeps it at the root', async () => {
    const instance = await boot(doc());

    await openTab('t2');
    await press('after', 'Tab', 'start');

    expect(await parentOf(instance, 'after')).toBeUndefined();
  });

  it('Tab on the first child of the open tab keeps it in the tab', async () => {
    const instance = await boot(doc());

    await openTab('t2');
    await press('tg', 'Tab', 'start');

    expect(await parentOf(instance, 'tg')).toBe('t2');
  });
});

describe('tabs block: Shift+Tab on selected blocks inside a tab', () => {
  const shiftTabOnSelection = async (instance: TestEditor, selected: string[]): Promise<void> => {
    for (const id of selected) {
      const block = instance.module.blockManager.getBlockById(id);

      if (block === undefined) {
        throw new Error(`no block ${id}`);
      }
      instance.module.blockSelection.selectBlock(block);
    }
    instance.module.blockEvents.keydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    await wait(50);
  };

  it('keeps selected list items in the tab', async () => {
    const instance = await boot(doc());

    await shiftTabOnSelection(instance, ['l1', 'l2']);

    const saved = await instance.save();

    expect(saved.blocks.find(block => block.id === 't1')?.content).toEqual(['h1', 'l1', 'l2']);
    expect(saved.blocks.find(block => block.id === 'l2')?.data.depth ?? 0).toBe(0);
  });

  it('keeps a selected heading and list item in the tab', async () => {
    const instance = await boot(doc());

    await shiftTabOnSelection(instance, ['h1', 'l1']);

    expect((await instance.save()).blocks.find(block => block.id === 't1')?.content).toEqual(['h1', 'l1', 'l2']);
  });

  it('keeps selected paragraphs in the tab', async () => {
    const instance = await boot(doc());

    await openTab('t2');
    await shiftTabOnSelection(instance, ['tg', 'bp']);

    expect((await instance.save()).blocks.find(block => block.id === 't2')?.content).toEqual(['tg', 'bp']);
  });
});

describe('tabs block: ArrowUp / ArrowDown with a later tab open', () => {
  it('ArrowDown from the block above the tabs lands in the open tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('before', 'ArrowDown', 'end');

    expect(caretBlockId()).toBe('tg');
  });

  it('ArrowRight at the end of the block above the tabs lands in the open tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('before', 'ArrowRight', 'end');

    expect(caretBlockId()).toBe('tg');
  });

  it('ArrowLeft at the start of the block below the tabs lands at the end of the open tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('after', 'ArrowLeft', 'start');

    expect(caretBlockId()).toBe('bp');
  });

  it('a second quick ArrowDown moves on from the first line of the open tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('before', 'ArrowDown', 'end');
    // No wait: the debounced selectionchange has not re-resolved the current block yet.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await wait(50);

    expect(caretBlockId()).toBe('in');
  });

  // Known gap: Caret.resolveContainerToExit climbs to the tabs block, not the column_list.
  it.fails('ArrowDown from a column inside the open tab reaches the next line of the tab', async () => {
    await boot(columnsInTab());

    await openTab('t2');
    await press('b', 'ArrowDown', 'end');

    expect(caretBlockId()).toBe('p');
  });

  // Known gap: Caret.resolveContainerToExit climbs to the tabs block, not the column_list.
  it.fails('ArrowUp from a column inside the open tab reaches the line above the columns', async () => {
    await boot(columnsInTab());

    await openTab('t2');
    await press('a', 'ArrowUp', 'start');

    expect(caretBlockId()).toBe('top');
  });

  it('ArrowDown inside a column moves from a toggle child to the next line of the column', async () => {
    await boot([
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['tg', 'b'] },
      { id: 'tg', type: 'toggle', data: { text: 'Toggle' }, parent: 'c1', content: ['in'] },
      P('in', 'in', 'tg'),
      P('b', 'b', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['c'] },
      P('c', 'c', 'c2'),
      P('after', 'after'),
    ]);

    await press('in', 'ArrowDown', 'end');

    expect(caretBlockId()).toBe('b');
  });

  it('ArrowUp from the second line of the open tab goes to the line above it', async () => {
    await boot(doc());

    await openTab('t2');
    await press('bp', 'ArrowUp', 'start');

    expect(caretBlockId()).toBe('in');
  });

  it('ArrowDown from inside a toggle in the open tab reaches the next line of the tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('in', 'ArrowDown', 'end');

    expect(caretBlockId()).toBe('bp');
  });

  it('ArrowDown from the last line of the open tab leaves the tabs block', async () => {
    await boot(doc());

    await openTab('t2');
    await press('bp', 'ArrowDown', 'end');

    expect(caretBlockId()).toBe('after');
  });

  it('ArrowUp from the block below the tabs lands on the last line of the open tab', async () => {
    await boot(doc());

    await openTab('t2');
    await press('after', 'ArrowUp', 'start');

    expect(caretBlockId()).toBe('bp');
  });
});
