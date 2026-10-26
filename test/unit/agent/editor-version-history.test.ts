import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Page, Paragraph } from '../../../src/tools';
import type { Agent, AgentVersion, AgentVersionHistory, OutputData } from '../../../types';
import type { AgentModel, AgentModelResponse } from '../../../types/api';
import type { CommandEntry } from '../../../types/tool-manifest';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
  readOnly: { toggle(state?: boolean): Promise<boolean> };
}

const editors: TestEditor[] = [];
const VERSIONS: AgentVersion[] = [
  { version: 'L:2', savedAt: 2000, actors: ['alice'] },
  { version: 'L:1', savedAt: 1000, actors: ['bob'] },
];
const OLD: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Old <i>text</i>' } }] };

const fakeHistory = (): AgentVersionHistory => ({
  list: vi.fn(async () => VERSIONS),
  read: vi.fn(async (version: string) => version === 'L:1' ? structuredClone(OLD) : null),
});

const restoringHistory = (): AgentVersionHistory & { restore: ReturnType<typeof vi.fn> } => ({
  ...fakeHistory(),
  restore: vi.fn(async (version: string) => version === 'L:1'),
});

const boot = async (versionHistory?: AgentVersionHistory, model?: AgentModel): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'New text' } }] },
    tools: { paragraph: { class: Paragraph } },
    user: { id: 'human-1' },
    agent: {
      ...(versionHistory === undefined ? {} : { versionHistory }),
      ...(model === undefined ? {} : { assistant: { model } }),
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const isCommandEntry = (value: unknown): value is CommandEntry =>
  typeof value === 'object' && value !== null && 'name' in value && 'available' in value;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('editor agent version history', () => {
  it('lists, reads and compares versions through agent.versionHistory', async () => {
    const history = fakeHistory();
    const editor = await boot(history);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const listed = await turn.execute({ commands: [{ name: 'history.versions', args: { group: 60 } }] });
    const read = await turn.execute({ commands: [{ name: 'history.read', args: { version: 'L:1' } }] });
    const changed = await turn.execute({ commands: [{ name: 'history.changes', args: { from: 'L:1' } }] });

    turn.end();
    expect(listed.ok && listed.results).toEqual([{ versions: VERSIONS }]);
    expect(history.list).toHaveBeenCalledWith({ group: 60 });
    expect(read.ok && read.results).toEqual([{
      version: 'L:1', rootId: null, blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: 'Old text' }],
    }]);
    expect(changed.ok && changed.results[0]).toMatchObject({
      from: 'L:1', to: 'current', added: [], removed: [], moved: [],
      changed: [{ id: 'p', fields: ['data'], before: { text: 'Old text' }, after: { text: 'New text' } }],
    });
  });

  it('says the commands are unavailable when the host gives no version history', async () => {
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const described = turn.describe({ command: 'history.versions' });
    const result = await turn.execute({ commands: [{ name: 'history.versions', args: {} }] });

    turn.end();
    const command = 'command' in described ? described.command : undefined;

    expect(isCommandEntry(command) && [command.available, command.unavailableReason]).toEqual([false, 'service']);
    expect(!result.ok && [result.error.code, result.error.details?.reason]).toEqual(['COMMAND_UNAVAILABLE', 'service']);
  });

  it('does not read the main document history from a sub-page', async () => {
    const history = fakeHistory();
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = new Blok({
      holder,
      data: { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
      tools: {
        paragraph: { class: Paragraph },
        page: { class: Page, config: { loadDocument: (pageId: string) => structuredClone(pages.get(pageId) ?? null), saveDocument: () => undefined } },
      },
      agent: { versionHistory: history },
    }) as unknown as TestEditor;

    editors.push(editor);
    await editor.isReady;
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'history.versions', args: {} }] });

    turn.end();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({ error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service' } } });
    expect(history.list).not.toHaveBeenCalled();
  });

  it('never writes: reads still work while the editor is read-only', async () => {
    const editor = await boot(fakeHistory());

    await editor.readOnly.toggle(true);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'history.versions', args: {} }] });

    turn.end();
    expect(result.ok).toBe(true);
  });
});

const call = (commands: unknown[]): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: `use-${JSON.stringify(commands).length}-${Math.random()}`, name: 'blok_execute', input: { commands } }],
});

const scripted = (...responses: AgentModelResponse[]): AgentModel => async () => {
  const next = responses.shift();

  if (next === undefined) {
    throw new Error('unscripted model call');
  }

  return next;
};

const restoreCall = call([{ name: 'history.restore', args: { version: 'L:1' } }]);
const insertCall = (text: string): AgentModelResponse =>
  call([{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }]);

describe('editor agent version restore', () => {
  it('restores through agent.versionHistory.restore and lists the command as available', async () => {
    const history = restoringHistory();
    const editor = await boot(history);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const described = turn.describe({ command: 'history.restore' });
    const result = await turn.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    turn.end();
    const command = 'command' in described ? described.command : undefined;

    expect(isCommandEntry(command) && command.available).toBe(true);
    expect(history.restore).toHaveBeenCalledWith('L:1', { expectRevision: 'L:2' });
    expect(result.ok && result.results).toEqual([{ version: 'L:1', previous: 'L:2' }]);
    expect(result.ok && result.changed.updated).toEqual(['p']);
  });

  it('says COMMAND_UNAVAILABLE with reason host when the version history has no restore', async () => {
    const history = fakeHistory();
    const editor = await boot(history);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const described = turn.describe({ command: 'history.restore' });
    const result = await turn.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    turn.end();
    const command = 'command' in described ? described.command : undefined;

    expect(isCommandEntry(command) && [command.available, command.unavailableReason]).toEqual([false, 'host']);
    expect(!result.ok && [result.error.code, result.error.details?.reason]).toEqual(['COMMAND_UNAVAILABLE', 'host']);
  });

  it('says VERSION_NOT_FOUND for a version the history does not have', async () => {
    const history = restoringHistory();
    const editor = await boot(history);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'history.restore', args: { version: 'L:9' } }] });

    turn.end();
    expect(!result.ok && result.error.code).toBe('VERSION_NOT_FOUND');
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('is refused as READ_ONLY while the editor is read-only', async () => {
    const history = restoringHistory();
    const editor = await boot(history);

    await editor.readOnly.toggle(true);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    turn.end();
    expect(!result.ok && result.error.code).toBe('READ_ONLY');
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('history.undo after a restore says how to go back instead of undoing an older step', async () => {
    const editor = await boot(restoringHistory());
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Mine' } } }] });
    await turn.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });
    const undo = await turn.execute({ commands: [{ name: 'history.undo', args: {} }] });

    turn.end();
    expect(!undo.ok && undo.error.code).toBe('UNDO_RESTORED');
    expect(!undo.ok && undo.error.message).toContain('"L:2"');
  });

  it('does not restore the main document from a sub-page', async () => {
    const history = restoringHistory();
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const pages = new Map<string, OutputData>([['sub', { blocks: [] }]]);
    const editor = new Blok({
      holder,
      data: { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'sub' } }] },
      tools: {
        paragraph: { class: Paragraph },
        page: { class: Page, config: { loadDocument: (pageId: string) => structuredClone(pages.get(pageId) ?? null), saveDocument: () => undefined } },
      },
      agent: { versionHistory: history },
    }) as unknown as TestEditor;

    editors.push(editor);
    await editor.isReady;
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', { page: 'pg', commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    turn.end();
    expect(JSON.parse(result.content)).toMatchObject({ error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'service' } } });
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('Discard after Ask AI restored a version does not claim it took the whole run back', async () => {
    const history = restoringHistory();
    const editor = await boot(history, scripted(restoreCall, insertCall('After'), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] }));
    const run = editor.agent.ask('Restore the old version and add a line');

    await run.result;

    await expect(run.discard()).resolves.toBe(false);
    expect(history.restore).toHaveBeenCalledTimes(1);
  });

  it('a host that says the document moved on answers STALE, and Discard still takes the run back', async () => {
    const history = restoringHistory();

    history.restore.mockResolvedValueOnce('stale');
    const editor = await boot(history, scripted(restoreCall, insertCall('After'), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] }));
    const run = editor.agent.ask('Restore the old version and add a line');

    await run.result;

    expect(history.restore).toHaveBeenCalledWith('L:1', { expectRevision: 'L:2' });
    await expect(run.discard()).resolves.toBe(true);
  });
});
