import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLAIM_SETTLE_MS,
  CLAIM_TIMEOUT_MS,
  JOIN_TIMEOUT_MS,
  TabSync,
  TAKEOVER_SETTLE_WAIT_MS,
  YIELD_SAVE_WAIT_MS,
} from '../../../../../src/components/modules/tabSync';
import { resolveTabKey } from '../../../../../src/components/modules/tabSync/identity';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';
import type { TabChannel } from '../../../../../src/components/modules/tabSync/platform';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { expandPersistenceConfig, persistenceVersionAccess } from '../../../../../src/components/utils/persistence';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { API, BlokConfig } from '../../../../../types';

import { createFakeActivity, createFakeBlok, createFakePlatform } from './fakes';

type FakeBlok = ReturnType<typeof createFakeBlok>;
type FakePlatform = ReturnType<typeof createFakePlatform>;

interface Tab {
  sync: TabSync;
  fake: FakeBlok;
  config: BlokConfig;
  /** The endpoint this tab's save queue writes to. */
  save: ReturnType<typeof vi.fn>;
  activity: ReturnType<typeof createFakeActivity>;
  pauseInbound: () => void;
  resumeInbound: () => void;
}

const CONTEXT = { loadedFromPersistence: true, isEmpty: false };

const KEY = resolveTabKey({ documentId: 'doc', recordId: null, idSource: 'host', hasSaved: false, isEmpty: false, pathname: '/' }) ?? 'missing-key';

const apiStub = {} as unknown as API;

/**
 * A tab whose `flushNow` really pumps its save queue, so a save has a
 * version and can be in flight.
 */
interface TabOptions {
  recordId?: string;
  readOnly?: boolean;
  version?: string;
  failSteal?: boolean;
  /** Called as a steal starts; the steal then takes 20 ms. */
  onSlowSteal?: () => void;
}

const makeTab = (platform: FakePlatform, options: TabOptions = {}): Tab => {
  const fake = createFakeBlok({ recordId: options.recordId, readOnly: options.readOnly });
  const save = vi.fn(async () => ({ version: options.version ?? 'v-saved' }));
  const config = expandPersistenceConfig({ documentId: 'doc', persistence: { load: async () => null, save } });
  const sync = new TabSync({ config, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });
  const activity = createFakeActivity();
  const own: { channel: TabChannel | null } = { channel: null };

  fake.ModificationsObserver.flushNow.mockImplementation(() => {
    fake.ModificationsObserver.hasUnsavedChanges = false;
    fake.ModificationsObserver.hasPendingSave = false;
    config.onSave?.({ blocks: [] }, apiStub);
  });
  sync.state = fake as unknown as BlokModules;
  sync.setPlatform({
    ...platform,
    activity: () => activity,
    lock: (key) => {
      const lock = platform.lock(key);

      if (lock === null) {
        return null;
      }
      if (options.failSteal === true) {
        return { ...lock, steal: () => Promise.reject(new Error('steal refused')) };
      }
      const { onSlowSteal } = options;

      return onSlowSteal === undefined
        ? lock
        : {
          ...lock,
          steal: async () => {
            onSlowSteal();
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });

            return lock.steal();
          },
        };
    },
    channel: (key) => {
      own.channel = platform.channel(key);

      return own.channel;
    },
  });

  return {
    sync,
    fake,
    config,
    save,
    activity,
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

/** A local edit the leader's observer has not saved yet. */
const editUnsaved = ({ fake }: Tab, text: string): void => {
  const observer = fake.ModificationsObserver;

  fake.type(text);
  observer.hasUnsavedChanges = true;
  observer.hasPendingSave = true;
};

const version = (tab: Tab): string | null | undefined => persistenceVersionAccess(tab.config.persistence)?.get();

/** The last role the observer was told about, with its options. */
const lastRole = (tab: Tab): unknown[] | undefined => tab.fake.ModificationsObserver.onRoleChanged.mock.lastCall;

describe('TabSync — the leader follows the tab the user works in', () => {
  let platform: FakePlatform;
  const tabs: Tab[] = [];

  const tab = async (options: TabOptions & { active?: boolean } = {}): Promise<Tab> => {
    const t = makeTab(platform, options);

    if (options.active === true) {
      t.activity.set(true);
    }
    tabs.push(t);
    await t.sync.start(CONTEXT);

    return t;
  };

  /** A leader A and a follower B, both idle and inactive. */
  const twoTabs = async (): Promise<{ a: Tab; b: Tab }> => {
    const a = await tab({ recordId: 'A', version: 'v-a' });
    const b = await tab({ recordId: 'B', version: 'v-b' });

    await vi.advanceTimersByTimeAsync(0);
    expect(a.sync.role).toBe('leader');
    expect(b.sync.role).toBe('follower');

    return { a, b };
  };

  /** Everything posted on KEY from now on. */
  const listen = (): TabMessage[] => {
    const seen: TabMessage[] = [];

    platform.channel(KEY)?.onMessage((message) => seen.push(message));

    return seen;
  };

  const kinds = (seen: TabMessage[], kind: TabMessage['kind']): TabMessage[] => seen.filter((message) => message.kind === kind);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    platform = createFakePlatform();
  });

  afterEach(() => {
    tabs.splice(0).forEach((t) => t.sync.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a follower that stays active claims after the settle delay and becomes leader', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS - 1);
    expect(kinds(seen, 'claim')).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(kinds(seen, 'claim')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
    expect(platform.holders.size).toBe(1);
    // Nothing was ever saved, so there is no version to pass on.
    expect(kinds(seen, 'yield')).toEqual([expect.objectContaining({ to: expect.any(String), version: null })]);
  });

  /** A local render in `tab` that runs until the returned function ends it. */
  const holdRender = (t: Tab): (() => void) => {
    const { Renderer } = t.fake;
    const end = { run: (): void => undefined };

    Renderer.pendingRender = new Promise<void>((resolve) => {
      end.run = () => {
        Renderer.pendingRender = null;
        resolve();
      };
    });

    return () => end.run();
  };

  it('a follower claims only once its local render ends', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();
    const endRender = holdRender(b);

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 1000);

    expect(kinds(seen, 'claim')).toEqual([]);

    endRender();
    await vi.advanceTimersByTimeAsync(0);

    expect(kinds(seen, 'claim')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
  });

  it('a follower that goes inactive while its render runs does not claim when it ends', async () => {
    const { b } = await twoTabs();
    const seen = listen();
    const endRender = holdRender(b);

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);
    b.activity.set(false);
    endRender();
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 2);

    expect(kinds(seen, 'claim')).toEqual([]);
    expect(b.sync.role).toBe('follower');
  });

  it('a leader yields only once its local render ends', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();
    const endRender = holdRender(a);

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 1000);

    expect(kinds(seen, 'yield')).toEqual([]);
    expect(a.sync.role).toBe('leader');

    endRender();
    await vi.advanceTimersByTimeAsync(100);

    expect(kinds(seen, 'yield')).toHaveLength(1);
    expect(b.sync.role).toBe('leader');
  });

  it('a leader whose render outlasts the yield deadline posts no yield; the claimant steals', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    holdRender(a);
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 100);

    expect(kinds(seen, 'yield')).toEqual([]);

    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS);

    expect(kinds(seen, 'yield')).toEqual([]);
    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
  });

  it('a follower that loses focus within the settle delay does not claim', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS - 100);
    b.activity.set(false);
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 2);

    expect(kinds(seen, 'claim')).toEqual([]);
    expect(a.sync.role).toBe('leader');
    expect(b.sync.role).toBe('follower');
  });

  it('the leader saves its unsaved edit before it yields; the claimant saves once to bring its bindings up to date', async () => {
    const { a, b } = await twoTabs();

    editUnsaved(a, 'unsaved');
    a.fake.typeBuffered(' buffered');
    await vi.advanceTimersByTimeAsync(0);
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);

    expect(b.sync.role).toBe('leader');
    expect(b.fake.text()).toBe('unsaved buffered');
    expect(a.save).toHaveBeenCalledTimes(1);
    // The saved version travels with the hand-over: B's If-Match below is right.
    // One save after the hand-over: onSave bindings in the new tab are current at once.
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledWith({ blocks: [] }, { version: 'v-a' });
  });

  it('a leader whose observer saved everything does not save again before it yields', async () => {
    const { a, b } = await twoTabs();

    // Typing that reached the document after the observer had already saved it.
    a.fake.type('late write');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);

    expect(b.sync.role).toBe('leader');
    expect(a.save).not.toHaveBeenCalled();
  });

  it('a leader with an edit queued behind its running save saves that edit before it yields', async () => {
    const { a, b } = await twoTabs();
    const landed: { resolve: () => void } = { resolve: () => undefined };

    a.save.mockImplementationOnce(() => new Promise((resolve) => {
      landed.resolve = () => resolve({ version: 'v-first' });
    }));
    a.fake.type('first');
    a.fake.ModificationsObserver.flushNow();
    // A second edit waits for its own save while the first one runs.
    a.fake.type(' second');
    a.fake.ModificationsObserver.hasPendingSave = true;
    a.fake.ModificationsObserver.flushNow.mockClear();
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    landed.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(b.sync.role).toBe('leader');
    expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
    expect(a.save).toHaveBeenCalledTimes(2);
  });

  it('the leader yields only after its in-flight save lands', async () => {
    const { a, b } = await twoTabs();
    const landed: { resolve: () => void } = { resolve: () => undefined };
    const seen = listen();

    a.save.mockImplementationOnce(() => new Promise((resolve) => {
      landed.resolve = () => resolve({ version: 'v-late' });
    }));
    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 500);

    expect(kinds(seen, 'yield')).toEqual([]);
    expect(a.sync.role).toBe('leader');

    landed.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(kinds(seen, 'yield')).toEqual([expect.objectContaining({ version: 'v-late' })]);
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledWith({ blocks: [] }, { version: 'v-late' });
  });

  /** A's observer serializes until the returned function ends it. */
  const holdSerialization = (a: Tab): (() => void) => {
    const observer = a.fake.ModificationsObserver;
    const end = { run: (): void => undefined };
    const settled = new Promise<void>((resolve) => {
      end.run = () => {
        observer.isSaving = false;
        resolve();
      };
    });

    observer.isSaving = true;
    observer.whenSavesSettled.mockImplementation(() => (observer.isSaving ? settled : Promise.resolve()));

    return () => end.run();
  };

  it('a serialization still running at the deadline: the yield says saving, and the new leader saves only once it is dropped', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();
    const endSerialization = holdSerialization(a);

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 100);

    expect(kinds(seen, 'yield')).toEqual([expect.objectContaining({ saving: true })]);
    expect(a.sync.role).toBe('follower');
    expect(b.sync.role).toBe('follower');
    expect(b.save).not.toHaveBeenCalled();

    endSerialization();
    await vi.advanceTimersByTimeAsync(0);

    expect(kinds(seen, 'settled')).toEqual([expect.objectContaining({ ok: false })]);
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);
  });

  it('a claimant waiting for the old leader keeps its own edits, and drops them when the wait is cancelled', async () => {
    const { a, b } = await twoTabs();
    const endSerialization = holdSerialization(a);

    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 100);
    expect(b.sync.role).toBe('follower');
    expect(b.fake.ModificationsObserver.keepLocalEdits.mock.calls).toEqual([[true]]);

    b.fake.ReadOnly.isEnabled = true;
    b.sync.toggleReadOnly(true);
    expect(b.fake.ModificationsObserver.keepLocalEdits.mock.lastCall).toEqual([false]);
    endSerialization();
  });

  it('a serialization and a request both out at the deadline: one report, after both', async () => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-slow');
    const seen = listen();

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    const endSerialization = holdSerialization(a);

    await vi.advanceTimersByTimeAsync(YIELD_SAVE_WAIT_MS + 100);
    expect(kinds(seen, 'yield')).toEqual([expect.objectContaining({ saving: true })]);

    request.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(kinds(seen, 'settled')).toEqual([]);
    expect(b.sync.role).toBe('follower');

    endSerialization();
    await vi.advanceTimersByTimeAsync(0);

    expect(kinds(seen, 'settled')).toHaveLength(1);
    expect(b.sync.role).toBe('leader');
  });

  /** Holds A's next save; the returned functions land or fail it. */
  const holdRequest = (a: Tab, version: string): { land: () => void; fail: () => void } => {
    const held = { land: (): void => undefined, fail: (): void => undefined };

    a.save.mockImplementationOnce(() => new Promise((resolve, reject) => {
      held.land = () => resolve({ version });
      held.fail = () => reject(new Error('conflict'));
    }));

    return held;
  };

  /** A leader A whose save is still out when it yields to B at the deadline. */
  const yieldWhileSaving = async (): Promise<{ a: Tab; b: Tab; request: { land: () => void; fail: () => void }; seen: TabMessage[] }> => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-slow');
    const seen = listen();

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 100);

    return { a, b, request, seen };
  };

  it('a save still running at the deadline: the leader yields, keeps its edit, and the new leader saves only after it lands', async () => {
    const { a, b, request, seen } = await yieldWhileSaving();

    expect(kinds(seen, 'yield')).toEqual([expect.objectContaining({ saving: true })]);
    expect(a.sync.role).toBe('follower');
    // The observer holds nothing unsaved: the request is the store's, and B saves after it.
    expect(lastRole(a)).toEqual(['follower']);
    expect(b.save).not.toHaveBeenCalled();

    request.land();
    await vi.advanceTimersByTimeAsync(0);

    // Posted although A no longer leads: B's first save needs this version.
    expect(kinds(seen, 'saved')[0]).toEqual(expect.objectContaining({ version: 'v-slow' }));
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenLastCalledWith({ blocks: [] }, { version: 'v-slow' });
  });

  it('when the old leader\'s request fails, it never retries it, and the new leader saves after the notice', async () => {
    const { a, b, request, seen } = await yieldWhileSaving();

    request.fail();
    await vi.advanceTimersByTimeAsync(0);

    expect(kinds(seen, 'settled')).toEqual([expect.objectContaining({ ok: false })]);
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);

    // B's save moved the version A follows; a retry would now pass its If-Match.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(version(a)).toBe('v-b');
    expect(a.save).toHaveBeenCalledTimes(1);
  });

  it('the new leader saves after 10 s when the old leader never reports back', async () => {
    const { a, b } = await yieldWhileSaving();

    a.pauseInbound();
    await vi.advanceTimersByTimeAsync(TAKEOVER_SETTLE_WAIT_MS - 200);
    expect(b.save).not.toHaveBeenCalled();
    expect(b.sync.role).toBe('follower');

    await vi.advanceTimersByTimeAsync(200);
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);
  });

  it('a leader whose lock was stolen never retries its failed save', async () => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-a2');

    editUnsaved(a, 'x');
    a.fake.ModificationsObserver.flushNow();
    a.pauseInbound();
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS + 100);
    expect(a.sync.role).toBe('follower');
    a.resumeInbound();
    await vi.advanceTimersByTimeAsync(0);

    request.fail();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(a.save).toHaveBeenCalledTimes(1);
  });

  it('an edit that lands in the yielding leader while it waits is saved before it yields', async () => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-a');

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    // Lands after the first serialization started.
    a.fake.ModificationsObserver.hasPendingSave = true;
    request.land();
    await vi.advanceTimersByTimeAsync(200);

    expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(2);
    expect(a.save).toHaveBeenCalledTimes(2);
    expect(b.sync.role).toBe('leader');
  });

  it('a save that lands while the claimant is still stealing ends its wait at once, with that version', async () => {
    const a = await tab({ recordId: 'A' });
    const request = holdRequest(a, 'v-slow');
    const b = await tab({ recordId: 'B', version: 'v-b', onSlowSteal: () => setTimeout(() => request.land(), 5) });

    await vi.advanceTimersByTimeAsync(0);
    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 200);

    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledWith({ blocks: [] }, { version: 'v-slow' });
  });

  it('a leader that turns read-only while it yields never retries its save', async () => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-a2');

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);
    a.fake.ReadOnly.isEnabled = true;
    a.sync.toggleReadOnly(true);
    await vi.advanceTimersByTimeAsync(100);
    request.fail();
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS + 5000);

    expect(b.sync.role).toBe('leader');
    expect(a.save).toHaveBeenCalledTimes(1);
  });

  describe('a leader that turns read-only with its last save out', () => {
    const turnReadOnly = ({ fake, sync }: Tab): void => {
      const { ReadOnly } = fake;

      ReadOnly.isEnabled = true;
      sync.toggleReadOnly(true);
    };

    /** A leader A whose request is out, and a follower B waiting in line. */
    const readOnlyWithRequestOut = async (): Promise<{ a: Tab; b: Tab; request: { land: () => void; fail: () => void } }> => {
      const { a, b } = await twoTabs();
      const request = holdRequest(a, 'v-a2');

      editUnsaved(a, 'x');
      a.fake.ModificationsObserver.flushNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.save).toHaveBeenCalledTimes(1);
      turnReadOnly(a);
      await vi.advanceTimersByTimeAsync(1000);

      return { a, b, request };
    };

    it('keeps the lock until the request lands; the next leader then saves with its version', async () => {
      const { a, b, request } = await readOnlyWithRequestOut();

      expect(a.sync.role).toBe('follower');
      expect(b.sync.role).toBe('follower');
      expect(b.save).not.toHaveBeenCalled();

      request.land();
      await vi.advanceTimersByTimeAsync(100);

      expect(b.sync.role).toBe('leader');
      expect(b.save).toHaveBeenCalledWith({ blocks: [] }, { version: 'v-a2' });
    });

    it('never retries a request that fails; the next leader leads once it does', async () => {
      const { a, b, request } = await readOnlyWithRequestOut();

      request.fail();
      await vi.advanceTimersByTimeAsync(5000);

      expect(a.save).toHaveBeenCalledTimes(1);
      expect(b.sync.role).toBe('leader');
    });

    it('keeps the lock while a serialization runs, and gives it up once it ends', async () => {
      const { a, b } = await twoTabs();
      const endSerialization = holdSerialization(a);

      turnReadOnly(a);
      await vi.advanceTimersByTimeAsync(1000);
      expect(b.sync.role).toBe('follower');

      endSerialization();
      await vi.advanceTimersByTimeAsync(100);

      expect(b.sync.role).toBe('leader');
    });

    it('gives the lock up after 10 s when the request never settles', async () => {
      const { b } = await readOnlyWithRequestOut();

      await vi.advanceTimersByTimeAsync(TAKEOVER_SETTLE_WAIT_MS - 1100);
      expect(b.sync.role).toBe('follower');

      await vi.advanceTimersByTimeAsync(200);
      expect(b.sync.role).toBe('leader');
    });

    it('clears its 10 s bound when it is torn down', async () => {
      const { a } = await readOnlyWithRequestOut();
      const before = vi.getTimerCount();

      a.sync.destroy();

      expect(vi.getTimerCount()).toBe(before - 1);
    });

    it('leads again, without giving up the lock, when it turns editable before the request settles', async () => {
      const { a, b, request } = await readOnlyWithRequestOut();

      a.fake.ReadOnly.isEnabled = false;
      a.sync.toggleReadOnly(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(a.sync.role).toBe('leader');

      request.land();
      await vi.advanceTimersByTimeAsync(TAKEOVER_SETTLE_WAIT_MS);

      expect(a.sync.role).toBe('leader');
      expect(b.sync.role).toBe('follower');
      expect(platform.holders.size).toBe(1);
    });
  });

  describe('the yielding leader never spins', () => {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

    /** A leader A in the middle of a yield, its save held. Real timers: a spin blocks them. */
    const yieldingWithHeldSave = async (): Promise<{ a: Tab; request: { land: () => void; fail: () => void } }> => {
      vi.useRealTimers();
      const a = await tab({ recordId: 'A' });
      const b = await tab({ recordId: 'B' });

      await sleep(10);
      const request = holdRequest(a, 'v-slow');

      editUnsaved(a, 'x');
      b.activity.set(true);
      await sleep(CLAIM_SETTLE_MS + 200);
      expect(a.save).toHaveBeenCalledTimes(1);

      return { a, request };
    };

    /** How late a short timer fires after the held save lands. */
    const blockedAfterLanding = async (request: { land: () => void }): Promise<number> => {
      const start = Date.now();

      request.land();
      await sleep(100);

      return Date.now() - start;
    };

    it('when a save cannot start because the leader turned read-only', async () => {
      const { a, request } = await yieldingWithHeldSave();

      a.fake.ReadOnly.isEnabled = true;
      a.sync.toggleReadOnly(true);
      a.fake.ModificationsObserver.flushNow.mockImplementation(() => undefined);
      a.fake.ModificationsObserver.hasPendingSave = true;

      expect(await blockedAfterLanding(request)).toBeLessThan(1000);
      expect(a.fake.ModificationsObserver.flushNow.mock.calls.length).toBeLessThan(20);
    });

    it('when a save cannot start while the leader still leads', async () => {
      const { a, request } = await yieldingWithHeldSave();

      // Delivery suppressed: flushNow starts nothing and the edit stays pending.
      a.fake.ModificationsObserver.flushNow.mockImplementation(() => undefined);
      a.fake.ModificationsObserver.hasPendingSave = true;

      expect(await blockedAfterLanding(request)).toBeLessThan(1000);
      expect(a.fake.ModificationsObserver.flushNow.mock.calls.length).toBeLessThan(20);
    });
  });

  it('a claimant whose steal fails waits in line again', async () => {
    const a = await tab({ recordId: 'A' });
    const b = await tab({ recordId: 'B', failSteal: true });

    await vi.advanceTimersByTimeAsync(0);

    b.activity.set(true);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);
    expect(b.sync.role).toBe('follower');
    a.sync.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(b.sync.role).toBe('leader');
  });

  /** Holds A's next save until the returned function lands it. */
  const holdSave = (a: Tab): (() => void) => {
    const landed: { resolve: () => void } = { resolve: () => undefined };

    a.save.mockImplementationOnce(() => new Promise((resolve) => {
      landed.resolve = () => resolve({ version: 'v-a' });
    }));

    return () => landed.resolve();
  };

  it('the new leader saves an edit it made while the hand-over ran', async () => {
    const { a, b } = await twoTabs();
    const land = holdSave(a);

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    b.fake.type(' during hand-over');
    land();
    await vi.advanceTimersByTimeAsync(100);

    expect(b.sync.role).toBe('leader');
    expect(a.fake.text()).toBe('x during hand-over');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('the new leader saves even when a save was already in flight when it took over', async () => {
    const { a, b } = await twoTabs();
    const land = holdSave(a);

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    b.fake.type(' during hand-over');
    b.fake.ModificationsObserver.isSaving = true;
    land();
    await vi.advanceTimersByTimeAsync(100);

    expect(b.sync.role).toBe('leader');
    expect(b.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a frozen leader: the claimant steals after the timeout, and the old leader stops saving once it learns', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    a.pauseInbound();
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS - 1);
    expect(b.sync.role).toBe('follower');

    await vi.advanceTimersByTimeAsync(1);
    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
    expect(kinds(seen, 'yield')).toEqual([]);

    // The old leader's typing now goes to B, which saves it; A does not.
    a.resumeInbound();
    a.fake.ModificationsObserver.flushNow.mockClear();
    a.fake.type('after thaw');
    await vi.advanceTimersByTimeAsync(0);
    a.sync.flushBeforeUnload();

    expect(b.fake.text()).toBe('after thaw');
    expect(a.fake.ModificationsObserver.flushNow).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
  });

  it('a thief whose first save conflicts with the frozen leader\'s landed request retries with that request\'s version', async () => {
    const { a, b } = await twoTabs();
    const request = holdRequest(a, 'v-a2');

    editUnsaved(a, 'x');
    a.fake.ModificationsObserver.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.save).toHaveBeenCalledTimes(1);
    a.pauseInbound();
    b.save.mockRejectedValueOnce(new Error('conflict'));
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS);
    expect(b.sync.role).toBe('leader');
    expect(b.save).toHaveBeenCalledTimes(1);

    // The store applied A's write first; its answer reaches A only now.
    request.land();
    await vi.advanceTimersByTimeAsync(5000);

    expect(b.save.mock.calls.length).toBeGreaterThan(1);
    expect(b.save.mock.lastCall).toEqual([ { blocks: [] }, { version: 'v-a2' } ]);
  });

  it('a leader whose lock was stolen waits in line and leads again when the thief leaves', async () => {
    const { a, b } = await twoTabs();

    a.pauseInbound();
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS);
    a.resumeInbound();
    expect(a.sync.role).toBe('follower');

    b.sync.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(a.sync.role).toBe('leader');
  });

  it('a claimant that is gone before it takes the lock: the old leader leads again', async () => {
    const { a, b } = await twoTabs();

    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    // B goes while A still saves; A then yields into the void.
    b.sync.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(a.sync.role).toBe('follower');
    a.fake.ModificationsObserver.flushNow.mockClear();
    a.fake.type('y');

    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS);

    expect(a.sync.role).toBe('leader');
    expect(a.fake.ModificationsObserver.flushNow).toHaveBeenCalledTimes(1);
  });

  it('a claimant that turns read-only before the yield arrives does not take the lock', async () => {
    const { a, b } = await twoTabs();

    // A's save hangs, so its yield comes only at the deadline.
    a.save.mockImplementationOnce(() => new Promise(() => undefined));
    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    b.fake.ReadOnly.isEnabled = true;
    b.sync.toggleReadOnly(true);
    await vi.advanceTimersByTimeAsync(YIELD_SAVE_WAIT_MS + CLAIM_TIMEOUT_MS + 100);

    expect(b.sync.role).toBe('follower');
    expect(a.sync.role).toBe('leader');
  });

  it('a read-only, solo or joining tab never claims', async () => {
    const a = await tab({ recordId: 'A' });
    const seen = listen();
    const readOnly = await tab({ recordId: 'R', readOnly: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(readOnly.sync.role).toBe('follower');
    readOnly.activity.set(true);

    // A frozen leader: the next tab stays joining, then goes solo.
    a.pauseInbound();
    const joiner = await tab({ recordId: 'J', active: true });

    joiner.activity.set(true);
    expect(joiner.sync.role).toBe('joining');
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    expect(joiner.sync.role).toBe('solo');
    joiner.activity.set(false);
    joiner.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 2);

    expect(kinds(seen, 'claim')).toEqual([]);
    expect(a.sync.role).toBe('leader');
  });

  it('a tab that is already active when it joins claims once it has joined', async () => {
    const a = await tab({ recordId: 'A' });
    const b = await tab({ recordId: 'B', active: true });

    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
  });

  it('the old leader does not claim back while it stays active', async () => {
    const a = await tab({ recordId: 'A', active: true });
    const b = await tab({ recordId: 'B', active: true });
    const seen = listen();

    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 3);

    expect(b.sync.role).toBe('leader');
    expect(a.sync.role).toBe('follower');
    expect(kinds(seen, 'claim')).toHaveLength(1);
  });

  it('a tab whose claim lost to another tab claims the new leader instead of stealing', async () => {
    const a = await tab({ recordId: 'A' });
    const b = await tab({ recordId: 'B' });
    const c = await tab({ recordId: 'C' });

    await vi.advanceTimersByTimeAsync(0);
    b.activity.set(true);
    c.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS * 3);
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 3);

    const leaders = [a, b, c].filter((t) => t.sync.role === 'leader');

    expect(leaders).toHaveLength(1);
    expect(platform.holders.size).toBe(1);
    // No steal: every hand-over was a yield, so no tab lost its lock by force.
    expect([a, b, c].filter((t) => t.sync.role === 'follower')).toHaveLength(2);
  });

  it('every follower learns the new leader, so they answer its wake hello', async () => {
    const { a, b } = await twoTabs();
    const c = await tab({ recordId: 'C' });

    await vi.advanceTimersByTimeAsync(0);
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sync.role).toBe('leader');

    b.pauseInbound();
    c.fake.type('from c');
    await vi.advanceTimersByTimeAsync(0);
    b.resumeInbound();
    await b.sync.resync();
    await vi.advanceTimersByTimeAsync(0);

    expect(b.fake.text()).toContain('from c');
    expect(a.sync.role).toBe('follower');
  });

  it('destroy stops a pending claim', async () => {
    const { a, b } = await twoTabs();
    const seen = listen();

    b.activity.set(true);
    b.sync.destroy();
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS);

    expect(kinds(seen, 'claim')).toEqual([]);
    expect(a.sync.role).toBe('leader');
  });
});
