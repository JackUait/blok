import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Page, Paragraph } from '../../../src/tools';
import type { Agent, AgentVersion, AgentVersionHistory, OutputData } from '../../../types';
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

const boot = async (versionHistory?: AgentVersionHistory): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'New text' } }] },
    tools: { paragraph: { class: Paragraph } },
    ...(versionHistory === undefined ? {} : { agent: { versionHistory } }),
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
