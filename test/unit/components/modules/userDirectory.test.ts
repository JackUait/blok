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

    it('answers without a host directory at all', async () => {
      const directory = createDirectory();

      await expect(directory.resolve('u1')).resolves.toBeNull();
    });

    it('keeps the extra fields the host attached to the user', async () => {
      const directory = createDirectory({ resolveUser: () => ({ name: 'Ada', avatar: 'a.png' }) });

      await expect(directory.resolve('u1')).resolves.toEqual({ name: 'Ada', avatar: 'a.png' });
    });
  });
});
