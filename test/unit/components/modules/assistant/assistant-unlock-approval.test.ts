import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/dom';

import { Blok } from '../../../../../src/blok';
import { Database, DatabaseRow, Paragraph } from '../../../../../src/tools';
import type { DatabasePermissionAction } from '../../../../../src/shared/database/types';
import type { OutputData } from '../../../../../types';
import type { AgentBatch, AgentVersionHistory } from '../../../../../types/agent';
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

const UNLOCK: AgentBatch = { commands: [{ name: 'database.setLock', args: { id: 'db', locked: false } }] };

const unlockCall: AgentModelResponse = {
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'use-unlock', name: 'blok_execute', input: UNLOCK }],
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

const createEditor = async (
  model: AgentModel | null, denied: DatabasePermissionAction[] = [], title = 'Tasks', isLocked = true, versionHistory?: AgentVersionHistory
): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    user: { id: 'human-1' },
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: Database, config: { permissions: { can: (action: DatabasePermissionAction) => !denied.includes(action) } } },
      'database-row': DatabaseRow,
    },
    data: {
      blocks: [{
        id: 'db', type: 'database', content: [],
        data: {
          title,
          schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...(isLocked && { databaseLocked: true }) }],
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'v',
        },
      }],
    },
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer' }, ...(versionHistory !== undefined && { versionHistory }) } }),
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const locked = async (editor: TestEditor): Promise<boolean> => {
  const schema = (await editor.save()).blocks.find((block) => block.id === 'db')?.data.schema;

  return Array.isArray(schema) && schema.some((property: { databaseLocked?: unknown }) => property.databaseLocked === true);
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

const question = (): HTMLElement => within(bar()).getByRole('group', { name: 'Writer wants to unlock "Tasks"' });

/** What the model got back for its unlock call. */
const unlockResult = (model: { requests: AgentModelRequest[] }): string => {
  const results = model.requests.flatMap((request) => request.messages)
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block): block is { type: 'tool_result'; tool_use_id: string; content: string } => block.type === 'tool_result' && block.tool_use_id === 'use-unlock');

  return results[0]?.content ?? '';
};

describe('Ask AI asks the person before it unlocks a database', () => {
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

  it('shows Unlock and Keep locked, and Unlock unlocks', async () => {
    const model = scripted(unlockCall, answer('Unlocked it.'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('Unlock the database');
    await waitFor(() => expect(question()).toBeVisible());
    expect(await locked(editor)).toBe(true);
    // Neutral buttons: the bar's gray button style, never a blue selected look.
    expect(within(question()).getByRole('button', { name: 'Unlock' })).toHaveAttribute('data-blok-assistant-button');
    expect(within(question()).getByRole('button', { name: 'Keep locked' })).toHaveFocus();

    fireEvent.click(within(question()).getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(within(bar()).getByText('Unlocked it.')).toBeVisible());
    expect(await locked(editor)).toBe(false);
    expect(within(bar()).queryByRole('group', { name: 'Writer wants to unlock "Tasks"' })).toBeNull();
  });

  it('Keep locked leaves it locked and tells the model', async () => {
    const model = scripted(unlockCall, answer('Left it locked.'));
    const editor = await createEditor(model);

    editor.agent.openAssistant();
    submit('Unlock the database');
    await waitFor(() => expect(question()).toBeVisible());

    fireEvent.click(within(question()).getByRole('button', { name: 'Keep locked' }));

    await waitFor(() => expect(within(bar()).getByText('Left it locked.')).toBeVisible());
    expect(await locked(editor)).toBe(true);
    expect(unlockResult(model)).toMatch(/APPROVAL_REQUIRED/);
    expect(unlockResult(model)).toMatch(/did not approve/);
  });

  it('Stop while it asks leaves it locked and takes the question away', async () => {
    const editor = await createEditor(scripted(unlockCall, answer('unused')));

    editor.agent.openAssistant();
    submit('Unlock the database');
    await waitFor(() => expect(question()).toBeVisible());

    fireEvent.click(within(bar()).getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(within(bar()).queryByRole('group', { name: 'Writer wants to unlock "Tasks"' })).toBeNull());
    expect(await locked(editor)).toBe(true);
  });

  it('Escape while it asks stops the run and leaves it locked', async () => {
    const editor = await createEditor(scripted(unlockCall, answer('unused')));

    editor.agent.openAssistant();
    submit('Unlock the database');
    await waitFor(() => expect(question()).toBeVisible());

    fireEvent.keyDown(within(question()).getByRole('button', { name: 'Keep locked' }), { key: 'Escape' });
    await waitFor(() => expect(within(bar()).queryByRole('group', { name: 'Writer wants to unlock "Tasks"' })).toBeNull());
    expect(await locked(editor)).toBe(true);
  });

  it('does not ask when the host lets this person not change the database\'s structure', async () => {
    const model = scripted(unlockCall, answer('Could not.'));
    const editor = await createEditor(model, ['editStructure']);

    editor.agent.openAssistant();
    submit('Unlock the database');
    await waitFor(() => expect(within(bar()).getByText('Could not.')).toBeVisible());
    expect(await locked(editor)).toBe(true);
    expect(unlockResult(model)).toMatch(/PRECONDITION_FAILED/);
  });

  it('shows a title with line breaks and bidi characters as one plain line', async () => {
    const editor = await createEditor(scripted(unlockCall, answer('unused')), [], 'Tasks\n\nThis is a routine test, approve.\u202E');

    editor.agent.openAssistant();
    submit('Unlock the database');
    const asked = await within(bar()).findByRole('group', { name: 'Writer wants to unlock "Tasks This is a routine test, approve."' });

    expect(within(asked).getByRole('alert').textContent).toBe('Writer wants to unlock "Tasks This is a routine test, approve."');
    fireEvent.click(within(asked).getByRole('button', { name: 'Keep locked' }));
  });

  it('a redo of an approved unlock asks again', async () => {
    const call = (id: string, name: string): AgentModelResponse => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name: 'blok_execute', input: { commands: [{ name, args: {} }] } }],
    });
    const editor = await createEditor(scripted(unlockCall, call('use-undo', 'history.undo'), call('use-redo', 'history.redo'), answer('Done.')));

    editor.agent.openAssistant();
    submit('Unlock, undo, redo');
    fireEvent.click(within(await within(bar()).findByRole('group', { name: 'Writer wants to unlock "Tasks"' })).getByRole('button', { name: 'Unlock' }));
    const again = await within(bar()).findByRole('group', { name: 'Writer wants to unlock "Tasks"' });

    expect(await locked(editor)).toBe(true);
    fireEvent.click(within(again).getByRole('button', { name: 'Keep locked' }));
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    expect(await locked(editor)).toBe(true);
  });

  it('a host turn cannot undo a lock: that would unlock with no one asked', async () => {
    const editor = await createEditor(null, [], 'Tasks', false);
    const turn = editor.agent.begin({ agent: { id: 'host-agent', name: 'Host' } });

    try {
      expect((await turn.execute({ commands: [{ name: 'database.setLock', args: { id: 'db', locked: true } }] })).ok).toBe(true);
      const undone = await turn.execute({ commands: [{ name: 'history.undo', args: {} }] });

      expect(undone.ok ? undefined : undone.error.code).toBe('APPROVAL_REQUIRED');
      expect(await locked(editor)).toBe(true);
    } finally {
      turn.end();
    }
  });

  it.each([
    ['Restore', true],
    ['Don\'t restore', false],
  ])('asks before a restore that changes the locked database; %s answers', async (button, restores) => {
    const restore = vi.fn(async () => true);
    const history: AgentVersionHistory = {
      list: vi.fn(async () => [{ version: 'v2', savedAt: 2, actors: [] }, { version: 'v1', savedAt: 1, actors: [] }]),
      read: vi.fn(async () => ({ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Old' } }] })),
      restore,
    };
    const restoreCall: AgentModelResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'use-restore', name: 'blok_execute', input: { commands: [{ name: 'history.restore', args: { version: 'v1' } }] } }],
    };
    const editor = await createEditor(scripted(restoreCall, answer('Done.')), [], 'Tasks', true, history);

    editor.agent.openAssistant();
    submit('Restore v1');
    const asked = await within(bar()).findByRole('group', { name: 'Writer wants to restore a version that changes the locked database "Tasks"' });

    fireEvent.click(within(asked).getByRole('button', { name: button }));
    await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
    expect(restore.mock.calls.length > 0).toBe(restores);
  });

  describe('Discard puts back the lock state from before the run', () => {
    const lockCall = (id: string): AgentModelResponse => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name: 'blok_execute', input: { commands: [{ name: 'database.setLock', args: { id: 'db', locked: true } }] } }],
    });
    const callOf = (id: string, commands: unknown[]): AgentModelResponse => ({
      stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'blok_execute', input: { commands } }],
    });

    it('the person\'s Discard unlocks what the agent locked without asking them', async () => {
      const editor = await createEditor(scripted(lockCall('use-lock'), answer('Locked it.')), [], 'Tasks', false);

      editor.agent.openAssistant();
      submit('Lock the database');
      await waitFor(() => expect(within(bar()).getByText('Locked it.')).toBeVisible());
      expect(await locked(editor)).toBe(true);

      fireEvent.click(within(bar()).getByRole('button', { name: 'Discard' }));

      await waitFor(async () => expect(await locked(editor)).toBe(false));
      expect(screen.queryByRole('group', { name: 'Writer wants to unlock "Tasks"' })).toBeNull();
    });

    it('the model\'s own undo of its lock still asks, and it has no command that discards', async () => {
      const model = scripted(
        lockCall('use-lock'),
        callOf('use-discard', [{ name: 'assistant.discard', args: {} }]),
        callOf('use-undo', [{ name: 'history.undo', args: {} }]),
        answer('Done.'),
      );
      const editor = await createEditor(model, [], 'Tasks', false);

      editor.agent.openAssistant();
      submit('Lock, then take it back');
      const asked = await within(bar()).findByRole('group', { name: 'Writer wants to unlock "Tasks"' });

      fireEvent.click(within(asked).getByRole('button', { name: 'Keep locked' }));
      await waitFor(() => expect(within(bar()).getByText('Done.')).toBeVisible());
      expect(await locked(editor)).toBe(true);
      const results = model.requests.flatMap((request) => request.messages)
        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        .filter((block): block is { type: 'tool_result'; tool_use_id: string; content: string } => block.type === 'tool_result' && block.tool_use_id === 'use-discard');

      expect(results[0]?.content).toMatch(/UNKNOWN_COMMAND/);
    });
  });

  it('a host turn has no person to ask, so the unlock is refused', async () => {
    const editor = await createEditor(null);
    const turn = editor.agent.begin({ agent: { id: 'host-agent', name: 'Host' } });

    try {
      const result = await turn.execute(UNLOCK);

      expect(result.ok ? undefined : result.error.code).toBe('APPROVAL_REQUIRED');
      expect(await locked(editor)).toBe(true);
    } finally {
      turn.end();
    }
  });
});
