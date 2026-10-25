// @vitest-environment node
import { setImmediate as dispatchCheckpoint } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolDispatcher, UnknownToolError } from '../../../src/mcp/dispatcher';
import type { Caller, DispatcherDeps, ToolOutcome } from '../../../src/mcp/dispatcher';
import { McpSurfaceError, NO_DELIVERY, surfaceError } from '../../../src/mcp/errors';
import { HandleRegistry } from '../../../src/mcp/handles';
import type { HandleSession, McpExecuteResult } from '../../../src/mcp/session';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { failure } from '../../../src/shared/agent/errors';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';
import type { AgentBatch, AgentSession, ContractSlice, DocumentView } from '../../../types/agent';

const stdio: Caller = { principal: 'alice', clientName: 'test', scopes: null };
const reader: Caller = { principal: 'alice', clientName: 'test', scopes: ['blok.read'] };
const writer: Caller = { principal: 'alice', clientName: 'test', scopes: ['blok.write'] };
const stranger: Caller = { principal: 'bob', clientName: 'test', scopes: null };

const view: DocumentView = {
  revision: 'content-r1',
  rootId: null,
  page: { title: 'Notes' },
  blocks: [{ id: 'p1', type: 'paragraph', depth: 0, text: 'Hello' }],
  next: 'c:p2',
};
const index: ContractSlice = {
  index: {
    tools: [{ name: 'paragraph', summary: 'Text' }],
    commands: [{ name: 'block.insert', summary: 'Insert a block' }],
    guidance: 'Read before editing.',
  },
};
const savedResult: McpExecuteResult = {
  ok: true,
  revision: 'content-r2',
  results: [{ id: 'new-block' }],
  refs: { created: 'new-block' },
  changed: { created: ['new-block'], updated: [], moved: [], removed: [] },
  lastRange: { blockId: 'new-block', field: 'text', start: 0, end: 5 },
  warnings: [{ code: 'SANITIZED', message: 'Removed unsafe markup.', commandIndex: 0 }],
  delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'source-v2' },
};

const fakeSession = (overrides: Partial<HandleSession> = {}): HandleSession => ({
  mode: 'stored',
  write: true,
  durability: 'saved-on-execute',
  contractRevision: 'contract-r1',
  read: vi.fn<HandleSession['read']>(async () => view),
  describe: vi.fn<HandleSession['describe']>(() => index),
  execute: vi.fn<HandleSession['execute']>(async () => savedResult),
  close: vi.fn<HandleSession['close']>(async () => ({ unsavedBatches: 0, hostRecordLags: false })),
  ...overrides,
});

const registries: HandleRegistry<HandleSession>[] = [];
const calls: Promise<unknown>[] = [];
const sessions: AgentSession[] = [];
const releases: Array<() => void> = [];

const barrier = () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });

  if (release === undefined) {
    throw new Error('Barrier was not initialized.');
  }
  releases.push(release);

  return { wait, release };
};

const deadline = async <T>(operation: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Deadline: ${label}`)), 2000);
  });

  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const invoke = (
  dispatch: ReturnType<typeof createToolDispatcher>,
  name: string,
  args: Record<string, unknown>,
  caller: Caller = stdio,
): Promise<ToolOutcome> => {
  const call = dispatch(name, args, caller);

  calls.push(call);
  // A later barrier assertion may fail before this call is awaited.
  void call.catch(() => undefined);
  const bounded = deadline(call, name);
  void bounded.catch(() => undefined);

  return bounded;
};

const fixture = (session: HandleSession = fakeSession(), maxPerPrincipal = 8) => {
  const handles = new HandleRegistry<HandleSession>({
    idleMs: 600_000,
    maxPerPrincipal,
    onExpire: async current => {
      await current.close('expired');
    },
  });
  registries.push(handles);
  const deps: DispatcherDeps = {
    handles,
    open: vi.fn<DispatcherDeps['open']>(async () => session),
    list: vi.fn<DispatcherDeps['list']>(async () => ({
      documents: [{ id: 'doc-1', title: null, live: false }],
      nextCursor: 'next-doc',
      supported: true,
    })),
    stillAllowed: vi.fn<DispatcherDeps['stillAllowed']>(async () => true),
    handleIdleMs: 600_000,
  };

  return { deps, session, dispatch: createToolDispatcher(deps) };
};

const handleFrom = (outcome: ToolOutcome): string => {
  const handle = outcome.structuredContent.handle;

  if (outcome.isError || typeof handle !== 'string' || handle === '') {
    throw new Error('Open did not return a handle.');
  }

  return handle;
};

const expectFailure = (outcome: ToolOutcome, code: string, execute = false): void => {
  if (execute) {
    expect(outcome).toEqual({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({ code }),
        delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null },
      },
    });
    expect(outcome.structuredContent).not.toHaveProperty('revision');
  } else {
    expect(outcome).toEqual({
      isError: true,
      structuredContent: { error: expect.objectContaining({ code }) },
    });
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  registries.length = 0;
  calls.length = 0;
  sessions.length = 0;
  releases.length = 0;
});

afterEach(async () => {
  releases.splice(0).forEach(release => release());
  try {
    await deadline(Promise.allSettled(calls.splice(0)), 'dispatch cleanup');
  } finally {
    try {
      await deadline(Promise.allSettled(registries.splice(0).map(registry =>
        registry.closeAll(async session => {
          await session.close('closed');
        })
      )), 'registry cleanup');
    } finally {
      (() => {
        try {
          sessions.splice(0).forEach(session => session.close());
        } finally {
          vi.restoreAllMocks();
        }
      })();
    }
  }
}, 10_000);

describe('createToolDispatcher', () => {
  it('opens read-only by default and reports the session facts, not the requested facts', async () => {
    const session = fakeSession({ mode: 'live', write: false, durability: 'best-effort' });
    const { deps, dispatch } = fixture(session);
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1' });
    const handle = handleFrom(outcome);

    expect(outcome).toEqual({
      isError: false,
      structuredContent: {
        handle,
        mode: 'live',
        write: false,
        durability: 'best-effort',
        expiresAfterIdleMs: 600_000,
        contractRevision: 'contract-r1',
      },
    });
    expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1', mode: 'auto', write: false }, stdio);
    expect(deps.handles.count('alice')).toBe(1);
    expect(session.read).not.toHaveBeenCalled();
  });

  const modes: Array<'auto' | 'live' | 'stored'> = ['auto', 'live', 'stored'];

  it.each(modes)('passes explicit %s mode and write intent to the opener', async mode => {
    const { deps, dispatch } = fixture();
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', mode, write: true });

    expect(outcome.isError).toBe(false);
    expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1', mode, write: true }, stdio);
  });

  it('returns a complete first view and sends only its view arguments to read', async () => {
    const { session, dispatch } = fixture();
    const args = { rootId: null, depth: 1, detail: 'full', limit: 1, textLimit: 20 };
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', view: args });

    expect(outcome.structuredContent.view).toEqual({
      revision: 'content-r1',
      rootId: null,
      page: { title: 'Notes' },
      blocks: [{ id: 'p1', type: 'paragraph', depth: 0, text: 'Hello' }],
      next: 'c:p2',
    });
    expect(outcome.isError).toBe(false);
    expect(session.read).toHaveBeenCalledExactlyOnceWith(args);
  });

  it('refuses an open at the cap before opening anything', async () => {
    const { deps, dispatch } = fixture(fakeSession(), 1);
    await invoke(dispatch, 'blok_open', { documentId: 'first' });
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'second' });

    expectFailure(outcome, 'HANDLE_LIMIT');
    expect(deps.open).toHaveBeenCalledTimes(1);
    expect(deps.handles.count('alice')).toBe(1);
  });

  it('closes the session of a racing open that lost the last slot', async () => {
    const { deps, dispatch } = fixture(fakeSession(), 1);
    const held = barrier();
    const first = fakeSession();
    const second = fakeSession();
    vi.mocked(deps.open)
      .mockImplementationOnce(async () => {
        await held.wait;

        return first;
      })
      .mockResolvedValueOnce(second);
    const slow = invoke(dispatch, 'blok_open', { documentId: 'first' });
    const fast = await invoke(dispatch, 'blok_open', { documentId: 'second' });

    held.release();
    const lost = await slow;

    expect(fast.isError).toBe(false);
    expectFailure(lost, 'HANDLE_LIMIT');
    expect(first.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(deps.handles.count('alice')).toBe(1);
  });

  it('closes a session whose open finished after the registry was closed', async () => {
    const { deps, dispatch } = fixture();
    const held = barrier();
    const late = fakeSession();
    vi.mocked(deps.open).mockImplementationOnce(async () => {
      await held.wait;

      return late;
    });
    const opening = invoke(dispatch, 'blok_open', { documentId: 'doc-1' });

    await deadline(dispatchCheckpoint(), 'open started');
    await deps.handles.closeAll(async session => {
      await session.close('closed');
    });
    held.release();
    const outcome = await opening;

    expect(outcome.isError).toBe(true);
    expect(late.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(deps.handles.count('alice')).toBe(0);
  });

  it('closes the session instead of adding a handle when the request was aborted during open', async () => {
    const { deps, dispatch } = fixture();
    const held = barrier();
    const session = fakeSession();
    const controller = new AbortController();
    vi.mocked(deps.open).mockImplementationOnce(async () => {
      await held.wait;

      return session;
    });
    const call = dispatch('blok_open', { documentId: 'doc-1' }, stdio, { signal: controller.signal });

    calls.push(call);
    controller.abort();
    held.release();
    const outcome = await deadline(call, 'aborted open');

    expectFailure(outcome, 'CANCELLED');
    expect(session.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(deps.handles.count('alice')).toBe(0);
  });

  const badModes: Array<{ args: Record<string, unknown> }> = [
    { args: { mode: 'LIVE' } }, { args: { mode: 7 } }, { args: { mode: null } },
    { args: { write: 'true' } }, { args: { write: 1 } }, { args: { write: null } },
    { args: { view: 'x' } }, { args: { view: ['depth'] } },
  ];

  it.each(badModes)('refuses invalid open flags $args before opening', async ({ args }) => {
    const { deps, dispatch } = fixture();
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', ...args });

    expectFailure(outcome, 'INVALID_ARGS');
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('does not retain a handle or session when its requested first view fails', async () => {
    const { deps, session, dispatch } = fixture();
    vi.mocked(session.read).mockRejectedValueOnce(new McpSurfaceError('SOURCE_UNAVAILABLE', 'Read failed.'));
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', view: { depth: 1 } });

    expectFailure(outcome, 'SOURCE_UNAVAILABLE');
    expect(deps.handles.count('alice')).toBe(0);
    expect(session.close).toHaveBeenCalledExactlyOnceWith('closed');
  });

  it('passes all read arguments except handle and returns the unwrapped view', async () => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1' }));
    const outcome = await invoke(dispatch, 'blok_read', {
      handle, rootId: 'root', ids: ['p1'], depth: 2, detail: 'full', limit: 3, cursor: 'c:p1', textLimit: 40,
    });

    expect(outcome).toEqual({ isError: false, structuredContent: view });
    expect(session.read).toHaveBeenCalledExactlyOnceWith({
      rootId: 'root', ids: ['p1'], depth: 2, detail: 'full', limit: 3, cursor: 'c:p1', textLimit: 40,
    });
  });

  const queries: Array<{ tool?: string; command?: string }> = [{}, { tool: 'paragraph' }, { command: 'block.insert' }];

  it.each(queries)('passes describe query %# without the handle', async query => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1' }));
    const outcome = await invoke(dispatch, 'blok_describe', { handle, ...query });

    expect(outcome).toEqual({ isError: false, structuredContent: index });
    expect(session.describe).toHaveBeenCalledExactlyOnceWith(query);
  });

  it('executes the batch with its revision and returns every result field, without the empty changed lists', async () => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const batch: AgentBatch = {
      commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: [{ text: 'Hello' }] } }, ref: 'created' }],
      expectRevision: 'content-r1',
    };
    const outcome = await invoke(dispatch, 'blok_execute', { handle, ...batch });

    expect(outcome).toEqual({ isError: false, structuredContent: { ...savedResult, changed: { created: ['new-block'] } } });
    expect(session.execute).toHaveBeenCalledExactlyOnceWith(batch);
  });

  it('caps the ids a big delete lists, so one answer stays small', async () => {
    const removed = Array.from({ length: 500 }, (_, i) => `cell-${i}`);
    const deleted: McpExecuteResult = {
      ...savedResult,
      results: [{ removedIds: removed, liftedIds: [] }],
      refs: {},
      changed: { created: [], updated: [], moved: [], removed },
      warnings: [],
    };
    const { dispatch } = fixture(fakeSession({ execute: vi.fn(async () => deleted) }));
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const outcome = await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'block.delete', args: { id: 'table' } }] });

    expect(outcome.structuredContent).toEqual({
      ok: true,
      revision: 'content-r2',
      results: [{ removedIds: removed.slice(0, 50), moreRemovedIds: 450, liftedIds: [] }],
      changed: { removed: removed.slice(0, 50), moreRemoved: 450 },
      lastRange: savedResult.lastRange,
      delivery: savedResult.delivery,
    });
  });

  it('omits expectRevision when the caller did not supply one', async () => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'doc.read', args: {} }] });

    expect(session.execute).toHaveBeenCalledExactlyOnceWith({ commands: [{ name: 'doc.read', args: {} }] });
  });

  it('keeps pending delivery successful instead of inventing a durability timeout error', async () => {
    const pending: McpExecuteResult = {
      ...savedResult,
      delivery: { durable: false, pending: true, serverSequence: null, savedVersion: null },
    };
    const session = fakeSession({ mode: 'live', durability: 'acknowledged', execute: vi.fn(async () => pending) });
    const { dispatch } = fixture(session);
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const outcome = await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'New' } }] });

    expect(outcome).toEqual({ isError: false, structuredContent: { ...pending, changed: { created: ['new-block'] } } });
  });

  it('keeps a failed session result with its revision, warning and rejection delivery', async () => {
    const failed: McpExecuteResult = {
      ok: false,
      revision: 'content-r3',
      error: {
        code: 'REJECTED', message: 'Not saved.', retryable: false,
        details: { rejectionCode: 'oversized-update' },
      },
      warnings: [{ code: 'SANITIZED', message: 'Removed markup.', commandIndex: 0 }],
      delivery: { durable: false, pending: false, serverSequence: 'lineage:8', savedVersion: null },
    };
    const session = fakeSession({ execute: vi.fn(async () => failed) });
    const { dispatch } = fixture(session);
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const outcome = await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'New' } }] });

    expect(outcome).toEqual({ isError: true, structuredContent: failed });
  });

  const handleTools = [
    { name: 'blok_read', args: {} },
    { name: 'blok_describe', args: {} },
    { name: 'blok_execute', args: { commands: [] } },
    { name: 'blok_close', args: {} },
  ];

  it.each(handleTools)('hides another principal from $name and leaves the owner handle usable', async ({ name, args }) => {
    const { deps, session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const outcome = await invoke(dispatch, name, { ...args, handle }, stranger);

    expectFailure(outcome, 'UNKNOWN_HANDLE', name === 'blok_execute');
    expect(deps.stillAllowed).not.toHaveBeenCalled();
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.close).not.toHaveBeenCalled();
    expect(deps.handles.count('alice')).toBe(1);
    expect((await invoke(dispatch, 'blok_read', { handle })).isError).toBe(false);
  });

  it.each(handleTools)('returns the proper UNKNOWN_HANDLE branch for $name', async ({ name, args }) => {
    const { deps, dispatch } = fixture();
    const outcome = await invoke(dispatch, name, { ...args, handle: 'missing' });

    expectFailure(outcome, 'UNKNOWN_HANDLE', name === 'blok_execute');
    expect(deps.stillAllowed).not.toHaveBeenCalled();
    if (name === 'blok_execute') {
      expect(outcome.structuredContent.delivery).toEqual(NO_DELIVERY);
    }
  });

  const malformedHandles: unknown[] = [undefined, null, '', 42];

  describe.each(handleTools)('$name handle validation', ({ name, args }) => {
    it.each(malformedHandles)('refuses malformed handle %# before any session call', async handle => {
      const { deps, session, dispatch } = fixture();
      const outcome = await invoke(dispatch, name, { ...args, ...(handle !== undefined && { handle }) });

      expectFailure(outcome, 'INVALID_ARGS', name === 'blok_execute');
      expect(deps.stillAllowed).not.toHaveBeenCalled();
      expect(session.read).not.toHaveBeenCalled();
      expect(session.describe).not.toHaveBeenCalled();
      expect(session.execute).not.toHaveBeenCalled();
      expect(session.close).not.toHaveBeenCalled();
    });
  });

  const malformedDocuments: unknown[] = [null, '', 42, 'd'.repeat(513)];

  it.each(malformedDocuments)('refuses malformed documentId %# before opening', async documentId => {
    const { deps, dispatch } = fixture();
    const outcome = await invoke(dispatch, 'blok_open', { ...(documentId !== undefined && { documentId }) });

    expectFailure(outcome, 'INVALID_ARGS');
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.handles.count('alice')).toBe(0);
  });

  it('accepts the maximum documentId length without changing it', async () => {
    const { deps, dispatch } = fixture();
    const documentId = 'd'.repeat(512);
    const outcome = await invoke(dispatch, 'blok_open', { documentId });

    expect(outcome.isError).toBe(false);
    expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId, mode: 'auto', write: false }, stdio);
  });

  describe('blok_open without a documentId', () => {
    const one = { documents: [{ id: 'doc-7', title: 'Plan', live: false }], nextCursor: null, supported: true };
    const two = {
      documents: [{ id: 'doc-7', title: 'Plan', live: false }, { id: 'doc-8', title: 'Notes', live: false }],
      nextCursor: null,
      supported: true,
    };

    it('opens the only document and says which one, so the model needs no listing call', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce(one);
      const outcome = await invoke(dispatch, 'blok_open', { write: true, view: {} });
      const handle = handleFrom(outcome);

      expect(outcome.structuredContent).toMatchObject({ handle, documentId: 'doc-7', title: 'Plan', view: expect.any(Object) });
      expect(deps.list).toHaveBeenCalledExactlyOnceWith({ limit: 25 }, stdio);
      expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-7', mode: 'auto', write: true }, stdio);
      await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'block.insert', args: {} }] });
      expect(deps.stillAllowed).toHaveBeenCalledWith(stdio, 'doc-7', true);
    });

    it('passes query to the listing and opens the match whose title equals it', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce(one);
      const outcome = await invoke(dispatch, 'blok_open', { query: 'plan' });

      expect(outcome.structuredContent).toMatchObject({ documentId: 'doc-7' });
      expect(deps.list).toHaveBeenCalledExactlyOnceWith({ query: 'plan', limit: 25 }, stdio);
    });

    it('opens nothing when the query missed, even if only one document exists', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce({ documents: [], nextCursor: null, supported: true }).mockResolvedValueOnce(one);
      const outcome = await invoke(dispatch, 'blok_open', { write: true, query: 'budget' });

      expect(outcome).toEqual({ isError: false, structuredContent: { ...one, queryMatched: false } });
      expect(deps.open).not.toHaveBeenCalled();
    });

    it('opens nothing when the only match contains the query but does not equal it', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce(one);
      const outcome = await invoke(dispatch, 'blok_open', { write: true, query: 'Pla' });

      expect(outcome).toEqual({ isError: false, structuredContent: one });
      expect(deps.open).not.toHaveBeenCalled();
    });

    it('treats a blank query as no query', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce(one);
      const outcome = await invoke(dispatch, 'blok_open', { query: '  ' });

      expect(outcome.structuredContent).toMatchObject({ documentId: 'doc-7', title: 'Plan' });
      expect(deps.list).toHaveBeenCalledExactlyOnceWith({ limit: 25 }, stdio);
    });

    it('returns the documents to choose from and opens nothing when several match', async () => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValueOnce(two);
      const outcome = await invoke(dispatch, 'blok_open', { write: true });

      expect(outcome).toEqual({ isError: false, structuredContent: two });
      expect(deps.open).not.toHaveBeenCalled();
      expect(deps.handles.count('alice')).toBe(0);
    });

    it.each([
      { documents: [{ id: 'doc-7', title: 'Plan', live: false }], nextCursor: 'more', supported: true },
      { documents: [], nextCursor: null, supported: true },
      { documents: [], nextCursor: null, supported: false },
    ])('opens nothing for listing %j', async (listing) => {
      const { deps, dispatch } = fixture();
      vi.mocked(deps.list).mockResolvedValue(listing);
      const outcome = await invoke(dispatch, 'blok_open', {});

      expect(outcome.isError).toBe(false);
      expect(outcome.structuredContent).not.toHaveProperty('handle');
      expect(outcome.structuredContent.documents).toEqual(listing.documents);
      expect(deps.open).not.toHaveBeenCalled();
    });

    it('ignores query when a documentId is given', async () => {
      const { deps, dispatch } = fixture();
      const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', query: 'plan' });

      expect(outcome.structuredContent).not.toHaveProperty('documentId');
      expect(deps.list).not.toHaveBeenCalled();
      expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1', mode: 'auto', write: false }, stdio);
    });

    it('refuses a non-string query and needs the read scope to search', async () => {
      const { deps, dispatch } = fixture();

      expectFailure(await invoke(dispatch, 'blok_open', { query: 5 }), 'INVALID_ARGS');
      expectFailure(await invoke(dispatch, 'blok_open', { write: true }, writer), 'FORBIDDEN');
      expect(deps.list).not.toHaveBeenCalled();
    });
  });

  const malformedEntries: unknown[] = [null, 'doc.read', ['doc.read'], {}, { name: 7 }, { name: null }];

  // Core's checkEnvelope refuses them, naming every bad entry, as it does for Ask AI.
  it.each(malformedEntries)('passes command entry %j through for core to refuse', async entry => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const commands = [{ name: 'doc.read', args: {} }, entry];

    await invoke(dispatch, 'blok_execute', { handle, commands });

    expect(session.execute).toHaveBeenCalledExactlyOnceWith({ commands });
  });

  it.each([5, null, false])('passes non-string expectRevision %j through for core to refuse', async expectRevision => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    await invoke(dispatch, 'blok_execute', { handle, expectRevision, commands: [] });

    expect(session.execute).toHaveBeenCalledExactlyOnceWith({ commands: [], expectRevision });
  });

  const malformedCommands: unknown[] = [undefined, null, 'not-an-array', {}, 42];

  it.each(malformedCommands)('passes non-array commands %# through for core to refuse', async commands => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const batch = commands === undefined ? {} : { commands };

    await invoke(dispatch, 'blok_execute', { handle, ...batch });

    expect(session.execute).toHaveBeenCalledExactlyOnceWith(batch);
  });

  const scopedTools = [
    { name: 'blok_list_documents', args: {}, scope: 'blok.read', caller: writer },
    { name: 'blok_open', args: { documentId: 'doc-1' }, scope: 'blok.read', caller: writer },
    { name: 'blok_read', args: {}, scope: 'blok.read', caller: writer },
    { name: 'blok_describe', args: {}, scope: 'blok.read', caller: writer },
    { name: 'blok_close', args: {}, scope: 'blok.read', caller: writer },
    { name: 'blok_open', args: { documentId: 'doc-1', write: true }, scope: 'blok.write', caller: reader },
    { name: 'blok_execute', args: { commands: [] }, scope: 'blok.write', caller: reader },
  ];

  it.each(scopedTools)('requires $scope for $name %# without invoking a dependency', async ({ name, args, scope, caller }) => {
    const { deps, session, dispatch } = fixture();
    const handle = deps.handles.add('alice', 'doc-1', session);
    const outcome = await invoke(dispatch, name, { ...args, ...(name !== 'blok_open' && name !== 'blok_list_documents' && { handle }) }, caller);

    expectFailure(outcome, 'FORBIDDEN', name === 'blok_execute');
    expect(outcome.structuredContent).toMatchObject({
      error: { code: 'FORBIDDEN', details: { requiredScope: scope } },
    });
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.stillAllowed).not.toHaveBeenCalled();
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.close).not.toHaveBeenCalled();
    expect(deps.handles.count('alice')).toBe(1);
  });

  it('lets a read-scoped caller open and use a read-only handle', async () => {
    const { deps, session, dispatch } = fixture(fakeSession({ write: false }));
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1' }, reader));
    const outcome = await invoke(dispatch, 'blok_read', { handle }, reader);

    expect(outcome).toEqual({ isError: false, structuredContent: view });
    expect(deps.open).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1', mode: 'auto', write: false }, reader);
    expect(deps.stillAllowed).toHaveBeenCalledExactlyOnceWith(reader, 'doc-1', false);
    expect(session.execute).not.toHaveBeenCalled();
  });

  it('lets a write-only caller open for writing and execute without requiring blok.read', async () => {
    const { deps, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }, writer));
    const outcome = await invoke(dispatch, 'blok_execute', { handle, commands: [{ name: 'doc.setTitle', args: { title: 'New' } }] }, writer);

    expect(outcome.isError).toBe(false);
    expect(deps.stillAllowed).toHaveBeenCalledExactlyOnceWith(writer, 'doc-1', true);
  });

  it.each(handleTools)('re-checks document access before $name, including close', async ({ name, args }) => {
    const { deps, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const outcome = await invoke(dispatch, name, { ...args, handle });

    expect(outcome.isError).toBe(false);
    expect(deps.stillAllowed).toHaveBeenCalledExactlyOnceWith(stdio, 'doc-1', name === 'blok_execute');
  });

  it.each(handleTools)('does not call $name after document access is revoked', async ({ name, args }) => {
    const { deps, session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    vi.mocked(deps.stillAllowed).mockResolvedValueOnce(false);
    const outcome = await invoke(dispatch, name, { ...args, handle });

    expectFailure(outcome, 'FORBIDDEN', name === 'blok_execute');
    expect(session.read).not.toHaveBeenCalled();
    expect(session.describe).not.toHaveBeenCalled();
    expect(session.execute).not.toHaveBeenCalled();
    expect(session.close).not.toHaveBeenCalled();
    expect(deps.handles.count('alice')).toBe(1);
    expect((await invoke(dispatch, 'blok_read', { handle })).isError).toBe(false);
  });

  it('re-checks access again for a second call on the same handle', async () => {
    const { deps, session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    await invoke(dispatch, 'blok_read', { handle });
    vi.mocked(deps.stillAllowed).mockResolvedValueOnce(false);
    const second = await invoke(dispatch, 'blok_read', { handle });

    expectFailure(second, 'FORBIDDEN');
    expect(deps.stillAllowed).toHaveBeenCalledTimes(2);
    expect(session.read).toHaveBeenCalledTimes(1);
  });

  it('closes once, returns unsaved work, and forgets the handle', async () => {
    const session = fakeSession({ close: vi.fn(async () => ({ unsavedBatches: 2, hostRecordLags: true })) });
    const { deps, dispatch } = fixture(session);
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1' }));
    const outcome = await invoke(dispatch, 'blok_close', { handle });

    expect(outcome).toEqual({ isError: false, structuredContent: { closed: true, unsavedBatches: 2, hostRecordLags: true } });
    expect(session.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(deps.handles.count('alice')).toBe(0);
    expectFailure(await invoke(dispatch, 'blok_read', { handle }), 'UNKNOWN_HANDLE');
    expectFailure(await invoke(dispatch, 'blok_close', { handle }), 'UNKNOWN_HANDLE');
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('does not close before the running and already queued reads finish', async () => {
    const { session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1' }));
    const firstStarted = barrier();
    const firstHeld = barrier();
    const secondStarted = barrier();
    const secondHeld = barrier();
    const order: string[] = [];
    vi.mocked(session.read)
      .mockImplementationOnce(async () => {
        order.push('first:start');
        firstStarted.release();
        await firstHeld.wait;
        order.push('first:end');

        return view;
      })
      .mockImplementationOnce(async () => {
        order.push('second:start');
        secondStarted.release();
        await secondHeld.wait;
        order.push('second:end');

        return view;
      });
    vi.mocked(session.close).mockImplementationOnce(async () => {
      order.push('close');

      return { unsavedBatches: 0, hostRecordLags: false };
    });

    try {
      const first = invoke(dispatch, 'blok_read', { handle });
      await deadline(firstStarted.wait, 'first read start');
      const second = invoke(dispatch, 'blok_read', { handle });
      const close = invoke(dispatch, 'blok_close', { handle });
      await deadline(dispatchCheckpoint(), 'held queue checkpoint');

      expect(order).toEqual(['first:start']);
      expect(session.close).not.toHaveBeenCalled();
      firstHeld.release();
      await deadline(secondStarted.wait, 'queued read start');
      await deadline(dispatchCheckpoint(), 'second held queue checkpoint');

      expect(order).toEqual(['first:start', 'first:end', 'second:start']);
      expect(session.close).not.toHaveBeenCalled();
      secondHeld.release();
      const outcomes = await deadline(Promise.all([first, second, close]), 'queued read and close results');

      expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end', 'close']);
      expect(outcomes.map(outcome => outcome.isError)).toEqual([false, false, false]);
      expectFailure(await invoke(dispatch, 'blok_read', { handle }), 'UNKNOWN_HANDLE');
    } finally {
      firstHeld.release();
      secondHeld.release();
    }
  });

  it('checks queued execute permission after the running read releases the handle', async () => {
    const { deps, session, dispatch } = fixture();
    const handle = handleFrom(await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true }));
    const started = barrier();
    const held = barrier();
    vi.mocked(session.read).mockImplementationOnce(async () => {
      started.release();
      await held.wait;

      return view;
    });

    try {
      const read = invoke(dispatch, 'blok_read', { handle });
      await deadline(started.wait, 'read start');
      const execute = invoke(dispatch, 'blok_execute', { handle, commands: [] });
      vi.mocked(deps.stillAllowed).mockResolvedValue(false);
      await deadline(dispatchCheckpoint(), 'queued authorization checkpoint');

      expect(deps.stillAllowed).toHaveBeenCalledTimes(1);
      expect(session.execute).not.toHaveBeenCalled();
      held.release();
      expectFailure(await execute, 'FORBIDDEN', true);
      expect((await read).isError).toBe(false);
      expect(deps.stillAllowed).toHaveBeenNthCalledWith(2, stdio, 'doc-1', true);
      expect(session.execute).not.toHaveBeenCalled();
    } finally {
      held.release();
    }
  });

  const limits: Array<{ input?: number; expected: number }> = [
    { expected: 25 }, { input: 0, expected: 1 }, { input: -4, expected: 1 },
    { input: 3.9, expected: 3 }, { input: 100, expected: 100 }, { input: 500, expected: 100 },
  ];

  it.each(limits)('lists with normalized limit $expected for input $input', async ({ input, expected }) => {
    const { deps, dispatch } = fixture();
    const outcome = await invoke(dispatch, 'blok_list_documents', { ...(input !== undefined && { limit: input }) });

    expect(outcome).toEqual({
      isError: false,
      structuredContent: {
        documents: [{ id: 'doc-1', title: null, live: false }],
        nextCursor: 'next-doc',
        supported: true,
      },
    });
    expect(deps.list).toHaveBeenCalledExactlyOnceWith({ limit: expected }, stdio);
  });

  it.each([{ limit: 'x' }, { query: 5 }, { cursor: 5 }])('refuses listing argument %j instead of dropping it', async (args) => {
    const { deps, dispatch } = fixture();

    expectFailure(await invoke(dispatch, 'blok_list_documents', args), 'INVALID_ARGS');
    expect(deps.list).not.toHaveBeenCalled();
  });

  it('preserves listing filters and an unsupported empty listing result', async () => {
    const { deps, dispatch } = fixture();
    vi.mocked(deps.list).mockResolvedValueOnce({ documents: [], nextCursor: null, supported: false });
    const outcome = await invoke(dispatch, 'blok_list_documents', { query: 'Notes', cursor: 'next-doc', limit: 7 });

    expect(outcome).toEqual({ isError: false, structuredContent: { documents: [], nextCursor: null, supported: false } });
    expect(deps.list).toHaveBeenCalledExactlyOnceWith({ query: 'Notes', cursor: 'next-doc', limit: 7 }, stdio);
  });

  it('lists every document when a query matches none, so the model need not list again', async () => {
    const { deps, dispatch } = fixture();
    vi.mocked(deps.list).mockResolvedValueOnce({ documents: [], nextCursor: null, supported: true });
    const outcome = await invoke(dispatch, 'blok_list_documents', { query: 'budget', limit: 7 });

    expect(outcome).toEqual({
      isError: false,
      structuredContent: {
        documents: [{ id: 'doc-1', title: null, live: false }], nextCursor: 'next-doc', supported: true, queryMatched: false,
      },
    });
    expect(deps.list).toHaveBeenNthCalledWith(2, { limit: 7 }, stdio);
  });

  it('keeps an empty page of a query listing it is paging through', async () => {
    const { deps, dispatch } = fixture();
    vi.mocked(deps.list).mockResolvedValueOnce({ documents: [], nextCursor: null, supported: true });
    const outcome = await invoke(dispatch, 'blok_list_documents', { query: 'budget', cursor: 'next-doc' });

    expect(outcome).toEqual({ isError: false, structuredContent: { documents: [], nextCursor: null, supported: true } });
    expect(deps.list).toHaveBeenCalledOnce();
  });

  const stages: Array<'open' | 'list' | 'read' | 'describe' | 'execute' | 'close' | 'authorize'> = [
    'open', 'list', 'read', 'describe', 'execute', 'close', 'authorize',
  ];

  const injectFailure = (deps: DispatcherDeps, session: HandleSession, stage: typeof stages[number], error: unknown): void => {
    switch (stage) {
      case 'open':
        vi.mocked(deps.open).mockRejectedValueOnce(error);
        break;
      case 'list':
        vi.mocked(deps.list).mockRejectedValueOnce(error);
        break;
      case 'read':
        vi.mocked(session.read).mockRejectedValueOnce(error);
        break;
      case 'describe':
        vi.mocked(session.describe).mockImplementationOnce(() => { throw error; });
        break;
      case 'execute':
        vi.mocked(session.execute).mockRejectedValueOnce(error);
        break;
      case 'close':
        vi.mocked(session.close).mockRejectedValueOnce(error);
        break;
      case 'authorize':
        vi.mocked(deps.stillAllowed).mockRejectedValueOnce(error);
        break;
    }
  };

  const requestForStage = (stage: typeof stages[number], handle: string) => {
    switch (stage) {
      case 'open':
        return { name: 'blok_open', args: { documentId: 'doc-1' } };
      case 'list':
        return { name: 'blok_list_documents', args: {} };
      case 'authorize':
        return { name: 'blok_read', args: { handle } };
      case 'execute':
        return { name: 'blok_execute', args: { handle, commands: [] } };
      case 'read':
      case 'describe':
      case 'close':
        return { name: `blok_${stage}`, args: { handle } };
    }
  };

  it.each(stages)('converts a real McpSurfaceError thrown by %s into the right error branch', async stage => {
    const { deps, session, dispatch } = fixture();
    const handle = deps.handles.add('alice', 'doc-1', session);
    const error = new McpSurfaceError('SOURCE_UNAVAILABLE', 'Unavailable.', { stage });
    injectFailure(deps, session, stage, error);
    const request = requestForStage(stage, handle);
    const outcome = await invoke(dispatch, request.name, request.args);

    expectFailure(outcome, 'SOURCE_UNAVAILABLE', stage === 'execute');
    expect(outcome.structuredContent.error).toEqual({
      code: 'SOURCE_UNAVAILABLE', message: 'Unavailable.', retryable: true, details: { stage },
    });
  });

  it.each(stages)('converts a core AgentFailure thrown by %s into the right error branch', async stage => {
    const { deps, session, dispatch } = fixture();
    const handle = deps.handles.add('alice', 'doc-1', session);
    const error = failure('INVALID_ARGS', 'detail: must be one of the allowed values', { path: '/detail' });
    injectFailure(deps, session, stage, error);
    const request = requestForStage(stage, handle);
    const outcome = await invoke(dispatch, request.name, request.args);

    expectFailure(outcome, 'INVALID_ARGS', stage === 'execute');
    expect(outcome.structuredContent.error).toEqual(error.error);
  });

  it('preserves a factory-created stored-mode refusal from the opener', async () => {
    const { deps, dispatch } = fixture();
    vi.mocked(deps.open).mockRejectedValueOnce(surfaceError('STORED_WRITE_FORBIDDEN', 'The live room owns this document.'));
    const outcome = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', mode: 'stored', write: true });

    expect(outcome).toEqual({
      isError: true,
      structuredContent: {
        error: { code: 'STORED_WRITE_FORBIDDEN', message: 'The live room owns this document.', retryable: false },
      },
    });
    expect(deps.handles.count('alice')).toBe(0);
  });

  const unexpected: unknown[] = [
    new TypeError('implementation bug'),
    { name: 'McpSurfaceError', message: 'not nominal', agentError: { code: 'FORBIDDEN', message: 'not nominal', retryable: false } },
  ];

  describe.each(stages)('unexpected %s errors', stage => {
    it.each(unexpected)('lets unexpected value %# escape unchanged', async error => {
      const { deps, session, dispatch } = fixture();
      const handle = deps.handles.add('alice', 'doc-1', session);
      injectFailure(deps, session, stage, error);
      const request = requestForStage(stage, handle);

      await expect(invoke(dispatch, request.name, request.args)).rejects.toBe(error);
    });
  });

  it('throws UnknownToolError instead of converting an unknown name to a tool result', async () => {
    const { deps, dispatch } = fixture();

    await expect(invoke(dispatch, 'blok_delete_everything', {})).rejects.toBeInstanceOf(UnknownToolError);
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.stillAllowed).not.toHaveBeenCalled();
  });

  it('routes commands and views through a real headless document session', async () => {
    const setup = createHeadlessAgentSetup({ runtime: 'node' });
    const agent = createDocumentAgentSession({
      document: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Hello' }] } }] },
      tools: setup.tools,
      contract: setup.contract,
      ports: setup.ports,
      actor: { id: 'agent:alice:test', name: 'Test agent', kind: 'agent', onBehalfOf: 'alice' },
    });
    sessions.push(agent);
    const session: HandleSession = {
      mode: 'stored',
      write: true,
      durability: 'saved-on-execute',
      contractRevision: setup.contract.revision,
      read: args => agent.read(args),
      describe: query => agent.describe(query),
      execute: async batch => ({
        ...await agent.execute(batch),
        delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null },
      }),
      close: async () => {
        agent.close();

        return { unsavedBatches: 0, hostRecordLags: false };
      },
    };
    const { dispatch } = fixture(session);
    const opened = await invoke(dispatch, 'blok_open', { documentId: 'doc-1', write: true, view: { detail: 'full' } });
    const handle = handleFrom(opened);
    const executed = await invoke(dispatch, 'blok_execute', {
      handle, commands: [{ name: 'doc.setTitle', args: { title: 'Updated notes' } }],
    });
    const read = await invoke(dispatch, 'blok_read', { handle, detail: 'full' });

    expect(read.structuredContent).toMatchObject({
      rootId: null,
      page: { title: 'Updated notes' },
      blocks: [{ id: 'p1', type: 'paragraph', depth: 0, data: { text: [{ text: 'Hello' }] } }],
    });
    expect(read.isError).toBe(false);
    expect(executed).toMatchObject({
      isError: false,
      structuredContent: {
        ok: true,
        delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null },
      },
    });
    expect(agent.output().title).toBe('Updated notes');
    expect(opened.structuredContent.view).toMatchObject({ rootId: null, blocks: [{ id: 'p1', text: 'Hello' }] });
    expect((await invoke(dispatch, 'blok_describe', { handle, command: 'doc.setTitle' })).structuredContent)
      .toMatchObject({ command: { name: 'doc.setTitle', available: true } });
    expect((await invoke(dispatch, 'blok_close', { handle })).isError).toBe(false);
  });
});
