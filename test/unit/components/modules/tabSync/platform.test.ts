import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TAB_SYNC_PROTOCOL } from '../../../../../src/components/modules/tabSync/identity';
import { browserTabPlatform } from '../../../../../src/components/modules/tabSync/platform';
import type { TabPlatform } from '../../../../../src/components/modules/tabSync/platform';

import { createFakePlatform } from './fakes';

interface FakeLockOptions { ifAvailable?: boolean; signal?: AbortSignal; steal?: boolean }
type FakeLockCallback = (lock: { name: string } | null) => unknown;

/**
 * In-memory stand-in for navigator.locks: one holder per name, FIFO waiters.
 * `steal` follows Chromium (probed): the holder's request rejects with an
 * AbortError, waiters keep their place, and steal refuses signal / ifAvailable.
 */
const installFakeLocks = (): void => {
  const held = new Map<string, { broken: (reason: unknown) => void }>();
  const waiters = new Map<string, Array<() => void>>();

  const run = (name: string, cb: FakeLockCallback): Promise<unknown> => new Promise((resolve, reject) => {
    const entry = { broken: reject };

    held.set(name, entry);
    // Real lock callbacks run in a later task, never synchronously.
    Promise.resolve()
      .then(() => cb({ name }))
      .then(resolve, reject)
      .finally(() => {
        // A stolen entry is no longer the holder: the stealer frees the name.
        if (held.get(name) === entry) {
          held.delete(name);
          waiters.get(name)?.shift()?.();
        }
      });
  });

  const request = (name: string, options: FakeLockOptions, cb: FakeLockCallback): Promise<unknown> => {
    if (options.steal === true) {
      if (options.signal !== undefined || options.ifAvailable === true) {
        return Promise.reject(new DOMException('steal with signal or ifAvailable', 'NotSupportedError'));
      }
      held.get(name)?.broken(new DOMException('Lock broken by another request with the \'steal\' option.', 'AbortError'));

      return run(name, cb);
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(options.signal.reason);
    }
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
        reject(options.signal?.reason);
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

    it('unrefs the channel so it never keeps a Node process alive', () => {
      const unref = vi.fn();

      vi.stubGlobal('BroadcastChannel', class {
        public unref = unref;

        public close(): void {}
      });

      browserTabPlatform.rawChannel('s')?.close();

      expect(unref).toHaveBeenCalledTimes(1);
    });

    it('works with a BroadcastChannel that has no unref, as in browsers', () => {
      vi.stubGlobal('BroadcastChannel', class {
        public close(): void {}
      });

      expect(browserTabPlatform.rawChannel('s')).not.toBeNull();
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
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      first?.release();

      // Release frees the lock a tick later, as in browsers.
      const third = browserTabPlatform.lock('k');

      await vi.waitFor(async () => expect(await third?.tryAcquire()).toBe(true));
    });

    it('cancels a waiting queue on release, so the lock never lands on it', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');
      const b = browserTabPlatform.lock('k');

      expect(await a?.tryAcquire()).toBe(true);
      const waiting = b?.queue(new AbortController().signal);

      b?.release();
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      a?.release();

      const c = browserTabPlatform.lock('k');

      await vi.waitFor(async () => expect(await c?.tryAcquire()).toBe(true));
    });

    it('rejects a second acquisition on the same lock while it is held', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');

      expect(await a?.tryAcquire()).toBe(true);
      await expect(a?.tryAcquire()).rejects.toMatchObject({ name: 'InvalidStateError' });
      await expect(a?.queue(new AbortController().signal)).rejects.toMatchObject({ name: 'InvalidStateError' });
    });

    it('rejects a second acquisition on the same lock while it is waiting', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');
      const b = browserTabPlatform.lock('k');

      await a?.tryAcquire();
      const waiting = b?.queue(new AbortController().signal);

      await expect(b?.queue(new AbortController().signal)).rejects.toMatchObject({ name: 'InvalidStateError' });
      await expect(b?.tryAcquire()).rejects.toMatchObject({ name: 'InvalidStateError' });
      a?.release();
      await expect(waiting).resolves.toBeUndefined();
    });

    it('rejects a queue whose signal is already aborted and never takes the lock', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');
      const controller = new AbortController();

      controller.abort();
      await expect(a?.queue(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

      expect(await browserTabPlatform.lock('k')?.tryAcquire()).toBe(true);
    });

    it('cancels a pending tryAcquire on release and frees the lock', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');
      const pending = a?.tryAcquire();

      a?.release();
      expect(await pending).toBe(false);

      const b = browserTabPlatform.lock('k');

      await vi.waitFor(async () => expect(await b?.tryAcquire()).toBe(true));
    });

    it('can acquire again after release', async () => {
      installFakeLocks();
      const a = browserTabPlatform.lock('k');

      expect(await a?.tryAcquire()).toBe(true);
      a?.release();

      await vi.waitFor(async () => expect(await a?.tryAcquire()).toBe(true));
    });
  });
  // The fake platform must behave like the browser one, so both run these.
  describe.each<[string, () => TabPlatform]>([
    ['browser', () => {
      installFakeLocks();

      return browserTabPlatform;
    }],
    ['fake', () => createFakePlatform()],
  ])('lock steal (%s)', (_name, makePlatform) => {
    it('takes a held lock from another tab and tells that tab it lost it', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const b = platform.lock('k');
      const lost = vi.fn();

      a?.onLost(lost);
      expect(await a?.tryAcquire()).toBe(true);
      await b?.steal();
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));

      // The old holder's release must not free the stealer's lock.
      a?.release();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await platform.lock('k')?.tryAcquire()).toBe(false);
    });

    it('leaves waiting tabs in line: they get the lock after the stealer releases', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const waiter = platform.lock('k');
      const b = platform.lock('k');

      expect(await a?.tryAcquire()).toBe(true);
      const waiting = waiter?.queue(new AbortController().signal);
      const granted = vi.fn();

      void waiting?.then(granted);
      await b?.steal();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(granted).not.toHaveBeenCalled();

      b?.release();
      await expect(waiting).resolves.toBeUndefined();
    });

    it('cancels its own wait in line and steals', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const b = platform.lock('k');

      expect(await a?.tryAcquire()).toBe(true);
      const waiting = b?.queue(new AbortController().signal);

      await b?.steal();
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      // b holds it: a release by b frees it for a third tab.
      b?.release();
      const c = platform.lock('k');

      await vi.waitFor(async () => expect(await c?.tryAcquire()).toBe(true));
    });

    it('a steal while holding keeps the lock and reports no loss', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const lost = vi.fn();

      a?.onLost(lost);
      expect(await a?.tryAcquire()).toBe(true);
      await a?.steal();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lost).not.toHaveBeenCalled();
      expect(await platform.lock('k')?.tryAcquire()).toBe(false);
    });

    it('reports no loss on its own release', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const lost = vi.fn();

      a?.onLost(lost);
      expect(await a?.tryAcquire()).toBe(true);
      a?.release();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lost).not.toHaveBeenCalled();
    });

    it('a tab that lost its lock can wait in line again', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const b = platform.lock('k');
      const lost = vi.fn();

      a?.onLost(lost);
      expect(await a?.tryAcquire()).toBe(true);
      await b?.steal();
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));

      const waiting = a?.queue(new AbortController().signal);

      b?.release();
      await expect(waiting).resolves.toBeUndefined();
    });

    it('a lock taken by steal can itself be stolen', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const b = platform.lock('k');
      const c = platform.lock('k');
      const lost = vi.fn();

      b?.onLost(lost);
      expect(await a?.tryAcquire()).toBe(true);
      await b?.steal();
      await c?.steal();

      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    });

    it('stops telling a listener once unsubscribed', async () => {
      const platform = makePlatform();
      const a = platform.lock('k');
      const b = platform.lock('k');
      const lost = vi.fn();
      const off = a?.onLost(lost);

      expect(await a?.tryAcquire()).toBe(true);
      off?.();
      await b?.steal();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lost).not.toHaveBeenCalled();
    });
  });
  describe('activity', () => {
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    const setVisibility = (value: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    };

    afterEach(() => {
      if (visibility === undefined) {
        Reflect.deleteProperty(document, 'visibilityState');
      } else {
        Object.defineProperty(document, 'visibilityState', visibility);
      }
    });

    it('is active only while the page is visible and has focus', () => {
      const activity = browserTabPlatform.activity();
      const focus = vi.spyOn(document, 'hasFocus');

      setVisibility('visible');
      focus.mockReturnValue(true);
      expect(activity?.isActive()).toBe(true);

      focus.mockReturnValue(false);
      expect(activity?.isActive()).toBe(false);

      setVisibility('hidden');
      focus.mockReturnValue(true);
      expect(activity?.isActive()).toBe(false);
    });

    it('reports visibility and window focus changes until unsubscribed', () => {
      const changed = vi.fn();
      const off = browserTabPlatform.activity()?.onChange(changed);

      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new FocusEvent('focus'));
      window.dispatchEvent(new FocusEvent('blur'));
      expect(changed).toHaveBeenCalledTimes(3);

      off?.();
      window.dispatchEvent(new FocusEvent('focus'));
      expect(changed).toHaveBeenCalledTimes(3);
    });
  });
});
