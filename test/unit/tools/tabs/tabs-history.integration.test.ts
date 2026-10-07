import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ToggleItem as Toggle } from '../../../../src/tools/toggle';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import { savedAsHtml } from '../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  viewState: API['viewState'];
  module: { yjsManager: { stopCapturing: () => void } };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const sleep = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await sleep();
  }
};

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: Toggle, tabs: TabsTool, tab: TabTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const holderOf = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (element === null) {
    throw new Error(`no holder for ${id}`);
  }

  return element;
};

const pill = (title: string): HTMLElement => {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
    .find(element => (element.textContent ?? '').includes(title));

  if (found === undefined) {
    throw new Error(`no pill ${title}`);
  }

  return found;
};

/** Types into a paragraph with the caret in it, then closes the history step. */
const typeInto = async (instance: TestEditor, id: string, text: string): Promise<void> => {
  const blockHolder = holderOf(id);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = Array.from(blockHolder.querySelectorAll<HTMLElement>('*'))
    .find(element => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable for ${id}`);
  }

  editable.focus();

  const range = document.createRange();

  range.selectNodeContents(editable);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(50);
  editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  await sleep(500);
  instance.module.yjsManager.stopCapturing();
};

const textOf = async (instance: TestEditor, id: string): Promise<unknown> =>
  (savedAsHtml(await instance.save())).blocks.find(block => block.id === id)?.data.text;

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const TABS: OutputBlockData[] = [
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
  { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['p1'] },
  P('p1', 'one', 't1'),
  { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs', content: ['p2'] },
  P('p2', 'two', 't2'),
];

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(async () => {
  editor?.destroy();
  editor = undefined;
  await sleep();
  holder?.remove();
  holder = undefined;
  vi.restoreAllMocks();
});

describe('tabs block: undo and redo', () => {
  it.each([
    ['Cmd+Z', { metaKey: true }],
    ['Ctrl+Z', { ctrlKey: true }],
  ])('%s with a tab pill focused undoes the document', async (_name, modifiers) => {
    const instance = await boot(TABS);

    await typeInto(instance, 'p1', 'one more');
    pill('Alpha').focus();
    pill('Alpha').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true, ...modifiers }));
    await settle();

    expect(await textOf(instance, 'p1')).toBe('one');
  }, 30_000);

  it('a keyboard owner that handles Cmd+Z itself keeps it', async () => {
    const instance = await boot(TABS);
    const owner = document.createElement('div');
    const button = document.createElement('button');

    owner.setAttribute('data-blok-keyboard-owner', '');
    owner.appendChild(button);
    document.body.appendChild(owner);
    owner.addEventListener('keydown', event => event.preventDefault());

    await typeInto(instance, 'p1', 'one more');
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
    await settle();
    owner.remove();

    expect(await textOf(instance, 'p1')).toBe('one more');
  }, 30_000);

  it('a text field inside a keyboard owner keeps its native undo', async () => {
    const instance = await boot(TABS);
    const owner = document.createElement('div');
    const input = document.createElement('input');

    owner.setAttribute('data-blok-keyboard-owner', '');
    owner.appendChild(input);
    holderOf('p1').appendChild(owner);

    await typeInto(instance, 'p1', 'one more');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
    await settle();
    owner.remove();

    expect(await textOf(instance, 'p1')).toBe('one more');
  }, 30_000);

  it('Cmd+Shift+Z with a tab pill focused redoes the document', async () => {
    const instance = await boot(TABS);

    await typeInto(instance, 'p1', 'one more');
    instance.history.undo();
    await settle();
    pill('Alpha').focus();
    pill('Alpha').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await settle();

    expect(await textOf(instance, 'p1')).toBe('one more');
  }, 30_000);

  it('undo of typing in a closed tab opens that tab', async () => {
    const instance = await boot(TABS);

    pill('Beta').click();
    await settle();
    await typeInto(instance, 'p2', 'two more');
    pill('Alpha').click();
    await settle();

    expect(pill('Beta').getAttribute('aria-selected')).toBe('false');
    expect(holderOf('t2').classList.contains('hidden')).toBe(true);

    instance.history.undo();
    await settle();

    expect(pill('Beta').getAttribute('aria-selected')).toBe('true');
    expect(holderOf('t2').classList.contains('hidden')).toBe(false);
    expect(await textOf(instance, 'p2')).toBe('two');

    instance.history.redo();
    await settle();

    expect(await textOf(instance, 'p2')).toBe('two more');
  }, 30_000);
});

describe('toggle block: undo', () => {
  // Open state is personal view state, not document data, so it stays off the undo stack.
  it('collapsing a toggle is not an undo step, while typing inside it undoes and redoes', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'head' }, content: ['c1'] },
      P('c1', 'child', 'tg'),
    ]);
    const isOpen = (): string | null | undefined =>
      holderOf('tg').querySelector('[data-blok-toggle-open]')?.getAttribute('data-blok-toggle-open');

    instance.viewState.set('tg', 'open', true);
    await settle();
    expect(isOpen()).toBe('true');

    await typeInto(instance, 'c1', 'child more');
    holderOf('tg').querySelector<HTMLElement>('[data-blok-toggle-arrow]')?.click();
    await sleep(500);
    instance.module.yjsManager.stopCapturing();

    expect(isOpen()).toBe('false');

    instance.history.undo();
    await settle();
    // One undo reverts the typing and empties the stack: the collapse was never a step.
    expect(await textOf(instance, 'c1')).toBe('child');
    expect(instance.history.canUndo()).toBe(false);
    // Undo opens the toggle to put the caret back in its child.
    expect(isOpen()).toBe('true');

    instance.history.redo();
    await settle();

    expect(await textOf(instance, 'c1')).toBe('child more');
  }, 30_000);
});
