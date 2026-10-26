// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentAgentSession } from '../../../../src/shared/agent/document-session';
import { createHeadlessAgentSetup } from '../../../../src/view/agent-runtime';

import type { AgentActor, AgentVersion, AgentVersionHistory } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { HostService } from '../../../../types/tools/tool-description';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const VERSIONS: AgentVersion[] = [
  { version: 'L:3', savedAt: 3000, startedAt: 2000, actors: ['alice'] },
  { version: 'L:1', savedAt: 1000, startedAt: 1000, actors: ['bob'] },
  { version: 'old:9', savedAt: 500, actors: [], beforeReset: true },
];
const paragraph = (id: string, text: string): OutputData['blocks'][number] =>
  ({ id, type: 'paragraph', data: { text: [{ text }] } });
const STORED: Record<string, OutputData> = {
  // A server export can carry HTML strings in rich-text fields.
  'L:1': { title: 'Plan', blocks: [{ id: 'a', type: 'paragraph', data: { text: 'First <b>draft</b>' } }, paragraph('gone', 'Removed later')] },
  'L:3': { blocks: [paragraph('a', 'First draft'), paragraph('b', 'Second')] },
};
const current = (): OutputData => ({ blocks: [paragraph('a', 'Final text'), paragraph('b', 'Second'), paragraph('c', 'New')] });

const fakeHistory = (): AgentVersionHistory & { list: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> } => ({
  list: vi.fn(async () => VERSIONS),
  read: vi.fn(async (version: string) => STORED[version] ?? null),
});

const session = (options: { services?: HostService[]; history?: AgentVersionHistory } = {}) => {
  const setup = createHeadlessAgentSetup({ services: options.services ?? ['versionHistory'], runtime: 'node' });

  return {
    setup,
    agent: createDocumentAgentSession({
      document: current(), tools: setup.tools, contract: setup.contract, actor, ports: setup.ports,
      ...(options.history !== undefined && { services: { versionHistory: options.history } }),
    }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('version history commands', () => {
  it('are unavailable for a missing service, in the contract and when run', async () => {
    const { setup, agent } = session({ services: [] });
    const entries = setup.contract.commands.filter(entry => entry.name.startsWith('history.') && !/undo|redo/.test(entry.name));

    expect(entries.map(entry => [entry.name, entry.available, entry.unavailableReason]).sort()).toEqual([
      ['history.changes', false, 'service'],
      ['history.read', false, 'service'],
      ['history.restore', false, 'service'],
      ['history.versions', false, 'service'],
    ]);
    const result = await agent.execute({ commands: [{ name: 'history.versions', args: {} }] });

    expect(result.ok).toBe(false);
    expect(!result.ok && [result.error.code, result.error.details?.reason]).toEqual(['COMMAND_UNAVAILABLE', 'service']);
  });

  it('are read-only commands that need the versionHistory service', () => {
    const { setup } = session();
    const entry = setup.contract.commands.find(command => command.name === 'history.read');

    expect(entry).toMatchObject({ available: true, readOnly: true, requires: ['versionHistory'] });
  });

  it('history.versions lists the host versions newest first and passes the grouping', async () => {
    const history = fakeHistory();
    const { agent } = session({ history });
    const result = await agent.execute({ commands: [{ name: 'history.versions', args: { group: 15 } }] });

    expect(result.ok && result.results).toEqual([{ versions: VERSIONS }]);
    expect(history.list).toHaveBeenCalledWith({ group: 15 });
  });

  it('history.read reads one version the way doc.read reads the document', async () => {
    const { agent } = session({ history: fakeHistory() });
    const result = await agent.execute({ commands: [{ name: 'history.read', args: { version: 'L:1' } }] });

    expect(result.ok && result.results).toEqual([{
      version: 'L:1',
      rootId: null,
      page: { title: 'Plan' },
      blocks: [
        { id: 'a', type: 'paragraph', depth: 0, text: 'First draft' },
        { id: 'gone', type: 'paragraph', depth: 0, text: 'Removed later' },
      ],
    }]);
  });

  it('history.read takes doc.read arguments', async () => {
    const { agent } = session({ history: fakeHistory() });
    const result = await agent.execute({ commands: [{ name: 'history.read', args: { version: 'L:3', ids: ['b'] } }] });
    const view = result.ok ? result.results[0] : undefined;

    expect(view).toMatchObject({ version: 'L:3', blocks: [{ id: 'b', text: 'Second', data: { text: [{ text: 'Second' }] } }] });
  });

  it('history.read of an unknown version says how to find one', async () => {
    const { agent } = session({ history: fakeHistory() });
    const result = await agent.execute({ commands: [{ name: 'history.read', args: { version: 'L:99' } }] });

    expect(!result.ok && [result.error.code, result.error.path]).toEqual(['INVALID_ARGS', '/commands/0/args/version']);
    expect(!result.ok && result.error.message).toContain('history.versions');
  });

  it('history.changes compares a version with the current document', async () => {
    const { agent } = session({ history: fakeHistory() });
    const result = await agent.execute({ commands: [{ name: 'history.changes', args: { from: 'L:1' } }] });

    expect(result.ok && result.results).toEqual([{
      from: 'L:1',
      to: 'current',
      added: [
        { id: 'b', type: 'paragraph', depth: 0, text: 'Second' },
        { id: 'c', type: 'paragraph', depth: 0, text: 'New' },
      ],
      removed: [{ id: 'gone', type: 'paragraph', depth: 0, text: 'Removed later' }],
      changed: [{
        id: 'a', type: 'paragraph', fields: ['data'],
        before: { id: 'a', type: 'paragraph', depth: 0, text: 'First draft', data: { text: [{ text: 'First ' }, { text: 'draft', marks: { bold: true } }] } },
        after: { id: 'a', type: 'paragraph', depth: 0, text: 'Final text', data: { text: [{ text: 'Final text' }] } },
      }],
      moved: [],
    }]);
  });

  it('history.changes compares two versions, and equal rich text is not a change', async () => {
    const history = fakeHistory();
    const { agent } = session({ history });
    const result = await agent.execute({ commands: [{ name: 'history.changes', args: { from: 'L:3', to: 'L:3' } }] });

    expect(result.ok && result.results).toEqual([{ from: 'L:3', to: 'L:3', added: [], removed: [], changed: [], moved: [] }]);
  });

  it('runs alone in its batch', async () => {
    const { agent } = session({ history: fakeHistory() });
    const result = await agent.execute({ commands: [
      { name: 'history.versions', args: {} },
      { name: 'doc.read', args: {} },
    ] });

    expect(!result.ok && result.error.code).toBe('INVALID_ARGS');
    expect(!result.ok && result.error.message).toContain('must be the only command');
  });

  it('reports a failing host as a failure, not a broken document', async () => {
    const history: AgentVersionHistory = { list: async () => Promise.reject(new Error('busy')), read: async () => null };
    const { agent } = session({ history });
    const result = await agent.execute({ commands: [{ name: 'history.versions', args: {} }] });

    expect(!result.ok && result.error).toMatchObject({ code: 'TOOL_ACTION_FAILED', retryable: false });
    expect(!result.ok && result.error.message).toContain('busy');
  });

  it.each([
    { status: 403, retryable: false },
    { status: 501, retryable: false },
    { status: 400, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ])('says a host failure with status $status is retryable: $retryable', async ({ status, retryable }) => {
    const history: AgentVersionHistory = {
      list: async () => Promise.reject(Object.assign(new Error(`HTTP ${status}`), { status })),
      read: async () => Promise.reject(Object.assign(new Error(`HTTP ${status}`), { status })),
    };
    const { agent } = session({ history });
    const listed = await agent.execute({ commands: [{ name: 'history.versions', args: {} }] });
    const read = await agent.execute({ commands: [{ name: 'history.read', args: { version: 'L:1' } }] });

    expect(!listed.ok && listed.error).toMatchObject({ code: 'TOOL_ACTION_FAILED', retryable });
    expect(!read.ok && read.error).toMatchObject({ code: 'TOOL_ACTION_FAILED', retryable });
  });

  it('takes the host failure own retryable flag over its status', async () => {
    const history: AgentVersionHistory = {
      list: async () => Promise.reject(Object.assign(new Error('offline'), { retryable: true })),
      read: async () => Promise.reject(Object.assign(new Error('gone'), { status: 503, retryable: false })),
    };
    const { agent } = session({ history });
    const listed = await agent.execute({ commands: [{ name: 'history.versions', args: {} }] });
    const read = await agent.execute({ commands: [{ name: 'history.read', args: { version: 'L:1' } }] });

    expect(!listed.ok && listed.error.retryable).toBe(true);
    expect(!read.ok && read.error.retryable).toBe(false);
  });

  it('works on a read-only session', async () => {
    const { agent } = session({ history: fakeHistory() });

    agent.close();
    const result = await agent.execute({ commands: [{ name: 'history.versions', args: {} }] });

    expect(result.ok).toBe(true);
  });
});

describe('history.restore', () => {
  const restoring = () => {
    const history = { ...fakeHistory(), restore: vi.fn(async (version: string) => STORED[version] !== undefined) };
    const setup = createHeadlessAgentSetup({ services: ['versionHistory'], runtime: 'node', restores: true });
    const agent = createDocumentAgentSession({
      document: current(), tools: setup.tools, contract: setup.contract, actor, ports: setup.ports,
      services: { versionHistory: history },
    });

    return { history, setup, agent };
  };

  it('restores through the host port and says what the restore changes', async () => {
    const { history, agent } = restoring();
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(history.restore).toHaveBeenCalledWith('L:1');
    expect(result.ok && result.results).toEqual([{ version: 'L:1', previous: 'L:3' }]);
    expect(result.ok && result.changed).toEqual({ created: ['gone'], updated: ['a'], moved: [], removed: ['b', 'c'] });
  });

  it('says VERSION_NOT_FOUND for an unknown version and never calls the host restore', async () => {
    const { history, agent } = restoring();
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:99' } }] });

    expect(!result.ok && [result.error.code, result.error.path, result.error.retryable]).toEqual(['VERSION_NOT_FOUND', '/commands/0/args/version', false]);
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('says VERSION_NOT_FOUND when the host finds no such version to restore', async () => {
    const { history, agent } = restoring();

    history.restore.mockResolvedValueOnce(false);
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(!result.ok && result.error.code).toBe('VERSION_NOT_FOUND');
  });

  it('is unavailable with reason host when the version history cannot restore', async () => {
    const { setup, agent } = session({ history: fakeHistory() });
    const entry = setup.contract.commands.find(command => command.name === 'history.restore');
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(entry).toMatchObject({ available: false, unavailableReason: 'host', readOnly: false, requires: ['versionHistory'] });
    expect(!result.ok && [result.error.code, result.error.details?.reason]).toEqual(['COMMAND_UNAVAILABLE', 'host']);
  });

  it('is unavailable with reason service without a version history', async () => {
    const { setup, agent } = session({ services: [] });
    const entry = setup.contract.commands.find(command => command.name === 'history.restore');
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(entry).toMatchObject({ available: false, unavailableReason: 'service' });
    expect(!result.ok && [result.error.code, result.error.details?.reason]).toEqual(['COMMAND_UNAVAILABLE', 'service']);
  });

  it('is a write: refused as READ_ONLY on a read-only session', async () => {
    const { history, agent } = restoring();

    agent.close();
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(!result.ok && result.error.code).toBe('READ_ONLY');
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('runs alone in its batch', async () => {
    const { agent } = restoring();
    const result = await agent.execute({ commands: [
      { name: 'history.restore', args: { version: 'L:1' } },
      { name: 'doc.read', args: {} },
    ] });

    expect(!result.ok && result.error.message).toContain('must be the only command');
  });

  it('history.undo refuses to undo a restore and names the version to restore instead', async () => {
    const { agent } = restoring();

    await agent.execute({ commands: [{ name: 'block.delete', args: { id: 'c' } }] });
    await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });
    const undo = await agent.execute({ commands: [{ name: 'history.undo', args: {} }] });

    expect(!undo.ok && undo.error.code).toBe('UNDO_RESTORED');
    expect(!undo.ok && undo.error.message).toContain('"L:3"');
  });

  it('history.redo after a restore never replays a step from before it', async () => {
    const { agent } = restoring();

    await agent.execute({ commands: [{ name: 'block.delete', args: { id: 'c' } }] });
    await agent.execute({ commands: [{ name: 'history.undo', args: {} }] });
    await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });
    const redo = await agent.execute({ commands: [{ name: 'history.redo', args: {} }] });

    expect(!redo.ok && redo.error.code).toBe('NOTHING_TO_REDO');
  });

  it('never restores once the turn is stopped during the version reads', async () => {
    const { history, agent } = restoring();
    const controller = new AbortController();

    history.read.mockImplementationOnce(async (version: string) => {
      controller.abort();

      return STORED[version] ?? null;
    });
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] }, { signal: controller.signal });

    expect(!result.ok && result.error.code).toBe('CANCELLED');
    expect(history.restore).not.toHaveBeenCalled();
  });

  it('reports a failing host restore with the retry rule of the reads', async () => {
    const { history, agent } = restoring();

    history.restore.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }));
    const result = await agent.execute({ commands: [{ name: 'history.restore', args: { version: 'L:1' } }] });

    expect(!result.ok && result.error).toMatchObject({ code: 'TOOL_ACTION_FAILED', retryable: true });
  });
});
