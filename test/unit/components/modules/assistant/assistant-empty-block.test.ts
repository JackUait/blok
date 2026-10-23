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

const PAGE = [
  { id: 'before', type: 'paragraph', data: { text: 'Before' } },
  { id: 'empty', type: 'paragraph', data: { text: '' } },
  { id: 'after', type: 'paragraph', data: { text: 'After' } },
];

const createEditor = async (model: AgentModel, blocks = PAGE): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks,
    },
    agent: { assistant: { model } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

/** The text of the block the bar's gap sits over: null if none holds a gap at its start. */
const barOver = (): string | null =>
  document.querySelector('[data-blok-ai-gap~="start"]')?.textContent ?? null;

/** A model whose final answer waits until `release` is called. */
const held = (...responses: AgentModelResponse[]): { model: AgentModel; release: () => void } => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model: AgentModel = async () => {
    const next = responses.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }
    if (next.stop_reason === 'end_turn') {
      await gate;
    }

    return next;
  };

  return { model, release };
};

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

  it('heads the content it writes under the empty block, while it writes and after', async () => {
    const run = held(insertAt({ after: 'empty' }, 'One', 'Two'), answer('Done.'));
    const editor = await createEditor(run.model);

    openAt('empty');
    submit('Write two lines');

    await waitFor(() => expect(document.querySelectorAll('[data-blok-id]')).toHaveLength(5));
    const [first] = (await texts(editor)).slice(1, -1);

    await waitFor(() => expect(barOver()).toBe(first));
    // It gives up its line now, not when the run ends: the bar and the content stay put then.
    expect(document.querySelector('[data-blok-id="empty"]')?.hasAttribute('data-blok-ai-consumed')).toBe(true);

    run.release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(hasEmpty()).toBe(false);
    expect(barOver()).toBe(first);
  }, 20_000);

  it('heads the content it writes over the empty block', async () => {
    const run = held(insertAt({ before: 'empty' }, 'One', 'Two'), answer('Done.'));

    await createEditor(run.model);
    openAt('empty');
    submit('Write two lines');

    await waitFor(() => expect(barOver()).toBe('One'));

    run.release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(barOver()).toBe('One');
  }, 20_000);

  it('heads the content on a page that held only the empty block', async () => {
    const run = held(insertAt({ after: 'empty' }, 'Only'), answer('Done.'));

    await createEditor(run.model, [{ id: 'empty', type: 'paragraph', data: { text: '' } }]);
    openAt('empty');
    submit('Write a line');

    await waitFor(() => expect(barOver()).toBe('Only'));

    run.release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(hasEmpty()).toBe(false);
    expect(barOver()).toBe('Only');
  }, 20_000);

  it('heads the content when Space opened it over the empty block', async () => {
    const run = held(insertAt({ after: 'empty' }, 'One'), answer('Done.'));

    await createEditor(run.model);
    putCaret(input('empty'));
    input('empty').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    submit('Write a line');

    await waitFor(() => expect(barOver()).toBe('One'));

    run.release();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeTruthy());
    expect(barOver()).toBe('One');
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
