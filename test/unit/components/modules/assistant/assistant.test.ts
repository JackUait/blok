import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig, OutputData } from '../../../../../types';
import type { Agent, AgentModel, AgentModelRequest, AgentModelResponse } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
  readOnly: { toggle(state?: boolean): Promise<boolean> };
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const editors: TestEditor[] = [];

const insertBatch = (text: string): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: `use-${text}`,
    name: 'blok_execute',
    input: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] },
  }],
});

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

/** A model call that waits until the test lets it answer. */
const gated = (response: AgentModelResponse): { model: AgentModel; release: () => void } => {
  const gate: { open: () => void } = { open: () => undefined };
  const opened = new Promise<void>((resolve) => {
    gate.open = resolve;
  });

  return {
    model: async (request) => {
      await Promise.race([
        opened,
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      ]);

      return response;
    },
    release: () => gate.open(),
  };
};

const plain = (value: unknown): string => (Array.isArray(value)
  ? value.map((segment: { text?: unknown }) => (typeof segment.text === 'string' ? segment.text : '')).join('')
  : String(value));

const texts = async (editor: TestEditor): Promise<string[]> =>
  (await editor.save()).blocks.map((block) => plain(block.data.text));

const createEditor = async (model: AgentModel | null): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const config: BlokConfig = {
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer' } } }),
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

const paragraphInput = (): HTMLElement => {
  const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');

  if (input === null) {
    throw new Error('no paragraph input');
  }

  return input;
};

const pressModJ = (target: HTMLElement): KeyboardEvent => {
  const mac = getUserOS().mac;
  const event = new KeyboardEvent('keydown', {
    key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  });

  target.dispatchEvent(event);

  return event;
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

describe('in-editor assistant bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not open, and leaves Mod+J alone, when no assistant is configured', async () => {
    await createEditor(null);

    const event = pressModJ(paragraphInput());

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens on Mod+J with the prompt field focused and owning the keyboard', async () => {
    await createEditor(scripted());

    const event = pressModJ(paragraphInput());
    const field = within(bar()).getByRole('textbox');

    expect(event.defaultPrevented).toBe(true);
    expect(field).toHaveFocus();
    expect(bar().closest('[data-blok-keyboard-owner]')).not.toBeNull();
  });

  it('opens from editor.agent.openAssistant()', async () => {
    const editor = await createEditor(scripted());

    editor.agent.openAssistant();

    expect(bar()).toBeVisible();
  });

  it('writes from a prompt, shows the reply, and Keep closes with the edits kept', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer('Added a paragraph.')));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByText('Added a paragraph.')).toBeVisible());
    expect(await texts(editor)).toEqual(['Hello', 'From AI']);

    within(bar()).getByRole('button', { name: 'Keep' }).click();

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(editor.agent.state.status).toBe('idle');
    expect(await texts(editor)).toEqual(['Hello', 'From AI']);
  });

  it('Discard removes what the assistant wrote and closes', async () => {
    const editor = await createEditor(scripted(insertBatch('From AI'), answer('Done.')));

    editor.agent.openAssistant();
    submit('Add a line');
    await waitFor(() => expect(within(bar()).getByRole('button', { name: 'Discard' })).toBeVisible());
    within(bar()).getByRole('button', { name: 'Discard' }).click();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull());
    expect(await texts(editor)).toEqual(['Hello']);
    expect(editor.agent.state.status).toBe('idle');
  });

  it('shows Stop while working, and Stop ends the answer without closing', async () => {
    const editor = await createEditor(gated(answer('late')).model);

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    const stop = within(bar()).getByRole('button', { name: 'Stop' });

    expect(within(bar()).getByRole('status')).toHaveTextContent('Writer is writing');
    stop.click();

    await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(bar()).toBeVisible();
    expect(editor.agent.state.status).toBe('working');
  });

  it('shows the text the model streams while it works, outside the status line', async () => {
    const { model, release } = gated(answer('Added a line.'));
    const streaming: AgentModel = async (request) => {
      request.onText?.('Reading');
      request.onText?.('Reading the document first.');

      return model(request);
    };
    const editor = await createEditor(streaming);

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    expect(within(bar()).getByText('Reading the document first.')).toBeVisible();
    expect(within(bar()).getByRole('status')).toHaveTextContent('Writer is writing');
    expect(within(bar()).getByRole('status')).not.toHaveTextContent('Reading');

    release();
    await waitFor(() => expect(within(bar()).getByText('Added a line.')).toBeVisible());
    expect(within(bar()).queryByText('Reading the document first.')).toBeNull();
    expect(editor.agent.state.status).toBe('working');
  });

  it('streams a follow-up answer too', async () => {
    const replies = [answer('First answer'), answer('Second answer')];
    const shown: string[] = [];
    const streaming: AgentModel = async (request) => {
      request.onText?.(`streaming ${replies.length}`);
      shown.push(within(bar()).queryByText(`streaming ${replies.length}`)?.textContent ?? '');
      const next = replies.shift();

      if (next === undefined) {
        throw new Error('unscripted model call');
      }

      return next;
    };
    const editor = await createEditor(streaming);

    editor.agent.openAssistant();
    submit('One');
    await waitFor(() => expect(within(bar()).getByText('First answer')).toBeVisible());
    submit('Two');
    await waitFor(() => expect(within(bar()).getByText('Second answer')).toBeVisible());
    expect(shown).toEqual(['streaming 2', 'streaming 1']);
    expect(editor.agent.state.status).toBe('working');
  });

  it('sends a second prompt as a follow-up in the same conversation', async () => {
    const model = scripted(answer('First answer'), answer('Second answer'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('One');
    await waitFor(() => expect(within(bar()).getByText('First answer')).toBeVisible());
    submit('Two');
    await waitFor(() => expect(within(bar()).getByText('Second answer')).toBeVisible());
    expect(model.requests[1].messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(editor.agent.state.status).toBe('working');
  });

  it('shows a failed model call as an alert', async () => {
    const editor = await createEditor(async () => {
      throw new Error('No API key');
    });

    editor.agent.openAssistant();
    submit('Write');

    await waitFor(() => expect(within(bar()).getByRole('alert')).toHaveTextContent('No API key'));
  });

  it('Escape stops a running answer first, then closes the bar keeping the edits', async () => {
    const editor = await createEditor(gated(answer('late')).model);

    editor.agent.openAssistant();
    submit('Write');
    await settle();

    const field = within(bar()).getByRole('textbox');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(bar()).toBeVisible();

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
    expect(editor.agent.state.status).toBe('idle');
  });

  it('does not open in read-only mode', async () => {
    const editor = await createEditor(scripted());

    await editor.readOnly.toggle(true);
    editor.agent.openAssistant();

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull();
  });

  it('ignores an empty prompt', async () => {
    const model = scripted();
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('   ');
    await settle();

    expect(model.requests).toHaveLength(0);
    expect(editor.agent.state.status).toBe('idle');
  });
});
