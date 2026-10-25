import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentTurn, type AgentTurnHooks } from '../../../../../src/components/modules/api/agent-turn';
import { COMMANDS } from '../../../../../src/shared/agent/commands';
import { createDocumentAgentSession } from '../../../../../src/shared/agent/document-session';
import { AgentFailure } from '../../../../../src/shared/agent/errors';
import { modelAnswer } from '../../../../../src/shared/agent/model-answer';
import { buildToolRuntimes } from '../../../../../src/shared/tool-actions/runtime';
import { buildAgentContract } from '../../../../../src/shared/tool-manifest';
import { makeContract } from '../../../agent/fixtures/contract';
import { stubPorts } from '../../../shared/agent/fixtures';

import type { AgentActor, AgentBatch, AgentError, AgentResult, AgentSession, ContractSlice, DocumentView } from '../../../../../types/agent';

type OkResult = Extract<AgentResult, { ok: true }>;

const ACTOR: AgentActor = { id: 'bot', name: 'Bot', kind: 'agent' };
const VIEW: DocumentView = { revision: 'r1', rootId: null, blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: 'Hello' }] };
const INDEX: ContractSlice = { index: { tools: [], commands: [], guidance: 'Read before writing.' } };
const BATCH: AgentBatch = {
  commands: [{ name: 'block.insert', args: { type: 'paragraph' }, ref: 'newBlock' }],
  expectRevision: 'r0',
};
const ok = (): OkResult => ({
  ok: true, revision: 'r1', results: [{ id: 'b1' }], refs: { newBlock: 'b1' },
  changed: { created: ['b1'], updated: [], moved: [], removed: [] },
  lastRange: { blockId: 'b1', field: 'text', start: 0, end: 1 },
  warnings: [{ code: 'SANITIZED', message: 'Unsafe markup removed.', blockId: 'b1', field: 'text' }],
});
const makeSession = () => ({
  id: 'turn-1',
  actor: ACTOR,
  read: vi.fn<AgentSession['read']>().mockResolvedValue(VIEW),
  describe: vi.fn<AgentSession['describe']>().mockReturnValue(INDEX),
  execute: vi.fn<AgentSession['execute']>().mockResolvedValue(ok()),
  log: vi.fn<AgentSession['log']>().mockReturnValue([
    { batch: 1, index: 0, name: 'block.insert', args: { type: 'paragraph' }, actorId: 'bot' },
  ]),
  close: vi.fn<AgentSession['close']>(),
}) satisfies AgentSession;
const makeHooks = () => ({
  onExecuted: vi.fn<AgentTurnHooks['onExecuted']>(),
  onClosed: vi.fn<AgentTurnHooks['onClosed']>(),
  isEditorDestroyed: vi.fn<AgentTurnHooks['isEditorDestroyed']>(() => false),
}) satisfies AgentTurnHooks;
const parseContent = (content: string): unknown => {
  const parsed: unknown = JSON.parse(content);

  return parsed;
};
const errorMessage = (content: string): string => {
  const value = parseContent(content);

  if (typeof value !== 'object' || value === null || !('error' in value)
    || typeof value.error !== 'object' || value.error === null || !('message' in value.error)
    || typeof value.error.message !== 'string') {
    throw new Error('Expected an error with a string message.');
  }

  return value.error.message;
};
const realSessions: AgentSession[] = [];
const openDocumentSession = () => {
  const contract = buildAgentContract(makeContract().manifest, COMMANDS, { runtime: 'node', services: [] });
  const session = createDocumentAgentSession({
    document: { title: 'Original', blocks: [] },
    tools: buildToolRuntimes([]),
    contract,
    actor: ACTOR,
    ports: stubPorts(),
  });

  realSessions.push(session);

  return session;
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  try {
    realSessions.splice(0).forEach(session => session.close());
  } finally {
    vi.restoreAllMocks();
  }
});

describe('createAgentTurn dispatch', () => {
  it.each(['object', 'JSON string'])('executes %s arguments with the turn signal; the host gets the full result, the model a trimmed one', async format => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);
    const input = format === 'object' ? BATCH : JSON.stringify(BATCH);

    const result = await turn.call('blok_execute', input);

    expect(result.isError).toBe(false);
    expect(JSON.parse(String(result.content))).toEqual({ ...ok(), changed: { created: ['b1'] } });
    expect(session.execute).toHaveBeenCalledExactlyOnceWith(BATCH, { signal: turn.signal });
    expect(hooks.onExecuted).toHaveBeenCalledExactlyOnceWith(ok());
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
  });

  it('relays a failed batch without requiring a revision or showing success', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const failed: AgentResult = {
      ok: false,
      error: { code: 'STALE', message: 'Read again.', retryable: true, details: { current: [{ id: 'p', text: 'New' }] } },
      warnings: [{ code: 'SANITIZED', message: 'Markup removed.', commandIndex: 0 }],
    };

    session.execute.mockResolvedValue(failed);
    const result = await createAgentTurn(session, hooks).call('blok_execute', BATCH);

    expect(result.isError).toBe(true);
    expect(JSON.parse(String(result.content))).toEqual(failed);
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'malformed JSON', input: '{commands' },
    { label: 'an array', input: [BATCH] },
    { label: 'a number', input: 7 },
    { label: 'a JSON array', input: '[1]' },
    { label: 'a JSON string primitive', input: '"text"' },
    { label: 'JSON null', input: 'null' },
  ])('returns INVALID_ARGS for $label without dispatching', async ({ input }) => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_execute', input);
    const message = errorMessage(result.content);

    expect(message.trim()).not.toBe('');
    expect(message).toMatch(/\b(?:json|object)\b/i);
    expect(parseContent(result.content)).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_ARGS', retryable: false }) });
    expect(result.isError).toBe(true);
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
  });

  it.each([
    { input: {}, path: '/commands' },
    { input: { commands: 'block.insert' }, path: '/commands' },
    { input: { commands: BATCH.commands, expectRevision: 5 }, path: '/expectRevision' },
    { input: { commands: [null] }, path: '/commands/0' },
  ])('leaves a malformed execute envelope to core, which refuses it at $path', async ({ input, path }) => {
    const session = openDocumentSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_execute', input);

    expect(parseContent(result.content)).toMatchObject({ ok: false, revision: session.revision(), error: { code: 'INVALID_ARGS', path, retryable: false } });
    expect(result.isError).toBe(true);
  });

  it('lists the valid tools for an unknown tool name', async () => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('table.insertRows', {});

    expect(parseContent(result.content)).toMatchObject({
      error: { code: 'UNKNOWN_COMMAND', details: { valid: ['blok_read', 'blok_describe', 'blok_execute'] } },
    });
    expect(parseContent(result.content)).not.toHaveProperty('ok');
    expect(result.isError).toBe(true);
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
  });

  it('reads with an empty object when input is omitted', async () => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_read', undefined);

    expect(result).toEqual({ content: JSON.stringify(VIEW), isError: false });
    expect(session.read).toHaveBeenCalledExactlyOnceWith({});
  });

  it.each(['object', 'JSON string'])('passes read options from %s arguments', async format => {
    const session = makeSession();
    const args = { ids: ['p'], detail: 'full', limit: 1 };
    const result = await createAgentTurn(session, makeHooks()).call('blok_read', format === 'object' ? args : JSON.stringify(args));

    expect(result).toEqual({ content: JSON.stringify(VIEW), isError: false });
    expect(session.read).toHaveBeenCalledExactlyOnceWith(args);
  });

  it.each([
    { input: undefined, query: {} },
    { input: { tool: 'table' }, query: { tool: 'table' } },
    { input: '{"command":"table.insertRows"}', query: { command: 'table.insertRows' } },
    { input: { tool: 'table', command: 'table.insertRows' }, query: { tool: 'table', command: 'table.insertRows' } },
  ])('passes a describe query without changing it', async ({ input, query }) => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_describe', input);

    expect(result).toEqual({ content: JSON.stringify(INDEX), isError: false });
    expect(session.describe).toHaveBeenCalledExactlyOnceWith(query);
  });

  it.each([
    { input: { tool: 5 }, path: '/tool' },
    { input: { command: 5 }, path: '/command' },
  ])('rejects a non-string describe query at $path', async ({ input, path }) => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_describe', input);

    expect(parseContent(result.content)).toMatchObject({ error: { code: 'INVALID_ARGS', path } });
    expect(result.isError).toBe(true);
    expect(session.describe).not.toHaveBeenCalled();
  });

  it.each(['blok_read', 'blok_describe'])('rejects malformed JSON for %s before dispatch', async name => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call(name, '{bad');
    const message = errorMessage(result.content);

    expect(message.trim()).not.toBe('');
    expect(message).toMatch(/\b(?:json|object)\b/i);
    expect(parseContent(result.content)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(result.isError).toBe(true);
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
  });

  // Adapters turn tool arguments that are not valid JSON into { invalidJson } (src/agent-models/shared.ts).
  it.each(['blok_read', 'blok_describe', 'blok_execute'])('tells the model its %s arguments were not valid JSON', async name => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call(name, { invalidJson: '{"commands": [{"args"' });

    expect(result.isError).toBe(true);
    expect(parseContent(result.content)).toMatchObject({ error: { code: 'INVALID_ARGS', retryable: false } });
    expect(errorMessage(result.content)).toMatch(/not valid JSON/);
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
  });

  it('uses the turn signal for every direct execute, even with host options', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    expect(await turn.execute(BATCH)).toEqual(ok());
    expect(await turn.execute(BATCH, { signal: new AbortController().signal })).toEqual(ok());

    expect(session.execute).toHaveBeenNthCalledWith(1, BATCH, { signal: turn.signal });
    expect(session.execute).toHaveBeenNthCalledWith(2, BATCH, { signal: turn.signal });
    expect(hooks.onExecuted).toHaveBeenCalledTimes(2);
  });

  it('exposes the session identity, read, describe and log to direct callers', async () => {
    const session = makeSession();
    const turn = createAgentTurn(session, makeHooks());

    expect(await turn.read({ ids: ['p'] })).toEqual(VIEW);
    expect(turn.describe({ command: 'block.insert' })).toEqual(INDEX);
    expect(turn.id).toBe('turn-1');
    expect(turn.actor).toEqual(ACTOR);
    expect(turn.log()).toEqual([
      { batch: 1, index: 0, name: 'block.insert', args: { type: 'paragraph' }, actorId: 'bot' },
    ]);
    expect(session.read).toHaveBeenCalledExactlyOnceWith({ ids: ['p'] });
    expect(session.describe).toHaveBeenCalledExactlyOnceWith({ command: 'block.insert' });
  });
});

describe('createAgentTurn lifecycle', () => {
  const endMethods: Array<'end' | 'close'> = ['end', 'close'];
  const closeMethods: Array<'end' | 'close' | 'stop'> = ['end', 'close', 'stop'];

  it.each(endMethods)('%s ends once without aborting and rejects every later tool call', async method => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    turn[method]();
    turn.end();
    turn.close();
    turn.stop();

    expect(turn.signal.aborted).toBe(false);
    expect(hooks.onClosed).toHaveBeenCalledExactlyOnceWith('end');
    for (const name of ['blok_read', 'blok_describe', 'blok_execute']) {
      const result = await turn.call(name, {});

      expect(parseContent(result.content)).toEqual(name === 'blok_execute'
        ? { ok: false, error: expect.objectContaining({ code: 'CANCELLED' }) }
        : { error: expect.objectContaining({ code: 'CANCELLED' }) });
      expect(result.isError).toBe(true);
    }
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });

  it('stop aborts once and cancels tool and direct executes before they start', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    turn.stop();
    turn.stop();
    turn.end();
    turn.close();

    expect(turn.signal.aborted).toBe(true);
    expect(hooks.onClosed).toHaveBeenCalledExactlyOnceWith('stop');
    const called = await turn.call('blok_execute', BATCH);
    const executed = await turn.execute(BATCH);

    expect(parseContent(called.content)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(called.isError).toBe(true);
    expect(executed).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(session.execute).not.toHaveBeenCalled();
    expect(hooks.onExecuted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });

  it.each(closeMethods)('%s waits for an in-flight execute before closing the session', async method => {
    const session = makeSession();
    const hooks = makeHooks();
    const pending: { resolve?: (result: AgentResult) => void } = {};

    session.execute.mockImplementation(() => new Promise<AgentResult>(resolve => {
      pending.resolve = resolve;
    }));
    const turn = createAgentTurn(session, hooks);
    const running = turn.call('blok_execute', BATCH);

    await vi.waitFor(() => expect(session.execute).toHaveBeenCalledTimes(1));
    turn[method]();
    expect(session.close).not.toHaveBeenCalled();
    expect(hooks.onClosed).toHaveBeenCalledExactlyOnceWith(method === 'stop' ? 'stop' : 'end');
    expect(turn.signal.aborted).toBe(method === 'stop');
    if (pending.resolve === undefined) {
      throw new Error('The execute dependency did not start.');
    }
    pending.resolve(ok());

    expect(await running).toEqual({ content: JSON.stringify(modelAnswer(ok())), isError: false });
    expect(hooks.onExecuted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });

  it.each(['tool', 'direct'])('end waits for a pending %s read before closing the session', async surface => {
    const session = makeSession();
    const hooks = makeHooks();
    const pending: { resolve?: (view: DocumentView) => void } = {};

    session.read.mockImplementation(() => new Promise<DocumentView>(resolve => {
      pending.resolve = resolve;
    }));
    const turn = createAgentTurn(session, hooks);
    const running = surface === 'tool'
      ? turn.call('blok_read', {}).then(result => parseContent(result.content))
      : turn.read({});

    await vi.waitFor(() => expect(session.read).toHaveBeenCalledExactlyOnceWith({}));
    if (pending.resolve === undefined) {
      throw new Error('The read dependency did not start.');
    }
    try {
      turn.end();
      expect(session.close).not.toHaveBeenCalled();
      expect(hooks.onClosed).toHaveBeenCalledExactlyOnceWith('end');
      expect(turn.signal.aborted).toBe(false);
      await setImmediate();
      expect(session.close).not.toHaveBeenCalled();
    } finally {
      pending.resolve(VIEW);
    }

    expect(await running).toEqual(VIEW);
    expect(hooks.onExecuted).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });

  it('call after editor destruction rejects even when the turn was already stopped', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    turn.stop();
    hooks.isEditorDestroyed.mockReturnValue(true);

    await expect(turn.call('blok_read', {})).rejects.toThrow(/destroyed/);
    expect(session.read).not.toHaveBeenCalled();
  });
});

describe('createAgentTurn with real session validation', () => {
  it.each([
    { method: 'end' },
    { method: 'close' },
  ] satisfies Array<{ method: 'end' | 'close' }>)('cancels direct execute after $method without changing saved content', async ({ method }) => {
    const session = openDocumentSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    turn[method]();
    const result = await turn.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'Unwanted' } }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(session.output()).toMatchObject({ title: 'Original', blocks: [] });
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });

  it('preserves a present failure revision from the real executor', async () => {
    const session = openDocumentSession();
    const hooks = makeHooks();
    const before = await session.read();
    const result = await createAgentTurn(session, hooks).call('blok_execute', { commands: [null] });

    expect(parseContent(result.content)).toMatchObject({
      ok: false, revision: before.revision, error: { code: 'INVALID_ARGS' },
    });
    expect(result.isError).toBe(true);
    expect(session.output()).toMatchObject({ title: 'Original', blocks: [] });
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'blok_read', input: { limit: 0 }, code: 'INVALID_ARGS' },
    { name: 'blok_read', input: { rootId: 'missing' }, code: 'BLOCK_NOT_FOUND' },
    { name: 'blok_describe', input: { tool: 'missing' }, code: 'UNKNOWN_TOOL' },
    { name: 'blok_describe', input: { command: 'missing.action' }, code: 'UNKNOWN_COMMAND' },
    { name: 'blok_execute', input: { commands: [null] }, code: 'INVALID_ARGS' },
  ])('returns $code for a model mistake in $name instead of rejecting', async ({ name, input, code }) => {
    const session = openDocumentSession();
    const hooks = makeHooks();
    const result = await createAgentTurn(session, hooks).call(name, input);

    // blok_read and blok_describe answer a bare { error }; only a batch has ok.
    expect(parseContent(result.content)).toEqual(name === 'blok_execute'
      ? expect.objectContaining({ ok: false, error: expect.objectContaining({ code, retryable: false }) })
      : { error: expect.objectContaining({ code, retryable: false }) });
    expect(result.isError).toBe(true);
    expect(session.output()).toMatchObject({ title: 'Original', blocks: [] });
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });

  it('applies a JSON-string batch and returns the saved title on read', async () => {
    const session = openDocumentSession();
    const turn = createAgentTurn(session, makeHooks());
    const written = await turn.call('blok_execute', '{"commands":[{"name":"doc.setTitle","args":{"title":"Changed"}}]}');
    const read = await turn.call('blok_read', {});

    expect(session.output()).toMatchObject({ title: 'Changed', blocks: [] });
    expect(written.isError).toBe(false);
    expect(parseContent(written.content)).toEqual(expect.not.objectContaining({ changed: expect.anything() }));
    expect(read.isError).toBe(false);
    expect(parseContent(read.content)).toMatchObject({ rootId: null, page: { title: 'Changed' }, blocks: [] });
  });

  it.each(['blok_read', 'blok_describe'])('preserves every AgentError field from an AgentFailure in %s', async name => {
    const session = makeSession();
    const error: AgentError = {
      code: 'BLOCK_NOT_FOUND', message: 'No target block.', retryable: false,
      commandIndex: 0, path: '/rootId', details: { id: 'missing' },
    };
    const thrown = new AgentFailure(error);

    session.read.mockRejectedValue(thrown);
    session.describe.mockImplementation(() => { throw thrown; });
    const result = await createAgentTurn(session, makeHooks()).call(name, {});

    expect(result).toEqual({ content: JSON.stringify({ error }), isError: true });
  });

  it.each(['blok_read', 'blok_describe'])('does not hide an unexpected host exception from %s', async name => {
    const session = makeSession();
    const error = new Error('Host dependency failed.');

    session.read.mockRejectedValue(error);
    session.describe.mockImplementation(() => { throw error; });

    await expect(createAgentTurn(session, makeHooks()).call(name, {})).rejects.toBe(error);
  });
});

describe('createAgentTurn — queue and stop', () => {
  it('parallel calls run one at a time, in call order', async () => {
    const session = makeSession();
    const pending: { resolve?: (result: AgentResult) => void } = {};
    const firstResult = ok();
    const secondResult: OkResult = { ...ok(), revision: 'r2' };
    const order: string[] = [];
    const firstEntered = new Promise<void>(entered => {
      session.execute.mockImplementationOnce(async () => {
        order.push('first:start');
        entered();
        const result = await new Promise<AgentResult>(resolve => {
          pending.resolve = resolve;
        });

        order.push('first:end');

        return result;
      });
    });
    const secondEntered = new Promise<void>(entered => {
      session.execute.mockImplementationOnce(async () => {
        order.push('second:start');
        entered();

        return secondResult;
      });
    });
    session.describe.mockImplementationOnce(() => {
      order.push('describe');

      return INDEX;
    });
    session.read.mockImplementationOnce(async () => {
      order.push('read');

      return VIEW;
    });
    const turn = createAgentTurn(session, makeHooks());
    const firstCall = turn.call('blok_execute', BATCH);
    const describeCall = turn.call('blok_describe', { command: 'block.insert' });
    const readCall = turn.call('blok_read', { ids: ['p'] });
    const secondCall = turn.call('blok_execute', BATCH);
    const calls = [firstCall, describeCall, readCall, secondCall];
    const drained = Promise.allSettled(calls);

    try {
      await Promise.race([firstEntered, firstCall]);
      if (pending.resolve === undefined) {
        throw new Error('The execute dependency did not start.');
      }
      await setImmediate();
      expect(order).toEqual(['first:start']);
      expect(session.describe).not.toHaveBeenCalled();
      expect(session.read).not.toHaveBeenCalled();
      expect(session.execute).toHaveBeenCalledTimes(1);
    } finally {
      pending.resolve?.(firstResult);
      await drained;
    }

    await Promise.race([secondEntered, secondCall]);
    expect(order).toEqual(['first:start', 'first:end', 'describe', 'read', 'second:start']);
    expect(await Promise.all(calls)).toEqual([
      { content: JSON.stringify(modelAnswer(firstResult)), isError: false },
      { content: JSON.stringify(INDEX), isError: false },
      { content: JSON.stringify(VIEW), isError: false },
      { content: JSON.stringify(modelAnswer(secondResult)), isError: false },
    ]);
    expect(session.execute).toHaveBeenNthCalledWith(1, BATCH, { signal: turn.signal });
    expect(session.describe).toHaveBeenCalledExactlyOnceWith({ command: 'block.insert' });
    expect(session.read).toHaveBeenCalledExactlyOnceWith({ ids: ['p'] });
    expect(session.execute).toHaveBeenNthCalledWith(2, BATCH, { signal: turn.signal });
  });

  it('a rejected execute does not poison the queue', async () => {
    const session = makeSession();
    const error = new Error('Session dependency failed.');
    const nextResult: OkResult = { ...ok(), revision: 'r2' };

    session.execute.mockRejectedValueOnce(error).mockResolvedValueOnce(nextResult);
    const turn = createAgentTurn(session, makeHooks());
    const [failed, next] = await Promise.allSettled([
      turn.call('blok_execute', BATCH),
      turn.call('blok_execute', BATCH),
    ]);

    expect(next).toEqual({
      status: 'fulfilled',
      value: { content: JSON.stringify(modelAnswer(nextResult)), isError: false },
    });
    expect(session.execute).toHaveBeenNthCalledWith(2, BATCH, { signal: turn.signal });
    expect(session.execute).toHaveBeenCalledTimes(2);
    expect(failed).toEqual({ status: 'rejected', reason: error });
  });

  it.each([
    { method: 'end', surface: 'tool' },
    { method: 'close', surface: 'tool' },
    { method: 'end', surface: 'direct' },
    { method: 'close', surface: 'direct' },
  ] satisfies Array<{ method: 'end' | 'close'; surface: 'tool' | 'direct' }>)(
    '$method drains $surface execute and read accepted before closure',
    async ({ method, surface }) => {
      const session = makeSession();
      const hooks = makeHooks();
      const order: string[] = [];
      const state = { text: 'Original' };
      const pending: { release?: () => void } = {};
      const gate = new Promise<void>(resolve => {
        pending.release = resolve;
      });
      const batch: AgentBatch = {
        commands: [{ name: 'text.replace', args: { id: 'p', range: 'all', with: [{ text: 'Changed' }] } }],
      };
      const result: OkResult = { ...ok(), changed: { created: [], updated: ['p'], moved: [], removed: [] } };
      const editedView: DocumentView = {
        ...VIEW, blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: 'Changed' }],
      };

      session.execute.mockImplementationOnce(async () => {
        order.push('execute:start');
        await gate;
        state.text = 'Changed';
        order.push('execute:end');

        return result;
      });
      session.read.mockImplementationOnce(async () => {
        order.push('read');

        return { ...editedView, blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: state.text }] };
      });
      session.close.mockImplementation(() => {
        order.push('close');
      });
      const turn = createAgentTurn(session, hooks);
      const execute = surface === 'tool'
        ? turn.call('blok_execute', batch).then(value => parseContent(value.content))
        : turn.execute(batch);
      const read = surface === 'tool'
        ? turn.call('blok_read', { ids: ['p'] }).then(value => parseContent(value.content))
        : turn.read({ ids: ['p'] });
      const drained = Promise.allSettled([execute, read]);

      turn[method]();
      const observed = { closeBeforeRelease: 0 };

      try {
        await setImmediate();
        observed.closeBeforeRelease = session.close.mock.calls.length;
      } finally {
        pending.release?.();
        await drained;
      }

      expect(await execute).toEqual(surface === 'tool' ? modelAnswer(result) : result);
      expect(await read).toEqual(editedView);
      expect(observed.closeBeforeRelease).toBe(0);
      expect(turn.signal.aborted).toBe(false);
      expect(session.execute).toHaveBeenCalledExactlyOnceWith(batch, { signal: turn.signal });
      expect(session.read).toHaveBeenCalledExactlyOnceWith({ ids: ['p'] });
      await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
      expect(order).toEqual(['execute:start', 'execute:end', 'read', 'close']);
      expect(hooks.onClosed).toHaveBeenCalledExactlyOnceWith('end');
    }
  );

  it.each(['end', 'close'] satisfies Array<'end' | 'close'>)(
    '%s drains a tool describe accepted before closure',
    async method => {
      const session = makeSession();
      const order: string[] = [];

      session.describe.mockImplementationOnce(() => {
        order.push('describe');

        return INDEX;
      });
      session.close.mockImplementation(() => {
        order.push('close');
      });
      const turn = createAgentTurn(session, makeHooks());
      const query = { command: 'block.insert' };
      const describeCall = turn.call('blok_describe', query);
      const drained = Promise.allSettled([describeCall]);

      turn[method]();
      await drained;

      expect(await describeCall).toEqual({ content: JSON.stringify(INDEX), isError: false });
      expect(turn.signal.aborted).toBe(false);
      expect(() => turn.describe(query)).toThrow(AgentFailure);
      expect(session.describe).toHaveBeenCalledExactlyOnceWith(query);
      await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
      expect(order).toEqual(['describe', 'close']);
    }
  );

  it('a batch that resolves after end() is returned but never drawn', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const pending: { resolve?: (result: AgentResult) => void } = {};
    const enteredResult = ok();
    const entered = new Promise<void>(resolveEntered => {
      session.execute.mockImplementationOnce(() => {
        resolveEntered();

        return new Promise<AgentResult>(resolve => {
          pending.resolve = resolve;
        });
      });
    });
    const turn = createAgentTurn(session, hooks);
    const running = turn.call('blok_execute', BATCH);

    await entered;
    if (pending.resolve === undefined) {
      throw new Error('The execute dependency did not start.');
    }
    turn.end();
    pending.resolve(enteredResult);
    const result = await running;

    expect(hooks.onExecuted).not.toHaveBeenCalled();
    expect(result).toEqual({ content: JSON.stringify(modelAnswer(enteredResult)), isError: false });
  });

  it('stop cancels queued execute and read but preserves the entered result', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const pending: { resolve?: (result: AgentResult) => void } = {};
    const enteredResult = ok();
    const entered = new Promise<void>(resolveEntered => {
      session.execute.mockImplementationOnce(() => {
        resolveEntered();

        return new Promise<AgentResult>(resolve => {
          pending.resolve = resolve;
        });
      });
    });
    const turn = createAgentTurn(session, hooks);
    const running = turn.call('blok_execute', BATCH);
    const queuedExecute = turn.call('blok_execute', BATCH);
    const queuedRead = turn.call('blok_read', {});

    await entered;
    if (pending.resolve === undefined) {
      throw new Error('The execute dependency did not start.');
    }
    turn.stop();
    pending.resolve(enteredResult);

    const executeResult = await queuedExecute;
    const readResult = await queuedRead;

    expect(parseContent(executeResult.content)).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(parseContent(readResult.content)).toEqual({ error: expect.objectContaining({ code: 'CANCELLED' }) });
    expect(executeResult.isError).toBe(true);
    expect(readResult.isError).toBe(true);
    expect(await running).toEqual({ content: JSON.stringify(modelAnswer(enteredResult)), isError: false });
    expect(session.execute).toHaveBeenCalledExactlyOnceWith(BATCH, { signal: turn.signal });
    expect(session.read).not.toHaveBeenCalled();
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });
});
