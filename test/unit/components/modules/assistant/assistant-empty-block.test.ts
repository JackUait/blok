import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputData } from '../../../../../types';
import type { AgentModel, AgentModelResponse } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
}

const editors: TestEditor[] = [];

// Each status line holds 0.6s and the answer waits for the queue.
const asyncTimeout = getConfig().asyncUtilTimeout;

beforeAll(() => configure({ asyncUtilTimeout: 4000 }));
afterAll(() => configure({ asyncUtilTimeout: asyncTimeout }));

const answer = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

const insertAt = (position: unknown, ...lines: string[]): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: 'c1',
    name: 'blok_execute',
    input: { commands: lines.map((text) => ({ name: 'block.insert', args: { type: 'paragraph', data: { text }, position } })) },
  }],
});

const scripted = (...responses: AgentModelResponse[]): AgentModel => async () => {
  const next = responses.shift();

  if (next === undefined) {
    throw new Error('unscripted model call');
  }

  return next;
};

const plain = (value: unknown): string => (Array.isArray(value)
  ? value.map((segment: { text?: unknown }) => (typeof segment.text === 'string' ? segment.text : '')).join('')
  : String(value));

const texts = async (editor: TestEditor): Promise<string[]> =>
  (await editor.save()).blocks.map((block) => plain(block.data.text));

// Save leaves out empty paragraphs, so the page is read from its holders.
const hasEmpty = (): boolean => document.querySelector('[data-blok-id="empty"]') !== null;

const createEditor = async (model: AgentModel): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks: [
        { id: 'before', type: 'paragraph', data: { text: 'Before' } },
        { id: 'empty', type: 'paragraph', data: { text: '' } },
        { id: 'after', type: 'paragraph', data: { text: 'After' } },
      ],
    },
    agent: { assistant: { model } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

// The bar opens its gap under the block it sits under.
const gapHolderText = (): string | null =>
  document.querySelector('[data-blok-ai-gap]')?.textContent ?? null;

const input = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-tool="paragraph"]`);

  if (element === null) {
    throw new Error(`no paragraph ${id}`);
  }

  return element;
};

const putCaret = (target: HTMLElement): void => {
  const range = document.createRange();

  target.focus();
  range.selectNodeContents(target);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const openAt = (id: string): void => {
  const mac = getUserOS().mac;

  putCaret(input(id));
  input(id).dispatchEvent(new KeyboardEvent('keydown', {
    key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  }));
};

const bar = (): HTMLElement => screen.getByRole('dialog', { name: 'Ask AI' });

const submit = (prompt: string): void => {
  const field = within(bar()).getByRole('textbox');

  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('prompt field is not a textarea');
  }
  field.value = prompt;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

describe('Ask AI in an empty block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes the content in place of the empty block, and Discard brings the block back', async () => {
    const editor = await createEditor(scripted(insertAt({ after: 'empty' }, 'One'), answer('Done.')));

    openAt('empty');
    submit('Write a line');

    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(hasEmpty()).toBe(false);
    expect(await texts(editor)).toEqual(['Before', 'One', 'After']);

    fireEvent.click(within(bar()).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(hasEmpty()).toBe(true));
    expect(await texts(editor)).toEqual(['Before', 'After']);
  });

  it('keeps the empty block when the content goes elsewhere', async () => {
    const editor = await createEditor(scripted(insertAt('start', 'Title'), answer('Done.')));

    openAt('empty');
    submit('Add a title at the top');

    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(hasEmpty()).toBe(true);
    expect(await texts(editor)).toEqual(['Title', 'Before', 'After']);
  });

  it('keeps a block that has text', async () => {
    const editor = await createEditor(scripted(insertAt({ after: 'before' }, 'Next'), answer('Done.')));

    openAt('before');
    submit('Write a line');

    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(hasEmpty()).toBe(true);
    expect(await texts(editor)).toEqual(['Before', 'Next', 'After']);
  });

  it('sits under the last line written in place of the empty block', async () => {
    const editor = await createEditor(scripted(insertAt({ after: 'empty' }, 'One', 'Two', 'Three'), answer('Done.')));

    openAt('empty');
    submit('Write three lines');

    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    const written = (await texts(editor)).slice(1, -1);

    expect(written).toHaveLength(3);
    await waitFor(() => expect(gapHolderText()).toBe(written.at(-1)));
  }, 20_000);

  it('sits under the content written just above the empty block', async () => {
    await createEditor(scripted(insertAt({ before: 'empty' }, 'One', 'Two'), answer('Done.')));

    openAt('empty');
    submit('Write two lines');

    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    await waitFor(() => expect(gapHolderText()).toBe('Two'));
  }, 20_000);

  it('puts an inserted answer in place of the empty block', async () => {
    const editor = await createEditor(scripted(answer('A short reply.')));

    openAt('empty');
    submit('Say something');

    fireEvent.click(await waitFor(() => within(bar()).getByRole('button', { name: 'Insert' })));

    await waitFor(() => expect(within(bar()).getByText('Added to the page.')).toBeTruthy());
    expect(hasEmpty()).toBe(false);
    expect(await texts(editor)).toEqual(['Before', 'A short reply.', 'After']);
  });
});
