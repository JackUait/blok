import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { releasePersistenceQueue } from '../../../src/components/utils/persistence';
import { Paragraph } from '../../../src/tools';
import { browserTabPlatform } from '../../../src/components/modules/tabSync/platform';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import { CLAIM_SETTLE_MS } from '../../../src/components/modules/tabSync';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../types';

import { createFakeActivity } from './modules/tabSync/fakes';

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
    await oneWindow();

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(ids(follower)).toEqual(['x', 'y']);
    expect(ids(leader)).toEqual(['x', 'y']);
    expect(docIds(follower)).toEqual(['x', 'y']);
    expect(docIds(leader)).toEqual(['x', 'y']);
    expect(followerSave.mock.calls.map((call) => savedIds(call))).not.toContainEqual([]);
    expect(savedIds(followerSave.mock.lastCall)).toEqual(['x', 'y']);

    await type(follower, 'x', 'x typed');
    await oneWindow();
    expect(savedText(followerSave.mock.lastCall, 'x')).toBe('x typed');

    followerActivity.set(false);
    leaderActivity.set(true);
    await wait(CLAIM_SETTLE_MS + 150);
    await oneWindow();

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    expect(savedText(leaderSave.mock.lastCall, 'x')).toBe('x typed');
    expect(savedIds(leaderSave.mock.lastCall)).toEqual(['x', 'y']);
  });

  it('a follower that turns read-only while it renders posts the rendered blocks, never the half-done document', async () => {
    const { leader, follower } = await twoEditors('render-while-read-only');

    handOverMidRender(follower, () => {
      void follower.moduleInstances.ReadOnly.set(true);
    });
    await follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
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
    await oneWindow();

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
    await wait(CLAIM_SETTLE_MS + 150);
    await oneWindow();

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    expect(savedText(leaderSave.mock.lastCall, 'x')).toBe('x typed');
  });
});
