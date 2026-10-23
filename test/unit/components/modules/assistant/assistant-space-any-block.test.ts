import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ListItem } from '../../../../../src/tools/list';
import { Quote } from '../../../../../src/tools/quote';
import { CodeTool } from '../../../../../src/tools/code';
import { Table } from '../../../../../src/tools/table';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { OutputBlockData } from '../../../../../types';
import type { AgentModel } from '../../../../../types/api';

const editors: Blok[] = [];

const model: AgentModel = async () => {
  throw new Error('unscripted model call');
};

const createEditor = async (blocks: OutputBlockData[]): Promise<Blok> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, list: ListItem, quote: Quote, code: CodeTool, table: Table, toggle: ToggleItem },
    data: { blocks },
    agent: { assistant: { model } },
  });

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const editable = (id: string): HTMLElement => {
  const holder = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const element = Array.from(holder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find((node) => node.contentEditable === 'true' || node.getAttribute('contenteditable') === 'plaintext-only');

  if (element === null || element === undefined) {
    throw new Error(`no editable in ${id}`);
  }

  return element;
};

/** Put the caret at `offset` in the text node, or at the start of the element. */
const caretIn = (element: HTMLElement, offset = 0): void => {
  element.focus();

  const range = document.createRange();
  const text = element.firstChild;

  if (text !== null && text.nodeType === Node.TEXT_NODE) {
    range.setStart(text, offset);
  } else {
    range.setStart(element, 0);
  }
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const pressSpace = (target: HTMLElement): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

const barOpen = (): boolean => screen.queryByRole('dialog', { name: 'Ask AI' }) !== null;

describe('assistant: space in any empty block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['an empty heading', { id: 'b', type: 'header', data: { text: '', level: 2 } }],
    ['an empty list item', { id: 'b', type: 'list', data: { text: '', style: 'unordered' } }],
    ['an empty checklist item', { id: 'b', type: 'list', data: { text: '', style: 'checklist', checked: false } }],
    ['an empty quote', { id: 'b', type: 'quote', data: { text: '' } }],
    ['an empty toggle', { id: 'b', type: 'toggle', data: { text: '' } }],
    ['an empty code block', { id: 'b', type: 'code', data: { code: '', language: 'plain text' } }],
  ])('opens Ask AI in %s and types no space', async (_name, block) => {
    await createEditor([block]);
    caretIn(editable('b'));

    const event = pressSpace(editable('b'));

    expect(barOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens Ask AI in an empty table cell', async () => {
    await createEditor([{ id: 't', type: 'table', data: { withHeadings: false, content: [['', 'full']] } }]);

    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id="t"] [data-blok-tool="paragraph"]'));
    const empty = cells.find((cell) => cell.textContent === '');

    if (empty === undefined) {
      throw new Error('no empty cell');
    }
    caretIn(empty);

    const event = pressSpace(empty);

    expect(barOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('types a space in a table cell with text', async () => {
    await createEditor([{ id: 't', type: 'table', data: { withHeadings: false, content: [['', 'full']] } }]);

    const full = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id="t"] [data-blok-tool="paragraph"]'))
      .find((cell) => cell.textContent === 'full');

    if (full === undefined) {
      throw new Error('no full cell');
    }
    caretIn(full, 4);

    const event = pressSpace(full);

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens Ask AI on an empty line of a code block with code', async () => {
    await createEditor([{ id: 'b', type: 'code', data: { code: 'a\n\nb', language: 'plain text' } }]);

    const code = editable('b');
    const text = code.firstChild;

    if (text === null || text.nodeType !== Node.TEXT_NODE) {
      throw new Error('no code text');
    }
    code.focus();

    const range = document.createRange();

    // Between the two newlines: the empty middle line.
    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const event = pressSpace(code);

    expect(barOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('types a space on a code line with text', async () => {
    await createEditor([{ id: 'b', type: 'code', data: { code: 'a\n\nb', language: 'plain text' } }]);

    const code = editable('b');

    caretIn(code, 1);

    const event = pressSpace(code);

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('types a space in the filename field of an empty code block', async () => {
    await createEditor([{ id: 'b', type: 'code', data: { code: '', language: 'plain text' } }]);
    document.querySelector<HTMLElement>('[data-blok-testid="code-filename"]')?.click();

    const field = document.querySelector<HTMLElement>('[data-blok-testid="code-filename-input"]');

    if (field === null) {
      throw new Error('no filename field');
    }
    const event = pressSpace(field);

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('types a space in a heading with text', async () => {
    await createEditor([{ id: 'b', type: 'header', data: { text: 'Title', level: 2 } }]);
    caretIn(editable('b'), 5);

    const event = pressSpace(editable('b'));

    expect(barOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
