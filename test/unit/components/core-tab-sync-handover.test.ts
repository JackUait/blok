import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Core } from '../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { persistenceVersionAccess, releasePersistenceQueue } from '../../../src/components/utils/persistence';
import { Paragraph } from '../../../src/tools';
import { browserTabPlatform } from '../../../src/components/modules/tabSync/platform';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import type { TabChannel } from '../../../src/components/modules/tabSync/platform';
import { resolveTabKey } from '../../../src/components/modules/tabSync/identity';
import { CLAIM_SETTLE_MS, CLAIM_TIMEOUT_MS, YIELD_SAVE_WAIT_MS } from '../../../src/components/modules/tabSync';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../types';

import { createFakeActivity } from './modules/tabSync/fakes';
import type { createFakePlatform } from './modules/tabSync/fakes';

// jsdom has no navigator.locks, so the browser platform would never open a session.
vi.mock('../../../src/components/modules/tabSync/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformModule>();
  const { createFakePlatform } = await import('./modules/tabSync/fakes');

  return { ...actual, browserTabPlatform: createFakePlatform() };
});

type FakeActivity = ReturnType<typeof createFakeActivity>;

const cores: Core[] = [];

const paragraph = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id } });

const document3 = (): OutputData => ({ blocks: [paragraph('a'), paragraph('b'), paragraph('c')] });

const createCore = (extra: Partial<BlokConfig>): Core => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({ holder, logLevel: 'ERROR', tools: { paragraph: Paragraph }, ...extra } as BlokConfig);

  cores.push(core);

  return core;
};

/** Same teardown as Blok.destroy() minus markDestroyed: every module, in map order. */
const destroyCore = (core: Core): void => {
  releasePersistenceQueue(core.config.persistence);
  Object.values(core.moduleInstances).forEach((module) => {
    if (typeof (module as { destroy?: unknown }).destroy === 'function') {
      (module as { destroy: () => void }).destroy();
    }
  });
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const ids = (core: Core): string[] => core.moduleInstances.BlockManager.blocks.map((block) => block.id);

const docIds = (core: Core): string[] => core.moduleInstances.YjsManager.orderedIds();

/** Polls until `check` passes; the tests wait on state, not on a clock. */
const until = (check: () => void, timeout = 3000): Promise<void> => vi.waitFor(check, { timeout, interval: 20 });

/** One batch window, plus room for the message hop and the serialization. */
const oneWindow = (): Promise<void> => wait(modificationsObserverBatchTimeout + 150);

const savedIds = (call: unknown[] | undefined): string[] | undefined =>
  (call?.[0] as OutputData | undefined)?.blocks.map((block) => block.id ?? '');

const savedText = (call: unknown[] | undefined, id: string): unknown =>
  (call?.[0] as OutputData | undefined)?.blocks.find((block) => block.id === id)?.data.text;

interface Pair {
  leader: Core;
  follower: Core;
  leaderActivity: FakeActivity;
  followerActivity: FakeActivity;
  leaderSave: ReturnType<typeof vi.fn>;
  followerSave: ReturnType<typeof vi.fn>;
}

/** A leader and a follower, each with its own onSave and an activity the test sets. */
const twoEditors = async (documentId: string): Promise<Pair> => {
  const leaderActivity = createFakeActivity();
  const followerActivity = createFakeActivity();
  const leaderSave = vi.fn();
  const followerSave = vi.fn();
  const activity = vi.spyOn(browserTabPlatform, 'activity');

  activity.mockImplementationOnce(() => leaderActivity);
  const leader = createCore({ documentId, data: document3(), onSave: leaderSave });

  await leader.isReady;
  await wait(50);
  activity.mockImplementationOnce(() => followerActivity);
  const follower = createCore({ documentId, data: document3(), onSave: followerSave });

  await follower.isReady;
  await wait(100);
  expect(leader.moduleInstances.TabSync.role).toBe('leader');
  expect(follower.moduleInstances.TabSync.role).toBe('follower');
  leaderSave.mockClear();
  followerSave.mockClear();

  return { leader, follower, leaderActivity, followerActivity, leaderSave, followerSave };
};

/**
 * The next Renderer.render of `core` first runs `during`, then waits past the
 * claim settle delay: the hand-over runs between the render's clear and its fill.
 * @param core - the rendering tab
 * @param during - what happens right after the clear
 */
const handOverMidRender = (core: Core, during: () => void): void => {
  const { Renderer } = core.moduleInstances;
  const render = Renderer.render.bind(Renderer);

  vi.spyOn(Renderer, 'render').mockImplementationOnce(async (...args) => {
    during();
    await wait(CLAIM_SETTLE_MS + 100);

    return render(...args);
  });
};

/** Types into block `id` through the page, as a user does. */
const type = async (core: Core, id: string, text: string): Promise<void> => {
  const editable = core.moduleInstances.BlockManager.getBlockById(id)?.pluginsContent;

  expect(editable).toBeInstanceOf(HTMLElement);
  if (editable instanceof HTMLElement) {
    editable.textContent = text;
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  // Past the write buffer's flush.
  await wait(500);
};

describe('Core — a render that overlaps a hand-over', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a follower that claims while it renders leaves exactly the rendered blocks in both tabs, and its typing survives a switch back', async () => {
    const { leader, follower, leaderActivity, followerActivity, leaderSave, followerSave } = await twoEditors('render-while-claiming');

    handOverMidRender(follower, () => followerActivity.set(true));
    await follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await until(() => expect(savedIds(followerSave.mock.lastCall)).toEqual(['x', 'y']));

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(ids(follower)).toEqual(['x', 'y']);
    expect(ids(leader)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
    expect(docIds(leader)).toEqual(['x', 'y']);
    expect(followerSave.mock.calls.map((call) => savedIds(call))).not.toContainEqual([]);
    expect(savedIds(followerSave.mock.lastCall)).toEqual(['x', 'y']);

    await type(follower, 'x', 'x typed');
    await until(() => expect(savedText(followerSave.mock.lastCall, 'x')).toBe('x typed'));

    followerActivity.set(false);
    leaderActivity.set(true);
    await until(() => expect(savedText(leaderSave.mock.lastCall, 'x')).toBe('x typed'));

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    expect(savedIds(leaderSave.mock.lastCall)).toEqual(['x', 'y']);
  });

  it('a follower that turns read-only while it renders posts the rendered blocks, never the half-done document', async () => {
    const { leader, follower } = await twoEditors('render-while-read-only');

    handOverMidRender(follower, () => {
      void follower.moduleInstances.ReadOnly.set(true);
    });
    await follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await until(() => expect(docIds(leader)).toEqual(['x', 'y']));
    // Room for a stray default block to come back, if one were made.
    await oneWindow();

    expect(ids(follower)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
    expect(docIds(leader)).toEqual(['x', 'y']);
    expect(ids(leader)).toEqual(['x', 'y']);
  });

  it('a leader that yields while it renders leaves exactly the rendered blocks in both tabs, and the new leader never saves the half-done document', async () => {
    const { leader, follower, leaderActivity, followerActivity, leaderSave, followerSave } = await twoEditors('render-while-yielding');

    handOverMidRender(leader, () => followerActivity.set(true));
    await leader.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await until(() => expect(savedIds(followerSave.mock.lastCall)).toEqual(['x', 'y']));

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(ids(leader)).toEqual(['x', 'y']);
    expect(ids(follower)).toEqual(['x', 'y']);
    expect(docIds(leader)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
    expect(followerSave.mock.calls.map((call) => savedIds(call))).not.toContainEqual([]);
    expect(savedIds(followerSave.mock.lastCall)).toEqual(['x', 'y']);

    await type(leader, 'x', 'x typed');
    followerActivity.set(false);
    leaderActivity.set(true);
    await until(() => expect(savedText(leaderSave.mock.lastCall, 'x')).toBe('x typed'));

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
  });
});

interface StoreWrite { by: string; ifMatch: string | number | null | undefined; ok: boolean; text: unknown }

/** One versioned store both tabs write to; a stale If-Match is a conflict. */
const createStore = (): {
  writes: StoreWrite[];
  current: () => { version: string; doc: OutputData };
  persistence: (by: string) => NonNullable<BlokConfig['persistence']>;
  /** The next write by `by` reaches the store `ms` later. */
  delayNext: (by: string, ms: number) => void;
} => {
  const state = { version: 'v0', doc: document3(), count: 0 };
  const delays = new Map<string, number>();
  const writes: StoreWrite[] = [];

  return {
    writes,
    current: () => ({ version: state.version, doc: state.doc }),
    delayNext: (by, ms) => delays.set(by, ms),
    persistence: (by) => ({
      load: async () => ({ data: state.doc, version: state.version }),
      save: async (data, { version }) => {
        const delay = delays.get(by);

        if (delay !== undefined) {
          delays.delete(by);
          await wait(delay);
        }
        const ok = version === state.version;

        writes.push({ by, ifMatch: version, ok, text: data.blocks.find((block) => block.id === 'a')?.data.text });
        if (!ok) {
          throw new Error('conflict');
        }
        state.count += 1;
        state.version = `${by}-${state.count}`;
        state.doc = data;

        return { version: state.version };
      },
    }),
  };
};

interface StoredPair {
  leader: Core;
  follower: Core;
  followerActivity: FakeActivity;
  store: ReturnType<typeof createStore>;
  /** The role each tab had whenever its host onSave ran. */
  hostSaves: { leader: string[]; follower: string[] };
}

const isTabChannel = (value: unknown): value is TabChannel =>
  typeof value === 'object' && value !== null && 'post' in value && 'onMessage' in value;

/** The mocked browser platform is a fake one; see vi.mock above. */
const fakePlatform = browserTabPlatform as unknown as ReturnType<typeof createFakePlatform>;

/** A leader and a follower on one versioned store, both settled. */
const twoStoredEditors = async (documentId: string): Promise<StoredPair> => {
  const store = createStore();
  const followerActivity = createFakeActivity();
  const activity = vi.spyOn(browserTabPlatform, 'activity');
  const hostSaves = { leader: [] as string[], follower: [] as string[] };
  const cell: { leader: Core | null; follower: Core | null } = { leader: null, follower: null };

  activity.mockImplementationOnce(() => createFakeActivity());
  const leader = createCore({
    documentId,
    persistence: store.persistence('leader'),
    onSave: () => hostSaves.leader.push(cell.leader?.moduleInstances.TabSync.role ?? '?'),
  });

  cell.leader = leader;
  await leader.isReady;
  await wait(50);
  activity.mockImplementationOnce(() => followerActivity);
  const follower = createCore({
    documentId,
    persistence: store.persistence('follower'),
    onSave: () => hostSaves.follower.push(cell.follower?.moduleInstances.TabSync.role ?? '?'),
  });

  cell.follower = follower;
  await follower.isReady;
  await until(() => expect(follower.moduleInstances.TabSync.role).toBe('follower'));
  expect(leader.moduleInstances.TabSync.role).toBe('leader');
  await oneWindow();
  hostSaves.leader.length = 0;
  hostSaves.follower.length = 0;
  store.writes.length = 0;

  return { leader, follower, followerActivity, store, hostSaves };
};

/** The next serialization in `core` takes `ms` longer. */
const slowNextSerialization = (core: Core, ms: number): void => {
  const { Saver } = core.moduleInstances;
  const save = Saver.save.bind(Saver);

  vi.spyOn(Saver, 'save').mockImplementationOnce(async (...args) => {
    await wait(ms);

    return save(...args);
  });
};

describe('Core — a demoted leader never saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a serialization that outlasts the yield is never delivered by the old leader; the new leader saves after it', async () => {
    const { leader, follower, followerActivity, store, hostSaves } = await twoStoredEditors('slow-serialization-yield');

    // Ends well after the yield deadline, which runs from the claim.
    slowNextSerialization(leader, YIELD_SAVE_WAIT_MS + 1500);
    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await oneWindow();
    followerActivity.set(true);
    // The new leader writes only after the old serialization was dropped.
    await until(() => expect(store.writes.some((write) => write.by === 'follower')).toBe(true), 10_000);

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(leader.moduleInstances.TabSync.role).toBe('follower');
    expect(hostSaves.leader).not.toContain('follower');
    expect(store.writes.filter((write) => write.by === 'leader')).toEqual([]);
    expect(store.writes.every((write) => write.ok)).toBe(true);
    expect(store.current().doc.blocks.find((block) => block.id === 'a')?.data.text).toBe('a edited');
  }, 20_000);

  it('a leader that turns read-only with a request out: the tab that takes over writes after it, and the old request is never retried over newer content', async () => {
    const { leader, follower, store, hostSaves } = await twoStoredEditors('read-only-request-out');

    store.delayNext('leader', 1500);
    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await oneWindow();
    expect(store.writes).toEqual([]);

    await leader.moduleInstances.ReadOnly.set(true);
    await until(() => expect(follower.moduleInstances.TabSync.role).toBe('leader'));
    // The read-only tab kept the lock until its request settled.
    expect(store.writes[0]).toEqual(expect.objectContaining({ by: 'leader', ok: true }));
    await follower.moduleInstances.API.methods.blocks.update('a', { text: 'a by follower' });
    await until(() => expect(store.current().doc.blocks.find((block) => block.id === 'a')?.data.text).toBe('a by follower'));
    // Past the old queue's retry delays: a retry would show up here.
    await wait(2500);

    expect(hostSaves.leader).not.toContain('follower');
    expect(store.writes.filter((write) => write.by === 'leader' && !write.ok)).toEqual([]);
    expect(store.writes.filter((write) => write.by === 'leader' && typeof write.ifMatch === 'string' && write.ifMatch.startsWith('follower'))).toEqual([]);
    expect(store.current().doc.blocks.find((block) => block.id === 'a')?.data.text).toBe('a by follower');
  }, 20_000);

  it('a leader whose lock is stolen while it serializes never delivers that save', async () => {
    const channel = vi.spyOn(browserTabPlatform, 'channel');
    const { leader, follower, followerActivity, store, hostSaves } = await twoStoredEditors('stolen-mid-serialization');
    const key = resolveTabKey({ documentId: 'stolen-mid-serialization', recordId: null, idSource: 'host', hasSaved: false, isEmpty: false, pathname: '/' });
    // The leader opened its channel first.
    const leaderChannel: unknown = channel.mock.results.find((_result, i) => channel.mock.calls[i][0] === key)?.value;

    expect(leaderChannel).toBeInstanceOf(Object);
    if (!isTabChannel(leaderChannel)) {
      return;
    }
    slowNextSerialization(leader, CLAIM_TIMEOUT_MS + 2000);
    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await oneWindow();
    // A frozen leader: it hears no claim, so only the steal moves the lock.
    fakePlatform.pauseInbound(leaderChannel);
    followerActivity.set(true);
    await until(() => expect(follower.moduleInstances.TabSync.role).toBe('leader'), CLAIM_SETTLE_MS + CLAIM_TIMEOUT_MS + 2000);
    expect(leader.moduleInstances.TabSync.role).toBe('follower');

    await until(() => expect(leader.moduleInstances.ModificationsObserver.isSaving).toBe(false), 5000);

    expect(hostSaves.leader).not.toContain('follower');
    expect(store.writes.filter((write) => write.by === 'leader')).toEqual([]);
    expect(store.current().doc.blocks.find((block) => block.id === 'a')?.data.text).toBe('a edited');
  }, 20_000);

  it('the tab taking over keeps its own typing unsaved while it waits for the old leader, then saves it', async () => {
    const { leader, follower, followerActivity, store } = await twoStoredEditors('claimant-typing-while-settling');

    store.delayNext('leader', YIELD_SAVE_WAIT_MS + 2000);
    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await oneWindow();
    followerActivity.set(true);
    await until(() => expect(leader.moduleInstances.TabSync.role).toBe('follower'), CLAIM_SETTLE_MS + YIELD_SAVE_WAIT_MS + 1000);
    expect(follower.moduleInstances.TabSync.role).toBe('follower');

    await type(follower, 'b', 'b typed while waiting');

    expect(follower.moduleInstances.TabSync.role).toBe('follower');
    expect(follower.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true);

    await until(() => expect(store.current().doc.blocks.find((block) => block.id === 'b')?.data.text).toBe('b typed while waiting'), 5000);

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(store.writes.filter((write) => write.by === 'leader')).toEqual([expect.objectContaining({ ok: true })]);
    expect(store.current().doc.blocks.find((block) => block.id === 'b')?.data.text).toBe('b typed while waiting');
    expect(follower.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(false);
  }, 20_000);

  it('a tab demoted by read-only that types again as a follower shows no close prompt once the leader saved', async () => {
    const { leader, follower, store } = await twoStoredEditors('read-only-round-trip');

    await leader.moduleInstances.ReadOnly.set(true);
    await until(() => expect(follower.moduleInstances.TabSync.role).toBe('leader'));
    await leader.moduleInstances.ReadOnly.set(false);
    expect(leader.moduleInstances.TabSync.role).toBe('follower');

    await type(leader, 'a', 'a typed as follower');
    await until(() => expect(store.current().doc.blocks.find((block) => block.id === 'a')?.data.text).toBe('a typed as follower'));

    expect(leader.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(false);
  }, 20_000);
});

/** Whether a guard holds the tab back from closing. */
const closePromptArmed = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

describe('Core — a lone leader that turns read-only keeps a save that did not land', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** One tab on its own store. */
  const loneEditor = async (documentId: string, save: Mock<() => Promise<undefined>>): Promise<Core> => {
    const core = createCore({ documentId, persistence: { load: async () => document3(), save } });

    await core.isReady;
    await until(() => expect(core.moduleInstances.TabSync.role).toBe('leader'));
    await oneWindow();
    save.mockClear();

    return core;
  };

  const savedTextOf = (save: Mock<() => Promise<undefined>>): unknown => savedText(save.mock.lastCall, 'a');

  it('a request that fails after the tab turned read-only keeps the edit, the close prompt, and is saved once editable', async () => {
    const save = vi.fn(async (): Promise<undefined> => undefined);
    const core = await loneEditor('lone-request-fails', save);

    save.mockImplementationOnce(async () => {
      await wait(800);
      throw new Error('store down');
    });
    await core.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await until(() => expect(save).toHaveBeenCalledTimes(1));
    await core.moduleInstances.ReadOnly.set(true);

    await until(() => expect(core.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true));
    expect(closePromptArmed()).toBe(true);

    await core.moduleInstances.ReadOnly.set(false);
    await until(() => expect(save).toHaveBeenCalledTimes(2));
    expect(savedTextOf(save)).toBe('a edited');
  }, 20_000);

  it('a parked save dropped by the read-only turn keeps the edit, the close prompt, and is saved once editable', async () => {
    const save = vi.fn(async (): Promise<undefined> => undefined);
    const core = await loneEditor('lone-parked', save);

    save.mockRejectedValue(new Error('store down'));
    await core.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await until(() => expect(persistenceVersionAccess(core.config.persistence)?.saveState()).toBe('failed'), 6000);
    const calls = save.mock.calls.length;

    await core.moduleInstances.ReadOnly.set(true);

    expect(core.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true);
    expect(closePromptArmed()).toBe(true);

    save.mockResolvedValue(undefined);
    await core.moduleInstances.ReadOnly.set(false);
    await until(() => expect(save.mock.calls.length).toBeGreaterThan(calls));
    expect(savedTextOf(save)).toBe('a edited');
  }, 20_000);
});
