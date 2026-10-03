import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLAIM_SETTLE_MS,
  CLAIM_TIMEOUT_MS,
  JOIN_TIMEOUT_MS,
  TabSync,
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
const makeTab = (platform: FakePlatform, options: { recordId?: string; readOnly?: boolean; version?: string } = {}): Tab => {
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

  const tab = async (options: { recordId?: string; readOnly?: boolean; version?: string; active?: boolean } = {}): Promise<Tab> => {
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

  it('the leader saves its unsaved edit once before it yields, and the claimant saves nothing more', async () => {
    const { a, b } = await twoTabs();

    editUnsaved(a, 'unsaved');
    a.fake.typeBuffered(' buffered');
    await vi.advanceTimersByTimeAsync(0);
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + 100);

    expect(b.sync.role).toBe('leader');
    expect(b.fake.text()).toBe('unsaved buffered');
    expect(a.save).toHaveBeenCalledTimes(1);
    // The saved version travels with the hand-over: B's next If-Match is right.
    expect(version(b)).toBe('v-a');
    expect(b.fake.ModificationsObserver.flushNow).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
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
    expect(version(b)).toBe('v-late');
  });

  it('a save still running at the deadline: the leader yields, keeps its edit, and the new leader retries with the late version', async () => {
    const { a, b } = await twoTabs();
    const landed: { resolve: () => void } = { resolve: () => undefined };
    const seen = listen();

    a.save.mockImplementationOnce(() => new Promise((resolve) => {
      landed.resolve = () => resolve({ version: 'v-slow' });
    }));
    // A versioned store refuses B's first save: it names a version A is still replacing.
    b.save.mockRejectedValueOnce(new Error('conflict'));
    editUnsaved(a, 'x');
    b.activity.set(true);
    await vi.advanceTimersByTimeAsync(CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 100);

    expect(kinds(seen, 'yield')).toHaveLength(1);
    expect(a.sync.role).toBe('follower');
    expect(b.sync.role).toBe('leader');
    expect(lastRole(a)).toEqual(['follower', { keepPendingSave: true }]);
    expect(b.save).toHaveBeenCalledTimes(1);

    landed.resolve();
    await vi.advanceTimersByTimeAsync(0);

    // Posted although A no longer leads: B's next save needs this version.
    expect(kinds(seen, 'saved')).toEqual([expect.objectContaining({ version: 'v-slow' })]);
    expect(version(b)).toBe('v-slow');
    await vi.advanceTimersByTimeAsync(600);
    expect(b.save).toHaveBeenLastCalledWith({ blocks: [] }, { version: 'v-slow' });
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
