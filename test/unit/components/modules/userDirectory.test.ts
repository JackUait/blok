import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { UserDirectory, LEARNED_NAMES_LIMIT } from '../../../../src/components/modules/userDirectory';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig } from '../../../../types';

const createDirectory = (config: Partial<BlokConfig> = {}): UserDirectory =>
  new UserDirectory({
    config: config,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

describe('UserDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('what it can answer without asking the host', () => {
    it('names the configured user from the config alone', () => {
      const directory = createDirectory({ user: { id: 'u1', name: 'Ada' } });

      expect(directory.known('u1')?.name).toBe('Ada');
    });

    it('knows nobody when the config carries an id but no name', () => {
      const directory = createDirectory({ user: { id: 'u1' } });

      expect(directory.known('u1')).toBeNull();
    });

    it('names a peer it learned about', () => {
      const directory = createDirectory();

      directory.learn('u2', 'Grace');

      expect(directory.known('u2')?.name).toBe('Grace');
    });

    it('prefers the configured name over a learned one for the local user', () => {
      const directory = createDirectory({ user: { id: 'u1', name: 'Ada' } });

      directory.learn('u1', 'someone else');

      expect(directory.known('u1')?.name).toBe('Ada');
    });
  });

  describe('the local user', () => {
    it('refuses a name a peer claims for the local user', () => {
      const directory = createDirectory({ user: { id: 'u1' } });

      // Awareness is unauthenticated: any room member can publish this pair,
      // and it would otherwise rename the local user in their own footer.
      directory.learn('u1', 'Evil Mallory');

      expect(directory.known('u1')).toBeNull();
    });

    it('takes the local name from the editor itself', () => {
      const directory = createDirectory({ user: { id: 'u1' } });

      directory.identify('Ada');

      expect(directory.known('u1')?.name).toBe('Ada');
    });

    it('does not flip a configured local name to a host answer', async () => {
      const resolveUser = vi.fn(() => ({ name: 'Host Ada' }));
      const directory = createDirectory({ user: { id: 'u1', name: 'Ada' }, resolveUser });

      // The footer paints `known()` first and the resolved answer second, so a
      // disagreement between the two is a name swapping under the reader.
      await expect(directory.resolve('u1')).resolves.toEqual({ name: 'Ada' });
      expect(resolveUser).not.toHaveBeenCalled();
    });

    it('still lets the host directory name the local user', async () => {
      const directory = createDirectory({ user: { id: 'u1' }, resolveUser: () => ({ name: 'Ada' }) });

      await directory.resolve('u1');

      expect(directory.known('u1')?.name).toBe('Ada');
    });

    it('matches an id whose stored form was stripped of a NUL', () => {
      const directory = createDirectory({ user: { id: 'a\u0000b', name: 'Ada' } });

      // The document stores ids NUL-stripped, so that is the form a block
      // carries back — the configured name must survive the round trip.
      expect(directory.known('ab')?.name).toBe('Ada');
    });

    it('matches an id that was configured with stray whitespace', () => {
      const directory = createDirectory({ user: { id: '  u1  ', name: 'Ada' } });

      expect(directory.known('u1')?.name).toBe('Ada');
    });
  });

  describe('what it refuses to learn', () => {
    it('ignores a name that is not a string', () => {
      const directory = createDirectory();

      directory.learn('u2', { toString: () => 'Grace' });

      expect(directory.known('u2')).toBeNull();
    });

    it('ignores a blank name', () => {
      const directory = createDirectory();

      directory.learn('u2', '   ');

      expect(directory.known('u2')).toBeNull();
    });

    it('ignores an id no person could have', () => {
      const directory = createDirectory();

      directory.learn('y'.repeat(5000), 'Grace');

      expect(directory.known('y'.repeat(5000))).toBeNull();
    });

    it('ignores a blank id', () => {
      const directory = createDirectory();

      directory.learn('  ', 'Grace');

      expect(directory.known('  ')).toBeNull();
    });

    it('trims and caps a long name instead of storing it whole', () => {
      const directory = createDirectory();

      directory.learn('u2', `  ${'x'.repeat(200)}  `);

      expect(directory.known('u2')?.name.length).toBe(32);
    });

    it('takes the newest name a peer publishes', () => {
      const directory = createDirectory();

      directory.learn('u2', 'Grace');
      directory.learn('u2', 'Grace H');

      expect(directory.known('u2')?.name).toBe('Grace H');
    });

    it('keeps every name when the peers exactly fill the bound', () => {
      const directory = createDirectory();

      for (let i = 0; i < LEARNED_NAMES_LIMIT; i++) {
        directory.learn(`u${i}`, `name-${i}`);
      }

      expect(directory.known('u0')?.name).toBe('name-0');
    });

    it('treats a re-published name as the freshest entry, not the oldest', () => {
      const directory = createDirectory();

      for (let i = 0; i < LEARNED_NAMES_LIMIT; i++) {
        directory.learn(`u${i}`, `name-${i}`);
      }

      directory.learn('u0', 'name-0');
      directory.learn('newcomer', 'Newcomer');

      // The peer who just spoke is the last one who should be forgotten.
      expect(directory.known('u0')?.name).toBe('name-0');
      expect(directory.known('u1')).toBeNull();
    });

    it('bounds the learned names so a hostile peer cannot mint ids forever', () => {
      const directory = createDirectory();

      for (let i = 0; i < LEARNED_NAMES_LIMIT + 10; i++) {
        directory.learn(`u${i}`, `name-${i}`);
      }

      expect(directory.known('u0')).toBeNull();
      expect(directory.known(`u${LEARNED_NAMES_LIMIT + 9}`)?.name).toBe(`name-${LEARNED_NAMES_LIMIT + 9}`);
    });
  });

  describe('asking the host directory', () => {
    it('returns what resolveUser answered', async () => {
      const resolveUser = vi.fn(() => ({ name: 'Ada' }));
      const directory = createDirectory({ resolveUser });

      await expect(directory.resolve('u1')).resolves.toEqual({ name: 'Ada' });
    });

    it('asks the host only once per id', async () => {
      const resolveUser = vi.fn(() => ({ name: 'Ada' }));
      const directory = createDirectory({ resolveUser });

      await directory.resolve('u1');
      await directory.resolve('u1');

      expect(resolveUser).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight request between concurrent callers', async () => {
      const resolveUser = vi.fn(() => Promise.resolve({ name: 'Ada' }));
      const directory = createDirectory({ resolveUser });

      const [first, second] = await Promise.all([directory.resolve('u1'), directory.resolve('u1')]);

      expect(resolveUser).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
    });

    it('answers a resolved name synchronously afterwards', async () => {
      const directory = createDirectory({ resolveUser: () => ({ name: 'Ada' }) });

      await directory.resolve('u1');

      expect(directory.known('u1')?.name).toBe('Ada');
    });

    it('falls back to what it already knows when the host has no answer', async () => {
      const directory = createDirectory({ resolveUser: () => null });

      directory.learn('u2', 'Grace');

      await expect(directory.resolve('u2')).resolves.toEqual({ name: 'Grace' });
    });

    it('survives a resolveUser that throws', async () => {
      const directory = createDirectory({
        resolveUser: () => {
          throw new Error('directory is down');
        },
      });

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('survives a rejected resolveUser promise', async () => {
      const directory = createDirectory({ resolveUser: () => Promise.reject(new Error('offline')) });

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('refuses a resolveUser answer without a usable name', async () => {
      const directory = createDirectory({ resolveUser: () => ({ name: 42 } as unknown as { name: string }) });

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('retries the host after a failure instead of caching the error', async () => {
      const resolveUser = vi.fn()
        .mockImplementationOnce(() => Promise.reject(new Error('offline')))
        .mockImplementationOnce(() => ({ name: 'Ada' }));
      const directory = createDirectory({ resolveUser });

      await directory.resolve('u1');

      await expect(directory.resolve('u1')).resolves.toEqual({ name: 'Ada' });
    });

    it('retries a host that throws synchronously', async () => {
      const resolveUser = vi.fn(() => {
        throw new Error('directory is down');
      });
      const directory = createDirectory({ resolveUser });

      await directory.resolve('u1');
      await directory.resolve('u1');

      // A throw before the first await used to strand the id as a settled
      // request, so the host was never asked again.
      expect(resolveUser).toHaveBeenCalledTimes(2);
    });

    it('never hands the host an id no person could have', async () => {
      const resolveUser = vi.fn(() => ({ name: 'Ada' }));
      const directory = createDirectory({ resolveUser });

      // `lastEditedBy` comes off the wire in a shared document, and nothing
      // between the peer and here caps its length.
      await expect(directory.resolve('x'.repeat(5000))).resolves.toBeNull();
      expect(resolveUser).not.toHaveBeenCalled();
    });

    it('answers without a host directory at all', async () => {
      const directory = createDirectory();

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('asks the host once even when it has no answer', async () => {
      const resolveUser = vi.fn(() => null);
      const directory = createDirectory({ resolveUser });

      await directory.resolve('u1');
      await directory.resolve('u1');
      await directory.resolve('u1');

      expect(resolveUser).toHaveBeenCalledTimes(1);
    });

    it('hides a peer-published name while the host directory is still looking', async () => {
      const directory = createDirectory({ resolveUser: () => new Promise<null>(() => undefined) });

      directory.learn('u2', 'Not Really Bob');

      // Awareness is unauthenticated. A host with its own directory must not
      // see a forged name for however long its lookup takes.
      expect(directory.known('u2')).toBeNull();
    });

    it('still uses a name learned after the host drew a blank', async () => {
      const directory = createDirectory({ resolveUser: () => null });

      await directory.resolve('u2');
      directory.learn('u2', 'Grace');

      await expect(directory.resolve('u2')).resolves.toEqual({ name: 'Grace' });
    });

    it('answers nothing once the editor is gone', async () => {
      const directory = createDirectory({ resolveUser: () => ({ name: 'Ada' }) });

      directory.markDestroyed();

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('keeps the extra fields the host attached to the user', async () => {
      const directory = createDirectory({ resolveUser: () => ({ name: 'Ada', avatar: 'a.png' }) });

      await expect(directory.resolve('u1')).resolves.toEqual({ name: 'Ada', avatar: 'a.png' });
    });
  });
});
