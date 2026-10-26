// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

import type { AgentActor } from '../../../types/agent';

const actor: AgentActor = { id: 'agent-jint', name: 'Server agent', kind: 'agent' };
const document = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Now' } }] };
const versions = [{ version: 'L:2', savedAt: 20, startedAt: 10, actors: ['u1'] }];

const run = async (input: Record<string, unknown>): Promise<unknown> => {
  const response: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({ document, actor, ...input })));

  return isObject(response) ? response.result : undefined;
};

const execute = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify({ document, actor, ...input })));

  return isObject(response) ? response : {};
};

const contractOf = async (services: string[], restores = false): Promise<unknown> => {
  const response: unknown = JSON.parse(await invoke('manifest', JSON.stringify({ services, ...(restores && { restores }) })));

  return isObject(response) ? response.contract : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server runtime version history', () => {
  it('names the history reads available only with the versionHistory service', async () => {
    const commandOf = (contract: unknown): unknown => isObject(contract) && Array.isArray(contract.commands)
      ? contract.commands.find(entry => isObject(entry) && entry.name === 'history.versions') : undefined;

    expect(commandOf(await contractOf([]))).toMatchObject({ available: false, unavailableReason: 'service' });
    expect(commandOf(await contractOf(['versionHistory']))).toMatchObject({ available: true });
  });

  it('answers from what the host loaded for the batch', async () => {
    const versionHistory = { versions, documents: { 'L:2': { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Then' } }] }, 'L:9': null } };
    const services = ['versionHistory'];
    const listed = await run({ services, versionHistory, batch: { commands: [{ name: 'history.versions', args: {} }] } });
    const changes = await run({ services, versionHistory, batch: { commands: [{ name: 'history.changes', args: { from: 'L:2' } }] } });
    const missing = await run({ services, versionHistory, batch: { commands: [{ name: 'history.read', args: { version: 'L:9' } }] } });

    expect(listed).toMatchObject({ ok: true, results: [{ versions }] });
    expect(changes).toMatchObject({ ok: true, results: [{ from: 'L:2', to: 'current', changed: [{ id: 'p', before: { text: 'Then' }, after: { text: 'Now' } }] }] });
    expect(missing).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', path: '/commands/0/args/version' } });
  });

  it('passes on why the host could not load the history', async () => {
    const result = await run({
      services: ['versionHistory'],
      versionHistory: { failed: 'a stored version could not be read' },
      batch: { commands: [{ name: 'history.versions', args: {} }] },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', retryable: false } });
    expect(JSON.stringify(result)).toContain('a stored version could not be read');
  });

  it.each([
    { status: 403, retryable: false },
    { status: 501, retryable: false },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ])('says a host load that failed with $status is retryable: $retryable', async ({ status, retryable }) => {
    const versionHistory = { failed: 'could not', status };
    const listed = await run({ services: ['versionHistory'], versionHistory, batch: { commands: [{ name: 'history.versions', args: {} }] } });
    const read = await run({ services: ['versionHistory'], versionHistory, batch: { commands: [{ name: 'history.read', args: { version: 'L:2' } }] } });

    expect(listed).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', retryable } });
    expect(read).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', retryable } });
  });

  it('names history.restore available only when the host says it restores', async () => {
    const commandOf = (contract: unknown): unknown => isObject(contract) && Array.isArray(contract.commands)
      ? contract.commands.find(entry => isObject(entry) && entry.name === 'history.restore') : undefined;

    expect(commandOf(await contractOf(['versionHistory']))).toMatchObject({ available: false, unavailableReason: 'host' });
    expect(commandOf(await contractOf(['versionHistory'], true))).toMatchObject({ available: true });
  });

  it('checks a restore and hands the host the version to restore', async () => {
    const versionHistory = { versions, documents: { 'L:1': { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Then' } }] } } };
    const output = await execute({
      services: ['versionHistory'], restores: true, versionHistory,
      batch: { commands: [{ name: 'history.restore', args: { version: 'L:1' } }] },
    });

    expect(output.restore).toBe('L:1');
    expect(output.result).toMatchObject({ ok: true, results: [{ version: 'L:1', previous: 'L:2' }], changed: { updated: ['p'] } });
    expect(output.edits).toEqual([]);
  });

  it('says VERSION_NOT_FOUND and hands the host nothing for a version that is not there', async () => {
    const output = await execute({
      services: ['versionHistory'], restores: true, versionHistory: { versions, documents: { 'L:9': null } },
      batch: { commands: [{ name: 'history.restore', args: { version: 'L:9' } }] },
    });

    expect(output.restore).toBeUndefined();
    expect(output.result).toMatchObject({ ok: false, error: { code: 'VERSION_NOT_FOUND' } });
  });

  it('says reason host when the host does not restore', async () => {
    const output = await execute({
      services: ['versionHistory'], versionHistory: { versions, documents: { 'L:1': document } },
      batch: { commands: [{ name: 'history.restore', args: { version: 'L:1' } }] },
    });

    expect(output.restore).toBeUndefined();
    expect(output.result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
  });

  it('hands the host no restore that would unlock a locked database', async () => {
    const db = (locked: boolean): Record<string, unknown> => ({
      id: 'db', type: 'database', data: { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...(locked && { databaseLocked: true }) }] },
    });
    const output = await execute({
      document: { blocks: [db(true)] },
      services: ['versionHistory'], restores: true, versionHistory: { versions, documents: { 'L:1': { blocks: [db(false)] } } },
      batch: { commands: [{ name: 'history.restore', args: { version: 'L:1' } }] },
    });

    expect(output.restore).toBeUndefined();
    expect(output.result).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED', details: { reason: 'no-channel' } } });
  });
});
