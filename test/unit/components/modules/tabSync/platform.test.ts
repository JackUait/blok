import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TAB_SYNC_PROTOCOL } from '../../../../../src/components/modules/tabSync/identity';
import { browserTabPlatform } from '../../../../../src/components/modules/tabSync/platform';

interface FakeLockOptions { ifAvailable?: boolean; signal?: AbortSignal }
type FakeLockCallback = (lock: { name: string } | null) => unknown;

/** In-memory stand-in for navigator.locks: one holder per name, FIFO waiters. */
const installFakeLocks = (): void => {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  const run = async (name: string, cb: FakeLockCallback): Promise<unknown> => {
    held.add(name);
    try {
      return await cb({ name });
    } finally {
      held.delete(name);
      waiters.get(name)?.shift()?.();
    }
  };

  const request = (name: string, options: FakeLockOptions, cb: FakeLockCallback): Promise<unknown> => {
    if (!held.has(name)) {
      return run(name, cb);
    }
    if (options.ifAvailable === true) {
      return Promise.resolve(cb(null));
    }

    return new Promise((resolve, reject) => {
      const line = waiters.get(name) ?? [];
      const go = (): void => {
        options.signal?.removeEventListener('abort', onAbort);
        run(name, cb).then(resolve, reject);
      };
      const onAbort = (): void => {
        line.splice(line.indexOf(go), 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      line.push(go);
      waiters.set(name, line);
    });
  };

  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
};

const opened: Array<{ close(): void }> = [];

const track = <T extends { close(): void } | null>(channel: T): T => {
  if (channel !== null) {
    opened.push(channel);
  }

  return channel;
};

describe('browserTabPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    opened.splice(0).forEach((channel) => channel.close());
    Reflect.deleteProperty(navigator, 'locks');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('channel', () => {
    it('delivers a posted message to another channel on the same key, not to itself', async () => {
      const a = track(browserTabPlatform.channel('k'));
      const b = track(browserTabPlatform.channel('k'));
      const gotA = vi.fn();
      const gotB = vi.fn();

      a?.onMessage(gotA);
      b?.onMessage(gotB);
      a?.post({ kind: 'hello', from: 'a', stateVector: null });

      await vi.waitFor(() => expect(gotB).toHaveBeenCalledWith({ kind: 'hello', from: 'a', stateVector: null }));
      expect(gotA).not.toHaveBeenCalled();
    });

    it('delivers bytes as this realm\'s Uint8Array', async () => {
      const a = track(browserTabPlatform.channel('k'));
      const b = track(browserTabPlatform.channel('k'));
      const got = vi.fn();

      b?.onMessage(got);
      a?.post({ kind: 'update', from: 'a', update: new Uint8Array([1, 2]) });

      await vi.waitFor(() => expect(got).toHaveBeenCalledWith({ kind: 'update', from: 'a', update: new Uint8Array([1, 2]) }));
      const [received] = got.mock.calls[0] as [{ update: unknown }];

      expect(received.update).toBeInstanceOf(Uint8Array);
    });

    it('drops malformed and foreign messages on the same name', async () => {
      const raw = track(browserTabPlatform.rawChannel('k'));
      const b = track(browserTabPlatform.channel('k'));
      const got = vi.fn();

      b?.onMessage(got);
      raw?.post('garbage');
      raw?.post({ protocol: TAB_SYNC_PROTOCOL, key: 'other', message: { kind: 'saved', from: 'a', version: null } });
      raw?.post({ protocol: TAB_SYNC_PROTOCOL, key: 'k', message: { kind: 'saved', from: 'a', version: 'v1' } });

      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(1));
      expect(got).toHaveBeenCalledWith({ kind: 'saved', from: 'a', version: 'v1' });
    });

    it('stops delivering to a listener once unsubscribed', async () => {
      const a = track(browserTabPlatform.channel('k'));
      const b = track(browserTabPlatform.channel('k'));
      const dropped = vi.fn();
      const kept = vi.fn();
      const off = b?.onMessage(dropped);

      b?.onMessage(kept);
      off?.();
      a?.post({ kind: 'saved', from: 'a', version: null });

      await vi.waitFor(() => expect(kept).toHaveBeenCalledTimes(1));
      expect(dropped).not.toHaveBeenCalled();
    });

    it('returns null without BroadcastChannel', () => {
      vi.stubGlobal('BroadcastChannel', undefined);

      expect(browserTabPlatform.channel('k')).toBeNull();
    });
  });

  describe('rawChannel', () => {
    it('delivers any data to another channel of the same name, not to itself', async () => {
      const a = track(browserTabPlatform.rawChannel('s'));
      const b = track(browserTabPlatform.rawChannel('s'));
      const gotA = vi.fn();
      const gotB = vi.fn();

      a?.onMessage(gotA);
      b?.onMessage(gotB);
      a?.post({ theme: 'dark' });

      await vi.waitFor(() => expect(gotB).toHaveBeenCalledWith({ theme: 'dark' }));
      expect(gotA).not.toHaveBeenCalled();
    });

    it('returns null without BroadcastChannel', () => {
      vi.stubGlobal('BroadcastChannel', undefined);

      expect(browserTabPlatform.rawChannel('s')).toBeNull();
    });
  });

  describe('lock', () => {
    it('returns null without navigator.locks', () => {
      expect(browserTabPlatform.lock('k')).toBeNull();
    });

    it('gives the lock to one tab and hands it over on release', async () => {
      installFakeLocks();
      const first = browserTabPlatform.lock('k');
      const second = browserTabPlatform.lock('k');

      expect(await first?.tryAcquire()).toBe(true);
      expect(await second?.tryAcquire()).toBe(false);

      const waiting = second?.queue(new AbortController().signal);

      first?.release();
      await expect(waiting).resolves.toBeUndefined();
      expect(await browserTabPlatform.lock('k')?.tryAcquire()).toBe(false);
    });

    it('keeps the lock until release', async () => {
      installFakeLocks();
      const first = browserTabPlatform.lock('k');
      const second = browserTabPlatform.lock('k');

      expect(await first?.tryAcquire()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(await second?.tryAcquire()).toBe(false);
    });

    it('rejects an aborted queue and never takes the lock', async () => {
      installFakeLocks();
      const first = browserTabPlatform.lock('k');
      const second = browserTabPlatform.lock('k');
      const controller = new AbortController();

      await first?.tryAcquire();
      const waiting = second?.queue(controller.signal);

      controller.abort();
      await expect(waiting).rejects.toThrow();
      first?.release();

      // Release frees the lock a tick later, as in browsers.
      const third = browserTabPlatform.lock('k');

      await vi.waitFor(async () => expect(await third?.tryAcquire()).toBe(true));
    });
  });
});
