// @vitest-environment node
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
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

const caller: Caller = { principal: 'alice', clientName: 'test', scopes: null };
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
