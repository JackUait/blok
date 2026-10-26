import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Database, DatabaseRow, Paragraph } from '../../../../../src/tools';
import type { OutputData } from '../../../../../types';
import type { AgentBatch } from '../../../../../types/agent';
import type { Agent, AgentModel, AgentModelRequest, AgentModelResponse } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
}

const editors: TestEditor[] = [];
const asyncTimeout = getConfig().asyncUtilTimeout;

beforeAll(() => configure({ asyncUtilTimeout: 4000 }));
afterAll(() => configure({ asyncUtilTimeout: asyncTimeout }));

const PUBLISH: AgentBatch = { commands: [{ name: 'database.updateView', args: { id: 'db', viewId: 'v', changes: { form: { public: true, anonymous: true } } } }] };

const publishCall: AgentModelResponse = {
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'use-share', name: 'blok_execute', input: PUBLISH }],
};

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

const createEditor = async (model: AgentModel, viewName = 'Signup'): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    user: { id: 'human-1' },
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: Database, 'database-row': DatabaseRow },
    data: {
      blocks: [{
        id: 'db', type: 'database', content: [],
        data: {
          title: 'Tasks',
          schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'v', name: viewName, type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [], form: {} }],
          activeViewId: 'v',
        },
      }],
    },
    agent: { assistant: { model, name: 'Writer' } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const formOf = async (editor: TestEditor): Promise<unknown> => {
  const views = (await editor.save()).blocks.find((block) => block.id === 'db')?.data.views as Array<{ form?: unknown }> | undefined;

  return views?.[0]?.form;
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

const QUESTION = 'Writer wants to change sharing for "Signup": Who can fill out: Anyone on the web with link; Anonymous responses: On';

describe('Ask AI asks the person before it changes who can fill out a form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('says exactly what changes, and Allow applies it', async () => {
    const editor = await createEditor(scripted(publishCall, answer('Shared it.')));

    editor.agent.openAssistant();
    submit('Make the form public');
    const asked = await within(bar()).findByRole('group', { name: QUESTION });

    expect(await formOf(editor)).toEqual({});
    expect(within(asked).getByRole('button', { name: 'Keep as is' })).toHaveFocus();
    fireEvent.click(within(asked).getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(within(bar()).getByText('Shared it.')).toBeVisible());
    expect(await formOf(editor)).toEqual({ public: true, anonymous: true });
  });

  it('Keep as is changes nothing and tells the model', async () => {
    const model = scripted(publishCall, answer('Left it.'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('Make the form public');
    fireEvent.click(within(await within(bar()).findByRole('group', { name: QUESTION })).getByRole('button', { name: 'Keep as is' }));
    await waitFor(() => expect(within(bar()).getByText('Left it.')).toBeVisible());
    expect(await formOf(editor)).toEqual({});
    expect(JSON.stringify(model.requests.at(-1)?.messages)).toMatch(/did not approve this sharing change/);
  });

  it('shows a view name with bidi and control characters as one plain line', async () => {
    const editor = await createEditor(scripted(publishCall, answer('unused')), 'Sign\u202Eup\n\u0007now');

    editor.agent.openAssistant();
    submit('Make the form public');
    const asked = await within(bar()).findByRole('group', { name: QUESTION.replace('"Signup"', '"Signup now"') });

    fireEvent.click(within(asked).getByRole('button', { name: 'Keep as is' }));
  });
});
