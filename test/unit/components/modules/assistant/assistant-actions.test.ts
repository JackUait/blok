import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig, OutputData } from '../../../../../types';
import type { AgentAssistantAction, AgentModel, AgentModelRequest, AgentModelResponse } from '../../../../../types/api';

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

const scripted = (...responses: AgentModelResponse[]): AgentModel & { requests: AgentModelRequest[] } => {
  const requests: AgentModelRequest[] = [];

  return Object.assign(async (request: AgentModelRequest) => {
    requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = responses.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }

    return next;
  }, { requests });
};

const firstMessage = (request: AgentModelRequest | undefined): string => {
  const content = request?.messages[0]?.content;

  return typeof content === 'string' ? content : JSON.stringify(content);
};

const plain = (value: unknown): string => (Array.isArray(value)
  ? value.map((segment: { text?: unknown }) => (typeof segment.text === 'string' ? segment.text : '')).join('')
  : String(value));

const texts = async (editor: TestEditor): Promise<string[]> =>
  (await editor.save()).blocks.map((block) => plain(block.data.text));

const createEditor = async (
  model: AgentModel,
  options: { text?: string; actions?: AgentAssistantAction[] } = {}
): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const config: BlokConfig = {
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: options.text ?? 'Hello world' } }] },
    agent: { assistant: { model, ...(options.actions === undefined ? {} : { actions: options.actions }) } },
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const paragraphInput = (): HTMLElement => {
  const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');

  if (input === null) {
    throw new Error('no paragraph input');
  }

  return input;
};

const pressModJ = (target: HTMLElement): void => {
  const mac = getUserOS().mac;

  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  }));
};

const putCaret = (input: HTMLElement): void => {
  const range = document.createRange();

  input.focus();
  range.selectNodeContents(input);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const selectWord = (input: HTMLElement): void => {
  const text = input.firstChild;

  if (text === null) {
    throw new Error('no text');
  }

  const range = document.createRange();

  input.focus();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const bar = (): HTMLElement => screen.getByRole('dialog', { name: 'Ask AI' });
// By attribute: testing-library names no hidden element.
const group = (): HTMLElement => {
  const found = bar().querySelector<HTMLElement>('[role="group"][aria-label="Suggestions"]');

  if (found === null) {
    throw new Error('no actions group');
  }

  return found;
};
const labels = (): string[] => within(group()).queryAllByRole('button').map((button) => button.textContent?.trim() ?? '');

describe('Ask AI action buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('offers page actions at a caret, and sends the one pressed', async () => {
    const model = scripted(answer('A short page about the world.'));

    await createEditor(model);
    putCaret(paragraphInput());
    pressModJ(paragraphInput());

    expect(labels()).toEqual(['Summarize', 'Find action items', 'Fix spelling and grammar', 'Continue writing']);

    fireEvent.click(within(group()).getByRole('button', { name: 'Summarize' }));

    await waitFor(() => expect(model.requests).toHaveLength(1));
    expect(firstMessage(model.requests[0])).toMatch(/^Summarize the whole document/);
  });

  it('dresses each built-in chip icon so it acts out its skill on hover', async () => {
    await createEditor(scripted());
    putCaret(paragraphInput());
    pressModJ(paragraphInput());

    expect([...group().querySelectorAll('[data-blok-assistant-action-icon] > svg[data-blok-ask-ai-hue]')].map((hue) => hue.getAttribute('data-blok-ask-ai-act')))
      .toEqual(['summarize', 'actionItems', 'proofread', 'continue']);
  });

  it('offers edits of the selection when text is selected', async () => {
    await createEditor(scripted());
    selectWord(paragraphInput());
    pressModJ(paragraphInput());

    expect(labels()).toEqual(['Improve writing', 'Fix spelling and grammar', 'Make shorter', 'Make longer', 'Simplify language', 'Explain']);
  });

  it('offers no built-in actions on a page with no text', async () => {
    await createEditor(scripted(), { text: '' });
    putCaret(paragraphInput());
    pressModJ(paragraphInput());

    expect(group().hidden).toBe(true);
  });

  it('shows the host\'s actions instead of the built-in ones', async () => {
    await createEditor(scripted(), { actions: [{ label: 'Make it formal', prompt: 'Make the page formal.' }] });
    putCaret(paragraphInput());
    pressModJ(paragraphInput());

    expect(labels()).toEqual(['Make it formal']);
  });

  it('inserts an answer under the block as it reads, and Undo takes it out', async () => {
    const editor = await createEditor(scripted(answer('The page greets the world.\n\nIt is short.')));

    putCaret(paragraphInput());
    pressModJ(paragraphInput());
    fireEvent.click(within(group()).getByRole('button', { name: 'Summarize' }));

    const insert = await waitFor(() => within(bar()).getByRole('button', { name: 'Insert' }));

    fireEvent.click(insert);

    await waitFor(async () => expect(await texts(editor)).toEqual(['Hello world', 'The page greets the world.', 'It is short.']));
    // The answer is in the page now, so the bar offers Undo and Keep, not Insert again.
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Insert' })).toBeNull());

    fireEvent.click(within(bar()).getByRole('button', { name: 'Discard' }));

    await waitFor(async () => expect(await texts(editor)).toEqual(['Hello world']));
  });

  it('inserts the answer once when Insert is pressed twice in a row', async () => {
    const editor = await createEditor(scripted(answer('The page greets the world.')));

    putCaret(paragraphInput());
    pressModJ(paragraphInput());
    fireEvent.click(within(group()).getByRole('button', { name: 'Summarize' }));

    const insert = await waitFor(() => within(bar()).getByRole('button', { name: 'Insert' }));

    fireEvent.click(insert);
    fireEvent.click(insert);

    await waitFor(() => expect(within(bar()).getByText('Added to the page.')).toBeTruthy());
    expect(await texts(editor)).toEqual(['Hello world', 'The page greets the world.']);
  });
});
