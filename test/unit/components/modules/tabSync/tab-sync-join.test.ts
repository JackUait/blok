import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modules } from '../../../../../src/components/modules';
import { JOIN_TIMEOUT_MS, TabSync } from '../../../../../src/components/modules/tabSync';
import { resolveTabKey } from '../../../../../src/components/modules/tabSync/identity';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';
import type { LeaderLock, TabPlatform } from '../../../../../src/components/modules/tabSync/platform';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { expandPersistenceConfig, persistenceVersionAccess } from '../../../../../src/components/utils/persistence';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';

import { createFakeBlok, createFakePlatform } from './fakes';

type FakeBlok = ReturnType<typeof createFakeBlok>;
type FakePlatform = ReturnType<typeof createFakePlatform>;

interface Tab { sync: TabSync; fake: FakeBlok; config: BlokConfig }

const CONTEXT = { loadedFromPersistence: true, isEmpty: false };

const KEY = resolveTabKey({ documentId: 'doc', recordId: null, idSource: 'host', hasSaved: false, isEmpty: false, pathname: '/' }) ?? 'missing-key';

const baseConfig = (): BlokConfig => {
  const expanded = expandPersistenceConfig({
    persistence: { load: async () => null, save: vi.fn(async () => ({ version: 'v-next' })) },
  }).persistence;

  return { documentId: 'doc', persistence: expanded };
};

const makeTab = (
  platform: TabPlatform,
  options: { recordId?: string; readOnly?: boolean; config?: BlokConfig } = {}
): Tab => {
  const fake = createFakeBlok({ recordId: options.recordId, readOnly: options.readOnly });
  const config = options.config ?? baseConfig();
  const sync = new TabSync({ config, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  sync.state = fake as unknown as BlokModules;
  sync.setPlatform(platform);

  return { sync, fake, config };
};

const startTab = async (
  platform: TabPlatform,
  options: { recordId?: string; readOnly?: boolean; config?: BlokConfig; seed?: string } = {}
): Promise<Tab> => {
  const tab = makeTab(platform, options);

  if (options.seed !== undefined) {
    tab.fake.type(options.seed);
  }
  await tab.sync.start(CONTEXT);

  return tab;
};

/** Drains the message hops between tabs without moving the fake clock. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
};

/** Everything posted on KEY, seen by a bystander channel. */
const listen = (platform: FakePlatform): TabMessage[] => {
  const seen: TabMessage[] = [];

  platform.channel(KEY)?.onMessage((message) => seen.push(message));

  return seen;
};

/** Holds the lock so no tab can lead. */
const squat = async (platform: FakePlatform): Promise<LeaderLock> => {
  const lock = platform.lock(KEY);

  if (lock === null) {
    throw new Error('fake platform has no lock');
  }
  await lock.tryAcquire();

  return lock;
};

describe('TabSync — roles, leader lock and join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays solo, posts nothing and reports no role when tab sync cannot run', async () => {
    const platform = createFakePlatform();
    const seen = listen(platform);
    const cases: Array<{ name: string; config: BlokConfig; context: typeof CONTEXT; platform: TabPlatform }> = [
      { name: 'tabSync: false', config: { ...baseConfig(), tabSync: false }, context: CONTEXT, platform },
      { name: 'collaboration', config: { ...baseConfig(), collaboration: { doc: 'shared' } }, context: CONTEXT, platform },
      { name: 'no key', config: { persistence: baseConfig().persistence }, context: { loadedFromPersistence: false, isEmpty: false }, platform },
      { name: 'no channel', config: baseConfig(), context: CONTEXT, platform: { ...platform, channel: () => null } },
      { name: 'no lock', config: baseConfig(), context: CONTEXT, platform: { ...platform, lock: () => null } },
    ];

    for (const testCase of cases) {
      const tab = makeTab(testCase.platform, { config: testCase.config });

      await tab.sync.start(testCase.context);
      await settle();

      expect(tab.sync.role, testCase.name).toBe('solo');
      expect(tab.fake.ModificationsObserver.onRoleChanged, testCase.name).not.toHaveBeenCalled();
      expect(tab.fake.BlockManager.setRemoteOriginLabel, testCase.name).not.toHaveBeenCalled();
    }
    expect(seen).toEqual([]);
    expect(platform.holders.size).toBe(0);
  });

  it('the first tab leads and labels incoming changes as tab changes', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A' });

    expect(a.sync.role).toBe('leader');
    expect(a.fake.BlockManager.setRemoteOriginLabel).toHaveBeenCalledWith('tab');
    expect(a.fake.ModificationsObserver.onRoleChanged).toHaveBeenCalledWith('leader');
  });

  it('a second tab joins with an empty hello and only it takes the answer', async () => {
    const platform = createFakePlatform();
    const seen = listen(platform);
    const a = await startTab(platform, { recordId: 'A' });
    const c = await startTab(platform, { recordId: 'C' });

    await settle();
    expect(c.sync.role).toBe('follower');
    expect(c.fake.YjsManager.applyRemoteUpdate).toHaveBeenCalledTimes(1);

    const b = await startTab(platform, { recordId: 'B' });

    expect(b.sync.role).toBe('joining');
    await settle();

    const hellos = seen.filter((m) => m.kind === 'hello');

    expect(hellos).toHaveLength(2);
    expect(hellos[1]).toMatchObject({ kind: 'hello', stateVector: null });
    expect(seen.filter((m) => m.kind === 'state')).toHaveLength(2);
    expect(b.sync.role).toBe('follower');
    expect(b.fake.YjsManager.applyRemoteUpdate).toHaveBeenCalledTimes(1);
    expect(c.fake.YjsManager.applyRemoteUpdate).toHaveBeenCalledTimes(1);
    expect(a.fake.YjsManager.applyRemoteUpdate).not.toHaveBeenCalled();
  });

  it('the leader lands buffered typing before it encodes the answer', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A' });
    const encode = vi.spyOn(a.fake.YjsManager, 'encodeStateAsUpdate');

    await startTab(platform, { recordId: 'B' });
    await settle();

    expect(encode).toHaveBeenCalledTimes(1);
    expect(a.fake.YjsManager.flushPendingBlockWrites).toHaveBeenCalled();
    expect(a.fake.YjsManager.flushPendingBlockWrites.mock.invocationCallOrder[0])
      .toBeLessThan(encode.mock.invocationCallOrder[0]);
  });

  it('the joiner adopts the leader document, id and version, then waits to lead', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A', seed: 'leader text' });

    persistenceVersionAccess(a.config.persistence)?.set('v-leader');
    const b = makeTab(platform, { recordId: 'B' });

    persistenceVersionAccess(b.config.persistence)?.set('v-old');
    b.fake.type('stale load');
    await b.sync.start(CONTEXT);
    await settle();

    expect(b.sync.role).toBe('follower');
    expect(b.fake.text()).toBe('leader text');
    expect(b.fake.Saver.adoptDocumentRecordId).toHaveBeenCalledWith('A');
    expect(b.fake.Saver.getDocumentRecordId()).toBe('A');
    expect(persistenceVersionAccess(b.config.persistence)?.get()).toBe('v-leader');
    expect(b.fake.ModificationsObserver.onRoleChanged).toHaveBeenLastCalledWith('follower');

    a.sync.destroy();
    await settle();

    expect(b.sync.role).toBe('leader');
    expect(b.fake.ModificationsObserver.onRoleChanged).toHaveBeenLastCalledWith('leader');
  });

  it('a joiner nobody answers goes solo after the timeout and keeps its content', async () => {
    const platform = createFakePlatform();

    await squat(platform);
    const b = await startTab(platform, { recordId: 'B', seed: 'mine' });

    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS - 1);
    expect(b.sync.role).toBe('joining');

    await vi.advanceTimersByTimeAsync(1);
    expect(b.sync.role).toBe('solo');
    expect(b.fake.ModificationsObserver.onRoleChanged).toHaveBeenLastCalledWith('solo');
    expect(b.fake.text()).toBe('mine');
    expect(b.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
  });

  it('a joiner that typed before the answer stays solo and keeps its typing', async () => {
    const platform = createFakePlatform();

    await startTab(platform, { recordId: 'A', seed: 'leader text' });
    const b = makeTab(platform, { recordId: 'B' });
    const started = b.sync.start(CONTEXT);

    b.fake.type('x');
    await started;
    await settle();

    expect(b.sync.role).toBe('solo');
    expect(b.fake.text()).toBe('x');
    expect(b.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
    expect(b.fake.Saver.adoptDocumentRecordId).not.toHaveBeenCalled();
  });

  it('a solo tab with no edits rejoins once when a thawed leader speaks', async () => {
    const platform = createFakePlatform();
    const squatter = await squat(platform);
    const b = await startTab(platform, { recordId: 'B', seed: 'stale' });

    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    expect(b.sync.role).toBe('solo');
    const resync = vi.spyOn(b.sync, 'resync');

    squatter.release();
    const a = await startTab(platform, { recordId: 'A', seed: 'leader' });

    expect(a.sync.role).toBe('leader');
    a.fake.type(' one');
    a.fake.type(' two');
    await settle();

    expect(resync).toHaveBeenCalledTimes(1);
    expect(b.sync.role).toBe('follower');
    expect(b.fake.text()).toBe('leader one two');
  });

  it('a solo tab with edits ignores a thawed leader', async () => {
    const platform = createFakePlatform();
    const squatter = await squat(platform);
    const b = await startTab(platform, { recordId: 'B' });

    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    b.fake.type('mine');
    const resync = vi.spyOn(b.sync, 'resync');

    squatter.release();
    const a = await startTab(platform, { recordId: 'A' });

    a.fake.type('leader');
    await settle();

    expect(resync).not.toHaveBeenCalled();
    expect(b.sync.role).toBe('solo');
    expect(b.fake.text()).toBe('mine');
  });

  it('a read-only tab follows without posting edits or competing for the lock', async () => {
    const platform = createFakePlatform();
    const locks = vi.spyOn(platform, 'lock');
    const a = await startTab(platform, { recordId: 'A' });
    const b = await startTab(platform, { recordId: 'B', readOnly: true });
    const lock = locks.mock.results[1]?.value;

    if (lock === null || lock === undefined) {
      throw new Error('the read-only tab opened no lock');
    }
    const tryAcquire = vi.spyOn(lock, 'tryAcquire');
    const queue = vi.spyOn(lock, 'queue');

    await settle();
    expect(b.sync.role).toBe('follower');

    a.fake.type('from leader');
    await settle();
    expect(b.fake.text()).toBe('from leader');

    b.fake.type('!');
    await settle();
    expect(a.fake.YjsManager.applyRemoteUpdate).not.toHaveBeenCalled();
    expect(tryAcquire).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();

    a.sync.destroy();
    await settle();
    expect(b.sync.role).toBe('follower');
  });

  it('two tabs started in the same tick end with exactly one leader', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform, { recordId: 'A' });
    const b = makeTab(platform, { recordId: 'B' });

    await Promise.all([a.sync.start(CONTEXT), b.sync.start(CONTEXT)]);
    await settle();

    expect([a.sync.role, b.sync.role].sort()).toEqual(['follower', 'leader']);
  });

  it('destroying the leader frees the lock and stops listening', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A' });

    a.sync.destroy();
    expect(platform.holders.size).toBe(0);

    const probe = platform.channel(KEY);

    probe?.post({ kind: 'hello', from: 'probe', stateVector: null });
    await settle();
    expect(a.fake.YjsManager.flushPendingBlockWrites).not.toHaveBeenCalled();

    const seen = listen(platform);

    a.fake.type('after');
    await settle();
    expect(seen).toEqual([]);
  });

  it('a tab whose document changes under it leaves the session', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A' });
    const b = await startTab(platform, { recordId: 'B' });

    await settle();
    expect(b.sync.role).toBe('follower');

    b.fake.Saver.adoptDocumentRecordId('another-document');
    a.fake.type('for A only');
    await settle();

    expect(b.sync.role).toBe('solo');
    expect(b.fake.text()).toBe('');
    expect(b.fake.YjsManager.applyRemoteUpdate).toHaveBeenCalledTimes(1);
  });

  it('applies leader edits that arrive while the joiner is still adopting', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A', seed: 'one' });
    const b = makeTab(platform, { recordId: 'B' });
    const gate: { open: () => void } = { open: () => undefined };

    b.fake.BlockManager.clear.mockImplementationOnce(() => new Promise<void>((resolve) => {
      gate.open = resolve;
    }));
    await b.sync.start(CONTEXT);
    await settle();
    expect(b.sync.role).toBe('joining');

    a.fake.type(' two');
    await settle();
    gate.open();
    await settle();

    expect(b.sync.role).toBe('follower');
    expect(b.fake.text()).toBe('one two');
  });

  it('a tab destroyed while it asks for the lock takes no role', async () => {
    const platform = createFakePlatform();
    const a = makeTab(platform, { recordId: 'A' });
    const started = a.sync.start(CONTEXT);

    a.sync.destroy();
    await started;
    await settle();

    expect(a.sync.role).toBe('solo');
    expect(a.fake.ModificationsObserver.onRoleChanged).not.toHaveBeenCalled();
    expect(platform.holders.size).toBe(0);
  });

  it('destroying a follower that waits in line cancels its wait cleanly', async () => {
    const platform = createFakePlatform();
    const a = await startTab(platform, { recordId: 'A' });
    const b = await startTab(platform, { recordId: 'B' });

    await settle();
    b.sync.destroy();
    a.sync.destroy();
    await settle();

    expect(b.sync.role).toBe('solo');
    expect(platform.holders.size).toBe(0);
  });

  it('is destroyed after Collaboration and ModificationsObserver, before the document dies', () => {
    const names = Object.keys(Modules);
    const at = (name: string): number => names.indexOf(name);

    expect(at('TabSync')).toBeGreaterThan(at('Collaboration'));
    expect(at('TabSync')).toBeGreaterThan(at('ModificationsObserver'));
    expect(at('TabSync')).toBeLessThan(at('YjsManager'));
  });
});
