import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Agent, AgentModel, AgentModelRequest, AgentModelResponse } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
}

const editors: TestEditor[] = [];

// Each status line holds 0.6s and the answer waits for the queue.
const asyncTimeout = getConfig().asyncUtilTimeout;

beforeAll(() => configure({ asyncUtilTimeout: 4000 }));
afterAll(() => configure({ asyncUtilTimeout: asyncTimeout }));

const answer = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

const createEditor = async (model: AgentModel): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Hello world' } }] },
    agent: { assistant: { model } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const bar = (): HTMLElement => screen.getByRole('dialog', { name: 'Ask AI' });

const lastUserText = (request: AgentModelRequest): string => {
  const content = request.messages.filter((message) => message.role === 'user').at(-1)?.content;

  if (typeof content === 'string') {
    return content;
  }

  return (content ?? []).map((part) => ('text' in part && typeof part.text === 'string' ? part.text : '')).join('');
};

describe('agent.openAssistant({ prompt })', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens the bar and sends the prompt at once', async () => {
    const requests: AgentModelRequest[] = [];
    const editor = await createEditor(async (request) => {
      requests.push(request);

      return answer('Done.');
    });

    editor.agent.openAssistant({ prompt: 'Fix the spelling' });

    expect(bar()).toBeVisible();
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    expect(requests).toHaveLength(1);
    expect(lastUserText(requests[0])).toContain('Fix the spelling');
  });

  it('only opens the bar without a prompt', async () => {
    const model = vi.fn(async () => answer('Done.'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();

    expect(bar()).toBeVisible();
    expect(model).not.toHaveBeenCalled();
  });
});
