// @vitest-environment node
import { setImmediate as dispatchCheckpoint } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { HandleRegistry } from '../../../src/mcp/handles';

interface Session { id: string }
interface Barrier { wait: Promise<void>; release: () => void }

const barrier = (): Barrier => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((done) => {
    release = done;
  });

  if (release === undefined) {
    throw new Error('Barrier was not initialized.');
  }

  return { wait, release };
};

const waitForStart = async (started: Barrier, call: Promise<unknown>): Promise<void> => {
  await Promise.race([
    started.wait,
    call.then(() => {
      throw new Error('Call settled before its callback started.');
    }),
  ]);
};

const track = <T>(calls: Promise<unknown>[], call: Promise<T>): Promise<T> => {
  calls.push(call);
  // Handle failures before gated cleanup can await them.
  void call.catch(() => undefined);

  return call;
};

const drainCalls = async (calls: Promise<unknown>[]): Promise<void> => {
  // Stranded work must not block fixture cleanup.
  await Promise.race([Promise.allSettled(calls), dispatchCheckpoint()]);
};

const codeOf = async (operation: () => unknown): Promise<string | undefined> => {
  try {
    await operation();

    return undefined;
  } catch (thrown: unknown) {
    if (isMcpSurfaceError(thrown)) {
      return thrown.agentError.code;
    }
    throw thrown;
  }
};

describe('HandleRegistry', () => {
  let clock = 0;
  const expired: string[] = [];
  const make = (maxPerPrincipal = 8): HandleRegistry<Session> => new HandleRegistry<Session>({
    idleMs: 1000,
    maxPerPrincipal,
    now: () => clock,
    onExpire: async (session) => {
      expired.push(session.id);
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clock = 0;
    expired.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes sixteen bytes in an opaque base64url handle', () => {
    const handle = make().add('alice', 'doc', { id: 'a' });
    const bytes = Buffer.from(handle, 'base64url');

    expect(bytes).toHaveLength(16);
    expect(handle).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(bytes.toString('base64url')).toBe(handle);
  });

  it('treats another principal and missing handles as UNKNOWN_HANDLE', async () => {
    const registry = make();
    const session = { id: 'a' };
    const handle = registry.add('alice', 'doc', session);
    const callback = vi.fn(async (current: Session, documentId: string) => ({ current, documentId }));

    expect(await codeOf(() => registry.use(handle, 'bob', callback))).toBe('UNKNOWN_HANDLE');
    expect(await codeOf(() => registry.remove(handle, 'bob'))).toBe('UNKNOWN_HANDLE');
    expect(await codeOf(() => registry.use('missing', 'alice', callback))).toBe('UNKNOWN_HANDLE');
    expect(await codeOf(() => registry.remove('missing', 'alice'))).toBe('UNKNOWN_HANDLE');
    expect(callback).not.toHaveBeenCalled();
    expect(registry.count('alice')).toBe(1);
    expect(registry.count('bob')).toBe(0);
    expect(await registry.use(handle, 'alice', callback)).toEqual({ current: session, documentId: 'doc' });
    expect(await registry.remove(handle, 'alice')).toBe(session);
  });

  it('caps each principal independently and releases a slot on remove', async () => {
    const registry = make(2);
    const first = registry.add('alice', 'd1', { id: '1' });

    registry.add('alice', 'd2', { id: '2' });
    registry.add('bob', 'd3', { id: '3' });

    expect(await codeOf(() => registry.add('alice', 'd4', { id: '4' }))).toBe('HANDLE_LIMIT');
    expect(registry.count('alice')).toBe(2);
    expect(registry.count('bob')).toBe(1);
    await registry.remove(first, 'alice');
    expect(registry.count('alice')).toBe(1);
    const replacement = registry.add('alice', 'd4', { id: '4' });

    expect(await registry.use(replacement, 'alice', async (session) => session.id)).toBe('4');
    expect(registry.count('alice')).toBe(2);
    expect(expired).toEqual([]);
  });

  it('expires idle handles once and releases their principal slots', async () => {
    const registry = make(1);
    const alice = registry.add('alice', 'd1', { id: 'a' });
    const bob = registry.add('bob', 'd2', { id: 'b' });

    clock = 999;
    expect(await registry.sweep()).toBe(0);
    expect(expired).toEqual([]);
    clock = 1001;
    expect(await registry.sweep()).toBe(2);
    expect([...expired].sort()).toEqual(['a', 'b']);
    expect(registry.count('alice')).toBe(0);
    expect(registry.count('bob')).toBe(0);
    expect(await codeOf(() => registry.use(alice, 'alice', async () => undefined))).toBe('UNKNOWN_HANDLE');
    expect(await codeOf(() => registry.remove(bob, 'bob'))).toBe('UNKNOWN_HANDLE');
    expect(await registry.sweep()).toBe(0);
    expect(expired).toHaveLength(2);
    const replacement = registry.add('alice', 'd3', { id: 'c' });

    expect(await registry.use(replacement, 'alice', async (session) => session.id)).toBe('c');
  });

  it('starts a new idle interval when a handle is used', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });

    clock = 900;
    await registry.use(handle, 'alice', async () => undefined);
    clock = 1500;
    expect(await registry.sweep()).toBe(0);
    expect(expired).toEqual([]);
    clock = 1901;
    expect(await registry.sweep()).toBe(1);
    expect(expired).toEqual(['a']);
  });

  it('runs accepted calls on the same handle in order without overlap', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });
    const started = barrier();
    const release = barrier();
    const calls: Promise<unknown>[] = [];
    const order: string[] = [];

    try {
      const first = track(calls, registry.use(handle, 'alice', async () => {
        order.push('first:start');
        started.release();
        await release.wait;
        order.push('first:end');

        return 'first';
      }));

      await waitForStart(started, first);
      const second = track(calls, registry.use(handle, 'alice', async () => {
        order.push('second');

        return 'second';
      }));

      await dispatchCheckpoint();
      expect(order).toEqual(['first:start']);
      release.release();
      const results = await Promise.all([first, second]);

      expect(order).toEqual(['first:start', 'first:end', 'second']);
      expect(results).toEqual(['first', 'second']);
    } finally {
      started.release();
      release.release();
      await drainCalls(calls);
    }
  });

  it('does not expire a handle while its callback is running', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });
    const started = barrier();
    const release = barrier();
    const calls: Promise<unknown>[] = [];

    try {
      const running = track(calls, registry.use(handle, 'alice', async () => {
        started.release();
        await release.wait;
      }));

      await waitForStart(started, running);
      clock = 5000;
      expect(await registry.sweep()).toBe(0);
      expect(expired).toEqual([]);
      expect(registry.count('alice')).toBe(1);
      release.release();
      await running;
      expect(await registry.use(handle, 'alice', async (session) => session.id)).toBe('a');
    } finally {
      started.release();
      release.release();
      await drainCalls(calls);
    }
  });

  it('remove waits for both running and already queued calls before returning the session', async () => {
    const registry = make();
    const session = { id: 'a' };
    const handle = registry.add('alice', 'doc', session);
    const firstStarted = barrier();
    const firstRelease = barrier();
    const secondStarted = barrier();
    const secondRelease = barrier();
    const calls: Promise<unknown>[] = [];
    const order: string[] = [];

    try {
      const first = track(calls, registry.use(handle, 'alice', async () => {
        order.push('first:start');
        firstStarted.release();
        await firstRelease.wait;
        order.push('first:end');
      }));

      await waitForStart(firstStarted, first);
      const second = track(calls, registry.use(handle, 'alice', async () => {
        order.push('second:start');
        secondStarted.release();
        await secondRelease.wait;
        order.push('second:end');
      }));
      const removed = track(calls, registry.remove(handle, 'alice').then((result) => {
        order.push('removed');

        return result;
      }));

      firstRelease.release();
      await waitForStart(secondStarted, second);
      expect(order).toEqual(['first:start', 'first:end', 'second:start']);
      secondRelease.release();
      const result = await removed;

      await Promise.all([first, second]);
      expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end', 'removed']);
      expect(result).toBe(session);
      expect(registry.count('alice')).toBe(0);
      expect(await codeOf(() => registry.use(handle, 'alice', async () => undefined))).toBe('UNKNOWN_HANDLE');
      expect(await codeOf(() => registry.remove(handle, 'alice'))).toBe('UNKNOWN_HANDLE');
      expect(expired).toEqual([]);
    } finally {
      firstStarted.release();
      firstRelease.release();
      secondStarted.release();
      secondRelease.release();
      await drainCalls(calls);
    }
  });

  it('does not jam an already queued call when the running callback fails', async () => {
    const registry = make();
    const handle = registry.add('alice', 'doc', { id: 'a' });
    const started = barrier();
    const release = barrier();
    const calls: Promise<unknown>[] = [];
    const failure = new Error('boom');

    try {
      const first = track(calls, registry.use(handle, 'alice', async () => {
        started.release();
        await release.wait;
        throw failure;
      }));
      const outcome = first.then(() => undefined, (thrown: unknown) => thrown);

      await waitForStart(started, first);
      const second = track(calls, registry.use(handle, 'alice', async () => 'next'));

      release.release();
      expect(await outcome).toBe(failure);
      expect(await second).toBe('next');
      expect(await registry.use(handle, 'alice', async () => 'later')).toBe('later');
    } finally {
      started.release();
      release.release();
      await drainCalls(calls);
    }
  });

  it.each(['a', 'b'])('closeAll drains accepted calls and awaits every session (held close: %s)', async (heldSessionId) => {
    const registry = make();
    const aliceSession = { id: 'a' };
    const bobSession = { id: 'b' };
    const alice = registry.add('alice', 'd1', aliceSession);
    const bob = registry.add('bob', 'd2', bobSession);
    const activeHandle = heldSessionId === 'a' ? alice : bob;
    const activePrincipal = heldSessionId === 'a' ? 'alice' : 'bob';
    const idleSessionId = heldSessionId === 'a' ? 'b' : 'a';
    const firstStarted = barrier();
    const firstRelease = barrier();
    const secondStarted = barrier();
    const secondRelease = barrier();
    const closeStarted = barrier();
    const closeRelease = barrier();
    const calls: Promise<unknown>[] = [];
    const order: string[] = [];
    const close = vi.fn(async (session: Session) => {
      order.push(`${session.id}:close:start`);
      if (session.id === heldSessionId) {
        closeStarted.release();
        await closeRelease.wait;
      }
      order.push(`${session.id}:close:end`);
    });

    try {
      const first = track(calls, registry.use(activeHandle, activePrincipal, async () => {
        order.push(`${heldSessionId}:first:start`);
        firstStarted.release();
        await firstRelease.wait;
        order.push(`${heldSessionId}:first:end`);
      }));

      await waitForStart(firstStarted, first);
      const second = track(calls, registry.use(activeHandle, activePrincipal, async () => {
        order.push(`${heldSessionId}:second:start`);
        secondStarted.release();
        await secondRelease.wait;
        order.push(`${heldSessionId}:second:end`);
      }));
      const closing = track(calls, registry.closeAll(close).then(() => {
        order.push('all:closed');
      }));

      firstRelease.release();
      await waitForStart(secondStarted, second);
      secondRelease.release();
      await Promise.all([first, second]);
      await waitForStart(closeStarted, closing);
      closeRelease.release();
      await closing;

      expect(order.filter((event) => event.startsWith(`${heldSessionId}:`) || event === 'all:closed')).toEqual([
        `${heldSessionId}:first:start`, `${heldSessionId}:first:end`,
        `${heldSessionId}:second:start`, `${heldSessionId}:second:end`,
        `${heldSessionId}:close:start`, `${heldSessionId}:close:end`, 'all:closed',
      ]);
      expect(order.filter((event) => event.startsWith(`${idleSessionId}:`) || event === 'all:closed')).toEqual([
        `${idleSessionId}:close:start`, `${idleSessionId}:close:end`, 'all:closed',
      ]);
      expect(close).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledWith(aliceSession);
      expect(close).toHaveBeenCalledWith(bobSession);
      expect(registry.count('alice')).toBe(0);
      expect(registry.count('bob')).toBe(0);
      expect(await codeOf(() => registry.use(alice, 'alice', async () => undefined))).toBe('UNKNOWN_HANDLE');
      expect(await codeOf(() => registry.remove(bob, 'bob'))).toBe('UNKNOWN_HANDLE');
      await registry.closeAll(close);
      expect(close).toHaveBeenCalledTimes(2);
      expect(expired).toEqual([]);
    } finally {
      firstStarted.release();
      firstRelease.release();
      secondStarted.release();
      secondRelease.release();
      closeStarted.release();
      closeRelease.release();
      await drainCalls(calls);
    }
  });
  it('reports HANDLE_LIMIT from the room check without adding anything', async () => {
    const registry = make(1);

    expect(await codeOf(() => registry.assertRoom('alice'))).toBeUndefined();
    registry.add('alice', 'd1', { id: '1' });
    expect(await codeOf(() => registry.assertRoom('alice'))).toBe('HANDLE_LIMIT');
    expect(await codeOf(() => registry.assertRoom('bob'))).toBeUndefined();
    expect(registry.count('alice')).toBe(1);
  });

  it('refuses new handles once closeAll has run', async () => {
    const registry = make();

    await registry.closeAll(async () => undefined);

    expect(await codeOf(() => registry.assertRoom('alice'))).toBe('SOURCE_UNAVAILABLE');
    expect(await codeOf(() => registry.add('alice', 'doc', { id: 'late' }))).toBe('SOURCE_UNAVAILABLE');
    expect(registry.count('alice')).toBe(0);
  });

  it('keeps sweeping after one expiry fails and then reports the failure', async () => {
    const closed: string[] = [];
    const registry = new HandleRegistry<Session>({
      idleMs: 1000,
      maxPerPrincipal: 8,
      now: () => clock,
      onExpire: async (session) => {
        if (session.id === 'a') {
          throw new Error('close failed');
        }
        closed.push(session.id);
      },
    });

    registry.add('alice', 'd1', { id: 'a' });
    registry.add('alice', 'd2', { id: 'b' });
    clock = 1001;

    await expect(registry.sweep()).rejects.toThrow('close failed');
    expect(closed).toEqual(['b']);
    expect(registry.count('alice')).toBe(0);
  });
});
