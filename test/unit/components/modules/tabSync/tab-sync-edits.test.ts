import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOIN_TIMEOUT_MS, TabSync } from '../../../../../src/components/modules/tabSync';
import { resolveTabKey } from '../../../../../src/components/modules/tabSync/identity';
import type { LeaderLock, TabChannel } from '../../../../../src/components/modules/tabSync/platform';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { expandPersistenceConfig, persistenceVersionAccess } from '../../../../../src/components/utils/persistence';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlokConfig } from '../../../../../types';

import { createFakeBlok, createFakePlatform } from './fakes';

type FakeBlok = ReturnType<typeof createFakeBlok>;
type FakePlatform = ReturnType<typeof createFakePlatform>;

interface Tab {
  sync: TabSync;
  fake: FakeBlok;
  config: BlokConfig;
  pauseInbound: () => void;
  resumeInbound: () => void;
}

const CONTEXT = { loadedFromPersistence: true, isEmpty: false };

const KEY = resolveTabKey({ documentId: 'doc', recordId: null, idSource: 'host', hasSaved: false, isEmpty: false, pathname: '/' }) ?? 'missing-key';

const apiStub = {} as unknown as API;

const makeConfig = (persistence: boolean): BlokConfig => {
  const expanded = expandPersistenceConfig({
    documentId: 'doc',
    persistence: { load: async () => null, save: vi.fn(async () => ({ version: 'v-next' })) },
  });

  // Without `persistence: true` the save pump stays off config.onSave.
  return persistence ? expanded : { documentId: 'doc', persistence: expanded.persistence };
};

/**
 * Builds a tab on `platform` without starting it. The platform is wrapped so
 * the test can pause this tab's own channel.
 */
const makeTab = (
  platform: FakePlatform,
  options: { recordId?: string; seedText?: string; readOnly?: boolean; persistence?: boolean } = {}
): Tab => {
  const fake = createFakeBlok({ recordId: options.recordId, seedText: options.seedText, readOnly: options.readOnly });
  const config = makeConfig(options.persistence ?? false);
  const sync = new TabSync({ config, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });
  const own: { channel: TabChannel | null } = { channel: null };

  sync.state = fake as unknown as BlokModules;
  sync.setPlatform({
    ...platform,
    channel: (key) => {
      own.channel = platform.channel(key);

      return own.channel;
    },
  });

  return {
    sync,
    fake,
    config,
    pauseInbound: () => {
      if (own.channel !== null) {
        platform.pauseInbound(own.channel);
      }
    },
    resumeInbound: () => {
      if (own.channel !== null) {
        platform.resumeInbound(own.channel);
      }
    },
  };
};

const flush = async (): Promise<void> => {
  await vi.runAllTimersAsync();
};

/** Drains the message hops between tabs without moving the fake clock. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
};

describe('TabSync — edits, adopt, wake diff and hand-off', () => {
  // One platform per test, shared by the helpers below.
  let platform: FakePlatform;

  const tab = async (options: { recordId?: string; seedText?: string; readOnly?: boolean; persistence?: boolean } = {}): Promise<Tab> => {
    const t = makeTab(platform, options);

    await t.sync.start(CONTEXT);

    return t;
  };

  const twoTabs = async (options: { persistence?: boolean } = {}): Promise<{ a: Tab; b: Tab }> => {
    const a = await tab({ recordId: 'A', persistence: options.persistence });
    const b = await tab({ recordId: 'B', persistence: options.persistence });

    await flush();

    return { a, b };
  };

  /** Everything posted on KEY from now on, seen by a bystander channel. */
  const listen = (): TabMessage[] => {
    const seen: TabMessage[] = [];

    platform.channel(KEY)?.onMessage((message) => seen.push(message));

    return seen;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    platform = createFakePlatform();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('an edit in one tab reaches the other', async () => {
    const { a, b } = await twoTabs();

    a.fake.type('hello');
    await flush();

    expect(b.fake.text()).toBe('hello');
  });

  it('an edit is not echoed back', async () => {
    const { a, b } = await twoTabs();

    a.fake.type('x');
    await flush();

    expect(a.fake.YjsManager.applyRemoteUpdate).not.toHaveBeenCalled();
    // The join state, then the edit.
    expect(b.fake.YjsManager.applyRemoteUpdate).toHaveBeenCalledTimes(2);
  });

  it('the joiner adopts the leader document even when it loaded something else', async () => {
    const a = await tab({ recordId: 'A' });

    a.fake.type('leader text');
    const b = await tab({ recordId: 'B', seedText: 'stale load' });

    await flush();

    expect(b.fake.text()).toBe('leader text');
    expect(b.fake.Saver.adoptDocumentRecordId).toHaveBeenCalledWith('A');
  });

  it('a woken follower catches up by diff and keeps its own unflushed typing', async () => {
    const { a, b } = await twoTabs();

    b.pauseInbound();
    a.fake.type('while asleep');
    b.fake.type('mine');
    await flush();
    b.resumeInbound();
    await b.sync.resync();
    await flush();

    // Only the first join reset the document.
    expect(b.fake.YjsManager.resetForRelineage).toHaveBeenCalledTimes(1);
    expect(b.fake.text()).toContain('while asleep');
    expect(b.fake.text()).toContain('mine');
    expect(b.sync.role).toBe('follower');
  });

  it('a woken follower keeps typing still in its write buffer', async () => {
    const { a, b } = await twoTabs();

    b.pauseInbound();
    a.fake.type('while asleep');
    await flush();
    b.fake.typeBuffered('buffered');
    b.resumeInbound();
    await b.sync.resync();
    await flush();

    expect(b.fake.YjsManager.resetForRelineage).toHaveBeenCalledTimes(1);
    expect(b.fake.text()).toContain('while asleep');
    expect(b.fake.text()).toContain('buffered');
    expect(a.fake.text()).toContain('buffered');
  });

  it('a woken follower takes the version it missed from the diff answer', async () => {
    const { a, b } = await twoTabs();

    b.pauseInbound();
    persistenceVersionAccess(a.config.persistence)?.set('v-later');
    b.resumeInbound();
    await b.sync.resync();
    await flush();

    expect(persistenceVersionAccess(b.config.persistence)?.get()).toBe('v-later');
  });

  it('a clean woken leader re-posts its saved version, without a reset', async () => {
    const { a, b } = await twoTabs();

    persistenceVersionAccess(a.config.persistence)?.set('v-leader');
    await a.sync.resync();
    await flush();

    expect(persistenceVersionAccess(b.config.persistence)?.get()).toBe('v-leader');
    expect(a.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
    expect(a.sync.role).toBe('leader');
  });

  it('the successor saves edits the old leader never saved', async () => {
    const { a, b } = await twoTabs();

    b.fake.type('unsaved');
    await flush();
    a.sync.destroy();
    await flush();

    expect(b.sync.role).toBe('leader');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('the successor saves a third tab edit the old leader never saved', async () => {
    const { a, b } = await twoTabs();
    const c = await tab({ recordId: 'C' });

    await flush();
    c.fake.type('from c');
    await flush();
    a.sync.destroy();
    await flush();

    expect(b.sync.role).toBe('leader');
    expect(b.fake.text()).toBe('from c');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a successor saves once even after the leader said it saved', async () => {
    const { a, b } = await twoTabs({ persistence: true });

    b.fake.type('saved soon');
    await flush();
    a.config.onSave?.({ blocks: [] }, apiStub);
    await flush();
    a.sync.destroy();
    await flush();

    // Promotion always saves: `saved` can predate an edit the leader never saved.
    expect(b.sync.role).toBe('leader');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('the successor saves the old leader edits it adopted at join', async () => {
    const a = await tab({ recordId: 'A' });

    a.fake.type('x');
    const b = await tab({ recordId: 'B' });

    await flush();
    expect(b.fake.text()).toBe('x');
    a.sync.destroy();
    await flush();

    expect(b.sync.role).toBe('leader');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a woken leader asks the followers for the edits it missed, without a reset', async () => {
    const { a, b } = await twoTabs();

    a.pauseInbound();
    b.fake.type('from b');
    await flush();
    a.resumeInbound();
    expect(a.fake.text()).toBe('');
    await a.sync.resync();
    await flush();

    expect(a.fake.text()).toContain('from b');
    expect(a.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
    expect(a.sync.role).toBe('leader');
  });

  it('the leader marks its observer dirty for each tab update that changed the document', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    b.fake.type('moved');
    await flush();

    expect(a.fake.ModificationsObserver.markDirty).toHaveBeenCalledTimes(1);

    // The same update again changes nothing.
    const repeat = seen.find((m) => m.kind === 'update');

    expect(repeat).toBeDefined();
    if (repeat !== undefined) {
      platform.channel(KEY)?.post(repeat);
    }
    await flush();

    expect(a.fake.ModificationsObserver.markDirty).toHaveBeenCalledTimes(1);
    // A follower never saves, so it is never marked.
    expect(b.fake.ModificationsObserver.markDirty).not.toHaveBeenCalled();
  });

  it('a woken leader marks its observer dirty for a diff that changed the document', async () => {
    const { a, b } = await twoTabs();

    a.pauseInbound();
    b.fake.type('from b');
    await flush();
    a.resumeInbound();
    await a.sync.resync();
    await flush();

    expect(a.fake.text()).toContain('from b');
    expect(a.fake.ModificationsObserver.markDirty).toHaveBeenCalledTimes(1);
  });

  it('a woken leader keeps its own version, not a follower one', async () => {
    const { a, b } = await twoTabs();

    persistenceVersionAccess(a.config.persistence)?.set('v-leader');
    persistenceVersionAccess(b.config.persistence)?.set('v-stale');
    a.pauseInbound();
    b.fake.type('from b');
    await flush();
    a.resumeInbound();
    await a.sync.resync();
    await flush();

    expect(a.fake.text()).toContain('from b');
    expect(persistenceVersionAccess(a.config.persistence)?.get()).toBe('v-leader');
  });

  it('only the leader answers a woken follower', async () => {
    const { b } = await twoTabs();

    await tab({ recordId: 'C' });
    await flush();
    const seen = listen();

    await b.sync.resync();
    await flush();

    expect(seen.filter((m) => m.kind === 'state')).toHaveLength(1);
  });

  it('followers answer a woken successor that has saved once', async () => {
    const { a, b } = await twoTabs({ persistence: true });
    const c = await tab({ recordId: 'C', persistence: true });

    await flush();
    a.sync.destroy();
    await flush();
    expect(b.sync.role).toBe('leader');
    b.config.onSave?.({ blocks: [] }, apiStub);
    await flush();
    b.pauseInbound();
    c.fake.type('from c');
    await flush();
    b.resumeInbound();
    await b.sync.resync();
    await flush();

    expect(b.fake.text()).toContain('from c');
  });

  it('a leader with an edit that came in during its save still saves on unload and sends no heartbeat', async () => {
    const { a } = await twoTabs({ persistence: true });
    const seen = listen();

    a.fake.type('x');
    await flush();
    a.config.onSave?.({ blocks: [] }, apiStub);
    // The edit that landed while that save was in flight: the observer re-armed for it.
    a.fake.ModificationsObserver.hasUnsavedChanges = true;
    await flush();
    seen.length = 0;
    await a.sync.resync();
    await flush();
    a.sync.flushBeforeUnload();

    expect(seen.filter((m) => m.kind === 'saved')).toEqual([]);
    expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a woken leader with unsaved edits does not tell followers they are saved', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    b.fake.type('x');
    await flush();
    await a.sync.resync();
    await flush();

    expect(seen.filter((m) => m.kind === 'saved')).toEqual([]);
  });

  it('a joiner takes a version the leader saved while it was adopting', async () => {
    const a = await tab({ recordId: 'A', persistence: true });
    const b = makeTab(platform, { recordId: 'B', persistence: true });
    const gate: { open: () => void } = { open: () => undefined };

    b.fake.BlockManager.clear.mockImplementationOnce(() => new Promise<void>((resolve) => {
      gate.open = resolve;
    }));
    await b.sync.start(CONTEXT);
    await settle();
    a.config.onSave?.({ blocks: [] }, apiStub);
    await flush();
    gate.open();
    await flush();

    expect(b.sync.role).toBe('follower');
    expect(persistenceVersionAccess(b.config.persistence)?.get()).toBe('v-next');
  });

  it('followers take the version the leader saved', async () => {
    const { a, b } = await twoTabs({ persistence: true });

    a.config.onSave?.({ blocks: [] }, apiStub);
    await flush();

    expect(persistenceVersionAccess(b.config.persistence)?.get()).toBe('v-next');
  });

  it('a follower flushes its write buffer on unload, without saving', async () => {
    const { b } = await twoTabs();

    b.fake.YjsManager.flushPendingBlockWrites.mockClear();
    b.sync.flushBeforeUnload();

    expect(b.fake.YjsManager.flushPendingBlockWrites).toHaveBeenCalled();
    expect(b.fake.ModificationsObserver.flushNow).not.toHaveBeenCalled();
  });

  it('a follower posts its buffered typing on unload', async () => {
    const { a, b } = await twoTabs();

    b.fake.typeBuffered('last words');
    b.sync.flushBeforeUnload();
    await flush();

    expect(a.fake.text()).toBe('last words');
  });

  it('a follower destroyed without pagehide still posts its buffered typing', async () => {
    const { a, b } = await twoTabs();

    b.fake.typeBuffered('last words');
    b.sync.destroy();
    await flush();

    expect(a.fake.text()).toBe('last words');
  });

  it('a leader saves typing still in its write buffer on unload', async () => {
    const { a } = await twoTabs();

    a.fake.typeBuffered('x');
    a.sync.flushBeforeUnload();

    expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a leader with nothing unsaved does not save on unload', async () => {
    const { a } = await twoTabs({ persistence: true });

    a.fake.type('x');
    await flush();
    a.config.onSave?.({ blocks: [] }, apiStub);
    await flush();
    a.sync.flushBeforeUnload();

    expect(a.fake.ModificationsObserver.flushNow).not.toHaveBeenCalled();
  });

  it('a failing remote update drops this tab to solo with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { a, b } = await twoTabs();

    b.fake.YjsManager.applyRemoteUpdate.mockImplementation(() => {
      throw new Error('bad update');
    });
    a.fake.type('x');
    a.fake.type('y');
    await flush();

    expect(b.sync.role).toBe('solo');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(platform.openChannels(KEY)).toBe(1);
  });

  it('a failing diff answer drops this tab to solo with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { a, b } = await twoTabs();

    b.pauseInbound();
    a.fake.type('while asleep');
    await flush();
    b.resumeInbound();
    b.fake.YjsManager.applyRemoteUpdate.mockImplementation(() => {
      throw new Error('bad update');
    });
    await b.sync.resync();
    await flush();

    expect(b.sync.role).toBe('solo');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an edit made after adoption still reaches the other tab', async () => {
    const { a, b } = await twoTabs();

    b.fake.type(' from b');
    await flush();

    expect(a.fake.text()).toBe(' from b');
  });

  describe('carried rulings', () => {
    it('a joiner whose block save is still running when the answer comes keeps the typing and stays solo', async () => {
      await tab({ recordId: 'A', seedText: 'leader' });
      const b = makeTab(platform, { recordId: 'B', seedText: 'base' });

      const finishSave = b.fake.startBlockSave('!');

      await b.sync.start(CONTEXT);
      await settle();
      expect(b.sync.role).toBe('joining');
      finishSave();
      await flush();

      expect(b.sync.role).toBe('solo');
      expect(b.fake.text()).toBe('base!');
      expect(b.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
    });

    it('a joiner whose block save never settles stays solo after the join timeout', async () => {
      await tab({ recordId: 'A', seedText: 'leader' });
      const b = makeTab(platform, { recordId: 'B', seedText: 'base' });

      b.fake.startBlockSave('!');
      await b.sync.start(CONTEXT);
      await settle();
      await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);

      expect(b.sync.role).toBe('solo');
      expect(b.fake.text()).toBe('base');
      expect(b.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
    });

    it('a solo tab with edits that becomes editable never takes the lock', async () => {
      const b = await tab({ recordId: 'B', readOnly: true });

      await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
      expect(b.sync.role).toBe('solo');

      b.fake.type('mine');
      b.fake.ReadOnly.isEnabled = false;
      b.sync.toggleReadOnly(false);
      await flush();

      expect(b.sync.role).toBe('solo');
      expect(platform.holders.size).toBe(0);
    });

    it('a tab that turns read-only while it asks for the lock does not lead', async () => {
      const b = makeTab(platform, { recordId: 'B' });
      const lockOf = platform.lock.bind(platform);

      b.sync.setPlatform({
        ...platform,
        lock: (key): LeaderLock | null => {
          const lock = lockOf(key);

          return lock === null
            ? null
            : {
              ...lock,
              tryAcquire: async () => {
                const acquired = await lock.tryAcquire();

                b.fake.ReadOnly.isEnabled = true;

                return acquired;
              },
            };
        },
      });
      await b.sync.start(CONTEXT);
      await settle();

      expect(b.sync.role).not.toBe('leader');
      expect(platform.holders.size).toBe(0);
    });
  });
});
