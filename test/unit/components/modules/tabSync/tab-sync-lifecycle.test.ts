import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabSync } from '../../../../../src/components/modules/tabSync';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { expandPersistenceConfig } from '../../../../../src/components/utils/persistence';
import type { TabChannel } from '../../../../../src/components/modules/tabSync/platform';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlokConfig } from '../../../../../types';

import { createFakeBlok, createFakePlatform } from './fakes';

type FakeBlok = ReturnType<typeof createFakeBlok>;
type FakePlatform = ReturnType<typeof createFakePlatform>;

interface Tab { sync: TabSync; fake: FakeBlok; config: BlokConfig }

const CONTEXT = { loadedFromPersistence: true, isEmpty: false };

const apiStub = {} as unknown as API;

const flush = async (): Promise<void> => {
  await vi.runAllTimersAsync();
};

/**
 * @param platform - shared fake platform
 * @param options - tab setup
 * @param options.recordId - the tab's document id
 * @param options.minted - the id was minted by this tab
 * @param options.documentId - host id; omitted for auto mode
 */
const makeTab = (
  platform: FakePlatform,
  options: { recordId?: string; minted?: boolean; documentId?: string } = {}
): Tab => {
  const fake = createFakeBlok({ recordId: options.recordId, minted: options.minted });
  const config = expandPersistenceConfig({
    ...(options.documentId === undefined ? {} : { documentId: options.documentId }),
    persistence: { load: async () => null, save: vi.fn(async () => ({ version: 'v-next' })) },
  });
  const sync = new TabSync({ config, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  sync.state = fake as unknown as BlokModules;
  sync.setPlatform(platform);

  return { sync, fake, config };
};

describe('TabSync — page lifecycle and restart', () => {
  let platform: FakePlatform;
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  const started = async (options: { recordId?: string } = {}): Promise<Tab> => {
    const t = makeTab(platform, { documentId: 'doc', ...options });

    await t.sync.start(CONTEXT);
    await flush();

    return t;
  };

  const setVisibility = (value: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    platform = createFakePlatform();
  });

  afterEach(() => {
    if (visibility === undefined) {
      Reflect.deleteProperty(document, 'visibilityState');
    } else {
      Object.defineProperty(document, 'visibilityState', visibility);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('page lifecycle', () => {
    it('resyncs when the tab becomes visible and when it returns from the back/forward cache', async () => {
      const { sync } = await started();
      const resync = vi.spyOn(sync, 'resync').mockResolvedValue();

      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

      expect(resync).toHaveBeenCalledTimes(2);
      sync.destroy();
    });

    it('does not resync on a hidden tab or a fresh page load', async () => {
      const { sync } = await started();
      const resync = vi.spyOn(sync, 'resync').mockResolvedValue();

      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));

      expect(resync).not.toHaveBeenCalled();
      sync.destroy();
    });

    it('flushes on pagehide and forgets its listeners on destroy', async () => {
      const { sync } = await started();
      const flushSpy = vi.spyOn(sync, 'flushBeforeUnload');
      const resync = vi.spyOn(sync, 'resync').mockResolvedValue();

      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      expect(flushSpy).toHaveBeenCalledTimes(1);

      sync.destroy();
      setVisibility('visible');
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(resync).not.toHaveBeenCalled();
    });

    it('a tab with no key adds no lifecycle listeners', async () => {
      const t = makeTab(platform, { minted: true });
      const resync = vi.spyOn(t.sync, 'resync').mockResolvedValue();

      await t.sync.start({ loadedFromPersistence: false, isEmpty: false });
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      expect(resync).not.toHaveBeenCalled();
      t.sync.destroy();
    });
  });

  describe('minted id restart', () => {
    it('a tab that minted its id joins after its first save', async () => {
      const t = makeTab(platform, { minted: true });

      await t.sync.start({ loadedFromPersistence: false, isEmpty: false });
      await flush();
      expect(platform.holders.size).toBe(0);

      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(t.sync.role).toBe('leader');
      expect(platform.holders.size).toBe(1);
      t.sync.destroy();
    });

    it('a minted tab that was empty at boot joins once it has content and saved', async () => {
      const t = makeTab(platform, { minted: true });

      await t.sync.start({ loadedFromPersistence: false, isEmpty: true });
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(t.sync.role).toBe('leader');
      t.sync.destroy();
    });

    it('a minted tab that is still empty waits for a later save', async () => {
      const t = makeTab(platform, { minted: true });

      t.fake.BlockManager.blocks = [{ isEmpty: true }];
      await t.sync.start({ loadedFromPersistence: false, isEmpty: true });
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();
      expect(platform.holders.size).toBe(0);

      t.fake.BlockManager.blocks = [{ isEmpty: false }];
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(t.sync.role).toBe('leader');
      t.sync.destroy();
    });

    it('a raw data document never joins, even after a save', async () => {
      const t = makeTab(platform, { minted: false });

      await t.sync.start({ loadedFromPersistence: false, isEmpty: false });
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(t.sync.role).toBe('solo');
      expect(platform.holders.size).toBe(0);
      t.sync.destroy();
    });

    it('a destroyed minted tab does not join on a late save', async () => {
      const t = makeTab(platform, { minted: true });

      await t.sync.start({ loadedFromPersistence: false, isEmpty: false });
      t.sync.destroy();
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(platform.holders.size).toBe(0);
    });

    it('a restarted minted tab keeps its saved edits instead of adopting another tab', async () => {
      const recordId = 'minted-id';
      const other = makeTab(platform, { recordId });

      // Another tab already leads this id, e.g. it loaded the first save.
      await other.sync.start(CONTEXT);
      await flush();
      other.fake.type('theirs');
      const t = makeTab(platform, { minted: true, recordId });

      t.fake.type('mine');
      await t.sync.start({ loadedFromPersistence: false, isEmpty: false });
      await t.config.onSave?.({ blocks: [] }, apiStub);
      await flush();

      expect(t.fake.text()).toBe('mine');
      expect(t.fake.YjsManager.resetForRelineage).not.toHaveBeenCalled();
      expect(t.sync.role).toBe('solo');
      t.sync.destroy();
      other.sync.destroy();
    });
  });

  describe('carried rulings', () => {
    it('a tab that failed never rejoins when it is started again', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const a = await started({ recordId: 'A' });
      const b = await started({ recordId: 'B' });
      const apply = b.fake.YjsManager.applyRemoteUpdate.getMockImplementation();

      b.fake.YjsManager.applyRemoteUpdate.mockImplementation(() => {
        throw new Error('bad update');
      });
      a.fake.type('x');
      await flush();
      expect(b.sync.role).toBe('solo');
      expect(warn).toHaveBeenCalledTimes(1);

      if (apply !== undefined) {
        b.fake.YjsManager.applyRemoteUpdate.mockImplementation(apply);
      }
      await b.sync.start(CONTEXT);
      await flush();

      expect(b.sync.role).toBe('solo');
      expect(b.fake.YjsManager.resetForRelineage).toHaveBeenCalledTimes(1);
      a.sync.destroy();
      b.sync.destroy();
    });

    it('a woken leader that took a diff saves it on unload', async () => {
      const a = makeTab(platform, { documentId: 'doc', recordId: 'A' });
      const own: { channel: TabChannel | null } = { channel: null };

      a.sync.setPlatform({
        ...platform,
        channel: (key) => {
          own.channel = platform.channel(key);

          return own.channel;
        },
      });
      await a.sync.start(CONTEXT);
      const b = await started({ recordId: 'B' });

      if (own.channel === null) {
        throw new Error('no channel');
      }
      platform.pauseInbound(own.channel);
      b.fake.type('from b');
      await flush();
      platform.resumeInbound(own.channel);
      await a.sync.resync();
      await flush();
      expect(a.fake.text()).toContain('from b');

      a.sync.flushBeforeUnload();

      expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
      a.sync.destroy();
      b.sync.destroy();
    });
  });
});
