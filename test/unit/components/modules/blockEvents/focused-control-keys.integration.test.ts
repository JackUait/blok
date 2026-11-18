import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlockTool, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  save: () => Promise<OutputData>;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

/** A tool with a text field and every kind of focusable control a tool may render. */
class ControlsTool implements BlockTool {
  public render(): HTMLElement {
    const root = document.createElement('div');

    root.innerHTML = [
      '<div contenteditable="true" data-testid="text">Text</div>',
      '<button type="button" data-testid="button">Button</button>',
      '<a href="#x" data-testid="link">Link</a>',
      '<select data-testid="select"><option>A</option><option>B</option></select>',
      '<details><summary data-testid="summary">More</summary>Body</details>',
      '<span role="button" tabindex="0" data-testid="role-button">Role button</span>',
      '<span role="link" tabindex="0" data-testid="role-link">Role link</span>',
      '<span role="menuitem" tabindex="0" data-testid="role-menuitem">Menu item</span>',
      '<span role="checkbox" aria-checked="false" tabindex="0" data-testid="role-checkbox">Check</span>',
      '<span role="tab" tabindex="0" data-testid="role-tab">Tab</span>',
      '<span role="switch" aria-checked="false" tabindex="0" data-testid="role-switch">Switch</span>',
    ].join('');

    return root;
  }

  public save(): Record<string, never> {
    return {};
  }
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (data: OutputData): Promise<void> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, controls: ControlsTool },
    data,
  }) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const controlsDoc: OutputData = {
  blocks: [
    { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
    { id: 'c', type: 'controls', data: {} },
    { id: 'p1', type: 'paragraph', data: { text: 'After' } },
  ],
};

/** The key as the keyboard sends it to the focused element. */
const press = (control: HTMLElement, key: string): KeyboardEvent => {
  control.focus();
  const event = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true });

  control.dispatchEvent(event);

  return event;
};

const blockIds = async (): Promise<string[]> => {
  const saved = await editor?.save();

  return (saved?.blocks ?? []).map(block => block.id ?? '');
};

const control = (testId: string): HTMLElement => {
  const element = holder?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`no ${testId}`);
  }

  return element;
};

const controlIds = [
  'button', 'link', 'select', 'summary',
  'role-button', 'role-link', 'role-menuitem', 'role-checkbox', 'role-tab', 'role-switch',
];

describe('keys on a focused control inside a block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it.each(controlIds)('leaves Enter to a focused %s and adds no block', async (testId) => {
    await mount(controlsDoc);
    const event = press(control(testId), 'Enter');

    await quiet();

    expect(event.defaultPrevented).toBe(false);
    expect(await blockIds()).toEqual(['p0', 'c', 'p1']);
  });

  it.each(['Backspace', 'Delete', ' ', '/'])('leaves "%s" to a focused button and changes no block', async (key) => {
    await mount(controlsDoc);
    const event = press(control('button'), key);

    await quiet();

    expect(event.defaultPrevented).toBe(false);
    expect(await blockIds()).toEqual(['p0', 'c', 'p1']);
  });

  it.each([['Backspace', true], ['Delete', false]] as const)('leaves %s to a focused button while the caret is left at the text edge', async (key, atStart) => {
    await mount(controlsDoc);
    const range = document.createRange();

    range.selectNodeContents(control('text'));
    range.collapse(atStart);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const event = press(control('button'), key);

    await quiet();

    expect(event.defaultPrevented).toBe(false);
    expect(await blockIds()).toEqual(['p0', 'c', 'p1']);
  });

  it('still splits the block on Enter in the text field next to the controls', async () => {
    await mount(controlsDoc);
    const text = control('text');
    const range = document.createRange();

    text.focus();
    range.selectNodeContents(text);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });

    text.dispatchEvent(event);
    await quiet();

    expect(event.defaultPrevented).toBe(true);
    expect(editor?.blocks.getBlocksCount()).toBe(4);
  });
});
