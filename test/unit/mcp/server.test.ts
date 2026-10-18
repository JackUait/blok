// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as dispatchCheckpoint } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import { McpSurfaceError } from '../../../src/mcp/errors';
import { assembleMcp } from '../../../src/mcp/server';
import { listMcpTools } from '../../../src/mcp/tools';

import type { Caller } from '../../../src/mcp/dispatcher';
import type { BlokMcpOptions } from '../../../src/mcp/options';
import type { AssembledMcp } from '../../../src/mcp/server';
import type { HandleSession, McpExecuteResult } from '../../../src/mcp/session';
import type * as StoredSessionModule from '../../../src/mcp/stored-session';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

const caller: Caller = { principal: 'alice', clientName: 'test', scopes: null };

// Lets a test hold the close of the stored session opened for one document.
const slowClose = vi.hoisted(() => ({ documentId: null as string | null, gate: Promise.resolve(), started: false, done: false }));

vi.mock('../../../src/mcp/stored-session', async (importOriginal) => {
  const actual = await importOriginal<typeof StoredSessionModule>();

  return {
    ...actual,
    openStoredSession: async (input: StoredSessionModule.StoredSessionInput): Promise<HandleSession> => {
      const opened = await actual.openStoredSession(input);

      if (input.documentId !== slowClose.documentId) {
        return opened;
      }

      return {
        ...opened,
        close: async (reason) => {
          slowClose.started = true;
          await slowClose.gate;
          const summary = await opened.close(reason);

          slowClose.done = true;

          return summary;
        },
      };
    },
  };
});
const owned: AssembledMcp[] = [];

const within = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Assembly fixture deadline exceeded')), 5_000);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

const assemble = (extra: Partial<BlokMcpOptions> = {}): AssembledMcp => {
  const server = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, ...extra });

  owned.push(server);

  return server;
};

const session = (close = vi.fn<HandleSession['close']>(async () => ({
  unsavedBatches: 0,
  hostRecordLags: false,
}))) => {
  const result: McpExecuteResult = {
    ok: true,
    revision: 'r2',
    results: [],
    refs: {},
    changed: { created: [], updated: [], moved: [], removed: [] },
    warnings: [],
    delivery: { durable: true, pending: false, serverSequence: null, savedVersion: 'v2' },
  };
  const value: HandleSession = {
    mode: 'stored',
    write: true,
    durability: 'saved-on-execute',
    contractRevision: 'contract-r1',
    read: vi.fn<HandleSession['read']>(async () => ({ revision: 'r1', rootId: null, blocks: [] })),
    describe: vi.fn<HandleSession['describe']>(() => ({ index: { tools: [], commands: [], guidance: '' } })),
    execute: vi.fn<HandleSession['execute']>(async () => result),
    close,
  };

  return value;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  try {
    const stopped = await within(Promise.allSettled(owned.splice(0).map(server => server.stop())));

    expect(stopped.every(result => result.status === 'fulfilled')).toBe(true);
  } finally {
    vi.restoreAllMocks();
  }
});

describe('assembleMcp', () => {
  it('reports a fixable source error without opening a handle', async () => {
    const server = assemble();
    const outcome = await within(server.dispatch('blok_open', { documentId: 'notes', mode: 'stored' }, caller));

    expect(outcome).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'SOURCE_UNAVAILABLE', retryable: true } },
    });
    expect(server.handles.count('alice')).toBe(0);
  });

  it('reports that the placeholder source cannot list documents', async () => {
    const server = assemble();

    expect(await within(server.dispatch('blok_list_documents', {}, caller))).toEqual({
      structuredContent: { documents: [], nextCursor: null, supported: false },
      isError: false,
    });
  });

  it('passes deployment schema, manifest, override and idle options to the real tool list', () => {
    const manifest: BlokCustomToolsFile = { formatVersion: 1, blocks: [] };
    const overrides: ManifestOverrides = { paragraph: { guidance: 'Keep paragraphs short.' } };
    const server = assemble({ manifest, overrides, schema: 'full', handleIdleMs: 123_456 });
    const contracts = buildMcpContracts({ manifest, overrides, pageTitles: 'off' });

    expect(server.tools).toEqual(listMcpTools(contracts.stored, { schema: 'full', handleIdleMs: 123_456 }));
  });

  it('sends the mixed schema when the deployment names none, so common commands need no describe call', () => {
    const server = assemble();
    const contracts = buildMcpContracts({ pageTitles: 'off' });

    expect(server.tools).toEqual(listMcpTools(contracts.stored, { schema: 'mixed', handleIdleMs: 600_000 }));
  });

  it('says blok_list_documents query matches ids and titles, so a model does not search text with it and list again', () => {
    const list = listMcpTools(buildMcpContracts({ pageTitles: 'off' }).stored, { schema: 'mixed', handleIdleMs: 600_000 })
      .find((tool) => tool.name === 'blok_list_documents');
    const field = (value: unknown, key: string): unknown =>
      typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
    const found = field(field(field(list?.inputSchema, 'properties'), 'query'), 'description');
    const description = typeof found === 'string' ? found : '';

    expect(description).toMatch(/id or title/i);
    expect(description).toMatch(/not .*text/i);
  });

  it('wires the host authorizer with the principal, document and write intent', async () => {
    const authorize = vi.fn<NonNullable<BlokMcpOptions['authorize']>>(async () => true);
    const server = assemble({ authorize });
    const handleSession = session();
    const handle = server.handles.add('alice', 'notes', handleSession);

    await within(server.dispatch('blok_read', { handle }, caller));
    await within(server.dispatch('blok_execute', {
      handle,
      commands: [{ name: 'doc.setTitle', args: { title: 'Notes' } }],
    }, caller));

    expect(authorize.mock.calls).toEqual([['alice', 'notes', false], ['alice', 'notes', true]]);
    expect(handleSession.read).toHaveBeenCalledTimes(1);
    expect(handleSession.execute).toHaveBeenCalledTimes(1);
  });

  it('uses the configured per-principal handle limit', () => {
    const server = assemble({ maxHandlesPerPrincipal: 1 });

    server.handles.add('alice', 'notes', session());
    expect(() => server.handles.add('alice', 'other', session())).toThrow(McpSurfaceError);
    expect(server.handles.count('alice')).toBe(1);
  });

  it('stops every principal-owned session once', async () => {
    const server = assemble();
    const alice = session();
    const bob = session();

    server.handles.add('alice', 'a', alice);
    server.handles.add('bob', 'b', bob);
    await within(server.stop());

    expect(alice.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(bob.close).toHaveBeenCalledExactlyOnceWith('closed');
    expect(server.handles.count('alice')).toBe(0);
    expect(server.handles.count('bob')).toBe(0);
    await within(server.stop());
    expect(alice.close).toHaveBeenCalledTimes(1);
    expect(bob.close).toHaveBeenCalledTimes(1);
  });

  it('expires idle sessions and stops its sweeper on shutdown', async () => {
    let markExpired: (() => void) | undefined;
    const expired = new Promise<void>(resolve => {
      markExpired = resolve;
    });

    if (markExpired === undefined) {
      throw new Error('Expiration barrier was not initialized');
    }
    const releaseExpired = markExpired;
    const close = vi.fn<HandleSession['close']>(async reason => {
      if (reason === 'expired') {
        releaseExpired();
      }

      return { unsavedBatches: 0, hostRecordLags: false };
    });
    const server = assemble({ handleIdleMs: 20 });
    const sweep = vi.spyOn(server.handles, 'sweep');

    server.handles.add('alice', 'notes', session(close));
    await within(expired);
    expect(close).toHaveBeenCalledExactlyOnceWith('expired');
    await within(server.stop());
    const callsAtStop = sweep.mock.calls.length;

    await within(new Promise<void>(resolve => setTimeout(resolve, 60)));
    expect(sweep).toHaveBeenCalledTimes(callsAtStop);
    expect(server.handles.count('alice')).toBe(0);
  });
});

describe('assembleMcp idle sweep failures', () => {
  it('logs a failed expiry close to stderr and still closes the other idle session', async () => {
    const logged = new Promise<void>(resolve => {
      vi.spyOn(console, 'error').mockImplementation(() => {
        resolve();
      });
    });
    let markClosed: (() => void) | undefined;
    const otherClosed = new Promise<void>(resolve => {
      markClosed = resolve;
    });
    const failing = vi.fn<HandleSession['close']>(async reason => {
      if (reason === 'expired') {
        throw new Error('room close failed');
      }

      return { unsavedBatches: 0, hostRecordLags: false };
    });
    const other = vi.fn<HandleSession['close']>(async () => {
      markClosed?.();

      return { unsavedBatches: 0, hostRecordLags: false };
    });
    const server = assemble({ handleIdleMs: 20 });

    server.handles.add('alice', 'first', session(failing));
    server.handles.add('alice', 'second', session(other));
    await within(Promise.all([logged, otherClosed]));

    expect(failing).toHaveBeenCalledExactlyOnceWith('expired');
    expect(other).toHaveBeenCalledExactlyOnceWith('expired');
    expect(console.error).toHaveBeenCalledWith('blok-mcp: closing an idle handle failed', expect.any(Error));
    expect(server.handles.count('alice')).toBe(0);
  });
});

const expiryBarrier = () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });

  if (release === undefined) {
    throw new Error('Expiry barrier was not initialized');
  }

  return { wait, release };
};

const stopExpiryServer = async (server: AssembledMcp | undefined): Promise<void> => {
  if (server !== undefined) {
    await within(server.stop());
  }
};

describe('assembleMcp shutdown during expiry', () => {
  it('waits for an already removed idle session to close and drains remaining handles', async () => {
    const expiryStarted = expiryBarrier();
    const expiryRelease = expiryBarrier();
    const acceptedStarted = expiryBarrier();
    const acceptedRelease = expiryBarrier();
    const work: Promise<void>[] = [];
    let acceptedDone = false;
    let stopped = false;
    let server: AssembledMcp | undefined;
    const acceptedAtClose: boolean[] = [];
    const closeExpired = vi.fn<HandleSession['close']>(async reason => {
      if (reason === 'expired') {
        expiryStarted.release();
        await expiryRelease.wait;
      }

      return { unsavedBatches: 0, hostRecordLags: false };
    });
    const closeRemaining = vi.fn<HandleSession['close']>(async () => {
      acceptedAtClose.push(acceptedDone);

      return { unsavedBatches: 0, hostRecordLags: false };
    });

    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(0));
    try {
      const assembled = assemble({ handleIdleMs: 1000 });

      server = assembled;
      assembled.handles.add('alice', 'expired-notes', session(closeExpired));
      vi.advanceTimersByTime(2001);
      await within(expiryStarted.wait);
      const expiredCountBeforeStop = assembled.handles.count('alice');
      const remaining = assembled.handles.add('bob', 'remaining-notes', session(closeRemaining));
      const accepted = assembled.handles.use(remaining, 'bob', async () => {
        acceptedStarted.release();
        await acceptedRelease.wait;
        acceptedDone = true;
      });

      work.push(accepted);
      void accepted.catch(() => undefined);
      await within(acceptedStarted.wait);
      const stopping = assembled.stop().then(() => { stopped = true; });

      work.push(stopping);
      void stopping.catch(() => undefined);
      acceptedRelease.release();
      await within(accepted);
      await within(dispatchCheckpoint());
      expect(stopped).toBe(false);
      expect(expiredCountBeforeStop).toBe(0);
      expiryRelease.release();
      await within(stopping);
      expect(acceptedAtClose).toEqual([true]);
      expect(closeExpired).toHaveBeenCalledExactlyOnceWith('expired');
      expect(closeRemaining).toHaveBeenCalledExactlyOnceWith('closed');
      expect(assembled.handles.count('alice')).toBe(0);
      expect(assembled.handles.count('bob')).toBe(0);
    } finally {
      expiryRelease.release();
      acceptedRelease.release();
      try {
        await within(Promise.allSettled(work));
        await stopExpiryServer(server);
      } finally {
        vi.useRealTimers();
      }
    }
  });
});

describe('assembleMcp shutdown during an open', () => {
  it('waits for an open that lands after stop to close its session', async () => {
    const openCalled = expiryBarrier();
    const openRelease = expiryBarrier();
    const closeRelease = expiryBarrier();
    let closeDone = false;
    let stopped = false;
    const close = vi.fn<HandleSession['close']>(async () => {
      await closeRelease.wait;
      closeDone = true;

      return { unsavedBatches: 0, hostRecordLags: false };
    });
    const opened = session(close);
    const server = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' } }, {
      open: async () => {
        openCalled.release();
        await openRelease.wait;

        return opened;
      },
    });

    owned.push(server);
    try {
      const outcome = server.dispatch('blok_open', { documentId: 'notes', mode: 'stored' }, caller);

      void outcome.catch(() => undefined);
      await within(openCalled.wait);
      const stopping = server.stop().then(() => { stopped = true; });

      openRelease.release();
      await within(dispatchCheckpoint());
      expect(stopped).toBe(false);
      closeRelease.release();
      await within(stopping);
      expect(closeDone).toBe(true);
      expect(close).toHaveBeenCalledExactlyOnceWith('closed');
      expect(await within(outcome)).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'SOURCE_UNAVAILABLE' } },
      });
    } finally {
      openRelease.release();
      closeRelease.release();
    }
  });

  it('stops within a deadline when an open never settles', async () => {
    const openCalled = expiryBarrier();
    const openRelease = expiryBarrier();
    let stopped = false;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const server = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' } }, {
      open: async () => {
        openCalled.release();
        await openRelease.wait;

        return session();
      },
    });

    owned.push(server);
    try {
      void server.dispatch('blok_open', { documentId: 'notes', mode: 'stored' }, caller).catch(() => undefined);
      await openCalled.wait;
      void server.stop().then(() => { stopped = true; });

      // Above the 15 s room sync, a slow open is still waited for.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
      openRelease.release();
    }
  });

  it('stops within a deadline when an open handle never finishes closing', async () => {
    let stopped = false;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const server = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' } }, {
      open: async () => session(vi.fn<HandleSession['close']>(() => new Promise(() => undefined))),
    });

    owned.push(server);
    try {
      expect((await server.dispatch('blok_open', { documentId: 'notes', mode: 'stored' }, caller)).isError).toBe(false);
      void server.stop().then(() => { stopped = true; });

      await vi.advanceTimersByTimeAsync(75_000);
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the page session that a page.rename closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-stop-'));
    const closeRelease = expiryBarrier();
    let stopped = false;

    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [], title: 'Old' }));
    Object.assign(slowClose, { documentId: 'child', gate: closeRelease.wait, started: false, done: false });
    const server = assemble({ source: { kind: 'files', dir }, pageTitles: 'page-map' });

    try {
      const opened = await within(server.dispatch('blok_open', { documentId: 'parent', write: true }, caller));
      const renamed = await within(server.dispatch('blok_execute', {
        handle: opened.structuredContent.handle,
        commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New name' } }],
      }, caller));

      expect(renamed.structuredContent).toMatchObject({ ok: true });
      expect(slowClose.started).toBe(true);
      const stopping = server.stop().then(() => { stopped = true; });

      await within(dispatchCheckpoint());
      expect(stopped).toBe(false);
      closeRelease.release();
      await within(stopping);
      expect(slowClose.done).toBe(true);
    } finally {
      closeRelease.release();
      slowClose.documentId = null;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('waits for a page.rename close that starts after stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-stop-'));
    const childAuthorized = expiryBarrier();
    const authRelease = expiryBarrier();
    const closeRelease = expiryBarrier();
    let stopped = false;

    writeFileSync(join(dir, 'parent.json'), JSON.stringify({ blocks: [{ id: 'pb', type: 'page', data: { pageId: 'child' } }] }));
    writeFileSync(join(dir, 'child.json'), JSON.stringify({ blocks: [], title: 'Old' }));
    Object.assign(slowClose, { documentId: 'child', gate: closeRelease.wait, started: false, done: false });
    const server = assemble({
      source: { kind: 'files', dir },
      pageTitles: 'page-map',
      authorize: async (_principal, documentId) => {
        if (documentId === 'child') {
          childAuthorized.release();
          await authRelease.wait;
        }

        return true;
      },
    });

    try {
      const opened = await within(server.dispatch('blok_open', { documentId: 'parent', write: true }, caller));
      const renaming = server.dispatch('blok_execute', {
        handle: opened.structuredContent.handle,
        commands: [{ name: 'page.rename', args: { id: 'pb', title: 'New name' } }],
      }, caller);

      void renaming.catch(() => undefined);
      await within(childAuthorized.wait);
      const stopping = server.stop().then(() => { stopped = true; });

      authRelease.release();
      await within((async () => {
        while (!slowClose.started) {
          await dispatchCheckpoint();
        }
      })());
      await within(dispatchCheckpoint());
      expect(stopped).toBe(false);
      closeRelease.release();
      await within(stopping);
      expect(slowClose.done).toBe(true);
    } finally {
      authRelease.release();
      closeRelease.release();
      slowClose.documentId = null;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
